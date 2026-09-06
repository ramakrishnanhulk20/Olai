/**
 * ATTACK-13: a preflight from a site that is not the dashboard.
 *
 * What this does NOT prove: that another site cannot reach this API at all.
 * CORS is a rule browsers keep, not a lock on the door. A script outside a
 * browser, with the owner token, gets an answer whatever the origin says. What
 * this stops is the case that matters here: a page the owner is logged into
 * somewhere else talking their browser into spending their money.
 */

import { OWNER_TOKEN, call, startService } from './harness.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const EVIL = 'https://evil.example';
const DASHBOARD = 'http://localhost:3000';

async function run(): Promise<AttackResult> {
  const harness = await startService({ name: 'attack-13' });
  const steps: AttackStep[] = [];

  try {
    const evil = await call(harness.base, '/api/rulebook', {
      method: 'OPTIONS',
      headers: {
        origin: EVIL,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    steps.push(evil);

    const dashboard = await call(harness.base, '/api/rulebook', {
      method: 'OPTIONS',
      headers: {
        origin: DASHBOARD,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    steps.push({
      tried: ['The same preflight from the one origin the config does allow, for contrast:', '', dashboard.tried].join('\n'),
      raw: dashboard.raw,
    });

    const withToken = await call(harness.base, '/api/rulebook', {
      token: OWNER_TOKEN,
      headers: { origin: EVIL },
    });
    steps.push({
      tried: ['A real read from the same origin, with the owner token, to show what CORS does and does not do:', '', withToken.tried].join('\n'),
      raw: withToken.raw,
    });

    const evilAllow = evil.headers.get('access-control-allow-origin');
    const dashboardAllow = dashboard.headers.get('access-control-allow-origin');
    const readAllow = withToken.headers.get('access-control-allow-origin');

    const blocked = evilAllow === null && readAllow === null && dashboardAllow === DASHBOARD;

    return {
      id: 'ATTACK-13',
      name: 'a CORS preflight from https://evil.example',
      notProved:
        'that another site cannot call this API. CORS is enforced by browsers, not by the server. Anything holding the owner token can call it from anywhere, which is why the token is the real control.',
      expected:
        'no Access-Control-Allow-Origin header on the answer, so a browser refuses to hand the response to the page. The dashboard origin, and only that one, gets the header.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `The preflight from ${EVIL} came back with Access-Control-Allow-Origin: ${String(evilAllow)}, and the read came back with ${String(readAllow)}.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-13',
  name: 'a CORS preflight from https://evil.example',
  run,
};
