import { config } from '../config/server.ts';

/**
 * Validates if the domain is allowed.
 */
export function isAllowedDomain(hostname: string): boolean {
  return config.allowedDomains.includes(hostname);
}


/**
 * Validates request buffer for protocol compliance
 * @returns null if valid, error message if invalid
 */
export function validateRequestBuffer(buffer: Buffer): string | null {
  const GEMINI_PROTOCOL = 'gemini://';
  let requestStr: string;

  // Try to decode as UTF-8
  try {
    requestStr = buffer.toString('utf-8');
  } catch (error) {
    return 'Invalid encoding';
  }

  // Check for control characters (except space)
  if (/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/.test(requestStr)) {
    return 'Invalid characters';
  }

  // Validate protocol incrementally as data arrives
  if (requestStr.length > 0 && requestStr.length < GEMINI_PROTOCOL.length) {
    // Check if what we have so far matches the protocol prefix
    if (!GEMINI_PROTOCOL.startsWith(requestStr)) {
      return 'Invalid URL';
    }
  } else if (requestStr.length >= GEMINI_PROTOCOL.length) {
    // We have enough data to check the full protocol
    if (!requestStr.startsWith(GEMINI_PROTOCOL)) {
      return 'Invalid URL';
    }
  }

  return null; // Valid so far
}