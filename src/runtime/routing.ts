import fs from 'fs';
import path from 'path';
import { config } from '../config/server.ts';
import { SCRIPT_EXTENSIONS } from './scripts.ts';
import { accept } from './matchers.ts';

/** Extensions imported as ES modules with a handler export. */
export const MODULE_EXTENSIONS = ['.ts', '.js', '.mjs'];

/** All dynamic-route extensions, in resolution priority order. */
export const ROUTE_EXTENSIONS = [...MODULE_EXTENSIONS, ...SCRIPT_EXTENSIONS];

/** Absolute path to the public/ directory. */
const PUBLIC_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../',
  config.publicDir
);

export interface RouteMatch {
  fullPath: string;
  ext: string;
  /** Parameters captured from `[param]` / `[[optional]]` / `[...rest]` segments. */
  params: Record<string, string>;
}

type Params = Record<string, string>;

/**
 * A parsed route segment pattern, from a directory name or a route-file stem.
 * Supports `[param]`, `[[optional]]`, `[...rest]`, each with an optional
 * `=matcher` constraint.
 */
type Pattern =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string; matcher?: string }
  | { kind: 'optional'; name: string; matcher?: string }
  | { kind: 'rest'; name: string; matcher?: string };

function parsePattern(name: string): Pattern {
  let m: RegExpMatchArray | null;
  if ((m = name.match(/^\[\[([^\]=.]+)(?:=([^\].]+))?\]\]$/))) {
    return { kind: 'optional', name: m[1], matcher: m[2] };
  }
  if ((m = name.match(/^\[\.\.\.([^\]=.]+)(?:=([^\].]+))?\]$/))) {
    return { kind: 'rest', name: m[1], matcher: m[2] };
  }
  if ((m = name.match(/^\[([^\]=.]+)(?:=([^\].]+))?\]$/))) {
    return { kind: 'param', name: m[1], matcher: m[2] };
  }
  return { kind: 'literal', value: name };
}

function readDir(dirAbs: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
}

function routeFileExt(name: string): string | null {
  for (const ext of ROUTE_EXTENSIONS) {
    if (name.endsWith(ext)) return ext;
  }
  return null;
}

/**
 * Finds the best-matching route file in a directory.
 * `selectStem` returns the params delta to merge if a file's stem matches, or
 * null otherwise. Files are ranked by extension priority.
 */
function pickFile(
  dirAbs: string,
  entries: fs.Dirent[],
  base: Params,
  selectStem: (pattern: Pattern) => Params | null
): RouteMatch | null {
  let best: RouteMatch | null = null;
  let bestRank = Infinity;

  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('+')) continue;
    const ext = routeFileExt(e.name);
    if (!ext) continue;

    const stem = e.name.slice(1, e.name.length - ext.length);
    const delta = selectStem(parsePattern(stem));
    if (!delta) continue;

    const rank = ROUTE_EXTENSIONS.indexOf(ext);
    if (rank < bestRank) {
      bestRank = rank;
      best = { fullPath: path.join(dirAbs, e.name), ext, params: { ...base, ...delta } };
    }
  }
  return best;
}

const literalFile = (dirAbs: string, entries: fs.Dirent[], base: Params, segment: string) =>
  pickFile(dirAbs, entries, base, (p) =>
    p.kind === 'literal' && p.value === segment ? {} : null
  );

const paramFile = (dirAbs: string, entries: fs.Dirent[], base: Params, segment: string) =>
  pickFile(dirAbs, entries, base, (p) =>
    p.kind === 'param' && accept(p.matcher, segment) ? { [p.name]: segment } : null
  );

const optionalFile = (
  dirAbs: string,
  entries: fs.Dirent[],
  base: Params,
  segment: string // '' means the optional segment is absent
) =>
  pickFile(dirAbs, entries, base, (p) =>
    p.kind === 'optional' && accept(p.matcher, segment) ? { [p.name]: segment } : null
  );

const restFile = (dirAbs: string, entries: fs.Dirent[], base: Params, segments: string[]) => {
  const value = segments.join('/');
  return pickFile(dirAbs, entries, base, (p) =>
    p.kind === 'rest' && accept(p.matcher, value) ? { [p.name]: value } : null
  );
};

/** Terminal route file when no segments remain: index, optional(absent), rest(empty). */
function terminalFile(dirAbs: string, entries: fs.Dirent[], base: Params): RouteMatch | null {
  return (
    pickFile(dirAbs, entries, base, (p) =>
      p.kind === 'literal' && p.value === 'index' ? {} : null
    ) ??
    optionalFile(dirAbs, entries, base, '') ??
    restFile(dirAbs, entries, base, [])
  );
}

interface Candidate {
  childAbs: string;
  segments: string[];
  params: Params;
}

/**
 * Directory candidates to descend into, in specificity order
 * (literal > param > optional > rest). Optional directories yield two branches:
 * consuming the current segment, then consuming nothing.
 */
function dirCandidates(
  dirAbs: string,
  entries: fs.Dirent[],
  segments: string[],
  params: Params
): Candidate[] {
  const seg: string | undefined = segments[0];
  const rest = segments.slice(1);
  const out: Candidate[] = [];

  const dirs = entries.filter((e) => e.isDirectory());
  const byKind = (kind: Pattern['kind']) =>
    dirs.filter((d) => parsePattern(d.name).kind === kind);

  // Literal directories.
  if (seg !== undefined) {
    for (const d of dirs) {
      const p = parsePattern(d.name);
      if (p.kind === 'literal' && p.value === seg) {
        out.push({ childAbs: path.join(dirAbs, d.name), segments: rest, params });
      }
    }
  }

  // [param] directories.
  if (seg !== undefined) {
    for (const d of byKind('param')) {
      const p = parsePattern(d.name) as Extract<Pattern, { kind: 'param' }>;
      if (accept(p.matcher, seg)) {
        out.push({
          childAbs: path.join(dirAbs, d.name),
          segments: rest,
          params: { ...params, [p.name]: seg },
        });
      }
    }
  }

  // [[optional]] directories: consume one segment, then consume zero.
  for (const d of byKind('optional')) {
    const p = parsePattern(d.name) as Extract<Pattern, { kind: 'optional' }>;
    if (seg !== undefined && accept(p.matcher, seg)) {
      out.push({
        childAbs: path.join(dirAbs, d.name),
        segments: rest,
        params: { ...params, [p.name]: seg },
      });
    }
    if (accept(p.matcher, '')) {
      out.push({
        childAbs: path.join(dirAbs, d.name),
        segments,
        params: { ...params, [p.name]: '' },
      });
    }
  }

  // [...rest] directories: consume all remaining segments.
  for (const d of byKind('rest')) {
    const p = parsePattern(d.name) as Extract<Pattern, { kind: 'rest' }>;
    const value = segments.join('/');
    if (accept(p.matcher, value)) {
      out.push({
        childAbs: path.join(dirAbs, d.name),
        segments: [],
        params: { ...params, [p.name]: value },
      });
    }
  }

  return out;
}

/**
 * Directory-route resolution (trailing slash): every segment is matched by a
 * directory, ending in a terminal (index/optional/rest) route file.
 */
function matchDir(dirAbs: string, segments: string[], params: Params): RouteMatch | null {
  const entries = readDir(dirAbs);

  if (segments.length === 0) {
    const terminal = terminalFile(dirAbs, entries, params);
    if (terminal) return terminal;
  }

  for (const cand of dirCandidates(dirAbs, entries, segments, params)) {
    const m = matchDir(cand.childAbs, cand.segments, cand.params);
    if (m) return m;
  }
  return null;
}

/**
 * File-route resolution (no trailing slash): leading segments match
 * directories, and the final segment is matched by a route file. Optional
 * directories may also consume zero segments; rest directories (which end in an
 * index) are reserved for directory mode.
 */
function matchFile(dirAbs: string, segments: string[], params: Params): RouteMatch | null {
  const entries = readDir(dirAbs);

  if (segments.length === 0) {
    return terminalFile(dirAbs, entries, params);
  }

  const [seg, ...rest] = segments;

  if (rest.length === 0) {
    // Final segment: match a route file here (literal > param > optional > rest).
    const file =
      literalFile(dirAbs, entries, params, seg) ??
      paramFile(dirAbs, entries, params, seg) ??
      optionalFile(dirAbs, entries, params, seg) ??
      restFile(dirAbs, entries, params, [seg]);
    if (file) return file;

    // Or descend an optional directory that consumes nothing, and match the
    // file inside it (e.g. `[[lang]]/+about.ts` serving `/about`).
    for (const d of entries) {
      if (!d.isDirectory()) continue;
      const p = parsePattern(d.name);
      if (p.kind === 'optional' && accept(p.matcher, '')) {
        const m = matchFile(path.join(dirAbs, d.name), segments, {
          ...params,
          [p.name]: '',
        });
        if (m) return m;
      }
    }
    return null;
  }

  // Leading segment: descend directories (literal > param > optional). Rest
  // directories are not used here — they belong to directory (slash) routes.
  for (const d of entries) {
    if (d.isDirectory() && parsePattern(d.name).kind === 'literal' && d.name === seg) {
      const m = matchFile(path.join(dirAbs, d.name), rest, params);
      if (m) return m;
    }
  }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const p = parsePattern(d.name);
    if (p.kind === 'param' && accept(p.matcher, seg)) {
      const m = matchFile(path.join(dirAbs, d.name), rest, { ...params, [p.name]: seg });
      if (m) return m;
    }
  }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const p = parsePattern(d.name);
    if (p.kind !== 'optional') continue;
    // Consume one segment, then consume zero.
    if (accept(p.matcher, seg)) {
      const m = matchFile(path.join(dirAbs, d.name), rest, { ...params, [p.name]: seg });
      if (m) return m;
    }
    if (accept(p.matcher, '')) {
      const m = matchFile(path.join(dirAbs, d.name), segments, { ...params, [p.name]: '' });
      if (m) return m;
    }
  }

  // A catch-all route file consumes all remaining segments.
  return restFile(dirAbs, entries, params, segments);
}

/**
 * Resolves a request path to a dynamic route file, SvelteKit-style.
 *
 * A trailing slash (or the root) selects directory routes ending in an index;
 * otherwise the final URL segment is matched against a route file. Both
 * directories and route-file names may use `[param]`, `[[optional]]` and
 * `[...rest]` patterns, each with an optional `=matcher` constraint.
 */
export function matchRoute(pathname: string): RouteMatch | null {
  const directoryMode = pathname === '' || pathname.endsWith('/');
  const segments = pathname.split('/').filter(Boolean);

  const match = directoryMode
    ? matchDir(PUBLIC_ROOT, segments, {})
    : matchFile(PUBLIC_ROOT, segments, {});

  // Defense in depth: never resolve outside the public directory.
  if (
    match &&
    match.fullPath !== PUBLIC_ROOT &&
    !match.fullPath.startsWith(PUBLIC_ROOT + path.sep)
  ) {
    return null;
  }
  return match;
}
