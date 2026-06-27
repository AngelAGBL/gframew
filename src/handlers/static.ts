import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { StatusCode } from '../constants.ts';
import { getMimeType } from '../utils/mime.ts';
import { detectCharset } from '../utils/charset.ts';
import { getClientCertificate } from '../utils/certificate.ts';
import { registerHandlebarsHelpers } from '../templates/handlebars.ts';
import { getComments, addComment, formatComments } from '../services/comments.ts';
import type { GeminiSocket } from '../types.ts';

// Register Handlebars helpers once when this module loads.
registerHandlebarsHelpers();

/** Absolute path to the public/ directory. */
const PUBLIC_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../',
  config.publicDir
);

/** Template tag that opts a page into the comments system. */
const COMMENTS_TAG = '{{{comments}}}';

/** Guards against path traversal escaping the public directory. */
function isInsidePublic(fullPath: string): boolean {
  return fullPath === PUBLIC_ROOT || fullPath.startsWith(PUBLIC_ROOT + path.sep);
}

interface ResolvedFile {
  fullPath: string;
  /** Path used for comment lookups; updated when a `+page.gmi` is matched. */
  pathname: string;
}

/**
 * Resolves a request path to a file on disk, trying in order:
 *   1. `+page.gmi` (template with priority)
 *   2. the literal file
 *   3. the literal file with a `.hbs` extension
 *
 * @returns The resolved file, or null when nothing matches.
 */
function resolveStaticFile(pathname: string): ResolvedFile | null {
  if (pathname.endsWith('/') || pathname === '') {
    pathname = path.join(pathname, 'index.gmi');
  }

  // 1. Try +page.gmi (highest priority).
  const cleanPath = pathname.replace(/\.(gmi|hbs)$/, '');
  const pathParts = cleanPath.split('/').filter((p) => p);
  const lastIndex = pathParts.length - 1;
  pathParts[lastIndex] = '+' + pathParts[lastIndex] + '.gmi';
  const plusFilePath = pathParts.join('/');
  const plusFullPath = path.resolve(PUBLIC_ROOT, plusFilePath);

  if (
    isInsidePublic(plusFullPath) &&
    fs.existsSync(plusFullPath) &&
    fs.statSync(plusFullPath).isFile()
  ) {
    return { fullPath: plusFullPath, pathname: '/' + plusFilePath };
  }

  // 2. Try the literal file, then 3. the same path with `.hbs`.
  let fullPath = path.resolve(PUBLIC_ROOT, pathname);
  if (!fs.existsSync(fullPath) && fs.existsSync(fullPath + '.hbs')) {
    fullPath = fullPath + '.hbs';
  }

  if (!isInsidePublic(fullPath) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return null;
  }

  return { fullPath, pathname };
}

/**
 * Handles comment interactions for comment-enabled `.gmi` pages.
 *
 * @param commentKey     Stable key for storing/loading comments (resolved path).
 * @param redirectTarget Original request path to redirect back to after posting.
 * @param fileContent    The already-read file content, to avoid a second read.
 * @returns true if a response was written (and the socket should be closed),
 *          false to continue serving the page normally.
 */
async function handleCommentInteraction(
  socket: GeminiSocket,
  commentKey: string,
  redirectTarget: string,
  input: string,
  fileContent: string
): Promise<boolean> {
  if (!commentKey.endsWith('.gmi') || !input) return false;
  if (!fileContent.includes(COMMENTS_TAG)) return false;

  const clientCert = getClientCertificate(socket);
  if (!clientCert) {
    socket.write(`${StatusCode.CLIENT_CERTIFICATE_REQUIRED} Certificate needed\r\n`);
    socket.end();
    return true;
  }

  // `?input` requests the comment-entry prompt.
  if (input === 'input') {
    socket.write(`${StatusCode.INPUT} Escribe tu comentario\r\n`);
    socket.end();
    return true;
  }

  // Any other query string is a submitted comment.
  let commentText: string;
  try {
    commentText = decodeURIComponent(input);
  } catch {
    socket.write(`${StatusCode.BAD_REQUEST} Bad Request: malformed input\r\n`);
    socket.end();
    return true;
  }

  const saved = await addComment(commentKey, clientCert, commentText);
  if (!saved) {
    socket.write(`${StatusCode.TEMPORARY_FAILURE} Could not save comment, try again\r\n`);
    socket.end();
    return true;
  }

  // Redirect back to the original (clean) request path.
  socket.write(`${StatusCode.REDIRECT_TEMPORARY} /${redirectTarget}\r\n`);
  socket.end();
  return true;
}

/**
 * Renders file content, processing it as a Handlebars template for `.gmi`/`.hbs`
 * files and injecting comments when the page opts in.
 */
async function renderContent(
  fullPath: string,
  pathname: string,
  rawContent: Buffer,
  isTemplate: boolean
): Promise<string | Buffer> {
  if (!isTemplate) return rawContent;

  const contentStr = rawContent.toString('utf-8');

  let commentsHtml = '';
  if (contentStr.includes(COMMENTS_TAG)) {
    commentsHtml = formatComments(await getComments(pathname));
  }

  try {
    const template = Handlebars.compile(contentStr);
    return template({
      date: new Date().toISOString(),
      year: new Date().getFullYear(),
      comments: commentsHtml,
    });
  } catch (error) {
    logger.error(`Handlebars compilation error in ${fullPath}: ${error}`);
    return contentStr; // Serve raw content as a last resort.
  }
}

/** Builds the Gemini content-type meta string for a response. */
function buildContentType(mimeType: string, buffer: Buffer): string {
  let contentType = mimeType;
  const charset = detectCharset(buffer, mimeType);
  if (charset) contentType += `; charset=${charset}`;
  if (mimeType === 'text/gemini') contentType += `; lang=${config.lang}`;
  return contentType;
}

/**
 * Serves a static file from the public directory, with `+page.gmi` priority,
 * Handlebars templating, and the comments system.
 *
 * @returns true if the request was handled, false to fall through to a 51.
 */
export async function serveStaticFile(
  socket: GeminiSocket,
  pathname: string,
  input: string
): Promise<boolean> {
  const originalPathname = pathname;
  const resolved = resolveStaticFile(pathname);
  if (!resolved) return false;

  const { fullPath } = resolved;
  const commentKey = resolved.pathname;

  let rawContent: Buffer;
  try {
    rawContent = fs.readFileSync(fullPath);
  } catch (error) {
    logger.error(`Error reading file ${fullPath}: ${error}`);
    return false;
  }

  const isTemplate = fullPath.endsWith('.hbs') || fullPath.endsWith('.gmi');

  // Comment interactions only apply to comment-enabled .gmi templates.
  if (
    isTemplate &&
    (await handleCommentInteraction(
      socket,
      commentKey,
      originalPathname,
      input,
      rawContent.toString('utf-8')
    ))
  ) {
    return true;
  }

  try {
    const rendered = await renderContent(fullPath, commentKey, rawContent, isTemplate);
    const buffer = typeof rendered === 'string' ? Buffer.from(rendered, 'utf-8') : rendered;

    const mimeType = getMimeType(fullPath);
    const contentType = buildContentType(mimeType, buffer);

    socket.write(`${StatusCode.SUCCESS} ${contentType}\r\n`);
    socket.write(buffer);

    return true;
  } catch (error) {
    logger.error(`Error serving file ${fullPath}: ${error}`);
    return false;
  }
}
