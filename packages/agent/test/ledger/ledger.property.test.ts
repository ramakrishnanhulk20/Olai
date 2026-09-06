import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger/ledger.js';
import { type LedgerEntryInput, ledgerActors, ledgerKinds } from '../../src/ledger/types.js';

// What this file does NOT cover: files on disk (this runs in memory), reopening
// a ledger, and tamper detection, which ledger.test.ts covers with a worked
// example. This run proves that any legal sequence of writes leaves a chain
// that verifies and a cost total that is right to the cent.

const entryArb: fc.Arbitrary<LedgerEntryInput> = fc.record({
  kind: fc.constantFrom(...ledgerKinds),
  actor: fc.constantFrom(...ledgerActors),
  payload: fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue(), { maxKeys: 6 }) as
    fc.Arbitrary<Record<string, unknown>>,
  costUsd: fc.option(fc.integer({ min: 0, max: 100_000 }).map((cents) => cents / 100), {
    nil: undefined,
  }),
  txHash: fc.option(
    fc.integer({ min: 0, max: 0xff_ff_ff }).map((value) => `0x${value.toString(16)}`),
    { nil: undefined },
  ),
  orderId: fc.option(fc.string({ minLength: 1, maxLength: 12 }).filter((id) => id.trim() !== ''), {
    nil: undefined,
  }),
  sessionId: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: undefined }),
});

describe('the ledger, properties that must hold for every sequence of writes', () => {
  it('always leaves a chain that verifies, numbered without gaps', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 25 }), (inputs) => {
        const ledger = new Ledger(':memory:');
        try {
          const written = inputs.map((input) => ledger.append(input));

          expect(ledger.verifyChain()).toEqual({ ok: true, length: inputs.length });
          expect(written.map((entry) => entry.seq)).toEqual(inputs.map((_, index) => index + 1));
          expect(ledger.latest()?.hash).toBe(written[written.length - 1]?.hash);
          expect(ledger.list()).toEqual(written);

          const expectedCents = written.reduce(
            (total, entry) => total + Math.round((entry.costUsd ?? 0) * 100),
            0,
          );
          expect(ledger.sumCostUsd({ sinceIso: '1970-01-01T00:00:00.000Z' })).toBe(
            expectedCents / 100,
          );
        } finally {
          ledger.close();
        }
      }),
      { numRuns: 200 },
    );
  });
});
