-- 20260925_receipt_formats.sql
--
-- Regional configuration, receipt-format axis — the LAST missing axis of
-- saas-2 L167 (todo-global-saas-2.md design, slice queue; supervisor-
-- ratified verdict B: dedicated scoped rows, one closed record per scope).
--
-- Two record kinds share the table, split by OWNER exactly as the design
-- maps them:
--   * scope_type = 'legal_entity' → the CONTENT record: what MUST appear
--     on a receipt in this market (closed element-code enum, footer text,
--     display flags, decimal separator). Statutory — NOT overridable
--     downstream (a site cannot silently drop a market-mandated element).
--   * scope_type = 'workspace' | 'terminal' → the LAYOUT record:
--     presentational — paper width, margins, print copies, logo, optional
--     footer note. Terminal overrides workspace per field (deep-merge,
--     terminal wins), mirroring the entity→location override of slice 6.
--
-- `config` is a JSON bag (validated at the core write boundary — closed
-- element enum for content, field shapes for layout). `paper_width_mm` is
-- a dedicated column, not bag data, so the fixed-point rule gets a
-- DB-layer CHECK (supervisor addition 3): nonsense widths fail at the DB,
-- not only at the write boundary. NULL = scope kind has no width (content
-- rows) or width unset (layout falls through to workspace/legacy).
--
-- Legacy compat: the 10 org-global `settings` keys (receipt.footer,
-- receipt.paper_width, receipt.show_tax, receipt.show_currency,
-- receipt.decimal_separator, receipt.show_table_number, receipt.margin_top,
-- receipt.margin_bottom, receipt.margin_left, receipt.margin_right) remain
-- the read fallback when no scoped row exists — pinned by test (exact key
-- list) so the fallback cannot drift when the settings-rebuild stream
-- retires keys. No data migration, no dual write; the legacy
-- ReceiptSection keeps rendering until that stream retires it.
--
-- RLS: tenant_id stamped from birth, RLS_EXEMPT like slices 5-6
-- (desktop-local write paths; parents already exempt).

CREATE TABLE IF NOT EXISTS receipt_formats (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL DEFAULT 'default',
    scope_type     TEXT NOT NULL CHECK (scope_type IN ('legal_entity', 'workspace', 'terminal')),
    scope_id       TEXT NOT NULL,
    config         TEXT NOT NULL DEFAULT '{}',
    paper_width_mm INTEGER CHECK (paper_width_mm IS NULL OR (paper_width_mm BETWEEN 20 AND 120)),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (scope_type, scope_id)
);

CREATE INDEX idx_receipt_formats_scope
    ON receipt_formats(scope_type, scope_id);