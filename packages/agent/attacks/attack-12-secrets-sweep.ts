/**
 * ATTACK-12: looking for key material in the repo and in the git history.
 *
 * What this does NOT prove: that no secret has ever left this machine, or that
 * a future commit will be clean. It is a snapshot of the working tree and of
 * whatever history exists at the moment it runs. It also cannot judge a secret
 * it has no pattern for: it looks for Anthropic keys, owner tokens, private key
 * and mnemonic assignments, and the owner's wallet address, and nothing else.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { OWNER_TOKEN, step } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

/** The owner's Agentic Wallet address. Public by nature, and named in the docs on purpose. */
const WALLET_ADDRESS = '0xC75126992E4744a75665405e9b427710C0d23052';

const PATTERNS: Array<{ name: string; test: RegExp }> = [
  { name: 'sk-ant', test: /sk-ant/i },
  // The word boundary is load-bearing: without it "protocol.", "tool." and
  // "symbol." all read as owner tokens and bury the real matches in noise.
  { name: 'ol.', test: /\bol\./ },
  { name: 'PRIVATE_KEY', test: /PRIVATE_KEY/ },
  { name: 'MNEMONIC', test: /MNEMONIC/ },
  { name: 'wallet address', test: new RegExp(WALLET_ADDRESS, 'i') },
];

/**
 * What makes a match key material rather than a mention of one.
 *
 * A repo that talks about secrets is full of the word. These three say what a
 * real one looks like: an Anthropic key in its published shape, an owner token
 * long enough to be the real thing, and a private key or seed phrase with a
 * value actually assigned to it.
 */
const ANTHROPIC_KEY = /sk-ant-api\d{2}-[A-Za-z0-9_-]{40,}/;
const OWNER_TOKEN_SHAPE = /\bol\.[A-Za-z0-9_-]{24,}/;
const KEY_ASSIGNMENT = /(PRIVATE_KEY|MNEMONIC)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/;

/**
 * Tokens this repo publishes on purpose, and why each one cannot open anything
 * that matters. Everything else shaped like an owner token is a finding.
 */
const PUBLIC_TOKENS: Array<{ test: (token: string) => boolean; why: string }> = [
  {
    // startsWith, not equality: in a diff line the shape regex can swallow one
    // trailing character, and the harness token is public either way.
    test: (token) => token.startsWith(OWNER_TOKEN),
    why: 'the token this attack run boots its own throwaway service with',
  },
  {
    test: (token) => token === 'ol.this-is-not-the-owners-token-at-all',
    why: 'the wrong token ATTACK-14 sends to prove the event stream refuses it',
  },
  {
    test: (token) => /^ol\.ol-[0-9a-f]{32}$/.test(token),
    why: 'a session id with the owner prefix glued on, which is the forgery ATTACK-06 makes and gets a 401 for',
  },
  {
    test: (token) => /^ol\.(.)\1{23,}$/.test(token),
    why: 'one character repeated, which is how the tests write a token that is long enough to parse',
  },
];

function publicToken(token: string): string | null {
  return PUBLIC_TOKENS.find((known) => known.test(token))?.why ?? null;
}

/** Shows enough of a secret to find it, never enough to use it. */
function mask(secret: string): string {
  return `${secret.slice(0, 8)}... (${secret.length} characters)`;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'reference', 'spikes', 'data', 'dist', 'coverage', '.next', '.next-verify']);
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.db', '.woff', '.woff2', '.mp4']);
const MAX_FILE_BYTES = 2_000_000;
const MAX_LISTED = 60;
const EXCERPT_CHARS = 160;

interface Match {
  pattern: string;
  where: string;
  excerpt: string;
  /** Set when a detector says the matched text is real key material. */
  found: { detector: string; sample: string } | null;
}

/**
 * The committed attack captures hold the forged and throwaway tokens the other
 * attacks sent on purpose, so their diffs are dropped from the history sweep
 * for the same reason the folder is skipped in the working tree.
 */
function withoutOwnOutput(diff: string): string {
  const sections = diff.split(/^(?=diff --git )/m);
  return sections
    .filter((section) => !section.startsWith('diff --git a/docs/security/attacks/'))
    .join('');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // The sweep's own output holds the forged tokens the other attacks sent on
      // purpose, so reading it back would flag the previous run's captures.
      const ownOutput = dir.endsWith(join('docs', 'security')) && entry.name === 'attacks';
      if (!SKIP_DIRS.has(entry.name) && !ownOutput) {
        walk(join(dir, entry.name), out);
      }
      continue;
    }

    // .env holds the real key and is gitignored. It is checked for existence
    // and for being ignored, further down, and never read.
    if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) {
      continue;
    }

    const dot = entry.name.lastIndexOf('.');
    if (dot > 0 && SKIP_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
      continue;
    }

    out.push(join(dir, entry.name));
  }

  return out;
}

/** Looks at the matched text itself, not the line around it, and says what it is. */
function judge(line: string): { detector: string; sample: string } | null {
  const key = ANTHROPIC_KEY.exec(line);
  if (key?.[0]) {
    return { detector: 'an Anthropic key in its published shape', sample: mask(key[0]) };
  }

  const token = OWNER_TOKEN_SHAPE.exec(line);
  if (token?.[0] && publicToken(token[0]) === null) {
    return { detector: 'an owner token long enough to open the API', sample: mask(token[0]) };
  }

  const assignment = KEY_ASSIGNMENT.exec(line);
  if (assignment?.[0]) {
    return { detector: 'a private key or seed phrase with a value assigned', sample: mask(assignment[0]) };
  }

  return null;
}

function scan(text: string, where: (line: number) => string): Match[] {
  const matches: Match[] = [];

  text.split('\n').forEach((line, index) => {
    for (const pattern of PATTERNS) {
      if (pattern.test.test(line)) {
        matches.push({
          pattern: pattern.name,
          where: where(index + 1),
          excerpt: line.trim().slice(0, EXCERPT_CHARS),
          found: pattern.name === 'wallet address' ? null : judge(line),
        });
      }
    }
  });

  return matches;
}

function render(matches: Match[]): string {
  const shown = matches.slice(0, MAX_LISTED);
  const lines = shown.map((match) => `[${match.pattern}] ${match.where}: ${match.excerpt}`);
  if (matches.length > shown.length) {
    lines.push(`... and ${matches.length - shown.length} more of the same kinds`);
  }
  return lines.length === 0 ? 'no matches' : lines.join('\n');
}

async function git(args: string[]): Promise<{ ok: boolean; out: string }> {
  const result = await execa('git', args, { cwd: REPO, reject: false, all: true });
  return { ok: result.exitCode === 0, out: (result.all ?? '').trim() };
}

async function run(): Promise<AttackResult> {
  const steps: AttackStep[] = [];

  const files = walk(REPO).filter((path) => statSync(path).size <= MAX_FILE_BYTES);
  const treeMatches: Match[] = [];

  for (const path of files) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const shortPath = relative(REPO, path).split(sep).join('/');
    treeMatches.push(...scan(text, (line) => `${shortPath}:${line}`));
  }

  steps.push(
    step(
      [
        `Read every file in ${REPO} and looked for ${PATTERNS.map((pattern) => pattern.name).join(', ')}.`,
        `Skipped: ${[...SKIP_DIRS].join(', ')}, binary file types, files over ${MAX_FILE_BYTES} bytes, and .env itself,`,
        'which holds the real key, is gitignored, and is checked separately below rather than read.',
        `Files read: ${files.length}.`,
        '',
        'Every match is listed below. A match counts as key material only if the matched text is',
        'an Anthropic key in its published shape, a private key or seed phrase with a value, or a',
        'token that starts with ol. and is long enough to open the API and is not one of these,',
        'which this repo publishes on purpose:',
        ...PUBLIC_TOKENS.map((known) => `  - ${known.why}`),
      ].join('\n'),
      render(treeMatches),
    ),
  );

  const history = await git(['log', '-p', '--all']);
  const historyMatches = history.ok
    ? scan(withoutOwnOutput(history.out), (line) => `git log -p --all, line ${line}`)
    : [];

  steps.push(
    step(
      'git log -p --all, then the same patterns over every line of it.',
      history.ok
        ? [`history is ${history.out.split('\n').length} lines long`, '', render(historyMatches)].join('\n')
        : [
            'git answered:',
            history.out,
            '',
            'So there is no history to sweep yet. Nothing in this repo has been committed at the',
            'time of this run, which also means nothing has been pushed. The sweep of the working',
            'tree above is what stands, and this attack has to be run again after the first commit.',
          ].join('\n'),
    ),
  );

  const ignored = await git(['check-ignore', '-v', '.env', 'data/olai.db', 'data/binance-mcp-token.json', 'packages/agent/data/olai.db']);
  steps.push(step('git check-ignore -v .env data/olai.db data/binance-mcp-token.json packages/agent/data/olai.db', ignored.out || '(nothing is ignored)'));

  const exampleKeys = readFileSync(join(REPO, '.env.example'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
  steps.push(
    step(
      'Read .env.example and listed every setting it carries, with whatever value is filled in.',
      exampleKeys.join('\n'),
    ),
  );

  const found = [...treeMatches, ...historyMatches].filter((match) => match.found !== null);
  const walletMentions = treeMatches.filter((match) => match.pattern === 'wallet address');
  const envIgnored = ignored.out.includes('.env');
  const blocked = found.length === 0 && envIgnored;

  const note = [
    `The owner's wallet address ${WALLET_ADDRESS} appears ${walletMentions.length} times, in`,
    `${[...new Set(walletMentions.map((match) => match.where.split(':')[0]))].join(', ')}.`,
    'That is on purpose: it is a public address, it is what a judge checks the on-chain payments',
    'against, and it is not key material. It is listed here so nobody has to wonder whether the',
    'sweep saw it.',
    '',
    'The other matches above are the word, not the thing: the "ol." prefix constant in the auth',
    'code, the instructions in .env.example, the fake tokens in the tests, the wrong tokens the',
    'attacks send on purpose, and the token this run boots its own throwaway service with. Each',
    'one was judged on the matched text, not on the line around it, against the rules printed in',
    'step 1, and none of them can open anything.',
    '',
    'What this cannot do is recognise a secret it has no pattern for. A Binance session token, for',
    'instance, is an opaque string with no shape to match on, so the check that keeps it safe is',
    'the gitignore line above, not this sweep.',
  ].join('\n');

  return {
    id: 'ATTACK-12',
    name: 'sweeping the repo and the git history for secrets',
    notProved:
      'that no secret has ever leaked, or that the next commit will be clean. It is a snapshot, and it can only find the five patterns it knows about.',
    expected:
      'no Anthropic key, no owner token and no Binance token anywhere in the tree or the history, .env ignored by git, and .env.example carrying blank placeholders only.',
    steps,
    blocked,
    note,
    ...(blocked
      ? {}
      : {
          finding: found.length > 0
            ? `Key material found:\n${found.map((match) => `${match.where}: ${match.found?.detector}, ${match.found?.sample}`).join('\n')}`
            : 'git check-ignore did not confirm that .env is ignored.',
        }),
  };
}

export const attack: Attack = {
  id: 'ATTACK-12',
  name: 'sweeping the repo and the git history for secrets',
  run,
};
