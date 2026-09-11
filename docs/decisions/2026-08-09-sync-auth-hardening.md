# ADR: Sync Authentication Hardening (token refresh, gating, terminal credentials)

Date: 2026-08-09

Status: Accepted (incremental — each phase ships independently)

## Context

The cloud sync server authenticates every `/api/sync/*` call with a JWT
(`Authorization: Bearer <token>`) minted by `POST /api/v1/tokens`. Three gaps
make this fragile:

1. **The token endpoint is unprotected.** Any caller can mint a 24-hour token
   (`crates/oz-api/src/routes/tokens.rs` documents this). There is no
   revocation list and the signing secret falls back to a hardcoded dev value.
2. **Tokens expire with no client refresh.** The desktop bootstrap mints one
   token per launch and stores it as the API key. A token that expires
   mid-session leaves sync broken until restart — the sync client treats every
   failure as fatal and never re-authenticates.
3. **No terminal identity.** Tokens are labelled, not scoped to a registered
   device, so the industry-standard client-credentials model (register a
   terminal once, silently renew short-lived tokens forever) is not possible.

## Decision

Harden sync auth in four independent, individually-shippable phases.

### P1 — Client-side token refresh (makes sync self-healing)

- The sync client treats HTTP `401` from push/pull as *stale auth*: request a
  fresh token from `POST /api/v1/tokens`, persist it as the API key, and retry
  the operation exactly once.
- Implemented in both client paths:
  - `oz-core::sync_client` (used by the Tauri `sync_run` / `sync_pull`
    commands) gains a typed `SyncHttpError` with an `AuthRejected` variant so
    the command layer can distinguish 401 from other failures.
  - `platform-sync::SyncTransport` (used by the background daemon) maps 401 to
    a new `SyncError::AuthRejected` variant. `run_tick` refreshes the key on
    `AuthRejected` for both push and pull; the push phase additionally retries
    the batch in-tick (data-critical), while the pull phase recovers on the
    next cycle (60–120 s) with the fresh key — its apply block is large and
    anchor-sensitive, so an in-tick retry is deliberately avoided.
- Refresh never loops: a second 401 is recorded as a normal sync error.

### P2 — Gate token minting

- `POST /api/v1/tokens` requires an `X-Admin-Key` header matching the
  `OZ_ADMIN_KEY` environment variable.
- When `OZ_ADMIN_KEY` is **unset** the endpoint remains open with a startup
  warning — this keeps local Docker development automatic and is backward
  compatible; production deployments set the variable to close the hole.
- The debug bootstrap reads `OZ_ADMIN_KEY` from its own environment and sends
  it, so local auto-provision keeps working against a gated server.

### P3 — Terminal registration / client credentials

- New `sync_terminals` table (migration in `oz-core`): `terminal_id` (PK),
  `device_secret` (hashed), `label`, `tenant_id`, timestamps.
- `POST /api/v1/terminals` (admin-gated) registers a terminal and returns a
  generated device secret.
- `POST /api/v1/tokens` accepts optional `client_id` + `client_secret` in the
  body; when present it verifies the terminal and issues a token carrying a
  `terminal_id` claim. The legacy `label`-only path remains for admin-minted
  tokens.
- The client stores the device secret in settings (`sync_terminal_secret`),
  registers itself once during debug bootstrap, and uses client credentials
  for minting + refresh thereafter.
- Settings keys named in ADRs are the literal constants in
  `platform/core/src/settings/keys.rs` (`SYNC_TERMINAL_SECRET = "sync_terminal_secret"`,
  not the dotted `sync.terminal_secret` once written here); the deny list that was
  hand-copied from this ADR is now generated from those constants, which is where
  an author must look.

### P4 — Structured 401 responses

- `auth_middleware` distinguishes *expired* from *invalid* tokens and returns
  `{"error": "token_expired"}` vs `{"error": "invalid_token"}` (plus
  `WWW-Authenticate`) instead of a bare 401.
- The client refreshes only on `token_expired`; `invalid_token` is treated as a
  configuration error and surfaced without retrying.

## Consequences

- Sync becomes self-healing after token expiry (P1) without operator action.
- The minting endpoint is closed by default in production (P2) while local dev
  stays automatic.
- Terminals gain real identity and per-device credentials (P3), matching the
  OAuth 2.0 client-credentials pattern used by POS vendors.
- Client refresh logic becomes precise about *why* auth failed (P4).

## Tradeoffs / risks

- P1's blanket 401-refresh also retries on a genuinely invalid key; the
  retry-once bound makes this harmless (it fails again and records the error).
- P2's "open when `OZ_ADMIN_KEY` unset" behaviour is a deliberate dev
  convenience; the operator must set the variable in production. A follow-up
  can flip the default to closed.
- P3's device secret is stored in the settings table (same protection level as
  the API key today); moving to the OS keyring is future work.
- No revocation list in this pass (P3 does not add one); tokens remain valid
  until `exp`, bounded by P1's refresh.

## Verification

Each phase ships with focused tests: transport/command 401 mapping (P1),
handler gating matrix (P2), registration + client-credentials minting (P3),
expired-vs-invalid middleware responses (P4), plus the existing sync suites.
