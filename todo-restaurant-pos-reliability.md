# todo — Restaurant POS reliability: tauri-desktop + tauri-mobile

> **Created 2026-10-09 · status: OPEN — P0–P5, P7, P8 DONE; P6 2 of 3 screens.**
> **Remaining: P6's payments screen (blocked on another lane's dirty file), P1's
> last two keys (owner decision: they have no consumer at all), and F11.**
>
> **D1/D2 history:** the provisioning seed was WITHDRAWN after F14 (provisioning
> writes the global DB, the POS reads the store DB, so a restaurant default for
> `receipt.show_table_number` is not expressible as a provisioning fact). **Option C
> was then chosen and implemented:** the table-number toggle was removed from the
> sidebar screen and table capture is unconditional on restaurant POS.
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

**A THIRD instance, found in round 4:** `RestaurantReceiptsScreen` wrote its whole
localStorage cache (`resto_rcpt_*`, 14 keys) at `:1010-1028`, **before**
`await Promise.all(tasks)` at `:1030`. A rejected save therefore advanced the cache
while the DB kept the old values, and the next mount rendered the un-persisted edit
as saved. Fixed in `f0a2a8b25`.

**What the third instance says about the finding:** F5 was filed as two sites and
was actually three. All three are the same mistake — mutating a client-side mirror
before the durable write resolves — which suggests the pattern, not the file, is
the thing to watch for.

**The pattern is now guarded.** `ui/src/__tests__/mirrorBeforeAwait.test.ts` scans
production source for a `localStorage.setItem` that precedes a durable write in the
same function, and asserts there are none. **Verified zero across `ui/src`** on
2026-10-09.

**Building that guard took FOUR wrong detectors, and the lesson is the useful
part.** Each wrong version passed its own self-tests and was caught only by
reintroducing the real bug:

| Version | Why it was wrong | How it was caught |
|---|---|---|
| 1. brace depth | netted to zero across the mirror's own `try { }` | kill-test |
| 2. depth + transparent try/catch | same reason | kill-test |
| 3. "any await in the function" | 14 false positives — a later `await new Promise(setTimeout)` UI delay is an await, not a write | clean-tree run |
| 4. `await …Scoped(` / `.save(` | missed this very file: the durable calls are `tasks.push(setReceiptSettingsScoped(...))`, and the only awaited line is `await Promise.all(tasks)` | kill-test |
| 5. **`await Promise.all(tasks)` OR a direct scoped/save call** | correct on both the clean tree and the reintroduced bug | — |

**The transferable rule:** a test written before the fix proves nothing until it
has been shown to FAIL against the bug. Versions 1, 2 and 4 all passed on a clean
tree AND on the bug — the exact vacuous state. Only running the detector against a
deliberately reintroduced defect distinguishes a real guard from a comforting one.

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

### F13 — Duplicate settings modules (CLOSED: one is live composition, one is dead)

⚠️ **My first pass called both pairs "duplicates to resolve". That was half wrong,
and the three greps AGENTS.md §6.3 prescribes are what corrected it.**

**Pair 1 — `DataManagementScreen` — NOT a duplicate. Both halves are live and
intentionally split.**

- `features/settings/DataManagementScreen.tsx` is the real data-management body
  (tabs: Export / Import / Backup / Restore).
- `features/settings/screens/DataManagementScreen.tsx:24` **imports** it as
  `DataManagementBody` and renders it `embedded` (suppressing a duplicate `<h1>`),
  adding the settings-hub scaffold. Its header says so at `:3-11`.

So this is a composition shell over a feature screen — the documented pattern for
this hub (registry.ts's own header describes COMPOSITION as one of the three
shapes). Nothing to delete.

**Pair 2 — `AppearanceSection` — genuinely dead, and already marked so.**
`sections/AppearanceSection.tsx:1-6` carries a DEAD note dated 2026-09-15: no
`appearance` key exists in `SETTINGS_SCREENS`, so `renderSection` can never mount
it, and nothing in production imports it. `AppearanceSettings.tsx` IS registered
and live.

**Verdict: no change is warranted, and P8 is closed as a no-op.** The dead
`AppearanceSection` is a deliberate, dated, comment-only marker ("Comment only —
the code below is deliberately untouched"), not an oversight, and its own tests are
its tombstone. Deleting it is a separate refactor with no reliability payoff, and
it is outside this lane's scope. **Recorded rather than "fixed"** — the finding was
my misread, and the correction is the useful output.

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
| `restaurant.hold_order` | **DELETE (reclassified)** | ⚠️ My first pass called this WIRE. **Wrong**, and re-measured 2026-10-09: `bill_type: 'hold'` appears in the UI in exactly ONE place — `RetailPosScreen.tsx:1282` — and that screen is the retail POS, which does not read `restaurant.*` at all. Restaurant POS parks orders as `bill_type: 'open_bill'` (`usePosHeldCarts.ts:181`, `PaymentModal.tsx:1028`). There is no restaurant-side hold action for this key to gate. | **Delete** — it is the same shape as `table_number` was: a key with no reader because the feature it names lives on the other terminal. |
| `restaurant.save_tab` | ✅ **WIRED** 2026-10-09 | The Save Tab / Open Bill button is real and restaurant-only: `CartActionBar.tsx:99-135`, `data-testid="pos-cart-save-tab-btn"`. Gated on `saveTabEnabled !== false`. | Done. |
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

### P4 — Crash isolation (F9), Kitchen Display row (F7), permission gating (F8) — ✅ DONE 2026-10-09

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

**F7 landed** (D4). `RestaurantSidebar` now renders the Kitchen Display row only
when `showKitchenDisplay` is true, and `PosScreen` computes that with the SAME
predicate the shell's `handleNavigate` uses — `isPageAccessible(getPage('kds'),
role, permissions)`. Reusing the predicate rather than inventing a second one is
the point: a second predicate is free to disagree with the navigation it is
predicting. Hidden rather than disabled-with-a-badge, because KDS access is an
entitlement, not a role.

**F8 landed.** The four manager rows (Menu Editor / Receipts / Payments /
Settings) now gate on the same thing the backend enforces — `settings:edit` — via
`hasGrantedPermission`, which mirrors the backend's wildcard rule (the Owner
preset's `["*"]` is not a literal match). When the session carries no permission
list it falls back to the role, so an older session shape is not silently locked
out. `isManagerProp` still wins when a host supplies it.

**Kill-tested:** reverting to role-only gating fails
*"disables the manager rows when the session lacks settings:edit"*.

**This closes P4.** The `passesGate`/`hasGrantedPermission` pair was reused rather
than re-implemented, so the sidebar and the page registry cannot drift on what a
grant means.

- **Acceptance met:** `cd ui && npm run typecheck` exit 0; eslint 0 errors;
  `npx vitest run Restaurant PosScreen CartPanel restaurantPosCrashIsolation` →
  **28 files / 525 passed, 1 skipped**.

### P6 — i18n sweep (fixes F10) — 🔶 IN PROGRESS 2026-10-09

**`RestaurantSettingsScreen` DONE.** All 17 visible labels/descriptions and the
vibration badge moved into `products.ftl` + `products.id.ftl` (keys
`restaurant-setting-*`) and are now read through `l10n.getString`. Indonesian
translations supplied, not left as English copies — the i18n gate fails a
byte-identical `.id.ftl`.

**Test:** a case asserts the bundle VALUES render (`'Customer Name'`, the customer
name description, `'Save Tab / Open Bill'`, the badge), so a regression to a
hardcoded literal fails rather than passing on the same visible text.

**Acceptance met for this screen:** `verify-bundle-parity.py` → **0 missing keys**
(both bundles grew by 17); `npx vitest run RestaurantSettingsScreen` → 11 passed.

**`RestaurantReceiptsScreen` DONE** too: the `No logo` placeholder, the logo
preview `alt`, and the `Logo Position` group's `aria-label` are now bundle-backed
(`restaurant-logo-no-logo`, `restaurant-logo-preview-alt`, and the already-existing
`restaurant-logo-position-heading`). 35 tests pass; parity 0 missing.

**Bonus fix in the same file (F5).** `RestaurantReceiptsScreen` had the *same*
save-ordering defect as `RestaurantSettingsScreen`: its localStorage cache was
written at `:1010-1028`, BEFORE `await Promise.all(tasks)` at `:1030`. A rejected
save therefore advanced the cache while the DB kept the old values, so the next
mount rendered an un-persisted edit as saved. The cache now follows the await.

⚠️ **My first version of that test passed against the BUG** — it edited
`getAllByRole('textbox')[0]`, which is not the title field, so the save carried no
change and the assertion was vacuous. The kill-test caught it (the case survived a
deliberate revert). Rewritten to target `#resto-header-title` and to assert the
exact typed value; it now fails on the bug with
`expected 'ChangedTitle' not to be 'ChangedTitle'`.

### Round 17 — verification note, and whose failures these are

The full suite at the end of this round reports **2 failed / 677 passed**. Neither is
mine, and the attribution is worth recording so the next reader does not chase them:

- `touchTargetSizing` names `features/sales/CartPanel.css::.pos-cart-order-type-btn` — a
  class another lane is adding right now. `CartPanel.css` and `CartPanel.tsx` are
  **dirty in the shared tree** (162 changed lines, mid-edit).
- `noiseDitherCompliance` fails alongside it, from the same in-flight sheet.

The 12 suites that cover my changes pass: **271 passed / 1 skipped / 2 todo**. My two
commits touch `api/sales.ts`, `utils/interaction.ts` and two test fixtures — none of
them is the failing surface.

### Round 46 — the F8 fix never ran in production

Round 45 fixed the badge. This round I traced the gate the badge describes, and found
something worse than a wrong label: **the F8 permission check was dead code.**

`RestaurantSidebar` computed:

```ts
const canEditSettings =
  isManagerProp ??                                  // <-- wins
  (session?.permissions !== undefined
    ? hasGrantedPermission(session.permissions, 'settings:edit')
    : authIsManager);
```

`PosScreen.tsx:1239` always supplies `isManager={isManager}` from `useAuth()`, and
`AuthContext.isManager` (`:176-182`) is a **pure role check** — owner/admin/manager, no
permission awareness at all. Because the prop took precedence, the permission branch was
unreachable in the real app, so a "manager" role whose grant omits `settings:edit` still got
enabled rows whose saves are refused at the IPC boundary. **The exact F8 defect, sitting
behind a gate that reads as fixed.**

Proved by rendering the production shape: the new case fails with *"the role prop bypassed
the permission gate — the F8 fix is inert in production"*. The four original F8 cases never
passed `isManager`, so they exercised the permission branch and stayed green against code
production never ran — a test that could not see the bug.

**The old comment justifying the precedence was also false.** It claimed the prop was kept
for *"the workspace-card and inspector hosts"*; grepping `RestaurantSidebar` shows
`RestaurantMenu` is its only host and `PosScreen` the only host of THAT. No such caller
exists.

Fixed by making the session's grant list authoritative whenever it is present, with the
prop demoted to the fallback it should always have been:

```ts
session?.permissions !== undefined
  ? hasGrantedPermission(session.permissions, 'settings:edit')
  : (isManagerProp ?? authIsManager);
```

The role answer is still correct when the session carries no grant list — then the role is
the only thing anyone can consult, which is the case the fallback exists for. Kill-tested by
restoring the old precedence. `f2bdb5f02`.

### Round 45 — the badge told a Manager to become a Manager

Following F8 (`settings:edit` as the authoritative gate) to the LABEL it produces. The four
manager rows show a badge when disabled, and the badge read:

> `restaurant-manager-required` — "Manager+"

**But the gate is a permission, not a role.** `RestaurantSidebar.tsx:253-257` checks
`hasGrantedPermission(session.permissions, 'settings:edit')` whenever the session carries a
grant list, falling back to the role only when it does not. So for a session whose
`role_name` IS `Manager` and whose grant omits `settings:edit` — a narrowed preset or a
custom role — the row was disabled and told the operator they need **Manager+**: a thing
they already are.

Proved before changing anything: the new case fails against the old badge.

**The component's own header already argued this.** `:56-64` refuses a badge on the KDS row
because *"a 'Manager+' badge would mislabel the reason"* — the exact mistake, one row down,
where the reason is a permission rather than a route entitlement.

**The F8 tests never looked at the label.** All four cases assert disabled/enabled and the
wildcard/fallback paths; nothing checked what a disabled row *says*. So the gate was fixed
and the copy was not.

Fix: a `gateBlockedByPermission` derivation picks the string by WHY the row is blocked.
- blocked by a missing GRANT → new key `restaurant-permission-required` ("Needs
  permission" / "Butuh izin"), added to both locales;
- blocked by the ROLE (no permission list in the session, so `authIsManager` decided) →
  "Manager+" stays, because there a role genuinely IS what is missing.

Both halves are pinned: the new case covers the permission path and
`RestaurantPosSidebar` still asserts "Manager+" on the role path. Kill-tested by forcing
`gateBlockedByPermission = false`.

`a980d31f9`.

### Round 44 — finishing round 43: the doc comments still described what was removed

Round 43 removed the `settings-screen-migrating` note from all 14 screens. It left **seven
module headers** still asserting it was there — the same defect one layer down, and the
same class as round 34's stale claim in `kdsDensity`'s header.

The clearest was `SystemDiagnosticsScreen.tsx:8-9`, which said:

> *"The remaining scaffolds in this folder still render 'This page is being rebuilt' until
> their own content is wired in."*

**There are no remaining scaffolds.** That is precisely why round 43 could delete the note
from all 14 at once. No screen in the folder renders a rebuild line, so the sentence was
not merely stale — it was the reason a reader would have assumed the note-removal was
incomplete.

Also corrected: `LicenseSubscriptionScreen.tsx:8-9` claimed "The shared migrating note
stays: SettingsPage.test.tsx asserts it under EVERY section body (:426)" — the assertion now
requires the opposite, and round 43 changed that line. Four others
(`ExchangeRates`, `FeaturesModules`, `OfflineQueue`, `TaxConfiguration`) shared the phrase
"the route, the scaffold shell and its migrating note stay on this", plus
`DataManagementScreen`'s matching pair.

**No behaviour change** — seven comments, 30 insertions / 20 deletions. Full suite green at
683 files / 11,451. `f2b750fac`.

### Round 43 — 14 finished screens told users their content "will move here"

Chasing F13 (the two `DataManagementScreen.tsx` files — which turned out to be a DELIBERATE
composition, not a duplicate: `screens/` is the route shell and the body it renders is the
real screen, documented in-file). The plan's evidence index still listed F13 as open; it was
resolved 2026-10-06.

What that led to is worth more. The shell rendered:

> `settings-screen-migrating` — "Existing settings content will move here selectively."

**On every one of the 14 settings screens — 13 of them fully built.**
`SecurityAccountScreen` renders a real `Card` with a live `RoleBadge` and an audit-trail
note, and still carried the line — with a comment naming the reason:

> *"The migration note stays (SettingsPage.test.tsx asserts it on every screen, migrated
> ones included)."*

**The assertion was the defect.** `SettingsPage.test.tsx:561-563` required the note on
EVERY screen unconditionally, so a migrated screen could never drop it: the test pinned
stale copy rather than catching it. Same shape as round 36's header and round 41's
"SETTLED" section — a test asserting something untrue of the code.

Fixed in the right order:

1. Rewrote the assertion so a MIGRATED screen must NOT show the note, while an un-migrated
   one still must. That immediately named the offenders one at a time (`general is migrated
   onto real content but still shows the "will move here" note`).
2. Removed the note from all 14, plus the now-dead `.settings-screen-placeholder-note` rule
   — which `screenExtraction`'s dead-class check caught.

**A mistake I made and had to undo:** my first removal pass used a greedy regex that ate the
function header of `SystemDiagnosticsScreen` and `SyncStatusScreen` (and would have hit five
more). `tsc` caught it at once; I reverted all 13 files and redid it as a line-range scan
that finds the `<p ...>` by `className`, walks to its own `</p>`, and splices only that span.
The lesson I keep relearning: **a regex over JSX is not a parser**, and the typechecker is
the cheapest way to find out.

`77a79d415` — 16 files, 94 deletions, 25 insertions.

### Round 42 — the Hold Order toggle removed (D5, first of three)

Full detail under D5 in section 4. Removed across all seven places it lived plus both
locales; `deadSettingsKey`'s written-key floor caught the removal, which is what the floor
is for. `df86bf0b3` + `cf4147435`.

### Round 41 — `payment_gateways.is_active` has no consumer at all

Following round 40's abandoned edit to its second half. It also wanted to make the
gateway `is_active` follow the rail row instead of an independent flag, and THAT half is
defensible — a screen writing two values that can disagree is the shape this plan keeps
finding. But before endorsing it I traced where `is_active` is actually read.

**Nowhere that matters.** The chain, measured:

| Step | Evidence |
|---|---|
| Stored, upsertable | `db/payment_gateways.rs:150-160` writes `is_active` |
| Readable | `get_payment_gateway` (:180), `list_payment_gateways` (:214), `list_active_payment_gateways` (:248-256, `WHERE is_active = 1`) |
| `list_active_*` callers | **its own tests only** — `payment_gateways_tests.rs:154`, plus a doc example at `:308`. No production call site. |
| UI readers of any gateway config | `RestaurantPaymentsScreen.tsx:454-455` — **the only one**, i.e. the same screen that wrote it |
| Charge path | never touches `payment_gateways`; midtrans on the server comes from ENV (`apps/cloud-server/src/config.rs:107`, `:113`) |

So `is_active` is a closed loop: the screen writes it and reads it back. The `list_active_*
WHERE is_active = 1` helper — the one function that would make the flag meaningful — never
runs in production.

**Consequence for the abandoned edit:** its `open_bill`/`credit` half is wrong (round 40),
and its `isActive` half would fix a disagreement **between two values that are both
unconsumed**. Neither half is the parity the code needs. Storing the flag is fine; pretending
it gates something is what the comments should stop implying — that is a documentation fix
in a file I cannot commit, so it is recorded here instead.

### Round 40 — 19-hour-old abandoned work that would have REGRESSED if committed

`RestaurantPaymentsScreen.tsx` has shown ` M` in every round I have observed — I read it as
an active lane and left it alone, per §7.3. This round I checked instead of assuming:
**its mtime is 2026-10-08 20:47, and 144 commits have landed since.** Every sibling screen
in the same directory was modified today. It is **abandoned work, not an active lane.**

So I read it. It is a complete, coherent 20/11 change: it made the midtrans/stripe gateway
`isActive` follow the rail row (`drafts.find(...).is_enabled`) rather than an independent
flag, and it un-hid `open_bill`/`credit` from the "other rails" list so each gets a toggle.
It typechecks, and `RestaurantPaymentsScreen` is 30/30 green.

**But its stated premise is false, and acting on it would have introduced exactly the defect
this plan exists to remove.** Its comment claims:

> *"the charge modal gates BOTH on their rail now (full parity), so hiding them made their
> toggle unreachable"*

Measured: `TENDER_RAILS` (`useLocalPaymentRails.ts:78-83`) has four entries — `cash`, `card`,
`qris`, `credit` — and **only `qris` has a non-null `railCode`**. `open_bill` is not in that
table at all; the popup gates it on `isRestaurantPos` (`PaymentModal.tsx:324`), a WORKSPACE
check. `credit` is explicitly `railCode: null`, and `:70-73` records that as a parked owner
question.

The consequence: giving `open_bill`/`credit` a rail toggle would create **two more controls
whose key no reader consults** — the F1 shape, and the same shape as rounds 27's dead
toggles. The divergence is already pinned by
`useLocalPaymentRails.test.ts:97` ("does not gate open_bill or credit on any rail flag
(documented divergence)").

**Not committed, deliberately.** It is not my path to commit, and its central claim is wrong;
the right fix for the parity it *wants* is to make the popup consult those rails (a product
decision, pinned since round 15), not to add toggles the popup ignores.

The reusable lesson: **an abandoned dirty file is not the same as an active one.** ` M` in
the tree says nothing about age. `LastWriteTime` plus a commit count since that write is the
measurement, and it took one command to settle what ~35 rounds of observation had assumed.

### Round 39 — checked whether the receipts screen must announce its 14 preference keys: NO

The round-38 fix made `WorkspaceRestaurantPosSettings` announce every `receipt.*` key it
writes. The sibling screen `RestaurantReceiptsScreen` writes through **two** APIs —
`setReceiptSettingsScoped` (ten `receipt.*` keys) and `setUserPreferencesScoped` (**fourteen**
`resto_rcpt_*` keys, `:1005-1020`) — while announcing only the ten `receipt.*` ones
(`:1085-1096`). That looked like the same asymmetry I had just fixed, so I traced it.

**It is correct as written, and the reason is worth keeping.** `markSettingsUpdated` feeds
`loadScoped`, which maps keys to scopes via `SCOPE_PREFIXES`
(`SettingsContext.tsx:146-154`: `receipt.`, `store.`, `currency.`, `sync.`, `brand.`,
`prefs.`, `user.`). Nothing matches `resto_rcpt_*`. But `loadScoped`'s `preferences` branch
(`:512-530`) parses only **`cardsize`, `fontsize`, `font-smoothing`** into
`settings.preferences` — the `resto_rcpt_*` values are fetched and then DISCARDED. They
never enter `SettingsContext`, so there is no cached copy for any other surface to hold
stale, and announcing them would trigger a `getUserPreferencesScoped` round-trip that
throws the result away.

The preference keys are the screen's own overlay (see F11): it reads them back directly at
`:392-455` on mount and mirrors them to localStorage. Nothing else consumes them.

Recorded because "the writer announces ten of twenty-four keys" reads like a bug, and the
next reader should not re-derive this. **No change made.**

### Round 38 — a ten-key save that announced one key (fix HELD, not committed)

The F10 shared card (`WorkspaceRestaurantPosSettings`) writes **ten** receipt keys through
`setReceiptSettingsScoped` and then called:

```ts
markSettingsUpdated(['receipt.showTableNumber', 'restaurant.course_firing']);
```

That call is the refetch broadcast (`SettingsContext.tsx:185-196`), so **nine** keys —
`showCurrency`, `decimalSeparator`, `showTax`, `footer`, `paperWidth` and the four margins
— were persisted while every other mounted surface kept its stale copy until an unrelated
refetch. Proved before touching it: the new case fails with
`[ 'receipt.showCurrency', …(8) ]` persisted-but-unannounced.

`RestaurantReceiptsScreen.tsx:1085-1096` writes the same receipt keys and announces all
ten, which is what makes this drift rather than a second convention. The fix mirrors the
write payload (`Object.keys({...}).map(k => \`receipt.${k}\`)`) instead of re-typing the
list, so the two cannot diverge again.

**⚠️ HELD — the fix and its test are on disk but NOT committed, deliberately.** The source
file is being actively edited by another lane (121 added lines across 5 hunks: a new Receipt
Printer card, `useTerminalHardware` wiring, and this file's `markSettingsUpdated`). My hunk
sits *interleaved* with theirs, and a pathspec commit takes the whole working-tree file —
so committing my fix would sweep their unfinished work in, which §7.3 forbids.

Committing the **test alone** was the alternative and is worse: at HEAD the announcement is
still the one-key form, so the case would land RED. A test that cannot pass at HEAD is not
coverage.

**RESOLVED in round 39, and the resolution is worth recording.** The other lane's commit
`9e8bc978d` (*"feat(settings): add receipt printer configuration to restaurant pos
settings"*) **swept both of my held files in** — the source fix (their hunk and mine were
interleaved in one file) and the test. Verified at HEAD: the announcement is now the
`Object.keys({...}).map(k => \`receipt.${k}\`)` form, my case is present at
`WorkspaceRestaurantPosSettings.test.tsx:252`, and the suite is **15/15**.

So the fix landed, just under another lane's subject rather than mine. That is the normal
outcome for a held change on a shared file — §7.3 notes it explicitly ("If `git commit`
reports nothing to commit, your work may already be in someone else's commit"). What the
hold bought was three rounds of the shared index not being contaminated by *my* pathspec;
what it cost was nothing, because the other lane committed a coherent file.

### Round 37 — every save failure read the same generic sentence

Checking the menu editor for the error-handling convention turned up the contrast that
made a defect obvious: `RestaurantMenuEditorScreen` calls `l10nErrorMessage` **9 times**
(with optimistic rollback on each failure), `RestaurantReceiptsScreen` twice, and
`RestaurantSettingsScreen` **not at all**.

Both of the settings screen's catches were bare:

```ts
try { ... } catch { addToast({ message: <one generic key> }) }
```

So a save that failed because the **session had expired** — something the operator can
actually fix — read exactly like an unknown fault. `err` was discarded and never
inspected.

`l10nErrorMessage` is built for precisely this (`utils/app-error.ts:319-325`): a TYPED
`AppError` maps to specific user-safe copy (session, permission, conflict, offline), and
anything unrecognized falls back to the screen's own key — *"so each screen keeps its
operational context while raw backend text never renders"*. Both catches now use it
(`6246f56c5`).

**Tested in both directions**, because only checking one would be half a contract: a typed
`invalidSession` surfaces "session has expired" (and the raw `token expired` text must NOT
render), while an untyped `Error` still falls back to the screen's own message. Kill-tested
by restoring the bare catch.

### Round 36 — a test header that claimed more coverage than it had

I was checking the settings screen's save path for the F4 family (a partial write leaving
the screen looking saved). That path is sound: one atomic `setSettingsScoped`, the success
toast only after it resolves, and — the F5 fix from round 6 — the localStorage mirror runs
**after** the `await`, so a rejected save leaves the mirror matching a DB it failed to
change.

But the `catch` there swallowed the error with no diagnostic, so I went looking for the
convention and found `__tests__/toastErrorQuality.test.ts` guarding it. Its header listed
**six** guarantees. Measured against the file and the code:

| Claim | Reality |
|---|---|
| 1-3. `errorDetail()` extracts / handles shapes / redacts | ✅ fully covered |
| 4. `l10nErrorMessage()` never returns the raw key | ❌ **not in this file at all** — the function isn't even imported |
| 5. GlobalErrorReporter passes detail + title | ✅ true of the code (`:67`) — but **untested here** |
| 6. "The Toast type enforces `detail` on error toasts" | ❌ **false** |

Claim 6 is the sharp one. `Toast.detail` is `detail?: string` (`components/Toast.tsx:26`),
optional on a single non-discriminated interface, so nothing *can* enforce it — and nothing
does: **235 `type: 'error'` toasts exist repo-wide and ZERO pass `detail`.** The only
producer is GlobalErrorReporter.

A header asserting more than the body checks is worse than a short one: it stops the next
reader looking. Corrected to match the cases, with claims 4 and 5 recorded as
unverified/untested rather than deleted (`ca3268713`).

**Then I closed the one real gap** rather than only noting it: `GlobalErrorReporter.test.tsx`
now asserts the toast actually carries actionable detail (source, timestamp, extracted
message) behind its Show-detail toggle — the behaviour claim 5 described. Kill-tested by
dropping `detail:` from the reporter.

### Round 35 — 6 of 12 receipt toggles cannot reach the paper

Rounds 33-34 found three receipt toggles the printer cannot honour. This round I measured
the whole set instead of discovering them one at a time, by reading the printer's config
struct rather than the UI.

**`ReceiptConfig` (`crates/kasirmu-hal/src/drivers/receipt.rs:98-117`) has exactly 8
fields** — verified by grepping `pub <name>` in that file, not by reading prose:

| The screen's toggle | In `ReceiptConfig`? |
|---|---|
| `showCurrency` · `showTax` · `showTableNumber` | ✅ |
| `decimalSeparator` · `paperWidth` · `footer` | ✅ |
| `showReceiptCode` · `showDateTime` · `showItemNotes` | ❌ |
| `showStaffName` | ❌❌ |
| `showDecimals` · `showThousandsSeparator` | ❌ |

**`showStaffName` is a sharper case than the others.** Grepping the renderer for
`staff|cashier` returns **nothing** — the paper has no concept of a staff name at all. The
preview renders a real one (`:1431`, fed by `session.display_name`), so that toggle shows a
line that cannot appear on a printed receipt in *either* position. Its three siblings differ:
those lines DO print, unconditionally (`:467` receipt number, `:468` date, `:522` item
note), so switching them off hides them from the preview while the paper keeps them.

Both facts are pinned in `receiptPreviewPrintAgreement.test.ts` — the toggle table as data,
and the staff claim by **reading the Rust file**, so it fails if the printer ever gains a
staff line. Kill-tested across the language boundary (adding `pub staff_name` to
`ReceiptConfig` fails it with the "revisit this" message). `e4d72ca71`.

**Not decided:** which side is wrong. The printer's shape is coherent (it prints what a
receipt must carry, with no switch for it), and the toggles are per-user cosmetic
preferences. Reconciling them is the same product call as round 27's dead toggles, now with
a measured list to decide against.

### Round 33 — the preview claimed a precision the printer cannot print

I read the receipts audit (`docs/records/audits/audit-receipt-settings.md`) covering the
screen the goal's sidebar leads to, and chased its finding 6 — "`formatPrice` always uses
**id-ID** separators … the preview visibly ignores one of its own controls".

**That finding is stale** — `formatPrice` now takes `decimalSeparator`
(`receiptLogic.ts:76`), the screen passes it through a local wrapper (`:1204-1212`), and
the import is aliased `_formatPrice` (`:27`) precisely so the wrapper can shadow it. Half
of finding 6 was fixed.

**The other half was not, and is worse than the audit describes.** Following the separator
to the printer:

| | Value |
|---|---|
| screen | `effectiveDecimalSeparator = 'comma'` for IDR, `showDecimals ? 2 : 0` (`:1199-1210`) |
| printer | `format_money` → `foundation::format_minor` → the currency's CANONICAL exponent (`receipt.rs:251-273`) |

IDR is exp-0, so the printer's `frac` is `None`, the match falls to its `(_, _)` arm, and
the paper prints the major ALONE — no separator, no fraction. The preview rendered
`Rp 1.500,00`. Measured before touching anything: `expected 'Rp 1.500,00' to be 'Rp 1500'`.

**Root cause, and why the toggle cannot be fixed from the screen:** `ReceiptConfig`
(`receipt.rs:98-117`) has **no `showDecimals` field**. The preference is stored, read back
by the same screen, and applied to the preview — it can never reach the printer. So the
honest fix is the preview, which now caps its fraction digits by `minorUnitExponent`
(the same canonical exponent the Rust side uses, `types/domain.ts:217`).

Three existing tests **pinned the divergence** and were updated
(`receiptLogic.test.ts:104,131`, `RestaurantReceiptsScreen.test.tsx:181` asserted
`93000,00` for IDR). The kill-test reverts the cap and all three cases fail.

**Recorded, not fixed — `showThousandsSeparator` is the same shape.** The printer has no
grouping at all (`format_money` emits none; `currency.thousands_separator` is stored at
`platform/core/src/settings/keys.rs:71` and read by NO formatter). The preview groups, so
`Rp 1.500` vs `Rp 1500` remains a live divergence. I pinned the current behaviour in a case
that states it is a divergence, rather than silently changing a second control's semantics
in the same commit. That is a follow-up decision.

**CORRECTION (round 34).** The paragph above originally added that the printer had
"no IDR case at all … the fixture never exercises an exp-0 currency". **That was wrong.**
`receipt_tests.rs:154` (`format_money_idr_has_no_decimal_tail`) and `:175`
(`format_money_kwd_three_decimals`) cover exp-0 and exp-3 exactly, asserting the ungrouped
`"4450000"` under all three separators. My grep searched for the `usd_money` helper and
missed the inline `Money` literals those cases use. The exp-0 behaviour was always tested;
what was missing was the UI side, which round 33 added.

`0803cee7e`.

### Round 32 — finishing the sweep instead of stopping at the bug

Round 31 fixed `guest_count` and pinned the three gates whose runtime prop is a `??`
fallback. This round I checked the two gates that are **not** mapped that way, because a
guard covering three of five is the same short-list failure that hid surfaces twice in
rounds 18 and 20.

**Both agree — by a different route, which is exactly why they needed their own cases:**

| Gate | Unset-key read | Effective | Screen default |
|---|---|---|---|
| `customerName` / `guestCount` / `saveTab` | `null` → `?? true` | shown | `true` |
| `courseFiring` | `raw === 'true'` → explicit `false` | off | `false` |
| `orderTypePrompt` | `activeWorkspace === 'restaurant-pos'` | on for this POS | `true` |

The agreement is a fact about each **pair**, and either half can move. Making
courseFiring's read `raw !== 'false'` — the tempting "be permissive like the other three"
edit — would reproduce the guest-count bug exactly. That case is now pinned and
kill-tested (flipping the screen default to `true` fails it).

**One asymmetry is deliberate and worth recording**: `courseFiring` treats an *unset* key
(`raw === null` → `false`) differently from a *failed* read (`null` → shown, `:785`). The
other three collapse both into `null`. That is correct here — an unset course-firing key
means "the feature was never turned on", while a failed read must not remove a capability.
I checked rather than assumed, and left it alone.

`cd73b5dda`.

### Round 31 — the settings screen described a POS that did not exist

With the tender class closed, I turned the "one value, several consumers" lens on the goal's
*other* named surface: the sidebar settings screen. It found a divergence in the same
family as round 25's KDS defaults, and this one was wrong in the direction that misleads a
merchant.

`restaurant.guest_count` is read by three places, and two disagreed about an **unset** key:

| Surface | Behaviour for an unset key |
|---|---|
| `PosScreen.tsx:1141` | `guestCountEnabled ?? true` → the pax field is **shown** |
| `CartPanel.tsx:759` | `guestCountEnabled !== false` → shown |
| `DEFAULT_RESTAURANT_SETTINGS.guestCount` | **`false`** → the screen rendered the toggle **OFF** |

So a merchant opened Settings, saw Guest Count switched off, and the POS was showing the
field. The screen asserted a state the till was not in.

**Which side moved, and why.** The runtime's direction is deliberate and documented at
`PosScreen.tsx:792-796`: *"an unset key cannot hide a field that has always been visible"* —
a settings outage must not remove a POS capability. That is the safe direction, so the
**screen's default** was the wrong one and moved to `true`.

**The guard pins both directions**, which matters because either side could drift:
`restaurantSettingDefaultsAgree.test.ts` reads the POS's own `??` default for each
cart-field gate and requires it to equal the settings default, then counts the runtime's
prop sites so a gate added later cannot skip the check. Kill-tested by reverting the
screen default (fails) and by reverting the runtime default (fails).

`87854c2cf`.

### Round 30 — the third site, and why the tests could not see it

Round 29 fixed the retry's stored enum. Sweeping the same field for a fourth time found
it: the retry builds its **own** `PrintSalesReceiptArgs` (`PaymentModal.tsx:1589`) and
filled `method` with `method.toUpperCase()` (`:1621`) while the normal path uses
`methodLabel` (`:1222`). So the receipt a customer got depended on whether the sale
happened to hit a stock shortfall — and a merchant's configured QRIS label was dropped on
that path, because the resolver was never consulted.

Proved by observation, not reasoning: a temporary log printed `PRINTED_METHOD="CASH"`
from the retry's receipt.

**Then the interesting part: three attempts at a behavioural test, and the first two
passed against the bug.** For a CASH sale the correct label IS `'CASH'`, which the buggy
`toUpperCase()` also produces — so a cash assertion cannot distinguish them. The
distinguishing tender is QRIS with a custom rail label, and the QRIS tab would not mount
inside that suite (the rail fetch resolves after mount, and `getByRole('radio')` never
found it). I removed the test rather than keep one that passes for the wrong reason.

**So the guard is static, and that is the right call here.**
`tenderValueSingleSource.test.ts` reads the production source and asserts:

1. `storedMethod` and `methodLabel` are each derived exactly once;
2. no send site rebuilds the tender inline (`method:` on a line using
   `method.toUpperCase()`);
3. the receipt sends `method: methodLabel`, the column sends
   `paymentMethod: storedMethod`, the retry sends `paymentMethod={storedMethod}`.

A source check does not care which tender a test happens to drive, which is exactly the
limitation that defeated the behavioural version. Four kill-tests, two shapes: reverting
the retry receipt fails case 2 naming the line, and reverting the stored column fails
case 3.

The lesson worth keeping: **when a bug's two values coincide for the common input, a
test over that input proves nothing** — check the guard by reverting the fix and watching
it fail. `2dc4d6110`.

### Round 29 — the SAME tender, two spellings, in one attempt

Round 28 fixed the receipt's label. This round I swept the class instead of waiting to trip
over it again, and the sweep found the third site of the same field.

**`paymentMethod` was sent from three places, and only one was lowercased.** `bbc530642`
fixed the first submission; the **shortfall retry** kept `method.toUpperCase()`. So a sale
that hit a stock shortfall and was retried sent `'CARD'` where its first send was `'card'` —
the same attempt, the same column, two spellings.

Proved, not reasoned: the new assertion failed with

```
- "paymentMethod": "cash",
+ "paymentMethod": "CARD",
```

**Why it matters more than a cosmetic mismatch.** The backend normalises only
`payment_splits` (`sales_checkout.rs:622-634`) — the scalar `sales.payment_method` is
written verbatim at `:549`. So the uppercase spelling reached the column unchecked. The
first path's fix is what made this a *divergence* rather than a consistent bug.

Fixed by lifting both derivations to **component scope as `useMemo`s** (`:480`, `:490`),
so the first submission, the receipt, and the retry read one definition. The retry is now
`paymentMethod={storedMethod}` — it cannot drift again, because there is nothing left to
diverge from. `b785ed3f5`.

**Two things I got wrong on the way, both caught by running things:**

- I inserted a second, duplicate `storedMethod`/`methodLabel` pair and only found it when
esbuild refused to transform (`The symbol "storedMethod" has already been declared`) —
`tsc --noEmit` had passed, because the duplicate sat in a different scope.
- My first version of the assertion said `'cash'` for a test that pays by **card**. The
fix was already correct; the expectation was not.

### Round 28 — the receipt started printing the database's spelling

Another lane's `bbc530642` lowercased the stored tender so it would satisfy the
`sales.payment_method` CHECK constraint. That part is right. But it changed
`methodLabel`, and **that one variable had two consumers wanting opposite things**:

| Consumer | Wants | Got |
|---|---|---|
| `completeSaleScoped({ paymentMethod })` — the DB column | the lowercase enum | ✅ lowercase |
| `buildCompletedSaleReceipt({ payments: [{ method }] })` — printed for the customer | human-readable | ❌ `'cash'` |

The receipt renders `pmt.method` verbatim (`ReceiptPreview.tsx:183`), so a cash sale
began printing `cash` where it had printed `CASH`, and a merchant's configured QRIS label
was dropped entirely (that branch was deleted, not just lowercased).

**Why nothing caught it.** `ReceiptPreview.test.tsx:42` feeds the renderer a fixture with
`'CASH'` already in it, so it tests the renderer and not the boundary; and
`PaymentModalSaleFlow.test.tsx:186` asserted `expect.any(Object)`. The value crossed an
untested seam.

Fixed by splitting the one variable into the two facts it was carrying: `storedMethod`
(the enum) and `methodLabel` (the label, with the `resolveTenderDisplayName` branch
restored). `dd708c4f5`.

**The kill-test needed two attempts, and the first taught me something.** Reverting how I
wired `paymentMethod` did NOT fail the new test — because my test asserts the RECEIPT
value, which was still correct. It only discriminates when the receipt's source is
reverted, which is the actual regression shape. A kill-test that passes is telling you
your test guards something else.

### Round 28b — a gate that was ALREADY red, and not mine

The full suite then surfaced `RetailPosScreenCheckout` expecting `paymentMethod: 'CASH'`.
That is **not fallout from my change**: `bbc530642` lowercased production and left this
assertion on the old spelling, so it was red at HEAD. Proved by reading the pre-commit
blob (`bbc530642~1`), where the value was `method.toUpperCase()`.

Repaired the expectation rather than the constraint (`f0c6f1497`), with the reason
inline and a pointer to the case that pins the printed label apart from the stored enum.
Left red it would have been a gate people learn to ignore — the round-19 lesson.

### Round 27 — the dead keys are now DECLARED, which is not the same as decided

F1's three dead keys have been open since round 2 and I have re-flagged them every few
rounds. This round I re-verified them (still zero readers) and then asked a different
question than "delete or build?": **what is true regardless of that answer?**

The answer is that the debt was **implicit**. Nothing in the code said those three keys
are known-dead, so the next reader had to redo the grep, and a fourth could be added
without anyone noticing. `ui/src/__tests__/deadSettingsKey.test.ts` now:

1. reads every `'restaurant.<key>':` the screen writes, and fails on any that no file
   outside the writer/model mentions — unless it is in `DECLARED_DEAD`;
2. fails if a `DECLARED_DEAD` entry GAINS a reader, so the list cannot outlive the
   condition it records (the same stale-entry rule my other guards use).

**The guard independently rediscovered the exact three** (`hold_order`,
`auto_print_kitchen`, `sound_chime`) — which is the check that it measures reality rather
than restating my notes. It also surfaced something I had not written down: the two
interaction keys ARE live, reached through the **F6 mirror** (`restaurant.interaction_sound`
→ `pos.interaction_sound`, which `utils/interaction.ts` reads). That is the same "one
field, two names" shape as round 24, and it is now mapped explicitly with the reason
rather than being waved through.

Both cases are kill-tested: adding a fourth dead key fails, and removing the mirror
mapping fails on the interaction pair.

**The product question is still open** and I have not guessed at it. Wiring any of the
three means INVENTING the feature its description promises — a KOT-send path, an
order-sent chime, or a restaurant-side hold action — and P1's own rule says that must not
ride in on a reliability repair. What changed is that the debt is now stated in code.

`af7978610`.

### Round 26 — the extraction that missed a site

The KDS density bound was extracted out of its inline sites into `kdsDensity.ts`, and
that module's own header names the three it lifted (`KdsHamburgerPanel` x2,
`KdsMainContent`). It also states the reason the extraction exists: *"a copy is
invisible to a name-matching detector precisely because there is nothing to collide
with."*

**There was a fourth, and the extraction did not know about it.**
`WorkspaceKdsSettings.tsx:119` held `Math.min(5, Math.max(1, parseInt(density ?? '', 10)
|| DEFAULT_KDS.density))` — the settings card hydrating an unset or hand-edited stored
value. Widening `DENSITY_MAX` would have left the card accepting a density the board
would not render.

Named it `clampDensity` (the name the test had to invent for itself before the module
existed) and pointed the card at it. The module header now records the fourth site.

**Kill-tested with a relationship case, not a literal one:** setting `DENSITY_MAX = 6`
fails two cases — the new clamp case AND the pre-existing `stepDensity` ceiling case —
which is the property that matters. The clamp and the stepper move together because both
read the constant; a literal assertion would have let one drift.

`c477185f9`.

### Round 25 — the second copy of the KDS defaults

Round 24 named the pattern this plan keeps producing — *two surfaces reading one field
with different rules* — so this round I went looking for it deliberately.

The value-comparison scan came back clean (the rail fix closed the last one, and no key
is read with both the `=== 'true'` and `!== 'false'` idioms). But the **defaults** scan
found the shape again: the five KDS settings were modelled **twice**.

| | `kdsSettingsModel.DEFAULT_SETTINGS` | `WorkspaceKdsSettings.DEFAULT_KDS` |
|---|---|---|
| consumer | the KDS board (`KdsScreen.tsx:73`) | the Settings card |
| used for | the board's initial state | the card's fallback for an UNSET key (`:105`, `:109`, `:114`) |

The two agreed today, which is exactly why it was worth fixing rather than noting:
change the board's default density to 4 and the card would keep **displaying and writing
3**, so the number the operator sees is not the number the board uses. The card already
imports from `@/features/kds/` (`:10`), so it now derives from the model.

**Kill-tested, and the result is the point:** changing `DEFAULT_SETTINGS.density` to 4
now makes the card's save write `'4'` as well — before the fix it kept writing `'3'`.
The card's own test asserts against `KDS_DEFAULT_SETTINGS`, not the literals, so a model
change flows through instead of failing.

`c833838b9`. A follow-up scan for other cards declaring their own `DEFAULT_*` returns 0,
and only two feature models export a default (`kdsSettingsModel`, and the
`restaurantSettingsModel` this lane created single-sourced in round 2).

### Round 24 — a rail the operator could enable but never see

With F9 complete I went back to the goal's core and compared the two surfaces that
share the payment-rail vocabulary: the settings screen and the charge popup.

**They disagreed about case, and the popup's side lost.** `rail_code` is a free-form
string the operator can create (that screen has an "add a custom rail" form), **nothing
normalises it on write** — the bridge passes it straight through
(`crates/kasirmu-bridge/src/local_payment.rs:95`) and the column has no CHECK constraint
— and `RestaurantPaymentsScreen` lowercases at every one of its 14 lookups.

`useLocalPaymentRails.railOffered` compared **raw** (`r.rail_code === railCode`). So a
rail saved as `QRIS` was switchable ON in settings and then not matched in the popup,
falling through to `rail ? rail.is_enabled : false` = **false — hiding the tender the
operator had just enabled.** Same failure shape as the `midtrans isActive` disagreement
between that screen and the charge modal.

Two more raw comparisons in the same file had the same bug, and one is money-path:
`staticQrisPayload` returned **null**, so the merchant's QR code never rendered even
though settings showed the rail configured. Both fixed (`ba7550263`).

**Both tests fail on a revert** — verified by restoring the raw comparisons, which turns
them red with `expected false to be true`. The three fixes share one root cause: a
normalising surface and a raw-comparing one reading the same field.

### Round 23 — F9 sweep COMPLETE, and independently verified

Round 20 wrapped two CHILDREN of `RestaurantMenu` and left the component itself bare at
its PosScreen render site (`:1224`). A boundary around a child covers what renders inside
that child; it says nothing about the parent's own body — the header, the preferences
state, the hooks. So the largest surface in the pane was still exposed. Both ternary
branches are now wrapped (`c61718563`).

**The reset semantics needed a correction too.** My first attempt reset the pane with
`onReset={() => setRestaurantSidebarOpen(false)}`, copied from the pattern the other
boundaries use. That is wrong here: the products pane is not gated by that flag, so
resetting would have closed the sidebar the cashier was using and left the pane is the
same state. Every other `onReset` in the file closes *its own* surface; this one has no
surface to close, so it uses `resetKeys={[activeWorkspace]}` — the error clears when the
workspace changes, which is the only meaningful trigger for a main pane.

**The sweep is now complete, and the completion is measured, not asserted.** A scan for
capitalised JSX components outside a boundary across the three hosts returns:

```
features/sales/PosScreen.tsx         — 0 outside a boundary
features/restaurant/RestaurantMenu.tsx — 0 outside a boundary
features/retail/RetailPosScreen.tsx    — 0 outside a boundary
```

That scan is the tool that should have been written in round 18, when the first gap
appeared. **Six rounds of this sequence found 4 -> 7 -> 9 -> 11 -> 14 -> 20 -> 22
surfaces**, every increment found by looking, none by the guard — the same limitation
recorded in rounds 21 and 22. `PosScreen` now holds 16 boundaries.

The guard lists 22 surfaces and asserts `>= 22`. `c61718563`.

### Round 22 — the money dialogs ON the sale, and the shift family

Round 21 fixed the scoped boundary for the payment popup. Two rounds in a row had ended
with the F9 guard's list short of reality, so this round I stopped adding one target per
round and enumerated the render sites instead — the method that actually works.

**Six more surfaces in `PosScreen` had no boundary**, every one of them a dialog the
cashier reaches mid-sale:

| Dialog | What it writes |
|---|---|
| `PriceOverrideModal` | a line price |
| `PromotionsModal` | the cart discount |
| `ItemModifierModal` | an existing line's options and price |
| `CloseShiftConfirm` | the cash-drawer count |
| `ShiftSummary` | the reconciliation figures |
| `OpenShiftModal` | the opening float |

The first three are the money on the sale; the last three are cash-drawer
reconciliation. All six are now wrapped, with `onReset` routed through each modal's own
exit controller (`closeShiftExit.requestClose()` etc.) rather than a guessed setter —
three of the flags live in `usePosShifts`, not PosScreen state, which `tsc` caught.

**`PosScreen` now holds 14 boundaries: 7 sub-screens + the payment popup + 6 dialogs.**
The guard lists 20 surfaces and asserts `>= 20`. Both new groups are kill-tested
(`PromotionsModal`, `CloseShiftConfirm`).

**One I deliberately did NOT wrap:** `RetailPosScreen.tsx:1965` renders an
`ItemModifierModal` that its own comment documents as *deliberately inert*
(`groups={[]}`, wired to a stub) — "Wiring the button to an always-empty dialog is worse
than the stub: it looks finished. Leave it inert until the backend read exists." There
is no user data for it to throw on. Wrapping it would be ceremony.

`747247a97`, `39f1d6aac`.

### Round 21 — the money dialog had no scoped boundary, in either shell

The goal names the payment popup, so I checked its crash isolation directly. `grep`
found **no `LocalizedErrorBoundary` anywhere in `PaymentModal.tsx`**, and neither shell
wrapped it at its render site (`PosScreen.tsx:1281`, `RetailPosScreen.tsx:1551`).

**It was not unhandled — it was handled in the worst possible way.** `AppProviders.tsx:93`
has an app-level `LocalizedErrorBoundary`, so a throw in the popup was caught. But that
boundary carries `autoRefreshMs={ERROR_AUTO_REFRESH_MS}` (30s), and its own comment at
`:28-31` states the intent these boundaries violate: *"Embedded card-level boundaries
(workspace settings, topology editor, …) intentionally do NOT set this, so a scoped
failure never reloads the whole POS."*

So the failure mode was: the cashier picks a tender, the popup throws, the **entire POS
replaces itself with a full-page error and auto-reloads after 30 seconds** — logging
them out mid-transaction. The fix is the design the file already describes: a scoped
boundary whose `onReset` closes the dialog and returns to the cart, with
`autoRefreshMs` deliberately omitted.

Applied in **both** shells (`d96ffb0b7`), and then to the retail shell's three other
early-return sub-views — `SalesHistoryView`, `TableManagementView`, `StockInquiryView` —
which are the twins of the restaurant ones fixed in round 18 and had the same hole
(`3048b6115`).

**Final coverage: `PosScreen` 8 boundaries, `RetailPosScreen` 4; the guard lists 14
surfaces and asserts `>= 14`.**

### Round 20 — F9's last gap was the surface UNDER the panels

Rounds 18-19 fixed the crash isolation of PosScreen's seven panels. This round checked
what is underneath them, and found the largest hole of the set:

**`<RestaurantMenu>` has no boundary in PosScreen** (`PosScreen.tsx:1224`). Only the
sidebar INSIDE it was wrapped, so a throw in any of the menu's own children propagated
out of `RestaurantMenu`, past `PosScreen`, and unmounted the POS screen — mid-service,
with the cart in memory. The panels got boundaries; the surface they sit on did not.

Two children are on the money path and are now wrapped in `RestaurantMenu`:

| Child | Why |
|---|---|
| `<MenuItemGrid>` | the whole ordering surface — the rows the cashier taps |
| `<ItemModifierModal>` | where an item's options and price are chosen |

Both carry `resetKeys`, so a caught error clears when the input changes: the grid on
the filtered-item count and category, the dialog on the product's `sku`. A bad row
costs the grid until the list changes, not the whole shift.

The remaining menu children were deliberately left alone — `MenuSearchBar`,
`MenuCategoryTabBar`, `MenuPreferencesMenu` — because they render no product data and
no money dialog. Wrapping every child would be noise, and a guard list that is mostly
ceremony stops being read.

**The guard now covers nine surfaces, and asserts `>= 9`.** Its list was short of the
thing it guards twice now (four of seven in round 18, then seven of nine here), which is
the failure mode worth naming: a drift guard that enumerates its own targets cannot
notice a target missing from the enumeration. Both new cases are kill-tested.

`736e57262`.

### Round 19 — two gates left red at HEAD, fixed

Rounds 17 and 18 both ended with the full suite at **2 failed**, and both times I
attributed them to another lane's in-flight `CartPanel` work. By round 19 that work had
**landed** (`ec1c50336`, the animated order-type slider) — so the two failures were no
longer in-flight edits. They were breakage **at HEAD that nobody owned**, and a gate
that stays red is a gate people learn to ignore.

Both named the same new surface, `.pos-cart-order-type`:

| Gate | What it wanted |
|---|---|
| `touchTargetSizing` | `.pos-cart-order-type-btn` (min-height 2rem = 32px) is a real below-floor tablet control; add it to `KNOWN_VIOLATIONS` with a reason, or fix it |
| `noiseDitherCompliance` | `.pos-cart-order-type-indicator` declares `box-shadow: var(--shadow-sm)`, so it needs a `::after` entry in the noise-dither block **plus** parity in the high-contrast and reduced-motion blocks, **plus** a `KNOWN_NOISE_SELECTORS` entry — the test's own message says those halves are a pair |

**I fixed the gate, not the button's design.** The 32px height is that slice's call, so
it went into the ratchet with its reason (14 entries, previously 13) exactly as the
sibling KDS entries document. The dither overlay is a rendering fix, so that one I
applied: selector added next to the other restaurant-cart surfaces, with the
absolute-positioning reason recorded — the `.noise-dither` relative utility would fight
its anchoring.

**Full suite is green again: 679 files / 11403 passed.** `c66e7a3e1`.

### Round 18 — the F9 gap was THREE sub-screens, not two

Checking the sidebar's entry points end-to-end turned up the real shape of F9's
remaining gap. `PosScreen` has **seven** early-return sub-screens; the crash-isolation
guard I wrote for P4 listed **four**, all of them settings screens. Three had no
boundary at all:

| Sub-screen | Reached from |
|---|---|
| `TableManagementScreen` | sidebar, mid-service |
| `SalesHistoryScreen` | sidebar, mid-service |
| `ProductLookupScreen` (stock inquiry) | sidebar, mid-service |

A throw in any of them took the **whole POS screen** down mid-service, with the
cashier's cart in memory and no recovery. All three now carry a
`LocalizedErrorBoundary` whose `onReset` returns to the sale (`99d757146`, `e4e99c7b2`).

**The interesting failure is the guard, not the bug.** It reported clean for a year of
rounds because its LIST was short of the thing it guards — a guard that enumerates its
own targets cannot notice a target missing from the enumeration. It now covers all
seven, with the count asserted (`>= 7`) and a comment saying why that number is seven.
Each new case is kill-tested: deleting the wrapper fails with
`PosScreen.tsx: /<TableManagementScreen\b/ is NOT inside a <LocalizedErrorBoundary>`.

`PosScreen.tsx` now holds 7 boundaries, one per sub-screen, each resetting to its own
flag.

### Round 17 — three untyped literals on the money path, now typed

**`bill_type` was `string` in both directions, and neither end checks it.** The UI
writes it in two production sites (`PaymentModal.tsx:1028`, `usePosHeldCarts.ts:188`)
and the bridge compares it with `==` against `BILL_TYPE_OPEN_BILL`
(`crates/kasirmu-bridge/src/pos/hold_orders.rs:25`, used at
`apps/mobile-tauri/src/commands/pos.rs:897`). But:

- the UI field was `bill_type?: string` / `bill_type: string` (`api/sales.ts`), so a
  typo compiled clean;
- the column is `TEXT NOT NULL DEFAULT 'hold'` with **no CHECK constraint**
  (`migrations/20260813_init.sql:166`), so it stored clean;
- and the comparison is a plain string `==`, so it then matched nothing.

So `'openbill'` would have fallen through the restaurant-only gate and parked a plain
`hold` instead of an open bill — no error anywhere. Now a `BillType` union
(`'hold' | 'open_bill' | 'credit' | 'pay_later' | 'other'`). Kill-tested: the typo fails
`tsc` with `Type '"openbill"' is not assignable to type 'BillType'. Did you mean
'"open_bill"'?`. The union also caught **two test fixtures** that were passing untyped
strings (`b4520f11d`).

**The interaction storage keys were each written twice.** `utils/interaction.ts` had
`'pos.interaction_sound'` and `'pos.interaction_vibration'` as LITERALS in both the
getter and the setter, twenty lines apart. A typo in either half breaks the round-trip
silently, and the failure direction is the bad one: `isInteractionSoundEnabled` defaults
to `true`, so a mistyped SETTER leaves sound on whatever the operator chose. Extracted
to exported constants; `interaction-real.test.ts` pins the constants against the
literals (a test that used one value for both would stay green while every device's
saved preference was orphaned). Kill-tested with a renamed constant (`066c0dd4a`).

### Round 16 — a third copy of the settings key list, removed

While checking the sidebar Settings screen I compared three places that each name the
same ten `restaurant.*` keys and found the model spec (`restaurantSettingsModel.ts:73-82`)
and the write object (`:294-303`) in step — but a **third hand-maintained copy** in the
`markSettingsUpdated` broadcast (`:334-345`).

That copy is the one that fails silently: add a setting to the model and the broadcast
stays at ten, so every other mounted surface keeps its stale value while the screen
reports the save succeeded. It is now derived —
`RESTAURANT_SETTING_SPECS.map((s) => s.key)` — and the save test asserts the broadcast
equals the spec list rather than the ten literals, so a new setting flows through
automatically. Kill-tested: a hand-typed two-entry list fails it with
`expected "vi.fn()" to be called with arguments: [ [ …(10) ] ]` (`0a5cfaa47`).

### Round 16 — negative results, recorded (the payment popup resists the classes I know)

I swept the payment popup and the sidebar-settings save path for the classes that have
produced real bugs elsewhere in this plan, and **found no new defect in them**. That is
a result worth recording, because the alternative is a future round re-investigating
the same surfaces.

| Surface | Class checked | Result |
|---|---|---|
| `PaymentModal.tsx` | unread state flags | 0 |
| `PaymentModal.tsx` + `payment/` | latched disabled flags | 0 |
| `PaymentModal.tsx` + `payment/` | direct F4 (`catch` seeds a baseline) | 0 |
| `PaymentModal.tsx` + `payment/` | hardcoded a11y strings | 0 |
| restaurant feature | permanently-inert controls | 0 |
| `RestaurantSettingsScreen` | pre-await state/localStorage writes | 0 — writes AFTER the await (P3/F5) |
| `useSplitTenderState.ts` | row-invariant violations | 0 — floor and monotonic ids enforced inline |
| `useLocalPaymentRails.ts` | fail-open contract | correct, and documented by contract |

**The one hypothesis that looked like a real double-charge, and was not.** The error
banner's Retry is a RAW `<button>` (`PaymentModal.tsx:2059`), not the shared `<Button>`,
so it inherits none of that component's `loading`-disable behaviour — and `complete()`
(`:991`) opens with `setProcessing(true)` and **never re-checks `processing`**. That
reads exactly like a double-settle window: `startSaleScoped` + `complete_sale` twice for
one basket.

It is already covered, and deliberately. `PaymentModalEdgeCases.test.tsx:403` pins it:
`setPaymentError(null)` in the same handler unmounts the `{paymentError && ...}` block
that owns the Retry node, so a second click has nothing to land on. I ran it — exactly
two `complete_sale_scoped` calls, first fail then success. The comment there states the
kill-test result (deleting `setPaymentError(null)` yields three calls). **I did not
"fix" it.**

Also checked: there is no Enter-submit path (`onKeyDown` appears once, for Escape in the
customer search), so the keyboard cannot reach a second `complete()` either.

### Round 15 — a HEAD-level gate regression fixed, and a divergence pinned

**A commit landed while I worked that turned two gates red, and neither was mine.**
`a8c726fe9` moved PaymentModal's raw error read into the shared `rejectionText()`
helper — a good change — but did not carry `errorPolicyCompliance.test.ts`, so:

- the whitelist entry whose anchor was the old expression no longer matched anything,
  failing the sanity case that requires every entry to FIRE;
- and it kept a stale line number in the map the leak case consults.

Fixed by deleting the obsolete entry, with the reasoning recorded in place of it
(`67b5abd11`). `SCAN_DIRS` omits `utils`, so the new helper home is not a scan target —
which is why deleting the entry loses no coverage.

**Then the leak case still failed, on a COMMENT.** `errorPolicyCompliance` matches raw
read patterns line-by-line and does **not** strip comments, so a comment quoting the old
buggy expression is reported as a leak site. It caught my own explanatory comment
**twice** — including the note explaining the first occurrence. Both are now described
rather than quoted. Worth naming as a checker blind spot: the rule cannot tell code
from prose about code.



**Finding: `open_bill` and `credit` are modelled as rails on one surface and as fixed
markup on the other.**

- The POPUP (`PaymentModal.tsx:1910`, `:1934`) renders `open_bill` on `isRestaurantPos`
  alone and `credit` unconditionally. **Neither consults `railOffered`** — they are not
  in `TENDER_RAILS`, so no rail `is_enabled` flag can remove them.
- The SETTINGS screen's in-flight change removes both from its `internalHiddenCodes`
  list, so they become ordinary cards **with an enable toggle each**.

So an operator can switch off a rail that the charge modal keeps offering. That is the
same class as the `midtrans isActive` disagreement being fixed in that same file —
except here the two sides are the popup and the settings screen, and the popup is MINE
to change.

**I did NOT change the gating, deliberately.** Making the popup honour the flag would
HIDE a tender for any site whose `open_bill`/`credit` rail row is absent or disabled —
a behaviour change on the cashier's last step, and `visibleMethods` is fail-open by
contract for exactly that reason. Which direction is correct is a product question
(with the file that defines the intent still uncommitted), so this round pins today's
behaviour instead of guessing.

**The pin is a real test, not a comment:** `useLocalPaymentRails.test.ts` asserts that a
DISABLED `open_bill`/`credit` rail still yields `['cash','card','credit']`. Kill-tested
— making `credit` rail-gated fails it with `expected [ 'cash', 'card' ] to include
'credit'`. When the two surfaces are reconciled, that test must be edited on purpose.

### Round 14 — the goal widened to the PAYMENT POPUP, and two money-path findings

**I also fixed a HEAD-level regression that was not mine.** A full-suite run failed
two tests on the key `__MOCK_FAIL`, introduced by another lane's `5f3ffeaa2`
(`test(dev-mock): add window.__MOCK_FAIL ...`). `storageKeyPins.test.ts` pins every
localStorage key the UI declares, and the new one had no entry — the guard's own
failure message says exactly what to do, so I added the pin with a reason
(`0b834156f`). Two failures, one cause; the suite went back to green at
**679 files / 11397 passed**.

**The goal was re-scoped to name the payment popup explicitly.** Note the payments
SCREEN (`RestaurantPaymentsScreen`) is still another lane's dirty file and was NOT
touched; the POPUP is `ui/src/features/sales/PaymentModal.tsx`, shared by restaurant
POS (`PosScreen.tsx:1269`) and retail, and it is clean.

I ran my four established detectors over the payment surface (18 files): unread state
flags 0, latched flags 0, direct F4 0, and the swallowed-failure scan surfaced 12
candidates. Two were real:

**(1) `usePosHeldCarts.ts:172` — a swallowed delete created duplicate open bills.**
`deleteHeldCartScoped(...).catch(() => {})` throws away the failure, then the code
runs `holdCartScoped` and toasts "Tab for X updated". The DELETE is exactly what
prevents a duplicate record, so swallowing it produced the duplicate the adjacent
comment claims to prevent — and the cashier was told the tab was UPDATED when a
second one was created. Fixed by letting the rejection abort (`50f7a5c69`); the
caller's existing catch turns it into an error toast.

**(2) `PaymentModal.tsx:1218` — a silent loyalty money leak.** The redemption is a
SEPARATE IPC from sale completion. The customer's total was already reduced by
`loyaltyDiscount`, so a rejected redemption gives away the discount while leaving the
points in the account — and the catch was empty. Now a warning toast matching the
adjacent KDS pattern (`25c249521`).

**Everything else in that scan was correctly swallowed and left alone:** the
receipt/KDS/loyalty toast paths all fire AFTER the sale is committed, where blocking
would be worse than warning; `PosScreen.tsx:432` falls through to a currency chain;
`:942` is a best-effort advisory table mark; `useBarcodeScanner.ts:75` is cleanup.
Reading each before changing it is the whole job — 10 of 12 were right.

⚠️ **The first version of the loyalty test did not fail for the reason I expected.**
It found no "Use Points" button, then found the button but never fired the redemption.
Root cause: I mocked `getPointsValue` as `{ minor_units, currency }`, but it resolves
a PLAIN NUMBER (`api/loyalty.ts:111`) that the modal `BigInt()`s directly
(`:562`). The object threw inside a `.catch(() => {})` and the discount stayed `0n` —
the redemption never fired, and the test would have passed for the wrong reason had I
asserted only absence of the warning. Kill-tested after the fix: restoring the silent
swallow fails the case.

**The last unblocked F10 literals are gone (round 13).** A scan of the restaurant
feature for hardcoded user-visible English found 24 a11y/text props and 144 candidate
JSX text nodes; after excluding `<Localized>` ancestors, the only ones outside the
blocked payments screen were:

| Site | Fix |
|---|---|
| `RestaurantReceiptsScreen` two `<img alt="Business logo">` | Already had a key (`restaurant-logo-preview-alt`) used 40 lines below — wired to it |
| `RestaurantMenuEditorScreen` `aria-label="Remove Group"/"Remove option"` | New keys `restaurant-menu-editor-remove-{modifier-group,option}-aria`, en + id |

**The 5 remaining literals in `RestaurantReceiptsScreen:1430-1522` are CORRECT and were
left alone.** They are a live preview of PRINTED RECEIPT output — a sample "TABLE 4",
sample code `01-01-260929-01-000042`, sample date. They mirror what prints, so
localizing them would be wrong: a receipt does not change language with the operator's
UI locale. Distinguishing "hardcoded English" from "sample data that must not
translate" is the judgement this sweep needed, and a naive scan would have flagged
them as debt.

Both new tests assert the accessible NAME against the bundle value, not a literal —
a literal assertion would keep passing after a revert to a literal. Kill-tested: both
fail when the literal is restored.

**F4 RECURRED in the same file — fixed 2026-10-09.** `RestaurantReceiptsScreen`
seeds its state and `originalsRef` from localStorage/context BEFORE the
`getUserPreferencesScoped` read resolves, and that read ended in
`.catch(() => { /* Fall back gracefully */ })` (`:463-465`). A rejected read
therefore left `dirty` false and the screen looking saved — with Save enabled over
values that were never confirmed, the exact F4 loss. Now: `loadFailed` disables
Save, the header stops claiming "All changes saved", and a banner with Retry
clears the one-shot init ref and re-runs the effect.

⚠️ **F4 and F5 are both recurring in this file, which is the real finding.** They
were filed as specific sites; each has now been found again somewhere new. F5 got a
static guard (round 5). F4 does NOT yet have one — it has been fixed in three
places by hand (`RestaurantSettingsScreen`, `WorkspaceRestaurantPosSettings`,
`RestaurantReceiptsScreen`) and the next file will be found the same slow way.
**A guard for the F4 shape is now BUILT** — `ui/src/__tests__/loadFailureSeedsBaseline.test.ts`
(round 7). It scans production source for a `.catch(...)` handler whose body assigns
`originalsRef`, and asserts there are none.

**⚠️ Its scope is PARTIAL, and that is stated in the file because a partial guard
read as a total one is worse than none.** It catches the **direct** spelling — the
catch itself seeds the baseline. That covers 3 of the 6 historical instances
(`WorkspaceKdsSettings`, `WorkspaceInventorySettings`, `WorkspaceRestaurantPosSettings`).
It does **not** catch the **indirect** spelling, where `.catch(() => null)` feeds a
default that seeds the baseline further down; that needs dataflow analysis.
`RestaurantSettingsScreen`, `RestaurantReceiptsScreen` and the still-open
`RestaurantPaymentsScreen:454-455` are indirect. **A green run means "no direct
re-introduction", not "F4 is impossible".**

The detector is self-tested (4 shape cases) **and kill-tested** against a
reintroduced bug, which fails it with
`features\settings\workspace-cards\WorkspaceInventorySettings.tsx:87`. The
self-tests alone were not sufficient — two earlier guards in this repo passed theirs
while being wrong.

**A SECOND guard covers spelling 3** (round 8):
`ui/src/__tests__/baselineLoadSignal.test.ts` asserts every file that seeds an
`originalsRef` baseline MENTIONS a load-failure signal (`loadFailed` /
`hasPartialError`). It is a floor, not a proof — it cannot tell whether the signal
is wired to the Save gate, which each file's own test does.

Its exemption list is narrow, dated and reasoned, and it has a **stale-exemption
case**: if an exempted file gains a signal, the guard FAILS until the entry is
deleted. That is what stops the list quietly outliving the condition it records —
the failure mode `scripts/ipc-parity-allowlist.json` documents. One entry today:
`RestaurantPaymentsScreen.tsx`, blocked on another lane's uncommitted change.

**THE ROOT, found in round 8: `useTerminalHardware` itself.** Every hardware-seeded
baseline traces back to this hook, whose load catch
(`ui/src/hooks/useTerminalHardware.ts:246-249`) substituted
`createDefaultProfile(...)` silently. So `profile` was a DEFAULT after a failed read,
and five consumer surfaces seeded their dirty baseline from it. `TerminalPreferencesCard`
was the visible one — it had NO load signal at all.

Fixed at the source: the hook now returns `loadFailed`, set in that catch. Four
consumers gate Save on it (`TerminalPreferencesCard`, `RestaurantReceiptsScreen`,
`WorkspaceRestaurantPosSettings`, `WorkspaceStorePosSettings`). This is the first fix
in the whole F4 campaign that closes a whole dimension at once rather than one file.

**⚠️ ROUND-8'S OWN FIX INTRODUCED A LATCH, caught and fixed in round 9.** Gating
Save on `loadFailed` is only safe if the flag can be CLEARED. Nothing in those four
consumers called `hw.reload()`, and `hw.loadFailed` is not reset by `save()` either —
so a single transient read failure disabled Save for the **rest of the session**,
with no way back. The three banners now carry a Retry control (and
`WorkspaceRestaurantPosSettings` gained the `reloadNonce` its effect needed to
bypass the once-per-session latch).

**The lesson is about the shape of a guard, not the bug:** a flag that disables a
control must ship with its RE-ENABLE path in the same change. I added four
Save-gates and zero recovery affordances, and no test noticed because every test
asserted the disabled state. The new assertion checks the Retry control EXISTS.

**The latch was not only in round 8's files.** The same audit found it in the two
round-6 cards: `WorkspaceKdsSettings` and `WorkspaceInventorySettings` both gained
`loadFailed` with no way to clear it. Both now have `reloadNonce` (bypassing their
once-per-session latch) and a Retry control.

**THE LATCH CLASS EXTENDS BEYOND SETTINGS (round 10).** Applying the same scan to
the whole UI found it in `app/UpdateBanner.tsx`: `versionBlocked` was set when the
running build was below the update's `min_version` and **never cleared**, while its
render branch (`:242`) returns BEFORE the `updateAvailable` check (`:276`). So one
probe reporting an incompatible release replaced the update banner for the REST OF
THE SESSION, even after a later probe reported a compatible one. There was **no test
for the shipped banner at all** — `UpdateBanner.test.tsx` imports the DEAD
`components/UpdateBanner` twin (only its own test imports it; the shipped one is
imported by `AppLayout.tsx:5`). Fixed by deriving the flag from its inputs, and
`ui/src/__tests__/appUpdateBanner.test.tsx` now covers the shipped component.

**THE DEAD TWIN IS RETIRED (round 11).** `components/UpdateBanner.tsx` + its CSS +
`UpdateBanner.test.tsx` are DELETED (`f9d6f2e65`, 523 lines). Three greps proved it
reachable from nothing: not exported from `components/index.ts`, its only importer was
its own test, and the shipped banner is `app/UpdateBanner.tsx` (`AppLayout.tsx:5`).
The journal had already scoped this retirement; round 11 did it.

**The part worth remembering is not the dead code — it is the test.**
`UpdateBanner.test.tsx` had 7 passing tests for a component no user can reach, while
the SHIPPED banner had none. A green suite covering unreachable code is worse than no
test: it reports safety it does not have. That is the same false-confidence shape as
the vacuous tests caught in rounds 3-9, one level up — the assertions were fine, the
SUBJECT was wrong.

Two compliance baselines listed the deleted sheet and were updated in the same commit;
both still pass. All FTL keys the twin used are still consumed by the shipped banner,
so no keys were orphaned. The stale doc reference in
`docs/decisions/2026-07-16-desktop-app-updater.md` was corrected separately
(`3f4422c20`).

**A DEAD DISMISS BUTTON, found by retiring the dead twin (round 12).** Reading the
shipped banner to retire its twin surfaced a real defect: the version-blocked branch
(`app/UpdateBanner.tsx:254`) returns BEFORE the `dismissed` check on Priority 3 and
did not test `dismissed` itself — so its own Dismiss button set state nothing read.
**A control that silently does nothing.** The dead twin's copy of the same button
routed through `useExitAnimation` and therefore worked, which is how the shipped one
hid. Fixed at `f80207d66`; pinned by a test that failed first.

**The scan also found `_refundsLoading`** (`SalesHistoryScreen.tsx:242`): set
true/false around a refunds read and never read, costing two re-renders per load.
Removed at `8f684d387`.

**⚠️ The guard for this class is the WEAKEST of the four, and I measured that.**
`ui/src/__tests__/unreadStateFlag.test.ts` flags a `useState(false)` flag that is set
and never MENTIONED. Kill-testing showed it does **NOT** catch the UpdateBanner bug
that motivated it: reverting `versionBlocked && !dismissed` leaves it GREEN, because
`dismissed` is still read at the Priority-3 gate further down. The defect was that one
BRANCH returned before that read — distinguishing "read somewhere" from "read on the
path that matters" needs control flow, not a mention count.

It DOES catch `_refundsLoading` (verified by reintroducing it). Its first version did
not: the detector counted mentions inside COMMENTS, and my own removal comment named
the flag. That is recorded in the file, along with the fact that the UpdateBanner
regression is pinned only by its own behavioural test.

**A guard for the whole class** (round 10): `ui/src/__tests__/disabledFlagLatch.test.ts`
asserts no production flag that gates a `disabled` prop is only ever set to `true`.
Its detector reads the ARGUMENT, not the call count — counting calls flagged
`versionBlocked` immediately after it was fixed, because a DERIVED call
(`setVersionBlocked(blocked)`) can clear. That false positive is pinned by a
self-test.

**Audit result — all six `loadFailed` sites now have a recovery path:**

| File | Recovery |
|---|---|
| `RestaurantSettingsScreen` | Retry + `reloadNonce` (round 2) |
| `RestaurantReceiptsScreen` | Retry + `reloadNonce` (round 6) |
| `WorkspaceRestaurantPosSettings` | Retry + `reloadNonce` (round 9) |
| `WorkspaceStorePosSettings` | Retry → `refetch()` + `hw.reload()` (round 9) |
| `WorkspaceKdsSettings` | Retry + `reloadNonce` (round 9) |
| `WorkspaceInventorySettings` | Retry + `reloadNonce` (round 9) |
| `TerminalPreferencesCard` | Retry → `hw.reload()` (round 9) |

**A SEVENTH INSTANCE, and a different shape (round 7):** `WorkspaceStorePosSettings`
seeds its baseline from `settings.receipt` — the CONTEXT, not a per-key read — and
consumed `useSettings()` without ever reading `hasPartialError`. A partially-failed
context load leaves `settings.receipt` at DEFAULTS, so the card seeded a default
baseline, looked clean, and would have written those defaults over the real values.
Now gated on `hasPartialError` (which the context already exposed at
`SettingsContext.tsx:126`) plus a banner.

**⚠️ This shape is why the new guard does not catch everything.** It is neither a
`.catch` assignment nor an indirect default — it is an unconsumed error FLAG on a
context. Three distinct spellings of one bug now exist across seven sites, which is
the honest argument for treating F4 as a class to review rather than a list to close.

**TWO MORE F4 INSTANCES FOUND AND FIXED (round 6)**, by scanning all 8 files that
use `originalsRef` against the 3 that had `loadFailed`:

| File | The catch |
|---|---|
| `WorkspaceKdsSettings.tsx:121-123` | seeded `originalsRef` from `DEFAULT_KDS` |
| `WorkspaceInventorySettings.tsx:82-83` | seeded `{ lowStockThreshold: 10, deductionPreferWarehouse: false }` |

Both now set `loadFailed`, which disables Save. `TerminalPreferencesCard.tsx:70`
was checked and is a **false positive**: its catch populates an EDC dropdown, and
its `originalsRef` is seeded separately from `hw.profile` at `:88`.

`RestaurantPaymentsScreen.tsx:454-455` is a **real instance still open** — it
`.catch(() => null)`s two gateway reads whose results seed the drafts baseline. It
is blocked on another lane's uncommitted change to that file.

**The recurring-test lesson, again.** My first version of both new tests asserted
only "Save is disabled after a failed read" — and **passed against the bug**,
because on the buggy path `dirty` is already false so Save is disabled either way.
The discriminating property is the EDIT: on the bug, editing afterwards sets
`dirty` true and re-enables Save. Both tests now edit after the failure and both
fail against a reintroduced bug.

**Still open:** `RestaurantPaymentsScreen` (10 `aria-label`s). ⚠️ That file is
currently DIRTY with another lane's uncommitted change, so editing it would sweep
their work into this lane's commit (AGENTS.md §7.3). It must wait until the file is
clean — this is a coordination constraint, not a technical one.

### P7 — Parity verification (closes F12) — ✅ DONE 2026-10-09

**Acceptance met.** `python scripts/verify-ipc-parity.py` exits 0 (`IPC parity:
OK`) after P1–P6, and `scripts/ipc-parity-allowlist.json` is **unmodified** —
`git diff --stat` on it is empty. No entry was added to silence a hit, which is
the whole point of the phase.

The seven settings commands this lane touched (`get_setting_scoped`,
`set_settings_scoped`, `get_receipt_settings_scoped`, …) were already registered on
both shells, so no wiring change was needed and none was made.

### P8 — Duplicate-module hygiene (F13) — ✅ CLOSED 2026-10-09 as a NO-OP

The three greps AGENTS.md §6.3 prescribes showed the pair is not a duplicate:
`screens/DataManagementScreen.tsx` **composes** the feature screen
(`import DataManagementBody from '../DataManagementScreen'`, `:24`) — the
documented settings-hub pattern — and `sections/AppearanceSection.tsx` is already
marked DEAD with a dated header and is intentionally left in place.

**No code change.** The finding was a misread on my part; see F13 for the evidence.
This is the one phase whose correct output is a correction rather than a diff.

---

## 4. Decisions — D1-D4 SETTLED 2026-10-09; **D5-D6 OPEN**

D1-D4 are decided, and each answer records the evidence that decided it, not just the
choice, so a later reader can re-derive it.

⚠️ **THE HEADING USED TO READ "All four open questions are decided", WHICH IS NO LONGER
TRUE.** Rounds 27-35 produced two more, both about the same thing — controls that cannot
affect what they claim to — and they are recorded below as D5/D6 rather than left to be
re-discovered from the round log.

### D5 — PARTLY RESOLVED: Hold Order DELETED (round 42); two remain open

**`restaurant.hold_order` and its toggle are GONE** (`df86bf0b3`). Removed rather than
wired, on the same reasoning as `table_number` (option C): the key had zero readers while
its own description promised *"Allow cashier to park or temporarily hold in-progress
orders"* — and restaurant POS already parks carts, as `open_bill` ("Save Tab", the toggle
immediately below it). Wiring it would have meant inventing a second park concept beside
`save_tab`, so the control offered a duplicate name for a capability that exists.

Removed across all seven places it lived: the `SettingRow`, the `useState`, the load
setter, the dirty check, `originalsRef`, both dependency arrays, the save payload, the
model's interface/default/spec table, and the orphaned copy in BOTH locales
(`products.ftl`, `products.id.ftl` — 2 lines each).

**The guard caught the removal, which is what it is for:** `deadSettingsKey.test.ts`'s
written-key floor failed with `expected 9 to be greater than or equal to 10`. The floor was
lowered deliberately, with the reason inline — *drop it when a key is DELETED, never when
one stops being written silently.* Its `DECLARED_DEAD` entry was removed too, and the
sibling tests that used `hold_order` as a fixture key now use the live `save_tab`.

A removal assertion replaces the old presence check
(`expect(queryByTestId('setting-toggle-hold-order')).toBeNull()`), matching how the
`table-number` removal is already pinned one line above.

**Still open in D5** — the other two, unchanged:

| Toggle | Key | What wiring it would need |
|---|---|---|
| Auto-Print KOT | `restaurant.auto_print_kitchen` | a POS-side KOT send on save/hold. `print_kds_chit_scoped` and `createKdsOrderFromSaleScoped` EXIST, so this is a call-site addition. |
| Order Sound Notifications | `restaurant.sound_chime` | an order-sent chime in the POS. `useSound().playBeep()` exists but is KDS-only. |

_(The table that used to live under this heading is now this one.)_

| Toggle | Key | What wiring it would need |
|---|---|---|
| Hold Order | `restaurant.hold_order` | a restaurant-side park action. The only `bill_type: 'hold'` in the UI is retail (`RetailPosScreen.tsx:1282`); restaurant POS parks as `open_bill`, which `save_tab` covers. **Delete is the recommendation.** |
| Auto-Print KOT | `restaurant.auto_print_kitchen` | a POS-side KOT send on save/hold. `print_kds_chit_scoped` and `createKdsOrderFromSaleScoped` EXIST, so this is a call-site addition, not new plumbing. |
| Order Sound Notifications | `restaurant.sound_chime` | an order-sent chime in the POS. `useSound().playBeep()` exists but is KDS-only. |

Each toggle renders a description promising behaviour the app does not deliver. Pinned as
declared-dead in `__tests__/deadSettingsKey.test.ts`, so a fourth cannot appear silently.

### D6 — OPEN: receipt toggles the printer cannot honour (rounds 33-35)

`ReceiptConfig` (`crates/kasirmu-hal/src/drivers/receipt.rs:98-117`) has 8 fields;
**6 of the receipts screen's 12 toggles have none** — `showReceiptCode`, `showDateTime`,
`showStaffName`, `showItemNotes`, `showDecimals`, `showThousandsSeparator`.

Two sub-cases, because they are not the same:

- `showReceiptCode` / `showDateTime` / `showItemNotes`: the printer renders those lines
  UNCONDITIONALLY (`:467`, `:468`, `:522`), so switching the toggle off hides them from the
  preview while the paper keeps them.
- `showStaffName`: the printer has **no staff field at all** (grepping the renderer for
  `staff|cashier` returns nothing), so the preview line can never appear on paper.
- `showDecimals`: inert for exp-0 currencies by construction — fixed so the preview stops
  claiming a `,00` the printer cannot print (round 33).
- `showThousandsSeparator`: the printer has no grouping at all, and
  `currency.thousands_separator` is stored but read by no formatter.

Measured and pinned in `__tests__/receiptPreviewPrintAgreement.test.ts`. The open question
is which side moves — the printer's shape is coherent (it prints what a receipt must carry),
and the toggles are per-user cosmetic preferences.

### D1 — Collapse to `receipt.showTableNumber`; RESOLVED by option C

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

**Resolved: option C was implemented** (`2c28d90bc`). The sidebar table-number
toggle is gone; table capture is unconditional on restaurant POS and the only
table-number control is the PRINT toggle in `RestaurantReceiptsScreen`. The options
that were weighed, kept for the record:

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
| 2026-10-09 | P4 | `cd ui && npx vitest run restaurantPosCrashIsolation -t sidebar` (kill-test) | **FAIL (killed)** | removing the wrapper fails with "is NOT inside a `<LocalizedErrorBoundary>`"; restored, passes |
| 2026-10-09 | P4 | `cd ui && npx vitest run Restaurant PosScreen CartPanel restaurantPosCrashIsolation` | exit 0 | **28 files, 525 passed / 1 skipped** |
| 2026-10-09 | P1 | `cd ui && npx vitest run CartPanel PosScreen Restaurant` | exit 0 | **28 files, 529 passed / 1 skipped** |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite) | exit 0 | **673 files, 11346 passed / 24 skipped / 3 todo** |
| 2026-10-09 | P1 | `cd ui && npx vitest run CartPanel CartActionBar PosScreen Restaurant` | exit 0 | **29 files, 540 passed / 1 skipped** |
| 2026-10-09 | P4/F7 | `cd ui && npx vitest run RestaurantSidebar` | exit 0 | **2 files, 32 passed** |
| 2026-10-09 | P4/F8 | `cd ui && npx vitest run RestaurantSidebar -t 'lacks settings:edit'` (kill-test) | **FAIL (killed)** | role-only gating fails the case; restored, passes |
| 2026-10-09 | P4/F8 | `cd ui && npx vitest run Restaurant PosScreen CartPanel` | exit 0 | **28 files, 537 passed / 1 skipped** |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 3) | exit 0 | **673 files, 11354 passed / 24 skipped / 3 todo** |
| 2026-10-09 | all | `python scripts/verify-ipc-parity.py` (round 3) | exit 0 | IPC parity: OK |
| 2026-10-09 | P6 | `python scripts/verify-bundle-parity.py` | exit 0 | **0 missing keys**; en 5255 / id 5311 after +17 and +2 |
| 2026-10-09 | P6 | `cd ui && npx vitest run RestaurantSettingsScreen` | exit 0 | **11 passed**, incl. the bundle-value assertion |
| 2026-10-09 | P6 | `cd ui && npx vitest run RestaurantReceiptsScreen` | exit 0 | **35 passed** |
| 2026-10-09 | P6 | `cd ui && npx eslint <changed files>` | exit 0 | 0 errors |
| 2026-10-09 | P7 | `python scripts/verify-ipc-parity.py` + `git diff --stat scripts/ipc-parity-allowlist.json` | exit 0 | parity OK; allowlist **unchanged** (empty diff) |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 4) | exit 0 | **673 files, 11355 passed / 24 skipped / 3 todo** |
| 2026-10-09 | P6/F5 | `cd ui && npx vitest run RestaurantReceiptsScreen -t 'save is rejected'` (kill-test) | **first version PASSED against the bug** | vacuous test caught; rewritten, then fails on the bug as required |
| 2026-10-09 | P6/F5 | `cd ui && npx vitest run RestaurantReceiptsScreen` | exit 0 | **36 passed** |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 4 final) | exit 0 | **673 files, 11356 passed / 24 skipped / 3 todo** |
| 2026-10-09 | all | `python scripts/verify-ipc-parity.py` (round 4 final) | exit 0 | IPC parity: OK |
| 2026-10-09 | F5 guard | two ad-hoc scans (`node .f5detect.cjs`, brace-depth variant) | 0 sites | detector validated against a synthetic fixture FIRST |
| 2026-10-09 | F5 guard | `cd ui && npx vitest run mirrorBeforeAwait` (kill-test, 3 attempts) | **versions 1-4 wrong** | v1/v2 passed on the bug; v3 false-positived; v4 missed it. v5 correct on both |
| 2026-10-09 | F5 guard | `cd ui && npx vitest run mirrorBeforeAwait` | exit 0 | **7 tests passed**; 0 offenders across `ui/src` |
| 2026-10-09 | F5 guard | `cd ui && npx vitest run mirrorBeforeAwait RestaurantReceiptsScreen RestaurantSettingsScreen` | exit 0 | **3 files, 54 passed** |
| 2026-10-09 | F5 guard | `git diff --stat RestaurantReceiptsScreen.tsx` after the kill-test | empty | file byte-identical to committed state |
| 2026-10-09 | F4 | `cd ui && npx vitest run RestaurantReceiptsScreen -t 'FAILS'` (kill-test) | **FAIL (killed)** | reverting the catch to a silent fallback fails the case; restored |
| 2026-10-09 | F4 | `cd ui && npx vitest run RestaurantReceiptsScreen RestaurantSettingsScreen mirrorBeforeAwait` | exit 0 | **3 files, 56 passed** |
| 2026-10-09 | F4 audit | `node .f4scan.cjs` over all 8 `originalsRef` files | 2 new instances | KDS + inventory; 1 false positive (`TerminalPreferencesCard`) |
| 2026-10-09 | F4 | `cd ui && npx vitest run WorkspaceKdsSettings WorkspaceInventorySettings -t 'read rejects'` (kill-test) | **first version PASSED against the bug** | asserted only "disabled", which is true on the bug too; strengthened to edit-then-assert |
| 2026-10-09 | F4 | `cd ui && npx vitest run WorkspaceKdsSettings WorkspaceInventorySettings -t 'FAILED settings read'` (kill-test, v2) | **2 FAILURES (killed)** | both discriminate after strengthening |
| 2026-10-09 | F4 | `cd ui && npx vitest run Workspace Restaurant Settings` | exit 0 | **66 files, 1085 passed / 22 skipped** |
| 2026-10-09 | F4 guard | `cd ui && npx vitest run loadFailureSeedsBaseline` | exit 0 | **6 tests passed**; 4 detector self-cases |
| 2026-10-09 | F4 guard | `cd ui && npx vitest run loadFailureSeedsBaseline` (kill-test) | **FAIL (killed)** | names `WorkspaceInventorySettings.tsx:87`; restored, passes |
| 2026-10-09 | F4 | `cd ui && npx vitest run WorkspaceStorePosSettings -t 'partial context load'` (kill-test v1) | **PASSED against the bug** | asserted only "disabled" + banner, both true on the bug; strengthened with an edit |
| 2026-10-09 | F4 | same, kill-test v2 | **FAIL (killed)** | discriminates after strengthening |
| 2026-10-09 | F4 | `cd ui && npx vitest run Workspace Settings loadFailureSeedsBaseline mirrorBeforeAwait` | exit 0 | **55 files, 875 passed / 22 skipped** |
| 2026-10-09 | F4 root | `cd ui && npx vitest run TerminalPreferencesCard useTerminalHardware WorkspaceSettings Restaurant Settings` | exit 0 | **52 files, 954 passed / 22 skipped** |
| 2026-10-09 | F4 root | `cd ui && npx vitest run TerminalPreferencesCard -t 'FAILED profile read'` (kill-test) | **FAIL (killed)** | discriminates after adding the edit step |
| 2026-10-09 | F4 guard 2 | `cd ui && npx vitest run baselineLoadSignal` | exit 0 | **3 tests passed** |
| 2026-10-09 | F4 guard 2 | `cd ui && npx vitest run baselineLoadSignal` (kill-test) | **FAIL (killed)** | names `TerminalPreferencesCard.tsx`; restored |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 8 final) | exit 0 | **676 files, 11378 passed / 24 skipped / 3 todo** |
| 2026-10-09 | all | `python scripts/verify-bundle-parity.py` (round 8) | exit 0 | 0 missing keys |
| 2026-10-09 | F4 latch | `cd ui && npx vitest run TerminalPreferencesCard WorkspaceStorePosSettings WorkspaceRestaurantPosSettings` | exit 0 | **4 files, 69 passed** |
| 2026-10-09 | F4 latch | `cd ui && npx vitest run WorkspaceKdsSettings WorkspaceInventorySettings` | exit 0 | **2 files, 29 passed** |
| 2026-10-09 | F4 latch | `cd ui && npx vitest run WorkspaceKdsSettings -t 'FAILED settings read'` (kill-test) | **FAIL (killed)** | removing the Retry control fails with `Unable to find ... retry-btn`; restored |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 9) | exit 0 | **676 files, 11378 passed / 24 skipped / 3 todo** |
| 2026-10-09 | all | `python scripts/verify-ipc-parity.py` + `verify-bundle-parity.py` (round 9) | exit 0 | IPC parity OK; 0 missing keys |
| 2026-10-09 | latch | `cd ui && npx vitest run appUpdateBanner` | exit 0 | **5 tests passed** (shipped banner had none) |
| 2026-10-09 | latch | `cd ui && npx vitest run appUpdateBanner -t 'CLEARS the block'` (kill-test) | **FAIL (killed)** | restored the latch -> test fails; restored fix |
| 2026-10-09 | latch guard | `cd ui && npx vitest run disabledFlagLatch` | exit 0 | **6 tests passed**; 4 detector self-cases |
| 2026-10-09 | latch guard | `cd ui && npx vitest run disabledFlagLatch` (kill-test) | **FAIL (killed)** | names `app/UpdateBanner.tsx :: versionBlocked`; restored |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 10) | exit 0 | **678 files, 11389 passed / 24 skipped / 3 todo** |
| 2026-10-09 | dead twin | `cd ui && npx vitest run focusVisibleCompliance popupBackgroundCompliance` | exit 0 | **2 files, 8 passed** after updating both baselines |
| 2026-10-09 | dead twin | `cd ui && npx vitest run Compliance themeToken popoverSurface noiseDither animationCompliance motionImportantEscapes` | exit 0 | **23 files, 298 passed**; harvest unchanged |
| 2026-10-09 | dead twin | `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` | exit 0 | 0 unresolved refs in 13 live docs |
| 2026-10-09 | dead control | `cd ui && npx vitest run appUpdateBanner -t 'dismisses the version-blocked'` (RED first) | **FAIL, then PASS** | button was a no-op; fixed at `f80207d66` |
| 2026-10-09 | dead control | `cd ui && npx vitest run unreadStateFlag` (kill-test v1) | **PASSED against the bug** | detector counted comment mentions; fixed to strip comments |
| 2026-10-09 | dead control | same, kill-test v2 | **FAIL (killed)** | names `SalesHistoryScreen.tsx :: _refundsLoading` |
| 2026-10-09 | all | `cd ui && npx vitest run` (full suite, round 12) | exit 0 | **678 files, 11389 passed / 24 skipped / 3 todo** |

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
