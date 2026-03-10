import path from 'path';
import type { TLSSocket } from 'tls';
import type { Socket } from 'net';
import logger from '../config/logger.ts';
import { isAllowedDomain } from '../utils/validation.ts';
import { serveStaticFile } from './static.ts';
import { serveDynamicRoute } from './dynamic.ts';

/**
 * Handles incoming Gemini protocol requests.
 */
export async function handleRequest(socket: Socket | TLSSocket, data: Buffer | string): Promise<void> {
  try {
    // Hey you, URL class already normalizes the path
    // so we don't need to do it never (Anti path traversal)
    const url      = new URL(data.toString().trim());
    const hostname = url.hostname;
    const pathname = url.pathname.slice(1);
    const input    = url.search.slice(1);

    if (hostname.length > 255) {
      socket.write('59 Bad Request: Hostname too long\r\n');
      logger.error(`Rejected domain: ${url}`);
      socket.end();
      return;
    }

    if (!isAllowedDomain(hostname)) {
      socket.write('53 Proxy request refused\r\n');
      logger.error(`Rejected domain: ${url}`);
      socket.end();
      return;
    }

    logger.info(`Requested: ${url}, from: ${socket.remoteAddress}`);
    
    // Block direct access to files starting with +
    const pathParts = pathname.split('/').filter(p => p);
    if (pathParts.some(part => part.startsWith('+'))) {
      socket.write('51 Not Found\r\n');
      socket.end();
      return;
    }
    
    // Try dynamic route first, then static file
    if (await serveDynamicRoute(socket, pathname, input)) {}
    else if (await serveStaticFile(socket, pathname, input)) {}
    else {socket.write('51 Not Found\r\n'); logger.warn(`Not found: ${pathname}`);}
  } catch (error) {
    logger.error(`Error processing request: ${error}`);
  } finally {
    socket.end();
    return;
  }
}
