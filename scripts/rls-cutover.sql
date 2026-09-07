-- ── RLS deployment cutover: restricted app role + FORCE ROW LEVEL SECURITY ──
--
-- Turns the schema-side tenant isolation (already shipped: `ENABLE ROW LEVEL
-- SECURITY` + a `tenant_isolation` policy on every tenant-scoped table, keyed
-- on the `oz.tenant_id` session GUC) into ACTIVE enforcement.
--
-- Today the app connects as the table owner, which bypasses RLS entirely, so
-- the policies ship inert. This script is the cutover: it creates a
-- restricted non-owner role (`oz_app`), grants it DML on the tenant tables,
-- and sets FORCE ROW LEVEL SECURITY so the owner bypass no longer applies.
-- From then on, every query that touches a tenant table must run with
-- `oz.tenant_id` set or it returns ZERO rows (and writes are rejected).
--
-- Run as a superuser / the database owner against the cloud database:
--
--     psql "$DATABASE_URL" -f scripts/rls-cutover.sql
--
-- The app connection must then use the `oz_app` role. To use a different
-- role name, sed-replace `oz_app` below (the test in
-- `apps/cloud-server/src/db.rs` executes this file verbatim, so keep the
-- body pure SQL — no psql-only directives like \set).
--
-- The tenant-scoped table list MUST stay in sync with `RLS_SQL` in
-- `scripts/generate-pg-migration.py` (that array is the source of truth —
-- it is applied to the generated PG schema at deploy time).
--
-- Behaviour after cutover:
--   * Every request transaction must set `SET LOCAL oz.tenant_id = '<tenant>'
--     as its first statement (the cloud server's sync data layer already does
--     this in `apps/cloud-server/src/sync_store.rs`); the local setting
--     auto-resets when the transaction ends, so a pooled connection can never
--     leak one tenant's GUC to the next borrower.
--   * Signature-authenticated webhook paths (Stripe/Square) are not tenant-
--     authenticated: the tenant is *resolved* from the data (the
--     `stripe_customers` mapping, or the `payments -> sales` join) before
--     any tenant-scoped write. The two resolution reads therefore run in a
--     transaction scoped to the dedicated `oz_webhook_resolver` role
--     (BYPASSRLS, step 2c) — a non-owner could not read those rows without
--     the GUC, and the tenant is not known until the read returns. Every
--     write after resolution (mapping upsert, `finalize_sale` enqueue, plan
--     update) runs as `oz_app` with `SET LOCAL oz.tenant_id`, so RLS still
--     guards those writes.
--   * `SELECT COUNT(DISTINCT tenant_id) FROM offline_queue` (the /status
--     global counter) intentionally runs without the GUC and reads 0 under
--     enforcement — it is an operator-facing aggregate, not tenant data.
--
-- Every statement is idempotent and safe to re-run, so the script can be
-- executed as-is (psql autocommit). To make it reversible, wrap it in a
-- transaction and roll back — the whole body is transactional DDL (CREATE
-- ROLE, GRANT, ALTER TABLE ... FORCE all roll back atomically):
--
--     BEGIN; \i scripts/rls-cutover.sql; ROLLBACK;
--
-- Or reverse a committed cutover with:
--
--     ALTER TABLE ... NO FORCE ROW LEVEL SECURITY  (all 19 tables)
--     DROP ROLE oz_app;
--     DROP ROLE oz_webhook_resolver;

-- 1. Restricted app role (idempotent; NOLOGIN by default — the operator
--    enables login and sets a strong password afterwards):
--        ALTER ROLE oz_app LOGIN PASSWORD '<strong>';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_app') THEN
        CREATE ROLE oz_app NOLOGIN;
    END IF;
END $$;

-- 2. DML on every tenant-scoped table (same list as RLS_SQL in
--    scripts/generate-pg-migration.py — keep them in sync).
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bundle_items','memo_locations','memo_recipients',
                            'memos','offline_queue','product_activity',
                            'product_bundles','product_taxes','product_variants',
                            'products','refunds','sales','sent_reports','stripe_customers',
                            'sync_terminals','tax_rates','tenant_plans',
                            'tenant_subscription','users']
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO oz_app', t
        );
    END LOOP;
    EXECUTE 'GRANT USAGE ON SCHEMA public TO oz_app';
END $$;

-- 2b. DML on the tables the REST layer touches that the main list above
--     does not yet FORCE. Two buckets: (a) tables with NO tenant_id column
--     at all — children of tenant-scoped parents (inventory /
--     stock_movements / stock_summary→products) or shared catalogs
--     (categories, roles); (b) `sale_lines`, which DOES carry tenant_id and
--     is RLS-ENABLEd in init, but whose FORCE (and main-list grant move) is
--     deferred until live-PG verification proves every REST path touching
--     it sets the GUC first — same deferral bucket as locations /
--     media_assets / user_location_access. Without these grants the REST
--     surface fails with permission denied the moment FORCE RLS is
--     switched on for the main list.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sale_lines','inventory','stock_movements',
                            'stock_summary','categories','roles']
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO oz_app', t
        );
    END LOOP;
END $$;

-- 2c. Webhook resolution role. The webhook handlers are signature-
--     authenticated but NOT tenant-authenticated: they resolve the tenant
--     from the data (stripe_customers mapping, payments->sales join) before
--     any tenant-scoped write. As a non-owner, oz_app cannot read those
--     rows without the tenant GUC — and the whole point of the lookup is to
--     learn the tenant. The handlers therefore wrap the two resolution reads
--     in a transaction scoped to this role (`SET LOCAL ROLE
--     oz_webhook_resolver`, which auto-resets on commit). BYPASSRLS is
--     NOLOGIN and reachable only via membership (granted to oz_app below),
--     so it cannot be used interactively; the exposure is bounded to the
--     signature-verified webhook code path.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_webhook_resolver') THEN
        CREATE ROLE oz_webhook_resolver NOLOGIN BYPASSRLS;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO oz_webhook_resolver;
GRANT SELECT ON stripe_customers, sales, payments TO oz_webhook_resolver;
GRANT oz_webhook_resolver TO oz_app;

-- 2d. Cross-tenant discovery role. Three pre-tenant consumers share it:
--     (1) the email report sender enumerates tenants by reading
--     tenant_plans / offline_queue / sync_terminals BEFORE any tenant is
--     known (the whole point of discovery); (2) terminal client-credential
--     verification (verify_terminal_credentials) learns the tenant_id FROM
--     the sync_terminals row it matches, so it cannot set the GUC first;
--     (3) the hourly prune cycle is a GLOBAL maintenance task that deletes
--     rows across ALL tenants (offline_queue + sent_reports retention), so
--     it needs DELETE under FORCE RLS. As a non-owner, oz_app cannot read
--     those rows without the tenant GUC. All run in a transaction scoped to
--     this role (`SET LOCAL ROLE oz_email_discovery`, auto-resets on
--     commit) — same BYPASSRLS pattern as the webhook resolver. NOLOGIN,
--     reachable only via membership.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_email_discovery') THEN
        CREATE ROLE oz_email_discovery NOLOGIN BYPASSRLS;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO oz_email_discovery;
GRANT SELECT ON tenant_plans, offline_queue, sync_terminals TO oz_email_discovery;
GRANT SELECT, DELETE ON offline_queue, sent_reports TO oz_email_discovery;
GRANT oz_email_discovery TO oz_app;

-- 2e. The non-RLS tables the webhook path touches after resolution.
--     `processed_webhooks` (dedup) has no tenant_id column and `payments`
--     joins through sales.id — neither is RLS-enforced, but oz_app still
--     needs DML so dedup reads/records and the payment lookup work under
--     the restricted role.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['processed_webhooks','payments']
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO oz_app', t
        );
    END LOOP;
END $$;

-- 3. FORCE ROW LEVEL SECURITY: the owner bypass no longer applies, so a
--    missed `WHERE tenant_id = ?` fails closed instead of leaking.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bundle_items','memo_locations','memo_recipients',
                            'memos','offline_queue','product_activity',
                            'product_bundles','product_taxes','product_variants',
                            'products','refunds','sales','sent_reports','stripe_customers',
                            'sync_terminals','tax_rates','tenant_plans',
                            'tenant_subscription','users']
    LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- 4. Verification (informational — expect 19 rows, all `t`/`t`):
--    SELECT tablename, rowsecurity, forcerowsecurity
--      FROM pg_tables
--     WHERE schemaname = 'public'
--       AND tablename IN ('bundle_items','memo_locations','memo_recipients',
--                         'memos','offline_queue','product_activity',
--                         'product_bundles','product_taxes','product_variants',
--                         'products','refunds','sales','sent_reports','stripe_customers',
--                         'sync_terminals','tax_rates','tenant_plans',
--                         'tenant_subscription','users')
--     ORDER BY tablename;
