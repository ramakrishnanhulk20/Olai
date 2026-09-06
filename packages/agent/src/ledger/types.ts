/**
 * The shapes of everything the ledger records.
 *
 * The web app and the agent both import these, so a change here is a change to
 * the public record format and to the hash of every line written after it.
 */

export type LedgerKind =
  | 'rulebook.set'
  | 'question'
  | 'discovery'
  | 'payment.preview'
  | 'payment.signed'
  | 'payment.settled'
  | 'data.received'
  | 'proposal'
  | 'approval'
  | 'rejection'
  | 'order.sent'
  | 'order.filled'
  | 'order.failed'
  | 'rule.refused'
  | 'kill'
  | 'resume'
  | 'note';

export type LedgerActor = 'owner' | 'agent' | 'rulebook' | 'binance' | 'merchant' | 'system';

export interface LedgerEntryInput {
  kind: LedgerKind;
  actor: LedgerActor;
  payload: Record<string, unknown>;
  costUsd?: number;
  txHash?: string;
  orderId?: string;
  sessionId?: string;
}

export interface LedgerEntry extends LedgerEntryInput {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

export const ledgerKinds: readonly LedgerKind[] = [
  'rulebook.set',
  'question',
  'discovery',
  'payment.preview',
  'payment.signed',
  'payment.settled',
  'data.received',
  'proposal',
  'approval',
  'rejection',
  'order.sent',
  'order.filled',
  'order.failed',
  'rule.refused',
  'kill',
  'resume',
  'note',
];

export const ledgerActors: readonly LedgerActor[] = [
  'owner',
  'agent',
  'rulebook',
  'binance',
  'merchant',
  'system',
];

/** Thrown when a caller hands the ledger something it refuses to record. */
export class LedgerError extends Error {
  override name = 'LedgerError';
}
