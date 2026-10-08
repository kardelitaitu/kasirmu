-- ── RLS cutover COMPLETION: FORCE the seven tables the 20261002 cutover missed ──
--
-- WHY THIS EXISTS
-- ===============
-- `scripts/rls-cutover.sql` is the primary cutover (roles + grants + FORCE). It
-- FORCEs 22 tables. The generated PG schema carries a `tenant_isolation` policy
-- on 29 (RLS_TABLES in scripts/generate-pg-migration.py, the documented source
-- of truth). Live production answers:
--
--     GET https://license.kasir.mu/health -> "rls_posture":"bypassed_by_owner_role"
--
-- `bypassed_by_owner_role` means ZERO tables are FORCEd today, so tenant
-- isolation is inert: the app connects as the table owner, and an owner bypasses
-- its own policies unless FORCE is set. Running the 20261002 script as written
-- would move the posture to `partially_enforced` (22 of 29), NOT `enforced` —
-- and `report_rls_posture` treats anything but `enforced` as an ERROR, so the
-- alarm would still be red after a production schema change.
--
-- This file closes the remaining 7. It is deliberately SEPARATE from
-- scripts/rls-cutover.sql because that script is executed VERBATIM by two tests
-- (include_str! at apps/cloud-server/src/db_tests.rs:955 and
-- src/webhooks_tests.rs:964), and both pin its current behaviour — editing it in
-- place would change what those tests prove, in the same commit that changes
-- what production runs. Two files make the delta reviewable.
--
-- ORDERING: run scripts/rls-cutover.sql FIRST (it creates the roles and the
-- grants), then this file. Both are idempotent and safe to re-run.
--
-- THE SEVEN, AND WHY EACH IS SAFE
-- ===============================
-- Verified 2026-10-06 by grepping every writer in the repo. "No PG writer" means
-- no production INSERT/UPDATE reaches Postgres for that table, so a FORCEd policy
-- has no write path to block — it can only ever *deny* an unscoped read, which is
-- the intended fail-closed behaviour.
--
--   sale_lines              PG writer: kasirmu-api/src/pg/sales.rs (create_sale).
--                           IN a GUC-scoped transaction — set_config at :64
--                           precedes the INSERT at :137. The 20261002 script
--                           deferred this one pending exactly this audit; the
--                           audit is done and it passes.
--   sale_idempotency        PG writer: pg/sales.rs claim_sale_idempotency.
--                           set_config at :265 precedes the INSERT at :271.
--   locations               NO production PG writer (0 hits under kasirmu-api/src).
--                           Its writers are SQLite-local (kasirmu-core/db/locations.rs).
--   edc_terminals           NO PG writer. Writer is kasirmu-core/db/edc_terminals.rs
--                           (SQLite-local); nothing syncs it to PG.
--   receipt_number_counters NO PG writer. Writer is kasirmu-core/db/receipt_code.rs
--                           (SQLite-local); nothing syncs it to PG.
--   entity_index_cursors    NO WRITER AT ALL — 0 write references repo-wide.
--   entity_index_tombstones NO WRITER AT ALL — 0 write references repo-wide.
--
-- If a PG write path later lands for one of the "no writer" tables, that path MUST
-- set `oz.tenant_id` in its transaction first, or its writes fail closed (a
-- rejected write, not a leak). That is the correct direction to fail.

-- Idempotent: FORCE is a no-op on a table already forced, and PostgreSQL raises
-- no error for re-setting it.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'sale_lines',
        'sale_idempotency',
        'locations',
        'edc_terminals',
        'receipt_number_counters',
        'entity_index_cursors',
        'entity_index_tombstones'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
-- Expect 29 of 29 as (rowsecurity, forcerowsecurity) = (t, t).
-- The list is RLS_TABLES verbatim — the same 29 the generated schema creates
-- policies for. (The 20261002 script's own verification query listed 21 and
-- omitted midtrans_transactions; this one is the full set.)
--
--   SELECT tablename, rowsecurity, forcerowsecurity
--     FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename = ANY(ARRAY[
--        'bundle_items','edc_terminals','entity_index_cursors','entity_index_tombstones',
--        'locations','memo_locations','memo_recipients','memos','midtrans_transactions',
--        'offline_queue','product_activity','product_bundles','product_taxes',
--        'product_variants','products','receipt_number_counters','refunds',
--        'sale_idempotency','sale_lines','sales','sent_reports','stripe_customers',
--        'sync_conflicts','sync_entity_vectors','sync_terminals','tax_rates',
--        'tenant_plans','tenant_subscription','users'])
--    ORDER BY tablename;
--
-- After this file: /health must report "rls_posture":"enforced".
-- If it reports "partially_enforced", compare the query above against the
-- expected 29 rows to find which table did not take FORCE.
