# todo — Restaurant POS reliability: tauri-desktop + tauri-mobile

> **Created 2026-10-09 · status: OPEN — analysis complete, repair not started.**
> Owner surface: `ui/src/features/restaurant/**`, the restaurant settings screens
> reached from `RestaurantSidebar`, and the shared `WorkspaceRestaurantPosSettings`
> card both shells mount. Shells in scope: `apps/desktop-tauri` and `apps/mobile-tauri`.
>
> **Method.** Every finding below is a code read at HEAD, not an inference. Where a
> claim is *measured* it names the file and line that proves it; where it is
> *suspected* it is labelled OPEN. Two commands back the whole document and are the
> acceptance for the analysis phase:
>
> ```bash
> python scripts/verify-ipc-parity.py                       # exit 0 at time of writing
> cd ui && npm run typecheck && npm run test -- Restaurant  # baseline to be captured in P0
> ```
>
> **Why this file exists.** The restaurant POS is the one workspace whose settings
> are edited from **three** places that do not share a source of truth — the
> sidebar's full-screen Settings screen, the sidebar's Receipts/Payments screens,
> and the F10 `WorkspaceSettingsModal` card. The audit found controls that persist
> a key nothing reads, controls whose effect is overridden by a hardcoded workspace
> check, and a failed settings read that renders plausible defaults as if they were
> saved values. That last one can lose a merchant's configuration on the next Save.

---

## 1. Scope

**In scope**

- `ui/src/features/restaurant/**` — sidebar, menu, and the four settings screens.
- `ui/src/features/settings/workspace-cards/WorkspaceRestaurantPosSettings.tsx` and
  the `WorkspaceSettingsModal` that mounts it on both shells.
- `ui/src/features/sales/PosScreen.tsx` + `components/CartPanel.tsx` where those
  settings are consumed.
- `ui/src/utils/interaction.ts` (sound/vibration prefs).
- Shell registration/parity for the commands these screens call.

**Out of scope**

- KDS routing semantics, table/floor-plan CRUD, payment-rail math (separate lanes).
- Anything requiring a push, a branch, or a version bump (§0 of AGENTS.md).
- Retail POS (`RetailPosScreen`) except where a shared component is the defect.

---

## 2. Findings

Severity is about **merchant-visible reliability**, not code smell.

### F1 — Seven restaurant toggles persist a key nothing reads (HIGH)

`RestaurantSettingsScreen` writes eleven `restaurant.*` keys on Save
(`RestaurantSettingsScreen.tsx:306-319`). A repo-wide search for readers of each key
returns **only the settings screen itself** for seven of them:

| Key | Written at | Reader |
|---|---|---|
| `restaurant.table_number` | :308 | **none** (PosScreen reads `receipt.showTableNumber`, :742-746) |
| `restaurant.customer_name` | :309 | **none** |
| `restaurant.guest_count` | :310 | **none** |
| `restaurant.hold_order` | :312 | **none** |
| `restaurant.save_tab` | :313 | **none** |
| `restaurant.auto_print_kitchen` | :315 | **none** |
| `restaurant.sound_chime` | :316 | **none** |

Evidence: `tools.grep 'restaurant\\.(table_number|customer_name|guest_count|hold_order|save_tab|auto_print_kitchen|sound_chime)'`
over `ui/src` returns hits only in `RestaurantSettingsScreen.tsx` (plus the two keys
PosScreen *does* read — see F2). The controls render, toggle, persist and reload
faithfully, so the operator has no signal that turning "Hold Order" off changes
nothing.

**Impact:** a merchant disables auto-print, sound chime or hold-order, sees the
switch stay off across restarts, and the behaviour never changes.

### F2 — Two toggles are overridden by a hardcoded workspace check (HIGH)

`CartPanel` gates both order-type and table-number on
`(setting || activeWorkspace === 'restaurant-pos')`
(`CartPanel.tsx:612` and `:655`). On the restaurant workspace the left operand is
irrelevant — the controls always render. The settings that are *supposed* to gate
them therefore cannot turn them off on the one workspace they exist for.

- `restaurant.order_type_prompt` is read by `PosScreen.tsx:783-797` and threaded to
  the panel, then discarded by the `||` at `:612`.
- `receipt.showTableNumber` is read by `PosScreen.tsx:738-754` and discarded by the
  same `||` at `:655`.

**Impact:** two live-looking toggles ("Table Number", "Order Type Selection") are
inert on restaurant POS.

### F3 — Split brain: two editors, one key, two storage models (HIGH)

`restaurant.course_firing` is written by **both** settings surfaces:

- `RestaurantSettingsScreen.tsx:314` (sidebar Settings) via `setSettingsScoped`.
- `WorkspaceRestaurantPosSettings.tsx:117` (F10 card) via `setSettingsScoped`.

They also disagree about table management: the sidebar screen writes
`restaurant.table_number` **and** mirrors `receipt.showTableNumber`
(`:326-339`), while the F10 card writes only `receipt.showTableNumber`
(`WorkspaceRestaurantPosSettings.tsx:103-114`). A merchant who turns table
management on in the F10 modal and off in the sidebar screen (or vice versa) gets a
state that depends on which screen saved last, with no reconciliation.

### F4 — A failed settings read renders defaults as saved values (HIGH — data loss)

`RestaurantSettingsScreen` loads all eleven keys with a per-key
`.catch(() => null)` (`:180-190`) and a `getReceiptSettingsScoped(...).catch(() => null)`
(`:191`). A transport failure is then indistinguishable from "key never written":

```ts
const resolvedHoldOrder =
  holdOrderRaw !== null ? holdOrderRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.holdOrder;
```

`:206-223` resolves every failure to the hardcoded default, and `:237-249` seeds
`originalsRef` from those defaults — so `dirty` (`:267-296`) reads **false**. The
operator sees a clean screen showing defaults; pressing Save writes those defaults
over the real stored values. The `catch` at `:251` only fires if `Promise.all`
itself rejects, which the per-key catches have already prevented.

The same shape exists in `WorkspaceRestaurantPosSettings.tsx:85-88`: a failed
`getSettingScoped` seeds `courseFiring: false` and marks the card clean.

**Impact:** a transient IPC failure during load silently offers to erase a
merchant's restaurant configuration.

### F5 — Partial-write save has no rollback and reports a generic failure (MEDIUM)

`WorkspaceRestaurantPosSettings.handleSave` fires three independent writes in
`Promise.all` (`:99-124`) and, on any rejection, shows
`settings-save-error` and leaves `originalsRef` untouched (`:133-137`). If
`setReceiptSettingsScoped` commits and `setSettingsScoped` fails, half the change
landed while the UI reports total failure and still shows dirty. The operator
retries and double-applies the half that succeeded.

`RestaurantSettingsScreen` has the same shape at `:299-341` with two extra side
effects that are not awaited with the write: `setInteractionSoundEnabled` /
`setInteractionVibrationEnabled` (`:323-324`) mutate localStorage **before** the DB
write resolves, so a rejected save leaves local and remote disagreeing.

### F6 — Interaction prefs are stored twice and only the local copy is honoured (MEDIUM)

`RestaurantSettingsScreen` persists `restaurant.interaction_sound` and
`restaurant.interaction_vibration` to the DB (`:317-318`) **and** to
`localStorage` (`:323-324`). The runtime reads **only** `localStorage`
(`utils/interaction.ts:41-60`, keys `pos.interaction_sound` /
`pos.interaction_vibration`). The loader reads the DB value into the switch
(`:216-223`) but never writes it back to localStorage on load.

**Impact:** a new device, a cleared webview cache, or a second terminal ignores the
saved preference and uses the `true` default. Cross-device the setting does not
travel at all.

### F7 — Sidebar "Kitchen Display" can silently do nothing (MEDIUM)

`RestaurantSidebar` renders the Kitchen Display row unconditionally
(`:452-463`) and calls `onNavigate?.('kds')`. On the tablet,
`TabletAppShell.handleNavigate` (`:264-281`) checks `isPageAccessible` and falls
back to `products` when the route is not reachable — so for a cashier without KDS
access the row either does nothing or jumps to Products, with no explanation. The
sibling Table Management row *is* gated (`showTables`, `:426`), which is the
pattern this row is missing.

### F8 — Manager rows gate on role, the backend gates on permission (MEDIUM)

Menu Editor / Receipts / Payments / Settings are `disabled` when
`!effectiveIsManager` (`RestaurantSidebar.tsx:464-561`), sourced from
`useAuth().isManager`. Every one of those screens writes through commands that
enforce `permissions::SETTINGS_EDIT` server-side (e.g.
`crates/kasirmu-bridge/src/settings.rs:571`). A user holding a manager *role* without
that permission gets an enabled control whose save is rejected at the IPC boundary.

### F9 — No crash isolation on the POS settings surface (MEDIUM)

`WorkspaceRestaurantPosSettings` and `WorkspaceSettingsModal` wrap their bodies in
`ErrorBoundary` (`WorkspaceRestaurantPosSettings.tsx:143`,
`WorkspaceSettingsModal.tsx:10`). `RestaurantSidebar`, `RestaurantSettingsScreen`,
`RestaurantReceiptsScreen` and `RestaurantPaymentsScreen` do **not** (grep for
`ErrorBoundary` under `features/restaurant` returns nothing). A render throw in any
of them takes down the POS screen itself, mid-sale, with no recovery affordance.

### F10 — Hardcoded English in the restaurant settings screens (MEDIUM, policy)

`RestaurantSettingsScreen.SettingRow` takes `label`/`description` as plain strings
and passes them straight to the DOM (`:44-90`); the call sites at `:519-627` are
literal English ("Table Number", "Prompt for table assignment when starting a new
dine-in order", …). `RestaurantPaymentsScreen` and `RestaurantReceiptsScreen` have
the same pattern. This violates §6.3 ("all user-visible strings via
`@fluent/react`"). The `restaurant-*` FTL keys that exist
(`shared-ui/locales/products.ftl:84-99`) cover headings and toasts, not these rows.

### F11 — Third storage model: receipt prefs in localStorage *and* user prefs (LOW-MEDIUM)

`RestaurantReceiptsScreen` seeds ~14 fields from `localStorage` (`:265-303`), then
overlays `getUserPreferencesScoped` (`:383-430`) for a subset. A device that has
never loaded remote prefs renders local-only values with no signal, and the two
stores can disagree. Same class as F6, larger surface.

### F12 — IPC parity observations (LOW, mostly recorded debt)

`python scripts/verify-ipc-parity.py` exits 0 at HEAD. Two items are worth folding
into this lane's verification rather than treating as new work:

- `edc_terminal_status` (unscoped) is registered on desktop and absent on tablet
  (`apps/desktop-tauri/src/lib.rs` vs `apps/mobile-tauri/src/lib.rs`); the shared
  `RestaurantPaymentsScreen` uses the *scoped* twin
  (`RestaurantPaymentsScreen.tsx:666`), so this is dead-on-one-shell, not a live gap.
  Confirm before touching.
- `pg_sync_status_scoped` is desktop-only and allowlisted for the tablet
  (`scripts/ipc-parity-allowlist.json`, tablet section); `SettingsPage.tsx:195`
  guards it with `if (!isTabletShell())`. Recorded, not fixed here.

### F13 — Duplicate settings module (LOW, hygiene)

`ui/src/features/settings/DataManagementScreen.tsx` and
`ui/src/features/settings/screens/DataManagementScreen.tsx` both exist, and both
`features/settings/sections/AppearanceSection.tsx` and
`features/settings/AppearanceSettings.tsx` exist. Confirm which is mounted before
deleting anything (AGENTS.md §6.3 "dead-screen checks need three greps").

---

## 3. Repair plan

Each phase is independently landable and has its own acceptance. **Do not start a
phase before the prior phase's acceptance passes** — F1/F2 edits move the very
lines F4's tests assert against.

### P0 — Baseline (no code change)

- Capture the current green: `cd ui && npm run lint && npm run typecheck && npm run test`
  and `python scripts/verify-ipc-parity.py`.
- Record in §5 the exact counts so a later regression is attributable.
- **Acceptance:** both commands exit 0; output pasted into §5.

### P1 — One source of truth for restaurant settings (fixes F1, F2, F3)

1. Decide the canonical key per toggle and write the mapping into a header comment
   in `RestaurantSettingsScreen.tsx`. Proposed: the `restaurant.*` namespace wins
   for restaurant-only behaviour; `receipt.showTableNumber` stays the receipt-print
   key and the sidebar screen stops mirroring it.
2. Either **wire** each key to its consumer or **remove** the control. Do not leave a
   control that writes a dead key. Concretely, for each of the seven keys in F1
   choose: (a) read it where it belongs (hold-order gates the hold action,
   auto-print gates the KOT send, sound-chime gates the chime, customer-name /
   guest-count gate the cart fields, table_number is retired in favour of
   `receipt.showTableNumber`), or (b) delete the row and its state.
3. Remove the `|| activeWorkspace === 'restaurant-pos'` overrides at
   `CartPanel.tsx:612` and `:655` **only after** the corresponding default is
   `true` for a restaurant workspace, so no merchant loses a control on upgrade.
4. Make the F10 card and the sidebar screen agree on table management; one of them
   stops writing the other's key.

- **Tests:** extend `ui/src/__tests__/RestaurantSettingsScreen.test.tsx` with a case
  per key that asserts the *consumer* observes the change (not just that the key was
  written). Extend `CartPanel.test.tsx` with "setting false hides the control on
  restaurant-pos".
- **Acceptance:** `cd ui && npm run lint && npm run typecheck && npm run test -- Restaurant CartPanel`

### P2 — Distinguish "unset" from "read failed" (fixes F4)

1. Introduce a load result that keeps failure and absence distinct — e.g. a
   `loadRestaurantSettings(token): Promise<{ ok: true; values } | { ok: false; failedKeys: string[] }>`
   in a `settingsModel.ts` beside the screen, so it is unit-testable without a DOM.
2. On failure: do **not** seed `originalsRef` from defaults; surface the existing
   `restaurant-settings-error-load` toast and render a retry affordance. A partial
   failure must mark the screen dirty or blocked, never clean.
3. Apply the same fix to `WorkspaceRestaurantPosSettings.tsx:85-88`.

- **Tests:** a mocked `getSettingScoped` that rejects must leave `dirty` false
  **and** the Save button disabled **and** the error surfaced; a key that returns
  `null` must still use the default.
- **Acceptance:** `cd ui && npm run test -- RestaurantSettingsScreen WorkspaceRestaurantPosSettings`

### P3 — Atomic-or-reported saves (fixes F5)

1. Split the save into ordered, individually-reported steps, or use
   `Promise.allSettled` and report which parts failed. Never mutate localStorage
   before the DB write resolves.
2. Update `originalsRef` for the parts that succeeded so the dirty state tells the
   truth.
3. Decide and document the rollback story for a partial receipt+settings write.

- **Tests:** a rejected `setSettingsScoped` after a successful
  `setReceiptSettingsScoped` must leave the screen dirty and name the failed part.
- **Acceptance:** `cd ui && npm run test -- WorkspaceRestaurantPosSettings`

### P4 — Sidebar action gating and crash isolation (fixes F7, F8, F9)

1. Gate the Kitchen Display row on the same capability the tablet's
   `isPageAccessible('kds')` uses, or have `handleNavigate` return a boolean the
   sidebar can act on. Do not leave a row that silently no-ops.
2. Align the manager rows with `permissions::SETTINGS_EDIT` rather than the role
   name, so the control and the IPC boundary agree.
3. Wrap `RestaurantSidebar` and each settings screen in `ErrorBoundary`, matching
   the workspace cards.

- **Tests:** `ui/src/__tests__/RestaurantPosSidebar.test.tsx` gains a "hides Kitchen
  Display when the route is unreachable" case; a throw inside the sidebar renders
  the boundary fallback, not a blank POS.
- **Acceptance:** `cd ui && npm run test -- RestaurantPosSidebar`

### P5 — Persist interaction prefs where the runtime reads them (fixes F6, F11)

1. On load, apply the DB value to the `pos.interaction_*` localStorage keys so a
   fresh device honours the saved preference.
2. Decide the authority order (DB vs localStorage) and write it down; the current
   two-store split has no rule.
3. Same decision for the `resto_rcpt_*` keys in `RestaurantReceiptsScreen`.

- **Tests:** a load with DB `false` and empty localStorage must leave
  `isInteractionSoundEnabled() === false`.
- **Acceptance:** `cd ui && npm run test -- interaction RestaurantReceiptsScreen`

### P6 — i18n sweep (fixes F10)

- Move every hardcoded label/description in the three restaurant settings screens
  into `shared-ui/locales/products.ftl` (+ `.id.ftl`) and render through
  `Localized` / `l10n.getString`.
- **Acceptance:** the repo's FTL orphan/dedupe pre-commit steps pass, and
  `npm run i18n` (from `ui/`) exits 0.

### P7 — Parity verification (closes F12)

- Re-run `python scripts/verify-ipc-parity.py` after P1-P6. Confirm no new
  allowlist entry was needed to keep it green; an entry added to silence a hit is a
  failure of this phase, not a pass.
- Confirm `edc_terminal_status` is genuinely dead on the tablet before proposing
  its removal.

- **Acceptance:** `python scripts/verify-ipc-parity.py` exits 0 with **no new**
  entries in `scripts/ipc-parity-allowlist.json`.

### P8 — Duplicate-module hygiene (F13, only if P0-P7 leave budget)

- Three greps per AGENTS.md §6.3 before deleting either file.

---

## 4. Decisions this plan needs from the owner

1. **P1 key authority** — should `restaurant.table_number` be retired in favour of
   `receipt.showTableNumber`, or kept and made the restaurant-only gate? Both are
   defensible; the plan assumes *retire*, because the receipt key already has a live
   reader.
2. **P1 default-on upgrade** — when a dead toggle becomes live, do we default it on
   (no merchant loses a control) or off (matching the current `DEFAULT_RESTAURANT_SETTINGS`)?
   The plan assumes *on* for anything already visible on restaurant POS.
3. **P5 authority** — DB or localStorage as the source of truth for interaction
   prefs and receipt prefs.
4. **P4 Kitchen Display** — hide the row when unreachable, or keep it and show a
   "requires KDS access" affordance like the manager badge?

---

## 5. Verification log

_Fill in as phases land. One row per acceptance command run._

| Date | Phase | Command | Result | Notes |
|---|---|---|---|---|
| 2026-10-09 | analysis | `python scripts/verify-ipc-parity.py` | exit 0 | 75 tablet allowlisted entries; no new gap found |
| 2026-10-09 | analysis | `cd ui && npm run typecheck` | _not run_ | baseline owed in P0 |
| 2026-10-09 | analysis | `cd ui && npm run test -- Restaurant` | _not run_ | baseline owed in P0 |

---

## 6. Evidence index (file:line, for reviewers)

| Finding | Primary evidence |
|---|---|
| F1 | `RestaurantSettingsScreen.tsx:306-319`; repo-wide grep returns no reader for 7 keys |
| F2 | `CartPanel.tsx:612`, `CartPanel.tsx:655`; `PosScreen.tsx:756-797` |
| F3 | `RestaurantSettingsScreen.tsx:314`, `:326-339`; `WorkspaceRestaurantPosSettings.tsx:103-117` |
| F4 | `RestaurantSettingsScreen.tsx:180-191`, `:206-249`, `:251-258`; `WorkspaceRestaurantPosSettings.tsx:85-88` |
| F5 | `WorkspaceRestaurantPosSettings.tsx:99-137`; `RestaurantSettingsScreen.tsx:299-341` |
| F6 | `RestaurantSettingsScreen.tsx:216-223`, `:317-324`; `utils/interaction.ts:41-78` |
| F7 | `RestaurantSidebar.tsx:452-463`, `:426-439`; `TabletAppShell.tsx:264-281` |
| F8 | `RestaurantSidebar.tsx:464-561`; `crates/kasirmu-bridge/src/settings.rs:571` |
| F9 | grep `ErrorBoundary` under `features/restaurant` returns nothing; contrast `WorkspaceRestaurantPosSettings.tsx:143` |
| F10 | `RestaurantSettingsScreen.tsx:44-90`, `:519-627`; `shared-ui/locales/products.ftl:84-99` |
| F11 | `RestaurantReceiptsScreen.tsx:265-303`, `:383-430` |
| F12 | `scripts/verify-ipc-parity.py` output; `scripts/ipc-parity-allowlist.json` tablet section |
| F13 | `ui/src/features/settings/DataManagementScreen.tsx` vs `.../screens/DataManagementScreen.tsx` |
