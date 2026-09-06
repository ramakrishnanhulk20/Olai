/**
 * ATTACK-10: hammering the API from one machine.
 *
 * What this does NOT prove: that a determined attacker cannot get more than 60
 * requests a minute. The window is counted per address, so more machines means
 * more requests, and the threat model says so. It also does not prove the limit
 * protects anything on its own: every route behind it still needs the owner
 * token. This is about noise and brute force, not about authorisation.
 */

import { OWNER_TOKEN, call, startService, step } from './harness.js';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../src/api/auth.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

async function run(): Promise<AttackResult> {
  const harness = await startService({ name: 'attack-10' });
  const steps: AttackStep[] = [];

  try {
    const attempts = RATE_LIMIT_MAX + 1;
    const statuses: number[] = [];
    let lastAllowed = '';
    let firstRefused: Awaited<ReturnType<typeof call>> | undefined;

    const startedAt = Date.now();

    for (let index = 0; index < attempts; index += 1) {
      const response = await call(harness.base, '/api/rulebook', { token: OWNER_TOKEN });
      statuses.push(response.status);

      if (response.status === 200) {
        lastAllowed = `request ${index + 1}: HTTP 200`;
      } else if (firstRefused === undefined) {
        firstRefused = response;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const allowed = statuses.filter((status) => status === 200).length;
    const refused = statuses.filter((status) => status === 429).length;

    steps.push(
      step(
        [
          `${attempts} requests to GET /api/rulebook from one socket, one after another, all with the owner token.`,
          `The limit in src/api/auth.ts is ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000} seconds, counted per address.`,
        ].join('\n'),
        [
          `all ${attempts} sent in ${elapsedMs} ms`,
          `HTTP 200: ${allowed}`,
          `HTTP 429: ${refused}`,
          `last one allowed: ${lastAllowed}`,
          `first one refused: request ${statuses.indexOf(429) + 1}`,
        ].join('\n'),
      ),
    );

    if (firstRefused) {
      steps.push(firstRefused);
    }

    const retryAfter = firstRefused?.headers.get('retry-after') ?? null;
    const blocked = allowed === RATE_LIMIT_MAX && statuses[RATE_LIMIT_MAX] === 429 && retryAfter !== null;

    return {
      id: 'ATTACK-10',
      name: 'sixty one requests in one minute from one address',
      notProved:
        'that the limit stops a real attacker. It counts per address, so more machines means more requests, and the threat model lists that as a known limit rather than a bypass. Nothing here weakens the owner-token check, which every one of these requests still had to pass.',
      expected: `the first ${RATE_LIMIT_MAX} answered and the next one refused with 429 and a Retry-After header.`,
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `${allowed} requests were answered and ${refused} were refused. The 429 carried Retry-After: ${String(retryAfter)}.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-10',
  name: 'sixty one requests in one minute from one address',
  run,
};
