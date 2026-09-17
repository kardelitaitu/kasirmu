/**
 * Dev-mock handlers — Regional configuration and the receipt-format axis
 * (regional slices 2-3, saas-2 design).
 *
 * Moved verbatim out of `tauri-api.ts` by
 * todo-refactor-devmock-router-consolidation.md Phase 5.1: the regional
 * read/write pair and the receipt format/layout/content trio shared one
 * section banner and one design in the router, and no later phase owned the
 * regional pair — left alone they would have stranded two keys in
 * `entryHandlers` past Phase 5.5. The receipt trio is the regional
 * receipt-format axis (same banner in the router), so the five travel
 * together.
 *
 * The location rows stay owned by `handlers/locationState.ts`; this module
 * consumes them through injected deps — the createCatalogHandlers /
 * createSalesHandlers / createLocationsHandlers precedent the consolidation
 * is measured against.
 */
import { MOCK_STORE } from '../core/mockSeedData';
import type { MockHandler } from '../core/mockDispatcher';
import type { UnwrapArgs } from './catalog';
import type { getMockStores, updateMockLocation } from './locationState';

export interface RegionalDeps {
  unwrapArgs: UnwrapArgs;
  getMockStores: typeof getMockStores;
  updateMockLocation: typeof updateMockLocation;
}

// ═══════════════════════════════════════════════════════════════
// REGIONAL CONFIGURATION (regional slice 2, saas-2 design)
// ═══════════════════════════════════════════════════════════════
// Read model mirroring kasirmu_core::RegionalConfig, which the command returns
// directly — snake_case fields, ConfigScope serde scope names ("location",
// "legal_entity", "organization", "built_in"). ADR #48: timezone.value is
// the STORED IANA name; offsets are derived at display/report time, never
// here.

/** One resolved regional axis as the dev mock serves it. */
interface MockRegionalValue {
  value: string;
  scope: 'location' | 'legal_entity' | 'organization' | 'built_in';
}

/** The effective regional configuration as the dev mock serves it. */
interface MockRegionalConfig {
  location_id: string;
  legal_entity_id: string | null;
  country_code: string | null;
  locale: MockRegionalValue;
  timezone: MockRegionalValue;
  currency: MockRegionalValue;
}

// ── Receipt format (regional receipt-format axis) ───────────────────
// One closed record per scope: content on the entity (statutory),
// layout on workspace/terminal (presentational, terminal over
// workspace over legacy). Session-local maps — the mock mirrors the
// core `Store::effective_receipt_format` semantics loosely, enough
// for the card's states.
interface MockReceiptLayout {
  paper_width_mm: number | null;
  margin_top_mm: number | null;
  margin_bottom_mm: number | null;
  margin_left_mm: number | null;
  margin_right_mm: number | null;
  show_logo: boolean | null;
  print_copies: number | null;
  show_table_number: boolean | null;
  footer_note: string | null;
}
interface MockReceiptContent {
  requiredFields: string[];
  footerText: string;
  showTax: boolean;
  showCurrency: boolean;
  decimalSeparator: string;
}

/** The regional read/write pair and the receipt format trio, over their
 *  session-local state — same scope as the router block they left. */
export function createRegionalHandlers(deps: RegionalDeps): Record<string, MockHandler> {
  const { unwrapArgs, getMockStores, updateMockLocation } = deps;

  /** Written locale overrides per location id (slice 3 write model): the mock
   *  location rows predate the locale column, so writes land here instead of
   *  on the row. Blank = cleared (inherit). */
  const mockRegionalLocale = new Map<string, string>();

  /** The written market anchor (slice 3): the mock has no entity rows, so the
   *  entity-layer country_code is one module-level value. */
  let mockRegionalCountryCode: string | null = null;

  /** Resolve the regional config for a mock location: the location's own
   *  columns (plus slice-3 write overrides) first, then the built-in defaults
   *  — the same narrowest-first precedence the core resolver applies. The real
   *  backend also walks the legal-entity layer for its blank regional columns,
   *  which the mock cannot model: its LegalEntityDto (like the real one)
   *  carries no regional fields. */
  function getMockRegionalConfig(args: unknown): MockRegionalConfig {
    const { locationId } = unwrapArgs<{ locationId?: string }>(args);
    const stores = getMockStores();
    const location = stores.find((loc) => loc.id === locationId) ?? stores[0] ?? MOCK_STORE;
    const axis = (value: string, fallback: string): MockRegionalValue =>
      value.trim() !== '' ? { value, scope: 'location' } : { value: fallback, scope: 'built_in' };
    const writtenLocale = mockRegionalLocale.get(location.id) ?? '';
    return {
      location_id: location.id,
      // The migration seed links every location to this entity id; the mock
      // has no entity rows to walk, so it is surfaced verbatim.
      legal_entity_id: 'default:default-legal-entity',
      country_code: mockRegionalCountryCode,
      locale: axis(writtenLocale, 'en-US'),
      timezone: axis(location.timezone, 'UTC'),
      currency: axis(location.currency, 'USD'),
    };
  }

  /** The slice-3 write: validate nothing here (the real backend validates in
   *  core; the mock's job is only to answer non-null), mutate the mock rows,
   *  and return the re-resolved config read-after-write. */
  function setMockRegionalConfig(args: unknown): MockRegionalConfig {
    const { locationId, config } = unwrapArgs<{
      locationId?: string;
      config?: { locale?: string; timezone?: string; currency?: string; country_code?: string };
    }>(args);
    const stores = getMockStores();
    const location = stores.find((loc) => loc.id === locationId) ?? stores[0] ?? MOCK_STORE;
    if (config?.locale !== undefined) mockRegionalLocale.set(location.id, config.locale);
    if (config?.timezone !== undefined) {
      updateMockLocation({ id: location.id, timezone: config.timezone });
    }
    if (config?.currency !== undefined) {
      updateMockLocation({ id: location.id, currency: config.currency });
    }
    if (config?.country_code !== undefined) {
      mockRegionalCountryCode = config.country_code.trim() !== '' ? config.country_code : null;
    }
    return getMockRegionalConfig(args);
  }

  const mockReceiptLayouts = new Map<string, MockReceiptLayout>();
  let mockReceiptContent: MockReceiptContent | null = null;

  /** The effective read: content is unset in the mock (entity-layer
   *  authoring is a management surface), layout resolves terminal →
   *  workspace → built-in defaults with the same provenance names. */
  function getMockReceiptFormat(args: unknown): {
    content: MockReceiptContent | null;
    content_source: string;
    layout: {
      paperWidthMm: number | null;
      marginTopMm: number | null;
      marginBottomMm: number | null;
      marginLeftMm: number | null;
      marginRightMm: number | null;
      showLogo: boolean | null;
      printCopies: number | null;
      showTableNumber: boolean | null;
      footerNote: string | null;
    };
    layout_source: string;
  } {
    const { terminalId, workspaceId } = unwrapArgs<{
      terminalId?: string;
      workspaceId?: string;
    }>(args);
    const location =
      getMockStores().find((loc) => loc.id === workspaceId) ?? getMockStores()[0] ?? MOCK_STORE;
    const terminalKey = terminalId ? `terminal:${terminalId}` : null;
    const workspaceKey = `workspace:${workspaceId ?? location.id}`;
    const terminal = terminalKey ? mockReceiptLayouts.get(terminalKey) : undefined;
    const workspace = mockReceiptLayouts.get(workspaceKey);
    const layer = terminal ?? workspace;
    const source = terminal ? 'terminal' : workspace ? 'workspace' : 'unset';
    const pick = <T,>(terminalValue: T | null | undefined, workspaceValue: T | null | undefined): T | null =>
      terminal ? (terminalValue ?? null) : (workspaceValue ?? null);
    return {
      content: mockReceiptContent,
      content_source: mockReceiptContent ? 'entity' : 'unset',
      layout: {
        paperWidthMm: layer ? pick(terminal?.paper_width_mm, workspace?.paper_width_mm) : null,
        marginTopMm: pick(terminal?.margin_top_mm, workspace?.margin_top_mm),
        marginBottomMm: pick(terminal?.margin_bottom_mm, workspace?.margin_bottom_mm),
        marginLeftMm: pick(terminal?.margin_left_mm, workspace?.margin_left_mm),
        marginRightMm: pick(terminal?.margin_right_mm, workspace?.margin_right_mm),
        showLogo: pick(terminal?.show_logo, workspace?.show_logo),
        printCopies: pick(terminal?.print_copies, workspace?.print_copies),
        showTableNumber: pick(terminal?.show_table_number, workspace?.show_table_number),
        footerNote: pick(terminal?.footer_note, workspace?.footer_note),
      },
      layout_source: source,
    };
  }

  /** The card's write: replace the workspace-layer layout record (the card
   *  edits the whole record) and return the fresh effective read. */
  function setMockReceiptLayout(args: unknown): ReturnType<typeof getMockReceiptFormat> {
    const { workspaceId, layout } = unwrapArgs<{
      workspaceId?: string;
      layout?: {
        paperWidthMm?: number | null;
        marginTopMm?: number | null;
        marginBottomMm?: number | null;
        marginLeftMm?: number | null;
        marginRightMm?: number | null;
        showLogo?: boolean | null;
        printCopies?: number | null;
        showTableNumber?: boolean | null;
        footerNote?: string | null;
      };
    }>(args);
    const location =
      getMockStores().find((loc) => loc.id === workspaceId) ?? getMockStores()[0] ?? MOCK_STORE;
    if (layout) {
      mockReceiptLayouts.set(`workspace:${location.id}`, {
        paper_width_mm: layout.paperWidthMm ?? null,
        margin_top_mm: layout.marginTopMm ?? null,
        margin_bottom_mm: layout.marginBottomMm ?? null,
        margin_left_mm: layout.marginLeftMm ?? null,
        margin_right_mm: layout.marginRightMm ?? null,
        show_logo: layout.showLogo ?? null,
        print_copies: layout.printCopies ?? null,
        show_table_number: layout.showTableNumber ?? null,
        footer_note: layout.footerNote ?? null,
      });
    }
    return getMockReceiptFormat(args);
  }

  /** The statutory-content write (W2-C): replaces the one content record
   *  and returns the fresh effective read. The mock mirrors the core
   *  upsert semantics session-locally — exactly one content row per
   *  entity, so a second write replaces the first. */
  function setMockReceiptContent(args: unknown): ReturnType<typeof getMockReceiptFormat> {
    const { content } = unwrapArgs<{
      content?: {
        requiredFields?: string[];
        footerText?: string;
        showTax?: boolean;
        showCurrency?: boolean;
        decimalSeparator?: string;
      };
    }>(args);
    if (content) {
      mockReceiptContent = {
        requiredFields: content.requiredFields ?? [],
        footerText: content.footerText ?? '',
        showTax: content.showTax ?? true,
        showCurrency: content.showCurrency ?? false,
        decimalSeparator: content.decimalSeparator ?? 'dot',
      };
    }
    return getMockReceiptFormat(args);
  }

  return {
    // Regional configuration read model (regional slice 2). Registered here
    // because scripts/verify-ipc-parity.py treats a missing dev-mock handler
    // as a hard violation: invoke() would return null and the caller would
    // silently render its failure path instead of erroring.
    // Legal Entity (Organization-level, Phase 1 §G) obeys the same parity
    // rule and lives in handlers/locations.ts.
    'get_regional_config_scoped': getMockRegionalConfig,
    // Regional configuration write path (regional slice 3) — same parity rule.
    'set_regional_config_scoped': setMockRegionalConfig,
    // Receipt format (regional receipt-format axis) — same parity rule.
    'get_receipt_format_scoped': getMockReceiptFormat,
    'set_receipt_layout_scoped': setMockReceiptLayout,
    'set_receipt_content_scoped': setMockReceiptContent,
  };
}
