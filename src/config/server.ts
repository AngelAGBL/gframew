export const config = {
  allowedDomains: process.env.DOMAINS
    ? process.env.DOMAINS.split(',').map((d) => d.trim())
    : ['localhost'],
  publicDir: process.env.PUBLIC_DIR || 'public',
  port: process.env.PORT || 1965,
  lang: process.env.LANGUAGE || 'en',
  proxyEnabled: process.env.PROXY === 'true',
  /** IANA timezone for log timestamps (e.g. "America/Mexico_City"). */
  logTimezone: process.env.LOG_TIMEZONE || process.env.TZ || 'UTC',
  tls: {
    keyPath: process.env.TLS_KEY || 'server.key',
    certPath: process.env.TLS_CERT || 'server.crt',
  },
};
