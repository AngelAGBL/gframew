export const config = {
  allowedDomains: ['localhost', 'example.com'],
  publicDir: process.env.PUBLIC_DIR || 'public',
  port: process.env.PORT || 1965,
  lang: process.env.LANG || 'es'
};
