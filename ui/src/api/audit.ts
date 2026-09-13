// ── Audit Log ─────────────────────────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** A single audit log entry recording an action performed by a user. */
export interface AuditEntryDto {
  id: string;
  user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string;
  outcome: string;
  created_at: string;
}

/** Server-filtered, keyset-paginated page of audit entries (AUD-02/AUD-03). */
export interface AuditLogPageDto {
  items: AuditEntryDto[];
  total: number;
  has_more: boolean;
}

/** Arguments for the store-scoped audit query (AUD-01/02/03). */
export interface ListAuditLogScopedArgs {
  limit?: number;
  outcome?: string;
  query?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
}

/**
 * Server-filtered, keyset-paginated audit log for the session's store
 * (AUD-01/02/03). The session resolves the store and user server-side and
 * `audit:view` is enforced; filtering + counts run in the store DB.
 */
export const listAuditLogScoped = (
  sessionToken: string,
  args: ListAuditLogScopedArgs,
): Promise<AuditLogPageDto> =>
  loggedInvoke<AuditLogPageDto>('list_audit_log_scoped', { sessionToken, args });

// ── Organization-level security trail ─────────────────────────────

/**
 * Same page contract as the general audit query, on purpose: the backend
 * returns `AuditLogPageDto` for both and filters/paginates identically, so a
 * caller that already handles one handles this one too.
 */
export type ListSecurityEventsScopedArgs = ListAuditLogScopedArgs;

/**
 * Server-filtered, keyset-paginated SECURITY trail for the whole
 * organization: logins, failed logins, logouts and staff account changes.
 *
 * Two things differ from `listAuditLogScoped`, and both change what a caller
 * has to do:
 *
 * - It reads the GLOBAL identity database, not the session's store. Staff,
 *   roles and sessions are tenant-global (ADR #4 / ADR #7), so scoping this
 *   trail per store would silently show a subset of who authenticated into
 *   the organization. A store-bound session still sees every store's events,
 *   and there is deliberately no store filter to pass.
 * - A Free-tier session is REFUSED, not shown an empty page: the backend
 *   gates on the audit tier before `audit:view`, and the error is the signal
 *   that the feature is unavailable. Treat an empty list as "no security
 *   events" and nothing else — it does not mean "no access".
 *
 * Not every action in the trail has a display label yet: the catalog in
 * `features/audit/auditCatalog.ts` maps what it maps, and an unmapped action
 * renders as the fallback label rather than failing. The label lives in the
 * shared locale family, so adding one is a shared.ftl change, not a change
 * here.
 */
export const listSecurityEventsScoped = (
  sessionToken: string,
  args: ListSecurityEventsScopedArgs,
): Promise<AuditLogPageDto> =>
  loggedInvoke<AuditLogPageDto>('list_security_events_scoped', { sessionToken, args });

// ── Review checkpoints (AUD-04) ───────────────────────────────────

/** A persisted server-side review checkpoint (AUD-04). */
export interface ReviewCheckpointDto {
  id: string;
  store_id: string;
  reviewer_user_id: string;
  reviewed_at: string;
  reviewed_through_created_at: string;
  reviewed_through_id: string;
}

/** Latest checkpoint + server-side unreviewed count (AUD-04). */
export interface AuditReviewStatusDto {
  checkpoint: ReviewCheckpointDto | null;
  unreviewed_count: number;
}

/** Fetch the session store's latest review checkpoint + unreviewed count. */
export const getAuditReviewStatusScoped = (
  sessionToken: string,
): Promise<AuditReviewStatusDto> =>
  loggedInvoke<AuditReviewStatusDto>('get_audit_review_status_scoped', { sessionToken });

/** Mark the audit log reviewed up to the given high-water mark (AUD-04). */
export const markAuditReviewedScoped = (
  sessionToken: string,
  args: { reviewedThroughCreatedAt: string; reviewedThroughId: string },
): Promise<ReviewCheckpointDto> =>
  loggedInvoke<ReviewCheckpointDto>('mark_audit_reviewed_scoped', { sessionToken, args });

// ── Export (AUD-09) ───────────────────────────────────────────────

/** Arguments for the server-side audit export (AUD-09). */
export interface ExportAuditLogArgs {
  outcome?: string;
  query?: string;
}

/** Result of a server-side audit export (AUD-09). */
export interface AuditExportDto {
  /** RFC-4180 CSV artifact (UTF-8 BOM + header + rows, newest first). */
  csv: string;
  /** Number of rows exported. */
  row_count: number;
  /** ISO-8601 generation timestamp. */
  generated_at: string;
  /** User who requested the export. */
  requested_by: string;
}

/**
 * Export the session store's audit log to CSV (AUD-09). Server-side: the
 * session selects the store and user, `audit:export` is enforced, and an
 * `audit.export` event records the filter scope + row count.
 */
export const exportAuditLogScoped = (
  sessionToken: string,
  args: ExportAuditLogArgs,
): Promise<AuditExportDto> =>
  loggedInvoke<AuditExportDto>('export_audit_log_scoped', { sessionToken, args });

/** Arguments for the security-event export (owner ruling D61-7, design D84). */
export interface SecurityEventExportArgs {
  /** Exact `user_id` (or `system`) to filter on; omit for all actors. */
  actor?: string | null;
  /** Inclusive `YYYY-MM-DD` lower bound; normalized at the IPC layer. */
  dateFrom?: string | null;
  /** Exclusive `YYYY-MM-DD` upper bound (+1 day at the IPC layer). */
  dateTo?: string | null;
}

/**
 * Export only the security-event rows (SECURITY_ACTIONS allowlist) to CSV
 * (owner ruling D61-7, design D84). Same `AuditExportDto` artifact as the
 * full AUD-09 export; the actor/date bounds are normalized server-side
 * before the core filtered export runs.
 */
export const exportSecurityEventsScoped = (
  sessionToken: string,
  args: SecurityEventExportArgs,
): Promise<AuditExportDto> =>
  loggedInvoke<AuditExportDto>('export_security_events_scoped', { sessionToken, args });
