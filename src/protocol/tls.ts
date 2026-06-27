import fs from 'fs';
import { config } from '../config/server.ts';

/**
 * TLS options for the Gemini server.
 *
 * `requestCert` enables optional client certificates (mTLS), and
 * `rejectUnauthorized` is false because Gemini uses TOFU-style certs that are
 * not validated against a CA.
 */
export const TLS_OPTIONS = {
  key: fs.readFileSync(config.tls.keyPath),
  cert: fs.readFileSync(config.tls.certPath),
  requestCert: true,
  rejectUnauthorized: false,
};
