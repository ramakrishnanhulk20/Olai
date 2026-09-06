/**
 * What a merchant charges is written in base units of a token, so "10000000000000000"
 * means one cent of an 18 decimal BSC stablecoin. Olai has to turn that into dollars
 * before it can decide whether a call is inside its budget, and it must never guess:
 * an unknown token gives a null price and Olai treats that as "do not buy".
 */

export interface KnownToken {
  symbol: string;
  decimals: number;
}

/**
 * Every token seen carrying a price in the live Bazaar catalog and in the 402
 * responses from Nansen and CoinMarketCap on 2026-09-06. BSC stablecoins are all
 * 18 decimals, Base USDC and Solana USDC are 6.
 */
const KNOWN_TOKENS: Record<string, KnownToken> = {
  'eip155:56|0x55d398326f99059ff775485246999027b3197955': { symbol: 'USDT', decimals: 18 },
  'eip155:56|0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDC', decimals: 18 },
  'eip155:56|0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': { symbol: 'USD1', decimals: 18 },
  'eip155:56|0xce24439f2d9c6a2289f741120fe202248b666666': { symbol: 'U', decimals: 18 },
  'eip155:8453|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  'solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp|epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v': {
    symbol: 'USDC',
    decimals: 6,
  },
};

/**
 * The three chains the Binance Agentic Wallet can sign an x402 payment on.
 * Ethereum, Arbitrum, Polygon, Monad and the rest are listed by merchants but the
 * wallet refuses them, so a resource that only offers those is not payable for us.
 */
export function isWalletPayableNetwork(network: string): boolean {
  return network === 'eip155:56' || network === 'eip155:8453' || network.startsWith('solana:');
}

/**
 * A live 402 sends `scheme: "exact"` and puts the transfer method in
 * `extra.assetTransferMethod`, while the Bazaar catalog flattens the two into one
 * field, so the same Nansen endpoint reads as "exact" from the merchant and
 * "permit2-exact" from the catalog. Both describe a payment the wallet can sign.
 */
const PAYABLE_SCHEMES = new Set(['exact', 'eip3009', 'permit2-exact', 'permit2', 'spl-transfer']);

export function isWalletPayableScheme(scheme: string): boolean {
  return PAYABLE_SCHEMES.has(scheme.toLowerCase());
}

export function knownToken(network: string, asset: string): KnownToken | null {
  return KNOWN_TOKENS[`${network.toLowerCase()}|${asset.toLowerCase()}`] ?? null;
}

/**
 * Converts a base unit amount to a dollar number without going through floating
 * point twice. One cent of an 18 decimal token is 10^16, which is already past the
 * range where a double counts whole numbers exactly, so the split is done in BigInt
 * and only the final short decimal string becomes a number.
 *
 * Returns null when the amount is not a whole positive number, because a price we
 * cannot read is a price we will not pay.
 */
export function usdFromBaseUnits(amount: string, decimals: number): number | null {
  if (!/^\d+$/.test(amount.trim())) {
    return null;
  }

  const raw = BigInt(amount.trim());
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0');

  return Number(`${whole}.${fraction}`);
}

export interface PricedAccept {
  network: string;
  asset: string;
  amount: string;
}

/**
 * Prices a resource from the first payment option whose token Olai knows.
 * Merchants list the same price in several tokens, so the first known one is the
 * price of the call. Null means no listed token is in the table above.
 */
export function priceUsdFromAccepts(accepts: readonly PricedAccept[]): number | null {
  for (const accept of accepts) {
    const token = knownToken(accept.network, accept.asset);
    if (token) {
      const usd = usdFromBaseUnits(accept.amount, token.decimals);
      if (usd !== null) {
        return usd;
      }
    }
  }

  return null;
}
