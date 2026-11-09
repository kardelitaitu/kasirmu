-- 20261026_topology_revisions_metadata.sql
-- Add centralized authoring metadata columns to topology_revisions (ADR-66 / Phase 1).
--
-- ADR-66 §2 (D4, D5) & plan-topology-web-authoring.md Phase 1:
--   * `org_id`: organization scope for multi-store enterprise tenancy.
--   * `actor`: authenticated user who authorized the publish (ADR-66 D5).
--   * `key_id`: identifier of the Ed25519 signing key used to sign the revision (ADR-66 D4).
--   * `signature`: Ed25519 cryptographic signature verifying document authenticity.
--   * `base_revision`: optimistic concurrency control anchor (ADR-66 I4).

ALTER TABLE topology_revisions ADD COLUMN org_id TEXT NOT NULL DEFAULT '';
ALTER TABLE topology_revisions ADD COLUMN actor TEXT NOT NULL DEFAULT '';
ALTER TABLE topology_revisions ADD COLUMN key_id TEXT NOT NULL DEFAULT '';
ALTER TABLE topology_revisions ADD COLUMN signature TEXT NOT NULL DEFAULT '';
ALTER TABLE topology_revisions ADD COLUMN base_revision INTEGER;
