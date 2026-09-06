import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shape every attack reports back in, and the writer that turns it into a
 * file under docs/security/attacks.
 *
 * The rule for these files is that they hold captured output, not prose about
 * captured output. Every step records the literal request or code call that was
 * made and the literal answer that came back, so a reader can run the same
 * thing and compare.
 */

export interface AttackStep {
  /** The literal HTTP request or code call, as it was made. */
  tried: string;
  /** The literal answer: status line, headers, body, or the returned value. */
  raw: string;
}

export interface AttackResult {
  /** ATTACK-01 through ATTACK-14. */
  id: string;
  name: string;
  /** What a reader must not conclude from this attack passing. */
  notProved: string;
  /** The expected outcome, quoted from the threat model's attack list. */
  expected: string;
  steps: AttackStep[];
  /** True when the control held and the attack got nowhere. */
  blocked: boolean;
  /** Anything the run turned up that is not a pass or a fail, such as a platform gap. */
  note?: string;
  /** Why the control failed. Only read when blocked is false. */
  finding?: string;
}

export interface Attack {
  id: string;
  name: string;
  run(): Promise<AttackResult>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** docs/security/attacks, resolved from this file so the runner works from any directory. */
export const OUTPUT_DIR = join(HERE, '..', '..', '..', 'docs', 'security', 'attacks');

export function fence(text: string): string {
  return ['```', text.replace(/```/g, "'''"), '```'].join('\n');
}

export function resultLine(result: AttackResult): string {
  return `RESULT: ${result.blocked ? 'BLOCKED' : 'NOT BLOCKED'}`;
}

export function writeAttackFile(result: AttackResult, runAtIso: string): string {
  const lines = [
    `# ${result.id}: ${result.name}`,
    '',
    `Captured on ${runAtIso} by \`npm run attacks -w @olai/agent\`. Everything below is`,
    'the output of that run, pasted as it came back.',
    '',
    `What this attack does NOT prove: ${result.notProved}`,
    '',
    `Expected outcome, from docs/security/threat-model.md section 5: ${result.expected}`,
    '',
  ];

  result.steps.forEach((step, index) => {
    lines.push(`## Step ${index + 1}`, '', 'What we tried:', '', fence(step.tried), '', 'What came back:', '', fence(step.raw), '');
  });

  if (result.note) {
    lines.push('## Note', '', result.note, '');
  }

  if (!result.blocked && result.finding) {
    lines.push('## Finding', '', result.finding, '');
  }

  lines.push(resultLine(result), '');

  const path = join(OUTPUT_DIR, `${result.id}.md`);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

export function writeSummary(results: AttackResult[], runAtIso: string): string {
  const findings = results.filter((result) => !result.blocked);
  const notes = results.filter((result) => result.note !== undefined);

  const lines = [
    '# Attack run: what we tried and what happened',
    '',
    `Captured on ${runAtIso}. Every line below came from one run of`,
    '`npm run attacks -w @olai/agent`, which boots the real Olai service in this',
    'repo with a temporary SQLite ledger, the fake exchange, a scripted stand-in for',
    'Claude and a stand-in for the wallet CLI, then attacks it over real HTTP on a',
    'local port. No live Binance call, no Anthropic call and no money are involved.',
    '',
    '| Attack | What it tries | Result |',
    '|---|---|---|',
    ...results.map((result) => `| [${result.id}](./${result.id}.md) | ${result.name} | ${result.blocked ? 'BLOCKED' : 'NOT BLOCKED'} |`),
    '',
    '## Findings',
    '',
  ];

  if (findings.length === 0) {
    lines.push('Nothing got through. Every attack above was refused by the control the threat', 'model names for it.', '');
  } else {
    for (const finding of findings) {
      lines.push(`### ${finding.id}: ${finding.name}`, '', finding.finding ?? 'The control did not hold.', '');
      const last = finding.steps[finding.steps.length - 1];
      if (last) {
        lines.push('The last step of that attack:', '', fence(last.tried), '', 'and what came back:', '', fence(last.raw), '');
      }
    }
  }

  if (notes.length > 0) {
    lines.push('## Notes from the run', '');
    for (const noted of notes) {
      lines.push(`### ${noted.id}`, '', noted.note ?? '', '');
    }
  }

  lines.push(
    '## What this whole run does not prove',
    '',
    'Each file lists its own limits. Across all of them: nothing here touches the real',
    'Binance MCP server, the real Agentic Wallet, the real Anthropic API or the live',
    'Bazaar, so this is proof about Olai\'s own code and its own refusals, not about',
    'Binance\'s controls behind them. The service under attack runs in dry run, so the',
    'order path stops one step before a real venue in every case. And an attack that',
    'is blocked is blocked for the inputs written down here, not for every input.',
    '',
  );

  const path = join(OUTPUT_DIR, 'SUMMARY.md');
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}
