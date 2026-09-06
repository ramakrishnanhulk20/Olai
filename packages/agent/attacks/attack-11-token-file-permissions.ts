/**
 * ATTACK-11: reading the Binance token file off the disk.
 *
 * What this does NOT prove: that the file is safe from anyone with the machine.
 * It is not, on any platform: whoever can read the file can act as Olai against
 * the live MCP server until Binance expires or revokes the session. All this
 * measures is what the operating system was asked for and what it actually
 * reports back on the host the run happened on.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BinanceOAuth } from '../src/mcp/oauth.js';
import { step } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const FAKE_ACCESS_TOKEN = 'attack-run-fake-access-token-not-a-real-binance-token';

const HERE = dirname(fileURLToPath(import.meta.url));
const OAUTH_SOURCE = join(HERE, '..', 'src', 'mcp', 'oauth.ts');

/** The lines in the source that decide the file's permissions, quoted from the file itself. */
function quoteSource(): string {
  const lines = readFileSync(OAUTH_SOURCE, 'utf8').split('\n');
  const wanted = lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter((entry) => /TOKEN_FILE_MODE|chmod|Windows has no POSIX|mode: /.test(entry.text));

  return wanted.map((entry) => `src/mcp/oauth.ts:${entry.line}: ${entry.text.trim()}`).join('\n');
}

async function run(): Promise<AttackResult> {
  const dir = mkdtempSync(join(tmpdir(), 'olai-attack-11-'));
  const tokenPath = join(dir, 'binance-mcp-token.json');
  const steps: AttackStep[] = [];

  try {
    const oauth = new BinanceOAuth({
      mcpUrl: 'https://agent.binance.com/mcp/agentic',
      publicBaseUrl: 'https://olai-attack-run.invalid',
      tokenPath,
      clientName: 'Olai',
    });

    await oauth.authProvider().saveTokens({ access_token: FAKE_ACCESS_TOKEN, token_type: 'Bearer' });

    const stat = statSync(tokenPath);
    const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');

    steps.push(
      step(
        [
          'Wrote a token through the same path the real sign-in uses:',
          `  new BinanceOAuth({ tokenPath: "${tokenPath}", ... }).authProvider().saveTokens({ access_token: "...", token_type: "Bearer" })`,
          'then read the file and its permissions back.',
        ].join('\n'),
        [
          `platform: ${process.platform}`,
          `file: ${tokenPath}`,
          `mode reported by fs.statSync: 0${mode}`,
          '',
          'contents:',
          readFileSync(tokenPath, 'utf8').trim(),
        ].join('\n'),
      ),
    );

    steps.push(step('What the code asks the operating system for, quoted from the source:', quoteSource()));

    const onWindows = process.platform === 'win32';
    const blocked = !onWindows && (stat.mode & 0o777) === 0o600;

    const note = onWindows
      ? [
          'This run happened on Windows, where POSIX permission bits do not exist. Node reports',
          `0${mode} because the file is writable, not because anyone has been granted or denied`,
          'access: the number is derived from the read-only attribute alone. The chmod the code',
          'makes after every write is caught and ignored here, which the source comment says',
          'plainly. On macOS or Linux the same code produces mode 0600, owner read and write only.',
          'What actually guards this file on Windows is the NTFS access control list on the user',
          'profile directory, which Olai does not set and does not check.',
        ].join('\n')
      : undefined;

    return {
      id: 'ATTACK-11',
      name: 'reading the Binance token file and its permissions',
      notProved:
        'that the token file is protected from anyone with the machine. It is plain JSON on disk on every platform. This only measures the permissions the code asks for and what this host reports.',
      expected:
        'mode 0600 on POSIX, set by TOKEN_FILE_MODE in src/mcp/oauth.ts and reapplied with chmod after every write. On Windows the threat model says this attack should report the gap instead.',
      steps,
      blocked,
      ...(note === undefined ? {} : { note }),
      ...(blocked
        ? {}
        : {
            finding: onWindows
              ? `On this Windows host the token file is written with no owner-only permission of any kind. fs.statSync reports 0${mode}, and the chmod to 0600 that the code performs is a no-op the code catches and ignores. Any process running as this user, and any account with read access to the user profile, can read ${tokenPath.replace(dir, '<token dir>')} and use the Binance session in it. This is the platform gap the threat model names in its ATTACK-11 entry, not a change in behaviour found by this run.`
              : `The token file came back with mode 0${mode}, not 0600.`,
          }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

export const attack: Attack = {
  id: 'ATTACK-11',
  name: 'reading the Binance token file and its permissions',
  run,
};
