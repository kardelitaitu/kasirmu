-- 20260908_legal_entities.sql
--
-- Introduce the required Organization/Tenant -> Legal Entity -> Location
-- ownership level. Existing tenants receive one deterministic default entity,
-- and location identifiers remain unchanged while being linked to it.
--
-- `legal_entity_id` is intentionally nullable in this schema-only slice so
-- existing location writers remain compatible. The backend/API follow-up will
-- make the relationship mandatory on every new or moved location.

CREATE TABLE IF NOT EXISTS legal_entities (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    name                TEXT NOT NULL,
    legal_name          TEXT NOT NULL DEFAULT '',
    registration_number TEXT NOT NULL DEFAULT '',
    tax_id              TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_tenant
    ON legal_entities(tenant_id);

INSERT OR IGNORE INTO legal_entities (id, tenant_id, name, legal_name)
SELECT tenant_id || ':default-legal-entity', tenant_id,
       'Default Legal Entity', 'Default Legal Entity'
FROM (
    SELECT tenant_id FROM tenant_subscription
    UNION
    SELECT tenant_id FROM locations
) AS existing_tenants;

ALTER TABLE locations
    ADD COLUMN legal_entity_id TEXT
    REFERENCES legal_entities(id) ON DELETE RESTRICT;

UPDATE locations
SET legal_entity_id = tenant_id || ':default-legal-entity'
WHERE legal_entity_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_locations_legal_entity
    ON locations(legal_entity_id);
