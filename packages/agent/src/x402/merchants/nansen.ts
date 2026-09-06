import { z } from 'zod';
import type { BuyRequest } from '../buyer.js';

/**
 * Nansen's address balance endpoint, one cent a call through the B402 Bazaar.
 *
 * The Bazaar blob describes the call as method GET with a JSON body, which fetch
 * cannot send. A live probe on 2026-09-06 showed the same endpoint answers a POST
 * with the same 402 and echoes "POST" back in its own blob, so Olai sends POST.
 */

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const nansenCurrentBalanceSchema = z
  .object({
    address: z.string().trim().min(32),
    chain: z.enum(['ethereum', 'bsc', 'solana', 'base']),
  })
  .refine(
    (value) =>
      value.chain === 'solana'
        ? SOLANA_ADDRESS.test(value.address)
        : EVM_ADDRESS.test(value.address),
    { message: 'address does not match the chain it was given with', path: ['address'] },
  );

export function nansenCurrentBalance(p: {
  address: string;
  chain: 'ethereum' | 'bsc' | 'solana' | 'base';
}): BuyRequest {
  const { address, chain } = nansenCurrentBalanceSchema.parse(p);

  return {
    url: 'https://api.nansen.ai/api/v1/profiler/address/current-balance',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      address,
      chain,
      hide_spam_token: true,
      pagination: { page: 1, per_page: 10 },
    },
  };
}
