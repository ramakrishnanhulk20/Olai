import type { BuyRequest } from '../buyer.js';
import { cmcQuotesLatest } from './cmc.js';
import { nansenCurrentBalance } from './nansen.js';

/**
 * The request shape of the merchants Olai has already paid successfully.
 *
 * The Bazaar listing gives a URL, a price and a sentence of prose, and nothing
 * about the body a merchant expects. In a live session Olai picked Nansen, sent
 * an empty GET, was told HTTP 400 and gave up on paid data for the rest of the
 * question. These hints are the answer: a proven method and a working example
 * body, attached to the listing before the model ever sees it.
 */

export interface MerchantHint {
  method: 'GET' | 'POST';
  describe: string;
  example: BuyRequest;
}

const NANSEN_PATH = 'api.nansen.ai/api/v1/profiler/address/current-balance';
const CMC_PATH = 'pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest';

// The address Nansen's own listing documents. It is Binance's hot wallet, which
// makes it a sensible default for a question about exchange flows.
const DEFAULT_ADDRESS = '0x28c6c06298d514db089934071355e5743bf21d60';
const DEFAULT_SYMBOL = 'BNB';

/**
 * The example must always build, so a context value the merchant's own schema
 * rejects falls back to the documented one rather than throwing at the model.
 */
function nansenExample(address: string | undefined): BuyRequest {
  try {
    return nansenCurrentBalance({ address: address ?? DEFAULT_ADDRESS, chain: 'ethereum' });
  } catch {
    return nansenCurrentBalance({ address: DEFAULT_ADDRESS, chain: 'ethereum' });
  }
}

function cmcExample(symbol: string | undefined): BuyRequest {
  try {
    return cmcQuotesLatest({ symbol: symbol ?? DEFAULT_SYMBOL });
  } catch {
    return cmcQuotesLatest({ symbol: DEFAULT_SYMBOL });
  }
}

/**
 * The proven request for one Bazaar URL, or null for a merchant Olai has never
 * paid. The context fills in the parts that change from question to question:
 * the wallet address for Nansen, the ticker for CoinMarketCap.
 */
export function hintFor(
  url: string,
  context: { address?: string; symbol?: string },
): MerchantHint | null {
  if (url.includes(NANSEN_PATH)) {
    return {
      method: 'POST',
      describe: "POST a JSON body {address, chain}; returns the wallet's current token balances",
      example: nansenExample(context.address),
    };
  }

  if (url.includes(CMC_PATH)) {
    return {
      method: 'GET',
      describe: 'GET with ?symbol=; returns the latest quote',
      example: cmcExample(context.symbol),
    };
  }

  return null;
}
