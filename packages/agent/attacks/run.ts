/**
 * The attack run.
 *
 * Boots the real Olai service once per attack, in this process, with a
 * temporary ledger, the fake exchange, a scripted model and a stand-in wallet,
 * serves it on a free local port, then tries every attack the threat model
 * lists and writes what happened to docs/security/attacks.
 *
 * Run it with: npm run attacks -w @olai/agent
 * One attack only:  npm run attacks -w @olai/agent -- ATTACK-05
 *
 * What the whole run does NOT prove: anything about the live Binance MCP
 * server, the live wallet, the real Anthropic API or the live Bazaar. Those are
 * out of reach on purpose, because an attack script that spent real money or
 * signed with the owner's wallet would be the attack.
 */

// Set before the service is loaded: pino reads the level once, at import time,
// and the info stream would bury the one line per attack this prints.
process.env['OLAI_LOG_LEVEL'] ??= 'warn';

const { writeAttackFile, writeSummary } = await import('./report.js');
type Loaded = { attack: import('./report.js').Attack };

const modules: Array<{ id: string; load: () => Promise<Loaded> }> = [
  { id: 'ATTACK-01', load: () => import('./attack-01-prompt-injection.js') },
  { id: 'ATTACK-02', load: () => import('./attack-02-over-max-order.js') },
  { id: 'ATTACK-03', load: () => import('./attack-03-double-approve.js') },
  { id: 'ATTACK-04', load: () => import('./attack-04-payment-replay.js') },
  { id: 'ATTACK-05', load: () => import('./attack-05-ledger-edit.js') },
  { id: 'ATTACK-06', load: () => import('./attack-06-forged-owner-token.js') },
  { id: 'ATTACK-07', load: () => import('./attack-07-rulebook-nonsense.js') },
  { id: 'ATTACK-08', load: () => import('./attack-08-symbol-not-allowed.js') },
  { id: 'ATTACK-09', load: () => import('./attack-09-kill-then-approve.js') },
  { id: 'ATTACK-10', load: () => import('./attack-10-rate-limit.js') },
  { id: 'ATTACK-11', load: () => import('./attack-11-token-file-permissions.js') },
  { id: 'ATTACK-12', load: () => import('./attack-12-secrets-sweep.js') },
  { id: 'ATTACK-13', load: () => import('./attack-13-cors-preflight.js') },
  { id: 'ATTACK-14', load: () => import('./attack-14-sse-without-token.js') },
];

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

const only = process.argv.slice(2).map((arg) => arg.toUpperCase());
const runAtIso = new Date().toISOString();
const results: Array<import('./report.js').AttackResult> = [];
let errors = 0;

line(`Olai attack run, ${runAtIso}`);
line();

for (const entry of modules) {
  if (only.length > 0 && !only.includes(entry.id)) {
    continue;
  }

  const { attack } = await entry.load();

  try {
    const result = await attack.run();
    results.push(result);
    writeAttackFile(result, runAtIso);
    line(`${result.id}  ${result.blocked ? 'BLOCKED    ' : 'NOT BLOCKED'}  ${result.name}`);
  } catch (error) {
    errors += 1;
    line(`${attack.id}  ERROR        ${attack.name}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      line(error.stack);
    }
  }
}

if (only.length === 0 && errors === 0) {
  writeSummary(results, runAtIso);
}

const findings = results.filter((result) => !result.blocked);

line();
line(`${results.length} attacks ran, ${findings.length} not blocked, ${errors} could not be run.`);
if (findings.length > 0) {
  line(`Findings: ${findings.map((result) => result.id).join(', ')}. See docs/security/attacks/SUMMARY.md.`);
}

process.exitCode = errors === 0 ? 0 : 1;
