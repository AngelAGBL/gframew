export const config = {
  allowedDomains: process.env.DOMAINS ? process.env.DOMAINS.split(',').map(d => d.trim()) : ['localhost'],
  publicDir: process.env.PUBLIC_DIR || 'public',
  port: process.env.PORT || 1965,
  lang: process.env.LANGUAGE || 'en'
};
