import { loggedInvoke } from '@/utils/logged-invoke';

/** Memo lifecycle status — mirrors `kasirmu_core::memo::MemoStatus`. */
export type MemoStatus = 'draft' | 'published' | 'expired' | 'stopped' | 'archived';

/** Memo display duration — mirrors `kasirmu_core::memo::MemoDuration`. */
export type MemoDuration = '12h' | '24h' | '3d' | '7d' | '30d';

/** Per-terminal delivery state — mirrors `kasirmu_core::memo::DeliveryStatus`. */
export type DeliveryStatus = 'pending' | 'delivered' | 'acknowledged';

/** A memo, as returned over the wire (camelCase — matches `MemoDto`). */
export interface Memo {
  id: string;
  tenantId: string;
  /** Locations the memo targets; empty ⇒ Organization Memo (all locations). */
  locationIds: string[];
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
 * Display cadence served by the backend with the memo list (matches
 * `MemoCadenceDto`). The server is the single source of truth for the
 * notification intervals — `kasirmu_core::memo` derives the KDS value as 2 × the
 * base — and the UI schedules its polls from these values instead of
 * hardcoding the literals.
 */
export interface MemoCadence {
  /** Base notification interval in seconds (all non-KDS surfaces). */
  baseIntervalSecs: number;
  /** KDS interval in seconds (2 × base, derived server-side). */
  kdsIntervalSecs: number;
}

/** Response envelope of `list_active_memos_scoped` (matches `MemoDisplayDto`). */
export interface ActiveMemosResponse {
  memos: ActiveMemo[];
  cadence: MemoCadence;
}

/**
 * List the memos the caller's terminal should display, Location Memos stacked
 * above Organization Memos, plus the server-issued poll cadence.
 * Authenticated-only — the recipient set is already terminal-scoped by the
 * backend fan-out (scoped — ADR #7).
 */
export const listActiveMemosScoped = (sessionToken: string): Promise<ActiveMemosResponse> =>
  loggedInvoke<ActiveMemosResponse>('list_active_memos_scoped', { sessionToken });

/**
 * Acknowledge a memo on the caller's terminal. Authenticated-only (scoped —
 * ADR #7).
 */
export const acknowledgeMemoScoped = (sessionToken: string, memoId: string): Promise<void> =>
  loggedInvoke<void>('acknowledge_memo_scoped', { sessionToken, memoId });

/** Arguments for creating a memo draft (matches `CreateMemoArgs`). */
export interface CreateMemoArgs {
  /**
   * Targeted location ids; empty/omitted ⇒ Organization Memo (the empty set
   * is the organization-wide audience). One or more ⇒ the memo targets
   * exactly those locations. The store trims and dedupes the ids.
   */
  locationIds?: string[];
  title: string;
  body: string;
  /** Display duration; defaults to `24h` when omitted. */
  duration?: MemoDuration;
}

/**
 * Create a memo draft as the authenticated author. Requires `memo:write`
 * (scoped — ADR #7).
 */
export const createMemoScoped = (
  sessionToken: string,
  args: CreateMemoArgs,
): Promise<Memo> =>
  loggedInvoke<Memo>('create_memo_scoped', {
    sessionToken,
    args: { ...args, locationIds: args.locationIds ?? [] },
  });

/**
 * Publish a draft memo. Requires `memo:write` (scoped — ADR #7). Publishing
 * stamps the expiry, snapshots immutable revision 1, and fans out one pending
 * recipient per target terminal.
 */
export const publishMemoScoped = (sessionToken: string, memoId: string): Promise<Memo> =>
  loggedInvoke<Memo>('publish_memo_scoped', { sessionToken, memoId });

/**
 * Early-stop a published memo (`published → stopped`): it leaves every
 * display surface immediately. Authorization is the 2026-09-07 A2 ruling —
 * the author may always stop their own; anyone else must hold `memo:stop`
 * (Owner/Admin presets).
 */
export const stopMemoScoped = (sessionToken: string, memoId: string): Promise<Memo> =>
  loggedInvoke<Memo>('stop_memo_scoped', { sessionToken, memoId });

/** Corrected content for a published memo. */
export interface ReviseMemoArgs {
  title: string;
  body: string;
}

/**
 * Revise a published memo: inserts a new immutable revision (v + 1) and
 * never extends the memo's lifetime. Requires `memo:write` (scoped — ADR #7).
 */
export const reviseMemoScoped = (
  sessionToken: string,
  memoId: string,
  args: ReviseMemoArgs,
): Promise<Memo> =>
  loggedInvoke<Memo>('revise_memo_scoped', { sessionToken, memoId, args });

/**
 * List every memo authored by the session user, newest first — the
 * management read behind the authoring screen (matches
 * `list_memos_authored_by`). Requires `memo:write` (scoped — ADR #7).
 */
export const listAuthoredMemosScoped = (sessionToken: string): Promise<Memo[]> =>
  loggedInvoke<Memo[]>('list_authored_memos_scoped', { sessionToken });
