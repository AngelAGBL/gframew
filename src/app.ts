import logger from './config/logger.ts';
import tls from 'tls';
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

const server = tls.createServer(
  {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.crt'),
    requestCert: true,
    rejectUnauthorized: false
  },
  (socket) => {
    let buffer = Buffer.alloc(0);
    let requestComplete = false;
    let validationFailed = false;

    const cleanup = () => {
      socket.removeListener('data', dataHandler);
      socket.removeListener('end', endHandler);
      socket.removeListener('close', closeHandler);
      socket.removeListener('timeout', timeoutHandler);
    };

    const rejectRequest = (message: string) => {
      if (validationFailed || requestComplete) return;
      validationFailed = true;
      logger.warn(`${message} from ${socket.remoteAddress}`);
      socket.write(`59 Bad Request: ${message}\r\n`);
      socket.destroy();
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
          logger.warn(`Client closed connection with incomplete request from ${socket.remoteAddress}`);
          socket.write('59 Bad Request: Incomplete request\r\n');
          validationFailed = true;
        }
        cleanup();
        socket.end();
      }
    };

    const closeHandler = () => {
      // Conexión cerrada completamente
      if (!requestComplete && !validationFailed && buffer.length > 0) {
        logger.warn(`Connection closed unexpectedly from ${socket.remoteAddress}`);
      }
      cleanup();
    };

    const dataHandler = (chunk: Buffer) => {
      // Prevent processing if request already complete or failed
      if (requestComplete || validationFailed) return;

      // Accumulate data
      buffer = Buffer.concat([buffer, chunk]);

      // Check if request exceeds maximum size
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
        handleRequest(socket, requestLine);
      }
    };

    socket.on('data', dataHandler);
    socket.on('end', endHandler);
    socket.on('close', closeHandler);
    socket.setTimeout(REQUEST_TIMEOUT, timeoutHandler);

    socket.on('error', (error) => {
      logger.error(`Socket error from ${socket.remoteAddress}: ${error.message}`);
      cleanup();
    });
  }
);

server.listen(config.port);
logger.info(`🚀 Gemini server started on port ${config.port}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await database.disconnect();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
