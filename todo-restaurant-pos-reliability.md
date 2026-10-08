# todo — Restaurant POS reliability: tauri-desktop + tauri-mobile

> **Created 2026-10-09 · status: OPEN — analysis complete, P0 baseline captured, D3/D4 settled.**
> **D1 and D2 were partially WITHDRAWN after F14:** the provisioning seed does not work,
> because provisioning writes the global DB while the POS reads the store DB. D1 now
> carries an open choice (recommended: option C). Repair starts at P1.
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

### F14 — Provisioning and the POS read DIFFERENT databases (HIGH — blocks D1's seed)

Found while implementing option A, and it invalidates that approach.

`provision_device` writes the **global identity** database: the bridge locks it at
`crates/kasirmu-bridge/src/setup.rs:378` (`ctx.lock_global()`) and passes that one
`&Connection` into `kasirmu_core::db::provisioning::provision_device`.

`get_receipt_settings_scoped` — the command the POS reads on mount
(`PosScreen.tsx:742`) — reads the **store** database instead:
`crates/kasirmu-bridge/src/settings.rs:186-193` opens
`ctx.db_manager.open_store(&session.store_id)`, and the store file is
`store-<id>.sqlite` (`platform/core/src/database/manager.rs:192`).

Nothing bridges the two for settings: `copy_reference_data`
(`crates/kasirmu-cli/src/seed_demo.rs:171-240`) copies only categories, products,
inventory, customers, tax_rates, category_taxes and suppliers — never `settings`.
The workspace read-repair (`crates/kasirmu-bridge/src/workspaces.rs:176-187`) copies
`workspace_instances` only. **No code copies settings rows between the databases.**

**Measured, not inferred.** A temporary test provisioned a restaurant into one
in-memory connection and read the flag back from a second one:

```
global db after provision_device : show_table_number = TRUE   (the seed landed)
store  db (what the POS reads): show_table_number = FALSE  (no seed)
```

**Consequence.** Seeding the flag from `provision_device` is inert in production —
the POS would still read `false` from the store db. The change was reverted before
commit; the tree is clean and `kasirmu-core` is back to 37 provisioning tests.

**Why this is recorded rather than just fixed:** it is the same global/store split the
codebase already documents as a trap (`provisioning_tests.rs:493-539`, "the split-brain"),
and it is why D1's default cannot be a provisioning fact. Any future "default this
setting for a new install" idea has to answer where the store db is at that moment.

---

## 3. Repair plan

Each phase is independently landable and has its own acceptance. **Do not start a
phase before the prior phase's acceptance passes** — F1/F2 edits move the very
lines F4's tests assert against.

### P0 — Baseline (no code change) — ✅ DONE 2026-10-09

- Captured the current green: `cd ui && npm run lint && npm run typecheck` and a
  targeted `npx vitest run Restaurant CartPanel WorkspaceRestaurantPosSettings
  SettingsPage interaction`, plus `python scripts/verify-ipc-parity.py`.
- Counts recorded in §5.
- **Acceptance met:** lint exit 0 (0 errors / 62 pre-existing warnings), typecheck
  exit 0, 21 test files / 344 tests passed, IPC parity exit 0.

### P1 — One source of truth for restaurant settings (fixes F1, F2, F3)

**Status: 2 of 7 dead keys resolved.** `restaurant.table_number` (removed, option C)
and `restaurant.order_type_prompt` (wired + default freed) are done. The remaining
six are below, each re-verified 2026-10-09 against the whole repo (UI **and** Rust)
after the P1 code change.

| Key | Verdict | Evidence | Recommended action |
|---|---|---|---|
| `restaurant.customer_name` | ✅ **WIRED** 2026-10-09 | `CartPanel` gates the field on `customerNameEnabled !== false`; `PosScreen` reads the key. Defaults to SHOW, so retail and an unset key are unaffected. | Done. |
| `restaurant.guest_count` | ✅ **WIRED** 2026-10-09 | Same shape, `guestCountEnabled !== false`. Note the model default is `false` but the GATE defaults to show for an unset key — see below. | Done. |
| `restaurant.hold_order` | **WIRE** | The mechanism is real: `holdCartScoped` is called at `usePosHeldCarts.ts:175` and `PaymentModal.tsx:1022`. The key is simply never consulted before that call. | Read it where the hold action fires; off = refuse to hold. |
| `restaurant.save_tab` | **WIRE** | Same: `bill_type: 'open_bill'` is a live concept (`PaymentModal.tsx:1028`, `usePosHeldCarts.ts:181`) and the tender is already restaurant-gated (`PaymentModal.tsx:324`). | Gate the open-bill tender on it. |
| `restaurant.auto_print_kitchen` | **DELETE or BUILD** | **No consumer exists.** Zero call sites outside the settings screen; the only auto-print in the tree is KDS-side (`kasirmu-bridge/src/kds.rs:262`, `try_auto_print_kds_chit_jobs`), which is a different feature and already automatic. | Owner call: delete the toggle, or build a KOT-send path that honours it. Do not leave it writing a dead key. |
| `restaurant.sound_chime` | **DELETE or BUILD** | **No consumer exists.** The only chime is `useNewTicketSound` (KDS new-ticket), which has its own debounce and no restaurant-settings input. | Owner call: delete, or wire to an order-sent chime. |

**The `guest_count` default trap, and how it was handled.** The model's default for
`guest_count` is `false`, but the field has ALWAYS rendered on restaurant POS. Wiring
the gate naively to the resolved value would therefore have hidden the pax field for
every merchant who had never saved the setting — the same regression D2 exists to
prevent. The gate is therefore `!== false` on an ABSENT prop, and `PosScreen` maps
`null` (never written) to show. Only an explicit stored `"false"` hides it. This is
the one place where "what the setting means when unset" and "what the control has
always done" disagree, and the control wins.

**Why these are split into WIRE vs DELETE/BUILD:** the four WIRE keys have a real,
already-existing consumer to gate, so the change is small and the behaviour is
obvious. The two DELETE/BUILD keys have **nothing** to gate — wiring them means
inventing a feature, which is not a reliability repair and should not ride in on
one. That is the question for the owner in §4.


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
   `CartPanel.tsx:612` and `:655`. For `:612` (`order_type_prompt`) raise the default
   first, per D2. For `:655` (`showTableNumber`) the override comes out **together with
   the sidebar toggle** — option C of D1 — because F14 proves the flag cannot be
   defaulted on from provisioning.
4. Make the F10 card and the sidebar screen agree on table management; one of them
   stops writing the other's key.

- **Tests:** extend `ui/src/__tests__/RestaurantSettingsScreen.test.tsx` with a case
  per key that asserts the *consumer* observes the change (not just that the key was
  written). Extend `CartPanel.test.tsx` with "setting false hides the control on
  restaurant-pos".
- **Acceptance:** `cd ui && npm run lint && npm run typecheck && npm run test -- Restaurant CartPanel`

### P2 — Distinguish "unset" from "read failed" (fixes F4) — ✅ DONE 2026-10-09

**Landed.** New pure model `ui/src/features/restaurant/screens/settingsModel.ts`
(`loadRestaurantSettings` → `{ ok: true; values } | { ok: false; failedKeys }`),
with `DEFAULT_RESTAURANT_SETTINGS` and the key list moved into it so there is one
copy of each default. The reader is injected, so the model is unit-testable with no
module mocking and no DOM.

Both consumers now refuse to present a load they cannot vouch for:

- `RestaurantSettingsScreen` — a failed read seeds **nothing**, so `originalsRef`
  keeps its previous contents and `dirty` cannot read a false "clean". Save is
disabled, the header stops claiming "All changes saved", and a banner with a
**Retry** button re-runs the load (`reloadNonce`).
- `WorkspaceRestaurantPosSettings` — the catch no longer seeds
  `courseFiring: false`; it sets `loadFailed`, which disables Save and shows the
  banner.

**One correction found by the tests.** The first attempt gated only the Save button.
A test asserting `queryByText(/All changes saved/i)` was null failed, because with
`loadFailed` set `dirty` is false and the header still rendered "All changes
saved" — the exact misleading state the fix exists to remove. The header now
renders nothing when `loadFailed`.

**Tests:** `ui/src/__tests__/settingsModel.test.ts` (7 cases: unset→default,
reject→`ok:false` naming EVERY failed key, stored `"false"` survives, local fallback
for the interaction pair, DB beats local, spec/field completeness) plus screen-level
cases for the banner, the disabled Save, the header copy and Retry.

- **Acceptance met:** `cd ui && npm run typecheck` exit 0;
  `npx vitest run settingsModel RestaurantSettingsScreen WorkspaceRestaurantPosSettings`
  → **4 files / 34 tests passed**; wider `npx vitest run Restaurant Settings Workspace`
  → **65 files / 1065 passed, 22 skipped**; eslint on all six changed files exit 0.

### P3 — Never mutate localStorage before the DB write resolves (fixes F5) — ✅ DONE 2026-10-09

**Landed.** `RestaurantSettingsScreen.handleSave` now mirrors the interaction
preferences to localStorage **after** `await Promise.all(tasks)`, not before. A
rejected save previously left localStorage saying "sound off" while the DB still
said "sound on" — and the runtime believes localStorage, so the device and the
store disagreed with no way to tell.

The table-number half of this phase **dissolved**: the receipt-sync block it
described was removed outright in P1 (option C), so the only cross-store write left
on this screen was the localStorage mirror. `WorkspaceRestaurantPosSettings` has no
localStorage write at all.

**Kill-tested.** Restoring the old ordering fails the new case with
`expected 'false' to be 'true'` — the exact divergence. The test is therefore not
vacuous.

- **Acceptance met:** `cd ui && npm run typecheck` exit 0; eslint on both changed
  files exit 0; `npx vitest run Restaurant Settings Workspace interaction` →
  **68 files / 1120 passed, 22 skipped**.

### P5 — Persist interaction prefs where the runtime reads them (fixes F6) — ✅ DONE 2026-10-09

**Landed.** The load path now writes the DB value through to the
`pos.interaction_*` localStorage keys the runtime actually reads
(`utils/interaction.ts`). Without it a fresh device, a cleared webview cache, or a
second terminal kept the localStorage default (`true`) and ignored the saved
preference — the DB value never reached the code that acts on it.

Authority is **D3**: the DB wins, localStorage is a write-through cache. The write
is idempotent when the key was unset, because the value came FROM localStorage in
that case.

**F11 (`resto_rcpt_*`) is NOT done** and is deliberately left open: those keys have
a different reader path (`RestaurantReceiptsScreen` overlays
`getUserPreferencesScoped`) and deserve their own phase rather than being folded in
here.

- **Acceptance met:** `npx vitest run RestaurantSettingsScreen` → **10 tests
  passed**, including a case asserting localStorage carries the loaded DB value.

### P4 — Crash isolation (F9) — ✅ DONE 2026-10-09; F7/F8 still open

**F9 landed.** `LocalizedErrorBoundary` (the locale-aware wrapper the workspace
cards use) now wraps:

- `RestaurantSidebar`, mounted in `RestaurantMenu` — the highest-value one, since
  it is a panel over a **live sale**: a throw there previously discarded the
  cashier's cart mid-transaction. `onReset` closes the panel and `resetKeys={[menuOpen]}`
  clears a caught error when the open state changes, so reopening recovers.
- The four settings sub-screens in `PosScreen` (Menu Editor, Receipts, Payments,
  Restaurant Settings), each with `onReset` returning to the sale.

**Guard:** `ui/src/__tests__/restaurantPosCrashIsolation.test.ts` — a static
source scan (the `errorPolicyCompliance.test.ts` idiom) asserting each named
element sits at `LocalizedErrorBoundary` depth >= 1, plus a collector floor.
Static rather than behavioural on purpose: the sub-screens are lazy/mocked in the
existing suites, so a render test would mock the very component it checks and
could pass with the boundary removed.

**Kill-tested.** Removing the sidebar wrapper fails the guard with
*"`<RestaurantSidebar\b` is NOT inside a `<LocalizedErrorBoundary>`"*.

**F7 and F8 are NOT done** — they need a product decision (hide the Kitchen
Display row vs. a "requires KDS access" affordance; role vs. `SETTINGS_EDIT`
permission for the manager rows) and are listed in §4.

- **Acceptance met:** `cd ui && npm run typecheck` exit 0; eslint 0 errors;
  `npx vitest run Restaurant PosScreen CartPanel restaurantPosCrashIsolation` →
  **28 files / 525 passed, 1 skipped**.

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

## 4. Decisions — SETTLED 2026-10-09

All four open questions are decided. Each answer records the evidence that decided
it, not just the choice, so a later reader can re-derive it.

### D1 — Collapse to `receipt.showTableNumber`; the restaurant DEFAULT is still open

**The collapse itself is settled.** Keep `receipt.showTableNumber`, delete
`restaurant.table_number` and the mirror at `RestaurantSettingsScreen.tsx:326-339`.
`receipt.show_table_number` is a real legacy receipt key with live readers on both
sides — `receipt_formats.rs:72` (`LEGACY_RECEIPT_KEYS`), `receipt_format.rs:90`, and
`settings.rs:521` — while `restaurant.table_number` has zero readers anywhere. The
collapse removes code and needs no schema change.

**The default-on half of the earlier D2 was WRONG and is withdrawn.** It was specified
as "seed `receipt.show_table_number = true` at provisioning for a restaurant" and
implemented that way in `provision_device`. **It does not work**, and the attempt is
reverted (uncommitted, never landed). See F14 for the measurement.

**So the restaurant default is now an open decision.** The options, re-derived after
F14:

| Option | Mechanism | Cost |
|---|---|---|
| **C (recommended)** | Drop the table-number toggle from the sidebar Settings screen. Table capture is core to restaurant POS, so the cart input stays unconditional and the *print* toggle stays in Receipts (`RestaurantReceiptsScreen.tsx:1889`). | Frontend only. Removes a control rather than wiring it. |
| **A'''** | Seed the STORE db after `provision_device` returns, in the bridge layer where `ctx.db_manager` exists (`setup.rs:374-389`). | Cross-layer: provisioning is core and owns only the global `&Connection`; the store db is created lazily by `open_store`. Needs a store-id decision too. |
| **B** | Flip the global default in `platform/core/src/settings/typed.rs`. | Changes **retail** receipts and inverts `platform/core/src/settings/tests.rs:360` plus `settings_tests.rs:45`. Rejected. |

**Why C is the recommendation:** F14 shows the key the POS actually reads lives in a
different database from the one provisioning writes, so a "restaurant default" is not
expressible as a provisioning fact at all. C stops pretending the toggle is a real
choice instead of adding cross-layer plumbing to keep it looking like one.

### D2 — Default ON only `restaurant.order_type_prompt`; the table-number half is withdrawn

**Decision.** `restaurant.order_type_prompt` defaults **true** when unset. Every other
key keeps its current `DEFAULT_RESTAURANT_SETTINGS` value (`holdOrder` true, `saveTab`
true, `soundChime` true, `customerName` true, `guestCount` false, `autoPrintKitchen`
false, `courseFiring` false).

**Why.** `order_type_prompt` is a restaurant-only key the frontend can default on its
own, and it is one of the two controls the `|| activeWorkspace === 'restaurant-pos'`
override at `CartPanel.tsx:612` forces on today — so removing the override without
raising the default would silently drop the order-type selector on upgrade. No other
key is currently forced, so flipping any other default would be an unrequested change.

**The `receipt.showTableNumber` half is WITHDRAWN** — it is a shared receipt key whose
default the frontend cannot set (F14). It moves to D1's open decision, where option C
is the recommendation.

### D3 — The DB is authoritative; localStorage is a write-through cache

**Decision.** Persist to the DB as the source of truth. After a successful load, write
the DB value through to the runtime keys (`pos.interaction_*`, and reconcile
`resto_rcpt_*`). On conflict the DB wins. localStorage is consulted only when the DB
read **fails** — the same failure-vs-absence distinction P2 introduces.

**Why.** Two codebase-specific facts:

1. `setSettingsScoped` on the tablet enqueues to the **store sync queue**
   (`apps/mobile-tauri/src/commands/settings.rs:783`), so DB values propagate to the
   desktop and the cloud. `localStorage` never leaves the device webview — which is
   exactly why F6 bites: a second terminal or a cleared cache silently reverts to the
   `true` default.
2. The DB value is already scoped to the session's store, which is the entire point of
   the scoped write (ADR #7).

### D4 — Hide the Kitchen Display row when the route is unreachable

**Decision.** Hide it, matching Table Management. Do not show a disabled row.

**Why.**

- `RestaurantSidebar` already hides Table Management behind `showTables` (`:426`),
  and its module doc calls that gating deliberate: *"Table Management is feature-gated:
  render-and-hide is not an option."* Kitchen Display is the odd one out.
- A "Manager+" badge would be **wrong here**: KDS reachability is a feature/route
  entitlement (`isPageAccessible('kds')` at `TabletAppShell.tsx:264-281`), not a role.
  Borrowing the manager badge would mislabel the reason.

**Mechanism.** A hidden row must be known before render, so the shell supplies it: add
a `showKitchenDisplay` prop computed by the shell (tablet: `isPageAccessible(getPage('kds'), …)`;
desktop: its own KDS gate) and thread it through `RestaurantMenu` exactly as
`showTables` already is. A click-time return value from `onNavigate` cannot hide a row.

---

## 5. Verification log

_Fill in as phases land. One row per acceptance command run._

| Date | Phase | Command | Result | Notes |
|---|---|---|---|---|
| 2026-10-09 | analysis | `python scripts/verify-ipc-parity.py` | exit 0 | 75 tablet allowlisted entries; no new gap found |
| 2026-10-09 | P0 | `cd ui && npm run lint` | exit 0 | **0 errors, 62 warnings** (all pre-existing; none in the restaurant lane) |
| 2026-10-09 | P0 | `cd ui && npm run typecheck` | exit 0 | clean |
| 2026-10-09 | P0 | `cd ui && npx vitest run Restaurant CartPanel WorkspaceRestaurantPosSettings SettingsPage interaction` | exit 0 | **21 files, 344 tests passed** |
| 2026-10-09 | P1 | `cd ui && npm run typecheck` | exit 0 | option C: table-number toggle removed |
| 2026-10-09 | P1 | `cd ui && npx vitest run RestaurantSettingsScreen CartPanel PosScreen WorkspaceRestaurantPosSettings RestaurantPosSidebar` | exit 0 | **15 files, 318 passed / 1 skipped** |
| 2026-10-09 | P2 | `cd ui && npx vitest run restaurantSettingsModel RestaurantSettingsScreen WorkspaceRestaurantPosSettings` | exit 0 | **4 files, 34 tests passed** |
| 2026-10-09 | P3 | `cd ui && npx vitest run RestaurantSettingsScreen -t 'local sound mirror'` | **FAIL (killed)** | buggy ordering fails `expected 'false' to be 'true'`; restored, passes |
| 2026-10-09 | P3+P5 | `cd ui && npx vitest run Restaurant Settings Workspace interaction` | exit 0 | **68 files, 1120 passed / 22 skipped** |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite) | exit 0 | **672 files, 11336 passed / 24 skipped / 3 todo** |
| 2026-10-09 | all | `python scripts/verify-ipc-parity.py` (repo root) | exit 0 | IPC parity: OK; no new allowlist entry |
| 2026-10-09 | all | `cd ui && npm run typecheck` | exit 0 | after every phase |
| 2026-10-09 | all | `cd ui && npx eslint <changed files>` | exit 0 | 0 errors on every file this lane touched |

**P0 baseline (measured 2026-10-09).** These four are the reference figures for
attributing any later regression:

- lint: **0 errors / 62 warnings** — the warnings are `consistent-type-imports` in test
  files, `react-refresh/only-export-components`, and one `exhaustive-deps` pair in
  `StaffLoginScreen.tsx`. None is in `features/restaurant/`.
- typecheck: clean.
- targeted tests: 21 files / 344 tests, including `RestaurantSettingsScreen.test.tsx`
  (7 cases), `RestaurantPosSidebar.test.tsx`, `RestaurantReceiptsScreen.test.tsx`
  (35 tests), `RestaurantPaymentsScreen.test.tsx`, `WorkspaceRestaurantPosSettings.test.tsx`,
  `SettingsPage.test.tsx`, and the `interaction` pair.
- IPC parity: exit 0.

**Known trap for later phases:** `npx vitest run --reporter=basic` **fails** in this
repo — `basic` is not a loadable reporter in the installed Vitest and aborts at
startup with `Failed to load custom Reporter from basic`. Use the default reporter
(the `npm run test` script does).

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
| F14 | `crates/kasirmu-bridge/src/setup.rs:378` (global) vs `crates/kasirmu-bridge/src/settings.rs:186-193` (store); `manager.rs:192`; no settings copy in `seed_demo.rs:171-240` or `workspaces.rs:176-187` |
