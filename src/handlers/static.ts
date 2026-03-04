import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { TLSSocket } from 'tls';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { getMimeType } from '../utils/mime.ts';
import { detectCharset } from '../utils/charset.ts';
import { registerHandlebarsHelpers } from '../utils/styles.ts';

// Register helpers once when module loads
registerHandlebarsHelpers();

/**
 * Serves a static file from the public directory.
 */
export async function serveStaticFile(socket: TLSSocket, filePath: string): Promise<boolean> {
  let safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '').slice(1);
  
  // Handle directory requests by looking for index.gmi
  if (safePath.endsWith('/') || safePath === '') {
    safePath = path.join(safePath, 'index.gmi');
  }
  
  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  let fullPath = path.resolve(baseDir, "../" + config.publicDir, safePath);
  const originalPath = fullPath;

  // If file doesn't exist, try with .hbs extension
  if (!fs.existsSync(fullPath)) {
    const hbsPath = fullPath + '.hbs';
    if (fs.existsSync(hbsPath)) {
      fullPath = hbsPath;
    }
  }
  
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    logger.warn(`File not found: ${safePath}`);
    return false;
  }

  try {
    let content: string | Buffer = fs.readFileSync(fullPath);
    const isHandlebars = fullPath.endsWith('.hbs') || fullPath.endsWith('.gmi');
    
    // Process Handlebars templates
    if (isHandlebars) {
      const template = Handlebars.compile(content.toString());
      const context = {
        date: new Date().toISOString(),
        year: new Date().getFullYear(),
      };
      content = template(context);
    }
    
    const mimeType = getMimeType(fullPath);
    const buffer = Buffer.from(content);
    const charset = detectCharset(buffer, mimeType);
    
    let contentType = mimeType;
    if (charset) contentType += `; charset=${charset}`;
    if (mimeType === 'text/gemini') contentType += `; lang=${config.lang}`;
    socket.write(`20 ${contentType}\r\n`);
    socket.write(buffer);

    return true;
  } catch (error) {
    logger.error(`Error reading file ${fullPath}: ${error}`);
    return false;
  }
}
