import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import logger from '../config/logger.ts';
import { config } from '../config/server.ts';
import { ANSI, parseAnsiStyles, transformUnicode } from '../utils/styles.ts';

/** Absolute path to the public/ directory, resolved from this module. */
const PUBLIC_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../',
  config.publicDir
);

/** Resolves a (possibly leading-slash) URL path to an absolute file path. */
const resolvePublicPath = (url: string): string =>
  path.resolve(PUBLIC_DIR, url.startsWith('/') ? url.slice(1) : url);

const splitStyles = (styles: string): string[] => styles.split(' ').map((s) => s.trim());

/**
 * Renders a list of links as Gemini link lines, sorted newest-first.
 */
const renderSortedLinks = (
  links: Array<{ url: string; name: string; time: Date }>
): string =>
  links
    .slice()
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .map((link) => `=> ${link.url} ${link.name} (${link.time.toDateString()})`)
    .join('\n');

export function registerHandlebarsHelpers(): void {
  /**
   * ANSI styling helper.
   * Usage: {{#ansi "bold f#ff0000"}}text{{/ansi}}
   */
  Handlebars.registerHelper('ansi', function (this: any, styles: string, options) {
    const codes = parseAnsiStyles(splitStyles(styles));
    return new Handlebars.SafeString(codes + options.fn(this) + ANSI.reset);
  });

  /**
   * Unicode styling helper.
   * Usage: {{#unicode "bold"}}text{{/unicode}}
   */
  Handlebars.registerHelper('unicode', function (this: any, styles: string, options) {
    const transformed = transformUnicode(options.fn(this), splitStyles(styles));
    return new Handlebars.SafeString(transformed);
  });

  /**
   * Renders explicit links sorted by file modification time (newest first).
   *
   * Each argument is a `"url,name"` pair, e.g.
   * {{{sortLinks "/doc.gmi,Doc" "/page.gmi,Page"}}}
   */
  Handlebars.registerHelper('sortLinks', function (...args: any[]) {
    const inputs = args.slice(0, -1); // Drop the Handlebars options object.
    if (inputs.length === 0) return '';

    try {
      const links = [];
      for (const pair of inputs) {
        const [url, name] = pair.split(',').map((s: string) => s.trim());
        if (!url || !name) continue;

        const filePath = resolvePublicPath(url);
        const time = fs.existsSync(filePath) ? fs.statSync(filePath).mtime : new Date(0);
        links.push({ url, name, time });
      }

      return new Handlebars.SafeString(renderSortedLinks(links));
    } catch (error) {
      logger.error(`Error in sortLinks helper: ${error}`);
      return '';
    }
  });

  /**
   * Lists `.gmi` files from a directory as Gemini links, newest first.
   * Usage: {{{listGmiFiles "posts" "posts/index.gmi"}}}
   *
   * @param directory   Directory path relative to public/.
   * @param currentFile Optional file to exclude from the listing.
   */
  Handlebars.registerHelper(
    'listGmiFiles',
    function (directory: string, currentFile?: string) {
      try {
        const dirPath = path.resolve(PUBLIC_DIR, directory);
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
          return '';
        }

        const isExcluded = (file: string): boolean => {
          if (file === 'index.gmi') return true;
          if (!currentFile) return false;
          const filePath = path.join(directory, file);
          return filePath === currentFile || file === currentFile;
        };

        const links = fs
          .readdirSync(dirPath)
          .filter((file) => file.endsWith('.gmi') && !isExcluded(file))
          .map((file) => ({
            url: '/' + path.join(directory, file).replace(/\\/g, '/'),
            name: file.replace(/\.gmi$/, ''),
            time: fs.statSync(path.join(dirPath, file)).birthtime,
          }));

        return new Handlebars.SafeString(renderSortedLinks(links));
      } catch (error) {
        logger.error(`Error listing .gmi files from ${directory}: ${error}`);
        return '';
      }
    }
  );
}

/** Candidate filenames for the developer-defined helpers module. */
const USER_STYLES_FILES = ['.styles.ts', '.styles.js', '.styles.mjs'];

/**
 * Loads developer-defined Handlebars helpers from `public/.styles.ts` (or
 * `.js`/`.mjs`), if present. The module's default export receives the shared
 * Handlebars instance and registers helpers on it:
 *
 * ```ts
 * export default function (handlebars) {
 *   handlebars.registerHelper('shout', (s) => String(s).toUpperCase());
 * }
 * ```
 */
export async function registerUserHelpers(): Promise<void> {
  for (const file of USER_STYLES_FILES) {
    const fullPath = path.resolve(PUBLIC_DIR, file);
    if (!fs.existsSync(fullPath)) continue;

    try {
      // Cache-bust on mtime so edits are picked up across restarts/reloads.
      const moduleUrl = `${fullPath}?v=${fs.statSync(fullPath).mtimeMs}`;
      const module = await import(moduleUrl);
      const register = module.default ?? module.register;

      if (typeof register !== 'function') {
        logger.warn(`${file} does not export a function; no custom helpers loaded`);
        return;
      }

      register(Handlebars);
      logger.info(`Loaded custom Handlebars helpers from ${file}`);
    } catch (error) {
      logger.error(`Error loading custom helpers from ${file}: ${error}`);
    }
    return;
  }
}
