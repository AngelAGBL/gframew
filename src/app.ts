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

const handleConnection = (socket: net.Socket) => {
    let buffer = Buffer.alloc(0);
    let requestComplete = false;
    let validationFailed = false;
    let proxyHeaderParsed = !PROXY_ENABLED; // Skip if PROXY not enabled
    let realClientAddress = socket.remoteAddress || 'unknown';
    let realClientPort = socket.remotePort || 0;
    let tlsSocket: tls.TLSSocket | null = null;
    let activeSocket: net.Socket | tls.TLSSocket = socket;

    const cleanup = () => {
      activeSocket.removeListener('data', dataHandler);
      activeSocket.removeListener('end', endHandler);
      activeSocket.removeListener('close', closeHandler);
      activeSocket.removeListener('timeout', timeoutHandler);
    };

    const rejectRequest = (message: string) => {
      if (validationFailed || requestComplete) return;
      validationFailed = true;
      logger.warn(`${message} from ${realClientAddress}`);
      
      try {
        if (activeSocket.writable) {
          activeSocket.write(`59 Bad Request: ${message}\r\n`);
        }
      } catch (error) {
        logger.debug(`Could not write error message: ${error}`);
      }
      
      activeSocket.destroy();
      cleanup();
    };

    const timeoutHandler = () => {
      if (!requestComplete && !validationFailed) {
        rejectRequest('Timeout');
      }
    };

    const endHandler = () => {
      // Cliente cerró su lado de escritura (FIN)
      if (!requestComplete && !validationFailed) {
        if (buffer.length > 0) {
          logger.warn(`Client closed connection with incomplete request from ${realClientAddress}`);
          try {
            if (activeSocket.writable) {
              activeSocket.write('59 Bad Request: Incomplete request\r\n');
            }
          } catch (error) {
            logger.debug(`Could not write error message: ${error}`);
          }
          validationFailed = true;
        }
        cleanup();
        activeSocket.end();
      }
    };

    const closeHandler = () => {
      // Conexión cerrada completamente
      if (!requestComplete && !validationFailed && buffer.length > 0) {
        logger.warn(`Connection closed unexpectedly from ${realClientAddress}`);
      }
      cleanup();
    };

    const setupTLS = (remainingData: Buffer) => {
      // Remove listeners from plain socket
      socket.removeListener('data', dataHandler);
      socket.removeListener('end', endHandler);
      socket.removeListener('close', closeHandler);
      socket.removeListener('timeout', timeoutHandler);

      // Wrap socket with TLS
      tlsSocket = new tls.TLSSocket(socket, {
        isServer: true,
        key: fs.readFileSync('server.key'),
        cert: fs.readFileSync('server.crt'),
        requestCert: true,
        rejectUnauthorized: false
      });

      activeSocket = tlsSocket;

      // Setup listeners on TLS socket
      tlsSocket.on('data', dataHandler);
      tlsSocket.on('end', endHandler);
      tlsSocket.on('close', closeHandler);
      tlsSocket.setTimeout(REQUEST_TIMEOUT, timeoutHandler);
      
      tlsSocket.on('error', (error) => {
        logger.error(`TLS socket error from ${realClientAddress}: ${error.message}`);
        cleanup();
      });

      tlsSocket.on('secureConnect', () => {
        logger.debug(`TLS established for ${realClientAddress}`);
      });

      // If there's remaining data after PROXY header, it will be processed by TLS
      // The TLS handshake should start immediately
    };

    const dataHandler = (chunk: Buffer) => {
      // Prevent processing if request already complete or failed
      if (requestComplete || validationFailed) return;

      // Accumulate data
      buffer = Buffer.concat([buffer, chunk]);

      // Parse PROXY protocol header if enabled and not yet parsed
      if (PROXY_ENABLED && !proxyHeaderParsed) {
        // Try to detect PROXY protocol version
        if (buffer.length >= PROXY_V2_SIGNATURE.length && buffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
          // PROXY v2
          const { info, headerLength } = parseProxyV2Header(buffer);
          if (headerLength > 0) {
            proxyHeaderParsed = true;
            if (info) {
              realClientAddress = info.srcAddress;
              realClientPort = info.srcPort;
              logger.debug(`PROXY v2: Real client ${realClientAddress}:${realClientPort}`);
            }
            // Remove PROXY header from buffer
            buffer = buffer.subarray(headerLength);
            
            // Setup TLS on the underlying socket
            const remainingData = buffer;
            buffer = Buffer.alloc(0); // Clear buffer for TLS data
            setupTLS(remainingData);
            return;
          } else if (buffer.length > 512) {
            // Invalid PROXY v2 header
            rejectRequest('Invalid PROXY v2 header');
            return;
          } else {
            // Wait for more data
            return;
          }
        } else if (buffer.toString('utf-8', 0, Math.min(6, buffer.length)).startsWith(PROXY_V1_PREFIX)) {
          // PROXY v1
          const bufferStr = buffer.toString('utf-8');
          const crlfIndex = bufferStr.indexOf('\r\n');
          if (crlfIndex !== -1) {
            proxyHeaderParsed = true;
            const proxyLine = bufferStr.substring(0, crlfIndex);
            const info = parseProxyV1Header(proxyLine);
            if (info) {
              realClientAddress = info.srcAddress;
              realClientPort = info.srcPort;
              logger.debug(`PROXY v1: Real client ${realClientAddress}:${realClientPort}`);
            }
            // Remove PROXY header from buffer
            buffer = buffer.subarray(crlfIndex + 2);
            
            // Setup TLS on the underlying socket
            const remainingData = buffer;
            buffer = Buffer.alloc(0); // Clear buffer for TLS data
            setupTLS(remainingData);
            return;
          } else if (buffer.length > 108) {
            // PROXY v1 header too long (max is 108 bytes)
            rejectRequest('Invalid PROXY v1 header');
            return;
          } else {
            // Wait for more data
            return;
          }
        } else if (buffer.length >= 6) {
          // Not a PROXY protocol header
          rejectRequest('Expected PROXY protocol header');
          return;
        } else {
          // Wait for more data to determine protocol
          return;
        }
      }

      // Check if request exceeds maximum size (after PROXY header removal)
      if (buffer.length > MAX_REQUEST_SIZE) {
        rejectRequest('Request too long');
        return;
      }

      // Validate buffer content (early validation)
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

        // Extract only the request line (before \r\n)
        const requestLine = requestStr.split('\r\n')[0];

        // Final validation: must have at least protocol + 1 char
        if (requestLine.length < MIN_VALID_REQUEST_LENGTH) {
          rejectRequest('Invalid URL format');
          return;
        }

        // Process the valid request
        handleRequest(activeSocket as net.Socket | tls.TLSSocket, requestLine);
      }
    };

    socket.on('data', dataHandler);
    socket.on('end', endHandler);
    socket.on('close', closeHandler);
    socket.setTimeout(REQUEST_TIMEOUT, timeoutHandler);

    socket.on('error', (error) => {
      logger.error(`Socket error from ${realClientAddress}: ${error.message}`);
      cleanup();
    });
  };

// Create server based on PROXY mode
const server = PROXY_ENABLED
  ? net.createServer(handleConnection)
  : tls.createServer(
      {
        key: fs.readFileSync('server.key'),
        cert: fs.readFileSync('server.crt'),
        requestCert: true,
        rejectUnauthorized: false
      },
      (socket) => {
        // In non-PROXY mode, we already have a TLS socket
        handleConnection(socket as any);
      }
    );

server.listen(config.port);
logger.info(`🚀 Gemini server started on port ${config.port} (PROXY mode: ${PROXY_ENABLED ? 'enabled - TLS after PROXY header' : 'disabled - direct TLS'})`);

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await database.disconnect();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
