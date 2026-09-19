---
num: 55
area: security
title: "ADR #55: One Server Origin — the compiled list, the fallback pair and the allowlists that must agree with it"
status: Partially implemented (2026-09-19) — resolver, literal collapse, drift gate and the attestation endpoint shipped; client verification and the reachability cascade proposed
---

# ADR #55: One Server Origin

**Status:** Partially implemented (2026-09-19). §2.1-§2.3 and §2.6 are shipped, together with
the attestation endpoint (§2.4, server half); the client-side attestation verification and the
reachability cascade (§2.5) are proposed and deliberately gated behind each other.
**Date:** 2026-09-19
**Recorded against:** branch `0.0.39` @ `ef0c0456d`
**Tags:** security, config, sync, auth, deployment, drift

> Cite this record by filename. `docs/decisions/README.md` records that numbering in this
> directory has collided before (#43).

## 1. Context

Production is **one deployment**. `docs/operations/runbook.md:405` names the service `oz-cloud`
at `https://license.ozpos.my.id`, and `ops/docker/Dockerfile.unified` puts caddy on one port
routing to `:8080` PocketBase and `:3099` Rust — so the "auth server" and the "sync server"
are the same origin, and path routing separates them: `/api/v1/license/*` and `/api/v1/web/*`
to PocketBase, `/api/v1/sync/*`, `/api/v1/tokens`, `/api/v1/terminals` and the REST surface to
the cloud server.

The tree nevertheless defined that origin **six times, four ways, with two values**:

| Definition | Mechanism | Value |
|---|---|---|
| `crates/kasirmu-core/src/license_verification.rs:34` | compiled const, env override | `license.kasir.mu` |
| `crates/kasirmu-bridge/src/sync.rs:173` | compiled debug fallback | `license.kasir.mu` |
| `apps/desktop-tauri/src/sync_bootstrap.rs:38` | compiled debug bootstrap | `license.ozpos.my.id` |
| `ui/src/contexts/SettingsContext.tsx:59` | frontend settings draft | `license.ozpos.my.id` |
| `apps/{desktop,mobile}-tauri/tauri.conf.json` | hand-written CSP `connect-src` | `license.ozpos.my.id` |
| `website/worker.ts` | runtime var, build-time fallback, CSP | `license.kasir.mu` |

Four consequences were live, not theoretical:

1. **The hostname had forked.** Code said `license.kasir.mu`; both Tauri CSPs, the debug
   bootstrap, the settings draft and the runbook said `license.ozpos.my.id`.
2. **Auth and sync defaulted independently**, so a machine could authenticate against one host
   and sync to another — and the failure reads as "cloud sync silently does nothing", because a
   missing sync URL no-ops by design (`sync_bootstrap.rs:10-12`).
3. **The env override was not an override.** `OZ_LICENSE_SERVER_URL` is read from the process
   environment of the shipped binary; no installer user can set it, and nothing in the repo but
   `.env.example:55` ever does. Moving a host required a release.
4. **The runbook inventory was stale in both directions** (`runbook.md:496-510`): it listed an
   `AUTH_SERVICE_URL`/`VITE_AUTH_SERVICE_URL` fallback in `LicenseActivationScreen.tsx` that no
   longer exists anywhere in `ui/src`, and it claimed the sync URL is "never compiled in" when
   three compiled sync literals existed.

## 2. Decision

### 2.1 One compiled list — `crates/kasirmu-core/src/server_origin.rs`

`MAIN_SERVER_ORIGIN` (`https://license.kasir.mu`) and `FALLBACK_SERVER_ORIGIN`
(`https://license.ozpos.my.id`) are the only compiled origins. `LICENSE_SERVER_URL` in
`license_verification.rs` is now an alias of `MAIN_SERVER_ORIGIN`, and `license_server_url()`
delegates to `resolve_origin()`, so the precedence table has exactly one implementation.

Resolution precedence: **env override -> pinned origin -> MAIN -> FALLBACK**, with a loopback
pair under `cfg(debug_assertions)` and never auto-selected.

### 2.2 An empty value is unconfigured, not an empty base URL

`.env.example` ships `OZ_LICENSE_SERVER_URL=` (blank). The previous implementation returned
the empty string for it, which made every request URL relative (`/api/health`). Blank and
malformed values are now ignored and fall through to the next tier, matching the invariant the
sync bootstrap already applied (`resolve_sync_probe_url`).

### 2.3 `FALLBACK` is an alias, not a replica

Both names must resolve to the same caddy host and the same data. A fallback answering from a
different database would silently fork a shop's data, which is why §2.5 is only meaningful under
that assumption. This is an operator invariant, not something the client can verify.

### 2.4 Attestation before credential (endpoint shipped, client pending)

`license.api_key`, the sync JWT and the ADR #54 terminal `device_secret` are bearer credentials,
and a cascade widens where they can be sent to two domains plus a loopback port. Before any
fallback host is used, it must prove it holds the license keypair: an unauthenticated nonce
challenge signed with the private key and verified client-side with the already-embedded
`LICENSE_PUBLIC_KEY_PEM` (`license_verification.rs:44`, via `verify_license_signature`). A
hijacked or lapsed fallback domain cannot sign, so it cannot harvest anything.

**Shipped 2026-09-19 (server half):** `POST /api/v1/license/attest` (`apps/license-server/attest.go`)
answers `{nonce}` with `{nonce, issuedAt, signature}`, signing the canonical payload
`ozpos-origin-attest-v1:<nonce>` with the same RSA-2048 key and PKCS1v15/SHA-256 construction as
subscription payloads — `signDetached` is now the single implementation of that primitive and
`signSubscription` delegates to it. The namespaced prefix means an attestation signature cannot be
replayed as a subscription payload, or the reverse.

The oracle is scoped exactly as O1 asked: the nonce must be 16-64 characters of `[A-Za-z0-9_-]`, it
is the only request data that reaches the signed bytes, no attacker-chosen payload is ever signed,
and the handler shares the existing per-IP budget rather than minting a second lane. Client
verification must use `LICENSE_PUBLIC_KEY_PEM` and must **not** accept the `BOOTSTRAP_FREE` sentinel.

This is also what makes a *pinned* origin safe: URL keys are classified as endpoints rather
than credentials (`settings_tests.rs:796`) and are therefore outside the sealed-settings
machinery.

### 2.5 Cascade rules (proposed)

- **Transport failure only** — DNS, connect, TLS, timeout. Never on an HTTP status, and never on
  `401`/`403`: retrying a credential rejection against a second host is credential spraying.
  ADR #50 P1 made 401 mean *refresh*; the cascade must not reinterpret it.
- **Resolve at boot, pin the winner, never switch mid-session.** The sync dataset belongs to an
  origin; flipping writes to two backends.
- **The loopback pair is `cfg(debug_assertions)`.** A release binary must contain no localhost
  origin, or any local process that binds the port could impersonate the server.
- **`OZ_REDIRECT_ONLY`/`OZ_SYNC_REDIRECT_URL` remains the migration path** (HTTP 421, ADR #11),
  not this list. The list is how a client *starts*; the redirect is how a fleet *moves*. Note the
  421 middleware covers `/api/sync/*` only (`redirect.rs:39-40`), which is exactly the gap the
  auth-side cascade fills.

### 2.6 Allowlists carry both names, and a gate keeps them honest

Both origins are live, so every allowlist must admit both: both Tauri `connect-src` (production
and dev), the Worker CSP, and the Worker's `LICENSE_API_URL` fallback. The settings draft
proposes `MAIN`, never the second name.

`scripts/check-server-origins.mjs` parses the compiled list and fails when any of those places,
or either Rust dev fallback, disagrees. It is registered as the `server-origins` gate in
`scripts/gates.json` and runs from `scripts/check.sh`. This is the single assertion that would
have caught the fork in §1.

## 3. Consequences

- A host change becomes one edit plus a regenerate, rather than a release.
- The dev tier is defined once (`DEBUG_AUTH_ORIGIN` `:8080`, `DEBUG_SYNC_ORIGIN` `:3099`) instead
  of being re-stated wherever a developer needed it.
- Auth and sync can no longer point at different hosts.
- The gate is a *UX and configuration* guard, not a security boundary: CSP governs the webview's
  own `fetch`, while most app traffic goes through Tauri IPC (Rust + reqwest), which CSP does not
  see. Attestation (§2.4) is the security control; the gate is the consistency control.

## 4. Tradeoffs / risks

- **`OZ_LICENSE_SERVER_URL` remains deliberately available** for pointing a debug build at a
  local Docker backend. It is now documented as a dev/test tier rather than an upgrade path.
- **The two names are unverifiable from the client.** §2.3 is a deployment invariant; if it is
  ever broken, the cascade turns a stale replica into "sync works but data is missing".
- **`useDeviceIp` calls `https://api.ipify.org`, which is in neither Tauri CSP**
  (`ui/src/hooks/useDeviceIp.ts:40`). The KDS footer therefore falls back to the local IP. Left
  as-is: enabling a third-party call is a privacy decision, not an origin decision.
- **The debug bootstrap still targets the production fallback name**, preserving its existing
  behaviour rather than silently repointing developer sync at loopback. Whether a debug build
  should auto-provision to `DEBUG_SYNC_ORIGIN` instead is unresolved (§6 O2).

## 5. Verification

- `crates/kasirmu-core/src/server_origin_tests.rs` — 12 tests covering the precedence table,
  blank and malformed fall-through, scheme rejection, trailing-slash trimming, release-safety
  (no loopback in the ladder or the resolver) and stable source labels.
- `cargo test -p kasirmu-bridge sync_probe` — the debug probe fallback and its release-mode
  counterpart, unchanged in value by the literal collapse.
- `ui` — `SettingsContext`, `CloudSyncSettings` and `SettingsPage` suites, whose pinned defaults
  moved from the fallback name to the canonical origin (68 passed, 22 skipped).
- `node scripts/check-server-origins.mjs` — green across all six surfaces.
- `go -C apps/license-server test -short -run 'Attest|SignDetached'` — the payload shape, nonce bounds, and a
  sign/verify round-trip over a generated keypair with a tampered-nonce negative case. Three
  tests; the round-trip generates its own key rather than skipping, because a skipped security
  test cannot fail.

## 6. Open questions

- **O1 — Where does the attestation challenge live?** It must be served by the process holding
  the private key (PocketBase), but the cascade needs it *before* choosing a host, so the
  endpoint must be unauthenticated and cheap. An unauthenticated signing oracle deserves its own
  review: scope it to a nonce of bounded length, with no attacker-chosen payload.
- **O2 — Should a debug build auto-provision to `DEBUG_SYNC_ORIGIN`?** Today it points at the
  production fallback name, which means a developer's machine can silently sync to production.
- **O3 — Should the gate gain CI coverage?** It is local-only today (`scripts/gates.json`
  `server-origins`, no `ci` block), which is honest rather than omitted.
- **O4 — Does the marketing host split need the same treatment?** `worker.ts:79` sets
  `MARKETING_HOST = 'kasir.mu'` and `DASHBOARD_HOSTS = {'admin.kasir.mu'}` while the runbook
  deploys `ozpos.my.id` (`:1004`, `:1096`) — the same fork, one layer out, and it decides the
  OAuth `next` allowlist in ADR #54 §2.4.

## 7. References

- `docs/decisions/2026-09-11-adr50-sync-auth-hardening.md` — 401 semantics (P1) and terminal
  credentials (P3), both load-bearing for §2.4-§2.5.
- `docs/decisions/2026-07-13-zero-downtime-vps-migration.md` and
  `docs/archived/2026-08-15-unify-auth-and-sync.md` — the 421 redirect and the unification of
  auth and sync into one deployment.
- `docs/decisions/2026-09-19-adr54-google-sign-in.md` — the OAuth flow whose redirect URIs and
  `next` allowlist depend on this record's host set.
- `docs/operations/runbook.md` — the deployment procedure, whose app-side URL table this record
  corrects.
