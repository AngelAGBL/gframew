import { config } from '../config/server.ts';

/**
 * Validates if the domain is allowed.
 */
export function isAllowedDomain(hostname: string): boolean {
  return config.allowedDomains.includes(hostname);
}

/**
 * Validates if the request follows the Gemini protocol format: gemini://{url}{path}\r\n
 */
export function isValidGeminiRequest(data: Buffer | string): boolean {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const request = buffer.toString();
  return request.startsWith('gemini://') && request.endsWith('\r\n');
}
