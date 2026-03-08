import pino from 'pino';
export default pino({
  level: 'debug',
  base: false,
  timestamp: false
});