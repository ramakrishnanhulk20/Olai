import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger/ledger.js';
import {
  RulebookInvalidError,
  RulebookStore,
  RulebookStoreError,
  defaultRulebook,
} from '../../src/rulebook/store.js';

/**
 * What this file does NOT cover: what happens when two processes save at the
 * same instant (the rename is atomic, the ledger line that follows it is a
 * second step), a full disk, and whether the running agent picks up a new
 * rulebook without a restart, which is the wiring's job and not the store's.
 */

const openLedgers: Ledger[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'olai-rulebook-'));
  tempDirs.push(dir);
  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);
  const path = join(dir, 'rulebook.json');

  return { path, ledger, store: new RulebookStore({ path, ledger }) };
}

describe('RulebookStore', () => {
  it('says nothing is stored yet rather than inventing a rulebook', () => {
    const { store } = setup();
    expect(store.load()).toBeNull();
  });

  it('saves a rulebook, reads the same one back, and records it in the ledger', () => {
    const { store, ledger, path } = setup();
    const wanted = { ...defaultRulebook, name: 'Careful weekend', maxOrderUsd: 15 };

    const saved = store.save(wanted, 'owner');

    expect(saved).toEqual(wanted);
    expect(store.load()).toEqual(wanted);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(wanted);

    const lines = ledger.list();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('rulebook.set');
    expect(lines[0]?.actor).toBe('owner');
    expect(lines[0]?.payload.rulebook).toEqual(wanted);
  });

  it('refuses a rulebook the schema rejects and says which field was wrong', () => {
    const { store, ledger } = setup();

    try {
      store.save({ ...defaultRulebook, maxOrderUsd: -5 }, 'owner');
      expect.unreachable('a negative order size must not be saved');
    } catch (error) {
      expect(error).toBeInstanceOf(RulebookInvalidError);
      expect((error as RulebookInvalidError).issues[0]?.path).toEqual(['maxOrderUsd']);
    }

    expect(store.load()).toBeNull();
    expect(ledger.list()).toEqual([]);
  });

  it('throws on a mangled file instead of quietly running under the defaults', () => {
    const { store, path } = setup();
    writeFileSync(path, '{ this is not json', 'utf8');

    expect(() => store.load()).toThrow(RulebookStoreError);
  });

  it('ships defaults that ask for approval on every order', () => {
    expect(defaultRulebook.requireApprovalAboveUsd).toBe(0);
    expect(defaultRulebook.allowLeverage).toBe(false);
    expect(defaultRulebook.maxDataSpendUsdPerCall).toBeLessThanOrEqual(
      defaultRulebook.maxDataSpendUsdPerDay,
    );
  });
});
