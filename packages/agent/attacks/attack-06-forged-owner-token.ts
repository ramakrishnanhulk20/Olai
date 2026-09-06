/**
 * ATTACK-06: using a session id as if it were the owner token.
 *
 * What this does NOT prove: that the owner token cannot be stolen. Anyone who
 * reads it from .env, from a shared screen or from the dashboard's storage owns
 * the API. This proves only that the ids the API hands out are not themselves
 * credentials, which is the account-takeover shape that has bitten this project
 * before: knowing an id must never mean being the user.
 */

import { OWNER_HEADERS, OWNER_TOKEN, call, startService } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const holdProposal = {
  summary: 'Sit this one out.',
  reasoning: 'Nothing in the free reads argues for a trade right now.',
  action: { type: 'hold', reason: 'The evidence is thin.' },
  confidence: 0.4,
  dataUsed: [],
  risks: ['Missing a move if it runs without me.'],
};

async function run(): Promise<AttackResult> {
  const harness = await startService({
    name: 'attack-06',
    script: [[{ toolCalls: [{ name: 'propose', input: holdProposal }] }]],
  });

  const steps: AttackStep[] = [];

  try {
    await call(harness.base, '/api/ask', {
      method: 'POST',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Anything worth doing in BNB today?' }),
    });

    const sessions = await call(harness.base, '/api/sessions', { headers: OWNER_HEADERS });
    steps.push(sessions);

    const sessionId = (sessions.json() as Array<{ id: string }>)[0]?.id ?? 'no-session';

    const read = await call(harness.base, '/api/ledger', { token: sessionId });
    steps.push({
      tried: [`Take the session id from the list above and send it as the bearer token.`, '', read.tried].join('\n'),
      raw: read.raw,
    });

    const approve = await call(harness.base, `/api/sessions/${sessionId}/approve`, {
      method: 'POST',
      token: sessionId,
    });
    steps.push(approve);

    const guessedPrefix = await call(harness.base, '/api/ledger', { token: `ol.${sessionId}` });
    steps.push({
      tried: ['The same id with the owner prefix glued on the front, in case the prefix is all that is checked.', '', guessedPrefix.tried].join('\n'),
      raw: guessedPrefix.raw,
    });

    const blocked = read.status === 401 && approve.status === 401 && guessedPrefix.status === 401;

    return {
      id: 'ATTACK-06',
      name: 'forging the owner token from a session id',
      notProved:
        'that the owner token is safe from theft. It is a bearer token: whoever holds it is the owner. This only shows that a session id is not one.',
      expected:
        '401 every time. Session ids (ol-<uuid>) and the owner token (ol. prefix, at least 24 characters, compared by hash in constant time) are separate namespaces on purpose.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `A session id was accepted as a credential somewhere: read ${read.status}, approve ${approve.status}, prefixed ${guessedPrefix.status}.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-06',
  name: 'forging the owner token from a session id',
  run,
};
