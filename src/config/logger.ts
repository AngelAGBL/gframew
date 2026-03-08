import pino from 'pino';
export default pino({
  level: 'info',
  base: false,
  timestamp: false
});