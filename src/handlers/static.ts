import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { TLSSocket } from 'tls';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { getMimeType } from '../utils/mime.ts';
import { detectCharset } from '../utils/charset.ts';
import { registerHandlebarsHelpers } from '../utils/styles.ts';
import { getComments, addComment, formatComments } from '../services/comments.ts';

// Register helpers once when module loads
registerHandlebarsHelpers();

function getClientCertificate(socket: TLSSocket): string | null {
  const cert = socket.getPeerCertificate();
  if (cert && Object.keys(cert).length > 0) {
    const cn = cert.subject?.CN;
    if (cn) {
      return Array.isArray(cn) ? cn[0] : cn;
    }
    return cert.fingerprint || 'anonymous';
  }
  return null;
}

/**
 * Serves a static file from the public directory.
 */
export async function serveStaticFile(socket: TLSSocket, filePath: string): Promise<boolean> {
  // Parse URL to extract query parameters
  const urlParts = filePath.split('?');
  const pathname = urlParts[0];
  const queryString = urlParts[1] || '';
  
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '').slice(1);
  
  // Handle directory requests by looking for index.gmi
  if (safePath.endsWith('/') || safePath === '') {
    safePath = path.join(safePath, 'index.gmi');
  }
  
  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  let fullPath = path.resolve(baseDir, "../../" + config.publicDir, safePath);
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

  // Handle comment functionality for .gmi files
  if (safePath.endsWith('.gmi') && queryString) {
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    
    // Only process comments if the file contains {{comments}} tag
    if (fileContent.includes('{{comments}}')) {
      const clientCert = getClientCertificate(socket);
      
      // Handle comment submission (any query parameter that's not "comment")
      if (queryString !== 'comment') {
        if (!clientCert) {
          socket.write('60 Certificate needed\r\n');
          socket.end();
          return true;
        }
        
        // Save the comment to MongoDB
        const commentText = decodeURIComponent(queryString);
        await addComment(safePath, clientCert, commentText);
        
        // Redirect to original file
        socket.write(`30 ${pathname}\r\n`);
        socket.end();
        return true;
      }
      
      // Handle comment form request (?comment)
      if (queryString === 'comment') {
        if (!clientCert) {
          socket.write('60 Certificate needed\r\n');
          socket.end();
          return true;
        }
        
        socket.write('10 Escribe tu comentario\r\n');
        socket.end();
        return true;
      }
    }
  }

  try {
    let content: string | Buffer = fs.readFileSync(fullPath);
    const isHandlebars = fullPath.endsWith('.hbs') || fullPath.endsWith('.gmi');
    
    // Process Handlebars templates
    if (isHandlebars) {
      const contentStr = content.toString();
      
      // Load comments if the template contains {{comments}}
      let commentsHtml = '';
      if (contentStr.includes('{{comments}}')) {
        const comments = await getComments(safePath);
        commentsHtml = formatComments(comments);
      }
      
      const template = Handlebars.compile(contentStr);
      const context = {
        date: new Date().toISOString(),
        year: new Date().getFullYear(),
        comments: commentsHtml
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
