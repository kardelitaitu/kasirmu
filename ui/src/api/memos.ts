import { loggedInvoke } from '@/utils/logged-invoke';

/** Memo lifecycle status — mirrors `oz_core::memo::MemoStatus`. */
export type MemoStatus = 'draft' | 'published' | 'expired' | 'stopped' | 'archived';

/** Memo display duration — mirrors `oz_core::memo::MemoDuration`. */
export type MemoDuration = '12h' | '24h' | '3d' | '7d' | '30d';

/** Per-terminal delivery state — mirrors `oz_core::memo::DeliveryStatus`. */
export type DeliveryStatus = 'pending' | 'delivered' | 'acknowledged';

/** A memo, as returned over the wire (camelCase — matches `MemoDto`). */
export interface Memo {
  id: string;
  tenantId: string;
  /** `null` ⇒ Organization Memo; a value ⇒ Location Memo for that location. */
  locationId: string | null;
  authorUserId: string;
  authorRole: string;
  title: string;
  body: string;
  status: MemoStatus;
  duration: MemoDuration;
  revision: number;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** A memo plus this terminal's delivery state (matches `ActiveMemoDto`). */
export interface ActiveMemo {
  memo: Memo;
  deliveryStatus: DeliveryStatus;
}

/**
 * List the memos the caller's terminal should display, Location Memos stacked
 * above Organization Memos. Authenticated-only — the recipient set is already
 * terminal-scoped by the backend fan-out (scoped — ADR #7).
 */
export const listActiveMemosScoped = (sessionToken: string): Promise<ActiveMemo[]> =>
  loggedInvoke<ActiveMemo[]>('list_active_memos_scoped', { sessionToken });

/**
 * Acknowledge a memo on the caller's terminal. Authenticated-only (scoped —
 * ADR #7).
 */
export const acknowledgeMemoScoped = (sessionToken: string, memoId: string): Promise<void> =>
  loggedInvoke<void>('acknowledge_memo_scoped', { sessionToken, memoId });
