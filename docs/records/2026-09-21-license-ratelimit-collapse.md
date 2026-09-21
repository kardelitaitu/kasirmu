# Licence rate-limit collapse — 2026-09-21

Scope: the Android tablet could not use the auth/licence server. Investigated end to end —
the tablet, the two deployed hostnames, the licence server's own rate limiters, PocketBase's
client-IP resolution, and the client's origin ladder — then fixed in five commits on branch
`0.0.39`, ending at HEAD `061f3bff6`.

Repo state at write time: branch `0.0.39`, HEAD `061f3bff6`, PocketBase `v0.39.6`
(`apps/license-server/go.mod:6`). Measurements below are from this session unless dated
otherwise. No secret values appear in this document.

---

## 1. SUMMARY

The tablet was never talking to a down server. Every client in the world was being counted
against one rate-limit bucket keyed `127.0.0.1`, so the fifth activation attempt from
anywhere on earth within an hour 429'd everyone else, including the tablet on its first
request of the day. The licence server's per-IP limiters key on PocketBase's `e.RealIP()`,
and `RealIP()` only trusts `X-Forwarded-For` once `Settings.TrustedProxy.Headers` is
populated; nothing in this repository populated it, so the fallback `e.RemoteIP()` — the
Caddy reverse-proxy peer, i.e. loopback — became the key for every request. That produced a
real 429 with a real body from the licence server's own limiter, but the client flattened
the HTTP status into a generic `CoreError` and the status pill reported a connection
problem, so the whole failure read as "cannot connect to the server".

## 2. EVIDENCE

### 2.1 The key was the proxy's own address

`core/event_request.go:40` — `RealIP()` — iterates `settings.TrustedProxy.Headers` and,
per its own doc comment at `:33-34`, "fallbacks to `e.RemoteIP()`" when that set is empty
or no header is present. `git grep TrustedProxy` over `apps/license-server` finds no seed
outside the one added by this session's `e6e254881` (`main.go:132`, `seedClientIPSettings`),
so at the time of the outage `RealIP()` returned the connection peer for every request.
With Caddy on `:80` forwarding to PocketBase on `:8080`
(`docs/operations/runbook.md:407`), that peer is loopback — one bucket for the whole world.

### 2.2 One shared 5-per-hour limiter across nine lanes

`apps/license-server/ratelimit.go:50-53` declares the single `ipRateLimiter` with
`maxPerHr: 5`. Pre-fix it was consumed by nine lanes: `activate`
(`activate.go:594`), `recover` (`license_recover.go:142`), `renew` (`renew.go:59`),
`status` (`status.go:41`), `pause` (`pause.go:54`), `resume` (`resume.go:32`),
`trial` (`trial.go:133`), `enterprise-trial` (`enterprise_trial.go:95`) and `attest`.
Failed requests deliberately spend a token too — `attest.go:90` and `attest.go:94` consume
the budget on a malformed body or a bad nonce so probing with garbage cannot buy unlimited
signatures — which means the collapse throttled clients even when nothing succeeded.

### 2.3 Measured from the tablet

Against `license.kasir.mu`: ping 3/3, `GET /api/health` → 200, and
`POST /api/v1/license/attest` → 429. The same POST against the second hostname returned
429 as well. The 429 body is `attest.go:99-103` — the licence server's own limiter, not
PocketBase's and not the edge's. A server that answers 200 on `/api/health` and 429 on one
route is up.

### 2.4 The client made it look like an outage twice over

At HEAD-before-fix, `resolve_attested_origin` (`crates/kasirmu-core/src/attestation.rs:321`)
advanced the origin ladder on **any** error, so a 429 on rung zero walked to rung one and
spent a second token from the same bucket. The status was discarded into a generic
`CoreError` and the warning carried no status code. `advances_ladder`
(`crates/kasirmu-core/src/server_origin.rs:167-168`) now advances only on 403 / 404 / 421
and 5xx; `AttestError` (`attestation.rs:55-84`) carries `status: u16`, and every rung
logs origin, status, rung and whether it advances (`attestation.rs:371-386`).

### 2.5 The local two-proxy harness, and why the first fix was not enough

With the middleware in place but before the clamp, two distinct clients still shared a
bucket. The `X-Forwarded-For` header arriving at PocketBase is a **single entry** — the
proxies pass the client value through rather than appending — so `len(valid) == 1` while
`hops` defaults to 2, and the old guard `hops > len(valid) => return remoteIP` fired on
every request and returned the proxy address. The fix is to clamp the index to the oldest
available entry: `helpers.go:307-310`. Pinned by
`TestNormalizeClientIP_DistinctClientsGetDistinctKeys` (`helpers_test.go:253-273`), whose
own comment calls it "the outage in one assertion".

## 3. THE FIX

| Commit | What it does |
|---|---|
| `fb0626518` | Gives `POST /api/v1/license/attest` its own budget — `attestMaxPerHr = 60` (`ratelimit.go:47`), 12x the credential budget — so an ordinary app launch, which calls attest once, cannot consume the 5/hr that activation and recovery need. |
| `9095ca49a` | Makes the tablet's Auth pill probe a command the tablet shell actually registers: `isTabletShell() ? testSyncConnection : testAuthConnection` (`ui/src/hooks/useAuthConnection.ts:125`). The tablet registers no licence commands, so `test_auth_connection` was rejected at the IPC boundary and the pill blinked UNKNOWN forever regardless of server health. |
| `e6e254881` | Seeds `Settings.TrustedProxy.Headers` and adds a router-level middleware that collapses `X-Forwarded-For` to the single resolved client IP **before** any handler runs (`main.go:131-144`), so `RealIP()` — and therefore every limiter — keys on the client. |
| `0ce2483a1` | Clamps the hop index to the oldest available entry (`helpers.go:307-310`) instead of bailing out to `remoteIP` when the chain is shorter than `hops`; that bail-out was what still collapsed distinct clients after `e6e254881`. |
| `061f3bff6` | Stops the origin ladder from retrying a throttled rung and preserves the HTTP status through to the log (`server_origin.rs:167-168`, `attestation.rs:371-386`). A 429 is an answer, not a transport failure. |

## 4. VERIFICATION RUN

All four suites were run at `061f3bff6` on 2026-09-21:

- `cargo check --workspace --all-targets` — 0 errors, 0 warnings; compiles both shells.
- `cargo test -p kasirmu-core --lib attestation` — 13 passed.
- `cargo test -p kasirmu-core --lib server_origin` — 13 passed.
- `go test ./...` in `apps/license-server` — 648 pass, 0 fail.
- `npm run test -- useAuthConnection` (in `ui/`) — 28 passed.

**Fail-before-fix evidence.** Restoring the old `hops > len(valid)` guard and re-running the
two-client case reproduced the collapse: both clients resolved to the same key (`172.30.0.5`,
the proxy peer — `helpers_test.go:258`), failing at the assertion
`helpers_test.go:268`, "both clients collapsed onto key %q — the one-bucket outage". The
middleware-only run (before `0ce2483a1`) reproduced the same result, which is how the clamp
was identified as a separate defect from the missing trusted-proxy seed.

## 5. HOW TO VERIFY AFTER DEPLOY

Staged, because the fix changes how a live server keys its buckets:

1. **Pre-set** `LICENSE_CLIENTIP_MODE=off` via the runtimeEnvironment PATCH, then deploy. The
   code ships with XFF mode as the default (`helpers.go:192-194`), so without this the first
   request after deploy is also the first request that trusts the header.
2. **Deploy**, then verify with `python scripts/verify-deployment.py`
   (`scripts/verify-deployment.py:1-24`; exit 0 = complete). Pace the probes: a scripted pass
   over both names tripped a 403 on every `/api/v1/*` path on 2026-09-26, which is a
   property of the edge, not of the deployment.
3. **Flip** `LICENSE_CLIENTIP_MODE` to `xff` and restart.
4. **Discriminator:** two *distinct* client IPs must get *independent* budgets — one IP
   exhausting its 5/hr must NOT 429 the other. Use a **credential** lane (e.g. `status`), not
   attest: attest is 60/hr (`ratelimit.go:47`), so it cannot show a 5/hr split.
5. **Rollback** = PATCH the runtimeEnvironment back to `off`. Seconds, one restart, no build.

## 6. OPEN RISK / UNKNOWNS

- **The fix is conditional on the real edge APPENDING to `X-Forwarded-For`.** The clamp
  (`helpers.go:304-311`) resolves a short chain to the oldest available entry, which is
  correct for a pass-through edge and wrong for an appending one.
- **The local harness could only emulate a replacing edge.** Production behaviour is therefore
  unverified. Read `helpers.go:256-263`: this is correctness for a pass-through edge and is
  explicitly *not* spoof-resistance — an edge that passes a client-supplied header through
  hands that client its own choice of rate-limit key.
- Cloudflare sets `CF-Connecting-IP`, mode `cf` works and was proven
  (`helpers_test.go:375-391`) — but `license.kasir.mu` sits behind istio-envoy, so `cf`
  cannot cover it.
- `LICENSE_CLIENTIP_MODE` and `LICENSE_TRUSTED_HOPS` are **unset in production**; `hops`
  therefore takes its default of 2 (`helpers.go:204-217`). *Inference, not measured:* if the
  real edge appends, 2 may be off by one and the resolved IP may be one hop too far right.

## 7. UNRELATED FINDINGS WORTH FIXING

- `OZ_LICENSE_PRIVATE_KEY` in the root `.env` is written as a quoted multi-line PEM
  (`.env:51-78`), but any line-`=` loader — docker compose, and whatever pushes `.env` into
  Northflank secrets — reads only `.env:51`, the bare 27-character
  `-----BEGIN PRIVATE KEY-----` opener. Whatever consumes that file cannot be getting a
  valid key.
- `PADDLE_WEBHOOK_SECRET` and `PADDLE_PRICE_TIERS` are absent from `.env`; only
  `PUBLIC_PADDLE_CLIENT_TOKEN` and `PUBLIC_PADDLE_ENVIRONMENT` are present (`.env:84-85`).
- Agent docs describe `KASIRMU_*`-prefixed env names (`AGENTS.md:51-54`) while `.env` uses
  UNPREFIXED names throughout (`OZ_API_SECRET`, `OZ_ADMIN_KEY`, …).
- The runbook's claim that only `license.ozpos.my.id` is live is stale
  (`docs/operations/runbook.md:405`); `license.kasir.mu` serves 200 today.
- ADR #55's "attest 404s on the live host today" is stale
  (`docs/decisions/2026-09-19-adr55-server-origin-model.md:117`).
- **There is no documented rollback recipe for a Northflank deploy.** `git grep -i rollback
  docs/operations/runbook.md` → 0 hits; `:126` says "roll back the last deploy" without
  saying how.
- Setting `CARGO_BUILD_JOBS=""` makes cargo **fail**; empty is not the same as unset. Remove
  the variable (`apps/mobile-tauri/AGENTS.md:239-244`), do not blank it.

## 8. TIMELINE

- **2026-09-21** — Tablet reports it cannot use the auth/licence server. Measured from the
  device: ping 3/3 to `license.kasir.mu`, `GET /api/health` → 200,
  `POST /api/v1/license/attest` → 429 on both hostnames.
- **2026-09-21** — Traced the 429 to `attest.go:99`; found all limiters keyed on
  `e.RealIP()` and `TrustedProxy.Headers` empty, i.e. one loopback bucket.
- **2026-09-21** — Attest split onto its own 60/hr budget (`fb0626518`).
- **2026-09-21** — Tablet Auth pill probe corrected (`9095ca49a`).
- **2026-09-21** — Trusted-proxy seed + collapsing middleware (`e6e254881`).
- **2026-09-21** — Two-proxy harness: distinct clients *still* shared a bucket; single-entry
  header with `hops=2` tripped the old guard. Clamp added (`0ce2483a1`).
- **2026-09-21** — 429 no longer advances the origin ladder; status preserved and logged
  (`061f3bff6`).
- **2026-09-21** — Full verification run (§4) at `061f3bff6`: 13 + 13 Rust, 648 Go, 28 UI.
