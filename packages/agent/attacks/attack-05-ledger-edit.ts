/**
 * ATTACK-05: editing a line in the ledger file.
 *
 * What this does NOT prove: that the ledger cannot be edited. It can, by anyone
 * with the file, and this attack does exactly that. What it proves is that the
 * edit cannot be hidden: the database refuses the UPDATE until the trigger is
 * dropped, and once the row is changed, verifyChain names the first line that
 * no longer adds up. It does not cover an attacker who rewrites the whole chain
 * from the edited line onward, which is possible for anyone holding the file
 * and is why the ledger is not the only record.
 */

import Database from 'better-sqlite3';
import { OWNER_HEADERS, OWNER_TOKEN, call, pretty, roomyRulebook, startService, step } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const TARGET_SEQ = 2;

async function run(): Promise<AttackResult> {
  const harness = await startService({ name: 'attack-05' });
  const steps: AttackStep[] = [];

  try {
    await call(harness.base, '/api/rulebook', {
      method: 'PUT',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: pretty(roomyRulebook()),
    });

    const before = await call(harness.base, '/api/ledger/verify', { headers: OWNER_HEADERS });
    steps.push(before);

    const db = new Database(harness.dbPath);
    db.pragma('busy_timeout = 5000');

    try {
      const row = db.prepare('SELECT seq, kind, payload FROM ledger WHERE seq = ?').get(TARGET_SEQ) as
        | { seq: number; kind: string; payload: string }
        | undefined;

      const edited = JSON.stringify({ summary: 'Rulebook "Something the owner never wrote" was set by the owner' });
      const sql = `UPDATE ledger SET payload = '${edited.replace(/'/g, "''")}' WHERE seq = ${TARGET_SEQ}`;

      let triggerError = 'the UPDATE was not refused';
      try {
        db.prepare(sql).run();
      } catch (error) {
        triggerError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }

      steps.push(
        step(
          [
            `Opened ${harness.dbPath} directly with better-sqlite3, outside the running agent,`,
            `and tried to rewrite line ${TARGET_SEQ}, which is currently:`,
            pretty(row),
            '',
            sql,
          ].join('\n'),
          triggerError,
        ),
      );

      db.exec('DROP TRIGGER ledger_no_update');
      const result = db.prepare(sql).run();
      const after = db.prepare('SELECT seq, kind, payload FROM ledger WHERE seq = ?').get(TARGET_SEQ);

      steps.push(
        step(
          ['DROP TRIGGER ledger_no_update;', sql].join('\n'),
          [`rows changed: ${result.changes}`, '', `line ${TARGET_SEQ} now reads:`, pretty(after)].join('\n'),
        ),
      );
    } finally {
      db.close();
    }

    const verify = await call(harness.base, '/api/ledger/verify', { headers: OWNER_HEADERS });
    steps.push(verify);

    const check = verify.json() as { ok: boolean; brokenAtSeq?: number; reason?: string };
    const blocked = check.ok === false && check.brokenAtSeq === TARGET_SEQ;

    return {
      id: 'ATTACK-05',
      name: 'editing a ledger row directly in the SQLite file',
      notProved:
        'that the ledger cannot be tampered with. It can, by anyone with the file. It proves the tampering is visible afterwards, and only for an attacker who does not also recompute every later hash.',
      expected:
        'GET /api/ledger/verify reports ok false and names the first broken seq, which is the line that was edited.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `After the row was edited, verifyChain answered ${JSON.stringify(check)}, which does not name line ${TARGET_SEQ} as broken.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-05',
  name: 'editing a ledger row directly in the SQLite file',
  run,
};
