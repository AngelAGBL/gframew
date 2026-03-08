import logger from './config/logger.ts';
import tls from 'tls';
import net from 'net';
import fs from 'fs';
import { config } from './config/server.ts';
import { handleRequest } from './handlers/request.ts';
import { database } from './config/database.ts';
import { validateRequestBuffer } from './utils/validation.ts';

// Connect to MongoDB
await database.connect();

// Gemini protocol limits: max 1024 bytes + \r\n
const MAX_REQUEST_SIZE = 1026;
const REQUEST_TIMEOUT = 5000; // 5 seconds
const GEMINI_PROTOCOL = 'gemini://';
const MIN_VALID_REQUEST_LENGTH = GEMINI_PROTOCOL.length + 1;

// PROXY protocol support
const PROXY_ENABLED = process.env.PROXY === 'true';
const PROXY_V1_PREFIX = 'PROXY ';
const PROXY_V2_SIGNATURE = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);

// TLS options
const TLS_OPTIONS = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  requestCert: true,
  rejectUnauthorized: false
};

interface ProxyInfo {
  srcAddress: string;
  srcPort: number;
  dstAddress: string;
  dstPort: number;
}

const parseProxyV1Header = (line: string): ProxyInfo | null => {
  const parts = line.split(' ');
  if (parts.length !== 6 || parts[0] !== 'PROXY') return null;
  return {
    srcAddress: parts[2],
    srcPort: parseInt(parts[4]),
    dstAddress: parts[3],
    dstPort: parseInt(parts[5])
  };
};

const parseProxyV2Header = (buffer: Buffer): { info: ProxyInfo | null; headerLength: number } => {
  if (buffer.length < 16) return { info: null, headerLength: 0 };
  if (!buffer.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) return { info: null, headerLength: 0 };
  
  const verCmd = buffer[12];
  const famProto = buffer[13];
  const len = buffer.readUInt16BE(14);
  const headerLength = 16 + len;
  
  if (buffer.length < headerLength) return { info: null, headerLength: 0 };
  if ((verCmd & 0x0F) !== 0x01) return { info: null, headerLength };
  
  const family = (famProto & 0xF0) >> 4;
  let info: ProxyInfo | null = null;
  
  if (family === 0x01) {
    info = {
      srcAddress: `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`,
      dstAddress: `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`,
      srcPort: buffer.readUInt16BE(24),
      dstPort: buffer.readUInt16BE(26)
    };
  } else if (family === 0x02) {
    info = {
      srcAddress: buffer.subarray(16, 32).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      dstAddress: buffer.subarray(32, 48).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      srcPort: buffer.readUInt16BE(48),
      dstPort: buffer.readUInt16BE(50)
    };
  }
  
  return { info, headerLength };
};

// Handle TLS socket (common for both modes)
const handleTLSSocket = (socket: tls.TLSSocket, clientAddress: string) => {
  let buffer = Buffer.alloc(0);
  let requestComplete = false;
  let validationFailed = false;
  let handshakeComplete = false;

  const cleanup = () => {
    socket.removeAllListeners();
  };

  const rejectRequest = (message: string) => {
    if (validationFailed || requestComplete) return;
    validationFailed = true;
    logger.warn(`${message} from ${clientAddress}`);
    try { if (socket.writable) socket.write(`59 Bad Request: ${message}\r\n`); } catch (e) {}
    try { socket.destroy(); } catch (e) {}
    cleanup();
  };

  socket.on('secureConnect', () => {
    handshakeComplete = true;
    logger.info(`✓ TLS established for ${clientAddress}`);
  });

  socket.on('data', (chunk: Buffer) => {
    if (requestComplete || validationFailed || !handshakeComplete) return;

    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_REQUEST_SIZE) {
      rejectRequest('Request too long');
      return;
    }

    const validationError = validateRequestBuffer(buffer);
    if (validationError) {
      rejectRequest(validationError);
      return;
    }

    const requestStr = buffer.toString('utf-8');
    if (requestStr.includes('\r\n')) {
      requestComplete = true;
      cleanup();
      const requestLine = requestStr.split('\r\n')[0];
      if (requestLine.length < MIN_VALID_REQUEST_LENGTH) {
        rejectRequest('Invalid URL format');
        return;
      }
      handleRequest(socket, requestLine);
    }
  });

  socket.on('end', () => {
    if (!requestComplete && !validationFailed && buffer.length > 0) {
      logger.warn(`Client closed connection with incomplete request from ${clientAddress}`);
    }
    cleanup();
  });

  socket.on('close', () => cleanup());
  socket.setTimeout(REQUEST_TIMEOUT, () => {
    if (!requestComplete && !validationFailed) rejectRequest('Timeout');
  });
  socket.on('error', (error) => {
    if (!validationFailed && !requestComplete) {
      logger.error(`Socket error from ${clientAddress}: ${error.message}`);
    }
    cleanup();
  });
};

// Handle connection with PROXY protocol
const handleConnectionWithProxy = (rawSocket: net.Socket) => {
  let dataBuffer = Buffer.alloc(0);
  let proxyParsed = false;
  let realClientAddress = rawSocket.remoteAddress || 'unknown';
  let connectionClosed = false;

  const closeConnection = (message?: string) => {
    if (connectionClosed) return;
    connectionClosed = true;
    if (message) logger.warn(`${message} from ${realClientAddress}`);
    try { rawSocket.destroy(); } catch (e) {}
  };

  const handleData = (chunk: Buffer) => {
    if (connectionClosed || proxyParsed) return;
    dataBuffer = Buffer.concat([dataBuffer, chunk]);
    
    let proxyHeaderLength = 0;
    let proxyInfo: ProxyInfo | null = null;
    
    // Try PROXY v2
    if (dataBuffer.length >= PROXY_V2_SIGNATURE.length && 
        dataBuffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
      const result = parseProxyV2Header(dataBuffer);
      if (result.headerLength === 0) {
        if (dataBuffer.length > 512) closeConnection('Invalid PROXY v2 header');
        return;
      }
      proxyHeaderLength = result.headerLength;
      proxyInfo = result.info;
    }
    // Try PROXY v1
    else if (dataBuffer.toString('utf-8', 0, Math.min(6, dataBuffer.length)).startsWith(PROXY_V1_PREFIX)) {
      const bufferStr = dataBuffer.toString('utf-8');
      const crlfIndex = bufferStr.indexOf('\r\n');
      if (crlfIndex === -1) {
        if (dataBuffer.length > 108) closeConnection('Invalid PROXY v1 header');
        return;
      }
      proxyHeaderLength = crlfIndex + 2;
      proxyInfo = parseProxyV1Header(bufferStr.substring(0, crlfIndex));
    }
    // Not PROXY
    else if (dataBuffer.length >= 6) {
      closeConnection('Expected PROXY protocol header');
      return;
    } else {
      return; // Need more data
    }
    
    // PROXY header parsed
    proxyParsed = true;
    if (proxyInfo) {
      realClientAddress = proxyInfo.srcAddress;
      logger.info(`PROXY: Real client ${realClientAddress}:${proxyInfo.srcPort}`);
    }
    
    // Remove handler
    rawSocket.removeAllListeners();
    
    // Get TLS data
    const tlsData = dataBuffer.subarray(proxyHeaderLength);
    logger.debug(`PROXY parsed, TLS data: ${tlsData.length} bytes`);
    
    // Create TLS socket
    const tlsSocket = new tls.TLSSocket(rawSocket, {
      isServer: true,
      ...TLS_OPTIONS
    });
    
    // Feed TLS data using internal API
    if (tlsData.length > 0) {
      setImmediate(() => {
        if ((tlsSocket as any)._handle && (tlsSocket as any)._handle.onread) {
          (tlsSocket as any)._handle.onread(tlsData.length, tlsData);
        }
      });
    }
    
    handleTLSSocket(tlsSocket, realClientAddress);
  };

  rawSocket.on('data', handleData);
  rawSocket.setTimeout(REQUEST_TIMEOUT, () => {
    if (!proxyParsed) closeConnection('Timeout waiting for PROXY header');
  });
  rawSocket.on('error', (error) => {
    if (!connectionClosed) {
      logger.error(`Socket error from ${realClientAddress}: ${error.message}`);
      closeConnection();
    }
  });
};

// Create server
const server = PROXY_ENABLED
  ? net.createServer(handleConnectionWithProxy)
  : tls.createServer(TLS_OPTIONS, (socket) => {
      handleTLSSocket(socket, socket.remoteAddress || 'unknown');
    });

server.listen(config.port);
logger.info(`🚀 Gemini server started on port ${config.port} (PROXY: ${PROXY_ENABLED ? 'enabled' : 'disabled'})`);

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await database.disconnect();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
