import { z } from 'zod';
import {
  isWalletPayableNetwork,
  isWalletPayableScheme,
  priceUsdFromAccepts,
} from './tokens.js';

/**
 * The B402 Bazaar is Binance's public index of paid endpoints. It needs no key and
 * no account: an agent searches it, reads the price, and pays the merchant directly.
 * This client is the only place in Olai that talks to it.
 */

export interface BazaarAccept {
  scheme: string;
  network: string;
  asset: string;
  maxAmountRequired: string;
  payTo: string;
}

export interface BazaarResource {
  url: string;
  type: string;
  x402Version: number;
  description: string;
  accepts: BazaarAccept[];
  lastUpdated: number;
  priceUsd: number | null;
  walletPayable: boolean;
}

export class BazaarError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BazaarError';
  }
}

const acceptSchema = z.looseObject({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  maxAmountRequired: z.string(),
  payTo: z.string(),
});

const resourceSchema = z.looseObject({
  resource: z.string(),
  type: z.string().default('http'),
  x402Version: z.number(),
  description: z.string().nullish(),
  accepts: z.array(acceptSchema).default([]),
  lastUpdated: z.number().default(0),
});

const searchDataSchema = z.looseObject({
  resources: z.array(resourceSchema).default([]),
});

const listDataSchema = z.looseObject({
  items: z.array(resourceSchema).default([]),
  pagination: z
    .looseObject({ total: z.number().default(0) })
    .default({ total: 0 }),
});

const envelopeSchema = z.looseObject({
  code: z.string(),
  message: z.string().nullish(),
  // A rejected request answers with an error code and sometimes no data key.
  data: z.unknown().optional(),
  success: z.boolean().nullish(),
});

const SUCCESS_CODE = '000000';

// The search endpoint caps limit at 20 and has no cursor, so Olai always asks for
// the full page and trims afterwards. Trimming late matters because the price
// filter below runs on our side.
const SEARCH_PAGE_SIZE = 20;

const REQUEST_TIMEOUT_MS = 15_000;

type RawResource = z.infer<typeof resourceSchema>;

function toResource(raw: RawResource): BazaarResource {
  const accepts: BazaarAccept[] = raw.accepts.map((accept) => ({
    scheme: accept.scheme,
    network: accept.network,
    asset: accept.asset,
    maxAmountRequired: accept.maxAmountRequired,
    payTo: accept.payTo,
  }));

  const walletPayable =
    raw.x402Version === 2 &&
    accepts.some(
      (accept) => isWalletPayableNetwork(accept.network) && isWalletPayableScheme(accept.scheme),
    );

  return {
    url: raw.resource,
    type: raw.type,
    x402Version: raw.x402Version,
    description: raw.description ?? '',
    accepts,
    lastUpdated: raw.lastUpdated,
    priceUsd: priceUsdFromAccepts(
      accepts.map((accept) => ({
        network: accept.network,
        asset: accept.asset,
        amount: accept.maxAmountRequired,
      })),
    ),
    walletPayable,
  };
}

export class BazaarClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl: string; fetch?: typeof fetch }) {
    if (!opts.baseUrl) {
      throw new BazaarError('BAD_CONFIG', 'BazaarClient needs a baseUrl');
    }

    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /**
   * Keyword search across the catalog.
   *
   * maxUsdPrice is applied here rather than sent upstream: the Bazaar's own
   * maxUsdPrice parameter returned an empty list for every value tried on
   * 2026-09-06, including values far above the most expensive listing, so relying
   * on it would make Olai believe there is nothing it can afford. Resources whose
   * token Olai cannot price are dropped by the filter as well, since an unpriced
   * call is one Olai will not pay for.
   */
  async search(q: {
    query: string;
    maxUsdPrice?: number;
    network?: string;
    limit?: number;
  }): Promise<BazaarResource[]> {
    const query = q.query?.trim();
    if (!query) {
      throw new BazaarError('BAD_INPUT', 'search needs a query');
    }

    const params = new URLSearchParams({ query, limit: String(SEARCH_PAGE_SIZE) });
    if (q.network) {
      params.set('network', q.network);
    }

    const data = searchDataSchema.parse(await this.get('/bazaar/search', params));
    let resources = data.resources.map(toResource);

    if (typeof q.maxUsdPrice === 'number') {
      const cap = q.maxUsdPrice;
      resources = resources.filter(
        (resource) => resource.priceUsd !== null && resource.priceUsd <= cap,
      );
    }

    return resources.slice(0, q.limit ?? SEARCH_PAGE_SIZE);
  }

  /** Paginated walk of the whole catalog, newest listings first. */
  async list(q?: { limit?: number; offset?: number }): Promise<{
    items: BazaarResource[];
    total: number;
  }> {
    const params = new URLSearchParams({
      limit: String(q?.limit ?? 25),
      offset: String(q?.offset ?? 0),
    });

    const data = listDataSchema.parse(await this.get('/bazaar/resources', params));

    return { items: data.items.map(toResource), total: data.pagination.total };
  }

  private async get(path: string, params: URLSearchParams): Promise<unknown> {
    const url = `${this.baseUrl}${path}?${params.toString()}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BazaarError('NETWORK', `Bazaar request failed: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new BazaarError(`HTTP_${response.status}`, `Bazaar returned HTTP ${response.status}`);
    }

    const envelope = envelopeSchema.parse(await response.json());

    if (envelope.code !== SUCCESS_CODE) {
      throw new BazaarError(envelope.code, envelope.message ?? 'Bazaar rejected the request');
    }

    return envelope.data;
  }
}
