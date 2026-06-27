import fs from 'fs';
import path from 'path';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';

/** A route matcher validates a captured segment value. */
export type MatchFn = (value: string) => boolean;

/** Absolute path to the public/ directory. */
const PUBLIC_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../',
  config.publicDir
);

const USER_MATCHERS_FILES = ['.matchers.ts', '.matchers.js', '.matchers.mjs'];

const registry = new Map<string, MatchFn>();

/**
 * Loads developer-defined route matchers from `public/.matchers.ts` (or
 * `.js`/`.mjs`), if present. The module's default export is an object mapping
 * matcher names to predicate functions:
 *
 * ```ts
 * export default {
 *   integer: (value) => /^\d+$/.test(value),
 *   slug: (value) => /^[a-z0-9-]+$/.test(value),
 * };
 * ```
 */
export async function loadMatchers(): Promise<void> {
  for (const file of USER_MATCHERS_FILES) {
    const fullPath = path.resolve(PUBLIC_ROOT, file);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const moduleUrl = `${fullPath}?v=${fs.statSync(fullPath).mtimeMs}`;
      const module = await import(moduleUrl);
      const defs = module.default ?? module.matchers;

      if (!defs || typeof defs !== 'object') {
        logger.warn(`${file} does not export a matchers object; none loaded`);
        return;
      }

      registry.clear();
      for (const [name, fn] of Object.entries(defs)) {
        if (typeof fn === 'function') registry.set(name, fn as MatchFn);
      }
      logger.info(`Loaded ${registry.size} route matcher(s) from ${file}`);
    } catch (error) {
      logger.error(`Error loading route matchers from ${file}: ${error}`);
    }
    return;
  }
}

/**
 * Checks a captured value against an optional matcher.
 * Returns true when no matcher is required; fails closed (and warns) when the
 * referenced matcher is unknown, so misconfigured routes don't match silently.
 */
export function accept(matcher: string | undefined, value: string): boolean {
  if (!matcher) return true;

  const fn = registry.get(matcher);
  if (!fn) {
    logger.warn(`Unknown route matcher '${matcher}' — route will not match`);
    return false;
  }

  try {
    return fn(value);
  } catch (error) {
    logger.error(`Route matcher '${matcher}' threw: ${error}`);
    return false;
  }
}
