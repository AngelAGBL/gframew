import type { TLSSocket } from 'tls';
import logger from '../config/logger.ts';
import { isAllowedDomain, isValidGeminiRequest } from '../utils/validation.ts';
import { serveStaticFile } from './static.ts';
import { serveDynamicRoute } from './dynamic.ts';

/**
 * Handles incoming Gemini protocol requests.
 */
export async function handleRequest(socket: TLSSocket, data: Buffer | string): Promise<void> {
  if (!isValidGeminiRequest(data)) {
    logger.warn('Invalid request format - dropping connection');
    socket.destroy();
    return;
  }

  try {
    const url = data.toString().trim();
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const pathname = parsedUrl.pathname || '/';

    logger.info(`→ Request: ${pathname} from ${hostname}`);

    if (!isAllowedDomain(hostname)) {
      socket.write('53 Proxy request refused\r\n');
      logger.warn(`✗ Rejected domain: ${hostname}`);
      socket.end();
      return;
    }

    // Try dynamic route first, then static file
    if (await serveDynamicRoute(socket, pathname)) {
      // Dynamic route served successfully
    } else if (await serveStaticFile(socket, pathname)) {
      // Static file served successfully
    } else {
      socket.write('51 Not Found\r\n');
      logger.warn(`✗ Not found: ${pathname}`);
    }
  } catch (error) {
    logger.error(`Error processing request: ${error}`);
    socket.write('59 Bad Request\r\n');
  } finally {
    socket.end();
  }
}
