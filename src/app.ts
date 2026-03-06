import logger from './config/logger.ts';
import tls from 'tls';
import fs from 'fs';
import { config } from './config/server.ts';
import { handleRequest } from './handlers/request.ts';
import { database } from './config/database.ts';

// Connect to MongoDB
await database.connect();

const server = tls.createServer(
  {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.crt')
  },
  (socket) => {
    socket.once('data', (data) => handleRequest(socket, data));
    
    socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
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