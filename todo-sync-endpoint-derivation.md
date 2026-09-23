# Sync endpoint for an unconfigured install — decision dossier

**Status:** OPEN — one engineering leg is settled, one product axis is not. The status-pill defect
that started this is fixed and verified (§2). Nothing in §5 was implemented, on purpose: the
choice is yours, and §4 shows that the obvious half-fix makes the visible signal *less* truthful.

**Date:** 2026-10-06 · **Recorded against:** branch `0.0.39` @ `191c37b42`
**Corrects:** the round-1 reading, "desktop has sync_bootstrap, mobile doesn't". That is true and
misleading — see §1.

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
   production it is admin-key gated: `apps/cloud-server/src/config.rs:376-387` refuses to boot
   without `OZ_ADMIN_KEY` (*"no open token mint"*), documented at `main.rs:18`. The client does not
   hold that key and must not. The only other mint path is terminal client credentials from pairing
   (`crates/kasirmu-core/src/sync_auth.rs:162-174`; ADR #50 P3).

**And the trap:** the status pill probes an *unauthenticated* endpoint — `ping_server` GETs
`{url}/health` (`sync_auth.rs:479-482`), which answers 200 regardless of credentials. Derive the
URL, enable sync, and the pill turns **green** while every push 401s. That trades an honest amber
"Not configured" for a false green "Connected" — a worse lie than the one §2 just fixed, and it
would have hidden this very investigation.

**Conclusion: the URL is derivable; the credential is not. Derivation ships only together with a
credential path, or not at all.**

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

The two coherent answers:

| | Choice | Consequence |
|---|---|---|
| **A** | Sync belongs to a **linked** install. The provisioning transaction (ADR #56 §2.2, reached from the §2.3 flow) obtains the credential and writes sync in the same transaction. | An unlinked install honestly shows "Not configured" forever. Derivation is real but only fires on the linking path. The pairing UI is the work. |
| **B** | Sync stays **operator-configured**, as today. | The pill fix (§2) is the whole fix: the app now says "Not configured" instead of inventing an outage. Refuse derivation; document the manual path. |

Under A, the change is bounded: extend the provisioning transaction to write
`server_url = resolved_origin()` + `enabled`, and the credential from the pairing response,
reusing the `persist_provisioned_sync` shape. Under B, this dossier is the closing record.

## 6. What I deliberately did not do

I did not implement derivation. It is the product axis above, and shipping it alone would have
produced §4's false green — a defect worse than the one I was asked to fix. The honest interim
state is the one now in the tree: an unconfigured install says so.

## 7. Uncertainty (stated, not hidden)

- The §1 claim rests on code paths — the debug-gated call site and the `from_settings` gate — not
  on a release build observed with the pill on screen. No release desktop or tablet build was run
  this round.
- The pairing leg was not exercised; ADR #56 §2.5 records it as having no UI.
- §4's unauthenticated-health claim is read from `ping_server` and the Caddyfile route, not from a
  live probe of production.
