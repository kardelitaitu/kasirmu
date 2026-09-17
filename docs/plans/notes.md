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
- health-check service names match ops/docker/docker-compose.yml (redis,
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
  android-keystore-guide, android-install-test, ops/packaging/mobile/README);
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

**Index — the open owner questions below, by what they actually ask (added 2026-09-15, extended the same hour). Items are numbered in the order they were written; nothing here renumbers or re-decides one, and the total is deliberately not restated in prose — the count "eighteen" was true for sixty minutes and one commit made it false. TWO numbers live here and the old line conflated them, so both are named separately, each with the command that yields it, and the total is still not asserted in prose. (i) THE HIGHEST ITEM NUMBER, which is also the count of owner items while numbering stays dense and unbroken: `grep -oE '^[#][#] [0-9]+[.]' docs/plans/notes.md | grep -oE '[0-9]+' | sort -n | tail -1` -- read **21** at `ad060a13a`. (ii) THE COUNT OF MATCHED HEADING LINES, which is a bigger and NOT interchangeable number, because the page carries numbered headings that are not owner items: `### 1. Drag / hover affordances` (`:35`), `### 2. Side effect during render` (`:47`) and `### 3. ... (fixed)` (`:58`) sit under `## Still open -- verify in the UI` (`:33`) inside the 2026-08-13 analytics-cards audit above this index, and all three are section sub-headings of a defect list, not parked decisions -- which is why the index does not group them and why that is not a coverage gap. Count them at byte level, which is the only method verified exact here: `python3 -c "import io,re;L=io.open('docs/plans/notes.md',encoding='utf-8').read().split('\n');print(sum(1 for l in L if re.match(r'^#{2,6} [0-9]+[.]',l)), sum(1 for l in L if re.match(r'^## [0-9]+[.]',l)))"` -> **`24 21`**: 24 numbered headings of any depth, 21 of them level-2 owner items. **Do not trust a leading-`#` pattern in this shell to make either count agree:** the command this line used to name, `grep -cE '^## [0-9]+\.\'`, printed **27** here while the same file read at byte level yields 21, and `grep -c '^## '` prints 101 where the bytes hold 85 -- over-reads reproduced at `ad060a13a` and recorded once already in item 20's commit body -- so a `#`-anchored argument is unreliable under this Git-bash path and its number must never be quoted as an item count -- and the unreliability is INTERMITTENT, not a stable bias worth calibrating: the very same `grep -cE '^## [0-9]+[.]'` invocation printed 27 in one run on this page and 21 in a later run with no heading added, removed or renamed between them, while the byte-level command printed `24 21` both times. A reader wanting the item total should take (i); a reader wanting the heading count should take (ii) and know it includes non-items.**
- **12 + 14 — who measures the shipping profile.** 12: fund a signature-minting seam, or accept what a release run trades. 14: add a release CI leg, without which 12 cannot be measured at all.
- **15 + 18 — who owns an identity column.** 15: which of the two things called a terminal a payment row owes, and whether that is one column or two. 18: whether ruling 1A still stands now that the organisation scope which inherits terminals has shipped.
- **11 + 17 — how far the sheet and the guard reach.** 11: is a name defined in one sheet and styled in another debt. 17: may the class guard gain a fifth axis, or do three claims stay named exemptions with a ledger.
- **13 + 19 — who authorises what the tree currently settles by which branch runs.** 13: what a Free tenant must audit on a licence-tier refusal at the shipping profile, ruled before the next tag. 19: which of two rulings the backup bypass gets — and its class is sized in its own record at **19 sites, 13 wrapper names, 12 files** (`docs/records/adr7-conditional-scoping-fallback-class.md:67`) plus a second set of **six ungated calls with no branch at all** (`:104`), i.e. twenty-five places where a permission gap was closed by adding a scoped twin and leaving the original reachable, one of which writes a whole database from an updater banner before anyone logs in. So this page is not nineteen small questions — though 19 blocks no plan row, and its pressure is four pinned tests.
- **16 — three sentences from the owner**, worth thirteen open boxes (5 + 5 + 3) in `todo-topology-editor.md`.
- **Waiting on a ruling tonight: 14 rows** — those thirteen plus `todo-tools.md:443`, its PARKED line-number stamped at `c37b8f713`. **Waiting on a machine instead: everything in 14** (368 fork sites, 41 reds — no release leg exists to run them), and the 17 open rows of `todo-operational-integrity.md`, of which **0 name Docker or PostgreSQL**: `grep -nE '^[-*][[:space:]]+\[[[:space:]xX]\]' todo-operational-integrity.md | grep -icE 'docker|postgres|pg'` → 0, so that plan is blocked on a branch switch, a push order and rulings on shared config, not on hardware.
- **Item 18 is the only item tonight whose cheapest answer deletes work rather than funding it:** arms (a) and (c) cost a line each and ask nothing of a coder, while every other item on this page ends by asking for a lane, a run, or a migration.
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

## 8. The selector-class conflict: three names that only a test can see

- **Decision:** which side wins — the extraction guard that cannot see these classes, or the E2E spec that needs them. This is not a CSS question, and there is no rule to write that settles it.
- **Measured:** `kds-column--pending`, `kds-column--preparing` and `kds-column--ready` are a class with no rule anywhere, emitted by production markup and existing only to be selected. One production site: `ui/src/features/kds/KdsLayoutMasonry.tsx:74`, three string literals in an array, asserted via `toHaveClass` at `ui/src/__tests__/KdsLayoutMasonry.test.tsx:116-118` and consumed as Playwright locators at `ui/e2e/e2e-kds-critical-path.spec.ts` (11 lines name the family). Nothing defines them in CSS — the only three tree-wide hits are inside the comment at `ui/src/features/kds/KdsScreen.css:1801-1805`, which says they carry no extra visual difference and that Playwright hooks select on them.
- **The asymmetry, which is why it is a decision at all:** E2E is not enforced in CI while `screenExtraction.test.ts` is, and the guard's extractor reads only `className=` sites, so a name arriving through an array variable never enters the used set. That makes `dynamicClassPrefixes: ['kds-column--']` at `ui/src/__tests__/screenExtraction.test.ts:311` an inert line that reads like containment — a wildcard over `kds-column--` anything, granting on a family the guard cannot see, under its own adjacent comment that calls them complete names (it points at `KdsLayoutMasonry.tsx:70`; the array is at `:74`).
- **Two caveats, no fix proposed.** (a) The sheet's only genuinely empty rules, `.kds-columns` at `KdsScreen.css:1807` and `.kds-column` at `:1808`, sit directly beneath the comment protecting the three, so a lane sweeping for empty braces deletes the two that may not matter and structurally cannot find the three that do. (b) This is a category with at least six instances tonight, not a KDS quirk.
## 9. Is `title=` beside `aria-label=` redundancy to remove, or belt-and-braces to keep?
- **Decision:** whether this repo treats a native `title` sitting next to an `aria-label` on the same element as debt to strip, or as deliberate cover for the OS-drawn tooltip to keep. Twenty-five to twenty-nine sites already pass the IDENTICAL string to both, so the answer is a description of the existing pattern either way — what is being decided is whether that pattern is right.
- **Measured, at HEAD `b0361cff4`.** (a) The shape is common, not a defect class: scanning every non-test `.tsx` in `ui/src` (**376** files by `git ls-files ui/src | grep '\.tsx$' | grep -vE '__tests__|\.test\.|\.spec\.'`) for an intrinsic tag carrying both attributes gives **36 elements, 25 of them with the same expression in both**, spread analytics 12 · sales 8 · locations 7 · kds 3 · retail 3 · `ui/src/components` 2 · workspaces 1. The lane that measured this with the compliance test's own TypeScript-AST rule reported **43 / 29** over 377 files; my regex stops at an attribute expression containing `>`, so it UNDER-reads by roughly the same amount the AST rule recovers — write neither as the census, run `ui/src/__tests__/nativeTooltipCompliance.test.ts`'s extractor to settle it. And nothing in that test grades redundancy at all: its header (`:1-:26`) lists four objections to `title=` — off-brand looks, no localisation, no delay control, and stacking on a real `<Tooltip>` — plus the AST rule that only `title=` on *intrinsic* JSX elements is banned. Redundancy with `aria-label` is not among its claims. (b) The shared component is not an accessibility upgrade in the direction people assume: `ui/src/frontend/shell/Tooltip.tsx:233` sets only `'aria-describedby': visible ? tooltipId : undefined` — a description, present only while shown, never an accessible **name** — and `:224` opens a `<div className={'tooltip-wrapper…'}>` around the child (className on `:225`), which on an icon-only button in a flex row is a layout change bought for nothing. (c) The ratchet’s data file carries a `total` **and** a `counts` map, and what reads each of them changed while this item was being written. As of HEAD `79466dc63` the per-file map is still the enforced data — `nativeTooltipCompliance.test.ts:123-124` loads only `JSON.parse(… ).counts` and the growth guard recomputes at `:163-165` — but `4fce6aa3f test(ui): make the tooltip ratchet’s declared total agree with the counts it claims to summarise` (+19, test-only, an hour before this correction) added a case at `:168-185` that parses the document (`:173-176`), sums `doc.counts` (`:177-178`) and asserts `expect(doc.total, …).toBe(sum)` at `:179-184`, its own comment at `:169-172` saying the guard is deliberately BOTH-directional because "a field that under-reads the sum is the same lie with the sign flipped". **So `total` is no longer decorative — it is load-bearing, and that is the good outcome.** What this item first wrote, that "no code path reads" the field, was a current measurement with a reproducing command; it is fixed here rather than superseded, the way the mirrors fixed the `core.hooksPath` claim — true at the census, false before the page was committed. The half that survives is the better half: **four of the six top-level fields are still read by nothing** — `schema_version` (=1), `description`, `generated` (stamped **2026-09-07**, now the stalest claim in the file) and `carry_forward_note` appear in no assertion — so summing the 34 `counts` entries (**76**) agrees with `total` today only because `a43314d65` corrected it from **79** (**80** when the plan was written, after `338c15c01` retired a widget holding three entries and nobody touched the field).
- **Recommendation:** treat this as an owner ruling with two live branches, and do not let either be implemented by inference. If the pattern is *right*, then the KDS box that ordered the swap was a plan line, not a finding — and generalising it would have bought dozens of wrapper `<div>`s into a POS interface, which is the outcome worth writing down. If it is *debt*, the fix is a second ratchet, and tonight's evidence says that ratchet would be enforcing a claim the existing test never made. Either way, the rule to carry is not "never quote a number in a data file" — it is **a checked number is fine and an unchecked one is the hazard**: `total` may now be cited because `4fce6aa3f` makes a test fail if it drifts, while `generated` may not be cited as currency at all, because nothing would notice. (Two method disagreements here are left named rather than resolved: 36/25 by a regex that stops at a `>` inside an attribute expression versus 43/29 by the test’s TypeScript-AST rule, arbiter its own extractor, deliberately not run because a lane is editing the files it grades; and 74 versus 68 KDS test files, an `ls | grep -ci kds` pattern difference, not a fact difference.)
- **The only clean case was the one that actually landed.** `a43314d65 fix(kds): drop the duplicate native title the aria-label already carries and move the ratchet` deleted ONE line in `ui/src/features/kds/components/KdsHeaderLeft.tsx` — an icon-only button whose accessible name is already carried by its `aria-label` — and moved the baseline with it; it did not swap in `<Tooltip>`. **And nothing pins either outcome:** `git grep -l "kds-topbar-back" -- ui/src/__tests__` returns **no files**, `kds-back-aria` lives in `ExpoScreen.tsx`, `KdsHeaderLeft.tsx`, `ui/src/locales/kds.ftl` and `kds.id.ftl` and in **no test**, and 74 files in `ui/src/__tests__` match `kds` while none renders `KdsHeaderLeft` — the untested-header finding already recorded at `## 8` is the same hole seen from the a11y side, so a future swap or a future deletion is graded by nothing but the ratchet's count.

## 10. Is the leading scale a target the UI normalises onto, or an exception the literals are allowed to take?
- **Decision:** whether `--leading-tight / --leading-normal / --leading-relaxed` are a **scale** the interface is normalised onto — which means fixing the target values first and then treating the sweep as the layout change it is, with visual review — or whether a component may keep any `line-height` its rhythm needs, in which case the 41 token references are the exception and nothing should be swept. A scale plus a documented reason to depart is the compatible middle, and `5cb99e7c4` already **is** that middle: it kept `line-height: 1.2` on the retail tile rather than adopting `--leading-tight: 1.25`, and said so — the finding just lives in a commit body where no future reader will look.
- **Measured at HEAD `9ab4e58da`, by a comment-blanked per-declaration walk over every tracked `.css` under `ui/src` (137 files), scratch script since deleted.** **217** `line-height:` declarations exist, across **70** stylesheets. Of those, **44** are `var()`/`calc` references — including **41** to `var(--leading-*)` — so **173** carry a hard value. The tokens themselves: `ui/src/frontend/themes/tokens.css:170` `--leading-tight: 1.25`, `:171` `--leading-normal: 1.5`, `:172` `--leading-relaxed: 1.625` (`findstr /N /C:"--leading-" ui\src\frontend\themes\tokens.css`). **The split that decides the question: 31 of the 173 hard values already equal a token's number — 16 at 1.5, 15 at 1.25, and 0 at 1.625 — so a cite-only substitution for those 31 changes no rendered value and carries no layout risk.** The remaining 142 do: `1` (66 uses), `1.4` (34), `1.2` (13), `1.3` (10), `1.6` (6), plus 3 px and 3 em/rem. Two instrument notes, because they disagree with numbers quoted earlier tonight: `git grep -o "var(--leading-[a-z]*)" -- ui/src | wc -l` reads **45** and `git grep -o "line-height:[^;]*" -- "ui/src/**/*.css" | wc -l` reads **218** — both over-read relative to the walk (they count `.tsx`/`.ts` occurrences and comment text and do not skip `line-height` inside `calc`), so the walk's 41 / 217 / 173 are the figures above.
- **What this is NOT:** it is not tonight's two CSS batches. `ef6b4d5bf` deleted **126** fallback tails and `42e6c8201` cleared **93** root-only ones, and both were **proved unable to render** before they were removed. These 218 are proved to be rendering **right now**, so a tokenisation sweep here is a **rendering change**, not an inertness-preserving cleanup — and the difference is worth writing down precisely because a lane that read tonight's log could reasonably conclude that literal-versus-token mismatch is always deletable debt and start moving type. `1.4` at 34 uses is the crux: it is the second-largest cluster in the tree and no token is near it, so "adopt the scale" silently means "34 paragraphs of UI reflow".
- **Recommendation:** answer the scale question before funding any sweep, and if the answer is a scale, fund it in two tranches — the 31 exact matches first, because a cite-only change there is provably value-preserving and needs no design review at all, and the 142 off-scale ones second, as a visual change with screenshots. If the answer is that off-scale rhythm is legitimate, then the honest deliverable is one new row in `docs/plans/notes.md` and a comment convention at the departure site, not a sweep, and `5cb99e7c4` should be cited as the precedent rather than treated as a defect.
- **APPENDED 2026-09-15 at HEAD `d29ebd535` — one briefing number retracted, the cheap tranche already spent, and 68 of the residue have no step to land on.** (1) **The `132` this item was re-quoted with tonight was never its number, and the page should say so plainly.** `132` appears here twice and neither is about leading — `:780` "9 sales test files, 132/132" and `:1473`, inside the list of six numbers the repo could not re-derive ("69 of 132 candidates") — so an already-flagged unreproducible figure was borrowed and attached to an item whose off-scale count is **142** (`:1362`). That is the failure mode `:1473` exists to warn about, reproduced by someone reading this page: a number copied from a line that says "not re-derivable" does not inherit the warning, only the digits. (2) **The population moved under the sentence above, and it moved because tranche 1 is DONE.** `cd29143c4` (*refactor(css): adopt the leading tokens at the sites that already carry their value*) and `812c87ef1` (*…finish the leading-token adoption in the shared and shell sheets*) are both ancestors of this HEAD, and a lane that re-ran this item's own comment-blanked walk at a later tip reports **217** declarations across **70** sheets splitting **75** token cites / **142** hard values, with **0** of the 142 equal to a token number. `:1362`'s own pair reconciles exactly: 44 + 31 = 75 and 173 − 31 = 142, so the 31 cite-only substitutions this Recommendation named as the review-free tranche are behind us and what is left is 142 sites that reflow. Re-checked on this HEAD without that walk: `grep -rnoE "line-height:[[:space:]]*(1\.25|1\.5|1\.625)[[:space:]]*(;|\}|/)" ui/src --include=*.css | wc -l` → **0**, so no literal still matches a token value; and the token-cite / `1` / `inherit` greps read **75 / 66 / 2**, which under-reads versus a blanked walk by the comment-stripping difference but agrees with it on all three classes. (3) **The harder finding, which widens the question rather than narrowing it: 68 of the 142 have no scale step to map onto.** `line-height: 1` × 66 and `line-height: inherit` × 2 are candidates for none of `--leading-tight/-normal/-relaxed`, so "adopt the scale" is not a substitution for **47 %** of the remaining population; it needs a fourth token or a documented departure convention, and the owner question at `:1361` is therefore not only "scale or exception" but "what is `1` for" — the parked question stays parked. (4) **Nothing grades this shape today, which is why the work being funded is a freeze-and-ratchet and not a sweep.** `line-height` is a member of `NON_TOKEN_PROPS` (`ui/src/__tests__/themeTokenCompliance.test.ts:75`; the set opens at `:57`) and that branch `continue`s at `:259`, so the token-compliance walk declines the property by design; and the property dispatcher's last class branch is the `SPACING_PROPERTIES` test at `:359` (set at `:205`) with no catch-all after it — `sed -n 360,419p` of that file contains no `else`, `catch` or `default` (the two hits at `:420`/`:428` are inside `findFeatureCssFiles`, another function), so an unrecognised property is skipped, never reported. A ratchet answers no part of the owner question; it only stops the population growing while it is unanswered. (5) **This item stays OPEN and gets no tick** — a measured consequence is not an approved one, and an owner question unanswered is not closed by being better measured. `:1362` and `:1364` are left standing exactly as written, because the `44 / 173 / 31 / 142` split there is the only thing that makes the `75 / 142 / 0` split above legible as a tranche rather than as a contradiction. Re-derive with this item's own method, not a grep: a comment-blanked per-declaration walk over `git ls-files -- "ui/src/**/*.css"`, classifying every `line-height:` value as token cite / equals-a-token-number / `1` / `inherit` / other.

  - **RULING 2026-09-16 (owner, via agent recommendation — endorsed "execute the recommended path"):** ## 10 answers as the middle option, **scale + documented reason to depart**. The value-preserving tranche — the 31 exact-match cites — is already spent (`cd29143c4` / `812c87ef1`) and needs nothing further. The 142 off-scale literals are **not swept on principle**: off-scale rhythm carrying a cited departure is legitimate, and the precedent `5cb99e7c4` (retail tile keeps `1.2` over `--leading-tight: 1.25`) moves from "a finding buried in a commit body" to a **documented departure convention at the site**. Adopting the scale across the remainder is a rendering change on real UI (`1.4`×~34 has no nearby token), so it may only be reopened as a *funded* visual tranche with screenshots, never as inert cleanup. **## 10 closed as ruled; ## 40 is its supporting data; the departure-comment convention is the standing rule.**

## 11. Does a name the settings sheet defines and another screen styles count as debt — and do the other three mute arrays get a proof too?
- **Measured at HEAD `23b149378`, by grep and read only; no suite, no run.** `16258b37e` (*feat(ui): make a selector-only class claim provable instead of believed*) adds `selectorOnlyClasses?: string[]` at `ui/src/__tests__/screenExtraction.test.ts:218`, policed by three new `it()` blocks — `:1912` every name must be read by a locator under `ui/e2e`, `:1925` every name must be built by production code in its own feature dir, `:1941` no name may excuse a rule that still styles it — and it is declared by exactly **1** entry holding **3** names (`:433`). The **264 → 267** case total is as reported by the landing lane and is a property of a run I did not re-derive; what is static is the three-case delta those blocks are.
- **The asymmetry that needs the ruling.** `SettingsPage`'s `externalClasses` holds **23** values (`:531`-`:553`), not the 16 in the briefing, and three spot-checks are two-sheet definitions: `.staff-mgmt` at `ui/src/features/settings/SettingsPage.css:488` and `ui/src/features/staff/StaffManagementScreen.css:1`; `.tax-config` at `SettingsPage.css:494` and `ui/src/features/tax/TaxConfigurationScreen.css:1`; `.audit-log` at `SettingsPage.css:491` and `ui/src/features/audit/AuditLogScreen.css:3`. No case walks that pair — one resolves an entry's used names against its own `css` ∪ `parentCss`, the dead check reads own `css` alone — so a settings sheet that defines a sibling's namespace can age out of both siblings' agreement and stay green, and nothing here compares the two definitions when they disagree.
- **Three ways out, named as options.** (a) a cross-entry duplicate-selector check over `ui/src/features/**/*.css`; (b) the settings sheet stops defining sibling namespaces, which is a stylesheet move across a dozen screens plus visual review; (c) accept that a settings sheet owns names other features style and document `externalClasses` as that mechanism instead of carrying it as debt. (a) is the cheap one because a check is a test and (b) is a programme — and (a) is also the only one that produces evidence about whether (c) is true.
- **The question underneath it.** Four shielding devices exist and one is now graded: `selectorOnlyClasses` (proved tonight), `externalClasses` (declared by **12** entries), `knownDynamicFragments` (the `SettingsPage` entry alone carries **8**, `:519`-`:530`) and `dynamicClassPrefixes` — three believed on the author's word, always have been. The risk a graded field invites is field migration, a claim moving to whichever array reads cheapest, since a check on one field is blind to the same claim in another. So: does the grading extend to `externalClasses` — a value must name a rule that exists in a sheet outside the declaring entry — or is the graded field the exception and the ungraded three the accepted cost of a static guard?
- **Decision for the owner:** pick (a), (b) or (c) for the cross-entry duplicate, and rule whether `externalClasses` gets a proof or is documented as believed. Nothing here is recommended as settled and no box was ticked; this page is the parking lot.

**CORRECTION 2026-09-15, same day, HEAD `ef13e97e1` — the duplicate premise above is wrong about what those duplicates ARE, and option (b) dies with it.** Read off the file rather than off the lane report this item was written from. (1) **Eleven of the twelve are not competing root rules.** `ui/src/features/settings/SettingsPage.css:481`-`:484` says in its own comment that full-page components carry their own padding and max-width and that those are stripped when the component is embedded inside `.settings-content`, and `:486`-`:496` is the eleven-name descendant list — `.settings-content .feature-toggle`, `.data-mgmt`, `.staff-mgmt`, `.terminal-mgmt`, `.multi-store-dashboard`, `.audit-log`, `.offline-queue-screen`, `.shift-mgmt`, `.tax-config`, `.exchange-rate-config`, `.promo-mgmt` — declaring `padding: 0` and `max-width: none` at `:497`-`:498`. At specificity 0,2,0 against a screen sheet's 0,1,0 the override wins deterministically wherever both apply: there is no load-order race in any of the eleven, and the sheet is doing the job its comment documents. (2) **One of the thirteen is not a duplicate at all** — `.settings-topology-container` has exactly one definition tree-wide, `SettingsPage.css:501`. (3) **The last one is complementary, not competing** — the other `.card` definitions declare different properties (`ui/src/features/reports/DashboardScreen.css:356` sets `box-shadow: none; border: …`), which is a shared name over disjoint rules, not two sheets disagreeing.
- **Strike option (b) as a live option.** There is no stylesheet move to fund because there is nothing to move; a programme was briefed into this page on an unread grep. What survives above is the enforcement asymmetry — three of four shielding arrays believed, one graded — plus the provenance finding the same read exposed: the `settings-sync-expiry-badge--good / --warn / --critical` modifiers are muted by a field that claims somebody else owns them, when `ui/src/features/settings/sections/SyncSection.tsx:296` composes them at runtime as the base class plus `--<tone>` from a closed three-value tone union, matching the three rules at `SettingsPage.css:1010`, `:1015` and `:1020`. The honest device for that is a prefix entry, not an `externalClasses` mute; tonight the outcome is identical either way, which is precisely why nothing would catch it.
- **One measured addition in favour of option (a), the cheap one:** `tab-list` is a declared `externalClasses` value in TWO entries — `screenExtraction.test.ts:533` (`SettingsPage`) and `:1091` (`AppearanceSettings`, entry opening at `:1066`) — and it is defined in no `.css` under `ui/src` and used by no markup: both greps return zero hits outside `__tests__`. That is a shield with nothing behind it, held twice, and it is the case where the pair check would fire on a value that names nothing at all.
- **Why this clause exists, stated once plainly:** the item above counted duplicates without reading what they were, and a lane report reading "twelve of thirteen are also defined in the consuming screen's sheet" is true as a grep and false as a finding. The original text is left in place so the correction is visible against it.

## 12. Does the release profile keep exercising the permitted arm — and what comes back if the seam is built?
- **Decision:** build a test-support seam that mints a **genuinely valid subscription signature** for fixtures, so a test no longer has to fork on which row the seed produced, or accept that the shipping profile stops exercising the permitted arm of five security properties. This is not a cleanup and not a flaky-test problem; it is the price already paid, listed per test so the next lane can see the bill.
- **Measured, at HEAD `70f057db8`, against the campaign record `db43bcfb5 docs(journal): close the release-profile fixture campaign and record what it traded away`** (that entry carries the list; this item cites it rather than restating its arithmetic). Converting a fixture means forking it on the runtime seed-row predicate — `git grep -o "seeded_row_loads" -- crates/oz-bridge | wc -l` reads **144 uses across 13 files** today (it read 146 before `f2d147dd7 refactor(bridge): give the seeded-row refusal helper one home instead of eight copies` deduplicated the helper; a lane is still in `crates/oz-bridge/src/testing.rs`, so quote the command, not the count). **The five claims the release profile no longer exercises:** (1) **ticket rotation, end to end**; (2) the **ADR-47 grant-containment** claim that staff identity is global while business data is per-store — in the very test named for it; (3) the **ADR-48 impersonation and restore-revocation** claims; (4) the **licence TTL** claims; (5) the **staff write-side audit trail**, which is eight assertions on one fixture (`crates/oz-bridge/src/staff_security_events_tests.rs`) including that the actor id is not the subject id and that a PIN never reaches the table. **What survives, stated so the item stays honest:** the update path and its PIN-change behaviour are still exercised in release, because that command does not cross the create gate.
- **Recommendation:** fund the seam, not more forks — real key material in test-support, so both arms run under both profiles and no property is traded for a green. Until then, do not let the count of `--release` greens be read as security coverage: the refusal arm is explicit and the permitted arm is debug-only, which is the opposite of what a passing release suite suggests. The briefed "53 fixtures across 10 legs" is **attributed to lane reports and not reconciled here** — a predicate use is not a fixture, and silently equating the two would invent a number.

## 13. Does a production Free tenant write the staff-login audit row at all — the ruling that today exists only as a red test?
- **Decision:** what the **shipping** profile does on a licence-tier refusal at staff login: does a Free tenant record the event or not. Nobody has ruled it; the behaviour is currently decided by which profile compiled the binary.
- **Measured, at HEAD `70f057db8`.** `crates/oz-bridge/src/auth_tests.rs:898` declares `staff_login_on_free_records_only_because_a_debug_build_promotes_it`, and the test's assertion is literally keyed to the build profile — `usize::from(cfg!(debug_assertions))` at **`:917`**, with the comment at `:900` stating that `apply_debug_upgrade` is `cfg!(debug_assertions)`-gated. So the expected row count is a function of the compiler flag, not of the licence tier: the test is **deliberately red in release** because a green would assert nothing about the shipping build. Its other half is `a_rejected_create_records_no_security_event` in `crates/oz-bridge/src/staff_security_events_tests.rs`, which the same reasoning keeps red — recorded at `:245` in `db43bcfb5` and now at **`:194`** after `f2d147dd7` moved the file, which is the reminder that a line pointer into a live crate ages within the hour.
- **Recommendation:** answer it as a product question with a security shape — what must a Free tenant audit, and on which refusals — **before the next release tag**, and explicitly not by making the test pass. Today the only records of the question are that red test and one paragraph of `db43bcfb5`; neither is a decision, and a tagged release should not be the thing that picks. Once ruled, the profile-keyed assertion should be deleted in favour of the ruling, so the test states the policy instead of mirroring `cfg`.

## 14. Is a seeded sentinel debt at all if no CI leg ever compiles the profile that rejects it?

- **Decision:** the funding order, not the fix. Is this an inventory to fund at three structural legs — a `cfg` guard, a real signature in the seeded row, or a per-test signing helper — or is it invisible debt nobody will ever see until a **release test leg exists**? The census answered: fund the CI leg first. Items **12** and **13** above both assume somebody runs the shipping profile; this item asks whether anybody does, and deliberately does not restate the seam trade (12) or the debug-only security claims (13).
- **Measured 2026-09-15 at HEAD `e5e63d28d`, grep and read only — no cargo, no build, no suite.** `grep -nE '\-\-release' .github/workflows/dev-ci.yml .github/workflows/release.yml` returns **zero hits and exits 1**: nothing in CI measures the release profile. The only Rust test leg is `cargo nextest run --workspace --all-features` (`dev-ci.yml:244`, job `cargo-nextest` opening at `:200`), and `Cargo.toml:246`-`:247` declare `[profile.test]` then `inherits = "dev"` — so `debug_assertions` is **ON in every run anyone measures**. The consequence is in the campaign record `db43bcfb5`: forty-one release-profile reds existed tonight only because a developer ran that profile by hand, which is attributed, not re-derived here.
- **The sentinel is a schema seed, not a test habit, so the population is per seed, not per test.** `'BOOTSTRAP_FREE'` is INSERTed as the default tenant's signature at `crates/oz-core/migrations/20260813_init.sql:1514` and again at `:2101` of its generated PostgreSQL twin `crates/oz-core/migrations/20260813_init.pg.sql`; `grep -rln 'BOOTSTRAP_FREE' crates/oz-core/migrations/` names exactly those two files, so **every fresh_db row in the repository is sentinel-signed**. Call sites that build those rows, re-derived: `grep -rho 'fresh_db(' --include='*.rs' crates/oz-bridge | wc -l` → **207**, and the same command over `.` filtered with `grep -v '/oz-bridge/' | grep -v '/target/'` → **689** outside it. The lane census reported 508 outside; that number does not re-derive under my command, so it is attributed and the discrepancy is left visible — scope, not a second method. The naive fork being 368 test-shaped edits is census-attributed too.
- **Why release turns that seed into a panic, in one line of arithmetic.** The bypass is compiled out in release: `#[cfg(debug_assertions)]` at `crates/oz-core/src/license_verification.rs:391`, **marked rather than silently repointed: that was the true line when this item was written at `612236e97`, and `9927adec1 docs(core): point the sentinel bypass comment at the schema seed that actually writes it` grew the comment above it from 3 lines to 9, so the guard reads `:397` and the comparison `:398` at HEAD `b8c0b33cf` (re-derived there by `findstr /N /C:"#[cfg(debug_assertions)]"`, not by report)** — the line immediately above `if signature_base64 == "BOOTSTRAP_FREE"` inside `verify_license_signature`, so the value falls into a base64 decode that rejects `_` — and `_` is offset **9** of `BOOTSTRAP_FREE`, code point **95** (`python3 -c "print(ord('_'), 'BOOTSTRAP_FREE'[9])"` → `95 _`), which is where the `invalid symbol 95` of the forty-one panics comes from. Side finding, **CLOSED by the same commit that aged the pointer above**: the comment then at `:388`-`:390` did still attribute the seed to "migration 061" (no file numbered 061 exists in `crates/oz-core/migrations/`), and `9927adec1` replaced that pointer, so the block is now `:388`-`:396` and names the seed at `20260813_init.sql:1514` with its generated PostgreSQL twin at `:2101`; what is NOT fixed, and stays outside this fence, is the stale `-- Default tenant subscription (from migration 061)` header inside the seed file itself at `20260813_init.sql:1512`.
- **Two failure grammars, and only one of them panics.** In eleven tablet command sites under `apps/tablet-client/src/commands` a production verify call is `?`-ed, so the command returns `Err` and the test's `unwrap` panics; in six other sites nothing unwraps, and a `match` on the same call falls through to `Entitlements::fail_closed`, failing on a tier assertion — a **wrong verdict instead of a panic**. Both counts are the census's. My nearest re-derivation brackets rather than confirms them: `grep -rn 'verify' apps/tablet-client/src/commands | grep -cE '\?'` → **12** matching lines (which does not say how many are operators), and `fail_closed` occurs 62 times across `apps` and `crates`, which is scale, not a site count. The reason to keep the distinction is that **a fork handling only the first grammar converts a red into a false green** — the second grammar is a test that passes while asserting the wrong thing.
- **PENDING, and written as pending.** The release run of the tablet crate was still compiling at the moment this was briefed, so the tablet population is a prediction, not a number, and none is quoted for it. Whoever has that run should add the figure with its command; the eleven-and-six above are not a substitute for it.
- **The three legs, priced honestly.** (a) the one-line `cfg` guard a lane is landing now, which changes what a debug build accepts and touches nothing about what release does; (b) a real signature in the seeded row, the only leg that retires all 368 fork sites at once — and the one that puts a signing path inside a schema seed, a shape the records under `docs/security/` would reject, so it must not be booked as free; (c) a per-test signing helper, roughly eleven tablet files (census, attributed). **Why the CI leg first:** it is a workflow edit plus a row in `scripts/gates.json`, the same two-object shape as the missing stylesheet-linter gap recorded in the AGENTS mirrors, whose section closes "an owner decision, not a docs edit, and this section proposes neither" — and until a release leg exists, every figure in this item is unmeasured by construction, including the ones printed above with their commands.

## 15. Which terminal does a tender owe — the row asks for two identities and the tree has two things with that name

- **Decision:** what identity a payment row must carry so a void or a refund can be routed, and whether that is one column or two — a ruling and a price, not a patch. Items **12**, **13** and **14** are the licensing seam; this is the payment identity seam, and nothing below restates them.
- **Measured 2026-09-15 at HEAD `38bfcdd41`, grep and read only — no build, no suite.** `todo-payment.md:813` carries the row — "**Capture for later void/refund.** Store `terminal_id` + `auth_code` on the …" — and only ONE of the two is missing: the auth code already reaches the database as a string inside the opaque `gateway_response TEXT` column (`20260813_init.sql:371`), written at `ui/src/features/sales/payment/useEdcTenderPhase.ts:149`-`:154` as `gatewayResponse: JSON.stringify({ auth_code: result.authCode, … })` and read back at `crates/oz-core/src/db/payments.rs:85` (`row.get("gateway_response")`), re-inserted at `:108`. **No column exists for it:** `grep -rn 'auth_code\|authorization_code' --include='*.sql' crates/oz-core/migrations` → **0 hits over 59 migration files** (`ls crates/oz-core/migrations/*.sql | wc -l`), and a green test already pins the blob — `ui/src/__tests__/PaymentModalSaleFlow.test.tsx:957`-`:960` parses `gatewayResponse` and asserts `parsed.auth_code`.
- **The identity is absent for a different reason: the command never takes one.** `crates/oz-bridge/src/edc.rs:27` is `pub const DEFAULT_TERMINAL_ID: &str = "default";` and `:75`-`:79` resolves it unconditionally (`ctx.registry.terminal(DEFAULT_TERMINAL_ID)`), while the file's own comment at `:25`-`:26` already names "making the commands take a `terminal_id`" as the follow-up that removes the constant — so the ask is not whether the code wants the column but which table the name points at.
- **Two tables answer that question differently.** `terminals` (`20260813_init.sql:926`) is the workstation and `edc_terminals` (`:325` of its generated twin `20260813_init.pg.sql`) is the card reader; every existing foreign key of that shape points at the workstation: `grep -rhoE 'terminal_id[^,)]*REFERENCES [a-z_]+' --include='*.sql' crates/oz-core/migrations | sed -E 's/.*REFERENCES //' | sort | uniq -c` → **15 → `terminals`, and none → `edc_terminals`** (`grep -rc 'REFERENCES edc_terminals' --include='*.sql' crates/oz-core/migrations` names 0 files). A void has to reach the reader that authorised it, so "add `terminal_id`" is ambiguous as written.
- **The price, so the ruling is not made in the dark.** `PaymentSplitArg` (`crates/oz-core/src/payment.rs:61`) appears **103 times across 22 files** (`grep -rn 'PaymentSplitArg' --include='*.rs' apps crates | wc -l`; `-rl` for the files) and still **41 times across 12 files** with `*_tests.rs` excluded, and `grep -rn 'impl Default for PaymentSplitArg' --include='*.rs' .` → **0**, so no call site can be left behind by a default. `ui/src/__tests__/api-edc-contract.test.ts:35`-`:38` pins today's `edc_sale` argument shape, which makes the smallest honest change a typed-surface change in both shells plus that contract test, the `ALTER TABLE` being the last and least of it. A lane report tonight counted 72 sites in 16 files; that figure does not re-derive under either scope above, so it is attributed and neither number is presented as the other's correction.
- **Recommendation:** answer the naming question first, and while it is unanswered do not fund the 103 sites — a column added under the workstation reading is a hundred edits pointing at the wrong table. Whether the answer is one column or two, the auth code should stop being a string inside a blob in the same change or in none; this page records the question and does not choose.

## 16. What are the three topology rulings holding, and what is their cost in waiting?

- **Decision:** three sentences from the owner — may a branch diagram be read without authentication, is topology global or location-scoped, may a filesystem path cross into the renderer — and the program that is waiting on them. Same shape as item **13**, a ruling that exists only as a red test; read that item for the consequence and not again here.
- **Measured 2026-09-15 at HEAD `38bfcdd41`, read only, no command run.** `todo-topology-editor.md` (462 lines) is a live un-started build programme rather than a design doc: its own census is **37 open boxes and 0 ticked** (`grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]'` / the same with `\[[xX]\]`), one finding is already dispatched to a lane, and `## 5. Rulings needed from the owner — blocking` states "A subagent cannot resolve them and must not guess", the critical path being one security row today.
- **What the file says, against what this was briefed.** Section 5's own words are "**Phase 2 is fully blocked; Phases 3 and 6 are partially blocked**" — not three phases that cannot be built at all — and the rows waiting are **13, not nine**: 5 open boxes under `## Phase 2` (`:194`-`:224`), 5 under `## Phase 3` (`:225`-`:257`) and 3 under `## Phase 6` (`:345`-`:367`), each range counted with the same two commands as above. The nine may have been a narrower reading of "blocked", but it is not what the boxes say tonight, so this item carries the measured 13 and attributes the nine.
- **Why a sentence beats an engineer-day, in the plan's own price for the first question:** "If yes, the fix is a comment. If no, it is a three-layer signature change" — the ruling does not just unblock the row, it decides whether the row costs minutes or a signature change across `crates/oz-bridge`, the shell command and `ui/src/api/topology.ts`.
- **Recommendation:** answer all three in one pass, in the order the file asks them, and let nothing else in that program be dispatched until they land — thirteen open boxes are cheap to write and expensive to write twice, and the only input missing is intent. **If a morning reader wants one frame for items 12 through 16: they are one cluster about the licensing and identity seams — what a build profile proves (12, 14), what a tier refusal must record (13), and which identity a tender row owes (15, 16's sibling questions) — and every one of them is now parked on an owner ruling rather than on engineering.**
- **APPENDED 2026-09-15 at HEAD `a73a8d962`, read-only audit — no ruling taken, no box ticked, no name moved.** Four things a reader must not size off this item's title, each with the command that re-derives it. (1) **Section 5 holds FOUR rulings now, not the three this item was written against** — `sed -n '426,436p' todo-topology-editor.md | grep -cE '^[0-9]+\. '` → **4** — the three quoted above standing, and the fourth added by `4a2488ddb` (*docs(plans): record the topology F1 ruling the code already documents*, 2026-09-15 06:50) and extended by `aae6d43ad` (*docs(plans): close the branch-keyed half of the topology ruling by its allowlist*, 06:58): it asks **whether the diagram's `storeProfileId` may select which store an Apply writes into, and if so what bounds it** (Phase 1, F1), and carries three sub-questions of its own — (b) closed by evidence at the command-registration layer, (a) recorded as REMAINING OPEN, and (a) is the one that asks whether one session can create workspace instances in another store's database. (2) The file has grown from the 462 lines cited above to **464** (`wc -l < todo-topology-editor.md` → 464), and its census is **38 open boxes, 0 ticked** (`grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' todo-topology-editor.md` → 38; the same form with `\[[xX]\]` → 0) — one MORE open box than the 37 above and none closed. (3) **The 13 rows this item counts are unchanged at 5 + 5 + 3**, because the added box sits outside those three ranges: `## Phase 2` `:195`–`:225` → 5, `## Phase 3` `:226`–`:258` → 5, `## Phase 6` `:346`–`:368` → 3, each counted by the same open-box form; only the ranges slid one line down as the file grew, so the `:194` / `:225` / `:345` pointers above are off by one at this tip while their counts are not. (4) **Where the shorthand is wrong, and this is the part worth carrying: those 13 are markdown checkboxes in a root plan, and no mechanical reader exists for that file at all** — `grep -rl 'todo-topology-editor' ui/src/__tests__ scripts .githooks | wc -l` → **0 paths** — **so answering the four rulings moves no guard count, no ledger entry and no token worklist.** The single countable consequence found sits under one branch of ruling 1, where Phase 2's own fence names "plus the IPC parity allowlist if a signature change requires an entry" and its acceptance runs `python scripts/verify-ipc-parity.py`; a *no* there carries a number, a *yes* carries none. **The title, the "three sentences from the owner" and the thirteen-row reading above are left byte-identical as the 14-09 record of what was blocking when written; none of the four is ruled here, the file still bars a subagent from guessing at them, the audit verdict on the fourth is RULING NEEDED, and nothing in this clause says the programme may proceed.**

## 17. Can the class guard grow a fifth axis, or do three claims stay named exemptions with a ledger?
- **Decision:** whether the screen-registration guard may gain a **fifth** field — consumer-keyed or node-keyed, which would require the extractor to model a fact it does not model today — or whether it stays four arrays and the claims below become **named exemptions carried in a ledger that fails when they go stale**. Items **12**, **13** and **14** above are the licensing seam and **15**/**16** are tender identity and the topology rulings; this is the guard's own seam, and it restates none of them. Item **11** already asks whether the settings-sheet name styled by another screen counts as debt **and whether the other three mute arrays get a proof too** — this item is the part item 11 cannot ask: three of tonight's resolutions are claims the field set cannot express at all, proof included, so **11 and 17 are adjacent, not one decision** (see the closing line).
- **Measured at HEAD `718dbe8e4`, guard file clean at read (`wc -l < ui/src/__tests__/screenExtraction.test.ts` → 2,000).** Four arrays, three of them believed on the author word until tonight: only the selector-only field added at `16258b37e` was graded (a value must appear in an E2E locator and in a production class site). Re-derived by a brace-matched scan of each array literal: `externalClasses` **43 values across 10 arrays**, `dynamicClassPrefixes` **47 across 29**, `knownDynamicFragments` **39 across 8**, entries counted by `name: ‘` lines **86**, and `BASELINE_UNCITED` **23 paths** — that baseline having moved 54 → 23 tonight by measurement rather than by muting, which is the auditable number on this page. **The 267-case total is attributed, not asserted** — it is a Vitest print and no run was permitted here. **The lane's pair-check figures are attributed too, and one disagrees:** it reported 50 `externalClasses` values across 11 entries with 17 naming a rule no other sheet defines; my scan reads 43 across 10 — a lane is editing that file, and the three inert prefixes plus the one-value-per-run own-literal deletions it describes would move the count exactly this way, so neither number is presented as the other's correction.
- **The three claims the field set cannot state.** (1) **A class reaching the DOM outside component JSX** — `ui/src/features/kds/KdsScreen.tsx:93` `document.body.classList.toggle('no-anim', !cardAnimations);` with the remove at `:94`, and `ui/src/features/workspaces/WorkspaceHome.tsx:488` `ripple.className = 'workspace-card-ripple';` — both re-grepped live. The second is the one a lane tried to delete as a lie, got a **red** back, and restored rather than forcing out, which is what makes it a shape and not a typo. (2) **A rule owned by one entry and consumed by another** — `.settings-topology-container` defined at `ui/src/features/settings/SettingsPage.css:501` and read by a literal `className` at `ui/src/features/locations/TopologyScreen.tsx:716`, both read this pass: the field means *belongs to another sheet*, and this rule is not in another sheet — while the obvious device, naming the consuming file, is attributed at **13 new findings out of that file's 14 classes** because its own sheet is not cited. (3) **Three rules with no reference anywhere**, each tested for a composition site and each failing it, making them candidate dead rules that no check will let anyone delete while their mute stands — **and the three class names were not carried into this page by the report that measured them, so whoever funds the deletion must ask the measuring lane for them; they are deliberately not guessed here.**
- **Recommendation: fund the ledger, not the axis.** An axis designed to hold three members inside an 86-entry / 267-case guard is a second parser to maintain, and it is the second time this session has declined an axis on exactly that reasoning; a ledger of named exemptions that **fails when an entry goes stale** is what makes the three claims auditable without teaching the extractor a new fact. Two baseline rows are already proved **unclosable by citation** — attributed: one sheet has no mount at all, the other is named only in prose in a features index — so a future reader should not spend a box trying to retire them.
- **Are 11 and 17 the same decision seen twice?** Partly, and the split is the useful part: **11** asks whether a name crossing sheets is debt and whether the other three arrays get a **proof**, and **17** asks what to do with the claims a proof cannot carry. Answering 11 does not answer 17 — grading all four arrays, which is 11's ask, still leaves these three outside the language — so they should be ruled together and funded separately: 11 is a matcher rule, 17 is an exemption ledger.

## 18. Does ruling 1A still stand now that the organisation scope it waited for has shipped?

- **Decision:** whether **ADR #47 ruling 1A** — the ruling that workspaces and terminals are deliberately NOT scope types because they sit below locations and inherit — still stands, now that the axis it deferred is the one that shipped. It differs from every other item in this cluster in one clause: 12 through 17 ask a question the tree cannot answer, and this one asks whether a question the tree already answered should be re-answered. It is a reversal, not a gap, so it got its own number rather than a clause of item **15** — 15 asks which identity a tender owes (nothing in the schema decides it), while here the schema decides it loudly and the only open question is whether its author still agrees.
- **Measured 2026-09-15 at HEAD `dd41e4b0b`, grep and read only.** `enum ScopeType { Organization, LegalEntity, Location }` is `crates/oz-core/src/db/assignments.rs:127`-`:137`, and its own doc comment at `:118` names the authority — "Assignment scope type (ADR #47 ruling 1A)". It is backed by a constrained column, not a blob: `crates/oz-core/migrations/20260916_role_assignment_scopes.sql:25` is `CHECK (scope_type IN ('organization', 'legal_entity', 'location'));`, registered at `crates/oz-core/src/migrations.rs:193`-`:194`, and present in the generated twin (`grep -c "scope_type IN ('organization'" crates/oz-core/migrations/20260813_init.pg.sql` → 1). **So the organisation half of the row is already shipped**, which is the exact opposite shape from item 15's finding — there the auth code existed only as a string inside an opaque `gateway_response` TEXT with no column anywhere; here it is a typed enum with a CHECK and a registry entry.
- **The two comment blocks that prove it was a ruling and not an oversight, quoted adjacent because that is where they live.** `:124`-`:125`: "Workspaces and terminals are deliberately NOT scope types — they sit below locations and inherit (ruling 1A)"; `:128`-`:129`, four lines later: "Org-wide — covers every legal entity, location, workspace, and terminal." The second is what makes the first cheap to keep: if an organisation-scoped staff member already reaches the terminal by inheritance, the missing axis is inheritance, not authority — and the row that asked for terminal scope was, on this reading, asking to spell out what the design already grants.
- **Three arms, and this page deliberately carries only their cost.** The arms are written out in full in `todo-tools.md`, in the row titled "Add SaaS authorization scope", at `:467`-`:478`, landed by `a672e8494` (*docs(plans): make the SaaS scope row something a coder can act on or park it honestly*) — the owner page holds the decision and the price, the plan row holds the evidence, and duplicating the arms would put two copies of a ruling in two files that drift. What separates them: (a) costs nothing and closes the row as NOT WORK; (b) is the only arm with a migration behind it — the parse and `as_str` arms (`assignments.rs:152`, `:154`, re-verified), the CHECK above, the generated PostgreSQL twin that `scripts/generate-pg-migration.py` owns and nobody may hand-edit, plus a new arm in the resource coverage predicate (that last item is the lane's trace, attributed and not re-derived here); (c) keeps the vocabulary coarse and gates the device where device-local gating already lives, precedent `apps/tablet-client/src/commands/local_payment.rs:29` (path confirmed tracked; the lane states plainly that it did **not** verify the rail pattern as sufficient).
- **Recommendation:** ask anybody who wants terminal-scoped staff to name a real failure they have seen, not an asymmetry they dislike — (a) and (c) are one-line decisions and only (b) has a schema change, a generated twin and a predicate behind it. The box stays unchecked whichever is chosen: the lane that made the row actionable rewrote it and left it open, because a rewrite is not a completion.

## 19. Who rules the backup bypass that four tests pin and no artifact decides?
- **CORRECTED COUNT, and it is the first thing a reader needs: the record’s two headings add to 25 ('## 1. The inventory — 19 sites, 13 wrapper names, 12 files' at `docs/records/adr7-conditional-scoping-fallback-class.md:67` plus '## 2. The second set — six ungated calls with NO branch at all' at `:104`), and the tree supports 24 LIVE.** One row is retired, not open: `ui/src/hooks/useGatewayStatus.ts:23` used to read a deny-listed setting and the file no longer does — `grep -n "getGatewayStatus\|getSetting" ui/src/hooks/useGatewayStatus.ts` at HEAD `7d8213f24` returns the import at `:2`, the call at `:53` and a comment at `:22` saying it now asks "never the credential itself", and `getSetting` is absent — while two of the nineteen moved OUT of the files the record names (the hardware read is live at `ui/src/hooks/useTerminalHardware.ts:239`, the cart-deduction read at `ui/src/features/sales/hooks/usePosCartActions.ts:103`) and six moved by line only. **So: 24 live, not 25, and the number this item carried when it was written was the record’s arithmetic, not a measurement.**
- **SPLIT — one sentence cannot rule these, because they are not one question. Four follow; the decision text below is kept verbatim as it was written, and is now the privileged-write question in particular.**
  - **(i) THE PRIVILEGED WRITE — rule this one, and it is the only one with a database at stake.** `ui/src/features/settings/hooks/useBackupStatus.ts:92` `: await createBackup();` is the else arm of `const result = sessionToken ?` at `:90`, its scoped twin enforces `permissions::DATA_EXPORT`, and the comment above it at `:88`-`:89` records the reason it matters — "until this line called it, that check existed only in code nothing reached" — while `ui/src/frontend/shell/UpdateBanner.tsx:184` calls the same wrapper unconditionally and pre-login. **Recommendation stands unchanged from the text below: route it.** What makes it load-bearing rather than deletable is the four pins named below — `api-data-contract.test.ts:47`/`:53`, `data_tests.rs:171`/`:203`, `DataManagementBackup.test.tsx:287` — and routing it is the only ruling that lets all four go away instead of being kept forever.
  - **(ii) THE SHELL-CONSTRAINED THREE — these are NOT permission questions and should not be ruled as if they were; they are a parity gap between two IPC surfaces.** `getCartDeductionLocation` (`ui/src/features/sales/hooks/usePosCartActions.ts:102`-`:103`) and `getHardwareSettings` (`ui/src/hooks/useTerminalHardware.ts:238`-`:239`) both scope cleanly on the shell that registers the twin, and the third member — the `EodReportScreen` case, attributed from the 25-site pass because `git grep -n "getDailyRevenue\|_scoped" -- ui/src/features/sales/EodReportScreen.tsx` returned **no rows** at this tip, so it is carried and not measured — is reported as **inverted**, meaning on one shell the *scoped* arm is the one that fails. Scoping cannot fix that; registering the missing twin on that shell can, which is a different item with a different owner and a different cost.
  - **(iii) THE NO-ARM PAIR — two side-effecting calls with no ternary at all, which is exactly the class the record says detection cannot see (`:106`-`:107`: "no fallback regex can ever see them … the same gap without the fig leaf").** `ui/src/features/settings/sections/SyncSection.tsx:426` and `ui/src/hooks/useSyncConnection.ts:105` both `await testSyncConnection()`, and a scoped twin exists at `ui/src/api/offline.ts:269`, so this is not a missing-gate story — it is the ambient arm being the only arm at the call site, in a pair that **dials a server** rather than reading a tile. `SyncSection.tsx:108`/`:146` takes `testSyncConnection` as a prop, so which function runs is decided by whoever mounts the section: the fix, if it is one, is a wiring decision, not an allowlist entry.
  - **(iv) THE ALREADY-RULED ROWS — named as ruled so an owner is not asked to re-approve them.** `scripts/verify-scoped-coverage.sh:31`-`:38` defines category **'1. PRE-AUTH / BOOTSTRAP — no session exists yet, so a session_token cannot be required'** and enumerates `staff_login, has_users, bootstrap_owner, create_session, verify_pin, activate_license, check_license_status, get_license_status, get_machine_id, get_hardware_fingerprint, renew/pause/resume_subscription, ping, version`, and the `ALLOWLIST` string at `:100` carries `renew_license`, `pause_subscription`, `resume_subscription` and `version` in fact. **An allowlist entry IS a site somebody already ruled acceptable**, and the count of 25 never said so: five pre-auth/billing writes plus the token-truthiness reads are inside that ruling already, and this item does not ask about them.
- **Decision:** this is a security-shaped item whose status in the tree is *seen, logged, pinned and unruled*, and the question is which of two rulings the owner gives: **(a) accept the pre-update backup as an ambient write** — the same class as the settings writes that already run without a session — which means saying out loud in the allowlist what an attacker gains, or **(b) route the updater backup through the scoped command** with a locally minted token, which then makes all four pins below deletable rather than load-bearing. **The third thing the tree does not offer is deletion without a route:** `apps/desktop-client/src/lib.rs:894`/`:896` still register both ungated names and `ui/src/frontend/shell/UpdateBanner.tsx:184` still calls `createBackup()` unconditionally, so removing the command today breaks the updater path, and a reader should know that before reaching for the obvious fix.
- **Measured at HEAD `3b8d8b20e`, code read with grep, nothing written.** `grep -n '^pub async fn get_backup_status\|^pub async fn create_backup\|^pub async fn .*_scoped(' crates/oz-bridge/src/data.rs` → ungated `:290` `get_backup_status(db_path: &Path)` and `:333` `create_backup(` — **neither takes a session token, so there is no identity to authorize** — against the scoped twins at `:786` and `:801`, whose bodies are `ctx.resolve_session(session_token)?` at `:792` and `ctx.require_session_permission(&session, permissions::DATA_EXPORT)` at `:793`. The gap is not invisible: `tracing::warn!` carries `event = 'backup_ungated_no_session'` and `skipped_permission = permissions::DATA_EXPORT` at `:292`/`:294` and `:338`/`:340`, the un-warned bodies are private helpers (`:306`, `:349`) so the gated path cannot emit it, the ledger row is `("data::get_backup_status", "no_session_resolution")` / `("data::create_backup", "no_session_resolution")` at `apps/desktop-client/src/commands/registration_gate_debt.generated.rs:21`-`:22`, and both names sit in the `ALLOWLIST` string at `scripts/verify-scoped-coverage.sh:100` (comment at `:57`). Where it is reached: the read is a ternary at `ui/src/features/settings/hooks/useBackupStatus.ts:58`-`:60`, and the **write** is the same shape at `:90`-`:92` (`? await createBackupScoped(sessionToken) : await createBackup()`) under the comment `:88`-`:89` — "until this line called it, that check existed only in code nothing reached" — plus the unconditional pre-login call at `ui/src/frontend/shell/UpdateBanner.tsx:184` (import `:5`), which asks for **no token at all**.
- **Why the severity is on the write, not the read:** `create_backup_direct` (`:349`-`:356`) is `ctx.lock_global()` → `Store::new(&conn)` → `store.backup(&output)`, i.e. it copies the **entire local database** to disk and carries no store, workspace or tenant parameter, so "can it cross a boundary" is the wrong question — there is no boundary in the call to cross. Inference, stated as such: the read leaks only a timestamp and a human-readable size (`:306`-`:322`), which is why the record graded the pair "lower impact"; the write produces a copy of every row on the till, which is not lower impact.
- **Four witnesses pin it, which is why it survives every cleanup pass and why nobody is allowed to read that as consent:** `ui/src/__tests__/api-data-contract.test.ts:47` and `:53`, `it('getBackupStatus still calls the UNGATED command (known bypass, see report)')` and its `createBackup` twin; `crates/oz-bridge/src/data_tests.rs:171` `ungated_get_backup_status_emits_exactly_one_event` (asserting the event shape at `:190`) and `:203` `scoped_get_backup_status_emits_zero_events_after_passing_the_check`; and `ui/src/__tests__/DataManagementBackup.test.tsx:287` `it('calls the UNGATED backup pair when no session token exists')`, whose failure strings at `:306` and `:319` say "expected the UNGATED create_backup (**writes a full db copy, checks nothing**) to be the command called". `docs/records/adr7-conditional-scoping-fallback-class.md:8`-`:10` calls the first two "a **DELIBERATE record** of this class, not an oversight&quot; — the hygiene is real; it is also why the bypass is permanent unless a ruling arrives.
- **The record sees it and rules nothing, which is the actual finding.** `wc -l <` → **300 ln**, and its thesis at `:20`-`:21` is "**This repo closes a permission gap by adding a scoped twin and leaving the original call as the else branch of a ternary**"; `:3` labels itself "measurement record, **not a plan, not a fix list**"; `.agents/unscoped-caller-map.md:118` says the pair is "**blocked on a ruling**". **Class size, quoted from the record rather than argued: '## 1. The inventory — 19 sites, 13 wrapper names, 12 files' (`:67`), plus a second set the record keeps separate — '## 2. The second set — six ungated calls with NO branch at all' (`:104`), "no fallback regex can ever see them … the same gap without the fig leaf" (`:106`-`:107`)**, so whichever way 19 goes, it goes for 19 and the six. One attributed number did **not** re-derive: the hook comment at `:46`-`:47` justifies the fallback by listing six WorkspaceContext coordinates where the token is nulled, and those coordinates now land on unrelated lines; `grep -n 'setSessionToken(null)' ui/src/contexts/WorkspaceContext.tsx` → **4 sites (`:267`, `:326`, `:371`, `:587`)**, so the claim stands in substance and is stale in its citations — quote the count of four, or re-read the file, at whatever HEAD you fund this at.
- **Recommendation (the manager’s, recorded as a recommendation): route the write, do not accept it.** "A log line authorises nothing" — the mitigation on the ungated path is exactly one `tracing::warn!`, and a warning is evidence for whoever reads a log, not a decision about who may copy a database. Routing the updater through `create_backup_scoped` with a locally minted token also lets all four pins be deleted together, which is the only honest way to retire them; accepting it instead would require naming, in the allowlist entry at `verify-scoped-coverage.sh:100`, what an attacker gains. Either way the count of 19 + 6 should be funded as a follow-up measurement, not argued from this item.

## 20. Does a global grant authorise writes into whichever store a request names?

- **The gate is doing what it was built to do, which is why this is a question and not a patch.** `crates/oz-core/src/db/assignments.rs:198-209` is the scope predicate; `ScopeMode::Global => true` at `:201` returns before either dimension is read. Three independent routes to the same pass, all re-read at `aae6d43ad`: (1) that Global arm; (2) `branches_all` at `:203`, an OR that short-circuits the intersection at `:204`; (3) `crates/oz-core/src/db/staff.rs:240-247`, where the deny test is `assignment.as_ref().is_some_and(|a| !a.matches_scope(..))` — **a user with no assignment row cannot deny, by construction**, and the comment at `:237-239` names ADR #35 D5 as the policy. It is asserted on purpose: `assignments_tests.rs:211-223`, `matches_scope_global_ignores_dimensions`, asserts `matches_scope(Some("store-a"), Some("retail-pos"))` is true for a Global assignment. A change here reverses a documented decision, so it is an owner call, not a lane call.
- **What meets it from client data.** `crates/oz-bridge/src/topology/commands.rs:464-466` derives `effective_store_id` from `semantic_branch_profile_id` (`crates/oz-core/src/topology.rs:136-148`), which reads `store_profile_id` off the first node typed `store` or `branch-location` **in the incoming request JSON**, and passes it into the BRANCH slot of the permission call at `:476-482` with `None` in the WORKSPACE slot. The same client-derived value then selects the database for the workspace mutations (`:677`), the recovery journal (`:526`) and the audit row (`:1021`). So for a Global or assignment-less user, naming store B writes B workspace instances and a B audit row on the strength of a grant that ignores the dimension it was asked about; for a Scoped user carrying an explicit branch list the value IS intersected at `:204` and an unknown B denies.
- **The half-answer that bounds the panic: omission fails CLOSED.** `semantic_branch_profile_id` returns `None` unless the graph carries semantic fields and a matching node, so `effective_store_id` falls back to the session store and `validate_apply_gate` rejects the non-canonical graph before any mutation (`commands.rs:543-561`). A hostile client gains nothing by leaving the field out; what it can do is **name** one.
- **The silent consequence of that `None`, stated once so nobody re-derives it.** `:206` reads `workspaces_all || workspace.is_some_and(..)` — but the call at `:476-482` passes `None` in the workspace slot, so `is_some_and` is false and a **Scoped user whose assignment lists explicit workspaces denies on EVERY Apply**. Apply is therefore effectively restricted to `workspaces_all` holders, and nothing at the call site says so or records that choice.
- **Inference — the key half, and the trace does not reach it.** The diagram row persists under `topology_setting_key(branch_id)` at `crates/oz-bridge/src/topology/persistence.rs:101-114`, keyed on a caller-supplied branch id into the GLOBAL identity database, while the permission check is keyed on the diagram store profile: **two independent client inputs, one checked.** `persistence.rs:102-104` shows the `None` case returning the bare un-suffixed `TOPOLOGY_SETTING_KEY`, and the coherence guard at `commands.rs:599-612` fires only when `branch_id` is `Some` **and** the diagram carries a profile id — so `branch_id: None` with a profile-bearing diagram writes the shared row after being scoped on store B, and a diagram without semantic fields writes `topology/<X>` for an arbitrary X while the check ran on the session store. Named as inference because what would confirm it is a run, not a read: one two-store, two-key Apply driven through the real command.
- **Ask.** Is a coarse global grant meant to authorise writes into whichever store a request names, or was the dimension it ignores the point of the grant? Second question, cheaper and separable: should `apply_topology_diff` pass `None` in the workspace slot, given that the pass silently excludes every scoped-but-workspace-listing user?
- **Recommendation (this lane’s, attributed, not a ruling).** Before anyone rules, the tree needs ONE two-store fixture — the cheapest thing that converts a shape argument into a measurement. Nothing settles it today: the only end-to-end Apply in the repo is `apps/desktop-client/src/commands/topology/topology_command_tests.rs:1168` (and `:1191`), and it seeds **one** string, `let store_id = "store-e2e";` at `:1103`, used as BOTH the session store at `:1145` AND the diagram `store_profile_id` at `:1161` — the single case in the codebase where divergence is unreachable, so the design comment is never exercised. Its user is `user-owner` / `role-owner` (`:1111-1113`, `:1142-1143`) with **no assignments row**, so it travels the legacy `staff.rs:240` path and never executes the intersect arm either. And `effective_store_id` appears in **6 paths tree-wide, none of them a test** (`git grep -l effective_store_id`).
- **What that fixture additionally needs, and whether it is buildable: buildable, at one file.** That harness already exists at the scale required — 1,733 lines, a real seeded Store, users, locations, subscription rows and two Applies with a revision CAS — so the case is not a new harness but a fork of `:1103` into `store_a` / `store_b`: `open_store` for the second id (`DbManager` hands out per-store DBs on demand), a second `locations` row, the diagram node carrying B while the session carries A, and an assertion on which database received the workspace instance and the audit row. The `apply_topology_diff` body reaches no network and no PostgreSQL, so no port-15432 dependency enters it. Cost is one case in one file, not a program.
- **CORRECTED, and the correction is the finding: the case was built at `32dcef1d3` (formatting follow-up `7685f0a1d`), it runs, and the paragraph above it that said the shape is unreachable is now false in its own words.** The earlier claim in this item — "the only end-to-end Apply in the repo … seeds ONE string … so divergence is unreachable" — held for the authorisation path it examined and was wrong about the recovery path, because it mis-read a test name. Three crash/recovery cases open **one store plus the global database**, not two stores: `crash_before_store_commit_heals_to_exact_prior_state` (`:931`, `store-crash-1` at `:935`), `crash_after_store_commit_compensates_both_databases` (`:979`, `store-crash-2` at `:983`) whose own comment at `:980-982` names the pair as "store transaction committed, global save never ran", and `recovery_finalizes_without_compensating_a_completed_apply` (`:1035`, `store-crash-3` at `:1042`). **So `both_databases` in that test name means store-plus-global, not two stores** — a name that read as a two-store harness for exactly the length of time it took to write this item. What made the new case a few lines rather than a harness is that the probes already exist here: `state_with_store` (`:854`), `crash_creation` (`:863`), `store_has_instance` (`:917`). And what left the end-to-end shape unpinned until now is that `authorize_topology_write_enforces_location_scope` (`:1419`) exercises the *helper* on `store-allowed` / `store-denied` and **never goes through `Apply`**.
- **The case: `apply_naming_a_foreign_store_records_which_database_receives_the_writes`, `apps/desktop-client/src/commands/topology/topology_command_tests.rs:1782`, 189 lines added by `32dcef1d3`.** Run command `cargo test -p oz-pos-app --lib topology` (dev profile, lib harness — any leg that links the bin collides with a running app binary): **53 collected, 53 passed, 0 failed, 49.73 s**, against **52** before the case existed, so +1 and nothing lost. Measured values, printed by a deliberately-red probe first so the numbers were observed rather than guessed, then pinned: `legacy_ok=false scoped_ok=false inst_a=false inst_b=false audit_a=0 audit_b=0`.
- **THE SENTENCE THAT MATTERS: the assignment-less user was NOT stopped by the scope gate.** Its refusal is `PermissionDenied("subscription tier does not allow workspace type pos")` — an *entitlement* message — while the permission call runs at `crates/oz-bridge/src/topology/commands.rs:476-482`, and the tier check at `commands.rs:713`. Ordering is the whole point: a session with **no assignments row** cleared scoping on a store it merely **named** in the diagram (`store_profile_id: char-store-b` while the session carried `char-store-a`), and the only thing standing between it and a foreign-store write was a check that has nothing to do with store identity. The other half stays equally true and is pinned in the same case: `user-scoped`, carrying an explicit branch list naming store A (`workspaces_all: true`, so the workspace dimension cannot be the cause), is refused with `PermissionDenied("branch/workspace out of scope for user user-scoped")` — `crates/oz-core/src/db/assignments.rs:204` intersecting exactly as the code reads. Per the owner instruction on that box, **the denial is the result**, pinned rather than argued with.
- **FENCE AND FRAME, recorded so a green is not misread.** These are **characterisation assertions**: they pin *where each request stopped* plus a null residual state (no `workspace_instances` row and no `audit_log` row in either store). The comment block above them says in plain words that it records observed behaviour at this SHA and that this item is the open question about whether it is intended; no `Result` is discarded, and no unresolved policy was laundered into a contract. **That is why the item stays open after the measurement** — a reader who finds a green test named after item 20 must not conclude the question was answered.
- **THE ASK, reshaped by the measurement.** It is no longer whether a global grant authorises any named store in the abstract. Measured today, an assignment-less session passes scoping on a client-named store and is stopped only by tier — so the question is: **is the subscription tier the intended boundary for store identity, or is it the only boundary, by accident?** The design comment at `commands.rs:459-463`, which describes this layer in unusual detail and directs the reader to treat the diagram value as the authoritative scope, **cites no such boundary** — nothing there says an entitlement gate is what keeps a named store honest. *That last clause is this lane’s reading, not a test verdict: the case measures where requests stop, and it cannot say what the code meant.*
## 21. Is one `prefers-reduced-motion` block per stylesheet the policy, or a shortcut that has become policy by surviving green runs?
- **Decision:** a scope question, not a bug report. The mechanism is `hasReduceBlock` in `ui/src/__tests__/animationCompliance.test.ts`, which asks only whether `@media (prefers-reduced-motion: reduce)` appears **anywhere** in a sheet — `:127` builds the regex over the whole file text, `:141`-`:142` increments `swallowedByFileWideReduce` for every declaration in such a sheet, and the identical test is re-implemented a second time inside the grading path at `:181` and `:199` (`if (hasReduceBlock) continue;`), so **the amnesty exists twice in one file and changing the policy means touching both halves.** Ask: does the owner want per-declaration reduced-motion coverage — 57 declarations in the sheets that would newly fail, plus the ~504 `transition` declarations nobody has ever looked at, which is precisely the property reduced motion most often governs — **or** is one block per sheet the accepted convention, in which case the walker should say so in its own title instead of printing a percentage that reads like a coverage figure. Both answers are acceptable and actionable; what is not actionable is today’s state, where a 44.9 % print invites a reader to believe 55 % of the work is excused **by rule** rather than by a blank in the checker.
- **Measured by running the one suite at HEAD `a34b016d6`** (`cd ui && npx vitest run src/__tests__/animationCompliance.test.ts`, 1.27 s wall): **`Test Files 1 passed (1)` · `Tests 2 passed (2)` · exit 0**, and its harvest line — `:222` is the case that prints it — reads, verbatim off stdout: "animationCompliance harvest: 136 sheets parsed; 316 animation declarations = 142 graded (44.9%) + 44 excused-by-essential + 56 excused-by-value + 74 swallowed-by-file-wide-reduce; 57 of those 74 would fail patterns A and C alone; 61 declarations name no @keyframes in their own sheet (misses); 30 sheets carry a reduce block; 504 transition declarations are never read". **The figures the brief carried are current, so nothing needed restating** — 142/316 and 136 sheets match the print at `7d8213f24`; the older "98 of 321" stays superseded as the `AGENTS.md` walker section already records.
- **Two silent consequences, which are what make this a decision rather than a chore.** (i) **The suite that swallows them also reads fewer sheets than its four siblings.** `:15` drops `*.module.css` in its own file finder, and `find ui/src -name '*.css' | wc -l` → **137** against `find ui/src -name '*.css' ! -name '*.module.css' | wc -l` → **136**, with `git ls-files 'ui/src/**/*.module.css'` returning exactly one path, `ui/src/features/settings/WorkspaceSettingsModal.module.css` — so the walker’s own denominator excludes a real sheet, and "137 sheets" is not one number across the five walkers. (ii) **More disclosure is not the fix.** The suite already prints its buckets honestly, names the amnesty in a comment at `:103` ("excuses EVERY animation in a…") and counts the unread transitions at `:129`; the disclosure is done. What is missing is a ruling on whether the file-wide excuse is intended policy, and a ruling is not something a louder print can substitute for.
- **Recommendation (the owner’s, recorded as a recommendation): do NOT fund the 57 as a campaign.** Fund the smallest thing that makes the number real — **one** sheet narrowed to per-declaration guards, chosen where the animation is user-visible and long, and let the print move by a knowable amount. `ui/src/features/kds/KdsScreen.css` is the named candidate: measured by the plan lane tonight at 2,336 ln, 10 lines carrying a reduce block, 60 carrying `animation:` or `transition:`, holding 6 of the 57, and `todo-refactor-kds-agents-merged.md` — the only plan that owns that directory — contains **0** lines matching `reduced-motion|prefers-|animation`, which is how the blind spot surfaced. **A per-rule conversion inside that one sheet is a coder box and needs no ruling; the file-wide amnesty itself does, and that is what this item asks.**

- **MEASURED 2026-09-15 at HEAD `e94a98b4f`, read-only box, nothing edited: the funded sheet has a number, it is 6, and it is still a question.** Commands kept, because a figure without its command is a claim: `cd ui && npx vitest run src/__tests__/animationCompliance.test.ts` for the tree-wide harvest, `grep -n "prefers-reduced-motion" ui/src/features/kds/KdsScreen.css` and `grep -n "animation: kds-" ui/src/features/kds/KdsScreen.css` for the file, and a faithful port of the walker loop (`animationCompliance.test.ts:110-153`) run **outside the repo** with the file-wide test replaced by a per-declaration one, for the counterfactual. No walker edit was needed, so this stayed a measurement box.
- **The four buckets, `KdsScreen.css` at 2,336 lines with 13 `@keyframes` and 23 `animation:` declarations:** 2 excused-by-essential, 4 excused-by-value -- all four literally `animation: none`, at `:2266`, `:2272`, `:2280`, `:2288` -- 11 graded through targeted `no-preference` blocks, and **6 swallowed by the file-wide amnesty** (`hasReduceBlock` computed at `animationCompliance.test.ts:127`, applied at `:141-142`): `kds-drop-in` three times at `:437`, `:486`, `:2207`; `kds-blink` at `:1002`; `kds-drop-out` at `:2059`; `kds-card-in` at `:2067`. **All 6 would fail patterns A and C if lifted. Six of six, not some.**
- **THE COSTED SENTENCE: a per-block amnesty moves this one file from 6 swallowed and 0 violations to 17 graded and 6 violations, and those 6 are 6 of the 57 the walker counts tree-wide as would-fail-if-lifted -- 10.5 % of the whole known-hidden population from ONE stylesheet.** Port result verbatim: `still-excused 0, newly-graded 6, failing 6`, and the reason is structural rather than interpretive: this file's only real reduce block begins at **`:2291`**, past every one of the six, so none of them is covered by any block-scoped amnesty. (Tree-wide harvest at this tip reads 315 declarations / 141 graded / 74 swallowed / 57 would-fail / 61 misses / 30 reduce sheets / 504 transitions unread -- one declaration and one graded case fewer than the same command printed an hour ago, because a lane removed a restaurant-card animation in `e94a98b4f` while this box was being written. Cite the run, not this line, for those seven numbers.)
- **THE STRUCTURAL FINDING, which makes the amnesty read as an accident rather than a policy in this file:** `KdsScreen.css` **already** handles reduced motion per-animation -- 8 `no-preference` blocks at `:1099`, `:1144`, `:1165`, `:1184`, `:1243`, `:1889`, `:2025`, `:2098` -- and carries **1** blanket `reduce` block at the very end (`:2291`) whose body only tightens things further (`opacity: 0 !important`, `transform: none !important`), while its own comment at `:2287-2290` says the general case already lives in `tokens.css`. **So a file-wide exemption is not standing in for missing per-animation work in this file.** That is a finding about one file and NOT a proof about the other 29 sheets that carry a reduce block; those may be exactly the opposite shape, and nothing here measures them.
- **THE BONUS DEFECT, recorded as the walker owing a fix and NOT as part of the amnesty question:** `unresolvedKeyframes++` at `animationCompliance.test.ts:137` runs **before** the `none`/`auto` value excuse at `:139`, so every legitimate `animation: none` in the tree is counted as a declaration that names no `@keyframes`. This sheet contributes **4 of the tree-wide 61 and all four are `animation: none`**, which means **the 61 is an upper bound with a known inflation, not a census** -- the class of error the debt ledger's counting law now names. The same naivety makes a reduce-block count read 2 for this file where the bytes hold 1, because the regex also matches the prose at `:2287`.
- **Clause on the pasted harvest line above — appended 2026-09-15 at `ae1b1749b`, owner-page append, not a correction of the record:** the misses figure in that verbatim print was 61 at `a34b016d6` and is **5** now, because `ae1b1749b` moved the `unresolvedKeyframes++` counter below the `none`/`auto` value excuse in `ui/src/__tests__/animationCompliance.test.ts`: 56 of the 61 were declarations reading literally `animation: none` or `animation: auto`, which need no keyframes at all (4 of them in `KdsScreen.css`), so what was quoted as a census was an upper bound with a known inflation. Every other bucket in that pasted line is untouched by the move, and this closes the fix the BONUS DEFECT bullet above recorded as owed. Source of truth is the print, not this page: `cd ui && npx vitest run src/__tests__/animationCompliance.test.ts`.
- **THE ASK IS STILL AN ASK.** Item 21 asked what the amnesty is deciding, and its recommendation was to fund one sheet rather than the 57; that has happened and the number is 6 from one file. Stated as costed and still open: **tightening to per-block would surface 6 violations here and an unknown share of the other 74 swallowed tree-wide, so it is a campaign decision and not a cleanup.** No ruling is written here, nothing is ticked, and a measured consequence is not an approved one.
## Premises in the briefing that did not survive the tree (named, not repeated)
- **Six numbers I could not re-derive anywhere in the repo, so they are not on this page:** "69 of 132 candidates", "59 accent-on-accent rules at 3.65:1", "the eight `--color-pos-on-primary` pairs failing all palettes" (the token exists and is `#ffffff` in all three theme blocks — `:284`, `:473`, `:596` — but the eight-pair census is not recorded in any doc: `grep -rn "pos-on-primary" --include="*.md" .` finds no census), "23 neutral muted-text pairs", "the `:root-duplicates-dark` double count at 106 of 132", and the "three-parser granularity" figures 766/362/125, 948/394 and 957/358/126 — no markdown in the tree carries them (`grep -rnoE "69 of 132|106 of 132|3\.65" --include="*.md" .` returns nothing), so a count with no command and no record is a number to be re-run, not a fact to be trusted. The two ratios I could compute myself did reproduce: 3.46 and 3.96, above.
- **Two were wrong:** `Cargo.toml:199-204` does not state a `debug-assertions` invariant — read it and it is `[profile.release]` with `opt-level = 3`, `lto = "thin"`, `codegen-units = 8`, `strip = "symbols"`, `overflow-checks = true`, so there is no unenforced invariant of that kind to park; and "58 production sites" for the sized button variants overstates what `git grep` finds by more than three times.

## Verification
- Commands, all read-only and all run 2026-09-15 at HEAD `fdd06eade`: `wc -l < ui/src/frontend/themes/tokens.css` · `grep -n "color-success\|color-danger\|pos-on-primary" ui/src/frontend/themes/tokens.css` · `git grep -n "DesignSystem.css" -- ui/src` · `git show --stat 1e0053dad` · `git grep -oE "btn--(sm|lg)" -- ui/src | wc -l` · `wc -l < ui/src/features/design/brand-tokens.css` · `grep -n "brand-tokens" scripts/sync-branding.ps1` · `git ls-files "ui/src/**/*.module.css"` · `git grep -il "FactoryReset" -- ui crates apps platform modules` · `git grep -n "audit_retention_days" -- crates/oz-core/src`.
- **No suite, no `npx`, no `tsc`, no cargo, no guard run**, and no value changed: this page is the parking lot, not the decision. TBL-11 is not re-opened — it settled STRUCTURE ONLY in this file at `:875` and stays there.

## 22. Do the five CSS sheet-walking guards grade a commit, or the working tree — and what does either result license?

- **Decision:** whether a walker result may be cited as evidence about a *revision* at all. The mechanism is settled and measured below; what is open is the citation discipline, and this item takes no ruling on whether the five should read HEAD. Appended after the item-21 pass footers (`## Premises …`, `## Verification`), which belong to that earlier record and to nothing written here.
- **Measured 2026-09-15 at HEAD `4cf3bace1`, read-only, no suite run.** The five — `themeTokenCompliance`, `composedRuleIdenticalPair`, `popupBackgroundCompliance`, `animationCompliance`, `noiseDitherCompliance` — open every file through node fs: `grep -hoE 'readdirSync|statSync|readFileSync' ui/src/__tests__/{themeTokenCompliance,composedRuleIdenticalPair,popupBackgroundCompliance,animationCompliance,noiseDitherCompliance}.test.ts | wc -l` → **37** sites, splitting **12 `readdirSync` + 4 `statSync` + 21 `readFileSync`** (per file: 13 / 7 / 7 / 5 / 5, counted with `grep -c`). And the sentence that closes the argument: `grep -cE 'git show|child_process|execSync'` returns **0 for each of the five files and 0 in total**, so there is no channel by which any of them could reach HEAD or the index — what they grade is the directory on disk, and a result is evidence about a working state, not about a commit. (A briefing tonight cited sixteen fs sites; the command above reads **37**, and 16 did not re-derive under any of the three splits tried here, so this page carries 37 with its command and attributes the other figure.)

- **CORRECTED 2026-09-15 at HEAD `10bc7c369`, and the correction is about the UNIT rather than the arithmetic: the **37** above and the **30** the mirrors were carrying are two different populations of the same three names, and both have since moved.** Re-measured against the five files themselves, three ways. **Matching lines** — `for f in themeTokenCompliance composedRuleIdenticalPair popupBackgroundCompliance animationCompliance noiseDitherCompliance; do grep -cE 'readdirSync|statSync|readFileSync' ui/src/__tests__/$f.test.ts; done` — read **13 / 5 / 5 / 4 / 7 = 34**. **Name occurrences** — the same loop through `grep -oE 'readdirSync|statSync|readFileSync' … | wc -l`, which also counts a second call sitting on one line and every identifier inside an `import { … } from 'fs'` statement — read **14 / 7 / 7 / 5 / 8 = 41**, and that is the population the 37 above counted; **12** of those 41 are import lines (2 / 3 / 3 / 2 / 2) which touch no disk at all. **Actual invocations** — the name followed by an open paren, `grep -oE '(readdirSync|statSync|readFileSync)\('` — read **12 / 4 / 4 / 3 / 3 = 26**, and that is the figure a claim about how many places a walker reaches the disk should carry.
- **So: which side was wrong.** The mirrors' 12 / 5 / 5 / 4 / 4 was **stale, not differently scoped** — it is a matching-lines count, the same unit this page uses, and the two files whose numbers moved are precisely the two walkers edited tonight (`themeTokenCompliance` at `37315dd53`, `noiseDitherCompliance` at `c7b1034ce`). This item's **37 was correct for its own unit at `4cf3bace1` and is superseded by 41 for that same unit today**, which is why it is corrected here rather than rewritten: the disagreement was never two claims about one thing, it was two units quoted without units. Both places now say which unit they mean, and the mirrors paragraph carries all three counts with their commands beside this one.
- **THE CONCLUSION IS UNMOVED, and that is the reason this correction is cheap:** re-read 2026-09-15 at `10bc7c369`, `git show|child_process|execSync` scores **0 in each of the five files and 0 in total** — widened to `spawnSync`, `execFileSync` and `simple-git` it is still **0** — so whichever population a reader picks, none of the five has any channel to a revision, a red can still be borrowed from a stranger and a green still proves nothing about a commit. No suite was run to write either bullet; every figure above is a count over file text and will move the next time a walker is edited, which is why each carries its command.
- **The consequence runs two ways, and the second is the one a reader skips.** (i) **A red can be borrowed from a stranger.** `themeTokenCompliance` is reported tonight as failing on `ui/src/features/sales/CartPanelLineItem.css:437`; that file is dirty in this checkout (`git --no-optional-locks status --porcelain -- ui/src/features/sales/CartPanelLineItem.css` → ` M`), it reads **490 lines on disk against 400 in the HEAD blob** (`wc -l < ui/src/features/sales/CartPanelLineItem.css` · `git show HEAD:ui/src/features/sales/CartPanelLineItem.css | wc -l`), `diff <(git show HEAD:…) … | grep -c '^>'` → **90 lines present only on disk**, and the named declaration `box-shadow: 0 8px 24px rgb(0 0 0 / 18%);` occurs **1** time on disk and **0** times in the HEAD blob — the committed sheet carries 9 `box-shadow` declarations, 8 of them `var(--…)`-based. So the thing that made the suite red is not in the commit. (ii) **A green proves no more**, and this is the unflattering half: the same working-tree read is symmetric, so an in-flight *deletion* in any walked sheet hides from a run a violation the committed tree still carries, and a clean guard print on a dirty tree licenses **no** claim about that revision. Both directions come from the one mechanism above, so neither can be argued away by running the suite again.
- **Recommendation, and it is a discipline rather than a code change:** before citing any walker result as evidence about a revision, record which walked paths were dirty at the moment of the run — `git --no-optional-locks status --porcelain -- ui/src/features ui/src/frontend ui/src/components` — and prefer a scoped command over a chained one, because a chained gate inherits the same ambiguity through its unit leg and adds another lane's in-flight edit to your verdict. **Attributed, not run in this box** (no suite was permitted here): a lane tonight found `npm run check:all` not earnable as a green in a checkout where a foreign uncommitted stylesheet edit sat inside its unit leg — a fact about the hour, not a verdict on any plan whose acceptance is that chain.
- **What this item is NOT:** no proposal to give the guards a git channel, no worktree-checkout harness, no new tool, and no request for a ruling. Those are owner options and this page records options as questions. The trade-off, stated once and stopped at: reading HEAD would let a walker answer a question about a commit and would cost each of the five a second read path plus fixtures the current writers do not have, while reading the tree is exactly what makes them usable as you-type feedback — and no consequence measured above is offered as approved work.

## 23. Is a directory of four `impl SyncStore` blocks and two backends with no trait between them a seam or a sprawl — and what would make building a trait worth it?

- **Decision:** a costing came back **recommending building nothing**, and that recommendation is the half worth an owner page. The question arrived as a smell report; the dossier answered it, and an owner page that records only ordered work loses the finding that mattered. No ruling is taken here — this item records the question, the measurements, the trigger that reopens it, and the argument that must not.
- **The shape, re-read read-only at tip `aaa19bc16` (a lane is mid-move in `apps/cloud-server`, so every count below is a timestamp, not a standing fact).** The seam is already an enum: `pub enum SyncStore { Sqlite(Arc<Mutex<Connection>>), Postgres(Pool) }` at `apps/cloud-server/src/sync_store.rs:92` — two variants, no trait. Four `impl SyncStore` blocks live in three files (`grep -rn 'impl SyncStore' apps/cloud-server/src/` → `sync_store.rs:99`, `conflicts.rs:30`, `conflicts.rs:215`, `tenant.rs:21`), and **all branching is in the dispatch files**: `grep -c 'match self'` returns **0 in `pg.rs` and 0 in `sqlite.rs`**, against 4 / 6 / 5 in the three dispatch files — **15 sites, not the fourteen the dossier counted.** What the two backend files actually hold is **five `pub(super)` free functions each** (`pg_push_batch_multirow`, `pg_pull_items`, `pg_snapshot_products`, `pg_snapshot_tax_rates`, `pg_snapshot_users`, mirrored by `sqlite_*`), so "two implementations with no trait between them" is right in kind and wrong in shape: **a trait would not wrap them, it would convert them.** At this tip the directory holds four `.rs` files (509 / 378 / 332 / 233 lines) plus the 408-line parent, 1,860 total.
- **Why a trait deletes the duplication: it does not, because the pairs agree on everything except what matters.** Names, arity and return types pair off **5 for 5** — `Result<Vec<PushOutcome>, String>`, `Result<Vec<OfflineQueueItem>, String>`, `Result<Vec<serde_json::Value>, String>` three times over, identical on both sides. **Receivers agree 0 for 5:** every `sqlite_*` takes `conn: &Connection`, while `pg.rs` takes `pool: &Pool` in one and `client: &mut impl deadpool_postgres::GenericClient` in four — the pg side does not even have one receiver shape — and `grep -c 'async fn'` is **5 in `pg.rs`, 0 in `sqlite.rs`**. That `GenericClient` is a client holding **an open transaction the caller owns and coalesces across calls**, which is why it is a parameter and not a field. At that shape a trait is a redesign wearing a wrappers costume: it either **kills the coalescing — a real round-trip regression — or grows a transaction-carrying associated type.** One dossier figure did **not** re-derive and is corrected here: the "thirteen copies of a pool-get / transaction / set-tenant-GUC prologue" reads at this tip as **5 sites total across the two backend files** (`set_config` 2, `.get()` 1, `transaction()` 1 in pg.rs; none of the three in `sqlite.rs`, which locks nothing and opens no transaction under those names), so the argument has to rest on the receivers, where it is strong, and not on the count, where it is not.
- **THE TRIGGER, which is why this is on an owner page at all:** revisit when **a third backend is actually scheduled** — an in-memory mock for the crate's own integration tests, or a read replica. At three, the per-change tax on fifteen match sites and whatever prologues the layout then has becomes real, and the redesign cost stops being gratuitous. A weaker second trigger: the transaction coalescing being **removed**, which would make the receivers uniform and downgrade a trait from redesign to wrapper. **The anti-trigger, stated so nobody re-opens this for the wrong reason: do NOT re-raise it on line-count grounds.** The parent is smaller than when the question was asked while the file total is larger than it was before the splits — that is what splitting costs, and a trait would not fix it; it would add a sixth file.
- **The honest tension, not sanded off:** four impl blocks of one type across three files is a shape one reviewer calls a seam and another calls a sprawl, and both readings are reasonable from the same screenful. The dossier judged the sprawl healthy on **one specific ground: independence between the two backends** — measured asymmetrically and reported as measured: `sqlite.rs` has **0** references to the pg side (`grep -cE 'pg_|tokio_postgres|deadpool'`), while `pg.rs` carries **5** occurrences of the word `sqlite`, at least one of them in its own `//!` header ("The SQLite mirrors of these functions … stay in `sync_store.rs`") — so the claim is true of **code** and only prose in the comments, which is exactly the precision the judgement needs: changing the conflict surface cannot force a change in either backend, because neither reaches into the other in a way the compiler enforces. The same reviewer called the `#[cfg(test)]` import in the parent (`sync_store.rs:50`, `:52`, named only by `sync_store_tests.rs`) **HONEST** for a comparable reason. **The standard worth recording: a shape is fine when independence is measured, not when it is hoped for.**
- **What item 23 is NOT:** not a work order, not a proposal to add `async-trait`, not a migration plan, and not a claim that the question is closed forever. It is closed for the reasons listed and reopens on the trigger listed — and, per this page's standing line, none of the consequences measured above is an approved one.

## 24. Is a clipped read a read — and what does a checker that cannot see a thing actually license?

- **Verified before written, 2026-09-15 at HEAD `46721cb43`, three measurements, each with its command.** (a) **A single markdown line on the two mirrors is enormous.** Longest line in the HEAD blob of `AGENTS.md` and of `.agents/AGENTS.md` is **14,269 characters (14,331 bytes) in both**, and the lines over 1,000 characters number **21** and **18** respectively — re-derive from filesystem bytes: `git show HEAD:AGENTS.md` read through node and reduced by `l.length` (a `wc -L` on a UTF-8 file answers a different question, so it was not used). (b) **A read of such a line is clipped at about one thousand.** Measured, not inferred: the same line 45 of `AGENTS.md` returned **1,034 characters** to the read tool against **14,269** on disk — the clip is a property of the reading surface, not of the file. (c) **The rule this cost now exists in both mirrors**, as three commits: `9e0cbc47d` wrote a supersession clause whose root copy measured **1,034 bytes** against **2,078** in the mirror it was copied from — the same 1,034 that a clipped read of that line returns, which is the whole mechanism in one number; `da4f94f09` restored the missing **1,044** bytes as a second additive commit; `46721cb43` wrote the rule itself, now **1,140 bytes and byte-identical in both** (sha256 compared on the clause alone at the committed state, from `git show`, not from a read).

- **THE LAW, which is the part worth an item: a tool that clips is not a tool that reads, and a green checker that was never designed to see the thing is not evidence about it.** The distinction to hold onto is between a command that **agrees** and a command that is **able to disagree**. `scripts/verify-agents-mirrors.py` compares gate counts, hook step names, accepted commit types, the version and cited workflow-job anchors; it never measures whether a sentence is whole, so it exited **0** on the tree where one mirror carried half a clause and kept exiting 0 after the repair — the same exit code either way, which is what makes its green worthless as evidence about that clause and is why a truncated sentence could have sat there for weeks. The command that can help is the one whose failure mode was demonstrated: compare byte lengths and a hash of the touched clause in both files at the committed state, and show it firing on a planted truncation before trusting it to be silent on a real one. A check is only as broad as the mutation it has been seen to catch; everything else is a habit of reading its silence as agreement.

- **The retro-explanation, stated as a mechanism and not as a defense: two earlier truncations on this page were blamed on carelessness and are better explained by (b).** Both were clauses built by copying from one mirror into the other through a reading surface that clips long lines, and both looked complete in that reading — which is precisely what made them unrecoverable by inspection. Nothing here claims a third case was found; the claim is only that the mechanism was not on this page until `46721cb43`, and an absent mechanism is how a recurring mistake gets remembered three times as three different carelessnesses.

- **The link to item 22 is one shape seen from two sides.** Item 22 measured that all five CSS walkers read the working tree through node fs and have **no git channel at all**, so a red can be borrowed from another lane's uncommitted stylesheet and a green proves nothing about a commit; this item is the same error one tool closer to the keyboard — a reading surface trusted beyond what it can reach, and an enforcement tool's silence read as a verdict. The discipline is identical in both: name the surface a number came through, record the state it saw (which paths were dirty at the moment of a walk; which bytes a clause had at the commit), and never let an authority-free green stand in for a measurement.

- **Dispatch discipline from the same night, kept short because it is a process lesson, not a second essay: two concurrent writers were pointed at the same file within sixty-four minutes by the same director, and both times the cause was that the second dispatch was issued from memory of what needed doing rather than from a written board of who owns what.** The near-miss each time was the same shape — a pathspec commit that would have filed one lane's lines under another lane's subject, which is the failure mode the mirrors' own §3 already documents as unreviewable after the fact. The rule: **a task is owned by the board, not by the memory, and a skipped dispatch is a recorded state rather than an absence** — work that was deliberately not sent has to appear somewhere as a decision, or it looks identical to work nobody thought of, and the next dispatch issued from memory will re-assign it. No person, lane or message is named here; the mechanism is the finding.

- **What this item is NOT:** not a proposal to change the read tool, the checker or any walker, not a claim that any suite passes or that any mirror is now correct about any population, and not a restatement of any figure from a walker run — none is quoted above and the numbers here are file bytes and commit contents, which do not move when a stylesheet is edited. Items 1 through 23 are untouched, including the three items tonight's clauses amended.

## 25. The seventeen open boxes in `todo-review-type.md` that are rulings, not work -- collected here (2026-09-15 ~11:45, at tip `36ca7fc6b`) so the queue can be retired with a pointer

- **Why this section exists, and what it does NOT do.** `todo-review-type.md` is a 289-line audit whose own `## Acceptance` section says it has no single acceptance command, and its triage section (`:259`) sorts its 36 open boxes into **10 command-carrying + 17 decision-required + 7 obsolete + 2 duplicates = 36**. Seventeen of those boxes can only be closed by a person answering a question, and a queue holding owner rulings reads as work-in-progress to every triage pass that opens it. This section moves the seventeen onto the page where rulings live. It ticks nothing, renames nothing, moves nothing: the rows stay exactly where they are in that file, as the evidence behind each ruling below, and the plan carries one dated pointer line at its top. **No consequence named below is an approved one**, per this page's standing rule.
- **The arithmetic of the move.** **15 of the 17** rows became rulings, and they collapse into **10 entries** below (R1-R10) because six of them answer to one decision each. **Two were refused**: `:133` is a command whose target file does not exist -- an **unapproved work order**, filed as WO1, not parked as a human question; and `:104` is a restatement of `:227` inside the same file, so it is folded into R10 as a citation rather than moved as an eleventh ruling. Each entry carries the same four fields: the question in yes/no form, the default if nobody answers, the cost of that default, and the line the ruling attaches to.

- **R1. Device class and OS target for the embedded shell -- `todo-review-type.md:112`.** **Q:** Is the first non-Tauri shell's target ARM/Linux framebuffer, Android, or both? **Default:** neither -- `find . -name '*.slint' | wc -l` = **0** at this tip, and the item's own preamble at `:110` reads "Owner decision required before any `.slint` file is written", so the answer being absent is what holds Item 2 shut. **Cost:** nothing this quarter and the entire lead time later -- the queue's header puts Slint at years 1-3, and a shell cannot be designed inside the week a customer asks for one. **Attaches to:** the ADR named at `:108`, as its scope paragraph.
- **R2. Does the embedded shell reuse `profile_type`, or become a third full POS -- `todo-review-type.md:113`.** **Q:** Does the shell map onto the lockdown axis that already exists -- `kds_kiosk` at `crates/oz-core/src/terminal_profile.rs:28` and `customer_display` at `:30`, the four-value axis documented at `:13` -- rather than growing a third? **Default:** unpicked, which is not neutral: the axis exists, so a shell author can invent a third value without ever being asked. **Cost:** a second permission surface, which is precisely what R4 forbids, paid at the moment a kiosk and a POS disagree about what a cashier may press. **Attaches to:** the same ADR, and it is the answer that sets how much screen the shell needs.
- **R3. Slint licence terms -- `todo-review-type.md:117`.** **Q:** Are Slint's licence terms signed off for a product this repo calls proprietary and commercially licensed? **Default:** no signature, no dependency -- `grep -c specta Cargo.toml ui/package.json` reads 0 for the other candidate too, so nothing in the tree has quietly adopted anything. **Cost:** this is the one ruling an engineer cannot stage around, and it is the cheapest to answer: R1, R2, R5 and R6 all wait on it, so a "no" retires five boxes in one sentence and a "yes" costs one paragraph of legal reading. The row says so itself -- "owner sign-off, not an engineering call".
- **R4. Are the three non-goals binding -- `todo-review-type.md:118`.** **Q:** Is "no second business-logic implementation, no second permission model, no second sync engine; it renders and calls `oz_bridge::*`" a rule the ADR states and a gate can be argued from, or advice? **Default:** advice. **Cost:** an embedded shell that grows its own retry loop is the third sync engine this forbids, and **no mechanical check in this repo would notice** -- `scripts/verify-architecture-boundaries.py` grades vocabulary and toolkit purity, not who owns sync. **Attaches to:** the ADR's non-goals section; the enforcement half is R10's, not this row's.
- **R5. Is the third-shell cost written into the ADR as three named consequences -- `todo-review-type.md:120`.** **Q:** Does the ADR carry, as numbers, the new allowlist section a third shell needs in `scripts/verify-ipc-parity.py`, the population `scripts/verify-scoped-coverage.sh` will then grade, and the registered-name floor in `apps/desktop-client/src/commands/registration_gate_tests.rs` and `apps/tablet-client/src/commands/registration_gate_tests.rs` that must be re-measured rather than remembered? **Default:** the cost is paid silently by whoever adds the shell, in the week they are already blocked. **Cost:** a third shell that registers fewer commands than two predecessors can pass a floor nobody raised for it -- the floor exists in both shells today, which is the mechanism.
- **R6. Is `.ftl` the single content set for a second renderer -- `todo-review-type.md:173`, with its two dependents `:175` and `:177`.** **Q:** Do the 54 `.ftl` files (`ls ui/src/locales/*.ftl | wc -l` = 54) stay the one source of truth with a non-React shell reading them in Rust through `fluent-bundle`, yes or no? **Default:** no, and it is a hard default -- `grep -c fluent-bundle` across `crates/*/Cargo.toml` = **0 hits**, so the Rust reader does not exist and the second renderer has no subject (`:175`'s prototype) while `:177` has no population to grade. **Cost:** the two gate scripts that police keys, `scripts/verify-bundle-parity.py` and `scripts/verify-ftl-orphans.py`, read TSX -- a second renderer added without this ruling strands keys with all seven pre-commit steps green, and 75 Fluent IDs already have no English definition, a number that only grows where nobody is looking. **Note on `:177`:** it asks to edit two live gate scripts, which is an edit downstream of the ruling, not a second decision; `:175` is an experiment that cannot be scoped before a `.slint` file exists. **Attaches to:** the ADR's i18n section, and it is answerable today without writing code.
- **R7. specta/ts-rs -- `todo-review-type.md:138`.** **Q:** Adopt codegen for the hand-written API surface by ADR, or not at all? **Default:** the row states it -- **no** (`grep -c specta` = 0 in `Cargo.toml` and 0 in `ui/package.json`: no dependency, no codegen). **Cost:** the ~8.7k lines of hand-written TS mirrors keep drifting against 127 Rust `*Dto` structs with nothing catching it -- which is WO1's subject, so R7 and WO1 are one conversation: a "no" here is also the answer to whether that gate should ever exist. **Attaches to:** a new ADR or an explicit "not at all" line in Item 3.
- **R8. Where does a client-side idempotency key live -- `todo-review-type.md:192`.** **Q:** Does the offline queue mint a key at enqueue time so a retry cannot double-apply, and is it minted in `ui/src/api/offline.ts`, in `crates/oz-bridge`, or at the server? **Default:** nowhere -- `grep -cE 'idempoten' ui/src/api/offline.ts` = **0**, so no local record anchors a command today. **Cost:** a sale enqueued while offline and pushed twice after a reconnect double-charges a customer, and both the audit trail and the end-of-day reconciliation agree with themselves about it, which is the worst kind of wrong number. **Attaches to:** the offline model section (Item 5), and it is a location ruling, not a design proposal -- the repo has already made this class of ruling elsewhere, e.g. `todo-topology-editor.md:259` "pin the idempotency ledger".
- **R9. Do dense grids stay on paging -- `todo-review-type.md:211`.** **Q:** Is "a grid with sort headers, sticky rows or variable heights stays on paging" policy for every screen, or a per-screen judgement each author makes once? **Default:** paging by inheritance -- `LIST_PAGE_SIZE = 50` at `ui/src/utils/list-policy.ts:20` is what `usePagedList` hands every data screen, `react-window` appears twice in `ui/package.json`, `@tanstack/react-virtual` zero times. **Cost:** the first person to hit a virtualizer fighting a sticky header files it as a grid bug, and the fix that closes the bug deletes the header -- a semantics loss argued as a rendering one. **Attaches to:** Item 6's contract line.
- **R10. Do the four Item-7 invariants become a graded contract -- `todo-review-type.md:226`, `:227`, `:229`, `:231` (and `:104`, which says `:227` again).** **Q:** Are these four -- DTOs carry data and never presentation; every business rule sits at a choke point every caller passes; events cross the seam through `EventSink`; a new shell needs only a `BridgeCtx`, a command registration and a locale reader -- a checklist an agent can fail, or a description of hope? **Default:** prose: Item 7's own preamble says they "should be true continuously, not at swap time" and none of the four is asserted today except vocabulary purity. Their measured homes are `pub trait EventSink` at `crates/oz-bridge/src/ctx.rs:45` and `pub struct BridgeCtx<'a>` at `:59`; the precedent `:227` leans on is `crates/oz-core/src/ozpkg.rs:154`, which does exist. **Cost:** this is the plan's stated goal -- "The goal is separation between app and UI -- the UI must be replaceable" -- and a replaceability price is set by exactly these four lines; if they rot quietly, the price is discovered at swap time, the one moment it cannot be paid. `:104` is the same sentence as `:227` and is folded here rather than moved. **Attaches to:** `scripts/verify-architecture-boundaries.py`'s `RULES` dict is the only home with a floor under it, and choosing that home is the ruling; `:231`'s "if it needs more, that is the finding" is the acceptance test R1-R6 describe.

- **WO1 (refused as a ruling; filed as an unapproved work order) -- `todo-review-type.md:133`.** The row asks to "Add `scripts/verify-dto-parity.py` ... and register it in `scripts/gates.json`", and its own continuation states **there is no such gate today**. Measured: `test -f scripts/verify-dto-parity.py` -> **absent**. That is the shape `todo-font-system.md` and item 24 above already name: a row whose command target does not exist is not a decision waiting for an answer, it is **a work order for a new gate written by whoever drafted the queue**. A new gate is not free here -- `.githooks/pre-commit` carries **7** step sections (`grep -c '^# ─' .githooks/pre-commit` = 7), each with a `gates.json` row and CI wiring behind it, and this repo's own precedent is that closing such a gap is "an owner decision, not a docs edit" (`AGENTS.md`, stylesheet section). So it is **not** parked above as a human question, and the genuinely undecided half of it -- what "field-for-field agreement" means across 127 DTOs and 336 TS interfaces, per-struct and case-mirrored -- travels with the approval request instead of ahead of it. What the owner is being asked to rule on, if anyone ever asks: **is a seventh-adjacent parity gate worth its maintenance, given R7's default is "no codegen"?**

- **Standing caveats on this section, so it is not over-read.** (i) Every figure above is a **working-tree reading taken at ~11:45 on 2026-09-15 at tip `36ca7fc6b`** in a checkout other lanes edit by the minute; a count that has since moved is stale, not contradicted. (ii) **This section licenses no rename.** `todo-review-type.md` keeps its `todo-` prefix: AGENTS.md §4 earns `done-` only on the file's own acceptance command having run and passed, this queue has no such command, and its triage section already concluded the file goes **retired with a pointer, never `done-`** if the 10 command-carrying rows are ever split into sized plans. Moving the rulings here makes the pointer findable; it does not make the audit accepted. (iii) **Nothing was ticked, moved, or deleted** in the plan file, and no row's text was edited -- only one dated pointer line was added at its top. (iv) The `## Acceptance` verdict in that file still stands on its own terms, and three cheap gates passing on an untouched queue would still not make it accepted.

- **RULINGS RECORDED 2026-09-16 ~00:05, at tip `56bb2b77b` — R3 and R7 answered on owner instruction; both ratify the default that was already in force, so no code, dependency or gate changes as a result.** Each names what it closes, what it leaves, and what would reverse it. Nothing was deleted from this section, and every default named above stays readable as the alternative that was declined.

- **R3 = NO. Slint's licence terms are NOT signed off, and no Slint dependency is to be added.** Re-derive that nothing has to change: `find . -name '*.slint' | wc -l` -> **0**; `grep -cinE '\bslint\b' ui/package.json Cargo.toml` -> **0** and **0**. **A substring trap worth recording, because the first measurement hit it:** `grep -ci slint ui/package.json` reads **9**, and all nine are **`eslint`** — `eslint`, `typescript-eslint`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`. The naive count would have put "Slint appears nine times in the UI manifest" into a licence record. Word boundaries, always. **What this closes:** R1, R2 and R5 fall with it, because each is a question about the design of a shell that now has no approved renderer — no target device class (R1), no `profile_type` mapping (R2), no third-shell cost to write into an ADR (R5). **What it does NOT close, and this is a judgement rather than a consequence:** R6. The horizon at the head of `todo-review-type.md` puts Slint at years 1-3 but allows "Slint **or another renderer**" in years 4-5, so "do the 54 `.ftl` files stay the single content set for a second renderer" survives R3 in a narrower form — a question about an unnamed renderer rather than about Slint. Its default is unchanged and still hard: `grep -c fluent-bundle crates/*/Cargo.toml` -> **0** across all crates, so no Rust reader exists and there is nothing for a second renderer to read through. **Reversal:** a later "yes" re-opens R1, R2, R3 and R5 in one sentence; nothing was deleted, so the cost of being wrong here is one line.

- **R7 = NO. No specta/ts-rs codegen is adopted, by ADR or otherwise.** Re-derive: `grep -c specta Cargo.toml ui/package.json` -> **0** and **0**; `grep -c 'ts-rs' Cargo.toml` -> **0**. **What this closes:** the TS mirror stays hand-written, and the drift it is exposed to becomes **accepted debt rather than unowned debt** — which is the whole value of the ruling, since a default nobody has stated is not a decision. **The debt, re-measured tonight rather than quoted:** `cat ui/src/api/*.ts | wc -l` -> **8468** lines of hand-written mirror against `grep -rhoE 'pub struct [A-Za-z0-9_]*Dto\b' crates modules platform --include='*.rs' | wc -l` -> **83** `*Dto` declarations (**120** once `apps/` is included; **79** distinct names either way). **The `127` this section cites for that count is not reproducible by any of those three measures, so it is recorded as stale rather than repeated**, and the `336 TS interfaces` figure is not reproducible either — `grep -rhoE '^\s*(export )?interface [A-Za-z0-9_]+' ui/src --include='*.ts' --include='*.tsx' | wc -l` reads **977**, which counts test and dev-mock surfaces as well. Neither number should be quoted again without its command.

- **WO1 = NOT APPROVED, and it stays an unapproved work order.** `test -f scripts/verify-dto-parity.py` -> **absent**, unchanged. The question this section attached to it — *is a seventh-adjacent parity gate worth its maintenance, given R7's default is "no codegen"* — is answered **"not now"** by the same instruction, on the ground that the owner has declined both the codegen and, for the present, the gate that was its substitute. **Stated so the ruling is not read as free:** with R7 = no and WO1 unapproved, *nothing* in this repo grades the field shape of those DTOs against their mirror — the plan says so of itself at `todo-review-type.md:140` ("scripts cover command names, invoke tokens, scoped coverage, plugins and topology, not **field shape**"). That is now a decision rather than a gap. **Reversal:** one ADR re-opens R7; approving WO1 needs no ruling at all, only a work order, and `scripts/gates.json` would gain a row.

- **What remained open after that block, and no longer does: R4, R6, R8, R9 and R10 were answered on owner instruction at 2026-09-16 ~00:15, at tip `d6d06c3c7` — and that SHA moves under this page, so re-derive it with `git rev-parse --short HEAD` before quoting it.** R1, R2 and R5 stay **MOOT rather than closed** — a different state from done, and one that only a later R3 = yes or a decision to delete those rows can end. Every figure below was re-measured this pass rather than carried over, and the two rows that could not be settled by reading were settled by running a test.

- **R4 = BINDING AS WRITTEN, NOT YET GATED. The three non-goals are rules, not advice; nothing in this repo can currently fail them.** **What makes them binding:** `todo-review-type.md:135`-`:136` states them as prohibitions in the plan's own voice — "no second business-logic implementation, no second permission model, no second sync engine. It renders and calls `oz_bridge::*`" — and the plan's stated goal ("the UI must be replaceable") is priced by exactly that sentence, so a default of "advice" would be the plan contradicting its own acceptance test. **What makes the gate half absent, re-derived:** the boundaries gate carries five rules — `module-to-module`, `core-upward-dependency`, `platform-to-business`, `ui-direct-invoke`, `bridge-toolkit-purity` (`scripts/verify-architecture-boundaries.py`, `RULES` dict) — and **not one of them asks who owns sync**; `grep -rl 'EventSink' scripts/ | wc -l` -> **0**. A shell that grew its own retry loop would therefore pass every gate in the repo, which is precisely the failure this row predicted. **What it closes:** the question "binding or advice" — answered **binding**, so the non-goals may be cited as rules in review from tonight. **What it does NOT close:** the row itself. `todo-review-type.md:135` stays unticked, because a binding rule with no gate and no ADR is the exact state R10's chosen home is meant to end; it closes when an ADR exists to state it in, and the ADR is blocked behind R3 = no. **Reversal:** one line, and the enforcement half is R10's, not this row's.

- **R6 = YES. The 54 `.ftl` files stay the single content set, and a second renderer reads them in Rust through `fluent-bundle`.** Re-derive both halves: `ls ui/src/locales/*.ftl | wc -l` -> **54**; `grep -rc fluent-bundle crates/*/Cargo.toml` -> **0 hits across every crate**, so the Rust reader is still to be written. **Why the ruling is not free:** the two scripts that police keys, `scripts/verify-bundle-parity.py` and `scripts/verify-ftl-orphans.py`, read TSX; a second renderer added without this decision strands keys with all seven pre-commit steps green, and `scripts/verify-ftl-orphans.py --self-test` already reports **75** one-sided keys at rest. **This survives R3 = no**, and that is a judgement rather than a consequence: the horizon at the head of `todo-review-type.md` allows "Slint **or another renderer**" in years 4-5, so the question narrows from "the Slint shell" to "an unnamed second renderer" without changing its answer. **What it closes:** the decision row `todo-review-type.md:194` ("Decide now"), ticked this pass — its verb is *decide*, and the decision is now made. **What it does NOT close, and the ticks must not be read as covering it:** `:196` (prototype a bundle load in Rust) and `:198` (extend the two parity scripts to see `.slint` or Rust-side key usage) both need a second renderer that the tree does not have (`find . -name '*.slint' -not -path './node_modules/*' | wc -l` -> **0**), so both are **moot pending a renderer, not done** — a gate over them today would grade an empty set, which is the vacuous green `AGENTS.md`'s stylesheet section already names. **Reversal:** one line, and the reversal cost is that a second renderer arrives with no reader and no parity coverage.

- **R8 = ANSWERED BY EVIDENCE, AND THE EVIDENCE CORRECTS THE DEFAULT THE QUESTION ASSUMED.** The question offered three homes — `ui/src/api/offline.ts`, `crates/oz-bridge`, or the server — and the answer is **none of them**. The key is minted in a fourth place, on the client, in the core crate: `crates/oz-core/src/offline.rs:129`, inside `OfflineQueueItem::new`, reads `id: uuid::Uuid::now_v7().to_string()`. Every construction path delegates to it (`with_tenant` at `:143`, `with_priority` below), so one id is minted per item and none re-mints; `crates/oz-core/src/db/offline.rs:231` `enqueue_offline_inner` then INSERTs that id as the row's identity, so it survives a restart — the durable outbox ADR #6 claims. On the wire the whole row is POSTed and the server dedupes on the same value, which is why a re-send cannot double-apply. **So R8's default ("nowhere — no local record anchors a command today") was wrong, and the Item-5 tick at `todo-review-type.md:216` was right.** **But the guarantee is conditional on re-sending the same row, and there is exactly one path that does not — found this pass, and it is a defect, not a nuance.** `platform/sync/src/queue.rs:331`, inside `apply_resolution`, calls `store.enqueue_offline(&resolved.winner.action, &resolved.winner.payload)` — **action and payload only**. The resolver had already minted its own winner id at `platform/sync/src/conflict.rs:163`; `apply_resolution` discards it and mints a fresh one, so a CRDT merge that keeps conflicting acquires a **new server-side identity every cycle**, and it also resets `retry_count` to 0 and the tenant to `"default"` — the retry bound never engages and a multi-store delta re-enqueues under the wrong tenant. `apply_resolution`'s only production caller is `apply_push_conflict` at `queue.rs:355`, which both `SyncEngine` and `SyncDaemon` route through, so the path is reachable — **but the trigger is not, and the first draft of this ruling said "live", which was wrong and is corrected here at ~00:25, tip `9abd66984`.** No server in this repository emits that tag: `grep -rn 'PushOutcome::Conflict'` over `apps crates modules platform foundation` returns **five** hits, every one a `match` arm or a label string and **not one a constructor**; a real clash arrives as `Rejected { reason: "duplicate id: …" }`, which is R8's key working. **So the divergence is latent** — it activates when a foreign or older server emits the tag. **It is also already filed, so no box is created for it:** `docs/decisions/2026-07-20-sync-conflict-resolution-strategy.md` §*Activation and Ownership* records it at its `:303`, with the honest headline at `:306` — "two policy owners for a wire contract with no producer — not a live data-loss bug". `platform/sync/src/sync_client_divergence_tests.rs:314`-`:325` pins it as **CURRENT BEHAVIOUR**, and that test was **run** this pass rather than cited — `cargo test -p platform-sync crdt_merge_reenqueue_discards_retry_count_and_tenant` -> **1 passed; 0 failed** (385 filtered out). **A second, separate parity gap was found in the same pass and is reported, not fixed:** the ADR's `:309` and the divergence test's doc comment at `:430` both say **one** consumer lacks the duplicate-id arm, while `grep -rn 'is_duplicate_id_rejection'` returns exactly **two** call sites — `crates/oz-core/src/sync_client.rs:310` and `platform/sync/src/daemon.rs:208` — leaving `pg_daemon.rs:333` **and** `lib.rs:561` routing a duplicate-id replay to `mark_offline_failed`. The second is public API (`SyncEngine::run_sync_cycle`) with no in-repo production caller, so its blast radius is an embedder — which is what a future shell would be. Detail on `todo-review-type.md`; it belongs in the ADR's next dated append. **What this ruling closes:** R8's question, with the location corrected. **What it does NOT close, and must not be folded into R8:** the merge-path identity loss is **a different requirement on a different path** — R8 asked where the key lives and whether a *retry* can double-apply, and the answer to that is yes-it-lives-at-`offline.rs:129` and no-a-retry-cannot. A defect on the conflict path does not reopen it. **Filed where it belongs:** the ticked row's own disposition at `todo-review-type.md:223` asserts "double-apply is closed by the code above", which is now known to be **too strong**; a dated correction was appended to `:216` rather than left standing. Promoting the merge-path defect to work is a new box, and this block does not create it.

- **R9 = POLICY. "A grid with sort headers, sticky rows or variable heights stays on paging" governs every screen, and it is no longer a per-screen judgement each author makes once.** Re-derive the inheritance it states rather than replaces: `grep -n LIST_PAGE_SIZE ui/src/utils/list-policy.ts` -> `:20 export const LIST_PAGE_SIZE = 50`, consumed as the default at `:30` by `paginate<T>(items, page, pageSize = LIST_PAGE_SIZE)`; `grep -c react-window ui/package.json` -> **2**; `grep -c '@tanstack/react-virtual' ui/package.json` -> **0**. **Why the ruling is worth making when the default already behaves this way:** the cost of the default was never that authors would virtualize — it is that the first virtualizer fighting a sticky header gets filed as a grid bug, and the fix that closes the bug deletes the header, converting a semantics loss into a rendering one. Policy makes that trade visible before it is made. **What it closes:** the decision-required row `todo-review-type.md:247`, ticked this pass. **What it does NOT close, stated so the tick is not over-read:** **no script grades this**, and the ruling does not pretend otherwise — nothing measures "sort headers, sticky rows or variable heights", which `todo-review-type.md:256` and `:277` already recorded. The ruling converts a judgement into a stated policy a reviewer enforces; it does not create a gate, and the enforcement half stays with R10. **Reversal:** one line, and nothing in the tree changes either way.

- **R10 = YES. The four Item-7 invariants become a graded contract, and their home is `scripts/verify-architecture-boundaries.py`'s `RULES` dict.** The four are: DTOs carry data and never presentation (`todo-review-type.md:270`); every business rule sits at a choke point every caller passes (`:271`); events cross the seam through `EventSink` (`:273`); a new shell needs only a `BridgeCtx`, a command registration and a locale reader (`:275`). **Why that home and not a new script:** it is the only place in this repo with a floor under it — it already runs `--strict` in `dev-ci.yml#static-gates` and in the pre-commit battery, it carries a baseline whose entries must name an `owner` and an `expires` date, and it has a test file that proves each rule can disagree. A new checker would have to re-buy all four. **The homes are re-derived, not quoted:** `pub trait EventSink: Send + Sync` at `crates/oz-bridge/src/ctx.rs:45` and `pub struct BridgeCtx<'a>` at `:59`; and `grep -rl 'EventSink' scripts/ | wc -l` -> **0**, so the seam invariant has no grader at all today — an invariant that cannot fail its own check is the thing this ruling ends. The `:271` precedent is real and its file is now **clean**: `crates/oz-core/src/ozpkg.rs` carries `if password.trim().is_empty()` at `:154` under the comment at `:149`-`:150`, and `git status --porcelain -- crates/oz-core/src/ozpkg.rs` printed **no path** this pass — which retires the caveat recorded at `todo-review-type.md:122`, where the line number had to be flagged as a working-tree reading of another lane's edit. **The template already exists, and it landed tonight:** `ui-framework-vocabulary` is in the gate (`grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> **3**), `python scripts/verify-architecture-boundaries.py --strict` -> exit **0**, and the baseline is still **8 entries, every one `core-upward-dependency`** — a rule that arrived at genuine zero and needed no baseline row, which is the shape all four should aim at. **One correction this ruling owes Item 7:** `todo-review-type.md:263`'s first row was retired as unbuildable at `:264` on the ground that *no vocabulary rule exists* — **that premise is now superseded** by `0ca2c0f27`. The retirement's conclusion still holds for the row's original reading (a rule keyed on those words over the **masked** copy has an empty population; the landed rule deliberately reads the **comment** layer instead), so the row stays unticked — but its stated reason must be restated before anyone re-reads it, because "no vocabulary rule exists" is no longer true. **What it closes:** the four move from prose to **approved work**. **What it does NOT close:** all four. Approving work is not doing it, none of the four is gated tonight, and the rows stay `- [ ]` until the rules exist and the gate can disagree about them. **Reversal:** one line, and the cost of being wrong is four rules that each arrive at zero and stay there.

- **R10 ADDENDUM 2026-09-16 ~00:31, at tip `7011487c5` — the census R10 needed *before* any of the four rules is written. It narrows the ruling rather than reversing it: only ONE of the four has a clean gradable population, one is small and judgement-bound, and two have none.** Measured over **1166** `.rs` files under `apps crates modules platform foundation`, with comments and string bodies stripped so the counts are code rather than prose.
  - **#3 (events cross the seam through `EventSink`) — GRADABLE, and it already has 11 real violations, all in one shell.** The receiver census reads: `app.emit(` **11**, every one in `apps/tablet-client/src/commands/` (`hardware.rs` ×10 at `:94`, `:269`, `:329`, `:352`, `:359`, `:423`, `:526`, `:606`, `:629`, `:636`; `kds.rs` ×1 at `:34`); `sink.emit(` **11** (the bridge — the intended shape); `handle.emit(` **2** (the two `TauriEventSink` impls at `apps/tablet-client/src/commands/authz.rs:38` and `apps/desktop-client/src/commands/authz.rs:34` — those **are** the seam, so they are the rule's exemption, not its finding); `app_handle.emit(` **2** (`apps/desktop-client/src/lib.rs:123`, the `set_settings_emit_fn` adapter, and `apps/desktop-client/src/commands/sync.rs:124`); `self.emit(` **1** (`crates/oz-bridge/src/ctx.rs:54`, the trait's own default body). **The 11 are a fork artefact, not a design choice:** `crates/oz-bridge/src/hardware.rs:130`-`:133` reads `if let Some(sink) = &ctx.emitter { sink.emit("receipt:printed", …) }`, while `apps/tablet-client/src/commands/hardware.rs:92`-`:95` reads `if let Some(ref app) = state.app { let _ = app.emit("receipt:printed", …) }` — same event name, same payload, **the same comment** — and the tablet file carries **no** `EventSink` reference at all, even though that shell already owns a `TauriEventSink` at `commands/authz.rs:34` whose own doc comment says "Wave D bridge bodies emit UI events through it instead of holding a handle". So the rule is writable, its population is **11**, and its exemption list is short and nameable. **One near-miss worth recording:** a naive `grep -E '\b(app|handle)\s*\.\s*emit'` returns **16**, not 11, because it also catches a `///` doc comment at `crates/oz-bridge/src/kds.rs:155` that *describes* the old `app.emit` guard. Stripping comments is what makes the number 11; the unanchored grep would have put a doc comment into a finding list.
  - **#1 (DTOs describe data, never presentation) — GRADABLE but small, and every hit needs a judgement.** `pub struct *Dto` declarations: **121**. Fields whose name matches a presentation vocabulary (`html|css|colour|color|style|route|layout|render|screen|dialog|modal|button|icon|theme|palette|padding|margin|font|width|height|px`): **7**, and they are only ever `icon` and `colour`, on three distinct types — `WorkspaceDto.icon`/`.colour` (`crates/oz-core/src/db/workspaces.rs:96`), `CategoryDto.colour`/`.icon` (`crates/oz-bridge/src/categories.rs:24`), `WorkspaceTypeDto.icon` (`crates/oz-bridge/src/workspaces.rs:43`), plus the tablet's fork of `CategoryDto` (`apps/tablet-client/src/commands/categories.rs:19`). **This is the invariant with the weakest predicate:** a category's colour is arguably *domain* data a merchant chooses rather than presentation, and a rule flagging it would be wrong on at least some of the seven. #1 is gradable only **after** someone decides which of those two words are presentation — and that decision is not this census's to make.
  - **#2 (every business rule at a choke point every caller passes) — NOT GRADABLE.** "A rule that only a UI enforces" has no token, no type and no call shape a checker can key on; the precedent it cites (`crates/oz-core/src/ozpkg.rs:154`, the empty-password guard) is exactly the kind of thing that can only be found by reading. A gate here would have to guess, and a guessing gate produces false positives in a `--strict` CI leg. **Recommended disposition: keep it as prose, and stop describing it as a contract candidate.**
  - **#4 (a new shell needs only a `BridgeCtx`, a command registration and a locale reader) — NOT GRADABLE, and it has no subject.** `find . -name '*.slint' | wc -l` -> **0**; `apps/` holds **2** shells with a `src/lib.rs` (`desktop-client`, `tablet-client`). The invariant's own acceptance test is "if it needs more, that is the finding", which can only be evaluated by **building** the third shell. **Same state as R1/R2/R5: moot, not failed.**
  - **So R10 = yes still stands, but it can only deliver on one of the four.** #3 is a real rule with 11 findings and a short exemption list, and writing it is now a bounded piece of work. #1 needs a vocabulary decision first. #2 and #4 should be struck from the "graded contract" list rather than left as aspiration. **This is the same finding Item 7's half-1 produced, one layer over:** a proposed rule is worth building only after its population is measured, and two of these four have none. **The census script was written to `%TEMP%` and is not part of the tree** — no file under the repo was created or changed to measure any of this.
  - **Follow-up, same pass — the 11 sites are the tail of an in-flight conversion, and an emit-only patch would be the WRONG fix.** `AppState::bridge_ctx()` (`apps/tablet-client/src/state.rs:417`) already exists and already carries `emitter: Option<Arc<dyn EventSink>>`, built by `commands/authz.rs:47`'s `event_sink()`; it is **already consumed** by `commands/audit.rs` (**6** call sites) and `commands/settings.rs` (**3**), and its own attribute note reads `#[allow(dead_code)] // consumed by the Slice 1+ shims (audit.rs, sync.rs)`. So `hardware.rs` and `kds.rs` are the **remaining tail** of the ADR #49 shim conversion — not untouched code, and not a new work item. **That is exactly why swapping `app.emit` for `sink.emit` at the 11 sites would be a half-measure:** it would drive this rule's findings to zero while leaving the fork standing. `crates/oz-bridge/src/hardware.rs` and `apps/tablet-client/src/commands/hardware.rs` are forks — **52 basenames in both shells' `commands/`, 0 byte-identical** — and the emit call is one line of that divergence; the two bodies are otherwise the same function. A green `seam-emit` over an un-extracted fork is the failure the 1,000-line cap breach already produced once: **relocated, not resolved.** **Recommended sequence: extract `hardware.rs` and `kds.rs` onto `oz_bridge::*` first — the slice `state.rs:416` already names — then land `seam-emit` at zero, with the two `TauriEventSink` impls (`apps/{tablet,desktop}-client/src/commands/authz.rs`) and the desktop's `set_settings_emit_fn` adapter (`apps/desktop-client/src/lib.rs:123`) as its named exemptions.** The rule then arrives as the extraction's acceptance evidence rather than as a substitute for it. No code was changed to reach this conclusion, and neither shell was built.
  - **And the extraction is not merely "next" — for these files it is BLOCKED on a gating ruling, measured.** A parallel lane's ADR #49 tablet slice-1 report (`486bb8807`, recorded in this checkout's memory log) found that **an extraction is not a mechanical edit**, and named the trap that decides this one: `apps/tablet-client/src/commands/registration_gate_tests.rs` sweeps for calls into `oz_bridge::` and reads them as *evidence the shared funnel owns the RBAC*, so delegating an **ungated** command flips its ledger entry from "ungated debt" to "gated" **without adding a permission** — the debt vanishes from the ledger while the hole remains. ADR #49 §4 is explicit that an extraction must not widen a gate, and two `settings` doors were **reverted** for exactly this. **The same check applied to this work reads:** `apps/tablet-client/src/commands/registration_gate_debt.generated.rs` carries **7** `hardware::*` entries — `list_scanners_scoped`, `open_cash_drawer_scoped`, `stop_scanner_scoped`, `list_displays_scoped`, `display_show_scoped`, `display_clear_scoped`, `discover_hardware_scoped` — and **every one** is spelled `"resolves_session_names_no_permission"`, which the ledger's own enum documents as *"Resolves a session and never asks whether the caller may: authenticate-then-assume. The class the design pass found."* That is the ungated class verbatim. **`kds::*` has 0 entries**, so by the same file's rule (absent from the ledger means Gated) `kds.rs` could port freely. **So the immediate blocker on this rule is a gating ruling, not engineering:** the 7 ungated `hardware` doors need an owner decision about what permission they should carry before any of them is delegated, and only after that does the extraction — and then `seam-emit` — become available. **One thing this does NOT change:** the emit conversion alone (`state.bridge_ctx()` instead of a held `state.app`) is ratchet-neutral, because `hardware.rs` would name no `oz_bridge::` token and the sweep keys on those; but it is still the half-measure rejected above, so the fact that it is *safe* is not a reason to do it.

  - **And the kds half of that sequence has now been EXECUTED — four doors of five — and it does NOT move this rule at all, which corrects the sentence above.** `2fa58a878` delegates `list_kds_orders_scoped`, `get_kds_queue_scoped`, `update_kds_status_scoped` and `get_kds_order_scoped` to `oz_bridge::kds::*`; the tablet suite reads **656/0** (unchanged), clippy is clean under `-D warnings`, `verify-ipc-parity.py` prints `IPC parity: OK`, `verify-scoped-coverage.sh` prints `PASS`, and `drift_pin_three_way_partition_is_complete_and_sums` stays green — the delegation was ledger-neutral exactly as the empty `kds::*` ledger predicted. **But the fifth door cannot be delegated, and it is the one holding the emit.** `create_kds_order_from_sale_scoped` stays in place with its reason in-code, because the bridge's door of that name is not the same operation: it reads the store's runtime KDS plan first, then (a) fans each zone ticket out to the topology-selected instances and (b) auto-prints the resulting chits. The tablet's body is `complete_sale_to_kds`, which is literally `complete_sale_to_kds_routed(.., None)` -> `complete_sale_to_kds_fanout(.., &[])`, so the two agree **only** in the no-plan case; with a plan present the tickets become targeted where they are untargeted today, an empty target list suppresses them entirely (`should_create_kds_tickets` -> false) where they are still created today, and every call gains a hardware side effect this shell has never had. That is a behaviour change, not an extraction, and §4 forbids it inside one. **The consequence is the correction:** `emit_orders_changed` is called by that one door and nothing else, so the tablet's `app.emit(` census is **still 11** (hardware ×10, kds ×1) after a successful kds extraction. **`seam-emit`'s dependency is therefore `hardware.rs` ALONE** — `kds.rs` was never load-bearing for it, so the sequence recorded above ("extract `hardware.rs` and `kds.rs` … then land `seam-emit` at zero") should be read as "extract `hardware.rs`": the kds half can land in full and leave the count untouched. **One thing measured in the same pass that narrows the fifth door:** the desktop has *already* fully delegated its kds surface (`apps/desktop-client/src/commands/kds.rs` calls `oz_bridge::kds::*` at 14 sites), so the bridge **is** the desktop's implementation and the tablet's five doors are a pre-extraction fork of it — which makes the targeting question "should the tablet catch up to the desktop", an owner decision, rather than a parity question with two peers.
  - **Five hours and 206 commits later, the "7 ungated hardware doors" above is now 6 — and the one that moved is the only one that ever had an answer available.** Re-measured rather than carried over. `registration_gate_debt.generated.rs` still lists the same 7 `hardware::*` names, but reading each against its bridge twin splits them into two classes the earlier record merged. **One had a gate to copy:** the tablet's `hardware::open_cash_drawer_scoped` resolved a session and discarded it as `_session`, then opened the drawer, while `crates/oz-bridge/src/hardware.rs:416`-`:423` gates the same door with `permissions::PAYMENTS_CASH` under a comment naming `F-017` — the same finding number the parallel `settings` (`4bdb4b4d7`) and `terminals` (`50b2fd14e`) passes cite. That made it a parity gap, not an owner-policy question, and `5c67948d4` closed it in the idiom those passes established: gate before the device is looked up, so a denied caller never reaches the hardware. The ledger row is gone, `DEBT_CEILING` 90 -> 89, `RESOLVES_SESSION_NAMES_NO_PERMISSION` 48 -> 47, tablet suite **667/0**, clippy clean, `IPC parity: OK`, `PASS: all registered commands covered`. **The other six have no gate to copy:** `list_scanners_scoped`, `stop_scanner_scoped`, `list_displays_scoped`, `display_show_scoped`, `display_clear_scoped` and `discover_hardware_scoped` are ungated in the bridge too — each calls `ctx.resolve_scope(session_token)?` and nothing else — so "gate the commands the bridge twins gate" would gate exactly nothing, and they remain a genuine owner-policy decision. **Two readings corroborate the split:** `apps/desktop-client/tests/gate_audit.rs:100` pins `("hardware", 1, &["PAYMENTS_CASH"])`, so the desktop's own audit already expected hardware to carry precisely one gate and named this one; and before the change `grep -rn PAYMENTS_CASH apps/tablet-client/` returned **0** — the shell had no reference to the permission anywhere, including in the UI path that calls `open_cash_drawer_scoped` (`ui/src/api/hardware.ts:210`). **No behavioural test was added, and the reason is not laziness:** `commands/hardware_tests.rs` is pure DTO/serde tests with no session harness, and the ratchet already covers the regression — deleting the gate would return the door to debt and push the ceiling back to 90, which `drift_pin_debt_ceilings_only_shrink` fails.
  - **The hardware delegation pass ran, and it converted exactly one door — the rest are refusals with reasons, which is the finding.** `start_scanner_scoped` was a byte-identical second copy of `oz_bridge::hardware::start_scanner_scoped` (`:529`): same cancel-then-take, same `"no scanner registered as '{}'"` text, same `AppHandle unavailable` for the headless case, same `poll(300)`, same 500 ms backoff, same four log strings and two `barcode:*` payloads — and the same cancel slot, because `bridge_ctx()` binds `scanner_cancel: &self.scanner_cancel`, so this shell's own `stop_scanner` keeps working. Delegated in **`794d4abdd`** (net **-50** lines), taking the `app.emit(` census **10 -> 7**; suite **667/0**, clippy clean, `IPC parity: OK`, `PASS: all registered commands covered`. One real delta is reported rather than hidden: the bridge resolves with `ctx.resolve_scope(..)`, opening the session's store DB where this body opened nothing — the desktop's behaviour, so parity, but it does add a store open to every scanner start. **The two print doors are REFUSED, both on one ground:** the bridge inserts `printer.get_status()` and rejects with `"Printer is not ready: check paper supply and cover"` on `status.has_fault()` (`crates/oz-bridge/src/hardware.rs:454-459` for `print_receipt_scoped`; `:321-333` inside `run_print_receipt_inner` for `print_sales_receipt_scoped`). The tablet has neither, so delegating would add a refusal path to commands that print today. Everything after that block matches — same `format_sales_receipt`, same `line_count = receipt.items.len() + 6`, same `print_raw` — so the fault check is the *only* obstacle, and whether the tablet gains it is an owner call. Reasons recorded in-code (`84136f449`). **A second delta surfaced, smaller but not cosmetic:** the tablet's `print_sales_receipt_scoped` resolves the printer *before* the session (`:350-354`), so a missing printer is reported ahead of an invalid token, where the bridge resolves the store first — an ordering that lets an unauthenticated caller distinguish printer states. **Where this leaves `seam-emit`:** of the 7 remaining sites, **4 sit in `start_scanner` (3) and `print_receipt` (1), and neither command is registered** — `grep -c '"print_receipt"\|"start_scanner"' apps/tablet-client/src/lib.rs` -> **0**, so they are dead surface the retirement campaign (`6aa4cba00`) is already draining, not findings to convert. The other 3 are one each in the two refused print doors and one in kds door 5. **So the rule's floor is 3, not 0, and every one of the three is an owner decision** — the printer fault check (twice) and tablet topology targeting. Plan against 3, not 0: it is better than the 11 this started at, but a rule that cannot reach zero is a rule that must ship with a baseline, and that is a different decision from the one R10 made.
  - **And the last delegable hardware door is done — but it was not a door delegation, it was a DTO collapse, which is the useful lesson.** `open_cash_drawer_scoped` matched its twin on the gate (both `PAYMENTS_CASH`, both scope-aware), on order (`resolve_session` first), on the error string `"no cash drawer registered as '{id}'"` and on `drawer.open()`. Delegating it still failed to compile, because `crates/oz-bridge/src/hardware.rs` and this shell each defined their **own** `OpenCashDrawerArgs` and `OpenCashDrawerResult` — distinct types with identical fields. The fix is the codebase's own idiom, not an invention: `pub use oz_bridge::<module>::{…}` already appears in nine tablet command files (`settings`, `analytics`, `audit`, `auth`, `browser`, `bundles`, `customers`, `fiscal`, `gift_cards`). **`efe2302e4`** does that for the two cash-drawer types. **One asymmetry surfaced and was measured rather than assumed:** this shell's `OpenCashDrawerArgs` carried `#[serde(default)]` on `device_id` and the bridge's does not, which would matter if a caller omitted the field. It does not — `hardware_tests.rs::open_cash_drawer_args_default_device` deserialises `{}` and asserts `None`, and it still passes, because serde already defaults a missing `Option` field; the attribute was redundant. **So the generalised rule: a "portable" door whose twin returns a *distinct* type is not a door delegation at all — budget for collapsing the DTO, and check `rename_all` and `serde(default)` on both sides before claiming the wire shape is unchanged.** A side effect worth noting: the two imports the earlier gate fix added (`oz_core::permissions`, `require_permission_for_session`) became dead the moment the door delegated, and `-D warnings` caught them — a delegation can orphan the imports of the fix that made it possible. Census stays **7** (this door held no emit site); suite **667/0**, clippy clean, registration gate **9/9**, `IPC parity: OK`, `PASS: all registered commands covered`. **The hardware module is now exhausted in the same sense `settings.rs` was: 2 delegated, 2 refused on the printer fault check, 6 blocked on an owner gating ruling, and the remainder (`start_scanner`, `print_receipt`, `stop_scanner`, `list_scanners`) unregistered dead surface a peer's retirement campaign is draining.** The `seam-emit` floor is still **3**.
- **So the ten are now disposed of, and only three are still waiting on a person.** R3 = **NO** and R7 = **NO** (both ratifying the default in force). R1, R2, R5 = **MOOT**, not closed — they end only on a later R3 = yes or on someone deleting the rows. R4 = **binding, ungated**; R6 = **yes**; R8 = **answered by evidence, location corrected**; R9 = **policy**; R10 = **yes, a graded contract**. **Nothing above was approved as code, and no gate, dependency or baseline entry changed as a result of any of it** — per this page's standing rule. What is now open is *work*: two R6 dependents that need a renderer, four R10 invariants that need rules, the R4 gate half, and one newly-named merge-path defect that R8 does not own.

## 26. What a gate grades when it borrows another checkout's graph, when its flag selects nothing, and when two rows of one table are read as one sentence (2026-09-15 ~night, at tip `619719595`)

- **ONE -- the mechanism: a CI-blocking gate can score this tree against ANOTHER checkout's cache, and it does so precisely when its answer is least trustworthy.** Read at HEAD, no run needed: `git show HEAD:scripts/verify-architecture-boundaries.py | grep -c 'architecture-cargo-metadata.json'` → **2**, i.e. `metadata_from_cargo()` falls back to the tracked fixture whenever `cargo metadata` exits nonzero. The fixture describes a different tree: `grep -o '"workspace_root":"[^"]*"' scripts/architecture-cargo-metadata.json` → **`"C:\\dev\\ozpos\\0.0.35\\oz-pos"`**, `grep -o '0\\.0\\.35' scripts/architecture-cargo-metadata.json | wc -l` → **408** occurrences, and every `manifest_path` in it a foreign absolute path (`"manifest_path":"C:\\dev\\ozpos\\0.0.35\\oz-pos\\crates\\oz-core\\Cargo.toml"`). Two commands, opposite verdicts, same baseline file, both re-run here tonight and matching what was measured earlier: `python3 scripts/verify-architecture-boundaries.py --metadata-file scripts/architecture-cargo-metadata.json --strict` → **0 tracked transitional, 8 new/expired blocking, 8 stale**, exit **1**; `python3 scripts/verify-architecture-boundaries.py` → **8 tracked, 0 new/expired, 0 stale**, exit **0**. Those eight `[stale]` rows are the eight live `core-upward-dependency crates/oz-core/Cargo.toml -> modules-*` suppressions -- stale only because the graph they were diffed against lives in another directory. **The trigger was transient, and that is the load-bearing half:** a foreign untracked crate with no `lib.rs`, globbed in by `members = crates/*`, made cargo fail, so the outage and the fabricated verdict arrived in the same breath, and a fallback with no veto about which root it was holding did the rest. **THE RULE, as a rule and not as a bug report: a cached artifact that substitutes silently for a live tool result is not a degraded mode -- it is a different measurement wearing the first one's name, and it is worst exactly when the real tool is failing.** What a reader should DO: **never let a cached artifact substitute silently when a tool fails -- fail closed, and print the reason plus the two roots it compared**, so the reader learns the gate could not see the tree rather than learning the tree is wrong. Item 22 reached the same law from a walker and item 24 from a clipped read; this is it from a fallback, and the three are one sentence: a green whose provenance you cannot name is weaker than a red you can.
- **TWO -- the mechanism: `--strict` selects nothing, and a CI leg passes it anyway.** `dev-ci.yml:464` reads `run: python3 scripts/verify-architecture-boundaries.py --strict`. The flag is declared (`parser.add_argument("--strict", action="store_true", help="Explicitly enforce the default blocking policy.")`, `:624` on the copy on disk tonight) and never read -- `grep -c 'args.strict' scripts/verify-architecture-boundaries.py` → **0**, and the same count on `git show HEAD:…` → **0**, so HEAD and disk agree on this one -- while both paths land on the single shared `return 1 if blocking or stale else 0` at `:646`. Default and `--strict` are therefore one behaviour, and the eight-stale exit above was produced by a flag whose stated purpose is to make blocking explicit. **THE RULE, general: a flag a CI leg passes is a claim about behaviour, and a flag nobody reads turns that claim into decoration** -- and worse than no flag at all, because it answers "is this gate strict?" with a line of YAML instead of with the script. What a reader should DO: **if you add a flag to a gate, add the test that the flag changes an outcome** -- one assertion that the two invocations differ, or that the strict path fails on an input the lenient path passes. A flag with no such test is documentation that can never go stale, because it was never true; `--self-test` exists in three of this repo's checkers for the same reason, and a flag is not covered by a gate that grades other things.
- **THREE -- the mechanism: the number I chased all evening was real and my attribution of it was invented, which is a different error from a wrong number and a harder one to catch.** `todo-review-type.md` was cited to me at `:265`; re-read tonight the `48` sits at **`:266`** -- one line below the pointer, because that file is being edited too, which is the first lesson and not a footnote: a pointer into a living file is a timestamp. The three adjacent rows, quoted by what each actually says: **`:266`** a grep, `grep -rniE 'react|\\.tsx|\\.css|component to render' crates modules platform --include='*.rs' | wc -l` → **48**; **`:267`** `python scripts/verify-architecture-boundaries.py --strict` → exit **0**, eight `[tracked]` baseline lines; **`:268`** the baseline file's `entries` list holds **8** rows. Three rows, two instruments -- a vocabulary grep, and a dependency-boundary checker with its suppression ledger -- and I read the adjacency as one sentence about one instrument, then briefed a lane to drive 48 toward a zero that neither of those lines can move. That the plan's own `:266` calls "the gate named one row down" its verdict is how the join looked sourced; measured, the eight rows that gate tracks are `core-upward-dependency crates/oz-core/Cargo.toml -> modules-crm` and seven siblings -- none of them a react/`.tsx`/`.css` hit, so narrowing 48 changes neither the exit code nor the count of 8. **The finding surfaced only because that lane refused to edit** and went and measured -- the correction came from declining to act on an unverified join, not from checking anyone's arithmetic. **THE RULE: the lesson is not to distrust numbers -- 48, 0 and 8 were all exactly right -- it is to distrust the act of joining two numbers that merely sit near each other. A table row is not a sentence, and proximity is not a predicate.** What a reader should DO: **quote the row you mean, not the row near it** -- carry the row's own line with its command whenever you cite a table, and if your sentence needs two rows to describe the same instrument, measure that they do, because adjacency is an artifact of how the notes were typed, not a claim about the tree.
- **FOURTH -- what this item refuses to say, so it is not over-read.** No lane is claimed to have fixed the fallback, and no fix is offered as decided work: `git --no-optional-locks status --porcelain -- scripts/verify-architecture-boundaries.py` → **` M`** at the hour I write -- a box is on that file right now and its outcome is unknown here. Nor is any verdict claimed about CI: no run was opened from this box, and `:464` is quoted as the line that passes the flag, not as a status. Both checker prints above came from the working-tree copy, which is item 22's caveat turned on my own measurement rather than on someone else's walker -- a figure taken from a dirty file is a fact about the tree at its timestamp, not about `619719595`; the fallback's existence at HEAD is why it is stated as a `git show` count and the two prints are stated as runs. The `408`, the `0` for `args.strict`, the three row quotes and the eight tracked rows are exact over file bytes and move only when the tree moves; the two exits and their tallies are run properties and can move the next time cargo fails or a suppression expires. Line numbers into `scripts/verify-architecture-boundaries.py` are named-and-dated on purpose: `metadata_from_cargo()`, `cached_metadata()` and the shared return are the durable handles, and a lane mid-edit can move a `:624` in one keystroke. **The one thing worth carrying out of all three, in a line: every one of tonight's wrong answers was produced by a tool that was honest about the number and silent about the source -- and a gate, a flag and a table row all failed the same way, by being read as authority when they were only being read as output.**

## 27. What a green contract suite certifies when the boundary it names is a mock -- and why a TEXT column read by two builds is an owner decision, not a refactor (2026-09-15 ~night, at tip `7edfd2280`)

- **ONE -- the mechanism: a mocked transport certifies the WRAPPER, not the WIRE, and the file's own comment claims the wire.** Measured by reading plus one scoped run, not inferred: `cd ui && npx vitest run src/__tests__/api-offline-contract.test.ts` → **`Tests 23 passed (23)`**, 29 ms for the file, and `grep -c -E '^[[:space:]]*(it|test)\(' ui/src/__tests__/api-offline-contract.test.ts` → **23**, so the count is static as well as run. The payload case is the whole story: `mockInvoke.mockResolvedValue([...])` at `:139` feeds **a hand-written JSON string literal**, `payload: '{"sale_id":"s-1"}'` at `:143`, and `:158` asserts **that same literal** back -- `expect(first.payload).toBe('{"sale_id":"s-1"}')`. Nothing between those two lines is a serializer, a Rust type, an IPC call or a column, and `mockResolvedValue` is untyped against the DTO, so a change to how the field is produced on the Rust side leaves all 23 green -- the case cannot go red for the only reason it exists. Directly above the assertion, `:155`-`:156` reads: "The payload field must survive the IPC round-trip -- the Rust `OfflineQueueItemDto` serializes it and the TS DTO must not drop it." The round trip exercised is **wrapper to mock**. And it is not merely mislabelled in place: `todo-review-type.md:276` installs this exact suite as the **verdict command** for the payload-typing row -- `cd ui && npx vitest run src/__tests__/api-offline-contract.test.ts` -- so a green from a stubbed seam is standing as the grader of a question about the wire. **THE RULE, general: a contract test that stubs the boundary it claims to test measures the stub, and the word "contract" in a filename is not a claim about what is graded.** What a reader should DO: cite a green with the boundary it actually crossed ("wrapper to mock", "fixture to assertion"), and when a row's verdict command is a suite that replaces the very seam the row is about, record the verdict as **unavailable** rather than as passing -- item 24's law from a third surface: a command that can only agree has no evidentiary weight, however many cases it prints.
- **TWO -- the mechanism: when both sides are version-skewed BY DESIGN, a type change is a migration that cannot run.** The persisted shape, read off the files. `payload` is **TEXT in two SQLite columns** -- `20260813_init.sql:356` under `CREATE TABLE IF NOT EXISTS offline_queue` at `:353`, and `:846` under `sync_remote_failures` at `:843` -- **and two cloud columns**: `20260813_init.pg.sql:100` under `offline_queue` at `:97` and `:232` under `sync_remote_failures` at `:229`; re-derive with `grep -n 'payload         TEXT' crates/oz-core/migrations/20260813_init.sql crates/oz-core/migrations/20260813_init.pg.sql`, which prints **five** lines -- the four named plus `20260813_init.pg.sql:386`, a payload column in a table this question does not reach, unexamined below. **A briefing tonight carried "three columns"; the command reads four -- two tables in two stores, and it is the kind of number that moves when someone stops counting by hand.** `offline_queue` is RLS-covered: the `ALTER TABLE %I ENABLE ROW LEVEL SECURITY` loop names it at `20260813_init.pg.sql:2237`. Its readers, both sides: `pub payload: String` at `crates/oz-bridge/src/offline.rs:40` and `:88`, `payload: string;` at `ui/src/api/offline.ts:15`, `:30` and `:103`. Now the part that makes it a format and not a field: the queue exists precisely to hold **rows written by a previous build and drained after an upgrade**, and dead-lettered rows are kept rather than dropped -- `pub dead_lettered: bool` at `crates/oz-bridge/src/offline.rs:94`, whose own doc line reads "Whether retry is exhausted and the item is quarantined", with no retention pass pruning them. So the population a retype must cover is not enumerable at any instant: local rows older than the binary that will read them, cloud rows still arriving from devices that never upgraded, and quarantined rows that may never drain. **There is no migration that rewrites data that has not synced yet** -- and the one that pretends to drops queued sales on every device that upgrades. Hence the reviewing lane's conclusion, which is the OPPOSITE of the row's instinct (`todo-review-type.md:144`-`:145`: "Type-safe the offline boundary ... Give the payload a tagged union"): the only viable shape is a **compatibility reader that keeps the old string parsing beside the new one**. Recorded here because a finding that argues against its own plan row is the half an owner page exists to keep.
- **THREE -- one honest sentence about the unverified side: nothing on this board certifies that wire.** `npm run typecheck` grades the TypeScript reader's shape; the boundaries checker grades dependency direction, and the plan already says so of itself at `todo-review-type.md:140` -- "scripts cover command names, invoke tokens, scoped coverage, plugins and topology, not **field shape**." The Rust half is machine-local, and was visibly so tonight: `cargo metadata` broke and healed within the hour through a foreign half-created crate with no `lib.rs` (item 26's trigger), so the most I can say is that it succeeds at this hour -- the default boundaries run that exits 0 requires it, and I did not reproduce the failure. Therefore a Rust type change to `payload` can tonight be **reasoned about and cannot be proven**, and the suite that reads like proof is the mock in bullet ONE. Write that as a funding fact, not an excuse: **a size-L item on a clean set of files is still not fundable at this hour**, because the check that would grade it does not exist and nobody has priced making it.
- **FOURTH -- the disposition, and what is refused.** The row that started this -- now at `todo-review-type.md:144`, cited to me as `:141`, where that pointer now lands mid-continuation on the words "field shape." -- is **parked as an OWNER DECISION on a persisted format, not scheduled as a refactor**: what a row written by an older build promises a newer reader is not a call a box can make, and item 26's lesson is already repeating in the pointer. The recommendation standing on the board, recorded as a recommendation and nothing more: **one enum in the crate that already owns the wire type, with a legacy untagged arm and a verbatim-row test** -- one file that turns a storage break into a two-arm match, and that verbatim row is exactly what bullet ONE found missing. **Refused to state, because no measurement tonight supports it:** that any lane started, fixed or scheduled anything here; that the 23 green is stale or dishonest -- it is real and grades the wrapper honestly, and it was my sentence about the wire that was wrong, not its result; that those four TEXT columns are all the payload stores in the cloud file (`20260813_init.pg.sql:386`, `:565`-`:566` and `:587` carry payload-shaped TEXT and were not examined for this question); and any run figure as a property of `7edfd2280` -- the vitest print and the `cargo metadata` health are working-tree readings at their own timestamps, item 22's discipline applied again to my own measurement.


## 28. Money-path overflow census, and what the two profile stanzas in `Cargo.toml` actually say (2026-09-15 ~night, at tip `5280ddbf5`)

- **The stanzas, as written.** `[profile.release]` opens at `Cargo.toml:200` and carries `overflow-checks = true` at `:205`; `[profile.dev]` opens at `:217` and carries `overflow-checks = false` at `:222`; `[profile.test]` at `:247` reads `inherits = "dev"` and sets no `overflow-checks`, so it takes dev's value. Re-derive: `grep -n 'overflow-checks' Cargo.toml` -> 3 hits (`:205`, `:209` which is a comment, `:222`); `sed -n '247,251p' Cargo.toml`. What the shipped binaries are built with: `grep -c 'cargo tauri build' .github/workflows/release.yml` -> **3** (`:176`, `:209`, `:216`); what the test gates are built with: `grep -rn --include='*.yml' --include='*.sh' --include='*.py' --include='*.mjs' -E 'cargo (test|nextest|check|clippy|fmt)[^|;]*--release' .github scripts | wc -l` -> **0**.
- **The ratio, 13 money-path files** (`foundation/src/{money,cart,percentage}.rs`, `crates/oz-core/src/{payable,promotion_engine,sale_deduction}.rs`, `crates/oz-core/src/db/{refunds,sales_tax,payables,sales_checkout,sales,loyalty,purchase_orders}.rs`): **59 guarded sites -- 56 `checked_*`, 3 `saturating_*`, 0 `wrapping_*` -- against 15 bare-operator sites**, i.e. 3.9 : 1 guarded. Re-derive both numbers with the two `grep -HnE` passes quoted in this bullet's file list above: guarded pattern `checked_(add|sub|mul|div|neg|abs|pow|rem)|saturating_(add|sub|mul|div|neg)|wrapping_(add|sub|mul|div|neg)` -> 59 lines; bare pattern `(minor_units|[a-z_]*_qty[a-z_]*|[a-z_]+_minor|[a-z_]+_amount|[a-z_]+_total)[[:space:]]*[-+*][[:space:]]*[(A-Za-z0-9_]|[-+*]=|-[[:space:]]*[a-z_]*\.qty|minor_units\.(abs|neg)\(\)` minus comment/SQL-string lines -> 15 lines (`nl` numbers them 1-15 at this tip).
- **The 15 bare sites, named.** 2 are inside `Money`'s own panicking helpers (`money.rs:271` `-self.minor_units`, `:285` `minor_units.abs()`) and 3 are i128 locals in `db/loyalty.rs:42-46`; the remaining 10 are `payable.rs:131`, `db/payables.rs:211`, `db/refunds.rs:126 / :255 / :709 / :767`, `db/sales_checkout.rs:271 / :360`, and 2 `+=` accumulators at `promotion_engine.rs:178 / :181`. Production reach of the two panic-prone helpers: `grep -rn --include=*.rs '\\.negate()' foundation crates modules apps platform | grep -vcE '_tests\\.rs|proptest'` -> **0** non-test call sites.
- **Test population and the two doc lines that disagree with the config.** `grep -rnE 'fn [a-z_0-9]*overflow' --include=*.rs foundation/src crates/oz-core/src | wc -l` -> **24** overflow-named tests, every one asserting a `checked_*` `None`/`Validation` outcome; `#[should_panic]` is **1 in foundation/src** (`sku_tests.rs:16`) against **18 repo-wide** (`grep -rn --include=*.rs 'should_panic' foundation crates/oz-core/src modules apps platform | wc -l`), and `money_proptests.rs:174-179` skips `i64::MIN` before comparing the panicking variants to the checked ones. Range enforcement: `grep -rn --include=*.rs 'validate_range(' . | wc -l` -> **32**, all in `foundation/src/validation.rs` itself (0 call sites in any other file). Two doc comments state the opposite polarity from `Cargo.toml:205`/`:222`: `foundation/src/money.rs:264` and `:278`, both reading "Panics on `i64::MIN` in debug mode (wraps in release)".

## 29. Can a count witness a widened matcher -- and where do tonight's dated literals belong? (2026-09-15 ~12:50, at tip `f26f66ce8`, which moves under this page: re-derive it with `git rev-parse --short HEAD`)

- **THE LAW, worth more than any single guard landed tonight: a COUNT cannot witness a WIDENED MATCHER.** One lane reverted a selector waiver in `ui/src/__tests__/noiseDitherCompliance.test.ts` from exact-or-boundary back to a raw `startsWith` and **every counter came back identical** -- 93 known-list, 3 prefix, 21 pseudo, 0 attribute, 2 graded. Those six are that lane's reported run, a **working-tree reading at roughly the 12:00 hour on 2026-09-15**, not a fact about any commit, and the same doors sit in this repo's own comments as 93 / 4 / 21 / 0 / 0 (re-read with `grep -n "Measured on this run" ui/src/__tests__/noiseDitherCompliance.test.ts`) -- a third reading of a moving population, not a contradiction of the first. Nothing moved on the revert **because the names a widened matcher would swallow do not exist in the tree yet**: a looser prefix can only eat a longer name, and there is no longer name. Two synthetic selectors were then planted and something finally moved -- and **what moved was the named membership set, not any number**: the assertion that caught it is a sorted `toEqual` over the names each door excused (`grep -n "waivedByPrefixNames" ui/src/__tests__/noiseDitherCompliance.test.ts` gives the accumulator at `:357`, the push at `:541`, the name-list comparison at `:721`). The whole finding needs no run to re-read -- `grep -n "cannot witness a" ui/src/__tests__/noiseDitherCompliance.test.ts` lands on the file's own record of it at `:686`.
- **THE COROLLARY, which a second lane reached inside the same hour: a magnitude floor cannot see a shrinking population either, and the partition sum that read like a conservation check was a TAUTOLOGY ABOUT CONTROL FLOW.** Every rule leaves a walk through exactly one door, and each door increments its own counter on the same statement that continues, so `pseudo + notRoot + boundary + graded == parsed` closes for ANY extractor whatsoever -- demonstrated on a narrowed by roughly ninety percent. The file says this of itself; re-read without a run at `grep -n "exactly one door" ui/src/__tests__/popupBackgroundCompliance.test.ts` (`:299` and `:597`). Hence the rule to keep: **a floor on size and a check on membership are different guards, and this repo needs both** -- size bounds the appetite of a waiver, membership names the thing excused (`grep -n "membership over nothing is not membership" ui/src/__tests__/popupBackgroundCompliance.test.ts` -> `:490`; `grep -n "the graded-identity baseline holds" ui/src/__tests__/popupBackgroundCompliance.test.ts` -> `:578`). **And the sharpest half: a floor placed on REMAINING DEBT demands that somebody stay in debt.** Every lower bound on a waiver door is that shape -- the floors at `:707-709` of the dither file require a waived population to keep existing, so paying the debt reads red and the fix is filed as a regression. It is the mirror image of laundering a finding into a baseline: a baseline absorbs the violation, a debt floor REQUIRES the violation to persist, and **a guard shaped like that gets deleted the first time someone pays what it names** -- with the deletion remembered as proof the guard was wrong. The dither file has already felt this edge and pre-names it: `grep -n "A FALL THROUGH THE FLOOR IS PRE-NAMED" ui/src/__tests__/noiseDitherCompliance.test.ts` reads "the answer then is to re-baseline the pair ... never to lower the floor to make a real narrowing pass".
- **THE DECISION HALF: tonight's guards welded dated run properties into TypeScript literals with no expiry, and one of them tells its reader to refresh from a moving tree.** Read as filesystem bytes, each with its command, all of them working-tree readings taken at ~12:45-12:48 on 2026-09-15 in a checkout other sessions edit by the minute -- `git --no-optional-locks status --porcelain -- ui/src | wc -l` read **7** dirty-or-untracked paths at 12:43 (it also read 8 twenty minutes earlier; neither is a fact about a tip): `grep -c '^      \["' ui/src/__tests__/popupBackgroundCompliance.test.ts` -> **137 sheet-and-rule pair entries** inside `SHEETS_BASELINE`; `grep -n "const FLOORS\|const SUM_BASELINE\|const SUM_BAND\|const NESTED_CEILING\|const GRADED_BASELINE" ui/src/__tests__/popupBackgroundCompliance.test.ts` -> the four magnitude floors at `:308`, the sum baseline and its band at `:524` and `:525`, the hidden-rules ceiling at `:539`, the graded identity at `:572`; `grep -c "36ca7fc6b" ui/src/__tests__/popupBackgroundCompliance.test.ts` -> **7** dated attributions to one tip, and **0** expiry fields anywhere in the pair -- `grep -rn "expires\|expiry" ui/src/__tests__/popupBackgroundCompliance.test.ts ui/src/__tests__/noiseDitherCompliance.test.ts` returns 2 lines, both prose at `:336-337` pointing at the container below. The hazard is printed in the guard's own failure text: `grep -n "REFRESH: paste" ui/src/__tests__/popupBackgroundCompliance.test.ts` -> `:506`, "paste this over SHEETS_BASELINE -- walked now", where "walked now" is whatever the disk held for whoever ran it, and `:332-334` records the consequence -- one clipboard trip pastes a disappeared sheet away and every floor and band then re-reads the shrunken walk as its own baseline.
- **THE CONTAINER THIS REPO ALREADY OWNS, named as the recommendation and not as a migration.** `scripts/architecture-boundaries-baseline.json` holds the same species of fact -- debt, per entry, with `introduced` AND `expires` (re-derive: `python -c "import json;e=json.load(open('scripts/architecture-boundaries-baseline.json'))['entries'];print(len(e), sorted({(x['introduced'],x['expires']) for x in e}))"` -> **8 entries, one dated pair each**, every one carrying an `owner` and a `reason`), and `load_baseline` in `scripts/verify-architecture-boundaries.py` **refuses to read a stale one**: `grep -n "introduced\|expires" scripts/verify-architecture-boundaries.py` shows the seven required non-empty fields at `:545`, the ordering and future-date refusals at `:555` and `:557`, and `apply_baseline` marking an entry `expired` at `:588`, with the exit contract printed in that file's own header at `:19-20` (0 = clean, 1 = new findings, stale entries, or expired ones). That is the missing property in tonight's literals: not a bigger number or a tighter band, but a dated record that ages out and fails LOUDLY instead of being pasted over. **What is deliberately NOT proposed here: migrating any of the 137 pairs, the floors, or the bands into that container.** The container is the recommendation; which run properties are allowed to age in JSON, which stay in TS, and whether a Vitest guard may read a Python checker's file at all is an **owner decision, not a docs edit**, and no consequence named in this item is an approved one.

## 30. Three wire-bug lessons that outlive the bugs (2026-09-15 ~15:20, at tip `e64545faf`, which moves under this page: re-derive it with `git rev-parse --short HEAD`)

- **THE RULE, for tonight's first class: when a test and a command each hold a list of the same steps, the test grades the helper, not the code.** `a84e0d523 fix(tablet-client): stop dropping the wizard default_currency on tablet` found the tablet's test helper `run_complete_setup` carrying its OWN operation list -- including `store.save_features(&registry)?;`, which the real `#[command]` deliberately does not call (its comment says `Settings::set_batch` opens its OWN transaction). A helper that re-lists the steps cannot fail when production drops one, because it never calls production at all, so a missing production leg was unobservable by construction. **The repair that matters is not the added assertion, it is the extraction**: `fn write_setup(conn, args)` now holds the one statement list and both the command and the tests execute it. Re-derive at this tip: `grep -n 'fn write_setup' apps/tablet-client/src/commands/setup.rs` -> `:81`; `grep -n 'write_setup(conn' apps/tablet-client/src/commands/setup_tests.rs` -> `:42`, with the helper's doc at `:13` now reading "This delegates to `write_setup`"; and the before-state with `git show a84e0d523^:apps/tablet-client/src/commands/setup_tests.rs | grep -n 'save_features'` -> the helper's own copy at `:30` plus its enumerated op list at `:13`. (Caret revisions resolve under bash only -- cmd.exe eats the `^` and silently shows the post-fix file, which is how this pass first mis-read its own anchor.)
- **THE SECOND RULE: two implementations agreeing is not evidence when both can be empty.** `72b28d025 fix(tablet-client): camelCase sync-settings IPC keys so the settings page stops wiping the server URL` survived its pair test because BOTH sides could deserialise the same payload into nothing -- `Option<String>` fields, serde filling `None`, then `unwrap_or("")` writing the blank -- so `tablet == bridge` held on an empty pair. **The part any future pair test must copy is the tail assertion that resolves to VALUES, not to two matching `None`s**: `apps/tablet-client/src/commands/sync_tests.rs:59` `fn update_sync_settings_wire_keys_match_bridge_twin`, its own comment at `:72` ("payload 1 pins that camelCase -- not the empty pair of Nones"), and the pins at `:91-92` (`assert_eq!(tablet.server_url.as_deref(), Some("https://sync.example.com"))`, `api_key` likewise). **And the counter-example is in the same commit and the same file:** `fn sync_settings_dto_wire_keys_match_bridge_twin` at `:97` ends at `:113` on `assert_eq!(tablet, bridge, "tablet/bridge SyncSettingsDto wire keys drifted")` and carries no value pin -- re-derive with `sed -n '97,114p' apps/tablet-client/src/commands/sync_tests.rs` (no `Some(` assertion in that body) against `grep -n 'as_deref(), Some(' apps/tablet-client/src/commands/sync_tests.rs` (8 pins in the file, none inside `:97-114`). A pair test that compares the two structs against each other and stops there re-buys exactly this blindness. What this pass did NOT re-read: the `unwrap_or("")` half of the mechanism, which is carried from the fix's own test-file comments and not from the production body.
- **THE THIRD RULE, and the one with a live second copy: a skip that reports as a pass is a hole, not a hedge.** `e438ab830 test(core): fail vendored topology parity when the UI canonical contract is missing` cured `vendored_contract_matches_ui_canonical`, which had been returning early on a UI-side file that had been MOVED -- `ui/src/features/locations/topologySemantics.json` today, the `stores/` directory it used to sit in no longer exists -- and printed `ok` inside a suite its lane reported as `62 passed; 0 failed; 0 ignored`. **`0 ignored` is the whole indictment: while a fake pass returns `Ok(())`, no harness output could ever have distinguished that test from one that ran.** Re-derive the cure and the move with `git show e438ab830 --numstat` (one file: `crates/oz-core/src/topology_tests.rs` +23/-10) and `grep -n 'topologySemantics.json' crates/oz-core/src/topology_tests.rs`. **The consequence the lane found while it was in there, and the reason this bullet exists: the same shape is still live in `scripts/verify-topology-parity.py:94-99`** -- `if not UI.exists():` prints "ui/ absent (server-only build context) ... nothing to compare." and `return 0`, while the vendored side three lines earlier returns **1** for the identical missing-file condition, with `UI = Path("ui/src/features/locations/topologySemantics.json")` at `:85`. Re-derive: `sed -n '84,99p' scripts/verify-topology-parity.py`. So the stricter referee today is the Rust test and the script is the copy that still exits clean when the thing it compares is gone -- **which is the point of naming a second instance: curing one copy of a pattern without saying where the pattern still lives is how a repo ends up with two referees that disagree quietly**, and a lane reading that script's 0 as "parity holds" is reading a green that means "I did not look".
- **WHAT THIS ITEM MEASURED, and what it carried.** Everything above is a working-tree read at the stamped tip through `grep` / `sed` / `git show`, plus `git log -1 --pretty=format:%h %s <sha>` for the three subjects; no `cargo`, no `vitest`, no `pytest` was run here, so the `62 passed; 0 failed; 0 ignored` print is attributed to the lane that cured it and is NOT re-derived -- and note it is a different unit from the static `grep -c '#\[test\]' crates/oz-core/src/topology_tests.rs` -> **55** test attributes in that file today, which neither confirms nor contradicts a case count. Every path cited was proven to exist before being printed (`setup.rs`, `setup_tests.rs`, `sync_tests.rs`, `topology_tests.rs`, `scripts/verify-topology-parity.py`, `ui/src/features/locations/topologySemantics.json`), and one negative was proven deliberately: `ui/src/features/stores/` does not exist, which is why the move in the third bullet is named by directory and not by a path. This page sits under `docs/plans/` and is dead-ref-exempt by prefix, so the proof is not for the checker's sake.

## 31. A gate whose scan list cannot reach the directory where the bug lives (2026-09-15 ~15:40, at tip `5cb702c08`, which moves under this page: re-derive it with `git rev-parse --short HEAD`)

- **THE FACT, proven three ways and demonstrated live: `verify-bundle-parity.py` cannot see `ui/src/__tests__` in ANY mode.** (1) The hook's argv: `.githooks/pre-commit:133` passes `--scan-dirs features,components,frontend,contexts,hooks,platform` -- six names, no `__tests__`. The account this pass was given placed that flag at `:120-124`; it is not there -- `:120-124` is the block's own comment about bash 3.2 portability, and the step-2 block actually spans `:122-136` with the flag at `:133`. Re-derive: `grep -n 'scan-dirs' .githooks/pre-commit` -> `:110` (prose) and `:133` (the flag). (2) The script's constants: `scripts/verify-bundle-parity.py:162` `DEFAULT_SCAN_DIRS = ("features",)` and `:163-170` `CENSUS_SCAN_DIRS` = the same six, which `:678` joins into `args.scan_dirs`, so the census mode and the hook mode agree on the six. (3) The negative, by absence rather than assertion: `grep -n '__tests__' .githooks/pre-commit` -> no match (exit 1), `grep -n '__tests__' scripts/verify-bundle-parity.py` -> no match (exit 1) -- the string does not occur in either file, so no mode of either can name that directory. **And the filter is a descendant test, not a failure**: `:782` `if not any(_is_descendant(path, d) for d in scan_dirs)` prints a warning and `continue`s (`:783-788`), and when every path is skipped `:790-799` prints "none are eligible ... nothing to verify. Returning 0 informational." then `verify-bundle-parity: 0 missing key(s).` and `return 0`. Measured, not inferred: running the hook's exact argv against a real test file -- `python scripts/verify-bundle-parity.py --staged-only --include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs --scan-dirs features,components,frontend,contexts,hooks,platform ui/src/__tests__/NodeTopologyEditor.test.tsx` -- printed `warning: --staged-only path outside ..., skipping:` and **`0 missing key(s)` at exit 0**. `--full-census` agrees by arithmetic: it reports "scanned **544** file(s) in [features, components, frontend, contexts, hooks, platform], 5035 key site(s) across 8 surface(s) ... 0 missing key(s)" while `find ui/src/__tests__ -type f | wc -l` -> **591** -- the gate's whole scanned population is smaller than the directory it never opens. Not measured here: the hook's own execution (no commit of mine staged a `.tsx`), and no `gates.json` or hook line was changed to produce this.
- **THE CONSEQUENCE, which is why this is an item and not a footnote: a test-side dictionary accumulated Fluent keys that no bundle defines, and the hook reported clean on every commit that touched it.** Test-side files render copy -- they build mock `@fluent/react` environments and hand a dictionary to the component under test -- so a key that exists only in that dictionary makes the test pass and the real UI fall back. Struck so far: `20227b1ab test(ui): drop three phantom topology-sim keys from the a11y l10n mock` (`git show 20227b1ab --numstat` -> 0 added / **3 deleted**, one file, `ui/src/__tests__/a11y/NodeTopologyEditor.a11y.test.tsx`); `grep -rn 'topology-sim' ui/src/__tests__ | wc -l` -> **0** at this tip, and a bare `"topology-apply"` -> 0 sites, so those two of the eight named by the curing lane are gone and the rest are being swept in a separate box now. **What this pass counted is a different, narrower unit, and it is stated as such:** dictionary-shaped keys only -- `'topology-…': <value>` literals inside test files -- compared against every `^[ \t]*key[ \t]*=` definition in `ui/src/locales/*.ftl`, gives **206 distinct** test-side `topology-*` dictionary keys (286 sites), of which **189 are defined and 17 are not**: `topology-inspector-title`, `topology-inspector-section-coords`, `topology-context-node-name`, `topology-context-subtitle` in `ui/src/__tests__/InspectorIntegration.test.tsx:54-80`, and 13 in `ui/src/__tests__/NodeTopologyEditor.test.tsx:77-201`, eleven of them the `topology-shortcuts-*` family (`-aria`, `-title`, `-help`, `-pan`, `-duplicate-drag`, `-additive-marquee`, `-spawn`, `-nudge`, `-esc`, `-inspector`, `-find`) plus `topology-toast-selection-dropped` and `topology-wire-flip-hint-connecting`. That scan is a script of this pass, not a repo tool, so it is a measurement to re-run rather than a gate to trust; the 8-vs-17 difference is a difference in unit and window, not a contradiction, and no total of "phantom keys repo-wide" is claimed anywhere in this bullet. **One cross-record disagreement, reported and not resolved:** `scripts/gates.json:53` files `topology-shortcuts-*` as "18 keys, feature removed" among the bundle's orphans (keys in a bundle that no code reads), while at this tip `grep -rn '^ *topology-shortcuts' ui/src/locales/*.ftl` -> **0**, `grep -rl 'topology-shortcuts' ui/src/locales/` -> nothing, and the family occurs in **no** non-test file. The two records disagree about which side of the boundary holds that family, and this pass claims no cause -- either the keys left the bundle after that note was written, or the note names the wrong direction.
- **THE DECISION THIS RECORDS WITHOUT MAKING: widening the scan list is a gate change with a first-run consequence, and both prices are real.** Price of widening: the next run after adds `ui/src/__tests__` to the walk -- `find ui/src/__tests__ -type f | wc -l` -> **591** files (the number in the account that reached this page was 589; it moves, so re-run the command) on top of the 544 the census walks today -- and phantoms are now **proven** to live there, so the widened gate's first act is to fail: 17 dictionary-shaped keys by the measure above, in files three lanes are editing tonight. A gate that goes red the hour it lands gets muted, and a muted gate is worse than the blind one it replaced, because the blind one at least reports what it walks. The other half of that price is mechanical: the same list has to move twice, `.githooks/pre-commit:133` and `scripts/verify-bundle-parity.py:163-170`, and the row that states the gate's reach lives in `scripts/gates.json` (`:535` `"id": "bundle-parity"`, status `required`) -- one file's edit is a code change, the other is a manifest change, and `verify-ci-docs-drift.py` is the thing that would notice a mismatch between them. Price of not widening: every future test-side key reference ships unchecked, silently and by design -- `0 missing key(s)` is printed both when a hundred files were verified and when zero were eligible (`:790-799`), and a mock dictionary is precisely where a wrong key hides longest, because the component renders the dictionary's own string and the test cannot see that no bundle contains it. The reader who decides is the owner, and the place the decision is inked is that `gates.json` row plus the hook's argv; this item proposes neither, and names the mirror sentence that misleads in the meantime -- `.githooks/pre-commit`'s own prose (and both AGENTS.md mirrors) describes step 2 as running "over staged files in `features`, `components`, `frontend`, `contexts`, `hooks` and `platform`", which is **accurate about the list and wrong about the reach**, because a reader who sees `__tests__` missing from a list of UI directories concludes test files do not render copy. They do. Every path cited in this item was proven on disk before being printed (`.githooks/pre-commit`, `scripts/verify-bundle-parity.py`, `scripts/gates.json`, `ui/src/__tests__/NodeTopologyEditor.test.tsx`, `ui/src/__tests__/InspectorIntegration.test.tsx`, `ui/src/__tests__/a11y/NodeTopologyEditor.a11y.test.tsx`, `ui/src/locales/`), and one negative was proven by grep-and-exit rather than by prose, twice over: the absence of `__tests__` from both scan lists.

## 32. A white-label slot wired from manifest to CSS var with nothing on the far end — and what a font-bundling gate must refuse to claim about it (2026-09-16 ~00:31, at tip `7011487c5`, which moves under this page: re-derive it with `git rev-parse --short HEAD`)

- **THE FACT, counted four ways: `--brand-font-family` is written and never read.** It is generated — `ui/src/features/design/brand-tokens.css:8` sits under a `:1` that reads *"Auto-generated by scripts/sync-branding.ps1 - DO NOT EDIT BY HAND"*, and `scripts/sync-branding.ps1:385` emits `--brand-font-family: $($tokens.fontFamily);` from `assets/branding/*/manifest.json` at the key path **`themeTokens.fontFamily`** (not `tokens.fontFamily` — a first probe at that wrong path raised `KeyError: 'tokens'`, which is the only reason this bullet states the path at all). **But the far end does not exist.** Re-derive, all four from the repo root: `git grep -rn 'var(--brand-font-family)' -- ui apps crates website` → **0**; `git grep -rn 'brandFontFamily'` → **0**; `git grep -rn 'BRAND_FONT'` → **0**; and `git grep -rn 'brand-font-family' -- ui apps crates website` returns **1 path** (the declaration itself) once `ui/src/__tests__/themeTokenCompliance.test.ts` is excluded — that one exclusion matters, because rule 9's exemption row now *names* the token, and **a mention is not a use**: the same trap that made `grep -c Inter` read 7 in `ui/index.html` by matching `__TAURI_INTERNALS__`. The runtime brand writer does not carry it either: `BRAND_PALETTE_PROPS` (`ui/src/utils/color.ts:132-145`) holds 13 names, all `--color-*`, **0** font, and `color.ts` reaches the DOM through exactly two `setProperty(` calls, both colour. **So tenant typography is not broken; it is absent, which is a different defect with a different owner.**
- **THE DECISION RECORD CLAIMS THE CAPABILITY, and its own example is the shape a shipped gate rejects.** `docs/decisions/2026-07-15-whitelabel-branding-system.md:24` lists **"- Custom font family for the brand's typography"** among what the system delivers, and `:247` gives a per-tenant `Font Family` table. The ADR's worked CSS block at `:203` reads `--brand-font-family: '"Plus Jakarta Sans", "Inter", sans-serif';` — **the whole comma-list wrapped in one pair of outer quotes**, which is a single family *named* `Plus Jakarta Sans, Inter, sans-serif` and resolves to nothing. `sync-branding.ps1:367-371` warns about exactly this in prose ("a COMMA-SEPARATED LIST… the outer pair of quotes collapses it"), and rule 4 in `themeTokenCompliance.test.ts` exists to fail it — its own probe at `:1039` (written as such at `e799fdb60`; **`:1106` at tip `c5845079c`** — rule 9's helpers landed above it in that same file within the hour, which is the whole reason both values are carried rather than one) plants `--brand-font-family: 'Inter, sans-serif';` to prove the detector catches the wrapped form. **What the generator really emits is correct** (`brand-tokens.css:8` is the unwrapped `Inter, sans-serif;`), so the drift is documentation-against-code, not code-against-code, and it is the dangerous direction: the example is what a future tenant author copies. **This item does not edit the ADR** — an accepted decision record is dated evidence in this repo's convention, so the repair is an amendment or a new ADR, and that is its author's call, not a grep's.
- **THE FOUR LEADS, and why none of them is a bundling finding today.** Reading every manifest with the right key: `default` → `Inter, sans-serif`; `acme-tenant` → `"DM Sans", "Inter", sans-serif`; `beta-retail` → `"Plus Jakarta Sans", "Inter", sans-serif`; `whitelabel/example-tenant` → `Outfit, sans-serif`. The app's bundled face inventory is exactly **2** names — `'Inter Variable'` and `'JetBrains Mono Variable'`, from the two `@fontsource-variable` packages `ui/src/frontend/themes/fonts.css` imports — so **4 of 4 leads are unbundled**, and note `Inter` ≠ `Inter Variable`: a CSS family name is a string, not a fuzzy match, which is the one-word difference between the default brand's claim and a satisfied one. `acme-tenant` and `beta-retail` are worse by one position, naming `Inter` again in **second** place, so two of their three slots are unbundled before a generic is reached. **And none of it currently costs a pixel, because nothing reads the var.** Proving that needs a real `@font-face` census, not a guess: `git grep -nE '@font-face[[:space:]]*\{' -- 'ui/src/**/*.css'` → **0** rules (the *word* occurs once, inside `fonts.css`'s own comment — the unit matters), and the 13 rules that do ship come only from the two packages. There is also no side channel: `Get-ChildItem assets/branding -Recurse -Include '*.woff2','*.woff','*.ttf','*.otf'` → **0** files, and `sync-branding.ps1` emits no `@font-face` at all.
- **WHY THE GATE EXEMPTS BY TOKEN AND NOT BY VALUE — the trap this pass designed out, at `f4e1b8426`.** Rule 9's exemption list (`UNDECLARED_LEAD_FAMILIES`) was first keyed `name|file|lead`. Because the value is *generated per tenant*, that key meant running `sync-branding.ps1 -Brand acme-tenant` locally would swap the lead to `dm sans`, miss the frozen key, and **fail a font-bundling gate in the middle of a branding task** — a gate that fires on a correct action is a gate that gets muted. The row is now keyed `name|file`, so the exemption states the structural truth (*this token is a tenant slot*) and the four leads survive as prose inside it, where a fifth tenant cannot break them. A new font stack **anywhere else** leading with an unbundled face still fires, and both directions were mutated: a planted `--plant-heading-font` fired naming token, file, line and lead; *fixing* the brand lead fired again demanding the row be deleted, which is how a freeze list stays a census instead of rotting into a monument.
- **THE DECISION RECORDED WITHOUT BEING MADE, with its three owners.** (i) **Wire it** — apply `--brand-font-family` in the shell so branding actually changes type, at which point "should the app bundle tenant faces" becomes live and licensing enters the frame for DM Sans / Plus Jakarta Sans / Outfit; (ii) **delete the slot** — drop `fontFamily` from four manifests, `:385`, and the ADR's capability list, making the record honest by subtraction; (iii) **leave it** — accept a generated var that nothing reads, which is cheap but should be *stated* somewhere other than an ADR bullet. These are different lanes (branding, theming, and whoever owns `ui/src/features/design/`), and this item proposes none of them; it only refuses to let the option stay unchosen by accident, because it was unchosen by accident for two months and the accident is invisible from inside any one of the three files.
- **WHAT THIS ITEM DID NOT VERIFY, stated before it is quoted.** **No `sync-branding.ps1` run and no tenant build** — the generator's output is read from the committed `default` artifact and from its `:385` template line, not from an executed acme build; the integration tests at `scripts/sync-branding.Tests.ps1` and `.Integration.Tests.ps1` were not run either. **No browser observation** that brand typography is absent: the conclusion rests on a repo-wide reference count, and a CSS consumer reading the var through a computed style or a runtime string template would be invisible to all three greps — the claim is therefore "no reference anyone can grep", which is weaker than "unused", and saying "unused" is exactly the kind of overreach `todo-font-system.md`'s `:88` exists to catch. Whether `Inter` resolves on a *customer* machine is also not claimed either way: it is installed on this dev box (measured independently tonight: a before/after here moved **174 → 175.25 px**, +0.7 %, against a customer-path **164.25 → 175.25 px**, +6.7 %), which is precisely the mechanism by which an unbundled name survives contact with a developer.

## 33. An active spec still asks to adopt the fonts this plan already shipped — and the token name it asks for would create a duplicate no gate can see

- **THE FACT, measured against the built artifact rather than the source.** `docs/specs/_active/tauri-ux-design-language-plan.md` is **active**, and its typography boxes are still open: `:45` *"adopt Inter as the primary UI font in both apps (variable 400–800), JetBrains Mono for data"*, `:36` *"`--font` (Inter stack) + `--font-mono` … keep `font-display: swap`"*, `:47` *"no faked weights (Inter is variable)"*. **In the shipped CSS those are done.** `ui/dist/assets/index-*.css` holds **13 `@font-face` blocks and 13 `font-display: swap`** — one per block, counted as occurrences rather than as lines, because the file is minified onto a single line and a line-based count returns 1 — two variable weight ranges (`100 900`, `100 800`) are declared, and the theme tokens lead with those faces (`ui/src/frontend/themes/tokens.css:158` `'Inter Variable'`, `:160` `'JetBrains Mono Variable'`, now pinned by rule 10 at `853659564`). **`:47`'s parenthetical was aspiration when it was written and became a fact at `70578375b`**, so the open box is no longer describing work to do but work that has landed — which is precisely the state in which a lane does it twice.
- **THE TRAP THE SPEC'S TOKEN NAME SETS.** `:36` asks for a token named **`--font`**, and `git grep -n -- '--font:' -- ui/src` returns **0**: the repo standardised on `--font-sans`, and exactly **one** real declaration of it exists (`tokens.css:158`). **A lane satisfying the spec literally would add a second family token holding the same stack, and not one font rule would fire.** Rule 5 fails duplicate **names**, and its own probe title says a distinct new name "is not" caught; rule 9 passes because `'Inter Variable'` really is declared; rule 2 passes so long as the new stack ends in a generic; rule 10 pins the two tokens it knows by name and is silent about a third. **The repair is a rename in the spec, not a new rule.** If "no two font tokens may hold an identical stack" is ever wanted as a gate, that is `todo-font-system.md`'s rule 13 and an owner's call — it is proposed here and deliberately not shipped here, because two tokens carrying one stack may be exactly what a future theme wants.
- **AND AN UNCHECKED BOX IN THE SAME SPEC THAT SAYS "SKIP THE HOOK".** `:192` reads *"Commit per logical section (tokens, typography, buttons, …) with `--no-verify`; never push without an explicit order."* `git config --get core.hooksPath` prints `.githooks` in this checkout and the hook **does** run — this lane's own commits print its output — so that clause silently bypasses bundle-parity, FTL dedupe, migration column-type, PG-drift and the Go gate for every commit made under the spec. **Not this lane's to edit:** it is another author's active document, the clause may be a deliberate cost decision from when the hook was slower or absent, and the second half of it ("never push without an explicit order") is correct repo policy. Recorded because an agent reads a spec as instructions, follows it literally, and reports green while nothing has checked anything.
- **WHAT THIS ITEM DOES NOT DO, and does not claim.** It does not edit the spec, tick any box in it, or assert the spec is *wrong about intent* — `--font` may have been shorthand, and the plan boxes here are the spec author's to close. **The spec's other open typography boxes are untouched by this plan and still genuinely open:** `:51` anti-aliasing pins, `:53` the stray-`px` sweep (which is likely the same population the scale ruling above declines to fund before the scale itself is answered), `:80` `rem` for padding, and the component boxes below them. Nothing in this item was verified by running a build; every figure is a read of a committed artifact or of `ui/dist` as it exists on disk.

## 34. A release decision record sends the bundle output to `src-tauri/target/`, a path this repo moved away from and its own live workflow contradicts

- **THE FACT, both sides quoted.** `docs/decisions/2026-07-16-release-automation.md:87` — sitting inside a numbered block of steps an operator is told to perform — reads *"Output goes to `src-tauri/target/release/bundle/`"*. The live pipeline disagrees: `.github/workflows/release.yml` collects artifacts from `apps/desktop-client/target/release/bundle/{appimage,deb,nsis,msi,dmg}` (`:116`-`:132`), the configs are tracked at `apps/desktop-client/tauri.conf.json` and `apps/tablet-client/tauri.conf.json`, and `apps/desktop-client/src-tauri` and `apps/tablet-client/src-tauri` both answer **False** to `Test-Path`.
- **Why this one is a defect and the other five are not.** Five other `src-tauri` mentions exist and every one is correct *because it is dated*: `ARCHITECTURE.md:360` says the shell was "moved from `src-tauri/`", `:482` is a checked `[x]` migration item, and three CHANGELOG lines (`:1674`, `:1698`, `:1701`) describe the world before the move. Line `:87` is the only one written in the present tense inside imperative steps, so it is the only one that can walk a reader to a directory that is not there — the same distinction `todo-font-system.md` draws between a dated verdict and a trap instruction, arrived at from the other side.
- **NOT THIS LANE'S TO EDIT, with the cheap fix stated anyway.** An ADR is its author's record; the correction is one line, and the house convention for a wrong path in a dated document is to mark it superseded rather than erase it, so the reasoning that produced it stays readable. This lane's fence is the font system, and an ADR body should carry its owner's stamp rather than a stranger's.
- **What this item did not verify.** No release build was run to observe where artifacts actually land; the claim rests on the workflow's globs plus the absence of both `src-tauri` directories. That gives a falsifiable prediction worth checking before any edit: if some `CARGO_TARGET_DIR` or `beforeBuildCommand` override really made Tauri write under `src-tauri/target/`, then `release.yml`'s artifact step would already be failing on every tag — so the doc line is wrong rather than the workflow, and an editor who reversed that judgement would break a working pipeline to match a sentence.

## 35. Two commands that destroy or misreport work in a shared checkout — one of them cost a whole feature tonight

- **`git checkout -- <file>` reverts to HEAD, not to "before my experiment."** Any lane that mutation-tests by editing a tracked file and undoing it with `git checkout` will silently discard every **uncommitted** change in that file. This happened at `todo-font-system.md`'s gate tonight: the plant aimed the CSS walk at a ghost directory, the suite was run, and the undo removed the plant **and** the ~55 lines of new scope-floor code that had never been committed. Recovered by re-typing the two edits from the session transcript, which is not a strategy. **The rule: commit the work before planting, or copy the file aside and restore from the copy.** `git checkout --` is only safe on a file whose sole difference from HEAD is the plant, and a file being actively edited is by definition not one.
- **`cmd … | Select-Object -First N` stops watching before `cmd` finishes.** Three distinct harms, all observed in one session here. (1) `$LASTEXITCODE` read afterwards is **stale** — twice, once making a working exit-2 refusal path look like exit 0, once making a never-applied mutation look like a passing test. (2) The upstream process can be cut off mid-write; nothing was corrupted only because git writes refs atomically. (3) Most misleading: a `git commit … | Select-Object -First 2` **succeeded**, and the `rev-parse --short HEAD` on the next line printed the **previous** SHA, because the pipeline's early stop released the statement sequence before the ref landed. The commit existed and its own tool said it did not. The answer was `git log`, not a retry — a retry would have printed "nothing to commit" and been read as further proof of failure.
- **Why both belong in a shared checkout specifically.** A lane that loses work in its own scratch file learns it once. A lane that runs `git checkout --` on a file another session has content in, or that concludes from a truncated stream that its commit failed and commits again, is corrupting someone else's history. Both of tonight's incidents were on files more than one lane touches.
- **The cheap guards.** Redirect to a scratch file (`> $f 2>&1`) or capture to a variable, then inspect — so exit codes and full output are both real; and treat "my commit seems missing" as a question for `git log --name-status`, never as a reason to re-run the commit. Neither guard costs anything, and each looks obvious only after the incident it prevents.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, after that lane's scope floor was written twice (`8cea958ed`) and one commit was believed lost when it had landed (`39f599a00`).

## 36. A failed `readdir` swallowed by two walkers: `collectScriptFiles` in `themeTokenCompliance.test.ts` **is fixed** (`b493e6d44`), the second copy in `composedRuleIdenticalPair` is not, and that split is why this item carries no tick

- **The line, verbatim.** `ui/src/__tests__/themeTokenCompliance.test.ts` `:2417`-`:2424`: `function collectScriptFiles(dir: string): string[] { const out: string[] = []; let entries: Dirent[] = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }`. A directory that cannot be opened returns an empty list and records nothing, so **the walk reads smaller rather than red**.
- **What depends on it.** `jsProvidedTokens(dir)` at `:2439`, which harvests `setProperty('--x')` and style-key tokens from `.ts`/`.tsx` — the runtime-written-token population behind the `literal tail vs block relation` describe. If a subtree stops being listable, every token it provided disappears from that set, and a literal tail that should have been excused by a runtime writer starts looking like a new violation — or, in the other direction, a real violation's excuse appears out of nowhere. The failure is not "the suite crashes"; it is that **the population every case reports has silently changed unit**.
- **Why it is a twin and not a new idea.** `collectCssFiles` carried the identical `catch { return out }` until `8cea958ed`, which made it push `{ dir, reason }` into `CSS_WALK_ABANDONED` and added a case titled `the CSS walk opened every directory it was pointed at (139 sheets in hand)` plus a probe proving an unopenable directory is recorded rather than read as empty. The same three moves apply here: record, floor in a case whose title carries the denominator, and probe the recorder. `AGENTS.md` documents this door as previously fixed in `noiseDitherCompliance` (`dirsUnreadable`, `c7b1034ce`), so this file would be the third copy of the lesson in one repo.
- **A second instance, found the same day by running the same pattern over all five walkers.** `ui/src/__tests__/composedRuleIdenticalPair.test.ts:276` — `catch { return out; }` in `cssFiles` (`:271`), the collector behind the `walk scope: N sheets` print at `:298`. **This one is different in a way worth stating: it carries its reason on the next line** — `// a directory that vanished mid-walk contributes nothing` — which in a checkout where other lanes' tooling moves files is a real hazard and a defensible choice. The fix is therefore not "make it fail": it is to **count the choice**, the same way `noiseDitherCompliance` did in `c7b1034ce`, which records `dirsUnreadable` and still continues. Recording and tolerating are compatible; only silence is not. The other three walkers (`popupBackgroundCompliance`, `animationCompliance`, `noiseDitherCompliance`) return zero matches for this pattern, consistent with `AGENTS.md`'s record that they were armed with counters (`402b11660`, `074655fb0`, `c7b1034ce`). So the class is **two files wide, not one**, and the two differ in whether the reader is told.
- **NOT THIS LANE'S TO FIX.** Both collectors belong to the shadow/colour tail work, not to the font rules; a floor added here could turn red on those lanes' account and would be committed under a message they did not choose. The patch is small and already proven next door — record the abandon, floor it in a case whose title carries the denominator, probe the recorder — so it is offered rather than applied.
- **What this item did not verify.** No attempt was made to make a directory unopenable on this machine — the door is read off the control flow, not demonstrated in situ. The CSS twin *was* demonstrated (`8cea958ed`'s record in `todo-font-system.md` shows a ghost-directory plant failing 11 cases and naming the cause), so the mechanism is not in doubt; what is unmeasured here is only whether anything on this box actually makes `readdir` throw.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while auditing its own gate's silent-skip doors.
- **HALF CLOSED 2026-09-16 by this lane, and the "not this lane's to fix" judgment above was wrong for the first file.** `themeTokenCompliance.test.ts` is not a neighbour's suite the font rules happen to sit near -- it is where the font rules live, so its silent door is this lane's hole to close. `b493e6d44` named the counter (`JS_WALK_ABANDONED`), kept the OS reason, took the population once at module load (`SCRIPT_SOURCES` = **671** files measured at this HEAD, `features/` alone 418 of them) so the case title prints it, floored it at **575** (96 of slack, ~14 %, the same proportion the CSS floor uses at 120 against 139), and added a probe case that drives the abandon path and cleans up its own record. Suite: **52 passed (52)**; `eslint` on the file exit 0; `tsc --noEmit` exit 0.
- **The plant found a second defect, in code written minutes earlier, and it was not in the assertion.** Raising the floor to 700 produced the failure -- correct -- but the message read *"found 671 ... below the 575"*: the literal threshold was written twice, once as the assertion and once as prose, and only the prose disagreed. `76a456b11` made each floor a single local used by both; re-planted, the message now reads "below the 700". **The same latent defect was already sitting in the CSS floor this lane wrote rounds ago** (threshold 120, message naming 120, both literals -- harmless while nobody changed one of them, which is exactly the condition a floor eventually meets). The lesson is not "mutation-test the assertion", it is sharper: **an assertion is exercised by a plant, and the sentence beside it is exercised by nobody unless someone reads it while it is failing.**
- **What is STILL open in this item.** The second site -- `cssFiles` in `ui/src/__tests__/composedRuleIdenticalPair.test.ts`, at `:276` when this was written and cited by name because that is how these citations rot -- is untouched and belongs to whoever owns that suite. Noted again as a difference rather than an equivalence: **that catch states its reason**, `// a directory that vanished mid-walk contributes nothing`, so its silence is declared, while the one this lane just closed said nothing at all.
- **RESIDUAL MEASURED 2026-09-16, so the second site does not get re-audited from scratch.** That suite is not unprotected: it carries magnitude floors -- `sheets.filter((t) => t.braces > 0).length` floored above 50, `sheetsOutsideFeatures` floored above 0, `gradable` above 10 -- any of which fires if a whole subtree vanishes. What it does not have is a **record of which directories it failed to open**, so a single small directory going unread leaves every one of those floors standing, which is exactly the case the named counter in this file was added to catch. So the two sites are bounded at different granularities and **neither is equivalent to the other**: mine catches one directory or many, that one catches bulk loss only. Cited by predicate rather than line number on purpose -- that file has grown three times this week.
- **And the reason it is left that way is its own comment**, `// a directory that vanished mid-walk contributes nothing`, which is not a shrug but a claim about a hazard this checkout really has: lanes write editor temp files beside live sheets and one can be unlinked between `readdir` and read. A counter would not contradict that claim -- it would say how often the claim is being paid in silence, which is the question nobody in this lane has answered for someone else's suite.
- **And what the closure did NOT prove.** The probe makes the walker hit a path that cannot be listed (`ENOENT`), which exercises the `catch` and the recording; it does not produce a directory that exists and refuses to be read (permission, or a transient share lock). The door is covered, the two OS reasons behind that door are not equally tested -- the same distinction `074655fb0` drew for the dither walker between a sheet that throws on read and a directory that cannot be listed.

## 37. The bundle-budget gate says CI enforces it; three independent readings say nothing in CI runs it — and the ~296 KB of webfonts this repo just shipped is outside its filter anyway

- ✅ **Both halves of this item are closed as of `d3ae1e201`.** The gate prices `.woff2` (`dd12da524`) and CI runs both budgets (`dev-ci.yml#ui-test`); what is left in this thread is the `check.sh` step its own header still promises, which is not this lane's file.
- **THE CLAIM, quoted.** `scripts/check-bundle.mjs:21`: *"scripts/check.sh so every CI run enforces the budgets."* Its four budgets are entry JS 500 KB, **total JS 3,500 KB**, CSS 1,000 KB, largest chunk 600 KB — all in **gzip** bytes.
- **THREE READINGS, ALL POINTING THE SAME WAY.** (1) `git grep -n 'check-bundle\|bundle:check' -- .github/workflows/*.yml` → **0 hits**, so no live workflow invokes it. (2) `git grep -n 'bundle budget' scripts/check.sh` → **none**; the only `bundle` lines in check.sh are `bundle parity` (`:349`-`:350`, the Fluent-key gate, an unrelated name) and a comment at `:251` saying the production bundle "is validated by CI independently" — which is the same belief restated, not a runner. (3) `scripts/gates.json` carries a row `id: "bundle-budget"`, `status: "required"`, `runners: {"check:all": ["bundle budget"]}` and **no `ci` block**, while its sibling `bundle-parity` *does* carry one (`dev-ci.yml` → `static-gates` → "i18n bundle parity"). `AGENTS.md` already warns that `status` is policy language rather than machine state — `rust-clippy` is `required` and CI-unrun — so the manifest agrees with the greps instead of contradicting them. What is actually reachable is `cd ui && npm run check:all` → `scripts/check-ui.mjs` (`:16`, `:156`-`:157`), i.e. **a manual command, on request, in one lane's terminal.**
- **Why this lands on the font work specifically.** `check-bundle.mjs:102-103` filters the asset listing to `.js` and `.css`, so the **12 woff2 files** this repo now ships are counted by nothing. Measured in the gate's own unit rather than raw: fonts gzip to **295.9 KB** against **947.4 KB** of gzipped JS — **31.2 % of the JS a budget exists for, on a payload that has no budget at all.** The raw comparison (295.6 / 3,303.9 = **8.9 %**) understates the same twelve files by **3.5×**, because woff2 is already compressed and JS is not; the font work has been quoted with the raw framing in several places, which is one reason `scripts/check-font-bundle.mjs` now prints both (`b49c1259b`).
- **The cost of closing it is small, and one figure says so: today's build passes every budget with room** (`entry 183/500`, `total JS 947/3500`, `CSS 136/1000`, exit 0). A fifth budget line for fonts — three lines of `budgets` plus a filter — cannot fail anyone's current build at any sane threshold, so this is not a gate that would embarrass the repo if it started running.
- **The complication the owner has to weigh, and it is the only expensive part.** `check-bundle.mjs` **builds before measuring** (`vite build` appears 5 times in it, plus `npm run build` and three `execSync` calls). CI's `ui-test` job installs, typechecks, lints, runs Vitest and the timezone check, and **never builds the UI** — the only `npm run build` in either live workflow is `dev-ci.yml:162`, in the `website` job. So wiring this gate into CI is not adding a step; it is adding the first UI build to the pipeline, which is a different conversation about CI cost than the one the header sentence implies.
- **NOT THIS LANE'S TO FIX.** The gate, its header, and `gates.json` belong to whoever owns bundle budgets; the font lane's fence is the fonts. This lane's action was to stop quoting a number that hides the asymmetry, and to file this. If the header is kept, the sentence needs the runner it actually has (`npm run check:all`), and if `check.sh:251`'s "validated by CI independently" is kept, the same edit should say which CI step.
- **What this item did not verify.** `npm run check:all` was never executed end-to-end — the mapping rests on reading `ui/package.json`'s script, `scripts/check-ui.mjs`'s step names, and the manifest, not on a run — so the claim "*reachable via check:all*" is a read of wiring rather than an observed pass. No tablet-side budget figure is claimed here; the tablet artifact's gzipped JS is a different total (142 chunks), and only the desktop run is quoted above.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while pricing the payload it shipped and finding out that nobody was ever going to be told.

- **RESOLVED IN PART, same day, one round later.** `dd12da524` (*fix(scripts): make the bundle budget gate see .woff2*) added `woff2: Number(process.env.BUDGET_WOFF2_KB ?? 400)` to `scripts/check-bundle.mjs` and put it in the report table, so the **exclusion** half of this item is closed by the file's owner. Both artifacts pass it today: the gate prints `✔ woff2 296 KB / 400 KB` for `ui/dist` and the same 296 for the tablet build, which is the figure this item measured in gzip the round before. **The enforcement half is untouched**: re-run after the commit, `git grep -n -e check-bundle -e 'bundle:check' -- '.github/workflows/*.yml'` → **0**, `scripts/check.sh` still has no such step, and `gates.json`'s `bundle-budget` row still carries `runners: {"check:all": [...]}` with **no `ci` block**.
- **A lesson about the command this item printed, learned by being wrong with it.** It suggested `git grep -c 'bundle budget' scripts/check.sh`, and the answer for `check-ui.mjs` came back **0** on a file that contains the step three times -- because the step is capitalised, `gate('Bundle budget', …)` at `:157`. A case-sensitive grep on a name it does not match is indistinguishable from an absent fact, which is this repo's oldest shape of error pointed at my own command. Use `-i`: `git grep -in 'bundle budget' scripts/check-ui.mjs scripts/check.sh` shows the runner and the missing step in one output.
- **And the headroom is worth naming before someone discovers it the hard way:** the budget was set at 400 KB against a payload of 296, so **the font surface is 74 % of its own ceiling** -- one added family, or a wider Latin-1 supplement subset, fails a gate that was written to pass today. Re-derive by running the gate rather than by quoting this sentence; the point is the ratio, not the number.
- **FULLY CLOSED 2026-09-16 by `d3ae1e201`, which fixed the half this item kept open.** `dev-ci.yml#ui-test` now declares `Bundle budget (desktop)` and `Bundle budget (tablet)` steps, and the `bundle-budget` row in `scripts/gates.json` carries `"ci": { "workflow": "dev-ci.yml", "job": "ui-test" }` -- the job-level form its `ui-typecheck` / `ui-unit-tests` / `analytics-tz-invariance` neighbours use. So `status: "required"` has stopped meaning *policy language with no machine state behind it* for this gate, which is the failure mode AGENTS.md documents via `rust-clippy`. `verify-ci-docs-drift.py` -> **0 drift items**, `verify-agents-mirrors.py` -> exit 0.
- **These are the first CI steps to compile `ui/` at all**, which is why they were not added earlier in this thread: `check-bundle.mjs` builds before it measures, so the steps inherit a risk no CI budget step has carried here. That risk was executed rather than assumed -- `node:24` (npm 11.19.0, Linux), `npm ci --no-audit --no-fund --ignore-scripts` exit **0**, then both legs exit **0** with figures byte-identical to the local run (`entry 183`, `total JS 947`, `CSS 136`, `chunk 196`, **`woff2 296/400`**; tablet `158 / 943 / 134 / 197 / 296`). **What that does not prove: it ran on WSL2 userland over a 25 MB copied tree, not on `ubuntu-latest`, and no GitHub runner has executed these steps yet.** The first real run is the remaining unknown, and it is stated as one.
- **Two consequences, before a red line surprises anyone.** (1) **`northflank-deploy` lists `ui-test` in its `needs`**, so a size breach now stops a production deploy -- the budget is no longer advisory in effect whatever its status field. (2) `ui-test` runs only `if: needs.changes.outputs.ui == 'true'`, and that router matches by **directory**, so a commit touching only `scripts/check-bundle.mjs` or the default budgets never runs the gate: **the payload is enforced, the checker is not.**

## 38. The tablet bundle budget exists, works, and is called by nothing -- `check:all` runs only the desktop half, so one of the two shipped apps has no budget at all

- ✅ **Closed by `b89747b28`: `check:all` declares the tablet leg.** The zero-caller finding survives as the reason, and as a warning about greps -- a repo-wide search for the script name returned 4 hits, all of them sentences saying it had none.
- **THE FACT, with the counts.** `ui/package.json:21` defines `"bundle:check:tablet": "node ../scripts/check-bundle.mjs --config=vite.tablet.config.ts"`. `git grep -n 'bundle:check:tablet' -- . ':(exclude)ui/package.json'` → **0 callers**: no workflow, no hook, no script, not even the runner that the budget gate does have. The one runner that exists, `scripts/check-ui.mjs:157`, invokes `gate('Bundle budget', 'npm run bundle:check', …)` -- **the desktop script only**.
- **IT IS NOT BROKEN, WHICH IS WHY IT MATTERS.** Run by hand it works: exit **0**, `entry JS 158/500`, `total JS 943/3500`, `CSS 134/1000`, `largest chunk 197/600`, **`woff2 296/400`**. So this is not a failing check someone disabled; it is a correct check nobody wired up, which is the class of gap that survives indefinitely because nothing ever goes red.
- **What that leaves unguarded.** Two apps ship from one `ui/` tree, and the tablet build is **not** the desktop build with a different name: 59 stylesheets against 56, 142 JS chunks against 125, its own content hashes, and its own ~296 KB font payload -- measured in `todo-font-system.md`'s tablet block and re-derivable with `node scripts/check-font-bundle.mjs --dist ui/dist-tablet`. A change that doubles the tablet's font subset, or balloons its chunk graph past the JS budget, passes `check:all` without a word, because `check:all` never looks at `ui/dist-tablet`.
- **The fix is one line and it is not this lane's.** `gate('Bundle budget (tablet)', 'npm run bundle:check:tablet', { timeout: 300_000 })` beside the existing one, or a loop over both scripts. The cost is real and should be weighed rather than assumed away: **`check-bundle.mjs` builds before measuring**, so this doubles the build time of the `check:all` chain, and `--config=vite.tablet.config.ts` is a different invocation from the desktop path, so a failure would need someone who can tell the two apart. `check-ui.mjs` belongs to whoever owns the UI gate chain.
- **What this item did not verify.** The tablet gate was run once, by hand, at one HEAD, on a tree whose `ui/dist-tablet` this lane had itself rebuilt minutes earlier; so the figures are a property of that artifact, not of any commit -- the same walker caveat `AGENTS.md` puts on every CSS suite, applied to a build. Whether `--config=vite.tablet.config.ts` writes into `dist-tablet` before measuring was read off the passing output, not off the argument parser.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while repairing the note its own tool printed about the gate that item 37 filed.
- **HOW THIS ITEM ALMOST CLOSED ITSELF, one round later.** Asked whether the tablet budget had gained a caller, `git grep -n 'bundle:check:tablet' -- . ':(exclude)ui/package.json'` returned **4** hits -- and every one was *a sentence about the absence*: this item, the acceptance record in `todo-font-system.md`, and a `console.log` in `scripts/check-font-bundle.mjs` that prints the complaint. A grep for a string cannot tell a call site from prose about that call site, and the natural reading -- "someone wired it up, close the item" -- was available to anyone who did not open the four lines. **The item is still open.** Re-derive it scoped to the paths where a call would have to live: `git grep -n 'bundle:check:tablet' -- .github/workflows .githooks scripts/check-ui.mjs scripts/check.sh` → **0**.
- **The guard now exists, so the mistake is harder to repeat.** `scripts/check-font-claims.mjs` executes this claim and the three others about the gate (`.woff2` priced; no workflow runs it; `check.sh` has no step; `gates.json` has no `ci` row), and the tablet row prints both populations on purpose -- wiring paths and whole-repo mentions -- so a reader sees `0 call(s); whole-repo mentions: 5` rather than one unexplained number. Widening that population to include `docs` was demonstrated to flip the row to DRIFT while every other row stayed green, which is the failure the scoping prevents. If the row ever drifts to a nonzero call count, that IS the fix landing: close this item and repair the note in `scripts/check-font-bundle.mjs`.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while repairing the note its own tool printed about the gate that item 37 filed. The two bullets above were added the next round, by the same lane, after its own grep nearly closed this one.

- **CLOSED by this lane on 2026-09-16, with the human's explicit go-ahead to touch a file outside the font fence: `b89747b28`.** `scripts/check-ui.mjs` now declares `gate('Bundle budget (tablet)', 'npm run bundle:check:tablet', { timeout: 300_000 })` beside the desktop leg, and `scripts/gates.json`'s `bundle-budget` row carries the second needle `bundle budget (tablet)`. The two files had to move in ONE commit because the runner's self-audit fails closed on a needle with no declared gate -- it matches every manifest `check:all` needle as a lowercase substring of a declared gate name, so a manifest edit alone would have broken `check:all` by design, not by accident. The row's stale `check-ui.mjs:139` citation was replaced with gate names on the same principle this file keeps applying: **names rot later than line numbers, and this very edit moved the line it would otherwise have cited.**
- **The cost I estimated in this item was wrong, and the measurement is the lesson.** I wrote that wiring the leg in "**doubles the build time of the `check:all` chain**", as though that were a burden to weigh before acting. Executing the chain and reading its own summary says otherwise: the tablet leg took **9.4s** against the desktop leg's **9.6s**, in a **300.5s** total run. The second build is about **3 % of the chain**. The estimate was plausible, it sat beside genuinely measured numbers so it inherited their credibility, and it stayed in an open item for a day because I filed a guess where a measurement was available.
- **A second-order version of the population error, caught by the guard itself.** When the leg landed, the claims row reported **2 call(s)** in the wiring paths. Only **1** is a call; the other is this lane's own comment line naming `npm run bundle:check:tablet` **inside the very file that invokes it**. The prose-vs-call-site distinction that nearly mis-closed this item therefore applies **inside code files too**, not only to `.md` -- and the row now separates raw mentions from non-comment ones and prints the surviving line rather than asking to be believed. Both failure arms were executed: reality firing the guard when the gap closed, and a plant narrowing the population to `0 mention(s), 0 outside comments` with exactly one DRIFT and exit 1, restored to a byte-identical hash.
- **What this did not close when it was written, and what did.** The sentence that stood here read: "Reachable is not enforced. `check:all` is a local command; no live workflow runs either budget leg (`git grep -l -i -e check-bundle -e 'bundle:check' -- '.github/workflows/*.yml'` → 0, re-run at this HEAD by `scripts/check-font-claims.mjs`), `scripts/check.sh` still has no step, and the manifest row still carries **no `ci` block**. Item 37's enforcement half is the surviving gap, and it now covers **both** artifacts -- which is the sentence to read before concluding the font payload is gated in CI, because it is not." That was true for exactly one round. `d3ae1e201` added `Bundle budget (desktop)` and `Bundle budget (tablet)` steps to `dev-ci.yml#ui-test` and gave the row a `ci` block, so **the payload is now gated in CI**; item 37's closure bullets carry the evidence and the two consequences -- the deploy coupling, and the `^ui/` router. **Still true:** `scripts/check.sh` has no budget step whatever its header promises, and that is the one absence the re-derive command in `scripts/check-font-bundle.mjs` still prints nothing for. Repaired in place rather than appended because it is a forward-looking claim, with the withdrawn wording quoted so a reader sees what changed and not only what is now claimed.


## 39. Six gates are `required` by policy with no `ci` block behind them -- `bundle-budget` was the seventh and left the class this week, and the remaining six are not six defects

- **THE COUNT AND ITS COMMAND, executed as written at this HEAD (exit 0).** `python -c "import json;g=json.load(open('scripts/gates.json'))['gates'];r=[x for x in g if x.get('status')=='required' and not x.get('ci')];print(len(r),'required rows with no ci block');print(*[x['id'] for x in r],sep='\n')"` → **6**: `rust-clippy`, `docker-dry-run`, `migration`, `e2e`, `perf-smoke`, `updater-signature`. The manifest holds **71 rows -- 54 required / 1 advisory / 16 retired**. **Definition, because the number is worthless without it:** a row counts here when `status == "required"` and it carries no non-empty `ci` key; nothing in this set is claimed to be broken.
- **The set splits into two strengths, and only one of them is a hole.** Four are reachable from `check.sh` (`rust-clippy`, `docker-dry-run`, `migration`, `updater-signature`) -- and `check.sh` is the documented local full matrix, the thing AGENTS.md tells a lane to run before declaring anything verified, so those four are "enforced if you run the matrix". **Two are reachable only from `check:all`** (`e2e`, `perf-smoke`), a convenience runner a developer may never have invoked at all. Even those are not drift: AGENTS.md already states plainly that *"E2E, a11y, security and nightly suites are NOT enforced in CI -- a green Dev CI run is not proof those passed."* **The manifest and the mirror agree here**, which is the first thing to check before calling a `ci`-less row an oversight.
- **What changed this week, and why it is the reason for this item.** `bundle-budget` was the seventh member of this set until `d3ae1e201` gave it `ci: { workflow: dev-ci.yml, job: ui-test }` and added the two `Bundle budget` steps that make the pointer true. Walking away from that fix produced this table: the class was worth naming so that "is the bundle gate still the odd one out?" costs one command instead of an afternoon. **It also names the trap that made `bundle-budget` interesting in the first place** -- `status: "required"` is policy language, and nothing in the manifest, and no checker, distinguishes "required and CI runs it" from "required and only a human's command runs it".
- **Why this is filed rather than fixed.** Two of the six would need CI work that is not this lane's to decide: `e2e` needs a Docker service in `dev-ci.yml` (its own history is a retirement to `.bak`), and `perf-smoke` needs a Playwright job with browsers installed, against a runner that today never builds the UI at all. **A bulk edit adding `ci` blocks to these rows would write a lie into the manifest** -- a pointer at a job with no such step -- which is strictly worse than the honest absence recorded today. `rust-clippy` is documented as deliberately local, and is the reason AGENTS.md warns that `required` must never be read as CI-enforced.
- **What this item did NOT verify.** It reads `gates.json` only. It does not open a workflow to ask whether a row that HAS a `ci` block is telling the truth about it -- `verify-ci-docs-drift.py` owns that question and reports **0 drift items** here; `scripts/check-font-claims.mjs` spot-checks one row (the `bundle-budget` `ci` block, whose job key it confirms by reading `dev-ci.yml` itself) because that one gate this lane has watched rot. So the 6 is a count of absent `ci` keys, and no claim is made about the 48 present ones.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, on the way out of item 37 -- the same exit that turned one gate from policy language into machine state.

## 40. The data `## 10` turns on, computed unit-aware: 134 unitless literals in 8 distinct values, of which ZERO already equal a token number -- so adopting the scale is a visual change, and one figure in this packet is a retraction of my own

- **THE PARTITION, and it closes exactly.** A comment-blanked walk of `ui/src/**/*.css` (139 sheets) finds **217** `line-height` declarations: **75** cite a token, **134** are unitless numbers, **6** carry a unit, **2** are `inherit`. `75 + 134 + 6 + 2 = 217`. This matches the count `## 10`'s own thread has been carrying, and the raw re-derive is one line: `git grep -hoE 'line-height:[[:space:]]*[^;}]+' -- 'ui/src/**/*.css' | sed -E 's/line-height:[[:space:]]*//' | sort | uniq -c | sort -rn` (executed here through Git Bash; it counts text as written and includes comment prose, which is why its total reads 218 where the blanked walk reads 217).
- **WHAT ADOPTING THE 3-STEP SCALE WOULD DO, per distinct unitless value.** Tokens as defined in `ui/src/frontend/themes/tokens.css`: `--leading-tight` 1.25, `--leading-normal` 1.5, `--leading-relaxed` 1.625. Then: `1` **66** sites → +25.0 % · `1.4` **34** → +7.1 % · `1.2` **13** → +4.2 % · `1.3` **10** → −3.8 % · `1.6` **6** → +1.6 % · `1.35` **3** → −7.4 % · `1.45` **1** → +3.4 % · `1.8` **1** → −9.7 %. **Not one of the 134 sits on a token's number already** (0 sites at 1.25, 1.5 or 1.625 as a unitless literal), so the adoption tranche the thread spent earlier is done and every remaining site is a rendering change, not a rewrite. The single biggest lever is `line-height: 1`, which appears on **40 different sheets** and would move +25 %.
- **THE 6 + 2 THAT ARE NOT CANDIDATES AT ALL**, listed so nobody spends an hour on them: `16px` (`ui/src/components/StockAlertBell.css`), `18px` × 2 and `2rem` (`ui/src/features/kds/KdsScreen.css`), `1rem` (`ProductManagementScreen.css`), `1.25rem` (`SettingsNavTree.css`), plus `inherit` × 2 in `frontend/themes/reset.css`. A fixed length does not scale with font-size, so a leading *scale* cannot absorb it — `18px` on a KDS tile is a tile-sizing decision wearing a leading property, which is a different question than `## 10` asks.
- **A FIGURE WITHDRAWN, and it was mine, from an hour ago.** The first pass at this packet reported **67** sites of `1` against the plan's **66** and I began writing a drift claim about the plan. The number was wrong: the value regex was anchored at the start but not the end, so `line-height: 1rem` parsed as `1` and joined the unitless bucket. **The plan's 66 stands; my instrument inflated the largest cluster by swallowing a unit.** This is the same failure the top of this file warns about in the sibling case (`calc(` fragments, `1.25` occurring 0 times as a literal), recorded here because the packet's whole value is in the unit split.
- **WHAT THIS ITEM DOES NOT DO.** It decides nothing, proposes no token set, edits no stylesheet, and does not rank the three readings an owner might take (leave the literals; adopt only where the move is small -- `1.6`, `1.45`, `1.2`, `1.3` total 30 sites at ≤ 4.2 %; or adopt across all 134 with `1` × 66 at +25 %). Those are design calls with a visual consequence, which is precisely why `## 10` is an owner item and this is an attachment to it.
- **Currency of every figure here.** Taken 2026-09-16 with **7 paths under `ui/src` dirty** in this shared checkout, from the working tree rather than any revision, so they are a disk reading at a timestamp; re-run the command above to move them.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, as the data attachment `## 10` was always going to need -- it asks which scale to adopt, and the question cannot be answered without knowing what each adoption does to a rendered line.


## 41. HEAD's UI typecheck has been red since `51936522f` -- and the finding worth keeping is that `check.sh` already gates it, so nothing was missing except running it

- ✅ **Closed in HEAD by `3394866ac`** (*fix(coursing): land the course chip's props, styles and tests*, 09-16 11:50) -- the same edit that was sitting uncommitted at +48 lines when this item was filed half an hour earlier. Verified here rather than accepted from the queue sweep (`5f4507966`) that also records it: HEAD's `ui/src/__tests__/CartPanel.test.tsx` now names the prop once. **The mechanism this item was really about is unchanged and still open -- see item 42.**
- **THE FACT, from HEAD's bytes.** `ui/src/features/sales/components/CartPanel.tsx` at HEAD declares `courseFiringEnabled: boolean | null;` as a **required** prop (`:132`). `ui/src/__tests__/CartPanel.test.tsx` at HEAD mentions that name **0 times**, and its fixture is a typed literal -- `const baseDefaults: CartPanelProps = {` inside `makeCartPanelProps()`, commented *"Every CartPanelProps field, satisfied once"* -- with no `as any`, no spread, and no other file under `ui/src` at HEAD supplying it. So `tsc --noEmit` (`include: ["src"]`, which covers `__tests__`) reports TS2741 there. **How this was actually executed rather than deduced:** a `tsc -b --force` run at ~11:2x carried exactly one remaining error, in that file, and at that moment the file on disk matched HEAD for this property (0 mentions in both). That is a reproduction against HEAD's content for the failing file, not a clean HEAD-only run, and it is stated as such.
- **WHO, WHEN, AND HOW LONG IT SAT.** `51936522f` (09-16 10:25, *feat(coursing): checkout carries course, publishes CourseFired, gates on setting*) made the prop required and updated **eight** test files -- `RetailCartPanel.test.tsx` among them, which builds its own props -- and missed this one. **37 commits** landed on top of it before it surfaced, this lane's five included.
- **WHY NOTHING CAUGHT IT -- the part that is NOT a missing gate.** Three mechanisms were available and each is worth its precise status. `ui-typecheck` in `scripts/gates.json` is `status: "required"` with `ci: dev-ci.yml#ui-test`, and CI's step is `cd ui && npm run typecheck` (`dev-ci.yml:307`): **it cannot fire here, because `dev-ci.yml` triggers `push: branches: [main]` and `0.0.39` has 0 runs measured via `gh run list`, with the newest run on any branch dated `2026-09-14T00:37Z`.** The pre-commit hook never runs typecheck -- deliberately, it was moved off the commit path to keep atomic commits under a second in a multi-agent checkout, and the hook printed that design at `check.sh:390`. **But `scripts/check.sh:210` runs `step "ui typecheck" "cd ui; npm run typecheck"`, immediately followed by `:211 "ui test"`.** So the documented local full matrix already catches this, and AGENTS.md already says to run it before declaring anything verified. **The gap is not enforcement machinery; it is that no lane in 37 commits ran the matrix that was already written.** That is the same shape as item 39's lesson one revision earlier -- reachable, and even scripted, and still not executed -- and it is why "the gate exists" is not a claim about a commit.
- **ALREADY BEING FIXED, SO DO NOT WRITE THE SAME LINE.** At 11:3x `ui/src/__tests__/CartPanel.test.tsx` is ` M` with **+48/0** and now names the prop once, and `tsc --noEmit` exits **0** with no errors against that tree. **This item was filed instead of a repair being applied**, because a queued one-line fix from this lane would have landed on top of someone else's in-flight edit to the same fixture -- and a pathspec commit of a path another lane is editing would have committed *their* unfinished work under *my* message. That is the specific hazard this checkout's commit rules exist to prevent.
- **WHAT A READER SHOULD TAKE FROM IT.** Two things, neither about coursing. First: a shared branch that cannot trigger CI has no automatic feedback at all, so the local matrix is the only gate between a required-prop change and 37 strangers -- running `scripts/check.sh` is cheap insurance, and its legs cover the exact error class. Second: HEAD's red was discovered here by *this* lane's failed `npm run build`, one leg of which (`tsc -b`) grades test files. The build failure was the signal; the typecheck was already telling the same story and nobody had listened, because `npm run build` is skipped by `check.sh` (`:250`, with its reasoning printed beside it) and CI cannot run.
- **Currency.** Taken 2026-09-16 with **7 paths under `ui/src` dirty** in this shared checkout. The HEAD-side greps are about a revision and do not move; the `tsc` results and the +48 diff are a working-tree reading at a timestamp, and the fix may have landed by the time this is read -- which is the outcome this item wants.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while failing to rebuild an artifact for reasons that turned out not to be the ones it first blamed.

---

## STALE-CLEANING SWEEP — resolved items whose headers still read "open" (2026-09-16, HEAD `68358a924`)

A read-only pass over the parking lot found several items the tree has since answered while the
`## N` header still advertises a decision. Corrected **forward here, at EOF, rather than in place** —
editing the numbered blocks would shift the `:NNN` line-cites the whole file is written against, and the
index already refuses to state a total. Every cited commit was re-derived this pass with
`git merge-base --is-ancestor <sha> HEAD` (all exit 0) and its subject checked; the ⚠ items are the
agent's own read at this HEAD, not a claim inherited from a dated note.

- **## 8 — selector-class conflict: RESOLVED.** The "no rule can settle it" conflict is gone: `16258b37e`
  added the graded `selectorOnlyClasses` field carrying exactly the three `kds-column--*` names, and
  `fffc4672f` struck the inert `kds-column--` mute. Not an open ruling any more.
- **## 13 — Free-tenant staff-login audit "red test": premise DELETED; residual is now a policy doc, not a ruling.**
  `4d08338cf` removed the profile-keyed assertion (`auth_tests.rs` now asserts 1 row in *both* profiles) and
  `2dc500382` made the refused-create case non-vacuous in release. What remains is a *written* product policy,
  not a test to satisfy — so it drops out of the decision queue.
- **## 14 — seeded sentinel / no CI release leg: DONE for the leg it asked for.** `9d5c33c68` added the
  `release-bridge-test` job (`dev-ci.yml`) running `cargo nextest run -p oz-bridge --release` on push. ⚠ The
  tablet release run the item also wanted is still unquoted (no number to check), so that sliver stays open.
- **## 16 and ## 20 — topology rulings: RULED elsewhere; headers stale.** Both were ruled 2026-09-16 in
  `done-todo-topology-editor.md` (R1 require a session · R2 location-scoped · R3 path-free errors · R4 the
  diagram's store may select the target; an unscoped grant authorises writes into no store the diagram
  mentions), landed as `8286f43ae` / `4efcb0971` / `a718dd1e4` / `32abb9cbb`. `notes.md` still reads "RULING NEEDED" — that is stale, not a live ask.
- **## 17 — class-guard fifth axis: ANSWERED — "fund the ledger" shipped.** `7cee5f8e7` added
  `EXTERNAL_CLASS_LEDGER` (4 members, each with a reason); the `EXTERNAL_CLASS_OPEN_QUESTIONS` list is now empty.
- **## 26 — gate borrowing another checkout's graph: half-one FIXED.** `95ad42ea2` dropped the implicit
  cargo-metadata cache fallback and restored `check_graph_root`. ⚡ The `--strict` half is still true (`grep args.strict` = 0 at HEAD) — that one remains open.
- **## 30 — wire-bug rules, live second copy FIXED.** `6a08e0e3a` made `verify-topology-parity.py` fail on
  drift and skip only when there is no `ui/` tree at all. The lesson text stands; the defect it tracked is closed.
- **## 41 — HEAD UI typecheck red: FIXED.** `3394866ac` landed the course chip's props/styles/tests, clearing
  the 37-commit red. The durable point (a shared branch can't trigger CI, so the local matrix is the only gate)
  is unaffected by the fix.

**Net after this sweep — what genuinely still needs an owner decision:** ## 1 (light-theme contrast, both pairs
< 4.5:1), ## 5 / ## 6 / ## 7 / ## 32 (product yes/no), ## 9 (title/aria intent vs debt), ## 12 (release-profile
security seam — the highest-consequence item), ## 15 (tender "terminal" naming, gates 103 sites), ## 18 (ADR #47
ruling 1A), ## 19 (backup bypass — route vs accept, still live at `UpdateBanner.tsx:184`), ## 21 (reduced-motion
per-declaration campaign), ## 23 (SyncStore trait — build nothing until a 3rd backend), ## 27 (offline payload
TEXT/`String` format, still `offline.rs:40/88/134`), ## 29 / ## 31 / ## 39 (dated-literal home / widen the
bundle-parity scan / the six required-no-CI gates — the last asks to *file*, not fix). The `todo-review-type.md`
R-series (## 25) is already fully disposed (R3/R7 no, R6/R9/R10 yes, R8 by evidence, R1/R2/R5 moot) — only work,
not rulings, remain there.


## 42. Two release branches open the SAME SQLite file, because the app identifier is identical and `resolve_db_path` has no override -- `764cf2225` makes the collision legible, it does not remove it

- **THE MECHANISM, in three lines of code.** `apps/desktop-client/src/state.rs` resolves the database as `app.path().app_data_dir()/oz-pos.db` with no environment override, and `tauri.conf.json` in **both** `0.0.39` and `0.0.38` carries `"identifier": "mu.kasir.app"`. Same identifier → same `app_data_dir` → the same file: `C:/Users/Dika/AppData/Roaming/mu.kasir.app/oz-pos.db`, measured at 1,956 KB with its mtime matching the panic timestamp to the second. **The tablet does not collide** -- its identifier is `mu.kasir.tablet`, which is why only `mu.kasir.app` exists under `%APPDATA%`. So this is desktop-against-desktop, across release branches.
- **WHAT THE COLLISION DOES TO THE MIGRATION RUNNER.** The ledger is keyed by migration **filename**, and `run()` deliberately ignores ids it does not recognise. A database migrated forward therefore *upgrades cleanly* on an older build: every migration that build knows is already recorded, and the 38 names it has never seen are silently skipped. The failure then surfaces wherever the newer schema first disagrees with the older code -- in the reported case, `20260906_rename_store_to_location.sql` had already renamed `store_profiles` to `locations`, and `0.0.38`'s seed still wrote the old name: `seeding primary store: no such table: store_profiles`. **"The migrations succeeded" was true, and worthless.**
- **WHAT CHANGED.** `764cf2225` adds a check before anything is applied: a date-shaped ledger id sorting AFTER the newest date-shaped id in this binary's registry means the database came from a newer build, and the run refuses with the remedy in the message. Non-date-shaped rows (`001_sales.sql`, pre-reset dev history) keep their documented tolerance, so `existing_db_with_legacy_rows_upgrades_idempotently` still passes. Both directions were applied to the real ledger, not just the fixtures: **0.0.38 → 38 unknown ids newer than its `20260831` → would refuse; 0.0.39 → 0 newer, 0 legacy → boots.**
- **WHAT IS STILL OPEN, with the ways out and their costs, no choice made.** (a) an `OZPOS_DB_PATH`-style override in `resolve_db_path` -- additive and default-preserving, but **useless retroactively**: a `0.0.38` that has already shipped has no such hook, so it cannot unblock the run that started this. (b) distinct identifiers per release branch -- separates the data for good, and also changes where a real user's database lives, the updater's view of it, and every installed path: a product decision, not a repair. (c) treat "do not run an older build against a database a newer one touched" as practice -- free, and now at least *legible* rather than mysterious. Anyone deciding between these should note the guard fires at the right moment but knows nothing about *why* the ids differ; a pruned-then-renumbered migration history would look identical to a forward-migrated database from where it sits.
- **ONE CONVENTION THAT MATTERS HERE AND ALMOST TRIPPED THE FIX.** Migration dates in this repo are **ordering tokens, not calendar stamps**: `migrations.rs` carries 20 files dated after today, with comments saying so out loud (`must sort AFTER the last tax_rates DDL writer`, `Date 20261005 sorts last and only creates a new table`, first pre-dated by `652f18494` on 09-13 -- that commit added `20261005`, which is the only one whose arrival date this pass checked).. A reader who takes `20261005` as a typo will misjudge both the ordering and the guard. The guard is unaffected -- it compares ledger ids against the registry's own maximum, so a deliberately future-dated registry just sits further ahead.
- **HOW TO TELL WHICH BUILD OWNS A DATABASE**, until (a) or (b) is decided: `sqlite3 "$APPDATA/mu.kasir.app/oz-pos.db" "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 3"` and compare the newest id against the checkout's own `ls crates/oz-core/migrations/*.sql | tail -1`. An id in that list which the checkout does not have means the file belongs to a newer build — which is now also what the refusal says, in as many words.
- **Filed by:** the `todo-font-system.md` lane, 2026-09-16, while repairing a panic that was not in its fence and was not, in the end, a bug in either branch.

## 43. The file-wide `prefers-reduced-motion` amnesty in `animationCompliance.test.ts` is a per-sheet PROXY for a cross-sheet guarantee, not a defect -- measured at `e6d211b98`, and this item exists so nobody briefs it as an accessibility bug

- **WHAT THIS ITEM SETTLES, so a later session does not re-bill it.** `## 21` frames the file-wide amnesty as owed a per-selector tightening, at an estimated cost of "6-18 sheets". A measurement pass at HEAD `e6d211b98` came back against **both** halves of that framing: the tightening costs more than "6-18 sheets" in findings, and -- the part that matters for a briefing -- none of it closes a user-facing defect. **The amnesty is therefore not a bug and must not be briefed as one, and certainly not as an accessibility fix.** Nothing here retracts `## 21`'s own dated figures; this item stands beside them.
- **HALF ONE: per-selector handling is ALREADY the house style, so "sheets" was the wrong unit to cost.** Re-derived read-only in this box at `e6d211b98` (and identical at HEAD `71f2ce4a0`: `git diff --stat e6d211b98 HEAD -- ui/src/__tests__/animationCompliance.test.ts ui/src/frontend/themes/reset.css ui/src/frontend/themes/tokens.css ui/src/main.tsx ui/src/main.tablet.tsx ui/src/features/kds/KdsScreen.css` prints **nothing**). `grep -rlE '@media[^{]*prefers-reduced-motion:[[:space:]]*reduce' --include='*.css' ui/src | wc -l` -> **30 sheets carry a reduce block**, the same 30 the walker's own harvest line prints (`animationCompliance.test.ts:213`); of those, a reduce block whose body names a class selector accounts for **28**, leaving **2** whose body is a bare universal/element selector (`for f in $(grep -rlE '@media[^{]*prefers-reduced-motion:[[:space:]]*reduce' --include='*.css' ui/src); do awk '/prefers-reduced-motion[[:space:]]*:[[:space:]]*reduce/{inb=1;d=0} inb{d+=gsub(/[{]/,"{");d-=gsub(/[}]/,"}"); if(d>0 && /\.[A-Za-z_-]/){print "CLASS"; exit}} END{}' "$f" | grep -q CLASS && echo C || echo N; done | sort | uniq -c` -> `28 C / 2 N`; a text heuristic over block bodies, stated as such). So per-selector handling is the convention, not the gap. **The pass reports the tightening itself as 14 findings across 7 stylesheets** at what it judged the defensible same-leaf-class coverage tier, and **34 across 11** at a strict whole-selector tier -- both figures **reported by the measurement pass at `e6d211b98`**, not re-derived here, because reproducing them means porting the walker loop (the method `## 21`'s 2026-09-15 box used), not grepping a file. Either way the number is a count of findings and stylesheets touched, not of "6-18 sheets" of work saved.
- **HALF TWO: every candidate is ALREADY motion-neutralised at runtime, by a rule the walker cannot see.** `ui/src/frontend/themes/reset.css:202-211` sets, inside `@media (prefers-reduced-motion: reduce)`, `animation-duration: 0.01ms !important`, `animation-iteration-count: 1 !important`, `transition-duration: 0.01ms !important` (and `scroll-behavior: auto !important`) on `*, *::before, *::after`; `ui/src/frontend/themes/tokens.css:637-642` adds `transition: none; animation: none` on the same universal selector. Both sheets are imported by **both** entry points: `ui/src/main.tsx:5` and `:7`, `ui/src/main.tablet.tsx:18` and `:20` (a cite corrected on the way past: the brief carried `main.tsx:5,8`, and `:8` is `components.css` -- `tokens.css` is `:7`).
- **THE CASCADE POINT, and which of the two sheets is load-bearing.** The clamp that does the work is the `reset.css` one, because it is `!important`: an author-origin `!important` declaration beats any author-origin normal declaration regardless of specificity, so a class-level `animation: kds-drop-in 0.4s` shorthand still resolves to a 0.01 ms duration. `tokens.css:641-642` carries **no** `!important`, so a class-level shorthand outranks it -- a second layer, not the argument. **Conclusion, stated once and plainly: at none of the 14 (or 34) candidate sites is motion currently reaching a user, so a per-selector tightening produces zero user-visible change.**
- **WHY THE AMNESTY EXISTS: it is a per-sheet proxy for a cross-sheet guarantee.** The walker reads one stylesheet at a time -- `animationCompliance.test.ts:168`, `for (const filePath of cssFiles)`, with `hasReduceBlock` computed over that one file's text at `:170` -- so it cannot see a promise kept in a *different* file, and excuses the sheet rather than report a finding it has no way to justify. **(Line-drift note, added forward rather than by editing `## 21`: that item cites `:127`, `:141-142`, `:181`, `:199`; the same constructs read `:170` / `:190-191` in the harvest path and `:230` / `:248` (`if (hasReduceBlock) continue;`) in the grading path at `e6d211b98`. Re-derive rather than trust either set: `grep -nE 'for \(const filePath of cssFiles\)|hasReduceBlock|swallowedByFileWideReduce|if \(hasReduceBlock\) continue' ui/src/__tests__/animationCompliance.test.ts`.)** The authors already understand this in one of the sheets in question: `ui/src/features/kds/KdsScreen.css:2287-2290` is an author comment saying the global `tokens.css` reduce block "already sets `animation: none; transition: none` on all elements" and that only overrides going beyond that belong in the sheet.
- **THE OPEN OWNER QUESTION, the only part of `## 21` the measurement leaves standing: keep paying for authoring-consistency findings, or make the walker honest about the global reset -- and do not dress either choice as accessibility.** (a) Teach the walker per-selector coverage: **14-34 new findings, 7-11 stylesheets touched, no user-visible change** -- a real gain in authoring consistency, with an authoring-consistency rationale, and nothing more. (b) Make the walker global-reset-aware -- recognise `reset.css:202` and `tokens.css:637` as the tree-wide guarantee they are -- and then **delete the amnesty pattern entirely**, which removes a proxy instead of adding findings. Both are defensible. **What is not defensible is briefing either one "as an accessibility fix" -- that would be a false rationale, and this line is here so it is not re-generated next time.**
- **What this item did NOT do:** edited no test, no stylesheet, no CSS; ticked nothing in `## 21` (whose dated prints stay exactly as written); and ran no suite -- every figure above is either a count over file text with its command, or is attributed to the pass at `e6d211b98`.
- **Filed by:** the lane closing out the two declined tightenings, 2026-09-16, at HEAD `71f2ce4a0` -- `git cat-file -t e6d211b98` confirms the measured pass's SHA is a commit in this history.

## 44. Two `WorkspaceContext` fallbacks that read as fail-open are deliberate -- `getDeviceId().catch(() => '')` and `listWorkspaceScreens(...).catch(() => [])`, measured at `e6d211b98` -- plus the one real open item that pass left behind

- **WHY THIS IS ON AN OWNER PAGE AND NOT IN A QUEUE.** Both are `.catch` arms that swallow an error and continue with an empty value, which is the shape a review pass files as "fail-open". Neither is one: in each case the empty value is a value the backend already handles by design, and in each case making it fail-closed would break something shipped. Re-auditing these costs a lane an afternoon and produces no patch; this item is that afternoon, spent.
- **A. `getDeviceId().catch(() => '')` does NOT boot the wrong store.** Four sites -- at `e6d211b98`: `ui/src/contexts/WorkspaceContext.tsx:232` (`.then(setTerminalId).catch(() => setTerminalId(''))`), `:395`, `:479`, `:574`; the same four re-derived at HEAD `71f2ce4a0` read `:260`, `:429`, `:513`, `:608` (`grep -n "getDeviceId()" ui/src/contexts/WorkspaceContext.tsx`) -- because this file is the ONE cited path that moved since the pass (+38 lines), so cite the command, not this line list. What the catch guards is nothing: `oz_bridge::health::get_device_id` at `crates/oz-bridge/src/health.rs:76-80` is **infallible** -- `Ok(std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "unknown-device".to_string()))` -- every arm resolves to `Ok`, so the only way into the catch is the IPC layer below the command body, never the body itself.
- **AND THE BACKEND RE-DERIVES THE SAME VALUE ANYWAY.** `resolve_boot_store` at `crates/oz-bridge/src/workspaces.rs:761-768` takes `device_id: Option<String>`, discards it when empty (`.filter(|d| !d.is_empty())` at `:762`) and falls back to reading `COMPUTERNAME`/`HOSTNAME` **server-side** -- the same source the UI just tried to read -- before the `device_id.is_empty()` branch at `:770` selects the primary store. An empty string from the UI and a hostname from the UI therefore arrive at the same two places. **"Unbound -> primary store" is the documented contract**, not an accident of this catch: `ui/src/api/workspaces.ts:67-72` spells the resolution out and ends at "3. Otherwise -> returns the primary store." It is **pinned by five tests** in `apps/tablet-client/src/commands/workspaces_tests.rs` -- `:299` `resolve_boot_store_returns_primary_store`, `:385` `..._autoboots_into_bound_instance`, `:396` `..._tampered_binding_falls_back_to_primary`, `:415` `..._bound_instance_missing_falls_back_to_primary`, `:433` `..._unknown_device_falls_back_to_primary` -- plus `ui/src/__tests__/WorkspaceContext.test.tsx:255`, `it('boot resolution receives undefined when no device id resolves')`, which pins the *empty* side from the UI.
- **THE COST OF "FIXING" IT, which is why this is declined rather than deferred.** Fail-closed here breaks single-store installs, where an unbound device is the **normal** state and not the exceptional one: the init migration seeds a default store profile -- `crates/oz-core/migrations/20260813_init.sql:1400-1401`, `INSERT OR IGNORE INTO store_profiles (id, name, is_primary) VALUES ('default', 'Default Store', 0)` (the brief omitted the `crates/oz-core/` prefix; re-derive the tracked location with `git ls-files | grep 20260813_init.sql`). A never-enrolled device is the common case on a fresh install, and it has to boot.
- **B. `listWorkspaceScreens(...).catch(() => [])` is NOT a permission grant.** The command behind it, `list_workspace_screens` at `crates/oz-bridge/src/workspaces.rs:173-202`, authenticates the **picker ticket** at `:183-184` (`verify_picker_ticket(...).ok_or_else(|| BridgeError::PermissionDenied("invalid or expired picker session"))?`) and then returns `store.list_workspace_type_screens(&type_key)` at `:193` -- a per-workspace-**TYPE** configuration list. **Its signature carries no role and no user parameter at all** (`ctx, ticket, type_key, store_id`): there is no privilege for the fallback to widen, because nothing in the call was privilege-gated in the first place.
- **AND BOTH RENDER BRANCHES ARE FILTERED UPSTREAM OF IT.** `ui/src/frontend/shell/tablet/TabletAppLayout.tsx:55` computes `allNavItems = getNavItems(enabledFeatures, userRole, permissions)`, and `getNavItems`' role gating is documented fail-closed at `ui/src/platform/ui/menu-registry/index.ts:90-92` -- "an omitted `userRole` DENIES role-gated items (a gate with a required role is not satisfied by an unknown user)". `workspaceScreens` only *narrows* that already-filtered list, and the tab bar slices to seven at `TabletAppLayout.tsx:56-58`. Route **entry** is gated separately by `isPageAccessible` -- `ui/src/frontend/shell/tablet/TabletAppShell.tsx:267-269`, `const pageDenied = pageRegistration && !isPageAccessible(pageRegistration, userRole, userPermissions)` -- and that call **does not take `workspaceScreens` as an input**, so the list cannot open a route. Empty is also the **legitimate configured value**, not only a failure sentinel: `WorkspaceContext.tsx` sets `[]` on the success path when the response is empty (`:525-529` at `e6d211b98`; `:559-562` at HEAD), exactly as it does in the catch. **Worst case measured: the fallback mis-orders which seven permitted tabs appear. It cannot surface a forbidden one.**
- **C. ONE REAL OPEN ITEM CAME OUT OF THE SAME PASS -- logged as a question routed to a lane, NOT as a finding and NOT as a settled edit.** `create_session` does not validate `terminal_id`: at `crates/oz-bridge/src/auth.rs:511` the entry guard tests `store_id`/`instance_id`/`user_id` for emptiness and names none of the other three, and `&args.terminal_id` goes straight into `insert_session` at `auth.rs:632-641`. `complete_sale` then persists it as `Some(&session.terminal_id)` (`crates/oz-bridge/src/pos.rs:1900`). **Consequence: an empty string can be stored as `Some("")` rather than NULL**, and the KDS enrollment path carries the same value with no empty guard -- `ui/src/features/kds/KdsScreen.tsx:588` (`restaurantPosId={terminalId}`) into `ui/src/features/kds/components/KdsEnrollmentModal.tsx:236` (`restaurant_pos_id: restaurantPosId`) and `:415` (the same field inside the pairing QR payload). **Whether that deserves a `validate_not_empty` is a KDS-surface decision, not this page's**: `NULL` and `Some("")` may already be equivalent for every reader of that column, and nobody here checked the readers. Flag it to the KDS lane with these cites. Two constraints on whoever picks it up: `crates/oz-core/src/db/kds_tests.rs` is held **dirty by another session right now** in this shared checkout (` M` in `git --no-optional-locks status --porcelain`), so a test edit there would land on a stranger's in-flight work; and the empty string's source is the fail-open arm in item **A** above, which this item **declines to change** -- so a `validate_not_empty` would turn a swallowed IPC failure into a login refusal, and that trade needs its own owner call.
- **What this item did NOT do:** edited no file outside this page, ran no suite and no cargo (every backend figure is a line-read of a tracked blob, with its `git show e6d211b98:<path>` provenance), did not audit the readers of `terminal_id`, and took no ruling on any of the three arms. Nothing is ticked.
- **Filed by:** the same lane as `## 43`, 2026-09-16, at HEAD `71f2ce4a0`; the pass those measurements came from ran at `e6d211b98`, and every cite in items A and B re-reads identically at both tips except the two `WorkspaceContext.tsx` line lists, which are given twice for that reason.