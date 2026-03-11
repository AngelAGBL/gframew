import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { TLSSocket } from 'tls';
import type { Socket } from 'net';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { getMimeType } from '../utils/mime.ts';
import { detectCharset } from '../utils/charset.ts';
import { registerHandlebarsHelpers } from '../utils/helpers.ts';
import { getComments, addComment, formatComments } from '../services/comments.ts';

// Register helpers once when module loads
registerHandlebarsHelpers();

function getClientCertificate(socket: Socket | TLSSocket): string | null {
  // Check if socket is a TLSSocket
  if (!('getPeerCertificate' in socket)) {
    logger.info('No TLS connection, no client certificate available');
    return null;
  }

  const cert = socket.getPeerCertificate();

  // Check if certificate exists and is not empty
  if (!cert || Object.keys(cert).length === 0) {
    logger.info('No client certificate provided');
    return null;
  }

  logger.info(`Client certificate: ${JSON.stringify({
    subject: cert.subject,
    fingerprint: cert.fingerprint,
    valid_from: cert.valid_from,
    valid_to: cert.valid_to
  })}`);

  // Try to get Common Name from subject
  if (cert.subject?.CN) {
    const cn = cert.subject.CN;
    return Array.isArray(cn) ? cn[0] : cn;
  }

  // Fallback to fingerprint
  if (cert.fingerprint) {
    return cert.fingerprint;
  }

  return null;
}

/**
 * Serves a static file from the public directory.
 * First tries to find +pagina.gmi files, then falls back to regular files.
 */
export async function serveStaticFile(socket: Socket | TLSSocket, pathname: string, input : string): Promise<boolean> {
  if (pathname.endsWith('/') || pathname === '') {
    pathname = path.join(pathname, 'index.gmi');
  }

  // Construir ruta absoluta desde el directorio del archivo actual
  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");

  // First, try to find +pagina.gmi (priority)
  let fullPath: string | null = null;
  let originalPathname = pathname;

  // Try +pagina.gmi first
  const cleanPath = pathname.replace(/\.(gmi|hbs)$/, '');
  const pathParts = cleanPath.split('/').filter(p => p);

  const lastIndex = pathParts.length - 1;
  pathParts[lastIndex] = '+' + pathParts[lastIndex] + '.gmi';
  const plusFilePath = pathParts.join('/');
  const plusFullPath = path.resolve(baseDir, config.publicDir, plusFilePath);

  if (fs.existsSync(plusFullPath) && fs.statSync(plusFullPath).isFile()) {
    fullPath = plusFullPath;
    pathname = '/' + plusFilePath; // Update pathname for comment handling
  }

  // If +pagina.gmi not found, try regular file
  if (!fullPath) {
    fullPath = path.resolve(baseDir, config.publicDir, originalPathname);
    pathname = originalPathname;

    // If file doesn't exist, try with .hbs extension
    if (!fs.existsSync(fullPath)) {
      const hbsPath = fullPath + '.hbs';
      if (fs.existsSync(hbsPath)) {
        fullPath = hbsPath;
      }
    }
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return false;
  }

  // Handle comment functionality for .gmi files
  if (pathname.endsWith('.gmi') && input) {
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    if (fileContent.includes('{{{comments}}}')) {
      const clientCert = getClientCertificate(socket);

      // Handle comment submission (any query parameter that's not "input")
      if (input !== 'input') {
        if (!clientCert) {
          socket.write('60 Certificate needed\r\n');
          socket.end();
          return true;
        }

        // Save the comment to MongoDB
        const commentText = decodeURIComponent(input);
        await addComment(pathname, clientCert, commentText);

        // Redirect to original file, removing index.gmi if present
        let redirectPath = pathname;
        if (redirectPath.endsWith('index.gmi')) redirectPath = redirectPath.slice(0, -9);
        socket.write(`30 /${redirectPath}\r\n`);
        socket.end();
        return true;
      }

      // Handle comment form request (?input)
      if (input === 'input') {
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
      if (contentStr.includes('{{{comments}}}')) {
        const comments = await getComments(pathname);
        commentsHtml = formatComments(comments);
      }

      try {
        const template = Handlebars.compile(contentStr);
        const context = {
          date: new Date().toISOString(),
          year: new Date().getFullYear(),
          comments: commentsHtml
        };
        content = template(context);
      } catch (error) {
        logger.error(`Handlebars compilation error in ${fullPath}: ${error}`);
        content = contentStr; // Serve raw content as last resort
      }
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
