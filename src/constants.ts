/**
 * Gemini protocol response status codes.
 * See: https://geminiprotocol.net/docs/protocol-specification.gmi
 */
export const StatusCode = {
  INPUT: 10,
  SUCCESS: 20,
  REDIRECT_TEMPORARY: 30,
  TEMPORARY_FAILURE: 40,
  NOT_FOUND: 51,
  PROXY_REQUEST_REFUSED: 53,
  BAD_REQUEST: 59,
  CLIENT_CERTIFICATE_REQUIRED: 60,
} as const;

/** Gemini request scheme. */
export const GEMINI_PROTOCOL = 'gemini://';

/** A request line is `gemini://` plus at least one more character. */
export const MIN_VALID_REQUEST_LENGTH = GEMINI_PROTOCOL.length + 1;

/** Gemini protocol: max 1024 bytes URL + trailing `\r\n`. */
export const MAX_REQUEST_SIZE = 1026;

/** Idle timeout for a single request, in milliseconds. */
export const REQUEST_TIMEOUT = 30_000;

/** Maximum allowed hostname length. */
export const MAX_HOSTNAME_LENGTH = 255;

/** PROXY protocol limits and markers. */
export const PROXY_V1_PREFIX = 'PROXY ';
export const PROXY_V2_SIGNATURE = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);
export const MAX_PROXY_V1_SIZE = 108;
export const MAX_PROXY_V2_SIZE = 512;

/** Dynamic script-route execution limits (DoS protection). */
export const SCRIPT_TIMEOUT = 10_000;
export const SCRIPT_MAX_BUFFER = 2 * 1024 * 1024; // 2 MiB of captured stdout.
