# Spec 0047 — OpenAPI Drift Guard + JWT Read Tiers

**Status:** implemented (2026-09-01) · **Created:** 2026-08-31 · **Scope:** cloud-server, oz-api, platform-core, website docs
**Related:** 0046b (images — untouched), user-role campaign residual (D1/API-4), ADR #35 (permission registry)

---

## 1. Goal

Close the two residuals of the API-facing surface:

**A. Contract drift** — `apps/cloud-server/src/openapi.rs` is a 1,035-line
hand-maintained OpenAPI 3.1 document with no mechanical link to the real
router. Drift is already visible (module doc claims "20 endpoints across 7
tag groups"; the spec declares 18 tags and ~26 paths). A cheap mechanical
guard turns silent drift into a red test.

**B. Read tiers** — every valid JWT can read every GET endpoint, including
terminal device tokens (`terminal_id`-scoped client-credential tokens).
Fine for today; wrong for the first third-party dashboard. Plan a
scoped-claims mechanism that **reuses the existing permission registry**
instead of inventing a parallel taxonomy, grandfathered so nothing breaks.

**Non-goals:** utoipa derive migration (the eventual permanent fix — the
drift guard de-risks until then, recorded as future work); write-side
authorization (that is the D1 residual campaign, admin-key tier per 0046b
precedent); token revocation lists.

## 2. Ground truth (all verified 2026-08-31)

| Fact | Evidence |
|---|---|
| OpenAPI 3.1 spec + Swagger UI + Scalar served publicly at `/api/openapi.json`, `/api/docs`, `/api/docs/scalar` | `apps/cloud-server/src/openapi.rs:1-6`, `main.rs:493-510` (docs router merged outside the auth layer) |
| Prod binary `oz-cloud-server` (supervisord `program:sync`) embeds oz-api's router via `oz_api::build_api_router` | `apps/unified/supervisord.conf:49`, `apps/cloud-server/src/main.rs:449-451`, `Cargo.toml:18` |
| axum **0.7.9** — `Router: IntoIterator<Item = (String, MethodRouter)>` exists in this version | `Cargo.lock` axum 0.7.9 |
| 13 GET operations declared in the spec (the read surface) | `grep '"get"' openapi.rs` |
| Claims shape: `sub, jti, exp, iat, tenant_id, terminal_id` — no scope/permission field | `crates/kasirmu-api/src/auth.rs:45-55` |
| Mint paths: admin-key mint (arbitrary tenant), terminal client-credentials (`client_id`+`client_secret`, no admin key) | `crates/kasirmu-api/src/routes/tokens.rs:110-126` |
| Read authorization today: router-wide JWT middleware only — any valid token reads everything | `crates/kasirmu-api/src/lib.rs:265` (verified during G-1) |
| Permission registry + `has_permission` resolver already in the dependency tree with read keys (`products:read`, `sales:view`, `reports:view`, `audit:view`, `customers:view`, `staff:read`, `settings:read`, `staff:read_identity`, `staff:read_payroll`) | `platform/core/src/permission_registry.rs`, user-role campaign stamps A/C |
| Known drift marker: module doc "20 endpoints across 7 tag groups" vs 18 declared tags | `openapi.rs:16` vs `openapi.rs:35-53` |

## 3. Part A — Drift guard (F1, test-only, no runtime change)

Three assertions in `apps/cloud-server/src/openapi_tests.rs`, all against
the real `build_router` output — failures mean the spec is wrong first
(the spec is the contract; code drifts around it):

1. **Path set equality (bidirectional).** Walk the merged router via
   `Router::into_iter()` (axum 0.7.9 supports it) and compare the path set
   against the spec's `paths` object: every router path must be documented;
   every documented path must exist. Exclusions: none — webhook and docs
   paths are in the spec too, so the walk covers everything.
2. **Method + liveness probe.** For every `(path, method)` declared in the
   spec, fire a `tower::ServiceExt::oneshot` request and assert the status
   is **not 404 and not 405** (401 is a pass — it proves route + method
   exist; auth is not this test's job). Catches renamed/removed/retyped
   endpoints that path-equality alone can miss via placeholder mismatch.
3. **Security-coverage walk.** Every operation in the spec declares
   `security: [{bearerAuth: []}]` **unless** it is on a small explicit
   public allowlist (`/api/health`, `/api/v1/health`, `/api/openapi.json`,
   `/api/docs*`, `/api/webhooks/*`). A new endpoint silently missing the
   security block becomes a red test — this is the audit-stamp class of
   guard, mechanical.

Plus the trivial fix: correct the stale module doc comment.

**Touchpoints:** `apps/cloud-server/src/openapi_tests.rs` (new assertions),
`openapi.rs:16` (doc comment). Runs in the existing workspace test suite —
no CI change. Commits: `test(cloud-server): ...` per assertion group, with
any drift the tests expose fixed first (`docs(api)` / `fix(cloud-server)`).

## 4. Part B — Read tiers via the existing registry (F2–F4)

### Design principle

No new permission taxonomy. A token may carry an optional `permissions`
claim — a list of **existing registry keys**. Reads are gated through
`platform_core::rbac::has_permission` against a static route→key map.
**A token without the claim = legacy full-read** (grandfathered, backward
compatible — existing integrations keep working untouched). Tier presets
are just named lists of registry keys, mint-time sugar:

| Preset | Registry keys (illustrative; final list at F3) | Intended holder |
|---|---|---|
| `full` *(implicit default)* | — (no claim) | admin/operator, existing integrations |
| `terminal` | products:read, categories:read?, tax-rates/exchange-rates reads, plan read | POS terminals via client-credentials |
| `dashboard` | sales:view, reports:view, analytics:view, products:read | third-party dashboards |
| `audit` | audit:view, reports:view | accountants/auditors |

Terminal client-credential mints get the `terminal` preset automatically
(behavior change behind a flag — decision point 1); admin-key mints accept
an optional `permissions`/`preset` field; anything else keeps full-read.

### F2 — Claims foundation (oz-api)

- `CreateTokenRequest` gains optional `read_preset: Option<String>` +
  `read_permissions: Option<Vec<String>>` (admin-key path only; terminal
  client-credentials mints are preset-bound server-side — a minted token
  can never self-elevate).
- `ApiTokenClaims` gains `permissions: Option<Vec<String>>` (serde default
  → `None` = legacy). JWT roundtrip tests; `None`-claim tokens must be
  byte-compat with today's behavior.
- Commits: `feat(api): ...` + tests first (roundtrip, mint authz: admin-key
  can narrow, terminal cannot widen, unknown preset/key rejected with the
  registry's typed error).

### F3 — Enforcement (cloud-server/oz-api)

- Static `READ_KEY_MAP: &[(method, path, key, pii)]` covering the 13 GET
  operations (plus any read verbs on mixed routes) — each entry carries
  its registry key **and its PII classification** (decision 3). Owned next
  to the router build (the drift guard from Part A keeps this map honest
  too — add a fourth assertion: every GET operation in the spec has a
  read-key entry).
- Read-gate middleware: `None`-claim → pass (legacy); claim present →
  `has_permission(key)` with the registry's fail-closed resolver; failure
  ⇒ 403 `insufficient_scope` (same error shape the terminal-token 403
  already uses — one error vocabulary).
- Write routes untouched (D1 residual stays the separate admin-key
  campaign). Sync routes keep their existing gating.
- Terminal binding: client-credential mints carry the `terminal` preset
  unconditionally; `OZ_TERMINAL_READ_TIER=full` is the documented
  escape hatch (startup warning + deprecation note; decision 1).
- Tier-matrix tests: presets × 13 GETs → expected 200/403; grandfathering;
  terminal-mint default; **and the PII invariant: `dashboard` ∩
  pii-marked routes = ∅** (decision 3 — the classification is test-visible).

### F4 — Contract + docs

- OpenAPI: describe the tier model in the Auth tag + add a 403 response
  example to read operations + a changelog note for the terminal-default
  flip and the `OZ_TERMINAL_READ_TIER` deprecation (the drift guard now
  enforces consistency automatically).
- Website guides (`docs/content` en+id): "API read tiers" page for
  integrators — mint → preset → call.
- Stamp both touched files; `docs(api)`/`docs(website)` commits.

## 5. Decision log (all resolved 2026-08-31 — delegated to engineering, chosen by SOTA principle)

1. ~~Terminal default flip~~ **RESOLVED: secure-by-default with an
   escape hatch.** At F3, terminal client-credential tokens bind to the
   `terminal` preset unconditionally — secure-by-default is the SOTA
   posture (an opt-in window leaves the residual open indefinitely and
   is how "temporary" flags become permanent). Deployed integrations
   that legitimately need legacy reads get `OZ_TERMINAL_READ_TIER=full`:
   an explicit operator override that logs a startup warning naming the
   deprecation, is documented in the OpenAPI changelog, and is slated
   for removal after one release cycle (the Kubernetes legacy-API
   removal pattern: window + flag, never a permanent opt-out).
2. ~~Tier model~~ **RESOLVED: registry-key lists + named presets.** A
   coarse enum would create a second authorization taxonomy to keep in
   sync with ADR #35 — two sources of truth is exactly the drift class
   this whole campaign exists to kill. Registry keys mean one resolver
   (fail-closed, audit-stamped), one key vocabulary across desktop gate
   and cloud reads, and presets as pure mint-time sugar over the same
   keys. Token bloat stays bounded (presets <= ~10 keys; full-read is
   claim-free).
3. ~~PII classification sign-off~~ **RESOLVED: machine-enforced, not
   one-time human sign-off.** A one-time table goes stale the day
   someone adds a field; instead the classification lives IN CODE —
   every `READ_KEY_MAP` entry carries a `pii: bool` flag, the
   `dashboard` preset is *derived* by excluding pii-marked routes, and
   a pinned test asserts the invariant `dashboard ∩ pii-routes = ∅`.
   Reviewing PII becomes reviewing a test-visible diff: whoever adds a
   PII-bearing route must flip its flag and the invariant test makes
   that change impossible to hide. Preliminary classification at F3
   start (verify against actual handler payloads): `users` list = PII
   (staff identity); `sales` reads = PII-flagged (customer refs + notes
   can ride sale payloads); everything else = non-PII until the payload
   review says otherwise.

## 6. Risks

- **Drift-guard false positives** at placeholder-heavy paths
  (`/api/v1/exchange-rates/{from}/{to}`-class) — mitigated by matching the
  spec's templated paths to axum's matchit syntax (both use `{param}`).
- **PII-map incompleteness** — a route missed in the read-key map is
  silently `full` for restricted tokens; mitigated by the Part-A style
  bidirectional assertion (spec GET ↔ map entry) plus the tier-matrix
  tests enumerating every GET. Residual: a route *classified* non-PII
  that later gains PII fields — the flag lives in code next to the map,
  so the review that adds the fields sees the flag; the invariant test
  cannot catch payload-level drift, only route-level.
- **Claim bloat** — `permissions` lists in JWTs grow the token; presets
  keep them short (≤ ~10 keys); full-read stays claim-free.
- **Back-compat** — `None`-claim = today's behavior exactly; no deployed
  admin-minted token changes meaning at any point. Terminal tokens are
  the deliberate exception (decision 1: secure-by-default) — the
  `OZ_TERMINAL_READ_TIER=full` escape hatch covers any deployed
  integration during the one-cycle deprecation window.
