import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSignedQuery, signQuery } from '../../src/exchange/sign.js';

// What this file does NOT cover: whether Binance accepts the signature, which
// only a live signed call can answer, and clock skew against Binance's server
// time. Both belong to a run with a real key.

const SECRET = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';

describe('signQuery', () => {
  it('matches an HMAC-SHA256 computed on the side, in lowercase hex', () => {
    const query = 'symbol=BNBUSDT&side=BUY&type=MARKET&quoteOrderQty=12&timestamp=1700000000000';

    const expected = createHmac('sha256', SECRET).update(query).digest('hex');

    expect(signQuery(query, SECRET)).toBe(expected);
    expect(signQuery(query, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives a different digest for a different secret', () => {
    expect(signQuery('a=1', SECRET)).not.toBe(signQuery('a=1', `${SECRET}x`));
  });
});

describe('buildSignedQuery', () => {
  it('keeps the caller order, then timestamp, then recvWindow, then the signature', () => {
    const query = buildSignedQuery(
      { symbol: 'BNBUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 12 },
      { now: 1_700_000_000_000, recvWindowMs: 5000, secret: SECRET },
    );

    const [signed, signature] = query.split('&signature=');

    expect(signed).toBe(
      'symbol=BNBUSDT&side=BUY&type=MARKET&quoteOrderQty=12&timestamp=1700000000000&recvWindow=5000',
    );
    // The digest has to cover exactly the bytes that go on the wire, so it is
    // recomputed here from the string the caller will send.
    expect(signature).toBe(createHmac('sha256', SECRET).update(signed as string).digest('hex'));
  });

  it('escapes a value that would otherwise break the query string', () => {
    const query = buildSignedQuery(
      { newClientOrderId: 'olai session/1 2' },
      { now: 1, recvWindowMs: 5000, secret: SECRET },
    );

    expect(query.startsWith('newClientOrderId=olai+session%2F1+2&timestamp=1')).toBe(true);
  });
});
