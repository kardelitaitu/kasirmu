# Sync endpoint for an unconfigured install — decision dossier

**Status:** RESOLVED — Automated credential activation implemented (§10). An enrolled install (Google, Email OTP, or Pairing Code) automatically mints its token, enables sync, and transitions the status pill to Connected. Unlinked/offline installs honestly remain Not configured.
The status-pill defect is fixed and verified (§2). §5's option **C** with §10 enrollment auto-activation resolves the bootstrap handshake.

**Date:** 2026-09-22 · **Updated:** 2026-09-25 · **Recorded against:** branch `0.0.40`
**Corrects:** the round-1 reading, "desktop has sync_bootstrap, mobile doesn't". That is true and
misleading — see §1.
**Corrected again (round 3, same day):** §4's "the credential is not [derivable]" was **wrong in
scope** — the admin-key mint is gated, but the client-credentials mint is not and already runs.
See §4a, which also fixes a stale citation in §4 (`config.rs:376-387` → `:452`) and adds
option **C** + a recommendation to §5.
**Implemented (round 4, same day):** C, per the §5 recommendation. See §8 for what landed, what it
does and does not deliver, and the residual it leaves open.
**Automated Sync Activation (round 6, 2026-09-25):** Closed credential loop upon enrollment; see §10.

---

## 1. The corrected finding: no release install configures sync, in either shell

The desktop bootstrap is debug-gated, so release desktop is in the same state as the tablet:

- `apps/desktop-tauri/src/lib.rs:236-242` — the call site is inside `#[cfg(debug_assertions)]`,
  and its own header says so: *"Release builds never run this code ... so a production install's
  configuration can never be touched by a stray local server"* (`sync_bootstrap.rs:18-20`).
- The tablet has no equivalent at all. `apps/mobile-tauri/src/lib.rs:100-140` runs a hardware
  bootstrap and the ADR #55 origin attestation; there is no sync bootstrap module.

What a release install therefore does on first run: nothing. `SyncConfig::from_settings`
(`crates/kasirmu-core/src/sync_client.rs:272-288`) returns `None` unless sync is **enabled** *and*
the **URL is non-empty**, and the daemon's answer to `None` is to no-op silently
(`platform/sync/src/daemon.rs:131-141`). Sync begins only when an operator pastes a URL (and a
token) into Settings → Sync by hand (`ui/src/features/settings/sections/SyncSection.tsx:200-216`).

So the pill was not a tablet quirk: **every fresh release install, desktop or tablet, is
unconfigured, and the red pill reported that as an outage.** That is why this investigation
started down the wrong path.

## 2. The pill fix — landed and verified

`2308801c2` *fix(ui): report an unconfigured service as unconfigured, not offline*.

- `unconfigured` joined the shared union (`ui/src/hooks/connectionHealth.ts:34-39`); both tone
  mappers give it `warn` (`:64-72`, `:98-102`) — amber, not red, because nothing is broken.
- The distinction rides on the probe's **own** status string, not on `ok === false`:
  `isSyncUnconfigured` (`:122-136`) matches `"No server URL configured"`, which all six probe
  arms emit (`apps/mobile-tauri/src/commands/sync.rs:123,332,399`;
  `crates/kasirmu-bridge/src/sync.rs:422,483,518`). A genuine ping failure also answers
  `ok: false` with no latency, so a latency test would have relabelled real outages as
  configuration gaps — the same lie, mirrored.
- Neither switch has a `default:` arm, so a sixth state is a compile error at every site that must
  handle it rather than a silently-unhandled case. The one `default` in the file is
  `fromWireHealth`'s wire fallback (`:159-161`), which is deliberate and documented.
- The renderer gets its own message instead of "Offline" (`ui/src/components/StatusBar.tsx:166-174`),
  keyed in both bundles.

**Verified this round:** `connectionHealth`, `useSyncConnection` and `StatusBarDegraded` — 37
tests, 3 files, all pass. Bundle parity: `verify-bundle-parity.py` → *0 missing key(s)* across
4923 en / 4999 id keys.

## 3. Is the endpoint derivable from what the device already knows? — yes, and it is plumbing-free

This was the promising hypothesis, and it holds on direct evidence:

- **Auth and sync are the same origin, path-routed.** `apps/unified/Caddyfile:44-83`:
  `/api/v1/license/*` → PocketBase `:8080`; `/api/sync/*` → the Rust sync server `:3099`. One
  host, one port, one TLS certificate. The sync endpoint *is* the licence origin.
- **The device already resolves that origin at boot.** `apps/mobile-tauri/src/lib.rs:116-128` runs
  the ADR #55 attestation cascade; `get_sync_settings_scoped` already returns
  `resolvedOrigin`/`resolvedOriginSource` to the UI (`apps/mobile-tauri/src/commands/sync.rs:168-175`,
  rendered at `SyncSection.tsx:223-232`).
- **The write already exists, in the right shape.** `sync_bootstrap.rs:86-97` persists
  url + key + enabled in one transaction, and `should_auto_provision` (`:63-79`) already encodes
  "only when no URL is configured; never touch a configured one".

So `sync_server_url := resolved_origin()` needs no new setting, no new transport, no operator
input, and no schema change. **That is the engineering call, and it is small.**

## 4. Why derivation alone is not the fix — it would make the pill lie in the other direction

Two things derivation does not supply:

1. `enabled = true` — trivial (`from_settings` gates on it).
2. **The credential, which is the real gate.** `POST /api/v1/tokens` mints the sync JWT, and in
   production it is admin-key gated: `apps/cloud-server/src/config.rs:452` refuses to boot
   without `OZ_ADMIN_KEY` (*"no open token mint"*), documented at `main.rs:18`. The client does not
   hold that key and must not. The only other mint path is terminal client credentials from pairing
   (`crates/kasirmu-core/src/sync_auth.rs:245-322` — `request_token_client_credentials`; the
   server branch is `crates/kasirmu-api/src/routes/tokens.rs:205-269`, which `return`s *before* the
   admin gate at `:272`; ADR #50 P3). **§4a shows this path is live and self-serving, which
   inverts the paragraph below.**

**And the trap:** the status pill probes an *unauthenticated* endpoint — `ping_server` GETs
`{url}/health` (`sync_auth.rs:479-482`), which answers 200 regardless of credentials. Derive the
URL, enable sync, and the pill turns **green** while every push 401s. That trades an honest amber
"Not configured" for a false green "Connected" — a worse lie than the one §2 just fixed, and it
would have hidden this very investigation.

**Conclusion (§4 as first written): the URL is derivable; the credential is not. Derivation ships
only together with a credential path, or not at all.** §4a narrows this: the credential path
already exists and already runs. What is missing is its *entry point*.

## 4a. Correction: the credential path is NOT missing — its entry point is

Verified 2026-09-22 by direct read, not inference. The claim above ("the credential is not
[derivable]") is true only of the **admin-key** mint. A second mint path exists, is live in
production, and self-persists the credential:

- **The mint bypasses the admin gate by construction.** `routes/tokens.rs:205-269` handles the
  client-credentials branch and `return`s a token at `:244` — *before* the P2 admin gate at
  `:272`. So `mint_token` (`sync_auth.rs:342-347`) preferring client credentials over the admin
  key is not a convenience ordering; it is the only path a device without the operator key can use.
- **A live consumer already does the whole dance.** `crates/kasirmu-bridge/src/memo.rs:509-548`:
  registers the terminal (`register_terminal`), mints via
  `request_token_client_credentials`, and persists `sync_terminal_id` + `sync_terminal_secret`
  — and persists them **only once a token actually minted** (`:540-547`), so a half-pair never
  looks good on the next run. It then reuses the stored pair (`:482-489`) and re-pairs when the
  terminal row id changes.
- **The client_id is the device's own terminal row id** (`memo.rs:498-501`), not a server-issued
  enrollment code. The minted claim and the local identity agree by construction.

**So the correction to §4 is this: the device can obtain, and keep, a sync credential without the
operator key.** The dossier's sentence "the only other mint path is … pairing, which still has no
UI" read the absence of a *pairing screen* as the absence of a *credential mechanism*. They are
different things. The mechanism is shipped; the screen is not.

### The residual gate — and it is the real open question

`register_terminal` **is** admin-key gated (`routes/terminals.rs:105` via
`admin_key_authorised`, `routes/tokens.rs:101-134` — dev-open only when the server has no key
configured). So the live path self-serves a credential only for a terminal that *already has a
registration row*. A cold, never-registered install still cannot obtain one, because registration is
the gated step, not the mint.

That is a **bootstrap circularity structurally identical to the URL's**, and it is what §5 should
have been asking:

> what authorizes a never-before-seen terminal to register itself?

Note the meta-point: the live path is *already* a working answer to "must a terminal be linked?" —
it links on first memo ack, informally, with no UI. The product question is therefore not "should we
build linking" but "**do we bless the informal self-linking that already ships, or gate it behind a
deliberate enrollment step?**"

## 5. The split — engineering call vs. your call

**Engineering call (I would not need your input on this one):** stop requiring an operator to type
an endpoint the device can already resolve; write `resolved_origin()` when — and only when — the
URL is unset, preserving "an explicit operator value always wins".

**Product call (yours):** whether a terminal must be **linked/enrolled** to obtain a sync
credential, or ships unlinked and silently not syncing.

ADR #56 already frames this and declines it by omission, which is why it is yours rather than mine:

- §2.4: a `local` install is exempt from revocation, expiry checks and server-side detection —
  *"outside every server-side control this system has"* — and requiring linking at provisioning is
  *"Q3 option B, and a product decision this record declines to make by omission"*.
- §2.5 designs device-code pairing for the tablet (code + QR, phone completes Google, tablet polls)
  and is explicitly **unimplemented** — *"§2.5 pairing, which still has no UI"*.

**§4a moves the axis.** The question is not "must a terminal be linked?" — `memo.rs` already
links it, informally, with no UI and no operator key. The question is whether a deliberate enrollment
step should *replace* or *bless* that informal path.

The three coherent answers:

| | Choice | Consequence |
|---|---|---|
| **A** | Sync belongs to a **deliberately enrolled** install. Provisioning (ADR #56 §2.2, from the §2.3 flow) obtains the credential and writes it in the same transaction. | An unenrolled install honestly shows "Not configured" forever. Requires solving §4a's registration circularity — the enrollment code, i.e. the §2.5 work. |
| **B** | Sync stays **operator-configured**, as today. | The pill fix (§2) is the whole fix. Refuse derivation; document the manual path. Leaves the product question unanswered, not answered. |
| **C** | **Derive the URL; let the credential arrive through the path that already ships** (`memo.rs`), and gate the green pill on an *authenticated* probe so it cannot lie. | No operator types a derivable URL. No new trust model. The informal self-linking becomes the sanctioned answer by being made visible and truthful. |

Under A, the change is bounded: extend the provisioning transaction to write
`server_url = resolved_origin()` + `enabled`, and the credential from the enrollment response,
reusing the `persist_provisioned_sync` shape (`sync_bootstrap.rs:86-97`, and
`should_auto_provision` `:63-79` already encodes "only when unset"). Under B, this dossier is the
closing record. Under C, the two changes are the URL write above plus the authenticated probe.

**Recommendation (§5, adopted and implemented — see §8): C, and only after the probe.** Reasoning: B answers nothing;
A's cost was mislocated — it is a trust-model change (§4a's registration circularity), not a UI
task, and the credential plumbing it would rebuild already exists. C takes the real win (no operator
typing a derivable URL) without the false green, and the authenticated probe is a prerequisite for
*every* version of A anyway. C is strictly less work than A and strictly more honest than B.

**The one decision C does not make for you, and the one I would not make unilaterally:** the pill
becomes honest, but the registration circularity remains. Whether an unregistered terminal may
self-register — i.e. whether terminal registration should stay admin-key gated — is a
trust-boundary call (`routes/terminals.rs:105`), not a UI detail. C is correct under either answer;
it simply declines to widen that boundary silently.

## 6. What I deliberately did not do

I did not implement derivation in rounds 1–3. In round 1 it was the product axis above, and
shipping it alone would have produced §4's false green — a defect worse than the one I was asked to
fix. In round 3 I verified the dossier rather than extending it, which changed one of its conclusions
(§4a) and moved the axis of another (§5). Changing a live credential or registration path is
exactly the kind of edit that should follow a decision, not precede it.

**Round 4 implemented C (§8) — and still did NOT widen the registration gate.** That boundary is
unchanged and remains the open item.

## 7. Uncertainty (stated, not hidden)

- The §1 claim rests on code paths — the debug-gated call site and the `from_settings` gate — not
  on a release build observed with the pill on screen. No release desktop or tablet build was run
  this round.
- The pairing leg was not exercised; ADR #56 §2.5 records it as having no UI.
- §4's unauthenticated-health claim is read from `ping_server` and the Caddyfile route, not from a
  live probe of production.
- §4a is read from the handler control flow (`tokens.rs:205-269` returning before `:272`) and the
  `memo.rs` consumer. It was **not** exercised end-to-end against a running gated server. The
  reading is unambiguous — an early `return` cannot reach a later gate — but a live
  client-credentials mint against a production-mode server with `OZ_ADMIN_KEY` set was not run.
- §4a's claim that the live path is reachable *in production* depends on a terminal already holding
  a registration row. Whether deployed tablets actually have one at first run was not checked
  against a device or a live database.

## 8. What landed (round 4) — option C, implemented

Two changes, both verified by their own tests. Neither touches the registration gate (§4a).

**1. The sync URL is derived from the origin the device already resolved.**
`derive_sync_url_if_unset` (`crates/kasirmu-core/src/sync_auth.rs`) writes
`resolved_origin()` when — and only when — no URL is configured, reusing the invariant
`should_auto_provision` already encoded for the debug path. It runs in both shells' boot, *after* the
ADR #55 attestation cascade, so it stores the attested winner (`main` or `fallback`) rather than the
compiled default: `apps/mobile-tauri/src/lib.rs`, `apps/desktop-tauri/src/lib.rs`.

**The §4 trap is closed in code, not by intention.** Derivation writes the URL and deliberately does
**not** set `enabled`, and does not touch credentials. The pill therefore keeps reading "Not
configured" after the write, because `SyncConfig::from_settings` still returns `None`. This is
pinned by `derived_url_alone_does_not_start_sync`, which asserts exactly that.

**2. The probe now asks an authenticated question, so the pill cannot lie.**
`/health` is public, so reachability alone was never evidence that sync works. `probe_sync_auth`
reuses the existing `fetch_tenant_plan` call against `GET /api/v1/tenants/me/plan` — already
authenticated, already in the `terminal` read preset (`read_tiers.rs:131-136`), read-only — so a
success proves the token is accepted *and* carries the scope a terminal was minted with. No new
endpoint, no new HTTP client.

- `SyncAuthHealth` is `Unauthenticated` | `Authorized` | `Rejected` | `Unknown`, carried on
  `PingResult.auth`. `Unknown` exists so a transport failure or a compiled-out feature is never
  reported as a refusal.
- `probe_sync_connection` composes reachability + credential in one place, so desktop and tablet
  cannot drift into different answers.
- UI: `unauthorized` joined the shared union (`connectionHealth.ts`) and is checked **before**
  `ok === true` in `useSyncConnection` — that ordering is the fix. Tone is `bad` (not the
  `unconfigured` amber): the device *is* set up and the server actively said no, which is a fault with
  a fix, not an absence.
- `PingResult.auth` is optional on the wire, so a shell that predates it reads as "not checked"
  rather than as success.

**Verification (all run, all green).** `cargo check` on core/bridge/mobile/app; 3313 core tests +
desktop tests; `cargo clippy -D warnings` clean on the three touched crates; UI typecheck, lint,
bundle parity (0 missing keys across 4923 en / 4999 id); 83 UI tests. Six Rust tests and eight UI
tests were added, including the trap test above and one asserting an absent `auth` field is never
read as success.

### What C does NOT deliver — the residual, stated plainly

**An unregistered install still cannot obtain a credential.** `register_terminal` is admin-key
gated (`routes/terminals.rs:105`), and the live `memo.rs` path only self-serves a terminal that
*already has a registration row*. So after this round a cold install derives a URL, still cannot
link, and honestly reads "Not configured". The pill is now truthful about that state instead of
inventing an outage — but the underlying product question (§4a's registration circularity) is
exactly as open as it was. C made the signal honest; it did not answer the question.

**Do not read this section as closing the dossier.** The §5 product axis is still the thing to
decide.

## 9. The enrollment pattern, corrected — and the reuse verdict

Round 5 investigated whether §4a's registration circularity could be answered by reusing the KDS
enrollment pattern. Two of my own claims were wrong in the process; both are corrected here.

**Correction 1 (mine):** §4a/round-3 said the credential *mechanism* ships and only the *pairing
screen* was missing. For sync terminals that stands. But I then claimed the KDS pairing flow
"“already runs for Kitchen Displays”. **It does not.** The KDS pairing contract was
half-built:

- **The producer existed, but in the UI, not Rust.** `KdsEnrollmentModal.tsx:212-232` generates 32
  random bytes, SHA-256s them, and passes `pairing_token_hash` to `register_kds_device_scoped`. So
  `RegisterKdsDeviceInput` takes a caller-supplied hash because a caller genuinely supplies one —
  not because a producer was forgotten.
- **The consumer does not exist at all.** `validate_pairing_token` had **zero production callers**
  (only its own tests). The QR encodes `{device_id, token, restaurant_pos_id, expires_at, stations}`
  (`KdsEnrollmentModal.tsx:411-418`) and is scanned by *something* — but no endpoint, command, or
  LAN handler redeems it. Nothing validates a scanned code.
- **Consumption did not exist.** Validation mutated nothing, so a code was replayable for its whole
  TTL.

**Repaired in `ef0a6ca11`** (committed this round): `issue_pairing_token` (the missing Rust
producer, 244-bit, hash-only storage) and `consume_pairing_token` (single conditional UPDATE, so the
check and the claim are one atomic step and a replay cannot win a race). Migration
`20261013_kds_pairing_consumption.sql` adds `consumed_at`/`consumed_by_device`.

**Correction 2 (mine):** I described the KDS pattern as reusable. It is reusable as a *template* —
the hashed-token + expiry + owner-FK shape and the fail-closed validator transfer well, and
`validate_pairing_token`'s constant-time compare and fail-closed expiry are genuinely good. But the
transfer is a **build**, not a lift: the sync-terminal path would still need a redemption endpoint
that does not exist anywhere today.

**The remaining gap is now precisely located.** What is missing for §5 option A is not a
validator and not a code format — both now exist and are tested. It is **the redemption endpoint**:
something that accepts a scanned/typed code and calls `consume_pairing_token`. That single missing
verb is the whole distance between the current state and an enrolled install.

**Still not built, and still not mine to build:** that endpoint is the trust boundary — it decides
whether a never-seen device may obtain a credential. The mechanism beneath it is now correct; the
policy above it is the §5 call.

**§9's locating of the gap was wrong, and §10 corrects it.** The redemption endpoint I called
missing is the Go licence server's `/api/v1/pairing/*` flow (`apps/license-server/pairing.go`,
registered at `main.go:402-404`), which already has every property §4a asked for: a 10-minute TTL
(`:34`), single-use consumption (`:160-162`), rate limiting (`:69-70`, enforced `:189`/`:246`), a
bounded session store (`:35`, `:217`), and — the part that closes the loop — `terminalPayloadForLink`,
which registers the sync terminal and returns its `deviceSecret` (`sync_terminals.go:105-118`).
The client half exists too: `PAIRING_START_PATH`/`PAIRING_POLL_PATH` (`desktop_link.rs:30-32`) with
both Tauri commands registered in both shells.

So the missing piece was never a trust boundary. It was **the last mile: writing the paired
credential into sync settings**, which §10 records as done (`store_linked_terminal`).

**Retraction — an earlier draft of this section slandered a correct document.** I wrote that
`manager-codebase-review.md:415` was stale because it records the pairing routes as falling through
to a 404. **It is not stale, and I was reading one paragraph out of context.** That section
*records the defect and its fix*: the Caddy carve-out was reconciled under commit `65f69112f`, the
checker `scripts/check-unified-routes.mjs` was added as a required gate, and it demonstrates its own
non-vacuity by failing when the handle is removed. Re-verified this round:
`node scripts/check-unified-routes.mjs` → *OK — 7 licence-server route prefix(es), each resolving
to :8080*, including `/api/v1/pairing/*` (`apps/unified/Caddyfile:66`). The document is accurate and
current; the error was mine.

**One note that does stand.** KDS pairing was a separate, genuinely broken mechanism, unrelated to
the above, and repaired in `ef0a6ca11`. But its shape was **not** what I first wrote either: the
producer existed (UI-side, `KdsEnrollmentModal.tsx:212-232`) and the validator was correct on hash
and expiry — the genuine defect was that validation **mutated nothing**, so a code stayed
replayable for its whole TTL. `issue_pairing_token` and `consume_pairing_token` close that gap.

**There is no missing QR consumer, and no unbuilt surface.** I claimed there was; that was wrong.
`kds_devices` is **device registration**, not routing: `kds.rs:216-221` — a device is enrolled to
answer *which physical screen is this, and which stations does it display*. The route and hierarchy
live in the **topology editor** (`topology.rs`, nodes/wires/stations, vendored contract with a UI
parity gate). Registration happens from the POS side via `registerKdsDeviceScoped`; nothing needs to
scan the QR. The four-step comment at `KdsEnrollmentModal.tsx:40-44` still describes a scanner
client, which is stale prose from a superseded design, not a missing deliverable.

## 10. Automated Sync Activation upon Linked Enrollment — Implemented (2026-09-25)

Round 6 completed the credential activation loop for linked terminals (`crates/kasirmu-bridge/src/sync.rs`):
- When a device links via Google (`link_device_google`), Email OTP (`link_device_email_consume`), or tablet Pairing Code (`poll_device_pairing`), the license server registers the terminal via `POST /api/v1/terminals` with its admin key and returns `terminal.issued = true` with `terminal_id` and `device_secret`.
- `store_linked_terminal` now stores the credentials into Settings, enables sync (`Settings::set_sync_enabled(&conn, true)`), and immediately requests the initial JWT token via `sync_client::request_token_client_credentials`.
- If `sync_server_url` is configured (derived at boot via `derive_sync_url_if_unset`), the minted token is stored into `sync_api_key`, bringing the status bar directly to "Connected" without requiring manual settings configuration.
- If network drops during the initial mint, `platform-sync`'s `refresh_persisted_api_key` in the daemon automatically recovers and mints on the next tick.
- Unlinked/offline terminals remain unconfigured, preserving honest "Not configured" status.
- Verified with unit tests (`crates/kasirmu-bridge/src/sync_tests.rs`: `store_linked_terminal_ignores_unissued_or_none`, `store_linked_terminal_stores_credentials_and_enables_sync`, `store_linked_terminal_mints_token_when_server_url_configured`).

