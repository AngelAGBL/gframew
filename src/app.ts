import logger from './config/logger.ts';
import tls from 'tls';
import fs from 'fs';
import { config } from './config/server.ts';
import { handleRequest } from './handlers/request.ts';

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