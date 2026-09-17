-- 20260924_local_payment_methods.sql
--
-- Regional configuration Slice 6 (todo-global-saas-2.md design, slice queue
-- #6): the local-payment axis — "which rails exist in the market" — owned
-- by the legal entity with per-location overrides, per the §H map
-- ("local payment | legal entity → location | new scoped rows (Slice 6)").
--
-- Why a dedicated table and not the design's regional_settings KV: the KV
-- row of the design map is the RECEIPT FORMAT axis (L2621 → its slice-3
-- note at L2646); the local-payment row of the map says "new scoped rows"
-- (L2623). A market's rails are a list of multi-attribute rows (code,
-- label, enabled, parameters) whose integrity the KV cannot express —
-- UNIQUE per scope+rail and per-rail entity→location inheritance with an
-- explicit disable. §H calls payment rails "scoped resources owned at
-- legal-entity or location level" — resource language, not preference
-- language.
--
-- Deliberate separation from the tier system: `supports_qris` is a TIER
-- capability (license-server feature grants / entitlements caps DTO). This
-- table records which rails a MARKET offers and which a SITE enables; it
-- never imports or derives an entitlement, and no entitlement code reads
-- it. "The plan includes QRIS" and "this site offers QRIS" are different
-- facts (todo-global-saas-2.md:2579 — the pre-design state conflated them).
--
-- Deliberate separation from gateway credentials: `payment_gateways` owns
-- provider credentials and integration secrets. This table owns the MARKET
-- surface (which rails exist, what they are called, whether the site
-- offers them). A rail can be market-enabled with no gateway configured.
--
-- RLS: tenant_id stamped from birth (DEFAULT 'default', the desktop-only
-- convention) and RLS_EXEMPT for the same reason as slice 5's tables —
-- desktop-local write paths only, and the parent legal_entities is itself
-- exempt pending the cloud-sync decision. Covering later is a list-move in
-- the generator, not a migration.
--
-- No seed rows: an entity/location with no rows means "no market data
-- recorded" — the honest empty state, and the read model answers an empty
-- list.

CREATE TABLE IF NOT EXISTS local_payment_methods (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    scope_type  TEXT NOT NULL CHECK (scope_type IN ('legal_entity', 'location')),
    scope_id    TEXT NOT NULL,
    rail_code   TEXT NOT NULL,
    label       TEXT NOT NULL,
    is_enabled  INTEGER NOT NULL DEFAULT 1,
    parameters  TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (scope_type, scope_id, rail_code)
);

CREATE INDEX idx_local_payment_methods_scope
    ON local_payment_methods(scope_type, scope_id, is_enabled);