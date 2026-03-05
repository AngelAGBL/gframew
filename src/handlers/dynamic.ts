import fs from 'fs';
import path from 'path';
import type { TLSSocket } from 'tls';
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
export async function serveDynamicRoute(socket: TLSSocket, pathname: string): Promise<boolean> {
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '').slice(1);
  
  // Handle directory requests
  if (safePath.endsWith('/') || safePath === '') {
    safePath = path.join(safePath, 'index.ts');
  }

  if (!(safePath.endsWith('.ts') || safePath.endsWith('.js'))) return false;

  // Remove leading slash if present
  if (safePath.startsWith('/')) safePath = safePath.slice(1);
  
  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const routesDir = path.resolve(baseDir, "../../" + config.publicDir);
  
  let routeFile: string | null = null;
  const testPath = path.resolve(routesDir, safePath);
  if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) routeFile = testPath;
  if (!routeFile) return false;
  
  try {
    logger.info(`→ Dynamic route: ${routeFile}`);
    
    // Import the module dynamically
    const module = await import(routeFile);
    
    // Look for default export or handler function
    const handler = module.default || module.handler;
    
    if (typeof handler !== 'function') {
      logger.error(`Dynamic route ${routeFile} does not export a function`);
      return false;
    }
    
    // Execute the handler
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
    
    const fileSize = Buffer.byteLength(content);
    logger.info(`✓ Dynamic route served: ${routeFile} [${meta}] ${fileSize} bytes`);
    
    return true;
  } catch (error) {
    logger.error(`Error executing dynamic route ${routeFile}: ${error}`);
    return false;
  }
}
