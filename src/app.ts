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
const MIN_VALID_REQUEST_LENGTH = GEMINI_PROTOCOL.length + 1; // gemini:// + at least 1 char

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
  // PROXY TCP4/TCP6 srcIP dstIP srcPort dstPort\r\n
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
  
  // Verify signature
  if (!buffer.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) {
    return { info: null, headerLength: 0 };
  }
  
  const verCmd = buffer[12];
  const famProto = buffer[13];
  const len = buffer.readUInt16BE(14);
  
  const headerLength = 16 + len;
  if (buffer.length < headerLength) return { info: null, headerLength: 0 };
  
  // Check if it's a PROXY command (not LOCAL)
  if ((verCmd & 0x0F) !== 0x01) return { info: null, headerLength };
  
  // Parse addresses based on family
  const family = (famProto & 0xF0) >> 4;
  let info: ProxyInfo | null = null;
  
  if (family === 0x01) { // IPv4
    const srcAddress = `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`;
    const dstAddress = `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`;
    const srcPort = buffer.readUInt16BE(24);
    const dstPort = buffer.readUInt16BE(26);
    info = { srcAddress, srcPort, dstAddress, dstPort };
  } else if (family === 0x02) { // IPv6
    const srcAddress = buffer.subarray(16, 32).toString('hex').match(/.{1,4}/g)?.join(':') || '';
    const dstAddress = buffer.subarray(32, 48).toString('hex').match(/.{1,4}/g)?.join(':') || '';
    const srcPort = buffer.readUInt16BE(48);
    const dstPort = buffer.readUInt16BE(50);
    info = { srcAddress, srcPort, dstAddress, dstPort };
  }
  
  return { info, headerLength };
};

const handleConnection = (rawSocket: net.Socket) => {
  let proxyBuffer = Buffer.alloc(0);
  let proxyParsed = false;
  let realClientAddress = rawSocket.remoteAddress || 'unknown';
  let realClientPort = rawSocket.remotePort || 0;
  let tlsSocket: tls.TLSSocket | null = null;
  let connectionClosed = false;

  const closeConnection = (message?: string) => {
    if (connectionClosed) return;
    connectionClosed = true;
    
    if (message) {
      logger.warn(`${message} from ${realClientAddress}`);
    }
    
    try {
      if (tlsSocket) {
        tlsSocket.destroy();
      } else {
        rawSocket.destroy();
      }
    } catch (error) {
      // Ignore errors during cleanup
      logger.debug(`Error closing connection: ${error}`);
    }
  };

  const proxyTimeoutHandler = () => {
    closeConnection('Timeout waiting for PROXY header');
  };

  const handleProxyData = (chunk: Buffer) => {
    proxyBuffer = Buffer.concat([proxyBuffer, chunk]);

    // Try to detect PROXY protocol version
    if (proxyBuffer.length >= PROXY_V2_SIGNATURE.length && 
        proxyBuffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
      // PROXY v2
      const { info, headerLength } = parseProxyV2Header(proxyBuffer);
      
      if (headerLength === 0) {
        if (proxyBuffer.length > 512) {
          closeConnection('Invalid PROXY v2 header');
        }
        return; // Wait for more data
      }
      
      proxyParsed = true;
      if (info) {
        realClientAddress = info.srcAddress;
        realClientPort = info.srcPort;
        logger.debug(`PROXY v2: Real client ${realClientAddress}:${realClientPort}`);
      }
      
      // Remove PROXY header and setup TLS
      const remainingData = proxyBuffer.subarray(headerLength);
      setupTLS(remainingData);
      
    } else if (proxyBuffer.toString('utf-8', 0, Math.min(6, proxyBuffer.length)).startsWith(PROXY_V1_PREFIX)) {
      // PROXY v1
      const bufferStr = proxyBuffer.toString('utf-8');
      const crlfIndex = bufferStr.indexOf('\r\n');
      
      if (crlfIndex === -1) {
        if (proxyBuffer.length > 108) {
          closeConnection('Invalid PROXY v1 header');
        }
        return; // Wait for more data
      }
      
      proxyParsed = true;
      const proxyLine = bufferStr.substring(0, crlfIndex);
      const info = parseProxyV1Header(proxyLine);
      
      if (info) {
        realClientAddress = info.srcAddress;
        realClientPort = info.srcPort;
        logger.debug(`PROXY v1: Real client ${realClientAddress}:${realClientPort}`);
      }
      
      // Remove PROXY header and setup TLS
      const remainingData = proxyBuffer.subarray(crlfIndex + 2);
      setupTLS(remainingData);
      
    } else if (proxyBuffer.length >= 6) {
      closeConnection('Expected PROXY protocol header');
    }
    // else: Wait for more data to determine protocol
  };

  const setupTLS = (remainingData: Buffer) => {
    // Remove proxy data handler
    rawSocket.removeListener('data', handleProxyData);
    rawSocket.removeListener('timeout', proxyTimeoutHandler);

    // Check if socket is still valid
    if (connectionClosed || !rawSocket.readable) {
      logger.debug(`Socket no longer valid for TLS setup from ${realClientAddress}`);
      return;
    }

    try {
      // Create TLS socket wrapping the raw socket
      tlsSocket = new tls.TLSSocket(rawSocket, {
        isServer: true,
        ...TLS_OPTIONS
      });

      // Handle TLS errors
      tlsSocket.on('error', (error) => {
        if (!connectionClosed) {
          logger.error(`TLS error from ${realClientAddress}: ${error.message}`);
          closeConnection();
        }
      });

      tlsSocket.on('secureConnect', () => {
        logger.debug(`TLS established for ${realClientAddress}`);
      });

      // Start processing Gemini protocol
      handleGeminiProtocol(tlsSocket, realClientAddress);
    } catch (error) {
      logger.error(`Failed to setup TLS for ${realClientAddress}: ${error}`);
      closeConnection();
    }
  };

  const handleGeminiProtocol = (socket: tls.TLSSocket, clientAddress: string) => {
    let buffer = Buffer.alloc(0);
    let requestComplete = false;
    let validationFailed = false;

    const cleanup = () => {
      socket.removeAllListeners('data');
      socket.removeAllListeners('end');
      socket.removeAllListeners('close');
      socket.removeAllListeners('timeout');
    };

    const rejectRequest = (message: string) => {
      if (validationFailed || requestComplete) return;
      validationFailed = true;
      logger.warn(`${message} from ${clientAddress}`);
      
      try {
        if (socket.writable) {
          socket.write(`59 Bad Request: ${message}\r\n`);
        }
      } catch (error) {
        logger.debug(`Could not write error message: ${error}`);
      }
      
      try {
        socket.destroy();
      } catch (error) {
        logger.debug(`Error destroying socket: ${error}`);
      }
      
      cleanup();
    };

    const timeoutHandler = () => {
      if (!requestComplete && !validationFailed) {
        rejectRequest('Timeout');
      }
    };

    const endHandler = () => {
      if (!requestComplete && !validationFailed) {
        if (buffer.length > 0) {
          logger.warn(`Client closed connection with incomplete request from ${clientAddress}`);
          try {
            if (socket.writable) {
              socket.write('59 Bad Request: Incomplete request\r\n');
            }
          } catch (error) {
            logger.debug(`Could not write error message: ${error}`);
          }
          validationFailed = true;
        }
        cleanup();
        try {
          socket.end();
        } catch (error) {
          logger.debug(`Error ending socket: ${error}`);
        }
      }
    };

    const closeHandler = () => {
      if (!requestComplete && !validationFailed && buffer.length > 0) {
        logger.warn(`Connection closed unexpectedly from ${clientAddress}`);
      }
      cleanup();
    };

    const dataHandler = (chunk: Buffer) => {
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
    };

    socket.on('data', dataHandler);
    socket.on('end', endHandler);
    socket.on('close', closeHandler);
    socket.setTimeout(REQUEST_TIMEOUT, timeoutHandler);

    socket.on('error', (error) => {
      if (!validationFailed && !requestComplete) {
        logger.error(`Socket error from ${clientAddress}: ${error.message}`);
      }
      cleanup();
    });
  };

  // Start processing based on PROXY mode
  if (PROXY_ENABLED) {
    // Wait for PROXY header first
    rawSocket.on('data', handleProxyData);
    rawSocket.setTimeout(REQUEST_TIMEOUT, proxyTimeoutHandler);
    
    rawSocket.on('error', (error) => {
      if (!connectionClosed) {
        logger.error(`Raw socket error from ${realClientAddress}: ${error.message}`);
        closeConnection();
      }
    });
  } else {
    // No PROXY, setup TLS immediately
    setupTLS(Buffer.alloc(0));
  }
};

// Create single TCP server
const server = net.createServer(handleConnection);

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
