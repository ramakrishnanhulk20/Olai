import { pino } from 'pino';

/**
 * The API log. Every refused token and every rate-limit hit is written here
 * with the caller's address, because those two lines are the only warning the
 * owner gets that somebody is trying the door. Tests run silent, since their
 * job is to trigger exactly those paths on purpose.
 */
export const log = pino({
  name: 'olai.api',
  level: process.env.OLAI_LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
});
