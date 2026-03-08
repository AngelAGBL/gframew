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
const REQUEST_TIMEOUT = 30000; // 30 seconds - increased for slow connections
const GEMINI_PROTOCOL = 'gemini://';
const MIN_VALID_REQUEST_LENGTH = GEMINI_PROTOCOL.length + 1;

// PROXY protocol support
const PROXY_ENABLED = process.env.PROXY === 'true';
const PROXY_V1_PREFIX = 'PROXY ';
const PROXY_V2_SIGNATURE = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);

// Warn if using PROXY with Bun
if (PROXY_ENABLED && typeof Bun !== 'undefined') {
  logger.warn('⚠️  PROXY mode with Bun has known issues. Consider using Node.js instead: node src/app.ts');
  logger.warn('⚠️  See README.md for details and alternatives');
}

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

  const cleanup = () => {
    socket.removeAllListeners();
  };

  const rejectRequest = (message: string) => {
    if (validationFailed || requestComplete) return;
    validationFailed = true;
    logger.warn(`${message} from ${clientAddress}`);
    try { 
      if (socket.writable) socket.write(`59 Bad Request: ${message}\r\n`); 
    } catch (e) {
      logger.debug(`Could not write error: ${e}`);
    }
    try { 
      if (!socket.destroyed) socket.destroy(); 
    } catch (e) {
      logger.debug(`Could not destroy socket: ${e}`);
    }
    cleanup();
  };

  socket.on('secureConnect', () => {
    logger.info(`✓ TLS established for ${clientAddress}`);
  });

  socket.on('data', (chunk: Buffer) => {
    if (requestComplete || validationFailed) return;

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
    if (!requestComplete && !validationFailed) {
      rejectRequest('Timeout');
    }
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
  let proxyBuffer = Buffer.alloc(0);
  let proxyParsed = false;
  let realClientAddress = rawSocket.remoteAddress || 'unknown';
  let connectionClosed = false;
  let proxyHeaderLength = 0;

  const closeConnection = (message?: string) => {
    if (connectionClosed) return;
    connectionClosed = true;
    if (message) logger.warn(`${message} from ${realClientAddress}`);
    try { rawSocket.destroy(); } catch (e) {}
  };

  const tryParseProxy = (): boolean => {
    let proxyInfo: ProxyInfo | null = null;
    
    // Try PROXY v2
    if (proxyBuffer.length >= PROXY_V2_SIGNATURE.length && 
        proxyBuffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
      const result = parseProxyV2Header(proxyBuffer);
      if (result.headerLength === 0) {
        if (proxyBuffer.length > 512) {
          closeConnection('Invalid PROXY v2 header');
          return false;
        }
        return false; // Need more data
      }
      proxyHeaderLength = result.headerLength;
      proxyInfo = result.info;
    }
    // Try PROXY v1
    else if (proxyBuffer.toString('utf-8', 0, Math.min(6, proxyBuffer.length)).startsWith(PROXY_V1_PREFIX)) {
      const bufferStr = proxyBuffer.toString('utf-8');
      const crlfIndex = bufferStr.indexOf('\r\n');
      if (crlfIndex === -1) {
        if (proxyBuffer.length > 108) {
          closeConnection('Invalid PROXY v1 header');
          return false;
        }
        return false; // Need more data
      }
      proxyHeaderLength = crlfIndex + 2;
      proxyInfo = parseProxyV1Header(bufferStr.substring(0, crlfIndex));
    }
    // Not PROXY
    else if (proxyBuffer.length >= 6) {
      closeConnection('Expected PROXY protocol header');
      return false;
    } else {
      return false; // Need more data
    }
    
    // PROXY header parsed successfully
    if (proxyInfo) {
      realClientAddress = proxyInfo.srcAddress;
      logger.info(`PROXY: Real client ${realClientAddress}:${proxyInfo.srcPort}`);
    }
    
    return true;
  };

  const handleReadable = () => {
    if (connectionClosed || proxyParsed) return;
    
    // Read available data
    let chunk: Buffer | null;
    while ((chunk = rawSocket.read()) !== null) {
      proxyBuffer = Buffer.concat([proxyBuffer, chunk]);
      
      if (tryParseProxy()) {
        proxyParsed = true;
        
        // Remove listeners
        rawSocket.removeAllListeners('readable');
        rawSocket.removeAllListeners('timeout');
        rawSocket.removeAllListeners('error');
        rawSocket.setTimeout(0); // Clear timeout
        
        // Calculate remaining TLS data that we read but don't need
        const tlsData = proxyBuffer.subarray(proxyHeaderLength);
        logger.info(`PROXY header: ${proxyHeaderLength} bytes, TLS data to unshift: ${tlsData.length} bytes`);
        
        if (tlsData.length > 0) {
          logger.info(`First 16 bytes of TLS data: ${tlsData.subarray(0, 16).toString('hex')}`);
          // Unshift the TLS data back
          rawSocket.unshift(tlsData);
          
          // Verify
          const buffered = rawSocket.readableLength;
          logger.info(`Socket readable buffer after unshift: ${buffered} bytes`);
        }
        
        // Create TLS socket
        logger.info('Creating TLSSocket...');
        const tlsSocket = new tls.TLSSocket(rawSocket, {
          isServer: true,
          ...TLS_OPTIONS
        });
        logger.info('TLSSocket created');
        
        // Force TLS to read the buffered data by emitting 'readable'
        if (tlsData.length > 0) {
          setImmediate(() => {
            logger.info('Emitting readable event to trigger TLS read');
            rawSocket.emit('readable');
          });
        }
        
        handleTLSSocket(tlsSocket, realClientAddress);
        return;
      }
    }
  };

  // Use 'readable' event instead of 'data' to have more control
  rawSocket.on('readable', handleReadable);
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
