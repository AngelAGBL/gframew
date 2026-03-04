import type { ServerConfig } from '../types.ts';

export const config: ServerConfig = {
  allowedDomains: ['localhost', 'example.com'],
  publicDir: 'public',
  port: 1965,
  lang: 'es'
};
