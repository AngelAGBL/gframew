import fs from 'fs';
import path from 'path';
import type { TLSSocket } from 'tls';
import type { Socket } from 'net';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';

export interface DynamicRouteResponse {
  content: string;
  mimeType?: string;
  statusCode?: number;
  meta?: string;
}

export interface DynamicRouteContext {
  socket: Socket | TLSSocket;
  pathname: string;
  input: string;
}

// Cache for file modification times to detect changes
const fileModTimes = new Map<string, number>();

/**
 * Attempts to serve a dynamic route from +pagina.ts files.
 * URLs like /pagina map to files named +pagina.ts
 * URLs like /pagina.gmi map to files named +pagina.gmi.ts
 */
export async function serveDynamicRoute(socket: Socket | TLSSocket, pathname: string, input: string): Promise<boolean> {
  if (pathname.endsWith('/') || pathname === '') {
    pathname = path.join(pathname, 'index');
  }

  const pathParts = pathname.split('/').filter(p => p);
  const lastIndex = pathParts.length - 1;

  // Add + prefix and .ts extension, preserving any existing extensions
  // e.g., page -> +page.ts, page.gmi -> +page.gmi.ts
  pathParts[lastIndex] = '+' + pathParts[lastIndex] + '.ts';

  const filePath = pathParts.join('/');

  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
  const fullPath = path.resolve(baseDir, config.publicDir, filePath);

  if (!(fs.existsSync(fullPath) && fs.statSync(fullPath).isFile())) {
    return false;
  }

  try {
    logger.info(`Dynamic route: ${fullPath}`);

    // Check file modification time to detect changes
    const stats = fs.statSync(fullPath);
    const currentMtime = stats.mtimeMs;
    const cachedMtime = fileModTimes.get(fullPath);

    // Only use cache busting if file has been modified
    let moduleUrl = fullPath;
    if (cachedMtime !== currentMtime) {
      fileModTimes.set(fullPath, currentMtime);
      moduleUrl = `${fullPath}?v=${currentMtime}`;
      logger.info(`File modified, reloading: ${fullPath}`);
    }

    const module = await import(moduleUrl);
    const handler = module.default || module.handler;

    if (typeof handler !== 'function') {
      logger.error(`Dynamic route ${fullPath} does not export a function`);
      return false;
    }

    // Pass context with socket access to the handler
    const context: DynamicRouteContext = {
      socket,
      pathname,
      input
    };

    let result: string | DynamicRouteResponse;

    result = await handler(context);

    // Process the result
    let content: string;
    let mimeType: string;
    let statusCode: number;
    let meta: string;

    if (typeof result === 'string') {
      content = result;
      mimeType = 'text/gemini';
      statusCode = 20;
      meta = `${mimeType}; charset=utf-8; lang=${config.lang}`;
    } else {
      content = result.content;
      mimeType = result.mimeType || 'text/gemini';
      statusCode = result.statusCode || 20;
      meta = result.meta || `${mimeType}; charset=utf-8${mimeType === 'text/gemini' ? `; lang=${config.lang}` : ''}`;
    }

    socket.write(`${statusCode} ${meta}\r\n`);
    socket.write(content);

    return true;
  } catch (error) {
    logger.error(`Error executing dynamic route ${fullPath}: ${error}`);
    return false;
  }
}
