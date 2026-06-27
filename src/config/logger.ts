import pino from 'pino';
import { config } from './server.ts';

/** Builds a timestamp formatter, falling back to UTC on an invalid timezone. */
function createTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  try {
    // `sv-SE` yields an ISO-like, locale-stable "YYYY-MM-DD HH:mm:ss".
    return new Intl.DateTimeFormat('sv-SE', { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat('sv-SE', { ...options, timeZone: 'UTC' });
  }
}

const timeFormatter = createTimeFormatter(config.logTimezone);

export default pino({
  level: 'info',
  base: false,
  timestamp: () => `,"time":"${timeFormatter.format(new Date())} ${config.logTimezone}"`,
});
