/**
 * ATTACK-03: approving the same pending session twice at the same moment.
 *
 * What this does NOT prove: that a double send is impossible across a restart.
 * The guard is the in-memory ordered Set in SessionRunner, named as gap 6.2 in
 * the threat model, so a process that dies between the approval and the venue's
 * answer loses it. This run also stops at the dry-run branch, so it proves one
 * order.sent line, not one round trip to Binance. And the HTTP half of it says
 * nothing about a slower exchange: with the fake one, two requests fired
 * together never overlap inside the runner, which is why the second half starts
 * both approvals in the same tick instead.
 */

import {
  OWNER_HEADERS,
  OWNER_TOKEN,
  call,
  callOnOwnSocket as callOnSocket,
  pretty,
  roomyRulebook,
  startService,
} from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const RULEBOOK = roomyRulebook();

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
    name: 'attack-03',
    script: [
      [{ toolCalls: [{ name: 'propose', input: proposal }] }],
      [{ toolCalls: [{ name: 'propose', input: proposal }] }],
    ],
  });

  const steps: AttackStep[] = [];

  try {
    await call(harness.base, '/api/rulebook', {
      method: 'PUT',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: pretty(RULEBOOK),
    });

    const ask = await call(harness.base, '/api/ask', {
      method: 'POST',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Should I add a little BNB?' }),
    });
    steps.push(ask);

    const sessionId = (ask.json() as { id: string }).id;
    const approve = () =>
      callOnSocket(harness.base, `/api/sessions/${sessionId}/approve`, { method: 'POST', token: OWNER_TOKEN });

    const [first, second] = await Promise.all([approve(), approve()]);

    steps.push({
      tried: [
        'Two approvals of the same session, fired together with Promise.all, each on its own',
        'connection so the server really has both in flight at once:',
        '',
        first.tried,
        '',
        second.tried,
      ].join('\n'),
      raw: ['First answer:', first.raw, '', 'Second answer:', second.raw].join('\n'),
    });

    const ledger = await call(harness.base, `/api/ledger?sessionId=${sessionId}`, { headers: OWNER_HEADERS });
    steps.push(ledger);

    const entries = (ledger.json() as { entries: Array<{ kind: string }> }).entries;
    const sentOverHttp = entries.filter((entry) => entry.kind === 'order.sent').length;

    // The two requests above did not overlap inside the runner. With the fake
    // exchange every await in the approval path resolves as a microtask, so the
    // first request finishes before the server ever reads the second socket.
    // The same two calls made in one tick do overlap, and that is the window a
    // real exchange, which answers over the network, would hold open.
    const secondAsk = await call(harness.base, '/api/ask', {
      method: 'POST',
      token: OWNER_TOKEN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Should I add a little BNB?' }),
    });
    const racedSessionId = (secondAsk.json() as { id: string }).id;

    const raced = await Promise.all([
      harness.service.runner.approve(racedSessionId),
      harness.service.runner.approve(racedSessionId),
    ]);
    const racedLines = harness.service.ledger.list({ sessionId: racedSessionId });
    const sentInProcess = racedLines.filter((entry) => entry.kind === 'order.sent').length;
    const approvalsInProcess = racedLines.filter((entry) => entry.kind === 'approval').length;

    steps.push({
      tried: [
        'A second pending session, and both approvals started in the same tick, which is what',
        'two clicks or a client retry look like when the account read in the middle of the',
        'approval is a real network call:',
        '',
        `await Promise.all([runner.approve("${racedSessionId}"), runner.approve("${racedSessionId}")])`,
      ].join('\n'),
      raw: [
        `returned statuses: ${JSON.stringify(raced.map((record) => record.status))}`,
        `approval lines in the ledger for this session: ${approvalsInProcess}`,
        `order.sent lines in the ledger for this session: ${sentInProcess}`,
        '',
        ...racedLines
          .filter((entry) => entry.kind === 'approval' || entry.kind === 'order.sent')
          .map((entry) => `seq ${entry.seq} ${entry.kind}: ${String(entry.payload['summary'])}`),
      ].join('\n'),
    });

    const blocked =
      first.status === 200 &&
      second.status === 200 &&
      sentOverHttp === 1 &&
      (first.json() as { status: string }).status === 'executed' &&
      (second.json() as { status: string }).status === 'executed' &&
      sentInProcess === 1;

    return {
      id: 'ATTACK-03',
      name: 'approving the same session twice, in parallel',
      notProved:
        'that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.',
      expected:
        'one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: [
              `Two HTTP approvals on two sockets left ${sentOverHttp} order.sent line in the ledger, so over HTTP the guard held here.`,
              `Two approvals started in the same tick left ${approvalsInProcess} approval lines and ${sentInProcess} order.sent lines for one session, which should be one and one.`,
              '',
              'The reason is in src/session/session.ts. approve() checks record.status and the',
              'ordered Set, then awaits this.state() before it adds to that Set, so two calls that',
              'both get past the check before either resumes will both send. Nothing closes that',
              'window between the check and the claim.',
              '',
              'It did not reproduce over HTTP in this run because the fake exchange answers without',
              'any real waiting, so the first request finishes before the server reads the second',
              'socket. Against the real Binance MCP exchange the account read in the middle of',
              'approve() is a network round trip, which holds that window open for as long as the',
              'venue takes to answer. In a live run the same two approvals would place two orders.',
              '',
              'Left exactly as found. No file under src was changed.',
            ].join('\n'),
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-03',
  name: 'approving the same session twice, in parallel',
  run,
};
