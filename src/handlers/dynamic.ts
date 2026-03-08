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

/**
 * Attempts to serve a dynamic route from .ts or .js files.
 */
export async function serveDynamicRoute(socket: Socket | TLSSocket, pathname: string, input: string): Promise<boolean> {
  // Handle directory requests
  if (!pathname.endsWith('.ts')) return false;
  if (pathname.endsWith('/') || pathname === '') pathname = path.join(pathname, 'index.ts');

  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname),  "../../");
  let fullPath = path.resolve(baseDir, config.publicDir, pathname);
  if (!(fs.existsSync(fullPath) && fs.statSync(fullPath).isFile())) {
    logger.warn(`File not found: ${pathname}`);
    return false;
  }
  
  try {
    logger.info(`Dynamic route: ${fullPath}`);
    const module = await import(fullPath);
    const handler = module.default || module.handler;

    if (typeof handler !== 'function') {
      logger.error(`Dynamic route ${fullPath} does not export a function`);
      return false;
    }
    
    const result: string | DynamicRouteResponse = await handler();
    
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
