/**
 * Watch Olai think, without a cent of risk.
 *
 * It boots the whole service exactly as `npm run dev` would, forces dry run on
 * top of whatever .env says, asks one question, and prints the thinking, the
 * proposal, the rulebook's verdict and every ledger line the session wrote.
 * Dry run is enforced in two places for two different kinds of spending: the
 * buyer stops before the wallet signature, and the session runner stops before
 * the order. Nothing here can move money.
 *
 * Run it with: npm run dry-run -w @olai/agent -- "your question"
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Service } from '../src/boot.js';
import type { BrainEvent } from '../src/brain/analyst.js';
import { loadConfig } from '../src/config.js';

const DEFAULT_QUESTION = 'Should I trim my BNB position before the weekend?';

let midLine = false;

function line(text = ''): void {
  if (midLine) {
    process.stdout.write('\n');
    midLine = false;
  }
  process.stdout.write(`${text}\n`);
}

/** Thinking and answer text arrive as fragments, so they are written as they land. */
function fragment(text: string): void {
  process.stdout.write(text);
  midLine = true;
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summaryOf(payload: Record<string, unknown>): string {
  const summary = payload['summary'];
  return typeof summary === 'string' ? summary : '';
}

/** Node 22 and up can read .env itself. Nothing to do if the file is not there. */
function loadEnv(): void {
  const candidates = [fileURLToPath(new URL('../../../.env', import.meta.url)), '.env'];

  for (const path of candidates) {
    if (existsSync(path) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(path);
      return;
    }
  }
}

function show(event: { type: string; data: unknown }): void {
  const brain = event.data as BrainEvent;

  switch (event.type) {
    case 'thinking':
    case 'text':
      fragment('text' in brain ? brain.text : '');
      return;
    case 'tool':
      line(`  asking ${'name' in brain ? brain.name : 'a tool'}`);
      return;
    case 'tool.result':
      line(`  ${'name' in brain ? brain.name : 'tool'}: ${'summary' in brain ? brain.summary : ''}`);
      return;
    default:
      return;
  }
}

/**
 * Reads the same event stream the dashboard reads, so this script proves the
 * feed works rather than reaching inside the service for a shortcut.
 */
async function openFeed(service: Service, token: string): Promise<() => Promise<void>> {
  const response = await service.app.request('/api/events', {
    headers: { authorization: `Bearer ${token}` },
  });

  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    line('the event feed did not open, the thinking will not be shown');
    return async () => {};
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf('\n\n');
        while (cut !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          cut = buffer.indexOf('\n\n');

          const data = block.split('\n').find((row) => row.startsWith('data: '));
          if (data) {
            show(JSON.parse(data.slice(6)) as { type: string; data: unknown });
          }
        }
      }
    } catch {
      // Cancelling the reader is how this loop is meant to end.
    }
  })();

  return async () => {
    await reader.cancel();
    await pump;
  };
}

async function main(): Promise<number> {
  loadEnv();
  process.env['OLAI_DRY_RUN'] = 'true';
  process.env['OLAI_LOG_LEVEL'] ??= 'warn';

  const config = loadConfig(process.env);
  const question = process.argv.slice(2).join(' ').trim() || DEFAULT_QUESTION;

  // Loaded here rather than at the top of the file so that the log level set
  // above is already in place when the service builds its logger.
  const { buildService } = await import('../src/boot.js');
  const service = await buildService(config);

  line(
    `Olai booted: dry run, exchange ${service.exchange.name}, ledger ${config.OLAI_DB_PATH}, address ${config.OLAI_PUBLIC_BASE_URL}`,
  );
  line();
  line(`Question: ${question}`);
  line();

  const closeFeed = await openFeed(service, config.OLAI_OWNER_TOKEN);

  try {
    const record = await service.runner.ask(question);
    // The last few fragments can still be in flight when ask resolves.
    await new Promise((resolve) => setTimeout(resolve, 50));
    line();

    const proposal = record.proposal;
    if (!proposal) {
      line('Olai ended without a proposal.');
      return 1;
    }

    line(`Proposal: ${proposal.summary}`);
    line(`  confidence: ${proposal.confidence}`);
    line(`  action: ${JSON.stringify(proposal.action)}`);
    for (const risk of proposal.risks) {
      line(`  risk: ${risk}`);
    }

    const verdict = record.verdict;
    line(
      verdict
        ? `Rulebook: ${verdict.allowed ? 'allowed' : 'refused'} (${verdict.ruleIds.join(', ')})${
            verdict.reasons.length > 0 ? ` ${verdict.reasons.join(' ')}` : ''
          }`
        : 'Rulebook: nothing to check, Olai proposed holding',
    );

    if (record.status === 'pending') {
      const approved = await service.runner.approve(record.id);
      line(`Owner approved. Session is now ${approved.status}.`);
    } else {
      line(`Nothing to approve, the session is ${record.status}.`);
    }

    line();
    line('Ledger lines for this session:');
    for (const entry of service.ledger.list({ sessionId: record.id })) {
      const cost = entry.costUsd === undefined ? '' : ` ($${entry.costUsd.toFixed(4)})`;
      line(`  ${entry.seq} ${entry.kind} by ${entry.actor}${cost}: ${summaryOf(entry.payload)}`);
    }

    const chain = service.ledger.verifyChain();
    line();
    line(
      chain.ok
        ? `Ledger chain holds across all ${chain.length} lines.`
        : `Ledger chain broke at line ${chain.brokenAtSeq}: ${chain.reason}`,
    );

    return chain.ok ? 0 : 1;
  } finally {
    await closeFeed();
    await service.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    line();
    line(`The dry run stopped: ${say(error)}`);
    process.exitCode = 1;
  });
