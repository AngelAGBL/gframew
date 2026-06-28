import logger from '../config/logger.ts';
import { MAX_HOSTNAME_LENGTH, StatusCode } from '../constants.ts';
import { isAllowedDomain } from '../utils/validation.ts';
import { serveStaticFile } from './static.ts';
import { serveDynamicRoute } from './dynamic.ts';
import type { GeminiSocket } from '../types.ts';

/**
 * Handles an incoming Gemini protocol request: validates the URL, enforces
 * domain/path policy, and dispatches to a dynamic route or static file.
 *
 * @param clientAddress The real client address (resolved from PROXY when used).
 */
export async function handleRequest(
  socket: GeminiSocket,
  data: Buffer | string,
  clientAddress: string = socket.remoteAddress ?? 'unknown'
): Promise<void> {
  try {
    // The URL class normalizes the path for us, which also guards against
    // path traversal — no manual normalization needed.
    const url = new URL(data.toString().trim());
    const hostname = url.hostname;
    // Strip all leading slashes: `//` would otherwise leave an absolute path
    // (e.g. `/index.gmi`), escaping the public dir on resolve and 404-ing.
    const pathname = url.pathname.replace(/^\/+/, '');
    const input = url.search.slice(1);

    if (hostname.length > MAX_HOSTNAME_LENGTH) {
      socket.write(`${StatusCode.BAD_REQUEST} Bad Request: Hostname too long\r\n`);
      logger.error(`Rejected hostname (too long): ${url}`);
      return;
    }

    if (!isAllowedDomain(hostname)) {
      socket.write(`${StatusCode.PROXY_REQUEST_REFUSED} Proxy request refused\r\n`);
      logger.error(`Rejected domain: ${url}`);
      return;
    }

    logger.info(`Requested: ${url}, from: ${clientAddress}`);

    // Reserved files are never served directly:
    //  - `+name` route sources (modules/scripts)
    //  - dotfiles (e.g. `.styles.ts`)
    const pathParts = pathname.split('/').filter((p) => p);
    if (pathParts.some((part) => part.startsWith('+') || part.startsWith('.'))) {
      socket.write(`${StatusCode.NOT_FOUND} Not Found\r\n`);
      return;
    }

    // Dynamic routes take precedence over static files.
    const served =
      (await serveDynamicRoute(socket, pathname, input)) ||
      (await serveStaticFile(socket, pathname, input));

    if (!served) {
      socket.write(`${StatusCode.NOT_FOUND} Not Found\r\n`);
      logger.warn(`Not found: ${pathname}`);
    }
  } catch (error) {
    logger.error(`Error processing request: ${error}`);
  } finally {
    socket.end();
  }
}
