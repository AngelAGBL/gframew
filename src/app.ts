import logger from './config/logger.ts';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

type RouteHandler = () => string;
type Routes = Record<string, RouteHandler>;

interface ServerConfig {
  allowedDomains: string[];
  publicDir: string;
}

const routes: Routes = {};
const config: ServerConfig = {
  allowedDomains: ['localhost', 'example.com'],
  publicDir: './public'
};

/**
 * Registers a handler for a given path.
 */
function route(path: string, handler: RouteHandler): void {
  routes[path] = handler;
}

/**
 * Gets the MIME type for a file based on its extension.
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  // Handle .hbs files by checking the sub-extension
  if (ext === '.hbs') {
    const nameWithoutHbs = filePath.slice(0, -4);
    const subExt = path.extname(nameWithoutHbs).toLowerCase();
    return getMimeType(nameWithoutHbs);
  }
  
  const mimeTypes: Record<string, string> = {
    '.gmi': 'text/gemini',
    '.gemini': 'text/gemini',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Validates if the domain is allowed.
 */
function isAllowedDomain(hostname: string): boolean {
  return config.allowedDomains.includes(hostname);
}

/**
 * Serves a static file from the public directory.
 */
function serveStaticFile(socket: tls.TLSSocket, filePath: string): boolean {
  let safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  
  // Handle directory requests by looking for index.gmi
  if (safePath.endsWith('/') || safePath === '') {
    safePath = path.join(safePath, 'index.gmi');
  }
  
  let fullPath = path.join(config.publicDir, safePath);

  // If file doesn't exist, try with .hbs extension
  if (!fs.existsSync(fullPath)) {
    const hbsPath = fullPath + '.hbs';
    if (fs.existsSync(hbsPath)) {
      fullPath = hbsPath;
    }
  }

  if (!fullPath.startsWith(path.resolve(config.publicDir))) {
    logger.warn(`Path traversal attempt: ${filePath}`);
    return false;
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return false;
  }

  try {
    let content: string | Buffer = fs.readFileSync(fullPath);
    const isHandlebars = fullPath.endsWith('.hbs');
    
    // Process Handlebars templates
    if (isHandlebars) {
      const template = Handlebars.compile(content.toString());
      const context = {
        date: new Date().toISOString(),
        year: new Date().getFullYear(),
        // Add more context variables as needed
      };
      content = template(context);
    }
    
    const mimeType = getMimeType(fullPath);
    socket.write(`20 ${mimeType}\r\n`);
    socket.write(content);
    logger.info(`200: Static file served - ${safePath}${isHandlebars ? ' (rendered)' : ''}`);
    return true;
  } catch (error) {
    logger.error(`Error reading file ${fullPath}: ${error}`);
    return false;
  }
}

/**
 * Validates if the request follows the Gemini protocol format: gemini://{url}{path}\r\n
 */
function isValidGeminiRequest(data: Buffer | string): boolean {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const request = buffer.toString();
  return request.startsWith('gemini://') && request.endsWith('\r\n');
}

/**
 * Handles incoming Gemini protocol requests.
 */
function handleRequest(socket: tls.TLSSocket, data: Buffer | string): void {
  if (!isValidGeminiRequest(data)) {
    logger.warn('Invalid request format - dropping connection');
    socket.destroy();
    return;
  }

  try {
    const url = data.toString().trim();
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const pathname = parsedUrl.pathname;

    if (!isAllowedDomain(hostname)) {
      socket.write('53 Proxy request refused\r\n');
      logger.warn(`Rejected domain: ${hostname}`);
      socket.end();
      return;
    }

    if (routes[pathname]) {
      const body = routes[pathname]();
      socket.write('20 text/gemini\r\n');
      socket.write(body);
      logger.info(`200: ${url}`);
    } else if (serveStaticFile(socket, pathname)) {
      // File served successfully
    } else {
      socket.write('51 Not Found\r\n');
      logger.info(`404: ${url}`);
    }
  } catch (error) {
    logger.error(`Error processing request: ${error}`);
    socket.write('59 Bad Request\r\n');
  } finally {
    socket.end();
  }
}

const server = tls.createServer(
  {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.crt')
  },
  (socket) => {
    socket.once('data', (data) => handleRequest(socket, data));
    
    socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
    });
  }
);


const PORT = 1965;
server.listen(PORT);
logger.info(`Server started on port ${PORT}`);
logger.info(`Allowed domains: ${config.allowedDomains.join(', ')}`);
logger.info(`Serving static files from: ${config.publicDir}`);