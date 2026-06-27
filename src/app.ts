import tls from 'tls';
import net from 'net';
import logger from './config/logger.ts';
import { config } from './config/server.ts';
import { database } from './config/database.ts';
import { TLS_OPTIONS } from './protocol/tls.ts';
import { handleConnectionWithProxy, handleTLSSocket } from './protocol/connection.ts';
import { registerUserHelpers } from './templates/handlebars.ts';
import { loadMatchers } from './runtime/matchers.ts';

await database.connect();

// Load developer-defined Handlebars helpers and route matchers, if present.
await registerUserHelpers();
await loadMatchers();

// Bun's TLSSocket has known issues with the manual PROXY-then-TLS upgrade path.
if (config.proxyEnabled && typeof Bun !== 'undefined') {
  logger.warn('⚠️  PROXY mode with Bun has known issues. Consider using Node.js instead');
  logger.warn('⚠️  See README.md for details and alternatives');
}

// In PROXY mode we accept raw TCP and upgrade to TLS after parsing the header;
// otherwise we terminate TLS directly.
const server = config.proxyEnabled
  ? net.createServer(handleConnectionWithProxy)
  : tls.createServer(TLS_OPTIONS, (socket) =>
      handleTLSSocket(socket, socket.remoteAddress || 'unknown')
    );

server.listen(config.port);
logger.info(
  `🚀 Gemini server started on port ${config.port} (PROXY: ${
    config.proxyEnabled ? 'enabled' : 'disabled'
  })`
);

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(() => logger.info('Server closed'));

  try {
    await database.disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error(`Error disconnecting database: ${error}`);
  }

  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  logger.error(error.stack);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: ${reason}`);
  shutdown('UNHANDLED_REJECTION');
});
