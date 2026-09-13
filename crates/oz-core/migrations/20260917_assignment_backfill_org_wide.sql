-- 20260917_assignment_backfill_org_wide.sql
--
-- ADR #47 ruling 5 follow-up (the assignment-creation slice): give every
-- user without an assignments row the org-wide pair, preserving the legacy
-- "not scope-restricted" authorization bit-for-bit while making row-lessness
-- an anomaly rather than a supported shape.
--
-- create_user_in_tx has written a default global (org-wide) assignment for
-- every user since spec 0048, so this backfill only reaches databases whose
-- users predate that default or were written by hand. After it runs, the
-- no-row fallback in `assignment_for_user` is unreachable for migrated
-- databases; the code path stays as defense-in-depth and the tightening
-- decision (deny on no-row) remains deliberately deferred.

INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id, created_at, updated_at)
SELECT u.id, u.role_id, 'global', 'all', 'all', 'organization', NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id);
