-- Audit retention sweep carve-out (todo-global-saas-2.md P1 "audit
-- baseline and retention schedule"; 20260920: renamed from 20260919 after
-- a concurrent agent claimed that ID for regional configuration; see
-- docs/security/data-residency-and-retention.md §3).
--
-- The audit_log immutability triggers from 20260813_init.sql RAISE(ABORT)
-- unconditionally, which is correct for tamper resistance but blocks the
-- tier retention sweep the adopted schedule requires ("expired audit data
-- is deleted or irreversibly anonymized"). This migration replaces the
-- DELETE trigger with a sweep-gated equivalent; the UPDATE trigger is
-- left absolutely immutable on purpose — no anonymization path exists,
-- deletion IS the implemented retention policy, and an updateable audit
-- row would be a strictly weaker guarantee for zero current need.
--
-- The carve-out mechanism: the trigger raises UNLESS a marker row exists
-- in the `settings` table (`audit.retention_sweep_active`). The sweep
-- (kasirmu_core::db::audit::sweep_audit_retention) inserts the marker, deletes
-- the expired rows, and clears the marker inside ONE transaction, so the
-- exemption is never visible outside a live sweep: a crash rolls the
-- marker back with the deletes (SQLite transactions are atomic), other
-- connections never see uncommitted state, and any DELETE issued outside
-- a sweeping transaction still aborts. No new table — settings is the
-- generic KV store the feature flags already use.
DROP TRIGGER IF EXISTS audit_log_immutable_delete;
CREATE TRIGGER audit_log_immutable_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    WHEN NOT EXISTS (
        SELECT 1 FROM settings
        WHERE key = 'audit.retention_sweep_active'
    )
BEGIN
    SELECT RAISE(ABORT, 'audit_log entries are immutable: DELETE not allowed');
END;
