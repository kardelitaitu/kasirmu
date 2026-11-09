# A five-year retention nobody implemented, and a TLS version nobody pinned — 2026-10-19

**Scope:** `docs/legal/**` (14 files, the last documentation surface not audited against code this
session), plus a sweep of `.agents/skills/**` command validity.
**Result:** 2 legal corrections; 104/104 skill commands verified; all 15 gates green.

## The two defects

### 1. "minimal 5 tahun" retention, when the longest window is 3 years

`docs/legal/id/digital-compliance.md` §2.2 stated that logging and audit-trail retention is
"at least 5 years" for UU KUP tax-compliance purposes. The code says otherwise, in one table:

| Tier | Audit retention (`audit_retention_days()`, `tier.rs:198-205`) |
|---|---|
| Free / OneTime | **none** (`None` — no entitlement) |
| Plus | 90 days |
| Pro | 180 days |
| Premium | 365 days |
| Enterprise | 1,095 days (**3 years**) |

Cloud sync-log retention is **90 days** (`apps/cloud-server/src/prune.rs:20`). There is no
five-year window anywhere in the tree, and the top tier is three.

This is the more dangerous shape of doc defect: it is not a stale count, it is **an obligation
recorded as a property**. A compliance document that states a retention floor the system does not
enforce describes a duty as if it were already met. Corrected to state the real per-tier windows
and to say plainly that if UU KUP requires five years, that is an **unimplemented obligation**,
not a system property — which `docs/security/data-residency-and-retention.md` already says about
retention generally.

### 2. "TLS 1.3" stated as a guarantee, from a tree that cannot establish it

Two documents (`docs/legal/id/digital-compliance.md` and
`docs/legal/id/templates/privacy-policy.md`) pinned the protocol version as **TLS 1.3**. TLS in
this deployment terminates at the **platform edge** — `apps/unified/Caddyfile:4-5` says so
explicitly, and there is no `tls` directive and no protocol pin anywhere in `apps/unified/Caddyfile`
or `ops/docker/`. The protocol version is therefore a **provider fact this repository cannot
verify**.

Corrected to claim HTTPS (true and checkable) and to mark the version as a provider fact rather
than a verified property. The template carries the same note as guidance for whoever drafts a
merchant's policy, because a generated policy that pins a version inherits the same unverifiable
claim.

The hashing sentence in the same template was also tightened to name the real split — bcrypt for
account passwords (`apps/license-server/web_password.go:106`), Argon2id for local staff PINs
(`platform/core/src/auth.rs:23-37`) — matching the correction already applied to the customer-facing
privacy policy earlier the same day.

## Verified clean this pass

- **`AGENTS.md` §4 is accurate after the earlier correction.** `KASIRMU_MASTER_KEY` is read at
  `crates/kasirmu-crypto/src/lib.rs:122` with `OZ_MASTER_KEY` as the legacy alias at `:125`; all four
  `OZ_*` server knobs have real code readers (`config.rs:208/214/215`, `main.go:75-77`). Recorded
  because a grep for the literal spellings finds only tests — the names are **constants**, not
  string literals, which is a trap for exactly the kind of name-matching audit this session has been
  running.
- **RBAC role list** in the compliance doc matches `platform/core/src/rbac.rs`: all six claimed ids
  exist (a seventh, `role-test`, is test-only and correctly not claimed).
- **`.agents/skills/**` commands**: **104 of 104** script invocations across all SKILL.md files
  resolve to a real file. Six *path* tokens do not resolve, and all six are deliberate — paths quoted
  as absent ("should not exist"), historical coordinates, a path inside an APK, and one truncated by
  the drift guard's own regex. That corpus has **no checker at all** (`check-dead-refs.py` skips
  `.agents/` as dated records), so it was swept by hand; the result is clean, which is worth
  recording precisely because nothing enforces it.

## Correction method

Every claim was traced to its reader before editing — `tier.rs` for retention windows,
`prune.rs` for the sync horizon, `Caddyfile` for where TLS terminates, `web_password.go` and
`auth.rs` for the hash split. The legal docs are Indonesian and carry their own
`[DECIDED]`/`[VERIFIED]` markers; the two corrected lines are product claims, not drafting
positions, which is why they were repaired rather than left as founder working notes.

> last audited 19-10-26 by docs-auditor
