/**
 * ATTACK-07: writing a rulebook with a number that is not a number.
 *
 * What this does NOT prove: that a rulebook which does pass the schema is a
 * sensible one. The owner can save a rulebook that allows a 10,000 dollar order
 * and Olai will run it. This is only about the shapes that would make the
 * engine's arithmetic meaningless: NaN, Infinity, a negative cap, a string.
 * It also does not touch the rulebook JSON file on disk, which anyone with the
 * machine can edit directly.
 */

import { OWNER_HEADERS, OWNER_TOKEN, call, startService } from './harness.js';
import { defaultRulebook } from '../src/rulebook/store.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

/** Builds the request body by hand, because NaN and Infinity cannot be written by JSON.stringify. */
function bodyWithMaxOrder(raw: string): string {
  const text = JSON.stringify(defaultRulebook);
  const target = `"maxOrderUsd":${defaultRulebook.maxOrderUsd}`;
  if (!text.includes(target)) {
    throw new Error(`the rulebook no longer serialises with ${target}, so this attack needs rewriting`);
  }
  return text.replace(target, `"maxOrderUsd":${raw}`);
}

async function run(): Promise<AttackResult> {
  const harness = await startService({ name: 'attack-07' });
  const steps: AttackStep[] = [];

  try {
    const before = await call(harness.base, '/api/rulebook', { headers: OWNER_HEADERS });
    steps.push(before);

    const attempts = ['NaN', 'Infinity', '-1', '"20"'];
    const statuses: number[] = [];

    for (const raw of attempts) {
      const put = await call(harness.base, '/api/rulebook', {
        method: 'PUT',
        token: OWNER_TOKEN,
        headers: { 'content-type': 'application/json' },
        body: bodyWithMaxOrder(raw),
      });
      statuses.push(put.status);
      steps.push(put);
    }

    const after = await call(harness.base, '/api/rulebook', { headers: OWNER_HEADERS });
    steps.push({
      tried: ['The rulebook the service is actually running, read back after all four attempts:', '', after.tried].join('\n'),
      raw: after.raw,
    });

    const unchanged = after.body === before.body;
    const blocked = statuses.every((status) => status === 400) && unchanged;

    return {
      id: 'ATTACK-07',
      name: 'a rulebook with NaN, Infinity, a negative cap and a string',
      notProved:
        'that a rulebook which passes the schema is a safe one. The owner can legitimately save loose rules. This is only about shapes that would break the arithmetic.',
      expected:
        '400 on each attempt and the stored rulebook untouched. NaN and Infinity are not valid JSON, so those two are refused before the schema is even reached; the negative number and the string are refused by rulebookSchema in src/policy/rulebook.ts.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `Statuses were ${JSON.stringify(statuses)} and the stored rulebook ${unchanged ? 'did not change' : 'changed'}.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-07',
  name: 'a rulebook with NaN, Infinity, a negative cap and a string',
  run,
};
