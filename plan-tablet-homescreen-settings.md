# Plan — tablet homescreen & settings: verification, defects, repair

<!-- Audit stamp: 2026-10-07 · Budak Korporat · branch `0.0.41` · HEAD `367e6a634`
     Evidence: live Redmi 23073RPBFG (Android 15) over wireless ADB + CDP against
     `mu.kasir.mobile`, plus `scripts/verify-ipc-parity.py` and the two
     `invoke_handler` blocks. Claims below are marked MEASURED or STATIC; nothing
     in this file is an estimate dressed as a measurement. -->

## 0. How this was measured

| Instrument | What it produced |
|---|---|
| ADB + CDP (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, then `Runtime.evaluate`) | live DOM of the running tablet app: 1920x1200 landscape, debug APK, footer reads `v0.0.41 · 5a94f99+dirty` |
| `apps/mobile-tauri/src/lib.rs:941-1408` vs `apps/desktop-tauri/src/lib.rs:1285-1823` | 413 vs 494 registered command fns |
| `scripts/verify-ipc-parity.py` | `info[tablet]: 484 UI command strings, 414 registered, 82 unregistered UI command names … (82 allowlisted)` |
| `scripts/ipc-parity-allowlist.json` | the same 82, as bare names — no per-entry rationale on the `tablet` leg |

Two limits on this audit, stated so nothing is over-read:

- **Live walking stopped at the homescreen.** The tablet's session expired
  mid-audit (the app returned to `staff-login-screen`) and I did not guess a
  PIN to get back in. §2 is therefore STATIC for the settings hub, except where
  a line is marked MEASURED. §2.4 says exactly how to close that gap.
- **The installed APK is `DEBUGGABLE`.** Debug hides the licence gate
  (`get_license_status` reports free/valid in debug), so nothing here exercises
  the release-only licensing path.

---

## 1. Homescreen — `ui/src/features/workspaces/WorkspaceHome.tsx`

### 1.1 Current state — MEASURED

Rendered at hash `""`, logged in, 1920x1200:

- **3 workspace cards** — Restaurant POS (`workspace-card--active`), Warehouse,
  Kitchen Display. Each carries a pin control and a digit hint ("Press 1 to open"
  … "Press 3 to open"). `store-pos` is absent because this device's store has no
  retail instance, not because of a code fault.
- **11 tool cards** — 6 unlocked (Staff Management, Locations, Terminals, Shifts,
  Settings, Topology Editor) and 5 locked (Memos, Promotions, Analytics, Reports,
  Audit Log). The locks are tier locks (pro/premium against a free entitlement),
  which is the designed behaviour.
- **No licence notice** — `subscriptionState` is open, so the notice at
  `WorkspaceHome.tsx:768` correctly stays hidden.
- Greeting renders ("Hola, Adikara Dwi Atmaja").
- `.workspace-home-header` is **empty** in the loaded state.

Verdict: the homescreen loads, sorts, pins, gates and announces correctly. It is
not broken; it has one hard crash and three smaller defects.

### 1.2 Defects

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| **H1** | **P0** | Opening the Topology Editor crashes the app | MEASURED: `location.hash='#/topology'` → body text `Something went wrong` / `useSettings must be used within a <SettingsProvider>` |
| **H2** | P1 | `OrgSelector` never renders once loaded | MEASURED: `.workspace-home-header` innerHTML is `""`. It is mounted only in the skeleton branch (`WorkspaceHome.tsx:704`); the loaded render has an empty `<header className="workspace-home-header" />` at `:740` |
| **H3** | P2 | Nested interactive control | STATIC: `WorkspaceHome.tsx:992-1003` — a `<span role="button" tabIndex={0}>` (the pin) inside the card `<button>` at `:982` |
| **H4** | P1 | Even with H1 fixed, the editor cannot load or save on this shell | STATIC: 10 topology commands are unregistered on the tablet and `apps/mobile-tauri/src/commands/` has **no** `topology` module (desktop has `topology.rs` + `topology/`) |
| **H5** | P2 | "Add Workspace" leads to the same dead end | STATIC: the empty-state card calls `handleShortcutNav('topology')` (`:862`); the Topology tool card (`:238-252`) is unlocked at manager |

#### H1 root cause — measured, not inferred

`SettingsProvider` is mounted by exactly one component in the tree
(`ui/src/features/settings/SettingsPage.tsx:73`; grep over `ui/src` returns only
`SettingsContext.tsx` and `SettingsPage.tsx`). `NodeTopologyEditor` consumes the
context anyway:

- `ui/src/features/locations/NodeTopologyEditor.tsx:255` — `const { settings } = useSettings();`
- `ui/src/contexts/SettingsContext.tsx:661` — throws when the context is null.

The value is used for **one** thing: a badge label at
`NodeTopologyEditor.tsx:2033`
(`settings.receipt.paperWidth === 'standard' ? 'Receipt ✓' : 'Receipt 58mm'`).

This is **not tablet-specific**. `ui/src/app/AppShell.tsx:385-387` routes
`settings/topology` onto the same `topology` page, so the desktop crashes
identically. Fix it once, in the shared component.

#### H4 scope — the ten unregistered topology commands

`load_topology`, `apply_topology_diff`, `can_save_topology`,
`load_topology_revision`, `list_topology_revisions`, `list_topology_templates`,
`load_topology_template`, `save_topology_template`, `delete_topology_template`,
`pin_topology_revision`.

All ten sit in `scripts/ipc-parity-allowlist.json` under `tablet` **with no
reason recorded** — unlike the memo-authoring and quota-remediation entries,
which the allowlist's own `_comment` justifies as deliberate product choices.
That absence is the finding: nobody has written down whether the tablet is
supposed to have a topology editor.

### 1.3 Implementation plan

**H1 — make the topology editor survive outside `SettingsProvider`.**

Follow the pattern the repo already uses rather than inventing one:
`useOptionalTheme()` (`SettingsPage.tsx:22`) and BrandContext's documented
"returns `null` if no provider" accessor (`BrandContext.tsx:113`) both exist for
exactly this case.

1. Add `useOptionalSettings()` to `ui/src/contexts/SettingsContext.tsx` — reads
   the same context, returns `null` instead of throwing. Do **not** relax
   `useSettings()`; its throw is load-bearing.
2. `NodeTopologyEditor.tsx:255` — `const settings = useOptionalSettings()?.settings ?? null;`
3. `:2033` — `settings?.receipt.paperWidth ?? 'standard'` as the fallback, so the
   badge degrades to "Receipt ✓" rather than lying about a 58mm printer.
4. **Do not** hoist `SettingsProvider` into `AppProviders`. It runs the whole
   settings fan-out on every boot; on a 4 GiB tablet that is the wrong trade for
   one badge label.

Alternative if the owner prefers the value to be real rather than defaulted:
read `getReceiptSettingsScoped(sessionToken)` inside `TopologyScreen` —
`commands::settings::get_receipt_settings_scoped` **is** registered on the tablet
(`apps/mobile-tauri/src/lib.rs:1321`) — and pass `paperWidth` down as a prop.
Cheaper than a provider, but it adds a prop and an IPC that the badge does not
justify. Recommendation: the optional hook.

**H2 — restore the org selector.** Confirm intent first: the empty loaded header
may be deliberate (the skeleton mounts `<OrgSelector />` at `:704`, so someone
moved it out and left the element). If it is a regression, restore
`<OrgSelector />` at `:740`. `switch_organization` is registered on the tablet,
so multi-org switching works there — this is a UI omission, not an IPC gap.

**H3 — unnest the pin.** Move the pin out of the card `<button>` into a
sibling positioned over it (the card keeps `position: relative` already), or
make the card a `<div role="group">` containing two real `<button>`s. The
sibling form is smaller and keeps the existing keyboard handler intact. Watch
`focusVisibleCompliance`: a new `button.<class>` compound is a **waived** base
and `BOUNDARY_WAIVED_BASELINE` is frozen — use a modifier class such as
`.workspace-card-pin-btn--button`.

**H4 — decide, then either register or withdraw.** This is an owner decision,
not an implementation detail, because the two answers differ in cost by an
order of magnitude:

- **Register (recommended).** Add `apps/mobile-tauri/src/commands/topology.rs`
  re-exporting the bridge command fns (desktop's `topology.rs` + `topology/`
  are the model), register the ten in `lib.rs`, then delete the ten allowlist
  entries. Cost: a real port, plus a mobile compile of the topology module.
  Rationale: topology is the tablet's only front door to creating a workspace
  (the "Add Workspace" card), and the tool card is already advertised to
  managers.
- **Withdraw.** Hide the Topology Editor card on the tablet (a shell branch in
  `WorkspaceHome.tsx`, the same `isTabletShell()` idiom `LicenseSettings.tsx:129`
  already uses) and repoint "Add Workspace" at something the tablet can do.
  Cost: small. Rationale: topology authoring may genuinely be back-office only,
  as the memo-authoring precedent rules.

Either way, **write the decision into the allowlist** as a per-entry `reason`,
so the next reader is not re-deriving it from a bare name.

**H5** falls out of H4 — it is the same route.

### 1.4 Verification criteria

1. **Crash pin (new test).** Render `TopologyScreen` (or `NodeTopologyEditor`)
   with **no** `SettingsProvider` above it and assert no throw and that the
   receipt badge renders. Prove the pin can go red: revert to `useSettings()`
   and watch it fail with the current message.
2. **Route pin.** `TabletAppShell` renders `route: 'topology'` from
   `#/settings/topology` without the error boundary. Add it beside
   `TabletAppShellWorkspaceRoute.test.tsx`.
3. **Live re-measure (the acceptance command).** On the tablet, logged in:
   navigate `#/topology` and assert the boundary text is absent and
   `.settings-section-content`-equivalent content mounts. This is the same CDP
   walk §2.4 describes.
4. **Parity gate.** `python scripts/verify-ipc-parity.py` — exit 0, and the
   tablet count in `info[tablet]` drops by the number of commands registered.
   The gate fails on a **stale** allowlist entry, so deleting the entries is
   enforced, not optional.
5. **UI gates.** From `ui/`: `npm run lint && npm run typecheck`. Any CSS you
   touch additionally trips `screenExtraction` and `themeTokenCompliance`.

---

## 2. Settings — `ui/src/features/settings/SettingsPage.tsx` and its 14 sections

### 2.1 Current state

The hub is a `SettingsProvider` shell with a `SettingsNavTree` sidebar and one
lazy screen per section. `KEPT_SECTIONS`
(`hooks/useSettingsHashSection.ts:38-40`) and `SETTINGS_SCREENS`
(`screens/registry.ts`) agree on 14 keys: general, license-subscription,
devices-connectivity, business-defaults, features-modules, security-account,
data-sync, data-management, sync-status, sync-conflicts, offline-queue,
tax-configuration, exchange-rates, system-diagnostics.

`ui/src/features/settings/SettingsNavTree.tsx` carries the third independent
list; `SettingsPage.test.tsx` asserts all three agree. **Keep them independent**
— deriving one from another turns that assertion into a list compared with
itself.

The rebuild is claimed complete: `screens/registry.ts` records a 2026-10-07
tablet walk (CDP, debug APK embedding commit `7198980`) in which **no** section
rendered the "This page is being rebuilt" notice and Data & Sync, Sync Status,
General and Security & Account each rendered their controls. I could not
re-run that walk (§0); treat it as a peer measurement, not mine.

### 2.2 The structural fact

**82 command names that shipped UI code invokes are not registered in the tablet
shell.** All 82 are allowlisted, so `verify-ipc-parity.py` passes its tablet leg.
The allowlist is a *record of debt*, not a fix: an unregistered `invoke`
rejects, and each call site decides whether that surfaces.

Sorted by whether the hub can actually reach it:

**Reachable, and wrong today**

| Commands | Where | Effect | Fix |
|---|---|---|---|
| `pg_sync_status_scoped` | `SettingsPage.tsx:153`, on **every** hub mount | `.catch(() => {})` swallows it, so the nav's dead-letter badge is permanently 0 | register it, or stop asking on tablet |
| `offline_queue_status_summary_scoped` | `hooks/useDataSyncDraft.ts` → `GeneralScreen`, `DataSyncScreen`, `SyncStatusScreen` (3 sections) | queue summary never populates | register, or guard |
| `suspend_surplus_workspace_instances_scoped`, `recover_workspace_instances_scoped` | `OverQuotaCard.tsx`, reachable via `license-subscription` → `LicenseSettings` | the remediation buttons cannot work | **guard**, following `LicenseSettings.tsx:129` `actionsAvailable = !isTabletShell()`; the allowlist already records these as a deliberate back-office-only product choice |

**Reachable, and correctly handled — do not "fix" these**

- `LicenseActivationScreen.tsx:293` — the licence-key path is wrapped in
  `if (!isTabletShell())` (C47), and the key tab is hidden at `:605`. The
  tablet's route is device pairing, whose commands *are* registered.
- `LicenseSettings.tsx:129` — `actionsAvailable = !isTabletShell()` gates
  pause/resume.
- `hooks/useBackupStatus.ts:140,153` — uses the tablet twin `create_backup_to`.
- `hooks/useRestore.ts:121` — `isAvailable = !isTabletShell()`.
- `api/system.ts:27` — `version_scoped` falls back to the registered `version`
  with a comment saying so.

**Not reachable from the hub — no work**

- `LocalApiSection` — 0 importers (6 `local_api_*` commands).
- `AboutSection` — 0 importers.
- `EmailReportSettings` — the only reference is a comment.
- `AppearanceSettings`' `pick_logo_file` — not in the 14-section map.

These are the allowlist's real dead surface. Deleting them is a separate,
cleaner change than fixing them; do not conflate the two.

### 2.3 Implementation plan

Ordered so each step is independently verifiable:

1. **Write rationales down — but NOT into the `tablet` allowlist array.**
   ~~Convert the ones you touch to `{"name": …, "reason": …}`.~~ **Corrected
   2026-10-07 by running the gate.** `verify-ipc-parity.py` rejects the object
   form in the `tablet` section outright: `scripts/verify-scoped-reads.py`
   grades that section as bare names, so an object there fails a gate its owner
   may not be working in. The gate's own message names the two places a reason
   may live: the `_tablet_comment` prose **or a tracking doc**. This file is
   that tracking doc — see §5.
2. **`pg_sync_status_scoped`** — smallest fix with the widest blast radius
   (fires on every hub mount). Either register it in `apps/mobile-tauri/src/lib.rs`
   (it is a scoped read; check the permission it asserts) or drop the call behind
   `isTabletShell()` so the badge stops implying a value it never read.
3. **`offline_queue_status_summary_scoped`** — same decision, for 3 sections.
   Read `useDataSyncDraft.ts` first: if the value already degrades cleanly, this
   may only need the guard, not the registration.
4. **OverQuotaCard** — add the `isTabletShell()` guard so the two buttons are not
   rendered where they cannot work. This is the C41/C47 shape the allowlist
   already names for the licence commands.
5. **Topology** — see H4. It is one decision covering both pages.
6. **Retire, do not repair**, the three unreachable sections once confirmed:
   `LocalApiSection`, `AboutSection`, `EmailReportSettings`. Check the *other*
   shell's UI first — `verify-ipc-parity.py` prints `info[tablet-unrequested]`
   and warns explicitly that a command named by neither side is the only
   population a retirement can start from.

### 2.4 Verification criteria

1. **A scripted live walk, and it must be repeatable.** The gap in this audit is
   that nobody can re-run it without a person typing a PIN. Add a CDP walk
   (the `scripts/android-cdp.mjs` seam, or the same
   `adb forward` + `Runtime.evaluate` pair used here) that, given a logged-in
   tablet, visits all 14 `#/settings/<section>` hashes and asserts for each:
   the section container is non-empty, the control count is > 0, and no
   `console.error` / `window.error` fired. Record the login it needs in the
   script's header.
2. **Per-section parity.** For each of the 14, list the commands its screen
   reaches and mark each registered / guarded / retired. This is the artefact
   §2.2 is a first draft of; finish it as a table in the PR.
3. **Gate.** `python scripts/verify-ipc-parity.py` → exit 0. Note it **exits 1
   today**, from its **dev-mock** leg, on `edc_inquiry`, `edc_settle` and
   `print_edc_settlement_slip_scoped` — a separate live red, not caused by
   anything in this plan, and not fixed by it.
4. **UI gates.** From `ui/`: `npm run lint && npm run typecheck`, plus
   `screenExtraction` / `themeTokenCompliance` for any CSS touched.

---

## 3. Conventions this plan must respect

- **Branch `0.0.41`, version locked.** No branch creation or switch; no version
  bumps in `Cargo.toml` / `package.json` / `tauri.conf.json`.
- **Commit form** — `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.
  No `git add`, no `-a`, no `--amend`, no `stash`. New files: one chained
  `git add -- <p> && git commit -m "..." -- <p>`.
- **Shell parity is a gate, not a style.** Any command you register must come
  off `scripts/ipc-parity-allowlist.json` in the same commit — a stale entry
  fails the gate.
- **Renderer conventions.** A new class name must exist in the screen's own sheet
  or one it cites as `parentCss` (`screenExtraction`). Never write a `var()`
  fallback tail on a token all three blocks define. Never add a `button.X`
  compound (`focusVisibleCompliance`). `align-items` on buttons comes from
  `reset.css` and is not inherited — restate it if you override `display`.
- **Money stays `i64`**; SQLite writes stay inside a rusqlite transaction.
- **Pre-existing `ui` reds.** Two were recorded at HEAD on 2026-10-04:
  `screenExtraction` on `settings/SyncConflictsPanel.css` and
  `themeTokenCompliance` on `WorkspaceHome.css:958`. **Re-measure them before
  you start** — if still red, do not attribute them to your change and do not
  "fix" them in a settings commit.

## 4. Suggested sequencing

1. H1 (crash) + its test — small, shared, unblocks the rest.
2. Allowlist rationales + the three reachable settings gaps (§2.3 steps 1-4).
3. H4 topology decision — needs the owner.
4. H2, H3 — cosmetic, independent.
5. Retirements + the repeatable CDP walk (§2.4 step 1).

## 5. Decisions

The owner delegated all four ("you decide; we want a good Android experience").
Recorded here because §2.3 step 1 establishes this file as the tracking doc the
parity gate points at.

### 5.1 Does the tablet get a topology editor? — **Withdraw.**

Not a cost call alone. A port is ten registrations **plus** the lifecycle the
desktop owns: pending-Apply recovery and topology revision retention. No Android
build has ever exercised an interrupted cross-DB Apply, and a node-graph editor
is the wrong surface for a 10-inch touch screen regardless. So:

- `WorkspaceHome.tsx` — `runsOnThisShell()` filters `topology` out of the tool
  grid on the tablet.
- The empty-state "Add Workspace" card is hidden on the tablet too (H5). It
  called `handleShortcutNav('topology')`, and its quick-start presets set a type
  key with **no registered instance**, so they cannot mint a session either. The
  honest Android empty state is the contact-admin guidance.
- **Read-only Locations stays available** — this withdraws authoring, not
  viewing.
- The ten command names stay in the `tablet` allowlist, because the shared UI
  still names them. Delete them when a real port ships.

### 5.2 Is the empty `.workspace-home-header` intentional? — **Yes; H2 is closed
as not-a-defect.**

`OrgSelector` is a **pre-login** control. Restoring it into the signed-in header
would put an organization switcher where the session already fixes the
organization. The empty element is left alone deliberately.

### 5.3 `pg_sync_status_scoped` / `offline_queue_status_summary_scoped` —
**Guard both; register neither.**

The deciding fact is different for each, and neither is "it is expensive":

- `pg_sync_status_scoped` has no counterpart on a tablet — there is no Postgres
  sync daemon, and the command lives in the desktop's `sync.rs`. Registering a
  read with nothing behind it would not make it work.
- `offline_queue_status_summary_scoped` **could** be registered cheaply, and
  that is exactly why it must not be: `crates/kasirmu-bridge/src/offline.rs`
  carries the `ungated-ok` marker — the fn resolves a session and **enforces no
  permission**. Delegating it under ADR #49 would be case-2 debt erasure, which
  the mobile module header records as an owner ruling.

Both reads are now skipped behind `isTabletShell()`. In both cases the UI's
`null` state means "not answered", so the badge hides rather than rendering a
fabricated zero.

### 5.4 Who re-runs the live walk? — **Still open.**

Neither §5.1-5.3 depends on it, but §2.4 step 1 does. The settings half of this
audit is static-only until someone records how to reach a logged-in tablet
without a human typing a PIN. Unchanged from the original audit.

### 5.5 Extra: the settings hub needed a scoped token, not a guard

Found while implementing, not in the original audit. `SettingsProvider` treats a
missing scoped token as an *answered* load and publishes `DEFAULT_SETTINGS`, so
on a tablet — where the settings route is fullscreen and no workspace is
selected — every form rendered defaults and Save silently returned false.
`WorkspaceContext` now falls back to a **real** instance returned by
`list_workspaces` when the store has no `admin` instance (Android only; the list
is picker-ticket verified and `create_session` rechecks the assignment), and
`SettingsPage` keeps the provider **unmounted** until a real token exists. It
never invents an instance and never mints a session from an empty list.

---

## 6. Status — implemented 2026-10-07

| Item | State |
|---|---|
| H1 topology crash | Done — `useOptionalSettings()`, shared with the desktop route |
| H2 empty header | Closed as not-a-defect (§5.2) |
| H3 nested pin | Done — sibling `<button aria-pressed>`, 48px touch target under `(pointer: coarse)` |
| H4 topology on tablet | Withdrawn (§5.1) |
| H5 Add Workspace | Withdrawn with it (§5.1) |
| §2.3 pg_sync / queue reads | Guarded (§5.3) |
| §2.3 OverQuotaCard | **No change needed** — `actionsAvailable = !isTabletShell()` already gates it |
| §2.3 retirements (`LocalApiSection`, `AboutSection`, `EmailReportSettings`) | **Not done** — deliberately separate; §2.2 note about `tablet-unrequested` applies |
| §2.4 repeatable live walk | **Not done** — §5.4 |

Measured after the change: 665 tests green across
`NodeTopologyEditor`/`WorkspaceHome`/`WorkspaceContext`/`SettingsPage`;
`npm run typecheck` exit 0; `npm run lint` exit 0 (61 pre-existing
`react-refresh` warnings, none in touched files); `verify-ipc-parity.py`
tablet leg **unchanged** (82 unregistered, 82 allowlisted) and still exit 1 from
its **dev-mock** leg — the pre-existing red the plan already names.

### 6.1 Verified on the device 2026-10-07, second build (HEAD `d7c80facc+`)

The debug APK built from these commits was installed over wireless ADB and the
walk run three times (cold start each time). Measured results:

- **H1 (topology crash): fixed.** No `SettingsProvider` error anywhere.
- **Sticky error boundary: fixed.** With `#/topology` walked FIRST, all 14
  settings sections render normally afterwards — the exact sequence that
  produced 15/15 failure on the stale bundle. The boundary resets on
  navigation (`resetKeys` from the hash and the shells' route signal) and the
  30s auto-reload never fires.
- **H4/H5 completion: the deep link is closed.** `#/topology` on the tablet
  renders the explanatory notice (`topology-tablet-unavailable`), not an
  editor. The first post-fix build still mounted the editor and toasted
  "Failed to load topology" — the route had to be withdrawn too, not just the
  cards.
- **Settings sections:** 14/14 mount, none hit a boundary. Control counts
  unchanged from §6.1. `general`'s currency list now populates (the §5.5
  scoped-token fix), confirming the stuck "Loading currencies…" was the
  missing token, not a missing command. Control counts are unchanged from the
  first walk (§6.2).
- **§2.2 verdict revised:** `pg_sync_status_scoped` and
  `offline_queue_status_summary_scoped` turn out to be the ONLY two
  reachable-and-wrong names — `general`'s stuck currency list was the token
  problem all along, and the quota card was already guarded.

One NEW transient, documented not fixed: on two of three cold starts,
`general` toasted "Some settings could not be loaded. Try again." A scripted
cold start with `__TAURI_INTERNALS__.invoke` patched before login captured
ZERO failing commands — so the fan-out itself succeeds when it starts after
the workspace settles. The toast appears only when the provider mounts on the
first token and that token is replaced mid-fan-out by the workspace-activation
refresh. Benign (a refetch follows), but the provider should either await a
stable token or refetch on replacement. Left as a recorded follow-up.

### 6.3 TDD session follow-up 2026-10-07 afternoon (HEAD `2d05fb199`)

Three further fixes, each test-first, all green, committed:

1. **Gated partial-load toast** (`91bdbb9e3`): the toast fired at snapshot
   time even when a replacement load cleared the failure seconds later.
   It now fires only if `hasPartialError` persists past
   `PARTIAL_ERROR_TOAST_MS` (2s). Two pins: persistent failure still toasts;
   a token-swapped transient stays silent.
2. **Superseded load must not clear the spinner** (`91bdbb9e3`): `loadAll`'s
   finally lacked the `stale()` check `loadScoped` documents. A gated-load
   test proves a superseded load no longer flips the hub out of its skeleton
   mid-swap — which is what let the page initialize from `DEFAULT_SETTINGS`
   in the gap (empty version, blank store).
3. **Absent row ≠ failure** (`45ebc9985`): the device toast fired with ZERO
   rejected invokes behind it. `loadAll` counted a fulfilled-null source
   (`get_sync_settings_scoped` on a store with no sync row) as a failure.
   Only rejections count now; a null row leaves the defaults standing.

Device status after all of the above: the walk is 12 ok / 3 warn / 0 fail,
the topology route renders its withdrawal notice, and — measured, not
resolved — the partial toast STILL appears on `general` and
`license-subscription` while the walk's invoke-failure capture records
NOTHING: the capture into `window.__TAURI_INTERNALS__.invoke` is inert
against this app's transport (`ui/src/api/tauri.ts` → `rawInvoke` from
`@tauri-apps/api/core`; likely the dev-mock layer or a captured reference
replaces the door before the walk attaches). The productive next probe is a
subscriber on the ERR-06 telemetry channel (`emitIpcError` in
`utils/logged-invoke.ts`), which sees every failure by construction.

### 6.2 First walk, stale bundle — kept for the contrast

`scripts/android-settings-walk.mjs` (committed `552a4ab6b`) now walks the hub
repeatably. With `--routes=sections` — i.e. **without** visiting `#/topology`
first — all 14 sections mount, none renders the error boundary, and control
counts are: general 9, license-subscription 0, devices-connectivity 1,
business-defaults 0, features-modules 54, security-account 1, data-sync 8,
data-management 14, sync-status 3, sync-conflicts 5, offline-queue 13,
tax-configuration 2, exchange-rates 3, system-diagnostics 3.

Two caveats, both material:

1. **The installed APK is stale.** It still throws
   `useSettings must be used within a <SettingsProvider>` on `#/topology`, so it
   predates `4a90d10e5`. Every number above describes **pre-fix** behaviour.
   H1's acceptance criterion 3 stays open until the bundle is rebuilt and
   reinstalled.
2. **The hub's error boundary is STICKY.** Visiting `#/topology` first trips it,
   and every section afterwards renders "Something went wrong" until the app is
   force-stopped — same run, same session, 15/15 fail. That is a real Android
   defect in its own right (one crash disables the whole settings hub) and is
   why the walk carries `--routes=sections`. Not yet fixed; it needs a decision
   on whether navigating away should reset the boundary.

The two zero-control sections are not crashes: `license-subscription` renders
its status and quota text but no buttons, which is `actionsAvailable =
!isTabletShell()` working as designed; `business-defaults` renders
"No location to configure yet." for each of its cards because this tablet has no
location profile. `general` mounts 9 controls but its currency select stays at
"Loading currencies…" — a live defect not yet diagnosed.

**Not walked:** the checkout and KDS flows. See
`plan-tablet-checkout-kds.md`.

### 6.4 Debounced initial load — device-verified (`d8d6a6aa2`)

The walk-diag build named the failing slice: **`list_currencies_scoped`
rejected** during the cold-start window. The durable fix is the plan's own
recommendation: the provider's initial load now waits
`INITIAL_LOAD_DEBOUNCE_MS` (250 ms, exported) for the session token to stop
changing, so a token-swap storm collapses into ONE fan-out against the final
token. Pinned by a collapse test (three rapid tokens → exactly one fan-out,
with the final token) plus debounce-sequencing rewrites of the two earlier
gated-load tests.

Device walk after install: **13 ok / 2 warn / 0 fail.** `general` — the
primary surface — no longer toasts. The one remaining `license-subscription`
toast is a TIMING artefact, not a second failure: toasts auto-dismiss after
4 s (Toast.tsx:71) and the walk probes every 2.2 s, so the single toast fired
during general's initialization is still on screen when the license route is
probed. Whether one intermittent rejection remains behind it is exactly what
the ERR-06 subscriber probe (§6.3) will answer next session.
