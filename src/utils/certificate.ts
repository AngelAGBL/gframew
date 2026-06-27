import logger from '../config/logger.ts';
import type { GeminiSocket } from '../types.ts';

/**
 * Extracts a stable identifier for the client from its TLS certificate.
 * Prefers the subject Common Name, falling back to the fingerprint.
 *
 * @returns The identifier, or null when no client certificate is present.
 */
export function getClientCertificate(socket: GeminiSocket): string | null {
  if (typeof socket.getPeerCertificate !== 'function') {
    logger.debug('No TLS connection, no client certificate available');
    return null;
  }

  const cert = socket.getPeerCertificate();

  if (!cert || Object.keys(cert).length === 0) {
    logger.debug('No client certificate provided');
    return null;
  }

  logger.debug(
    `Client certificate: ${JSON.stringify({
      subject: cert.subject,
      fingerprint: cert.fingerprint,
      valid_from: cert.valid_from,
      valid_to: cert.valid_to,
    })}`
  );

  if (cert.subject?.CN) {
    const cn = cert.subject.CN;
    return Array.isArray(cn) ? cn[0] : cn;
  }

  return cert.fingerprint || null;
}
