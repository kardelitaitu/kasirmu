-- 20261010_role_trash.sql
--
-- Custom roles join the trash (the staff half shipped in 20261009_staff_trash).
--
-- WHY ROLES NEED IT TOO, and why their purge differs from the staff purge.
-- `roles` is referenced by `users.role_id` and `assignments.role_id` (both
-- RESTRICT), so `DELETE FROM roles` fails for any role that has ever been
-- held — the same wall the staff half hit, which is why `delete_role` already
-- refuses a role with any reference at all (`Store::role_references_on`).
-- What differs is the PURGE: a role carries no personal data, and the delete
-- guard has already proved nothing references it, so the 90-day sweep can
-- remove the row outright (`Store::purge_expired_roles`) rather than
-- anonymise it. Only staff need a tombstone, because only staff are named by
-- history that must survive.
--
-- No index here on purpose: `roles` is an O(tens) table read whole on every
-- roster load, so a scan for trashed rows costs nothing and the partial index
-- the users half needed would be decoration.

ALTER TABLE roles ADD COLUMN deleted_at TEXT;
ALTER TABLE roles ADD COLUMN purged_at TEXT;
