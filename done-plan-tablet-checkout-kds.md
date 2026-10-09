# Plan — tablet checkout & KDS path: IPC parity audit

<!-- Acceptance stamp: 2026-10-10 · branch 0.0.41 · status: ACCEPTED · EARNED
     Acceptance commands:
       1. cargo check -p kasirmu-mobile (PASS, 0 warnings/errors)
       2. python scripts/verify-ipc-parity.py (PASS, IPC parity: OK)
       3. Physical walk: Track B Restaurant POS & KDS verified live on Xiaomi Redmi Pad SE
          (Android 15 / API 35) via CDP: course firing, split tenders, KDS kitchen display
          header status indicator and live order routing all verified functional. -->

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
3. The live walk: verified live on Xiaomi Redmi Pad SE via CDP in Track B (table management, course firing, split payment across tenders, KDS routing, and shift reconciliation).
4. From `ui/`: verified clean with `npm run typecheck` and `npm run lint`.

## 6. Limits & Live Evidence

- **WALKED & VERIFIED ON DEVICE (2026-10-10):** Device walk of both Restaurant checkout and KDS screens was performed on Xiaomi Redmi Pad SE (Android 15 / API 35) over CDP port 9222.
- **Evidence Artifacts:**
  - `tablet_pos_phase4_kds.png` / `tablet_pos_phase4_kds_screen.png`: Live KDS screen connected, header device indicator green, course-fired tickets rendered.
  - `tablet_pos_phase3_split_completed.png` / `tablet_receipts_restored.png`: Orders processed across multiple tenders and receipt history viewed.
- **APK Freshness:** Built with `apps/mobile-tauri` containing `kds_device.rs` and `kds_routing.rs` registered commands and installed on device.
