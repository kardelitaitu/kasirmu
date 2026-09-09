import { loggedInvoke } from '@/utils/logged-invoke';

// ── Receipt format (regional receipt-format axis) ───────────────────

/** Who answered for a receipt-format group (mirrors
 *  `oz_core::db::receipt_formats::ReceiptSource`'s serde names). */
export type ReceiptSource = 'entity' | 'terminal' | 'workspace' | 'legacy' | 'unset';

/** The statutory content half (legal-entity scope). The wire mirrors
 *  `oz_core::db::receipt_formats::ReceiptContent`'s camelCase serde. */
export interface ReceiptContent {
  /** Market-mandated element codes (closed enum, enforced server-side). */
  requiredFields: string[];
  /** Footer text (empty = none). */
  footerText: string;
  /** Whether the tax line prints. */
  showTax: boolean;
  /** Whether amounts carry the currency symbol prefix. */
  showCurrency: boolean;
  /** `dot` | `comma` | `none`. */
  decimalSeparator: string;
}

/** The presentational layout half (workspace/terminal scope). `null`
 *  fields fall through to the next layer. */
export interface ReceiptLayout {
  /** Paper width in mm (20–120). */
  paperWidthMm: number | null;
  /** Margins in mm (≥ 0). */
  marginTopMm: number | null;
  marginBottomMm: number | null;
  marginLeftMm: number | null;
  marginRightMm: number | null;
  /** Whether the store logo prints. */
  showLogo: boolean | null;
  /** How many copies to print (≥ 0). */
  printCopies: number | null;
  /** Whether the table number line prints. */
  showTableNumber: boolean | null;
  /** Optional presentational footer note (≤ 500 chars). */
  footerNote: string | null;
}

/** The effective receipt format with group-level provenance. */
export interface EffectiveReceiptFormat {
  /** Statutory content, or `null` when nothing is configured. */
  content: ReceiptContent | null;
  /** Who answered for content. */
  contentSource: ReceiptSource;
  /** Merged layout. */
  layout: ReceiptLayout;
  /** Who answered for layout. */
  layoutSource: ReceiptSource;
}

/** One layout submission from the card (whole-record write). */
export interface ReceiptLayoutArgs {
  paperWidthMm: number | null;
  marginTopMm: number | null;
  marginBottomMm: number | null;
  marginLeftMm: number | null;
  marginRightMm: number | null;
  showLogo: boolean | null;
  printCopies: number | null;
  showTableNumber: boolean | null;
  footerNote: string | null;
}

/** Get the effective receipt format (ADR #7 scoped, gated `settings:read`
 *  server-side). `workspaceId` scopes the layout group when the caller
 *  knows it. */
export const getReceiptFormatScoped = (
  sessionToken: string,
  terminalId: string | null,
  workspaceId: string | null,
): Promise<EffectiveReceiptFormat> =>
  loggedInvoke<EffectiveReceiptFormat>('get_receipt_format_scoped', {
    sessionToken,
    terminalId,
    workspaceId,
  });

/** Replace the workspace-layer layout record (the card's whole-record
 *  write) and get the freshly effective format back (gated
 *  `settings:edit` server-side). */
export const setReceiptLayoutScoped = (
  sessionToken: string,
  workspaceId: string,
  layout: ReceiptLayoutArgs,
): Promise<EffectiveReceiptFormat> =>
  loggedInvoke<EffectiveReceiptFormat>('set_receipt_layout_scoped', {
    sessionToken,
    workspaceId,
    layout,
  });

/** One statutory-content submission from the card (whole-record write;
 *  `required_fields` is validated against the closed element enum in
 *  core, inside the write transaction). */
export interface ReceiptContentArgs {
  requiredFields: string[];
  footerText: string;
  showTax: boolean;
  showCurrency: boolean;
  decimalSeparator: string;
}

/** Replace the primary legal entity's statutory content record (ADR #7
 *  scoped, gated `settings:edit` server-side; the entity is resolved
 *  server-side through the store's primary location and the write fails
 *  closed without one). Returns the freshly effective format. */
export const setReceiptContentScoped = (
  sessionToken: string,
  content: ReceiptContentArgs,
): Promise<EffectiveReceiptFormat> =>
  loggedInvoke<EffectiveReceiptFormat>('set_receipt_content_scoped', {
    sessionToken,
    content,
  });
