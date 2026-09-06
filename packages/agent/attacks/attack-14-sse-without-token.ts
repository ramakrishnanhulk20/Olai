/**
 * ATTACK-14: subscribing to the thinking feed without the owner token.
 *
 * What this does NOT prove: that the feed is private once a client is on it.
 * Every subscriber sees every event, because there is one owner. It also does
 * not cover the OAuth routes, which sit outside /api on purpose and are listed
 * as gap 6.9 in the threat model.
 */

import { OWNER_TOKEN, call, startService } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

async function run(): Promise<AttackResult> {
  const harness = await startService({ name: 'attack-14' });
  const steps: AttackStep[] = [];

  try {
    const noToken = await call(harness.base, '/api/events', { headers: { accept: 'text/event-stream' } });
    steps.push(noToken);

    const wrongToken = await call(harness.base, '/api/events', {
      token: 'ol.this-is-not-the-owners-token-at-all',
      headers: { accept: 'text/event-stream' },
    });
    steps.push(wrongToken);

    const almostRight = await call(harness.base, '/api/events', {
      token: `${OWNER_TOKEN}x`,
      headers: { accept: 'text/event-stream' },
    });
    steps.push({
      tried: ['The real token with one extra character on the end, in case the compare is a prefix compare:', '', almostRight.tried].join('\n'),
      raw: almostRight.raw,
    });

    const blocked = noToken.status === 401 && wrongToken.status === 401 && almostRight.status === 401;

    return {
      id: 'ATTACK-14',
      name: 'opening the event stream with no token',
      notProved:
        'that the feed is private after a client is on it. Everything published goes to every subscriber, since there is one owner. The OAuth routes outside /api are not covered here either.',
      expected: '401, from ownerAuth in src/api/auth.ts, before the stream is ever opened.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `The event stream answered ${noToken.status} with no token, ${wrongToken.status} with a wrong token and ${almostRight.status} with a near miss.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-14',
  name: 'opening the event stream with no token',
  run,
};
