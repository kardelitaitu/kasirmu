<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE (0 findings, no repairs needed) · Fresh pass over this ADR; the 2026-09-29 stamp body is merged at the bottom as original evidence. · THE PRIOR PASS'S CROSS-FILE FINDING IS NOW CLOSED, and that is the one thing worth recording. The 2026-09-29 stamp reported that this ADR was right and `AGENTS.md` was wrong about the flag: the gate reads `OZ_ENFORCE_PLANS` while AGENTS.md listed `KASIRMU_ENFORCE_PLANS` under the KASIRMU_* user-scope variables. AGENTS.md has since been corrected — `$env:OZ_ENFORCE_PLANS` now appears in the variable block (AGENTS.md:182), with the rename history recorded above it at :19/:22 — so an operator following that file now sets the variable the server actually reads. Verified the reader side is unchanged: `env_bool("OZ_ENFORCE_PLANS")` at `apps/cloud-server/src/config.rs:208`, documented at `apps/cloud-server/src/main.rs:19` and in the OpenAPI 403 descriptions at `openapi/cloud.rs:254/284/303`, and referenced by the gate's own test docs at `sync_api.rs:189` and `sync_api_tests.rs:62`. No further action; the finding is retained in the merged body below because the reasoning about why it mattered (fail-open in production) is still the useful part. · MATCH, re-measured at HEAD: the enforcement chain is intact end to end — `SyncError::PlanRequired` defined at `platform/sync/src/lib.rs:128` and raised at `transport.rs:448`, `:514`, `:598`; `SyncHttpError::PlanRequired` classified in `crates/kasirmu-core/src/sync_client.rs:178` and `:240`; the terminal-contract backstop is still named in the daemon suite (`platform/sync/src/daemon_tests.rs:546`, "ADR sync-plan-gating: PlanRequired is terminal"); the structured 403 body is literally `{"error":"plan_required"}` at `apps/cloud-server/src/sync_api.rs:247`, emitted by `plan_middleware` (`:217`, wired into the router at `:205` in the documented position after auth); the admin route `PUT /api/v1/tenants/{tenant_id}/plan` is stated at `crates/kasirmu-api/src/routes/plans.rs:3` and gated via `admin_key_authorised` (`:21`); `tenant_plans` is at `crates/kasirmu-core/migrations/20260813_init.sql:890` and `stripe_customers` at `:809`; and the completed follow-up's event routing is real in `apps/cloud-server/src/webhooks.rs:170-174` (`customer.subscription.created|updated|deleted`, `checkout.session.completed`, `invoice.paid`), with `set_tenant_plan` called at `:404` and `:415`. The UI surfacing is present too: `planRequired?: boolean` at `ui/src/api/offline.ts:157` and the localized block string `Cloud sync requires a paid plan` in both `shared-ui/locales/offline.ftl:20` and `shared-ui/locales/settings.ftl:343`. · LEFT AS WRITTEN: the camelCase/snake_case spelling split the prior stamp flagged (TS `planRequired` vs wire/Rust `plan_required`) — it is real, it is documented in-file, and it is a naming choice rather than drift; the "Files" list, all four of whose paths the 2026-09-29 pass repaired to `kasirmu-*` names and all four of which resolve today. · NOT re-measured: the gate's runtime behaviour against a live server (a free tenant being refused, a pro tenant passing through) and the Stripe webhook end-to-end path — both need running infrastructure. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim below;
     the superseded stamp body is quoted as plain text here, not as a nested comment:

Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (4 minor, 0 major) + 1 CROSS-FILE FINDING · Audited on branch 0.0.40. The design in this ADR is intact end to end; what had rotted is the file list, because three of its four paths name crates that no longer exist. Repaired: `crates/oz-core/migrations/126_tenant_plans.sql` → the `tenant_plans` table is in the base schema at `crates/kasirmu-core/migrations/20260813_init.sql:890` (the numbered migration series is gone; migrations are date-stamped), and the same for `127_stripe_customers.sql` → `stripe_customers` at `crates/kasirmu-core/migrations/20260813_init.sql:809`; `crates/oz-core/src/db/plans.rs` → `crates/kasirmu-core/src/db/plans.rs`; `crates/oz-api/src/routes/plans.rs` → `crates/kasirmu-api/src/routes/plans.rs`. `apps/cloud-server/src/sync_api.rs` is the one path in the list that still resolves, and it does still hold `plan_middleware`. · MATCH, re-measured — the enforcement mechanism this ADR is really about, verified symbol by symbol rather than by shape: `SyncError::PlanRequired` is defined at `platform/sync/src/lib.rs:128` and raised at `platform/sync/src/transport.rs:437` and `:503`; `platform/sync/src/daemon_tests.rs:474` carries a section header reading "ADR sync-plan-gating: PlanRequired is terminal", so the no-retry/no-quarantine contract has a named backstop; `SyncHttpError::PlanRequired` is classified in `crates/kasirmu-core/src/sync_client.rs` (`:178` and `:240`); the admin route is exactly as documented, `crates/kasirmu-api/src/routes/plans.rs:3` states `PUT /api/v1/tenants/{tenant_id}/plan` and is gated through `admin_key_authorised`; and the Stripe wiring this ADR's completed-follow-up section claims is real, `set_tenant_plan` is called from `apps/cloud-server/src/webhooks.rs`. The `plan_required` flag on the result type is real too, with a spelling worth knowing: the TypeScript field is camelCase — `planRequired?: boolean` at `ui/src/api/offline.ts:157`, documented in-file as the ADR sync-plan-gating carrier — while the wire and Rust form is `plan_required`. A front-end author searching this ADR for `plan_required` will not find the field. · ⚠️ CROSS-FILE FINDING, reported and NOT patched: this ADR is right and `AGENTS.md` is wrong about the env var. The gate reads `OZ_ENFORCE_PLANS` — `env_bool("OZ_ENFORCE_PLANS")` at `apps/cloud-server/src/config.rs:208`, documented at `apps/cloud-server/src/main.rs:19` and echoed in `apps/cloud-server/src/openapi/cloud.rs:244` — but `AGENTS.md:119` lists `$env:KASIRMU_ENFORCE_PLANS  # plan gating flag` under the `KASIRMU_*` user-scope variables. Every other `KASIRMU_*` name in that section really is `KASIRMU_`-prefixed in code, so this one looks like a genuine single-name drift rather than a general convention. Left alone because the default repair direction for this skill is doc-to-code and patching an agent-configuration file is outside a `docs/` audit — but an operator following AGENTS.md would set a variable the server never reads, and plan gating would silently stay off in production. That is exactly the failure mode the ADR's own "opt-in" design has, so it is worth an owner's decision. · No stamp or footer existed on this file before this pass.
-->


# ADR: Gate cloud sync behind a paid plan

**Date:** 2026-08-09 · **Status:** Complete (E1–E4) · **Owner:** buffy

## Problem

Cloud sync is a paid feature: a tenant on the `free` plan may run the POS
fully locally (sales, offline queue writes, KDS, topology) but must not be
able to push/pull to the cloud server. There was no plan concept anywhere
in the stack, and nothing stopped a free tenant from syncing.

## Decision

Enforce the gate **server-side**, keyed off the **`tenant_id` in the JWT
claims** — never trust the client to self-report its plan, and never take
the tenant from the request body (tenant spoofing).

- **Plan state** lives in a new `tenant_plans` table keyed by `tenant_id`
  (migration `126`). Plans are per-store, not per-terminal: every terminal
  of a store inherits the store's plan (`sync_terminals.tenant_id` joins to
  it). Values: `free` | `pro`, validated by a `CHECK` constraint.
- **Enforcement** is a `plan_middleware` on the sync router, layered
  between `auth_middleware` (provides claims) and the handlers — the same
  position as `rate_limit_middleware`. Free tenants get a structured
  `403 {"error":"plan_required"}`; pro tenants pass through.
- **Opt-in via `OZ_ENFORCE_PLANS=1`.** When unset (dev/local Docker)
  nothing changes — no plan row = allowed, matching the `OZ_ADMIN_KEY`
  "open when unset" pattern. When set (production), fail closed: a missing
  row is treated as `free`.
- **Admin endpoint** `PUT /api/v1/tenants/{tenant_id}/plan` sets a plan,
  gated by the same `OZ_ADMIN_KEY` as token minting. Stripe webhook
  scaffolding already exists in `webhooks.rs` for a future billing hookup.
- Only `/api/sync/*` is gated. Local POS remains fully functional on free.

### Client behaviour (E3)

A `plan_required` response must be **terminal**: no token refresh, no
retry spin, and critically **no quarantine** — queued items stay `pending`
(they are valid, just unsendable on a free plan). The daemon backs off and
surfaces the reason; the UI shows "Sync requires a paid plan" rather than
"disconnected" (E4).

Implemented: `SyncError::PlanRequired` (platform-sync) and
`SyncHttpError::PlanRequired` (`kasirmu-core`) are classified from a structured
`403 {"error":"plan_required"}` in push/pull/snapshot, and the daemon
treats the variant as terminal — no refresh (the refresh path matches only
`AuthExpired`), no in-tick retry, and queued items stay `pending`. A
daemon regression test asserts the error surfaces, the item is untouched,
and each endpoint is hit exactly once per tick.

### UI surfacing (E4)

`SyncAttemptResult` carries a `plan_required` flag. The desktop `sync_run`
command sets it on a plan gate and — unlike other errors — does NOT mark
queued items failed: they stay `pending` and sync automatically after an
upgrade. The Sync settings section renders a dedicated "Cloud sync
requires a paid plan" block (localized en/id) with a hint that local sales
keep working, instead of a generic sync error.

## Alternatives considered

- **402 Payment Required** instead of 403: 403 keeps consistency with the
  existing client error classification; 402 adds no benefit for a
  self-hosted server. Chose 403.
- **Client-side gating**: rejected — trivially bypassable, and the client
  is not the source of truth.
- **Plan embedded in the JWT**: rejected — stale up to token expiry (24h);
  a per-request DB check is cheap (sync is ~1 req/60s per terminal) and
  takes effect immediately.

## Files

- `crates/kasirmu-core/migrations/20260813_init.sql:890` — `tenant_plans` table
- `crates/kasirmu-core/src/db/plans.rs` — `TenantPlan` + `Store` get/set/list
- `crates/kasirmu-api/src/routes/plans.rs` — admin plan endpoint
- `apps/cloud-server/src/sync_api.rs` — `plan_middleware` + tests

## Follow-ups

- E3: client `PlanRequired` classification, daemon no-retry/no-quarantine.
- E4: UI status state + upgrade CTA.
- Stripe webhook → `set_tenant_plan` wiring (scaffolding exists).

## Completed follow-up: Stripe subscription webhook wiring

The Stripe webhook (`apps/cloud-server/src/webhooks.rs`) now turns
subscription lifecycle events into plan changes:

- **Event routing.** `customer.subscription.created` / `.updated` /
  `.deleted`, `checkout.session.completed`, and `invoice.paid` are routed
  to a plan-update path; all other events keep the existing
  finalise-sale flow.
- **Tenant resolution.** The `tenant_id` metadata set on the Checkout
  Session (forwarded onto the subscription) is used when present; for
  events that carry only a customer id (`invoice.paid`, deleted), the
  `stripe_customers` table (`crates/kasirmu-core/migrations/20260813_init.sql:809`) resolves the
  tenant. Unresolvable events are acknowledged with 200 `ignored` so
  Stripe stops retrying.
- **Plan mapping.** `active`/`trialing`/`past_due` → `Pro`,
  `canceled`/`unpaid`/`incomplete_expired` and `customer.subscription
  .deleted` → `Free`, `checkout.session.completed`/`invoice.paid` → `Pro`.
  Unknown statuses leave the plan unchanged.
- **Wiring.** The webhook calls `Store::set_tenant_plan` directly — the
  same function the admin endpoint uses — so a paid subscription
  upgrades the tenant's sync plan with no operator action.

To adopt: set `tenant_id` metadata on Stripe Checkout Sessions
(`subscription_data.metadata` / `metadata`) so the first event can learn
and persist the customer → tenant mapping.

> last audited 11-10-26 by docs-auditor
