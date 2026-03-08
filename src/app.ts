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

// Configuration
const MAX_REQUEST_SIZE = 1026; // Gemini protocol: max 1024 bytes + \r\n
const REQUEST_TIMEOUT = 30000; // 30 seconds
const GEMINI_PROTOCOL = 'gemini://';
const MIN_VALID_REQUEST_LENGTH = GEMINI_PROTOCOL.length + 1;

// PROXY protocol configuration
const PROXY_ENABLED = process.env.PROXY === 'true';
const PROXY_V1_PREFIX = 'PROXY ';
const PROXY_V2_SIGNATURE = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);
const MAX_PROXY_V1_SIZE = 108;
const MAX_PROXY_V2_SIZE = 512;

// TLS configuration
const TLS_OPTIONS = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  requestCert: true,
  rejectUnauthorized: false
};

// Warn if using PROXY with Bun
if (PROXY_ENABLED && typeof Bun !== 'undefined') {
  logger.warn('⚠️  PROXY mode with Bun has known issues. Consider using Node.js instead');
  logger.warn('⚠️  See README.md for details and alternatives');
}

interface ProxyInfo {
  srcAddress: string;
  srcPort: number;
  dstAddress: string;
  dstPort: number;
}

/**
 * Parse PROXY protocol v1 header (text format)
 */
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

/**
 * Parse PROXY protocol v2 header (binary format)
 */
const parseProxyV2Header = (buffer: Buffer): { info: ProxyInfo | null; headerLength: number } => {
  if (buffer.length < 16) return { info: null, headerLength: 0 };
  if (!buffer.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) {
    return { info: null, headerLength: 0 };
  }
  
  const verCmd = buffer[12];
  const famProto = buffer[13];
  const len = buffer.readUInt16BE(14);
  const headerLength = 16 + len;
  
  if (buffer.length < headerLength) return { info: null, headerLength: 0 };
  if ((verCmd & 0x0F) !== 0x01) return { info: null, headerLength };
  
  const family = (famProto & 0xF0) >> 4;
  let info: ProxyInfo | null = null;
  
  if (family === 0x01) { // IPv4
    info = {
      srcAddress: `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`,
      dstAddress: `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`,
      srcPort: buffer.readUInt16BE(24),
      dstPort: buffer.readUInt16BE(26)
    };
  } else if (family === 0x02) { // IPv6
    info = {
      srcAddress: buffer.subarray(16, 32).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      dstAddress: buffer.subarray(32, 48).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      srcPort: buffer.readUInt16BE(48),
      dstPort: buffer.readUInt16BE(50)
    };
  }
  
  return { info, headerLength };
};

/**
 * Handle TLS socket and process Gemini protocol requests
 */
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
      if (socket.writable) {
        socket.write(`59 Bad Request: ${message}\r\n`);
      }
    } catch (error) {
      logger.debug(`Could not write error response: ${error}`);
    }
    
    try {
      if (!socket.destroyed) {
        socket.destroy();
      }
    } catch (error) {
      logger.debug(`Could not destroy socket: ${error}`);
    }
    
    cleanup();
  };

  socket.on('secureConnect', () => {
    logger.info(`✓ TLS established for ${clientAddress}`);
  });

  socket.on('data', (chunk: Buffer) => {
    if (requestComplete || validationFailed) return;

    buffer = Buffer.concat([buffer, chunk]);
    
    // Check request size limit
    if (buffer.length > MAX_REQUEST_SIZE) {
      rejectRequest('Request too long');
      return;
    }

    // Validate buffer content
    const validationError = validateRequestBuffer(buffer);
    if (validationError) {
      rejectRequest(validationError);
      return;
    }

    // Check if request is complete (ends with \r\n)
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

  socket.on('close', () => {
    cleanup();
  });
  
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

/**
 * Handle connection with PROXY protocol support
 * Parses PROXY header, then establishes TLS
 */
const handleConnectionWithProxy = (rawSocket: net.Socket) => {
  let proxyBuffer = Buffer.alloc(0);
  let proxyParsed = false;
  let realClientAddress = rawSocket.remoteAddress || 'unknown';
  let connectionClosed = false;
  let proxyHeaderLength = 0;

  const closeConnection = (message?: string) => {
    if (connectionClosed) return;
    connectionClosed = true;
    
    if (message) {
      logger.warn(`${message} from ${realClientAddress}`);
    }
    
    try {
      rawSocket.destroy();
    } catch (error) {
      logger.debug(`Error closing connection: ${error}`);
    }
  };

  const tryParseProxy = (): boolean => {
    let proxyInfo: ProxyInfo | null = null;
    
    // Try PROXY v2 (binary)
    if (proxyBuffer.length >= PROXY_V2_SIGNATURE.length && 
        proxyBuffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
      const result = parseProxyV2Header(proxyBuffer);
      
      if (result.headerLength === 0) {
        if (proxyBuffer.length > MAX_PROXY_V2_SIZE) {
          closeConnection('Invalid PROXY v2 header');
          return false;
        }
        return false; // Need more data
      }
      
      proxyHeaderLength = result.headerLength;
      proxyInfo = result.info;
    }
    // Try PROXY v1 (text)
    else if (proxyBuffer.toString('utf-8', 0, Math.min(6, proxyBuffer.length)).startsWith(PROXY_V1_PREFIX)) {
      const bufferStr = proxyBuffer.toString('utf-8');
      const crlfIndex = bufferStr.indexOf('\r\n');
      
      if (crlfIndex === -1) {
        if (proxyBuffer.length > MAX_PROXY_V1_SIZE) {
          closeConnection('Invalid PROXY v1 header');
          return false;
        }
        return false; // Need more data
      }
      
      proxyHeaderLength = crlfIndex + 2;
      proxyInfo = parseProxyV1Header(bufferStr.substring(0, crlfIndex));
    }
    // Not a valid PROXY header
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
        
        // Clean up raw socket listeners
        rawSocket.removeAllListeners('readable');
        rawSocket.removeAllListeners('timeout');
        rawSocket.removeAllListeners('error');
        rawSocket.setTimeout(0);
        
        // Extract TLS data that came after PROXY header
        const tlsData = proxyBuffer.subarray(proxyHeaderLength);
        logger.debug(`PROXY header: ${proxyHeaderLength} bytes, TLS data: ${tlsData.length} bytes`);
        
        // Put TLS data back into socket's read buffer
        if (tlsData.length > 0) {
          rawSocket.unshift(tlsData);
        }
        
        // Create TLS socket wrapping the raw socket
        const tlsSocket = new tls.TLSSocket(rawSocket, {
          isServer: true,
          ...TLS_OPTIONS
        });
        
        // Trigger TLS to read the buffered data
        if (tlsData.length > 0) {
          setImmediate(() => {
            rawSocket.emit('readable');
          });
        }
        
        handleTLSSocket(tlsSocket, realClientAddress);
        return;
      }
    }
  };

  // Use 'readable' event for manual read control (required for unshift to work)
  rawSocket.on('readable', handleReadable);
  
  rawSocket.setTimeout(REQUEST_TIMEOUT, () => {
    if (!proxyParsed) {
      closeConnection('Timeout waiting for PROXY header');
    }
  });
  
  rawSocket.on('error', (error) => {
    if (!connectionClosed) {
      logger.error(`Socket error from ${realClientAddress}: ${error.message}`);
      closeConnection();
    }
  });
};

// Create server based on PROXY mode
const server = PROXY_ENABLED
  ? net.createServer(handleConnectionWithProxy)
  : tls.createServer(TLS_OPTIONS, (socket) => {
      handleTLSSocket(socket, socket.remoteAddress || 'unknown');
    });

server.listen(config.port);
logger.info(`🚀 Gemini server started on port ${config.port} (PROXY: ${PROXY_ENABLED ? 'enabled' : 'disabled'})`);

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('Server closed');
  });
  
  // Disconnect from database
  try {
    await database.disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error(`Error disconnecting database: ${error}`);
  }
  
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  logger.error(error.stack);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: ${reason}`);
  shutdown('UNHANDLED_REJECTION');
});
