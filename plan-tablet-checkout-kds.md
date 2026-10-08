# Plan — tablet checkout & KDS path: IPC parity audit

<!-- Audit stamp: 2026-10-07 · Budak Korporat · branch `0.0.41` · HEAD `552a4ab6b`
     Evidence: static — the `generate_handler!` blocks of both shells, a
     wrapper→command map built from `ui/src/api/*.ts`, and
     `scripts/ipc-parity-allowlist.json`. Numbers below are measured by script,
     not estimated. Claims that would need a device are labelled STATIC. -->

## 0. Why this audit exists

`done-plan-tablet-homescreen-settings.md` (renamed 2026-10-08 after its acceptance ran) covered two surfaces — the homescreen and
the settings hub. The screen a merchant actually lives on (checkout) and the
screen a kitchen actually lives on (KDS) had never been checked against the
tablet's IPC surface. This is that check.

## 1. How it was measured

| Step | Instrument |
|---|---|
| Registered commands | bracket-matched `generate_handler![…]` in `apps/mobile-tauri/src/lib.rs` and `apps/desktop-tauri/src/lib.rs`, split on `::` → 415 mobile / 494 desktop |
| Commands the screens reach | every `loggedInvoke\|invokeCommand\|invoke('x')` literal, plus every symbol imported from `@/api/*` resolved through a wrapper→command map built from `ui/src/api/*.ts` |
| Scope | `ui/src/features/{retail,restaurant,pos,kds,sales,tables}`, excluding `__tests__` and `dev-mock` |
| Allowlist state | `scripts/ipc-parity-allowlist.json` |

## 2. Result — the checkout path is in far better shape than settings

- **114 distinct commands** are reachable from those six directories.
- **110 are registered on the tablet.** The settings hub, by contrast, had 82
  unregistered names against a much smaller surface.

**Exactly four are missing, and all four are KDS:**

| Command | Mounted at | Reachability on tablet |
|---|---|---|
| `list_kds_devices_scoped` | `kds/components/KdsDeviceStatusIndicator.tsx`, rendered by `KdsHeaderRight.tsx:115` | **Fires on every KDS screen mount.** The device's homescreen showed a Kitchen Display card, so this is live |
| `register_kds_device_scoped` | `kds/components/KdsEnrollmentModal.tsx`, mounted at `KdsScreen.tsx:579` | Opened by the enrollment button |
| `get_kds_routing_rules_scoped` | `kds/components/KdsRoutingRulesEditor.tsx`, via `KdsHamburgerPanel.tsx:13` | Opened from the KDS settings panel |
| `save_kds_routing_rules_scoped` | same editor | Same |

All four are already in the `tablet` allowlist, which is why
`verify-ipc-parity.py` is green on them. None is guarded by `isTabletShell()` —
there is no `isTabletShell` reference anywhere under `ui/src/features/kds/`.

## 3. Decision — register all four

This is the opposite call from the one I made for
`offline_queue_status_summary_scoped`, and the difference is the bridge, not the
cost:

- **`offline_queue_status_summary_scoped`** — the bridge fn carries the
  `ungated-ok` marker: it resolves a session and enforces **no** permission.
  Delegating it under ADR #49 would be case-2 debt erasure. Guarded instead.
- **These four** — every bridge fn calls
  `ctx.require_session_permission(...)`: `KDS_VIEW` for
  `list_kds_devices` / `get_kds_routing_rules`, `KDS_UPDATE` for
  `register_kds_device` / `save_kds_routing_rules`
  (`crates/kasirmu-bridge/src/kds_device.rs:42,68,101`;
  `kds_routing.rs:58,142,177`). The bodies already live in the bridge, and the
  desktop command is a four-line adapter
  (`apps/desktop-tauri/src/commands/kds_device.rs:26-47`) — the canonical
  ADR #49 shape.

A KDS tablet **is** a KDS device. Declining to enroll it is not a back-office
carve-out; it is a missing capability on the one platform where the screen
matters most.

## 4. Implementation

1. Add `apps/mobile-tauri/src/commands/kds_device.rs` and
   `kds_routing.rs` — thin adapters over the bridge, mirroring the desktop
   files. Bodies must stay in the bridge; no logic is copied.
2. Register the four in `apps/mobile-tauri/src/lib.rs`.
3. Delete the four entries from the `tablet` array in
   `scripts/ipc-parity-allowlist.json`. **Mandatory**: the gate fails on a stale
   entry, so this is enforced, not optional.
4. Do **not** add an `isTabletShell()` guard — these are capabilities the tablet
   should have.

## 5. Verification criteria

1. `cargo check -p kasirmu-mobile` — clean.
2. `python scripts/verify-ipc-parity.py` — tablet leg count drops from 82
   unregistered to 78, and the four names are gone from the allowlist.
3. The live walk: `node scripts/android-settings-walk.mjs --user owner
   --pin 1234 --routes=topology` for the crash, and a KDS-screen check once a
   Kitchen Display workspace is opened on the device. **Not yet done** — see §6.
4. From `ui/`: no renderer change in this step, so `npm run lint` and
   `npm run typecheck` are unaffected but cheap to re-run.

## 6. Limits — stated so nothing is over-read

- **STATIC, not walked.** No device walk of the checkout or KDS screens was
  performed. The tablet is signed in and reachable, but an order has to be
  rung through to exercise checkout, and that has not happened. This audit says
  the *commands* are registered; it does not say the *flow* works.
- **The installed APK is stale.** The walk measured a bundle that still throws
  `useSettings must be used within a <SettingsProvider>` on `#/topology`, i.e.
  it predates commit `4a90d10e5`. Every live result in this document and in
  `done-plan-tablet-homescreen-settings.md` §6 describes pre-fix behaviour until the
  bundle is rebuilt and reinstalled.
- **`list_kds_devices_scoped` failing is currently silent** — the indicator is
  in the KDS header, and its failure mode was not measured on a device.
