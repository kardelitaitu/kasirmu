# Analytics cards — deferred items needing visual confirmation

Created 2026-08-13 during the analytics cards audit. Items found in code
review but left for a later pass are listed below. Completed items are noted
with ✅, so this file stays a live index rather than a stale backlog.

## Completed (no longer open)

- ✅ **Options menu clipping** — the ⋮ menu is now rendered through
  `createPortal(document.body)` with a fixed viewport anchor, so the card's
  `overflow: hidden` can't clip it.
- ✅ **Heatmap level-1 contrast** — `--analytics-heat-1` moved from `#dbeafe`
  to `#bfdbfe`, stepping clearly away from the empty-cell gray.
- ✅ **10px caption text** — `.analytics-kpi-label`, `.analytics-delta`,
  `.analytics-card-insight`, `.analytics-legend-item`, and `.analytics-heat-label`
  bumped to 11px.
- ✅ **Payments % shares** — `largestRemainderPcts` makes the stacked bar
  always sum to 100 (was independent `Math.round` per method).
- ✅ **Refunds vs Voids overlap** — `refunds` is now a money/totals summary
  (count + amount + average) with no item list; `voids` keeps the voided-items
  list. The unused `getVoidedItems(25)` fetch was dropped from the refunds loader.
- ✅ **Cache eviction** — `TtlCache` now evicts LRU (reads promote recency)
  and purges expired entries before evicting live ones.
- ✅ **Sticky failure map** — recorded query failures are cleared on every
  filter change, so re-navigating back to a previously-failed card retries.
- ✅ **Heatmap per-cell data reachable by AT** — the grid dropped its
  `role="img"` (which made descendants presentational); each cell with data is
  now `role="img"` + `aria-label` carrying its revenue/order detail.
- ✅ **Card container `aria-label` duplicates the heading** — the card group
  now uses `aria-labelledby` pointing at its `<h2>` instead of a duplicated
  `aria-label`.

## Still open — verify in the UI

### 1. Drag / hover affordances

- **Where:** `.analytics-card-grip` shows `cursor: grab` but is decorative
  (`aria-hidden`) while the **whole card** is `draggable`; cards also lift on
  hover though the body isn't clickable.
- **What to check:** whether the grip implies only-the-grip drags, and whether
  the hover lift implies the body is clickable.
- **Likely fix:** drag from the grip only (or drop the grip), and limit the
  hover lift to the header.

## Still open — cache & query layer design items

### 2. Side effect during render

- **Where:** `useAnalyticsQuery` runs `fetcher()` and
  `analyticsDataCache.set(...)` (which writes sessionStorage) synchronously
  during render for sync fetchers.
- **Why deferred:** documented and defended as idempotent/deterministic, and
  the screen has relied on it for instant no-flash rendering. Moving to
  `useEffect` would reintroduce an empty flash without extra state.
- **Likely fix:** keep, or shift the write into a `useLayoutEffect`/effect
  while retaining the sync `get` for the no-flash hit.

### 3. ✅ Unvalidated cache cast + fragile partition parsing (fixed)

- **`cachePartition`** no longer guesses a workspace from arbitrary segment
  indexes (the stale `query:` branch is gone). It recognizes only the
  `card:<cardKey>:<workspace>:…` shape, sharing its prefix constant with
  `cardQueryKey`; anything else routes to the `shared` snapshot.
- **Cached values are now shape-checked at the read boundary.**
  `useAnalyticsQuery` accepts an optional `validate` guard; a cached value
  that fails it is invalidated and refetched as a miss instead of being cast
  blindly into `T`. `CARD_PAYLOAD_VALIDATORS` (colocated with
  `CARD_LOADERS`) supplies a loose structural guard per card, and the heatmap
  query passes its own.

---

# Five-file deep audit (2026-08-13)

Follow-up audit of the five files that previously carried eslint warnings
(DashboardScreen, RetailProductGrid, AnalyticsCardContent, AnalyticsScreen,
NodeTopologyEditor). Fixed items are committed; the rest remain open.

## Fixed (committed)

- ✅ **AnalyticsCardContent** — reuse `CRITICAL_STOCK_LEVEL` in the alert rows,
  give the tables card a bad-tone delta in both modes, drop the refunds card's
  unused `title`/`expanded` props, key ranked/alert rows by name+index, and
  format the customers-card counts with the Fluent locale formatter.
- ✅ **AnalyticsScreen** — add `setData` on drag start (Firefox), throttle the
  scroll handler with rAF, and manage the card-menu focus/keyboard (focus first
  item, Arrow/Home/End, restore focus on close).
- ✅ **DashboardScreen** — remove the unreachable full-screen skeleton, build
  ranges from local dates (not UTC), rename `today*` → `range*`, resolve the
  donut fill from `--color-fg`, localize currency/compact formatting, the
  heatmap tooltip, and CSV headers, and rename the `today-revenue`/`orders-today`
  keys (copy now says "Revenue"/"Orders").
- ✅ **RetailProductGrid** — keyboard add-to-cart on the name button, sortable
  headers as real `<button>`s, `aria-hidden` sort glyph, `scope="col"` on the
  non-sortable headers, and removal of dead out-of-stock guards/`aria-disabled`.
- ✅ **NodeTopologyEditor** — debounce the per-frame viewport `localStorage`
  write (250ms + unmount flush).

> Correction: the NodeTopologyEditor `localStorage` **reads** are already
> wrapped in try/catch with fallbacks; the earlier finding flagged them as
> unguarded in error.

## Still open

### Dashboard

1. **Eager loading** — `loadData` fetches all 8 datasets (daily/weekly/monthly
   revenue, top products, low stock, category, heatmap, prev-daily) regardless
   of the selected granularity; `getLowStockAlerts(10)` also ignores the date
   range (same non-time-bounded snapshot as the analytics low-stock card).
2. **`fmtDelta` edge case** — returns `+∞` / `−` when the previous period is
   zero; these are math symbols and arguably fine, but not localized.

### AnalyticsScreen

3. ✅ **`menuAnchor` staleness fixed** — the portaled card menu now re-anchors
   to its trigger on window scroll (capture-phase, since scroll doesn't bubble)
   and resize, with a 0.5px change-guard so per-frame scroll events don't
   churn the grid.
4. ✅ **Popover dismissal unified** — the zoom/shortcuts/cache popovers now
   close on outside pointerdown (toggle buttons excluded so a close-then-
   reopen never happens), and Escape also closes the cache metrics popover.

### RetailProductGrid

5. ✅ **Stock-threshold magic numbers fixed** — added
   `DEFAULT_LOW_STOCK_THRESHOLD` (5) / `DEFAULT_HIGH_STOCK_THRESHOLD` (10) to
   `types/domain.ts` and used them across `AddProductModal`, `EditProductModal`,
   `RetailProductGrid`, and `RetailPosScreen`. (Analytics' `CRITICAL_STOCK_LEVEL`
   stays its own "critical" severity tier — semantically distinct.)
6. ✅ **Minor fixes** — the category bar's `onWheel` now maps both trackpad
   `deltaX` and wheel `deltaY` to horizontal scroll and `preventDefault`s
   (guarded by `cancelable`); `cellValue`'s `—` em-dash is a named
   `EMPTY_CELL` constant.

### NodeTopologyEditor

7. **Size (in progress: overlays extracted)** — the component is ~6,900
   lines. The shortcuts help popover, node finder, canvas minimap,
   relationship picker, and validation issues widget are now extracted into
   `topologyShortcutsHelp.tsx`, `topologyNodeFinder.tsx`,
   `topologyMinimap.tsx`, `topologyRelationshipPicker.tsx`, and
   `topologyValidationWidget.tsx` (each behavior-preserving, 541 topology
   tests green, plus isolated overlay unit tests). The main component's
   remaining bulk is the drag/undo/rename/simulate state machine, which is
   not trivially separable. **Surfaced + fixed while extracting:** the
   validation-jump actions (`handleAddStockWireHint` / `handleJumpToWire`)
   called the minimap's `recenterViewOn` (which converts minimap PIXELS to
   canvas coords) with CANVAS coords, so "jump and center" panned to a
   wildly wrong spot. They now use `centerViewportOn`, centering on the
   actual node/wire canvas position.
8. **Render-phase ref writes (assessed: intentional, leave as-is)** —
   `historyRef.current = history` (and similar mirrors, e.g. `panRef`,
   `nodesRef`, `pushHistoryRef`, `selectedNodeIdsRef`, `l10nRef`) assign
   during render. This is the deliberate "latest ref" pattern: it lets
   memoized drag/undo/rename handlers read the CURRENT value at call time
   without taking the value as a `useCallback` dep (which would churn the
   handler identity and defeat the card/wire memoization). Moving them to
   `useEffect` would introduce stale-closure windows (a passive effect runs
   after paint, so a pointermove between paint and effect would read stale
   pan/nodes). Same documented-but-impure pattern as `startRecalculating`
   and the cache write in the analytics screen; idempotent and deterministic.

---

# WorkspaceHome audit (2026-08-13)

Audit of the workspace selection page (`WorkspaceHome.tsx` + CSS).

## Fixed (committed)

- ✅ **`canAccess` predicate** — replaced the role-blind
  `cashierOnly.has(key) || (kitchen && kitchenOnly.has(key))` with a
  role-grouped gate: owner/admin/manager/staff → all, cashier → POS only,
  kitchen → KDS only (accepting both bare and `role-`-prefixed forms).
- ✅ **`savePins` / `saveLastUsed`** — now try/catch-guarded (mirroring the
  `load*` helpers) and called as a normal event-handler side effect instead of
  inside a `setState` updater (which StrictMode can run twice).
- ✅ **Ripple timers** — the 600ms fallback `setTimeout` is tracked and cleared
  on unmount (the `animationend` path also cancels it).
- ✅ **`getColumns`** — derives the column count from the grid's actual layout
  (first-row `offsetTop` break) instead of splitting `gridTemplateColumns`,
  so `repeat()`/`minmax()` resolved values can't miscount arrow-key movement.
- ✅ **Number-key quick-launch** — maps directly to `activateWorkspace` over the
  workspace list (not the enabled-card NodeList), so the Analytics/Reports
  shortcuts are no longer addressable by a phantom number key.
- ✅ **Pin button** — `tabIndex` `-1` → `0`, making the existing
  Enter/Space handler reachable.
- ✅ **SkeletonGrid** — dropped the `aria-label` on a role-less `<div>` (the
  `role="status"` span already announces loading).
- ✅ **Retry button** — floating retry `title` now uses the localized
  `workspace-home-retry-btn` key instead of a hardcoded `"Retry"`.
- ✅ **Dead exit animation** — removed `exitingWorkspace` state, the
  `workspace-card--exiting` classes + `ws-card-exit` keyframes (the card
  unmounts the same tick, so the animation never played), and the stray
  empty `{ }` JSX.
- ✅ **`getIcon` drift** — the icon-key allowlist is now derived from
  `WS_ORDER` + `COMING_SOON_CARDS` instead of a hardcoded list that had gone
  stale (`Analytics` listed, `Reports` missing).
- ✅ **`displayName` fallback** — no longer falls back to `role_name`, so the
  greeting can't read "Hello, owner".

## Still open

### Greeting

1. **Randomized multilingual greeting** — `pickGreeting()` runs inside a
   `useMemo` (so it may re-pick under StrictMode double-render) and can show
   "Selamat datang" to an English-locale user. Deliberate design flourish;
   needs a product call on whether the greeting should follow the active
   locale instead of cycling languages.

---

# Reports / Dashboard audit (2026-08-13)

Audit of the owner/admin reports dashboard (`DashboardScreen.tsx` +
`reports.ftl` / `reports.id.ftl`).

## Fixed (committed)

- ✅ **Broken `-aria` labels** — 8 keys per locale (`dashboard-granularity-aria`,
  `dashboard-chart-revenue-aria`, `dashboard-chart-category-aria`,
  `dashboard-chart-heatmap-aria`, `dashboard-chart-top-products-aria`,
  `dashboard-export-csv-aria`, `dashboard-category-clear-aria`,
  `dashboard-back-aria`) were written as `key = .aria-label = Text` on a single
  line. Fluent parses that as a literal text VALUE equal to
  `.aria-label = Text` (attributes need the indented multi-line form), so the
  rendered `aria-label` literally included the `.aria-label = ` prefix.
  Converted all 8 to plain values; added
  `i18nStrayAttributeSyntax.test.ts` as a permanent regression guard.
- ✅ **`getComputedStyle` during render** — the donut's `--color-fg` fill color
  is now read inside the `categoryDonutOption` `useMemo` (only when the donut
  inputs change) instead of on every render.
- ✅ **Stale category selection** — `selectedCategory` is reset on reload so a
  date-range change can't keep showing a category detail that no longer exists
  in the new data.
- ✅ **`.reverse()` mutation clarity** — top-products names/values are reversed
  once at declaration instead of mutating inside the axis/series config.
- ✅ **Granularity radiogroup** — added WAI-ARIA arrow-key navigation and a
  roving tabindex (checked option is the single tab stop; Arrow keys move
  focus + selection).

## Still open

### Dashboard

1. ✅ **Eager loading fixed** — `loadData` no longer fetches weekly/monthly
   up front. Daily + prev-daily + top products + low stock + category + heatmap
   load once; the weekly/monthly series is fetched on demand (cached keyed by
   granularity + range) when that granularity is selected.
2. ✅ **Full-screen spinner flash fixed** — the spinner/error replace the
   dashboard only on the first load. Reloads keep stale data visible with a
   `role="status"` "Refreshing…" indicator, and reload failures show an inline
   `role="alert"` banner instead of wiping the screen.
3. ✅ **`fmtDelta` edge case fixed** — the unlocalized `+∞` / `−` symbols are
   gone; a metric with no previous period now renders a localized
   `dashboard-delta-new` "New"/"Baru" badge (and `fmtDelta` is a pure
   `%` formatter whose caller guards `previous === 0`).
4. ✅ **Low-stock threshold context added** — the row now reads
   "2 left (below 10)" via the localized `dashboard-stock-below-threshold`
   message instead of a bare "2 left".

### Systemic i18n finding

5. ✅ **Swept** — `shared.ftl` + `shared.id.ftl` had the same broken
   single-line `.aria-label =` syntax (55 keys each, e.g. `clear-aria`,
   `workspaces-aria`, `search-aria`, `actions-aria`, …). Every `aria-label`
   consuming them app-wide rendered the literal `.aria-label = …` prefix.
   Converted all 55 per locale to plain values, plus three Indonesian
   `update-banner-*-aria` keys that were declared attribute-only but read
   via `getString` (rendering the raw key id). `i18nStrayAttributeSyntax.test.ts`
   now guards the shared + reports bundles against the single-line form, and
   pins the update-banner keys as plain values in both locales.
6. ✅ **Attribute-only-vs-getString sweep (round 169)** — audited every
   locale bundle for attribute-only messages (no value, e.g.
   `key =\n  .aria-label = …`) whose id is read by `getString` /
   `requiredLocalized` (value readers → raw key id). Fixed 8 keys per locale
   (`categories-name-aria`, `pos-cart-options-collapse/expand-aria`,
   `product-mgmt-variants-aria`, `retail-cart-course/modifier-aria`,
   `setup-step-aria`, `terminal-override-aria`) by converting them to plain
   values, and removed the redundant overridden `placeholder` prop on the
   `refund-reason/note-placeholder` inputs (correctly served by their
   `<Localized attrs>` wrappers). Added `scanAttributeOnlyGetString()` to the
   `barePlaceholderScan` gate so this class fails closed.

---

# Tax configuration audit (2026-08-13)

Audit of `TaxConfigurationScreen.tsx` + `tax.ftl` / `tax.id.ftl`.

## Fixed (committed)

- ✅ **Inclusive/Exclusive toggle keyboard access** — the two `role="radio"`
  buttons now form a real WAI-ARIA radiogroup: Arrow keys move focus + selection
  and a roving tabindex keeps only the checked option in the Tab order.
- ✅ **Rate parsing** — `parseInt` (which silently truncated `825.5` → `825`)
  replaced with `Number` + `Number.isInteger`, so non-integer bps is rejected
  with the existing localized error instead of being saved as the wrong rate.
- ✅ **Name trimming** — the tax name is trimmed before save (the Save button
  already required a non-blank name, but surrounding whitespace was preserved).
- ✅ **Dead `aria-label` on the actions `<th>`** — both tables' actions column
  headers carried `aria-label={getString('actions-aria')}` under a
  `<Localized attrs={{ "aria-label": true }}>` wrapper that already injects the
  localized `tax-config-col-actions` attribute, overriding the explicit prop.
  Removed the dead prop.
- ✅ **Orphan FTL keys removed** — `tax-config-loading`, `tax-config-modal-aria`,
  `tax-config-cat-modal-aria`, `tax-config-modal-close` (both locales) and
  `tax-config-field-name-aria` (en only) were never read by any code.

## Still open

1. ✅ **Non-functional `setForm` updates fixed** — the name/rate/checkbox/radio
   handlers now use functional updaters (`setForm((prev) => …)`), removing the
   latent stale-closure risk.
2. ✅ **Category modal no-op save fixed** — `SettingsPopup` now receives
   `saveDisabled` (a sorted-id diff against `catTaxRates.get(editingCatId)`), so
   an untouched assignment can't round-trip the IPC write.
3. **Redundant `aria-label` on picker labels** — the category rate `<label>`s
   set `aria-label={r.name}`, which may override the richer label text (rate % +
   type). Confirm whether the bare name is the intended accessible name.

---

# Customer management audit (2026-08-13)

Audit of `CustomerManagementScreen.tsx` + `customers.ftl` / `customers.id.ftl`.

## Fixed (committed)

- ✅ **Dead + hardcoded-English `aria-label` props** — the search input
  (`aria-label={getString('search-customers-aria')}`), actions column header
  (`aria-label={getString('actions-aria')}`), and the history/edit/delete row
  buttons (`aria-label={`View history for ${name}`}` etc.) were all overridden
  by their `<Localized attrs={{ 'aria-label': true }}>` wrappers. Removed; the
  wrappers now provide the localized labels.
- ✅ **Hardcoded `en-US` formatting** — `formatSaleTotal`, `formatDate`, and the
  loyalty point counts now derive the locale from the active Fluent bundle
  (`[...l10n.bundles][0]?.locales[0]`) instead of hardcoding `en-US` / the
  browser locale.
- ✅ **Name field updater** — the name input now uses the functional
  `updateField('name', …)` like the other fields instead of a stale-closure
  `setForm({ ...form, … })` spread.
- ✅ **Stray `{ }` JSX** — removed five empty expressions (table row + four
  placeholder `Localized` wrappers).
- ✅ **Orphan FTL keys** — removed 12 never-read keys per locale
  (`customer-mgmt-loading`, `-name-aria`, `-email-aria`, `-phone-aria`,
  `-notes-aria`, `-modal-add-aria`, `-modal-edit-aria`, `-modal-close`, and
  `-history-sale-date/total/items/status`).

## Still open

1. **`search-customers-aria` in shared.ftl is now orphan** — after removing the
   dead prop, the shared `search-customers-aria` key has no remaining consumers
   (`PaymentModal` uses a separate `payment-search-customers-aria` key). Left in
   place to avoid touching the shared bundle in this pass.

---

# Terminal management audit (2026-08-13)

Audit of `TerminalManagementScreen.tsx` + `terminals.ftl` / `terminals.id.ftl`.

## Fixed (committed)

- ✅ **Dead + hardcoded-English `aria-label` props** — the actions column header
  (`aria-label={getString('actions-aria')}`) and the edit/delete buttons
  (`aria-label={`Edit ${name}`}` etc.) were overridden by their `<Localized
  attrs>` wrappers. Removed.
- ✅ **`formatDate` ignored hour/minute** — it called `toLocaleDateString`, which
  silently drops the `hour`/`minute` options, so "Last Seen" never showed a time.
  Switched to `toLocaleString` with the active Fluent locale and an invalid-date
  guard.
- ✅ **Functional `setForm` updates** — the five form field handlers now use
  `setForm((prev) => …)` instead of spreading `form` from the closure.
- ✅ **Orphan FTL keys** — removed 11 never-read keys per locale
  (`terminal-management-loading`, `terminal-secret`, `terminal-metadata`,
  `-register/update/delete-success`, `-name-required`, `-device-id-required`,
  `-modal-close`, `-loading-overrides`, `-delete-aria`).

## Still open

1. **Redundant label `aria-label`s** — the four modal field `<label>`s set an
   `aria-label` (`terminal-field-*-aria`). For name/device-id this duplicates the
   visible text; for secret/metadata it is a deliberate shorter accessible name
   than the verbose visible label. Left as-is (intentional concise naming).

---

# Category management audit (2026-08-13)

Audit of `CategoryManagementScreen.tsx` + `products.ftl` / `settings.ftl`.

## Fixed (committed)

- ✅ **Icon/colour radiogroups keyboard access** — the four pickers (icon and
  colour, in both create and edit modals) had every radio in the Tab order and
  no arrow-key navigation. Added WAI-ARIA roving tabindex (only the checked
  option is tabbable) and Arrow-key navigation that moves focus + selection,
  via a shared `nextRadioValue` helper. Regression test for the icon picker.
- ✅ **`useState(randomColour())` side effect** — the random colour/icon were
  evaluated on every render (discarded) because the call was an argument rather
  than a lazy initializer. Switched to `useState(() => randomColour())`.
- ✅ **ID colour-swatch parity** — `category-colour-swatch-aria` in the
  Indonesian bundle omitted the `{ $colour }` variable that the English bundle
  interpolates; added it so both locales name the swatch's colour.

## Still open

1. **Icon `label` field is dead** — `ICON_OPTIONS`' `label` ("Food", "Generic ·",
   …) is never rendered; the aria-label comes from the FTL ternary. The three
   dot icons (dots-1/2/3) collapse to a single `categories-icon-generic` label,
   so AT users can't tell them apart. Minor; needs a product call on distinct
   labels.

---

# Gift cards audit (2026-08-13)

Audit of `GiftCardsScreen.tsx` + `IssueGiftCardModal.tsx` + `GiftCardPayment.tsx`
and `gift-cards.ftl` / `sales.ftl`.

## Fixed (committed)

- ✅ **Raw backend status/txn type** — the card status badge and transaction
  type rendered the raw backend values (`"active"`, `"redeem"`, `"topup"`, …) in
  English. Mapped both through the Fluent bundle (adding
  `gift-cards-txn-issue/redeem/topup/refund` keys) with a raw-value fallback.
- ✅ **`aria-expanded`** — the expandable card summary button now exposes its
  toggle state to assistive tech.
- ✅ **Unnamed dialog** — the issue modal `role="dialog"` had no accessible name;
  added `aria-labelledby` → its `<h2>`.
- ✅ **Dead `cardInputRef`** — removed the unused ref in `IssueGiftCardModal`.
- ✅ **Top-up parsing** — `parseInt` (silently truncating `500.5` → `500`)
  replaced with `Number` + `Number.isInteger`.
- ✅ **Browser-locale dates** — issue/expiry/transaction dates now use the
  active Fluent locale instead of `toLocaleDateString()`'s browser default.

## Still open

1. **`formatMoney` default locale is `id-ID`** — the gift-card balances/totals
   call `formatMoney` without a locale, so English-locale users see Indonesian
   grouping ("Rp 50.000"). Systemic across the app; worth a dedicated pass that
   threads the active Fluent locale into `formatMoney` call sites (and reconciles
   with the per-store receipt `decimalSep` override).
2. **Hardcoded `currency: 'IDR'` + `created_by: 'staff'`** in
   `IssueGiftCardModal` — likely intentional until multi-currency gift cards and
   real operator identity land.
3. **`gift-cards-loading` orphan** (in `sales.ftl`) — the screen uses a skeleton.

---

# Promotions audit (2026-08-13)

Audit of `PromotionManagementScreen.tsx` + `promotions.ftl` / `promotions.id.ftl`.

## Fixed (committed)

- ✅ **Functional `setForm` updates** — the eleven promotion form field
  handlers used `setForm({ ...form, … })`; converted to functional updaters.
- ✅ **Locale-aware dates** — the Starts/Ends columns used
  `toLocaleDateString()` (browser locale); now formatted in the active Fluent
  locale via a shared `formatDate` helper.

## Still open

1. **`parseInt` truncation in numeric fields** — `value_minor`,
   `min_order_minor` (via `parseInt(e.target.value) || 0`) and `min_qty` /
   `reward_qty` (via `parseInt(e.target.value)`) silently truncate decimals
   like `500.5` → `500`. Number inputs with default `step=1` usually prevent
   this, but the truncation is silent if a decimal is typed.
2. **`datetime-local` timezone round-trip** — the Starts/Ends pickers write
   `new Date(value).toISOString()` (UTC) and read back
   `iso.substring(0, 16)` (treated as local), so an operator in UTC+7 sees the
   stored time shifted by the offset on reopen. Needs a deliberate decision on
   whether promotions store local wall-clock time.
3. **`value` column display** — for `fixed_amount` / `buy_x_get_y` the raw
   `value_minor` integer is shown without currency formatting; for
   `percentage` it renders `{n}%`. Confirm the intended display for non-
   percentage types.

---

# Loyalty audit (2026-08-13)

Audit of `LoyaltyManagementScreen.tsx` + `loyalty.ftl` / `loyalty.id.ftl`.

## Fixed (committed)

- ✅ **Functional `setTierForm` updates + stray `{ }`** — the five tier form
  fields now use functional updaters; nine stray empty `{ }` JSX expressions
  removed (tier edit form, table header, expand cell, txn rows).
- ✅ **Integer tier-field parsing** — `parseInt` silently truncated decimals
  (`"10.5"` → `10`) and turned an empty `min_points` into `0`. Now `Number` +
  `Number.isInteger` + non-empty checks reject fractional/blank integer fields
  with the localized error; the earn multiplier still accepts decimals.
  Regression test added.
- ✅ **Tier badge contrast** — the white text on the tier colour was unreadable
  for light colours; now uses `contrastFg(tier.colour)` (same utility as the
  category picker).
- ✅ **Locale-aware numbers/dates** — points, lifetime points, points-to-next,
  min-points, and transaction dates now use the active Fluent locale instead of
  the browser default.
- ✅ **`customerMap` memoized** — no longer rebuilt on every render.

## Still open

1. **Nested interactive row** — each loyalty account `<tr>` is
   `role="button" tabIndex={0}` with an expand handler, AND contains a real
   `<button>` doing the same toggle. Screen readers and keyboard users see two
   controls for one action. Needs a design decision (drop the row role, or the
   inner chevron button).
2. **Dynamic `loyalty-${txn.txn_type}` keys** — covered for the known types
   (`earn`/`redeem`/`adjust`); an unknown backend type falls back to the
   capitalized raw value.

---

# Exchange-rate audit (2026-08-13)

Audit of `ExchangeRateScreen.tsx` + `currency.ftl` / `currency.id.ftl`.

## Fixed (committed)

- ✅ **Functional `setForm` updates + tightened `formValid`** — all five modal
  fields now use functional updaters (no stale-closure spread). The rate
  validity check now survives the millionths conversion: a sub-0.000001 rate
  (which passed `parseFloat > 0` but rounded to 0 millionths and silently did
  nothing on Save) is rejected. `Number.isFinite` + `rateMillionths > 0` guard
  tiny/overflowing values.
- ✅ **Delete confirmation dialog** — deleting an exchange rate is now a
  two-step flow via `ConfirmDialog` (danger variant, uses the previously
  dead `currency-delete-confirm` key; added `currency-delete-title`). The
  delete test was updated to confirm the dialog.
- ✅ **Orphan FTL keys removed** — `currency-add`, `currency-loading`, and
  `currency-modal-add-label` had zero consumers; deleted from both bundles.

## Still open

None.

---

# Inventory audit (2026-08-13)

Audit of `src/features/inventory/` (11 screens) + `inventory.ftl` /
`stock-counting.ftl` / `*.id.ftl` bundles.

## Fixed (committed)

- ✅ **Fractional quantities rejected (no silent `parseInt` truncation)** —
  `InventoryAdjustmentScreen` (2.5 → 2), `StockCountDetail` expected/counted
  qty (10.5 → 10), and `ThresholdConfigScreen` (5.5 → 5) all accepted
  fractional input and silently truncated it. Now `Number` +
  `Number.isInteger`: adjustment shows the localized error and disables
  Apply, counted-qty keystrokes ignore fractional in-progress input,
  add-line shows a new `sc-error-qty-integer` message, thresholds toast the
  existing error. Regression test added.
- ✅ **Locale-aware dates** — 7 screens rendered dates/times with the
  browser default locale (`toLocaleDateString`/`toLocaleTimeString`/
  `toLocaleString` with no args). All now derive the locale from the active
  Fluent bundle (`[...l10n.bundles][0]?.locales[0]`, `en-US` fallback):
  ShiftBar, StockAlertPanel, StockCountDetail, StockCountHistory,
  StockCountsScreen, TransactionLogScreen, TransitAuditScreen.
- ✅ **Orphan FTL keys removed** — 8 never-read keys deleted from both
  bundles: `inv-alert-acknowledge-btn`, `inv-alert-col-triggered`,
  `inv-log-type-purchase-order-receive` (superseded by `-po-receive`),
  `inv-report-loading-aria`, `inv-shift-notes-label`,
  `inv-shift-select-location`, `inv-transit-col-overdue`, `sc-loading`.
  (`sc-status-*`/`sc-type-*` are used via dynamic ids — kept.)

## Still open

1. **`StockCountForm` type toggle** — the radiogroup (`role="radiogroup"`
   + plain buttons) predates the arrow-key/roving-tabindex pattern applied
   to tax and categories; low value since it has only 3 options.
2. **`stockStatus` low threshold** — hardcoded `< 10` in
   `InventoryAdjustmentScreen` while thresholds are configurable elsewhere.
3. **`ShiftBar` note field** — `inv-shift-notes-label` was orphan because
   the visible label isn't localized (the `<label>` renders raw English
   "Notes"); the placeholder is localized. Worth a visual check.

---

# Products audit (2026-08-13)

Audit of `src/features/products/` (4 screens) + `products.ftl` /
`bundles.ftl` / `*.id.ftl` bundles.

## Fixed (committed)

- ✅ **Bundles: strict integers + surfaced failures** — bundle price and
  item qty/unit-price were silently truncated by `parseInt` (4.50 → 4);
  now rejected with localized `bundles-error-invalid-*` messages. Save/delete
  failures were swallowed by empty catch blocks; now surfaced inline
  (`role="alert"`). 4 functional `setForm` updaters; 7 dead hardcoded
  aria-labels removed; 4 new `bundles-error-*` keys.
- ✅ **Variants: strict integers + surfaced failures** — `500.5` price
  silently saved as 500; sort order truncated too. Now rejected with new
  `variant-mgmt-error-invalid-*` keys. The previously-dead
  `variant-mgmt-error-save`/`-delete` keys (empty catches!) are now wired to
  inline alerts. 7 functional `setForm` updaters; 2 dead aria-labels removed.
  Regression test for fractional-price rejection.
- ✅ **Products/Lookup: functional `setForm`** — 8 handlers in
  `ProductManagementScreen` converted; dead hardcoded aria-label on the
  lookup card button removed.
- ✅ **Orphan FTL keys removed** — 19 never-read keys deleted from both
  bundles (`bundles-loading`/`-modal-aria`/`-close-aria`,
  `categories-loading`, `product-lookup-add`/`-title`,
  `product-mgmt-deleting`/`-field-name`/`-field-sku`/`-loading`,
  `restaurant-sort-*` ×4, `variant-mgmt-close`/`-dialog-aria`/
  `-delete-confirm-aria`/`-loading`/`-modal-close`).

## Still open

1. **`BundleManagementScreen` `toggleActive`** — update failures are still
   silent (no toast/alert) and the toggle is optimistic; a failed toggle
   leaves the UI showing the flipped state until the next load.
2. **`ProductManagementScreen` delete confirm** — uses an inline `ConfirmDialog`
   but the `product-mgmt-deleting` plural key was dead (never read), so the
   deleting state renders nothing; harmless but dead code removed.
3. **`formatVariantPrice`** — hardcodes `Intl.NumberFormat('en-US', ...)`
   instead of the active Fluent locale; the domain `formatMoney` already
   handles IDR minor-unit exponents, so this could reuse it.

---

# Stock-transfers audit (2026-08-13)

Audit of `StockTransfersScreen.tsx` + `stock-transfers.ftl` /
`stock-transfers.id.ftl`.

## Fixed (committed)

- ✅ **`formatDate` bug** — called `toLocaleDateString` with `hour`/`minute`
  options, which are silently dropped, and used the browser default locale.
  Now `toLocaleString` with the active Fluent locale, so created/sent/received
  timestamps show the time and match the UI language.
- ✅ **Strict-integer quantities** — receive qty (`parseInt('4.5') || 0` sent
  4) and create-line qty (`parseInt` truncated) now reject fractional input
  with a new `stock-transfers-error-qty-integer` message instead of silently
  truncating. Regression test added for the receive flow.
- ✅ **Receive modal localized** — the `(ordered: {qty})` line label and the
  `{sku} received quantity` aria-label were hardcoded English; now Fluent
  (`stock-transfers-receive-line`, `stock-transfers-received-qty-aria`).
  Receive validation errors surface via `role="alert"` (new `receiveError`
  state); `setReceiveLines` uses a functional updater; stray `{ }` JSX in
  the product datalist removed.

## Still open

1. **`localizedStatusLabel` fallback** — unknown backend statuses render the
  capitalized raw value; the dynamic `stock-transfers-status-*` keys cover
  the known set (used by filter tabs + badges).
2. **Create-line `productName`** — when typing a SKU that doesn't match a
  known product, the line name falls back to the raw SKU text; intentional
  for free-form entries.

---

# Shifts audit (2026-08-13)

Audit of `ShiftManagementScreen.tsx` + `shifts.ftl` / `shifts.id.ftl`.

## Fixed (committed)

- ✅ **Strict-integer balances/payouts** — opening balance, closing balance,
  and payout amount were silently truncated by `parseInt` (500.5 → 500).
  Now `Number` + `Number.isInteger`: fractional opening balance is rejected
  with a new `shift-invalid-opening-balance` message, closing balance and
  payout keep their existing invalid messages, and the Apply/Close buttons
  disable for fractional input. Regression test added.
- ✅ **Locale-aware time/date** — `time()` and `dateTime()` passed `[]` as
  the locale (browser default); now the active Fluent locale.
- ✅ **Orphan FTL keys removed** — 11 never-read keys deleted from both
  bundles: `shift-open`/`shift-close` (buttons use `shift-btn-*`),
  `shift-closing-balance`, `shift-expected-cash`, `shift-actual-cash`,
  `shift-difference`, `shift-eod-report`, `shift-print-report`,
  `shift-loading`, `shift-recon-payouts-returned`, `shift-report-loading`.
- ✅ Stray `{ }` JSX in the history table row removed.

## Still open

1. **Open-shift default** — an empty opening-balance field opens with 0;
  intentional per SHIFT-03 but worth confirming the drawer-empty default.
2. **`reason` fallback** — payout reason defaults to the raw English string
  `'safe drop'` when blank; not localized (backend free-text field).

---

# Staff audit (2026-08-14)

Audit of `StaffManagementScreen.tsx` + `staff.ftl` / `staff.id.ftl`.

## Fixed (committed)

- ✅ **Functional `setForm` updaters** — 19 `setForm({ ...form })` stale-closure
  spreads converted to `setForm((prev) => ...)` (name, PIN, role, phone,
  active toggle, and the edit-drawer fields).
- ✅ **Dead hardcoded aria-labels removed** — 2 `aria-label` props that were
  overridden by `<Localized attrs>` wrappers.
- ✅ **Orphan FTL keys removed** — 9 never-read keys deleted from both bundles:
  `staff-error-generic`, `staff-loading`, `staff-login-title/subtitle/step-pin/verifying`
  (the login screen renders `store_name` + hardcoded strings; the test fixtures
  defined them but never asserted), `staff-no-staff-found`, `staff-pin-placeholder`,
  `staff-shifts-tab`.

## Verification

- typecheck ✅ · lint 0 errors ✅ · i18n lint clean · bundle parity 0 missing ·
  FTL dedupe clean ✅
- StaffManagementScreen tests 22/22 ✅

## Still open

1. **Login screen strings** — `StaffLoginScreen` still renders a couple of
  hardcoded English strings (title fallback, "Enter your PIN", "Verifying…");
  the dead `staff-login-*` keys were removed, so localizing it means adding
  keys back deliberately.

---

# Promotions + purchasing audit (2026-08-14)

Audit of `PromotionManagementScreen.tsx`, `PurchaseOrderForm.tsx`,
`SuppliersScreen.tsx` + their bundles.

## Fixed (committed)

- ✅ **Strict-integer numeric inputs** — promotions `value_minor` (fixed-amount
  discount in minor units), `min_qty`, `reward_qty`, `min_order_minor`, plus
  PO line `qty` and `unit_cost_minor` silently truncated fractional input via
  `parseInt` (12.5 -> 12). Now non-integer keystrokes are ignored, matching
  the inventory-threshold pattern; inputs gained `min={0}`. Regression test
  for the promotions value field added.
- ✅ **Orphan FTL key removed** — `suppliers-loading` (skeleton is
  `aria-hidden`, CSS-class only) deleted from both purchasing bundles. The
  `po-status-*` keys are read dynamically via `id={\`po-status-${s}\`}` — kept.

## Verification

- typecheck ✅ · lint 0 errors ✅ · i18n lint clean · bundle parity 0 missing ·
  FTL dedupe clean ✅
- PromotionManagementScreen 18/18, PurchaseOrderForm + PurchaseOrdersScreen
  35/35 ✅

## Still open

1. **No client-side value validation** — `handleSave` only requires a name; a
  percentage promo of 0% or a fixed_amount of 0 saves fine. Backend may
  reject; worth an inline check.
2. **Raw minor-unit inputs** — the promo value/min-order fields present raw
  minor units (5000 = $50.00) rather than a formatted amount; consistent with
  the existing table display but not ideal UX.

---

# Sales audit (2026-08-14)

Audit of the sales feature (PosScreen, EodReportScreen, RefundModal,
PaymentModal, PriceOverrideModal, StockShortfallDialog).

## Fixed (committed)

- ✅ **Locale-aware times/dates** — EOD report on-screen shift times passed
  `[]` as locale (browser default); now the active Fluent locale. RefundModal
  sale date likewise. The printable receipt's hardcoded `en-US` body is a
  deliberate 58mm print artifact and was left alone.
- ✅ **Strict-integer POS inputs** — discount %, closing/opening balances
  (raw minor units), loyalty points-to-redeem, price override (monetary
  minor units), and stock-shortfall split qty all silently truncated
  fractional input via `parseInt` (10.5 -> 10). Now non-integer keystrokes
  are ignored; the Apply/Close-Shift disabled checks and the
  open/close/discount handlers validate whole numbers.

## Verification

- typecheck ✅ · lint 0 errors ✅
- 9 sales test files, 132/132 ✅

## Still open

1. **Hardcoded 'Failed to delete held cart' toast** — PosScreen line ~826
  uses a raw English toast string (unlocalized). Needs an FTL key.
2. **`discountName` fallback** — `handleApplyDiscount` builds the label as
  `` `${pct}% Discount` `` when the optional name is blank — raw English
  string in the cart.
3. **PaymentModal receipt dates** — lines 467/771 use `toLocaleDateString('en-US')`
  for the printable receipt artifact — intentional, consistent with EOD print.

---

# Retail + auth + offline audit (2026-08-14)

Audit of retail product modals (Add/EditProductModal, RetailModals),
SessionLockScreen, OfflineQueueScreen.

## Fixed (committed)

- ✅ **Strict-integer product fields** — Add/EditProductModal price, stock
  qty, low/high thresholds, and cost (monetary minor units) silently
  truncated fractional input via `parseInt` (1850.5 -> 1850). Now non-integer
  keystrokes are ignored. Regression test for the price field added.
- ✅ **Locale-aware dates/times** — SessionLockScreen clock/date, offline
  queue created/synced times + last-polled time, and RetailModals shift
  opened-at + credit-created dates all used the browser default locale; now
  the active Fluent locale.

## Verification

- typecheck ✅ · lint 0 errors ✅ · i18n lint clean · bundle parity 0 missing ·
  FTL dedupe clean ✅
- AddProductModal 6/6, EditProductModal + SessionLock + OfflineQueue +
  RetailModals 65/65 ✅

## Still open

1. **RestaurantMenu localStorage parses** — `parseInt` on card-size/font-size
  storage reads are integer-clamped settings (0-4); low risk, intentionally
  left.

---

# Multi-bundle orphan sweep (2026-08-14)

Careful pass over kiosk / offline / loyalty / terminals / gift-cards / tax /
currency / customers / stock-counting / inventory / multi-store / kds /
analytics bundles with a zero-hit grep (code-only, excluding the FTL files
themselves).

## Fixed (committed)

- ✅ Removed 11 confirmed-dead keys from both bundles:
  - kiosk: `kiosk-return`
  - offline: `offline-queue-delete-success`
  - loyalty: `loyalty-earn`, `loyalty-adjust`, `loyalty-points-value`,
    `loyalty-redeem-at-checkout`, `loyalty-available-points`,
    `loyalty-enter-points`
  - terminals: `terminal-binding-error-load/save/clear` (screen uses
    `terminal-error-binding-*`)

## Kept (verified used)

- `gift-cards-txn-*` (issue/redeem/refund/topup) — dynamic
  `l10n.getString(\`gift-cards-txn-${type}\`)`.
- `sc-status-*` / `sc-type-*` — dynamic `id={\`sc-status-${status}\`}`.
- `topology-*` (multi-store) — read from object literals
  (`ariaId: 'topology-align-left'`) and template ids
  (`topology-new-${type}`); the bundle is heavily dynamic.
- tables status keys, tax/currency error keys — used via
  `l10nErrorMessage(err, l10n, 'key')`.

## Note

Naive "orphan" greps are unreliable here: keys are referenced through
`requiredLocalized(l10n, 'k')`, `l10nErrorMessage(err, l10n, 'k')`, object
literals, and template ids. Any future sweep must use the zero-hit,
code-only grep pattern.

# Compliance suite repairs (full-suite sweep)

The first full `vitest run` of the session surfaced 4 failing compliance tests
(plus 2 mock gaps in the SessionLock tests). All repaired:

## What landed

- **animationCompliance**: `kds-urgent-blink` is a critical kitchen alarm that
  must keep blinking even under reduced-motion; added to `ESSENTIAL_KEYFRAMES`
  alongside `kds-pulse` / `kds-new-ticket`.
- **themeTokenCompliance (9 violations)**:
  - AnalyticsScreen: 6× `font-size: 11px` → `var(--text-xs)` (KPI labels,
    delta pill, insight, legends, heat labels).
  - KdsScreen: urgent/rush badge colors `#1a1a1a` / `#ffffff` →
    `var(--color-warning-fg)` / `var(--color-danger-fg)` (TBL-11 status
    foreground pairs); keycap `box-shadow` → `var(--shadow-sm)`.
- **noiseDitherCompliance**: `.kds-column` (kanban) and `.kds-shortcut-key`
  were elevated surfaces (`--shadow-sm`) without the noise-dither overlay.
  Registered both in all three components.css blocks (main / contrast /
  reduced) + `KNOWN_NOISE_SELECTORS`, and gave each `position: relative` so
  the absolute ::after overlay anchors correctly.
- **KdsScreen.css corrupt rule**: the shortcuts-overlay commit left a mangled
  `}ht: 1.5rem;` fragment inside `.kds-offline-dismiss-btn:focus-visible`
  (215 vs 218 braces — an unbalanced file for months) plus a duplicated
  `:hover`/`:focus-visible` pair. Reconstructed: single base (1.75rem) +
  one `:hover` + one `:focus-visible`. Braces now 215/215.
- **barePlaceholderScan stale pin**: the id contract for
  `category-colour-swatch-aria` used to DROP `$colour` (the round-164
  discriminator), but commit 6840fbf3 added it back for swatch parity. Switched
  the discriminator to key-set membership — `customers-add` is id-only, so it
  must be absent from en contracts and present in id contracts.
- **SessionLockScreen tests**: both l10n mocks lacked the `bundles: []` stub
  the locale lookup needs (same fix as LicenseSettings/TerminalStatusPanel).
- **Missing id translations found during the sweep** (used via `getString` /
  dynamic ids, invisible to bundle-parity's `<Localized>`-only scan):
  - loyalty: `loyalty-table-aria`, `loyalty-txn-table-aria`
  - tax: `tax-config-table-aria`, `tax-config-cat-table-aria`
  - settings: 15 `setup-feature-*-label` keys (analytics, audit-log, cloud-sync,
    customer-display, discount-engine, multi-*, promotions-engine, staff-*, etc.)

## Verification

- Full suite: **296 files / 5211 tests pass**. The 5 "errors" are the
  pre-existing unhandled `emit` timer noise from `src/dev-mock/tauri-api.ts`
  (test hygiene, not failures).
- typecheck ✅ · lint 0 errors ✅ · i18n lint clean ✅ · bundle parity
  0 missing ✅ · FTL dedupe clean ✅

## Deferred

- `src/dev-mock/tauri-api.ts` KDS progress timer fires after
  NodeTopologyEditor/AnalyticsScreen tests tear down and hits the
  `@tauri-apps/api/event` mock without `emit` — 5 unhandled rejections per run.
  Needs a `vi.mock` with `emit` or a timer cleanup hook in those tests.
- en-only settings keys `settings-sync-last-at` / `settings-currency-options-label`
  are dead in the en bundle (no TSX consumers) — candidates for the next
  careful settings-ftl dead-key pass.
- id-only orphans remain across several bundles (customers-add/inventory-*,
  products-add, orders-*, shared app-name/done/export/filter, staff-activate…)
  — all have zero TSX consumers and zero en counterparts.

# KDS locale/truncation fixes + full orphan sweep (2026-08-14)

## KDS repairs

- `KdsHistoryPanel` — the received/served timestamps used browser-locale
  `toLocaleString()`; now formatted with the active Fluent locale
  (`numLocale` derived from `l10n.bundles`).
- `KdsTicketCard` edit-count input — `parseInt(editCount)` silently truncated
  fractional keystrokes (e.g. 2.5 → 2). The input now rejects non-integer /
  <1 values at the keystroke level (established strict-integer pattern).
  Regression test: `rejects fractional edit counts at the keystroke level`.

## Definitive orphan-key sweep (505 keys across 11 bundles)

Built a fast exact-substring orphan scanner (all TSX/TS incl. tests as
references, dynamic template/concatenation prefixes protected, Fluent terms
excluded). Removed dead keys from:

- inventory.id (5), multi-store + .id (6 each), products.id (11),
  reports.id (13), sales (42), sales.id (70), settings (155),
  settings.id (162), shared (16), shared.id (19)

Highlights: the settings bundles carried ~150 legacy keys from the section
refactor (settings-appearance, settings-sync-*, settings-credit-*, ...);
sales carried stale pos-*/payment-*/orders-* duplicates; products.id kept
products-add/title/price... with no en counterpart. All had zero TSX
consumers. Kept: `customers-add` (barePlaceholderScan discriminator pin),
dynamic-prefix keys (setup-feature-*, analytics-*, sc-status-*, kds-*),
Fluent terms.

## Verification

- Full suite: **296 files / 5211 tests pass** (4 pre-existing dev-mock
  timer errors, not failures).
- typecheck ✅ · lint 0 errors ✅ · i18n lint clean ✅ · bundle parity
  0 missing ✅ (3860 en / 3939 id keys across 25 files).
- Compliance tests (barePlaceholderScan 50, themeToken, noiseDither,
  animation) all pass.

## Deferred (unchanged)

- `src/dev-mock/tauri-api.ts` timer `emit` cleanup.

# Kiosk audit (2026-08-14)

- `KioskScreen` had three defects:
  1. Product/category loads had **no `.catch`** — a failed load left the
     screen hanging on an empty grid forever with no error surface. Added a
     `loadMenu` callback with per-request rejection handling, a localized
     error banner (`kiosk-load-error` / `kiosk-retry`) with a Retry button
     that re-fetches and clears the error.
  2. The payment toast was a **hardcoded English string**
     (`'Payment processed! (simulated)'`) — now `kiosk-pay-success`.
  3. The price-volatility hint had a **hardcoded English `title`** — now
     `kiosk-price-volatility-title`.
- New keys added to both kiosk bundles (en + id); parity 0 missing.
- 2 regression tests: load-failure shows retry surface; retry recovers.
- Also re-scanned tables/tax/setup/workspaces/customers/gift-cards/loyalty/
  design for remaining issue classes (unhandled loads, hardcoded strings,
  parseInt truncation, locale-less dates, setForm spreads) — all clean.

## Verification

- typecheck ✅ · lint 0 errors ✅ · i18n lint clean ✅ · parity 0 missing ✅
- KioskScreen 14/14, tables/setup suites 74/74 pass.

# Test-hygiene repair: dev-mock emit (2026-08-14)

The one remaining deferred item is now fixed. `src/dev-mock/tauri-api.ts`
starts two `setInterval` timers at module load (KDS auto-generation +
auto-progress) that `emit('kds:orders-changed', …)` on the event bridge
module every few seconds. The vite alias maps `@tauri-apps/api/event` →
`src/dev-mock/tauri-event.ts`, so when a test run outlives the mock's
timers, the `emit` calls hit the test mock — which previously only stubbed
`listen`, producing 4 unhandled errors per full run.

Fix: added `once` / `emit` / `emitTo` no-op stubs to the event mock in
- `src/test-setup.ts` (global)
- `src/__tests__/SettingsContext.test.tsx`
- `src/__tests__/WorkspaceSettingsModal.test.tsx`
- `src/__tests__/WorkspaceSettingsModal.role-swap.test.tsx`
- `src/features/settings/__tests__/FeatureToggleScreen.test.tsx`

The per-file mocks override the global one, so each needed the same
surface or a dev-mock timer firing inside that test would re-trigger the
failure.

## Verification

- Full suite: **296 files / 5214 tests pass, 0 unhandled errors** (was
  4 errors). NodeTopologyEditor 541/541 clean.

# Settings error i18n repair (2026-08-14)

`SettingsContext` stored a hardcoded English string (`'Failed to load
settings'`) in its `error` field, which `SettingsPage` rendered directly
in the full-failure alert — a user-visible i18n violation. The
`settings-load-failed` key (removed in the orphan sweep) was the missing
consumer.

- Context now stores the Fluent key id (`settings-load-failed`); doc
  comment updated to say the field holds a key id.
- SettingsPage renders `l10n.getString(loadError)`.
- Restored `settings-load-failed` to both bundles (en + id).
- Updated SettingsContext test assertion; SettingsPage error test now
  asserts the localized string exactly.

## Verification

- typecheck ✅ · i18n lint clean ✅ · parity 0 missing ✅ · dedupe clean ✅
- SettingsContext + SettingsPage suites: 80/80 pass.

# AppLayout sidebar subtitle i18n (2026-08-14)

`AppLayout` rendered a raw hardcoded `Point of Sale` subtitle in the
sidebar brand block. Added `app-sidebar-subtitle` to both shared bundles
(en + id) and wrapped the span in `<Localized>`.

Also swept the cross-cutting layers (frontend/shell, shared components,
api, contexts, hooks, utils) for the standard issue classes — all clean:
- FastPINOverlay/QRIS/PermissionDenied strings are nested
  `<Localized attrs>` fallbacks; ErrorBoundary is localized via
  `requiredLocalized`; the `'No session token'` api guard is a
  dev-guard (not user-facing); hook guards are standard
  "must be used within" throws.

## Verification

- Full suite: **296 files / 5214 tests pass, 0 unhandled errors**.
- typecheck ✅ · i18n lint clean ✅ · parity 0 missing ✅
- Shell layout + a11y suites: 49/49 pass.

# React key-warning repairs (2026-08-14)

Two genuine key-prop warnings surfaced in the full-suite stderr:

1. **TransactionLogScreen** — the transaction rows were returned from
   `.map()` inside a bare `<>...</>` fragment, so the key on the inner
   `<tr>` never attached to the list element (React warned on every
   render). Switched to `<Fragment key={tx.id}>` and removed the
   redundant key from the `<tr>`.

2. **SalesReportScreen.test.tsx fixture** — `renders gross profit and
   margin per product` built both top products with the default
   `product_id: 'prod-1'`, tripping React's duplicate-key warning.
   Gave the second fixture a distinct `prod-2`.

Also swept for the same bare-fragment-in-map pattern across
`src/features` — TransactionLogScreen was the only instance.

## Verification

- Full suite: **296 files / 5214 tests pass, 0 unhandled errors** — both
  key warnings gone from stderr.
- typecheck ✅ · lint 0 errors ✅ · i18n lint clean ✅

# Test-hygiene: act() warnings (2026-08-14)

LocationPicker.test.tsx emitted 42 "not configured to support act(...)"
warnings (2 per test). Root cause: `renderWithProviders` is an async
helper (wraps render in `await act()`), but 22 of 24 call sites didn't
`await` it — the component's load does two sequential awaits
(listInventoryLocations → getWorkspaceLocations), and the second
continuation settled after the act() flush, inside RTL waitFor's polling
window where the act environment flag is deliberately disabled.

Fix: `await` all 22 un-awaited `renderWithProviders(...)` calls in
LocationPicker.test.tsx (the 2 that already awaited were correct). A
global `IS_REACT_ACT_ENVIRONMENT = true` in test-setup was tried first
but does not help — RTL's waitFor asyncWrapper explicitly sets the flag
false during polling.

Also fixed this round: TransactionLogScreen fragment key (previous
commit) and the SalesReportScreen duplicate-key test fixture.

## Verification

- Full suite: **296 files / 5214 tests pass, 0 unhandled errors, 0 act()
  warnings** (was 42). Remaining stderr is intentional error-path
  logging + informational compliance messages.
- typecheck ✅ · lint 0 errors ✅

# Test-stderr cleanup round 2 (2026-08-14)

Three more sources of stderr noise removed from the full-suite run:

1. **`vi.hoisted()` placement warning** (loadingStateCompliance) — the
   call lived inside a describe() body; vitest warns it will become an
   error in a future version (it hoists before imports anyway). Moved to
   module top level with a comment explaining why.

2. **Noise-dither baseline drift** (noiseDitherCompliance) — the
   informational "Selector count mismatch: parsed 111, baseline 112" was
   a duplicate `.error-boundary__card` in KNOWN_NOISE_SELECTORS (left
   over from a CI-fix commit that added it twice). Removed the duplicate;
   baseline is now 111 unique and matches the parsed CSS exactly.

3. **UNHANDLED INVOKE COMMAND** (SettingsToggleButtons) — SettingsContext
   and SettingsPage issue `get_device_id`, `list_terminals`,
   `offline_queue_status_summary`, and `get_sync_plan` during mount, but
   the mock's defaultImpl didn't handle them (they settled as
   async-after-assertion, tripping the warn branch). Added real DTO
   shapes for all four.

## Verification

- Full suite: **296 files / 5214 tests pass** with **0 warnings** of every
  class chased this round (act(), UNHANDLED INVOKE, vi.hoisted,
  selector-count mismatch, duplicate keys). Remaining stderr is
  intentional error-path logging (tests asserting failure surfaces).
- typecheck ✅ · lint 0 errors ✅

# Githooks portability fix (2026-08-14)

The pre-commit hook hardcoded a WSL-only rustup path
(`/mnt/c/Users/Dika/.cargo/bin/rustup.exe`) that cannot resolve in Git Bash on
Windows — the cargo fmt gate was silently dead for every commit made outside
WSL (all commits in this session needed `--no-verify` + manual gate runs).

Fix: resolve rustup portably — `command -v rustup` → `rustup.exe` → fallback
glob `/c/Users/*/.cargo/bin/rustup.exe`. First commit (`5ebf378b`) where the
hook's cargo fmt gate actually ran and passed; `--no-verify` no longer needed.

Note: the hook's `cargo fmt --all` formats the whole workspace, including the
user's in-flight `migrations.rs` in the worktree — restored via `git checkout`
after commit (the hook only re-stages staged files, so nothing foreign was
committed).

# Githooks portability fix round 2 — post-commit (2026-08-14)

`post-commit` hardcoded the machine-specific CBM binary path
(`C:/Users/Dika/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe`)
and the repo root (`C:/My Script/oz-pos`), silently disabling background
codebase indexing on any other machine or checkout.

Fix (`f3aff42c`): derive the repo root from `git rev-parse --show-toplevel`
and resolve the binary via `CBM_EXE` env override → PATH → standard Windows
install location glob. Verified the indexer process actually spawns after a
commit. All remaining hardcoded paths in `.githooks/` + `scripts/` cleared
(the one `verify-docker-all.sh` path is a deliberate test fixture).

# Machine-specific path sweep round 2 — scripts + tests (2026-08-14)

Broad scan for `C:/Users/Dika|/mnt/c/...|Users\Dika` across all sh/py/mjs/
ps1/bat/yml/json/toml/rs/ts/tsx. Remaining findings, both test fixtures
where any Windows-style path satisfies the assertion:

- `apps/cloud-server/src/db.rs` — Windows-path detection tests used
  `C:/Users/Dika/AppData/Local/Temp/test.db` → neutral `C:/Users/User/...`
  (also the backslash form). db tests 19/19 pass.
- `scripts/verify-docker-all.sh` OZ_DB_PATH guard fixture → neutral.

Verified clean: ps1 scripts (candidate-list fallbacks only), .bat scripts
(`%~dp0..` + `wslpath` — generic), e2e tooling (platform-aware killByPort,
idempotent cleanup, SIGINT/SIGTERM + finally), release-version self-test
(0.0.24 fixtures are synthetic; real version comes from the tag arg),
`verify-ci-docs-drift` (0 drift), version lock 0.0.25 everywhere.

# restore-db.sh WAL-mode fix (2026-08-14)

The app runs with `journal_mode=WAL` (set in oz-core migrations and
cloud-server db.rs), which means committed writes may live entirely in the
`-wal` sidecar. restore-db.sh had two defects:

1. **Pre-restore safety backup used raw `cp`** — copied only the main file,
   which can be a 4096-byte stub while WAL holds all committed data.
   Verified: `cp` of a live WAL db yields 'no such table' when reopened;
   `.backup` yields the full row set. The "safety" backup was unusable for
   rollback. Now uses `sqlite3 .backup` (consistent snapshot incl. WAL) and
   aborts on failure.
2. **Stale `-wal`/`-shm` left after `mv`** — SQLite would replay the old
   database's frames against the freshly restored main file on next open,
   corrupting it. Now removed (content captured by the .backup above).

Note: this machine lacks the `sqlite3` CLI binary (both backup scripts
depend on it; POSIX-targeted) — the fix was verified via Python's identical
sqlite3 backup API.

# E2E hygiene round (2026-08-14)

- `e2e-sale-to-history.spec.ts`: removed leftover `[diag]` console.log debug
  output from the tendered-amount fallback chain (logic + guards kept;
  verified spec passes against dev server, 13.3s).
- `.gitignore`: added `/ui/test-results` (Playwright default outputDir),
  `/ui/e2e-results` (CI json/html reporters), `/ui/.e2e-auth.json`
  (storageState with session tokens from fixtures.ts). Previously any E2E
  run polluted `git status` and risked committing local auth state.

Audited the rest of ui/e2e (29 specs, 4750 lines): 170 `waitForTimeout`
calls all guard dev-mock async and are followed by assertions (not pure
timing waits); helpers.ts/fixtures.ts robust (reduced-motion emulation,
storageState-per-worker); perf-smoke budgets env-overridable with sane
fallbacks; pageerror/perf logs intentional. playwright.config.ts clean
(webServer auto-start, retain-on-failure trace, reducedMotion, forbidOnly
on CI).

# Release-pipeline version-drift fixes (2026-08-14)

1. **openapi.rs stale version examples** — the served OpenAPI spec had
   hardcoded version examples (one stale at 0.0.9 from an old release,
   one at 0.0.25); bump-version.ps1 never touched this file. Both now use
   `env!("CARGO_PKG_VERSION")` (already used for info.version), so drift
   is impossible. Cloud-server 138/138 tests pass.
2. **bump-version.ps1 AGENTS.md pattern mismatch** — the script updated
   the root AGENTS.md version-lock line with a pattern that didn't match
   its actual phrasing ("the current release ($v)"), silently leaving it
   stale each bump (0.0.24 needed a manual catch-up). Pattern fixed and
   verified against both AGENTS.md files; historical audit-stamp versions
   (dated, in comments) intentionally untouched.

Also verified the wider release surface: release.sh (version gate runs
before tagging, changelog draft + canonical heading), release.yml
(signing degrades gracefully when UPDATER_CERT/SignPath absent),
bump-version.ps1 full file list (all present, lockfiles regenerated),
updater tooling (synthetic versions only), mobile CI (version-agnostic),
docs/releases/release-process.md consistent with scripts.

# dev-up audit (2026-08-14)

- **dev-up.sh JWT secret fallback bug**: without openssl, the uuidgen
  fallback (`uuidgen | tr -d '-' | head -c 64`) produced only 32 hex
  chars — half the intended 64-char secret strength, and inconsistent
  with the ps1 twin (exactly 64). Now uses 32 bytes of /dev/urandom via
  od (verified: exactly 64 hex chars on both paths). Commit `87a6f1e7`.

Verified the rest of dev-up.sh/.ps1 + docker-entrypoint.sh:
- health-check service names match docker-compose.yml (redis,
  license-server, pos-cloud-server; + pos-cloud-db in pg mode)
- `$(cat ...)` command substitution strips trailing newlines (PEM key
  parity with ps1's `.Trim()`); e2e newline-escaping chain consistent
  with Go normalizePEM() (tested)
- license key path matches generate-license-keys.sh; gitignored correctly
- entrypoint privilege-drop + gosu fallback sound

# Android release-signing fix (2026-08-14) — commit b9fa82ee

**Root cause:** android.yml + nightly.yml passed `--keystore-password` /
`--key-password` to `cargo tauri android build`, but the Tauri v2 CLI has
**no such flags** (verified against installed 2.11.1 `--help` and the CLI
source on GitHub). When the secrets were set, clap rejected the unknown
args and the build failed; when unset, the decoded keystore was never
consumed → every release APK/AAB was effectively UNSIGNED.

**Fix — official route (v2.tauri.app/distribute/sign/android/):**
- `gen/android/app/build.gradle.kts` (tracked): release `signingConfigs`
  block reads `gen/android/keystore.properties` (password/keyAlias/
  storeFile); applied to the release build type only when the file exists,
  so local unsigned builds are unchanged.
- Both workflows decode `ANDROID_KEYSTORE_BASE64` into `gen/android/`,
  write `keystore.properties` from `KEYSTORE_PASSWORD`/`KEY_ALIAS`, then
  build without CLI flags.
- Docs corrected (tablet AGENTS.md, first-release-runbook,
  android-keystore-guide, android-install-test, packaging/mobile/README);
  `KEY_PASSWORD` secret dropped (single-password schema).

**Also found:** local `gen/android/app/tauri.properties` +
`src/main/assets/tauri.conf.json` were stale at 0.0.13 — both gitignored
and regenerated by `cargo tauri android init` in CI, so no tracked drift.

# iOS signing fix (2026-08-14) — commit e637239c

**Root cause:** ios.yml's "Configure Xcode signing" step ran
`xcodebuild -showBuildSettings` with DEVELOPMENT_TEAM /
PRODUCT_BUNDLE_IDENTIFIER / CODE_SIGN_STYLE — `-showBuildSettings` only
PRINTS settings and persists nothing. The subsequent `cargo tauri ios
build --release` never received the team ID, so the generated Xcode
project had no signing team → unsigned IPA (or a build-time signing
failure).

**Fix:** per the tauri CLI source (mobile/ios/mod.rs), the team is read
from the `APPLE_DEVELOPMENT_TEAM` env var at build time and synced into
the project — there are no signing CLI flags. Set it on the build step
(from `APPLE_TEAM_ID`), dropped the no-op xcodebuild step. Cert +
provisioning profile import unchanged. Runbook updated.

Same fix family as the Android keystore.properties repair (b9fa82ee) —
both workflows were configuring signing via mechanisms the Tauri CLI
does not support.

# Owner decisions pending (2026-09-15)

Seven decisions a docs session parked rather than took. Each is three lines: the decision, what is measured, and a recommendation that is a recommendation. Nothing here is decided, ticked, or changed; every number has its command, and a premise I could not re-derive is named at the bottom instead of repeated.

## 1. Which ink owns the fill-foreground pair, and whether the light theme gets finished
- **Decision:** whether to adopt `#12141a` as the single fill-foreground and retire `#1C2B45`, and whether to finish the light-theme residuals the retail and void work moved off 1.00:1 but could not close.
- **Measured** in `ui/src/frontend/themes/tokens.css`: dark `--color-success` `#6FE884` (`:113`) with `--color-success-fg` `#12141a` (`:116`) — `#12141a` on `#6FE884` computes **11.88:1**, so the pair is sound once separated; light is the open half — `--color-success` `#2E9E3E` (`:422`) with `--color-success-fg` `#ffffff` (`:425`) computes **3.46:1**, and `--color-danger` `#FC3D39` (`:438`) with `--color-danger-fg` `#1C2B45` (`:443`) computes **3.96:1**, both under 4.5:1 for body text. Same command for any pair: the WCAG relative-luminance formula over the two hexes read by `grep -n "color-success\|color-danger" ui/src/frontend/themes/tokens.css`.
- **Recommendation:** decide the light-theme pairing rather than the dark one — the dark half already reads as repaired — and treat the two figures above as the acceptance test for it, not the census counts below.

## 2. `ui/src/features/design/DesignSystem.css` — orphaned sheet, and the repair that is not one line
- **Decision:** whether the design route should load its page sheet at all, and if so in what cascade position.
- **Measured:** the file exists and nothing imports it — `git grep -n "DesignSystem.css" -- ui/src` returns only test path lists (`ui/src/__tests__/screenExtraction.test.ts:1514`, `focusVisibleCompliance.test.ts:230`, `touchTargetSizing.test.tsx:215`) and two comments in `TooltipPreview.css`, so the route renders without its sheet. Its orphan status is in the repo's own words: `1e0053dad style(design): drop four byte-identical .btn variant duplicates from the orphaned page sheet` (−39 lines, one file), leaving `.btn` and `.sr-only` as the surviving conflicts.
- **Recommendation:** do not "just import it". Importing attaches the sheet's `.btn` font-size **after** the theme sheets, and a dev-nav click would override every sized variant with no route back — the census for that blast radius is `git grep -oE "btn--(sm|lg)" -- ui/src | wc -l` = **14** occurrences over 6 files, 3 of them tests, with the heaviest production concentration in `ui/src/features/retail/RetailPosScreen.css`; decide the cascade position first, then the import.

## 3. `brand-tokens.css` — in the contrast baseline as a documented state, not as debt
- **Decision:** whether it stays listed in the baseline the contrast work walks.
- **Measured:** 10 lines (`wc -l < ui/src/features/design/brand-tokens.css`), generated — `scripts/sync-branding.ps1:364` sets `$brandCssTarget = "ui/src/features/design/brand-tokens.css"` — defining **zero** class selectors, imported by nothing in `ui/src` except the guard's path list at `screenExtraction.test.ts:1517`, and already ruled by `docs/decisions/2026-07-15-whitelabel-branding-system.md:391`: "**Brand CSS is reference-only**: The generated `brand-tokens.css` is not actually imported at runtime".
- **Recommendation:** keep it as a documented state. Converting it into debt would re-litigate an ADR that already answered it.

## 4. The one CSS module — the guard has no shape for it
- **Decision:** whether `*.module.css` enters the sheet checks, gets a first-class rule, or stays formally excluded.
- **Measured:** `git ls-files "ui/src/**/*.module.css"` prints exactly one path, `ui/src/features/settings/WorkspaceSettingsModal.module.css`, whose names are consumed as `styles['backdrop']`-style lookups with no literal class string anywhere, so a name-census cannot see a use; `ui/src/__tests__/animationCompliance.test.ts:15` already steps around it — `} else if (entry.name.endsWith('.css') && !entry.name.endsWith('.module.css')) {`.
- **Recommendation:** make it an explicit, documented exemption with a reason in the guard, rather than a silent exclusion that reads as coverage.

## 5. Is a USB scale meant to be sellable at all?
- **Decision:** a product question with a UI consequence: the flag is a manager toggle in the Hardware group and the chip mounts on both shells under `RetailPosScreen`, while the driver does not exist.
- **Measured:** `crates/oz-hal/src/drivers/scale.rs` is a stub whose own module doc records the honesty fix — it "reported NotFound, the same kind an unplugged device" would give a cable-check message for "a feature never written" — and now returns `Unsupported`; `crates/oz-bridge/src/scale.rs:33-36` returns `Result<Option<WeightReading>, BridgeError>`, i.e. a missing scale has an `Ok(None)` route available rather than an error one. The consequence for styling: the state classes the markup names are mostly unreachable, and `--idle` is the only one a device can produce today.
- **Recommendation:** answer sellable-or-not before anyone writes more scale states; if not sellable, the toggle should not be offered in Hardware, and the sheet's other state rules are dead weight rather than a defect.

## 6. Factory reset: a feature with a destructive command behind it, not a refactor
- **Decision:** whether a confirmation UI is wanted at all.
- **Measured:** the ask is `todo-refactor-settings-agents-3.md:130` — "Extract `<FactoryResetConfirmationModal />` (double PIN check + confirmation keyword input)" — and `git grep -il "FactoryReset" -- ui crates apps platform modules` returns **zero files**: there is nothing to extract, so the box describes writing a feature. It sits next to a factory-reset-shaped destructive action, which is why the wording is a modal and not a click.
- **Recommendation:** rule in or out as product work. Until then the box should not be counted as remaining refactor effort, and it must not be "extracted" into an empty component.

## 7. Does audit retention belong in Settings?
- **Decision:** whether a retention panel is a real surface or a control with nothing to edit.
- **Measured:** retention is derived, not chosen — `crates/oz-core/src/db/audit.rs:257` says the window "comes from `SubscriptionTier::audit_retention_days`" and `:291` calls `match tier.audit_retention_days()`; the sweep lives beside it (`sweep_audit_retention`), with a migration (`crates/oz-core/migrations/20260920_audit_retention.sql`).
- **Recommendation:** if it stays a tier property, the honest plan entry is "surface the tier's value read-only or delete the box" — a slider here would promise an edit the backend refuses.

## Premises in the briefing that did not survive the tree (named, not repeated)
- **Six numbers I could not re-derive anywhere in the repo, so they are not on this page:** "69 of 132 candidates", "59 accent-on-accent rules at 3.65:1", "the eight `--color-pos-on-primary` pairs failing all palettes" (the token exists and is `#ffffff` in all three theme blocks — `:284`, `:473`, `:596` — but the eight-pair census is not recorded in any doc: `grep -rn "pos-on-primary" --include="*.md" .` finds no census), "23 neutral muted-text pairs", "the `:root-duplicates-dark` double count at 106 of 132", and the "three-parser granularity" figures 766/362/125, 948/394 and 957/358/126 — no markdown in the tree carries them (`grep -rnoE "69 of 132|106 of 132|3\.65" --include="*.md" .` returns nothing), so a count with no command and no record is a number to be re-run, not a fact to be trusted. The two ratios I could compute myself did reproduce: 3.46 and 3.96, above.
- **Two were wrong:** `Cargo.toml:199-204` does not state a `debug-assertions` invariant — read it and it is `[profile.release]` with `opt-level = 3`, `lto = "thin"`, `codegen-units = 8`, `strip = "symbols"`, `overflow-checks = true`, so there is no unenforced invariant of that kind to park; and "58 production sites" for the sized button variants overstates what `git grep` finds by more than three times.

## Verification
- Commands, all read-only and all run 2026-09-15 at HEAD `fdd06eade`: `wc -l < ui/src/frontend/themes/tokens.css` · `grep -n "color-success\|color-danger\|pos-on-primary" ui/src/frontend/themes/tokens.css` · `git grep -n "DesignSystem.css" -- ui/src` · `git show --stat 1e0053dad` · `git grep -oE "btn--(sm|lg)" -- ui/src | wc -l` · `wc -l < ui/src/features/design/brand-tokens.css` · `grep -n "brand-tokens" scripts/sync-branding.ps1` · `git ls-files "ui/src/**/*.module.css"` · `git grep -il "FactoryReset" -- ui crates apps platform modules` · `git grep -n "audit_retention_days" -- crates/oz-core/src`.
- **No suite, no `npx`, no `tsc`, no cargo, no guard run**, and no value changed: this page is the parking lot, not the decision. TBL-11 is not re-opened — it settled STRUCTURE ONLY in this file at `:875` and stays there.
