// ── Fiscal schemes + statutory numbering (regional slice 5) ─────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** A legal entity's statutory number series: prefix + counter + reset
 *  policy. Mirrors the backend's DocumentNumberSequence (camelCase wire —
 *  the Rust struct carries #[serde(rename_all = "camelCase")]). */
export interface DocumentNumberSequence {
  id: string;
  legalEntityId: string;
  documentKind: string;
  /** Statutory prefix, emitted verbatim before the number. */
  prefix: string;
  /** The last issued ordinal (0 = nothing issued yet). */
  currentValue: number;
  /** "never" | "daily" | "monthly" | "yearly". */
  resetPeriod: string;
  /** The period bucket the current value belongs to (empty for "never"). */
  periodKey: string;
  /** Zero-pad width for the issued ordinal (0 = no padding). */
  padding: number;
  createdAt: string;
  updatedAt: string;
}

/** Arguments for creating or reconfiguring one statutory number series.
 *  The upsert is keyed on (legalEntityId, documentKind) — the table's
 *  UNIQUE pair — so one call covers both create and reconfiguration. The
 *  counter is NEVER reset by a reconfiguration (a statutory series must
 *  not gap). */
export interface UpsertDocumentNumberSequenceArgs {
  legalEntityId: string;
  /** The document kind this series numbers (e.g. "receipt", "invoice"). */
  documentKind: string;
  prefix: string;
  /** "never" | "daily" | "monthly" | "yearly". */
  resetPeriod: string;
  /** Zero-pad width for the issued ordinal (0 = no padding). */
  padding: number;
}

/** Read the statutory number series for one legal entity and document
 *  kind. Returns null when the pair is not configured — the honest
 *  "no statutory numbering" answer, not an error. */
export const getDocumentNumberSequenceScoped = (
  sessionToken: string,
  legalEntityId: string,
  documentKind: string,
): Promise<DocumentNumberSequence | null> =>
  loggedInvoke<DocumentNumberSequence | null>('get_document_number_sequence_scoped', {
    sessionToken,
    legalEntityId,
    documentKind,
  });

/** Create or reconfigure the statutory number series for one legal entity
 *  and document kind. Gated settings:edit on the backend. */
export const upsertDocumentNumberSequenceScoped = (
  sessionToken: string,
  args: UpsertDocumentNumberSequenceArgs,
): Promise<void> =>
  loggedInvoke<void>('upsert_document_number_sequence_scoped', { sessionToken, args });
