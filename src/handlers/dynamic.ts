import fs from 'fs';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { StatusCode } from '../constants.ts';
import { isScriptExtension, runScript } from '../runtime/scripts.ts';
import { matchRoute } from '../runtime/routing.ts';
import type {
  DynamicRouteContext,
  DynamicRouteHandler,
  DynamicRouteResponse,
  GeminiSocket,
} from '../types.ts';

// Tracks last-seen modification times so modules are re-imported only on change.
const fileModTimes = new Map<string, number>();

/**
 * Imports the route module, busting the import cache when the file has changed
 * on disk since it was last loaded.
 */
async function loadRouteHandler(fullPath: string): Promise<DynamicRouteHandler | null> {
  const currentMtime = fs.statSync(fullPath).mtimeMs;
  let moduleUrl = fullPath;

  if (fileModTimes.get(fullPath) !== currentMtime) {
    fileModTimes.set(fullPath, currentMtime);
    moduleUrl = `${fullPath}?v=${currentMtime}`;
    logger.info(`File modified, reloading: ${fullPath}`);
  }

  const module = await import(moduleUrl);
  const handler = module.default || module.handler;

  if (typeof handler !== 'function') {
    logger.error(`Dynamic route ${fullPath} does not export a function`);
    return null;
  }

  return handler;
}

/** Normalizes a handler's return value into a full Gemini response. */
function buildResponse(result: string | DynamicRouteResponse): {
  statusCode: number;
  meta: string;
  content: string;
} {
  if (typeof result === 'string') {
    return {
      statusCode: StatusCode.SUCCESS,
      meta: `text/gemini; charset=utf-8; lang=${config.lang}`,
      content: result,
    };
  }

  const mimeType = result.mimeType || 'text/gemini';
  const langSuffix = mimeType === 'text/gemini' ? `; lang=${config.lang}` : '';

  return {
    statusCode: result.statusCode || StatusCode.SUCCESS,
    meta: result.meta || `${mimeType}; charset=utf-8${langSuffix}`,
    content: result.content,
  };
}

/** Serves a route backed by an importable module (`.ts`/`.js`/`.mjs`). */
async function serveModuleRoute(
  fullPath: string,
  context: DynamicRouteContext
): Promise<boolean> {
  const handler = await loadRouteHandler(fullPath);
  if (!handler) return false;

  const result = await handler(context);
  const { statusCode, meta, content } = buildResponse(result);

  context.socket.write(`${statusCode} ${meta}\r\n`);
  context.socket.write(content);
  return true;
}

/** Default response header for a script route that does not set its own. */
const defaultScriptHeader = () =>
  `${StatusCode.SUCCESS} text/gemini; charset=utf-8; lang=${config.lang}`;

/**
 * Splits a script's stdout into an optional Gemini header and a body.
 *
 * If the first line is a valid Gemini status line (`<10-69> [meta]`), the
 * script is taking control of the response header — it is used verbatim and the
 * remainder becomes the body. Otherwise a default `20 text/gemini` header is
 * used and the whole output is the body.
 */
function parseScriptResponse(stdout: string): { header: string; body: string } {
  const newlineIndex = stdout.indexOf('\n');
  // Strip all CR so a script cannot inject extra header lines via the meta.
  const firstLine = (newlineIndex === -1 ? stdout : stdout.slice(0, newlineIndex)).replace(
    /\r/g,
    ''
  );

  if (/^[1-6][0-9]( .*)?$/.test(firstLine)) {
    return {
      header: firstLine,
      body: newlineIndex === -1 ? '' : stdout.slice(newlineIndex + 1),
    };
  }

  return { header: defaultScriptHeader(), body: stdout };
}

/** Serves a route backed by an executable script (`.py`/`.sh`/`.bash`/`.zsh`). */
async function serveScriptRoute(
  ext: string,
  fullPath: string,
  context: DynamicRouteContext
): Promise<boolean> {
  const stdout = await runScript(ext, fullPath, context);
  const { header, body } = parseScriptResponse(stdout);

  context.socket.write(`${header}\r\n`);
  context.socket.write(body);
  return true;
}

/**
 * Attempts to serve a dynamic route resolved from the public directory.
 * Supports SvelteKit-style `[param]` and `[...rest]` patterns in both
 * directory names and route-file names.
 *
 * @returns true if the route was handled, false to fall through to static files.
 */
export async function serveDynamicRoute(
  socket: GeminiSocket,
  pathname: string,
  input: string
): Promise<boolean> {
  const route = matchRoute(pathname);
  if (!route) return false;

  const { fullPath, ext, params } = route;
  const context: DynamicRouteContext = { socket, pathname, input, params };

  try {
    logger.info(`Dynamic route: ${fullPath} ${JSON.stringify(params)}`);
    return isScriptExtension(ext)
      ? await serveScriptRoute(ext, fullPath, context)
      : await serveModuleRoute(fullPath, context);
  } catch (error) {
    logger.error(`Error executing dynamic route ${fullPath}: ${error}`);
    return false;
  }
}
