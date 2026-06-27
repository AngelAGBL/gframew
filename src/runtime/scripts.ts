import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { config } from '../config/server.ts';
import { SCRIPT_MAX_BUFFER, SCRIPT_TIMEOUT } from '../constants.ts';
import { getClientCertificate } from '../utils/certificate.ts';
import type { DynamicRouteContext } from '../types.ts';

const execFileAsync = promisify(execFile);

/** Absolute path to the public/ directory (script working directory). */
const PUBLIC_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../',
  config.publicDir
);

/** Maps a script extension to the interpreter used to run it. */
const INTERPRETERS: Record<string, string> = {
  '.py': 'python3',
  '.sh': 'sh',
  '.bash': 'bash',
  '.zsh': 'zsh',
};

/** Extensions handled by running an external interpreter. */
export const SCRIPT_EXTENSIONS = Object.keys(INTERPRETERS);

export function isScriptExtension(ext: string): boolean {
  return ext in INTERPRETERS;
}

/** Sanitizes a route param name into a valid environment variable suffix. */
const envParamName = (name: string): string =>
  'GEMINI_PARAM_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

/**
 * Executes a dynamic-route script and returns its stdout.
 *
 * The script is run via execFile (no shell), with a timeout, a bounded output
 * buffer, and a minimal environment to avoid leaking server secrets. Request
 * details — including captured route params — are exposed through `GEMINI_*`
 * environment variables. The script may set the Gemini response header by
 * printing it as its first line (see the dynamic-route handler).
 */
export async function runScript(
  ext: string,
  fullPath: string,
  context: DynamicRouteContext
): Promise<string> {
  const interpreter = INTERPRETERS[ext];
  if (!interpreter) {
    throw new Error(`No interpreter registered for ${ext}`);
  }

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    GEMINI_PATHNAME: context.pathname,
    GEMINI_INPUT: context.input,
    GEMINI_REMOTE_ADDR: context.socket.remoteAddress ?? '',
    GEMINI_CLIENT_CERT: getClientCertificate(context.socket) ?? '',
    GEMINI_PARAMS: JSON.stringify(context.params),
  };

  // Expose each captured route param individually for convenience.
  for (const [name, value] of Object.entries(context.params)) {
    env[envParamName(name)] = value;
  }

  const { stdout } = await execFileAsync(interpreter, [fullPath], {
    cwd: PUBLIC_ROOT,
    env,
    timeout: SCRIPT_TIMEOUT,
    maxBuffer: SCRIPT_MAX_BUFFER,
    windowsHide: true,
  });

  return stdout;
}
