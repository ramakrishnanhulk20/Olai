import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { BootError, buildService, log } from './boot.js';
import { type Config, loadConfig } from './config.js';

/**
 * Olai, started.
 *
 * Two ways to fail on purpose live here: a setting Ram has to fix, and a state
 * Olai refuses to run in (live mode with no Binance connection). Both print one
 * readable line and exit 1, because a stack trace tells him nothing he can act on.
 */

/**
 * On a developer's machine the settings live in the repo's .env, so `npm run dev`
 * must see the same file the scripts do. A real host injects environment
 * variables and simply has no file here to load.
 */
function loadEnvFile(): void {
  const candidates = [fileURLToPath(new URL('../../../.env', import.meta.url)), '.env'];
  for (const path of candidates) {
    if (existsSync(path) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(path);
      return;
    }
  }
}

function readConfigOrStop(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
  }
}

loadEnvFile();
const config = readConfigOrStop();

const service = await buildService(config).catch((error: unknown) => {
  if (error instanceof BootError) {
    log.error(error.message);
  } else {
    log.error({ err: error }, 'Olai could not start');
  }
  return process.exit(1);
});

const server = serve({ fetch: service.app.fetch, port: config.OLAI_PORT }, (info) => {
  log.info(
    { port: info.port, dryRun: config.OLAI_DRY_RUN, exchange: service.exchange.name },
    config.OLAI_DRY_RUN
      ? `Olai is listening on port ${info.port} in dry-run mode, no live orders`
      : `Olai is listening on port ${info.port} and live`,
  );
});

let stopping = false;

/**
 * Shutting down cleanly matters more here than in most services: the ledger is
 * a SQLite file and the MCP session is a real connection to Binance. An open
 * event stream can hold the server open, so there is a short deadline after
 * which Olai leaves anyway.
 */
function stop(signal: string): void {
  if (stopping) {
    return;
  }
  stopping = true;
  log.info({ signal }, 'Olai is stopping');

  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();

  server.close(() => {
    void service.close().then(() => process.exit(0));
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
