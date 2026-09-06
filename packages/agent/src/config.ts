import { z } from 'zod';
import { assertOwnerToken } from './api/auth.js';

/**
 * Olai reads every setting once, at boot, and refuses to start if anything is
 * wrong. A trading agent that starts with half its settings missing is worse
 * than one that does not start at all.
 */

// Env vars set to an empty string are the same as not set at all, otherwise a
// blank line in .env would silently beat the default below.
const dropBlanks = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
    ),
  );

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const configSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ error: 'not set, create a key at console.anthropic.com and put it in .env' })
    .min(10, 'looks too short to be a real key'),
  // The only thing standing between the owner's API and anyone else on this
  // machine. It is checked here with the same function the API uses, so a token
  // that gets Olai booted is a token that will open the door.
  OLAI_OWNER_TOKEN: z
    .string({ error: 'not set, invent a secret that starts with "ol." and put it in .env' })
    .superRefine((value, ctx) => {
      try {
        assertOwnerToken(value);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
      }
    }),
  OLAI_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  OLAI_DB_PATH: z.string().min(1).default('./data/olai.db'),
  OLAI_RULEBOOK_PATH: z.string().min(1).default('./data/rulebook.json'),
  OLAI_DRY_RUN: flag.default(true),
  // The dashboard's address. It is the only origin the browser API answers, so
  // a page on any other site cannot make the owner's browser spend their money.
  OLAI_WEB_ORIGIN: z.url().default('http://localhost:3000'),
  // Only true when something in front of Olai rewrites X-Forwarded-For.
  // Believing that header without a proxy would let anyone dodge the rate limit.
  OLAI_TRUST_PROXY: flag.default(false),
  // auto takes whichever real door is open: an API key first, then the Binance
  // sign-in, and the fake one only when neither is there. The fake one is
  // refused outside a dry run.
  OLAI_EXCHANGE: z.enum(['auto', 'rest', 'mcp', 'fake']).default('auto'),
  // A trade-only key on an isolated sub-account. Both halves have to be present
  // before Olai will trade through the REST API at all.
  BINANCE_API_KEY: z.string().min(1).optional(),
  BINANCE_API_SECRET: z.string().min(1).optional(),
  // testnet by default, so a key pasted into the wrong line cannot spend real
  // money before anybody has read the log.
  BINANCE_API_ENV: z.enum(['prod', 'testnet']).default('testnet'),
  BINANCE_MCP_URL: z.url().default('https://agent.binance.com/mcp/agentic'),
  // Binance fetches Olai's client metadata document from this address during
  // the OAuth consent step, so for a real connection it has to be a public
  // HTTPS address (a tunnel in development), not the loopback default.
  OLAI_PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:4000'),
  OLAI_TOKEN_PATH: z.string().min(1).default('./data/binance-mcp-token.json'),
  OLAI_CLIENT_NAME: z.string().min(1).default('Olai'),
  BAZAAR_BASE_URL: z.url().default('https://www.binance.com/bapi/ramp/v1/public/ramp/b402'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Turns raw environment variables into a checked Config.
 *
 * Throws an Error naming every setting that is wrong or missing, one per line,
 * so the first run tells Ram exactly what to put in .env instead of failing
 * later with a stack trace from somewhere else.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(dropBlanks(env));

  if (result.success) {
    return result.data;
  }

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Olai cannot start. Fix these settings in your .env file (see .env.example):\n${problems}`,
  );
}
