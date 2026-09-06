/**
 * ATTACK-09: approving an order after the kill switch is on.
 *
 * What this does NOT prove: that the kill switch stops an order already in
 * flight. It does not, and the threat model says so in gap 6.5. It also does
 * not prove anything about a killed agent restarting, since the flag lives in
 * memory and a restart clears it.
 */

import { OWNER_HEADERS, OWNER_TOKEN, call, pretty, roomyRulebook, startService } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const proposal = {
  summary: 'Add 12 dollars of BNB.',
  reasoning: 'Small size, deep book.',
  action: { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 12, orderType: 'MARKET' },
  confidence: 0.6,
  dataUsed: [],
  risks: ['A weekend gap would hurt this.'],
};

async function run(): Promise<AttackResult> {
  const harness = await startService({
    name: 'attack-09',
    script: [[{ toolCalls: [{ name: 'propose', input: proposal }] }]],
  });

  const steps: AttackStep[] = [];

  try {
    await call(harness.base, '/api/rulebook', {
      method: 'PUT',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: pretty(roomyRulebook()),
    });

    const ask = await call(harness.base, '/api/ask', {
      method: 'POST',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Should I add a little BNB?' }),
    });
    steps.push(ask);

    const sessionId = (ask.json() as { id: string }).id;

    const kill = await call(harness.base, '/api/kill', { method: 'POST', token: OWNER_TOKEN });
    steps.push(kill);

    const approveWhileKilled = await call(harness.base, `/api/sessions/${sessionId}/approve`, {
      method: 'POST',
      token: OWNER_TOKEN,
    });
    steps.push(approveWhileKilled);

    const resume = await call(harness.base, '/api/resume', { method: 'POST', token: OWNER_TOKEN });
    steps.push(resume);

    const approveAfterResume = await call(harness.base, `/api/sessions/${sessionId}/approve`, {
      method: 'POST',
      token: OWNER_TOKEN,
    });
    steps.push(approveAfterResume);

    const ledger = await call(harness.base, `/api/ledger?sessionId=${sessionId}`, { headers: OWNER_HEADERS });
    steps.push(ledger);

    const killedRecord = approveWhileKilled.json() as { status?: string; verdict?: { ruleIds?: string[] } };
    const entries = (ledger.json() as { entries: Array<{ kind: string }> }).entries;
    const sent = entries.filter((entry) => entry.kind === 'order.sent');

    const resumedRecord = approveAfterResume.json() as { status?: string };
    const blocked =
      killedRecord.status === 'pending' &&
      (killedRecord.verdict?.ruleIds ?? []).includes('agent.killed') &&
      // Exactly one order line, and it belongs to the approval after resume.
      sent.length === 1 &&
      approveAfterResume.status === 200 &&
      resumedRecord.status === 'executed';

    const note =
      resumedRecord.status === 'executed'
        ? 'A refusal while killed leaves the session pending, so the owner can approve it again once Olai is resumed; the dry-run approval after resume is the second half of this attack.'
        : `After /api/resume the same session came back HTTP ${approveAfterResume.status} with status ${String(resumedRecord.status)}.`;

    return {
      id: 'ATTACK-09',
      name: 'approving an order with the kill switch on',
      notProved:
        'that kill cancels anything already sent to Binance. It does not, by design, and the threat model records that as gap 6.5. The flag is also in memory only, so a restart clears it.',
      expected:
        'refused with agent.killed while the switch is on (the session stays pending, nothing is sent), and the same session executes in dry run after /api/resume.',
      steps,
      blocked,
      note,
      ...(blocked
        ? {}
        : {
            finding: `Approving with the kill switch on came back as ${String(killedRecord.status)} with rule ids ${JSON.stringify(killedRecord.verdict?.ruleIds ?? [])}, and the ledger holds ${sent.length} order.sent lines.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-09',
  name: 'approving an order with the kill switch on',
  run,
};
