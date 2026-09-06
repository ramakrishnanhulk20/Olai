import { pino } from 'pino';

/**
 * Every payment decision is logged, including the ones that refuse to pay, so the
 * ledger and the logs can be read against each other later. Tests run silent by
 * default because their whole job is to trigger these paths on purpose.
 */
export const log = pino({
  name: 'olai.x402',
  level: process.env.OLAI_LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
});
