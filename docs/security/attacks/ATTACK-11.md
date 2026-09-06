# ATTACK-11: reading the Binance token file and its permissions

Captured on 2026-09-06T11:58:03.822Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that the token file is protected from anyone with the machine. It is plain JSON on disk on every platform. This only measures the permissions the code asks for and what this host reports.

Expected outcome, from docs/security/threat-model.md section 5: mode 0600 on POSIX, set by TOKEN_FILE_MODE in src/mcp/oauth.ts and reapplied with chmod after every write. On Windows the threat model says this attack should report the gap instead.

## Step 1

What we tried:

```
Wrote a token through the same path the real sign-in uses:
  new BinanceOAuth({ tokenPath: "C:\Users\Ram\AppData\Local\Temp\olai-attack-11-J6oNr6\binance-mcp-token.json", ... }).authProvider().saveTokens({ access_token: "...", token_type: "Bearer" })
then read the file and its permissions back.
```

What came back:

```
platform: win32
file: C:\Users\Ram\AppData\Local\Temp\olai-attack-11-J6oNr6\binance-mcp-token.json
mode reported by fs.statSync: 0666

contents:
{
  "accessToken": "attack-run-fake-access-token-not-a-real-binance-token"
}
```

## Step 2

What we tried:

```
What the code asks the operating system for, quoted from the source:
```

What came back:

```
src/mcp/oauth.ts:2: import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
src/mcp/oauth.ts:67: const TOKEN_FILE_MODE = 0o600;
src/mcp/oauth.ts:402: mode: TOKEN_FILE_MODE,
src/mcp/oauth.ts:407: await chmod(this.cfg.tokenPath, TOKEN_FILE_MODE);
src/mcp/oauth.ts:409: // Windows has no POSIX permission bits. Nothing to tighten there.
```

## Note

This run happened on Windows, where POSIX permission bits do not exist. Node reports
0666 because the file is writable, not because anyone has been granted or denied
access: the number is derived from the read-only attribute alone. The chmod the code
makes after every write is caught and ignored here, which the source comment says
plainly. On macOS or Linux the same code produces mode 0600, owner read and write only.
What actually guards this file on Windows is the NTFS access control list on the user
profile directory, which Olai does not set and does not check.

## Finding

On this Windows host the token file is written with no owner-only permission of any kind. fs.statSync reports 0666, and the chmod to 0600 that the code performs is a no-op the code catches and ignores. Any process running as this user, and any account with read access to the user profile, can read <token dir>\binance-mcp-token.json and use the Binance session in it. This is the platform gap the threat model names in its ATTACK-11 entry, not a change in behaviour found by this run.

RESULT: NOT BLOCKED
