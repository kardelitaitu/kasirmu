# resto-pos UI — code review

<!-- Audit stamp: 2026-09-15 · Budak-Korporat · status: REVIEW, FIRST PASS · reviewed HEAD `97a176e5f` on branch `0.0.39`. METHOD: static reading only — no test suite was executed, no file was modified, and no live app was driven. Every finding carries a `file:line` re-read in this checkout; every count has its command beside it. One finding (F4) is a reachability argument from code structure and is marked NOT VERIFIED AT RUNTIME. · SCOPE: the `restaurant-pos` workspace surface — the AppShell branch, `features/sales/PosScreen.tsx`, `features/restaurant/`, and the shared `CartPanel` / `usePosState` / `usePosCartActions` plumbing they sit on. NOT reviewed in this pass: the KDS screens, the topology/floor-plan editor, `features/tables/`, the CSS beyond what affects layout, and the Rust cart/pricing backend beyond the two call sites cited in F1/F2. · This review corrects a framing I published in this session before auditing: I described the restaurant vertical as "27% of retail" by line count, which is misleading — the restaurant surface is a *shared screen* with a different left panel, not a smaller copy of the retail screen. See §2. -->

**Reviewer:** Budak Korporat
**Subject:** the `restaurant-pos` workspace UI — the restaurant POS surface in the Tauri desktop client
**Verdict:** **the plumbing is attached to the wrong stack.** The restaurant surface is not under-built — it has capabilities retail lacks (open bills, course firing, table management, a promotions picker). What it does not have is **modifiers and course assignment**, and both of those are built, tested and wired — to retail. The one screen that integrates them, `PosScreen`, is also where 26 of its 106 tests are tautologies. Everything else about this surface is in good shape.

---

## 1. Scope and method

Read-only. The question asked was: what is here, what is missing relative to retail, what is tested, and what would break if someone changed it.

Four passes: (1) how the workspace is reached and configured; (2) a capability matrix against the retail stack, built by grepping each capability in both screens rather than by reading their names; (3) what the tests actually assert, read line by line rather than counted; (4) shared-contract and reachability risks.

Line counts, counts and greps are all reproducible; the commands are inline. The one claim I could not close statically is flagged in F4.

---

## 2. The architecture, and a correction to my own earlier framing

`restaurant-pos` is a **workspace type**, not an application. `AppShell.tsx:586` returns a fullscreen layout for it (no sidebar) and renders `PosScreen`; `store-pos` gets `RetailPosScreen` at `:630`, `kds` gets `KdsScreen` at `:673`. Anything else falls through to the page registry wrapped in `AppLayout` at `:692-739`.

Inside `PosScreen`, the workspace changes exactly **one** thing — the left panel:

```tsx
{activeWorkspace === 'restaurant-pos' ? (
  <RestaurantMenu onAddProduct={handleAddProduct} />
) : (
  <ProductLookupScreen onAddProduct={handleAddProduct} />
)}
```
`ui/src/features/sales/PosScreen.tsx:624-628`

The cart panel, payment modal, promotions picker, price override, open-bill modals, shift modals and the FastPIN overlay are **shared** — they are rendered unconditionally after that branch (`:632-734`). `ui/src/features/index.ts:44-46` documents the same thing from the other direction: `restaurant/` is "a sub-component used inside PosScreen, not a standalone navigable page".

**So the earlier "1,499 vs 5,639 lines" comparison was the wrong measurement.** The restaurant stack is `PosScreen` (749) + `RestaurantMenu` + its six components (1,499); the retail stack is `RetailPosScreen` (1,782) + its seventeen components (5,639). They are two different architectures — a shared screen with a swapped panel, versus a self-contained screen — and the line counts mostly measure that difference, not capability. The capability difference is measured in §3 and it is narrower, and stranger, than the line counts suggest.

---

## 3. Findings

### F1 — The restaurant stack cannot attach modifiers, and the modifier UI is wired to retail. **Moderate; functional gap.**

`ItemModifierModal` is described in its own docstring as *"modal for customising a **menu item** with modifiers"* (`ui/src/features/sales/components/ItemModifierModal.tsx:73`) and its props are entirely generic — `productName`, `basePriceMinor`, `currency`, `groups`, `onConfirm(selections, totalPriceMinor)` (`:39-54`). Nothing about it is retail-specific.

It has **exactly one production importer**:

```
$ grep -rn "ItemModifierModal" ui/src --include=*.tsx --include=*.ts | grep "from '"
ui/src/features/retail/RetailPosScreen.tsx:16:import ItemModifierModal from '@/features/sales/components/ItemModifierModal';
```

Zero references in `PosScreen.tsx`. Zero in `features/restaurant/` (`grep -rn -i modifier ui/src/features/restaurant/` returns nothing).

The data layer, by contrast, fully supports modifiers on the restaurant path. `usePosState.addProduct` takes them:

```ts
const addProduct = useCallback((product: Product, qty: number = 1,
  meta?: { courseId?: CourseId; modifiers?: ModifierSelection[] }): boolean => {
```
`ui/src/features/sales/usePosState.ts:74`

But the wrapper that `PosScreen` actually calls **drops the third argument**:

```ts
const handleAddProduct = useCallback(
  (product: Product, qty?: number) => {
    ...
    addProduct(product, qty);          // meta never forwarded
  },
  ...
);
```
`ui/src/features/sales/hooks/usePosCartActions.ts:119-133`

`PosScreen` routes every add through it (`PosScreen.tsx:625` and `:627`), and `RestaurantMenu`'s prop surface is `onAddProduct?: (product: Product) => void` (`RestaurantMenu.tsx:20`) — a single product, no room for modifiers or a course. Retail calls `addProduct` directly and does pass meta, e.g. the undo-remove path:

```ts
// Restore the exact line — including its course assignment and
// modifiers — not a bare re-add (the modifiers would be lost).
addProduct({ ...productType: 'retail'... }, item.qty, {
  ...(item.courseId !== undefined ? { courseId: item.courseId } : {}),
  ...(item.modifiers !== undefined ? { modifiers: item.modifiers } : {}),
});
```
`ui/src/features/retail/RetailPosScreen.tsx:363-371`

**So the retail screen is carefully preserving restaurant concepts, while the restaurant screen cannot produce them.** A modifier picker for menu items exists, is tested (`ui/src/__tests__/ItemModifierModal.test.tsx`), and is unreachable from the surface it was written for.

### F2 — Course assignment is absent from the restaurant cart, so the course firing bar has nothing to fire. **Moderate; functional gap.**

The restaurant cart renders a course-firing bar (`CartPanel.tsx:465-470`, `CourseSelectorBar.tsx`) whose buttons are gated on a per-course count of lines on hold:

```ts
(l) => l.courseId === course.id && l.coursingStatus === 'hold'
```
`ui/src/features/sales/components/CourseSelectorBar.tsx:23`

`usePosState` exports `assignCourse(lineId, courseId)` (`usePosState.ts:158`) and `fireCourse` (`:172`). The **shared** `CartPanelProps` — the one the restaurant stack uses — declares only `fireCourse` / `fireAllCourses` (`ui/src/features/sales/components/CartPanel.tsx:121-122`), and `usePosCartActions` does not return `assignCourse` at all (returned object, `:257-272`).

**Second pass — it is a fork, not a missing prop.** The two screens do not share a cart panel at all:

| Path | Panel | Lines | Course assign | Modifier edit |
|---|---|---|---|---|
| Restaurant (`PosScreen.tsx:27`) | `sales/components/CartPanel.tsx` | 609 | ✗ | ✗ |
| Retail (`RetailPosScreen.tsx:39`) | `retail/RetailCartPanel.tsx` | 449 | ✓ | ✓ |

```
$ grep -c "onEditModifiers\|onAssignCourse" ui/src/features/sales/components/CartPanel.tsx
0
$ grep -rn "interface CartLineActions" ui/src
ui/src/features/retail/RetailCartPanel.tsx:36:export interface CartLineActions {
```

So retail did not merely *pass* the restaurant affordances through — it **forked a cart panel** to obtain them, and the interface it invented for that fork is owned by, and lives in, the retail feature:

```ts
export interface CartLineActions {
  ...
  /** Assign a course to a cart line (restaurant coursing). */
  onAssignCourse: (lineId: LineId, courseId: CourseId) => void;
  /** Open modifier editor for a cart line. */
  onEditModifiers: (line: CartLine) => void;
}
```
`ui/src/features/retail/RetailCartPanel.tsx:36-46`

Read the doc comments: the interface is declared in `features/retail/`, and its two restaurant-only members are annotated **"restaurant coursing"** and **"Open modifier editor"**. The restaurant surface is implemented inside the retail cart panel, in writing, and the restaurant path's own panel has no such prop to pass. The shared panel is *larger* (609 vs 449 lines) — it is not a subset; it is the older panel, and the restaurant stack is on it.

Combined with F1, the restaurant stack has **no path that sets `courseId`** — not at add time (meta is dropped) and not after the fact (no assignment prop). So the firing bar's hold count is structurally zero.

**This is a front-end-only concept.** `grep -rl coursing` matches only `usePosState.ts`, `CourseSelectorBar.tsx`, `RetailCartPanel.tsx`, `types/domain.ts` and tests — **nothing in Rust or SQL**. The backend does persist a course on the sale line (`crates/oz-core/src/db/sales.rs:198` selects `course, modifiers_json`; `:214` writes `line.course`) and publishes an event described as *"Published when a course is fired from the **Resto POS** to the kitchen"* (`crates/oz-core/src/events.rs:18`, event name `order.course_fired` at `:52`). So the server-side concept is real and named after this very surface; the UI just cannot feed it.

Note that `PosScreen.tsx:98` and `:594` do wire `fireCourse` / `fireAllCourses` through to `CartPanel`. The firing half is connected; the assignment half is not.

### F3 — 26 of 106 tests in the restaurant screen's integration suite are tautologies. **Moderate; verification gap.**

```
$ grep -cE "^\s*(it|test)\(" ui/src/__tests__/PosScreen.integration.test.tsx
106
$ grep -c 'expect(true)\.toBe(true)' ui/src/__tests__/PosScreen.integration.test.tsx
26
```

They are not scattered — they are concentrated on precisely the two restaurant-specific surfaces this review is about. All five in `describe('PosScreen — Course firing bar (restaurant mode)')` (`:1894-1931`) are of this shape:

```ts
it('shows course firing bar in restaurant-pos workspace when items on hold', async () => {
  // This would require setting activeWorkspace to 'restaurant-pos'
  // and adding items with courseId and coursingStatus: 'hold'
  // The course bar is rendered conditionally
  await renderPosScreenWithShift();
  expect(true).toBe(true);
});
```

and all five in the workspace-settings-modal block (`:2012-2032`) likewise — including `it('passes workspaceType="restaurant-pos" to modal')`, which asserts nothing about the prop.

Repo-wide the pattern is 34 occurrences across 7 files, so this file holds **26 of the 34** (76%). The consequence is specific: the restaurant *integration* points — course firing and the settings modal — have the least verification on an otherwise well-tested screen, and the coverage reports as present.

### F4 — `workspaceType="restaurant-pos"` is hardcoded, and `PosScreen` is reachable with other workspaces. **Minor; latent, NOT VERIFIED AT RUNTIME.**

`PosScreen.tsx:742` passes `workspaceType="restaurant-pos"` to `WorkspaceSettingsModal` unconditionally. That prop selects which settings card renders:

```tsx
switch (workspaceType) {
  case 'restaurant-pos': return <WorkspaceRestaurantPosSettings {...cardProps} />;
  case 'kds':            return <WorkspaceKdsSettings {...cardProps} />;
  case 'warehouse':      return <WorkspaceInventorySettings {...cardProps} />;
  default:               return <WorkspaceStorePosSettings {...cardProps} />;
}
```
`ui/src/features/settings/WorkspaceSettingsModal.tsx:50-59`

`AppShell` handles `restaurant-pos`, `store-pos` and `kds` with early returns and then falls through to the page registry inside `AppLayout` (`:692-739`). `PosScreen` is registered as a normal page at routes `sales` and `pos` with a sidebar nav item:

```
registerPage({ route: 'sales', component: PosScreen, label: 'POS Terminal', feature: 'simple-retail' });
registerPage({ route: 'pos',   component: PosScreen, label: 'POS Terminal', feature: 'simple-retail' });
```
`ui/src/features/sales/register.tsx:15-16`, nav item at `:17-24`

So for a workspace that is none of those three — `warehouse` is the live example — a user who reaches route `sales` gets `PosScreen` with `activeWorkspace = 'warehouse'`, which means a `ProductLookupScreen` left panel (`:627`, so that fallback is **live code, not dead**) and a **`WorkspaceRestaurantPosSettings` card** in the settings modal.

Also note `AppShell` already computes the correct value for its *own* settings modal — `WORKSPACE_TO_TYPE[activeWorkspace]` at `:396-409` — so the two modals disagree by construction.

**Not verified:** I did not drive the app to confirm that route `sales` is reachable from a `warehouse` workspace in the running build. The code path is clear; the user-facing reachability is an inference from the nav registration and `AppLayout`, and it should be confirmed with one manual check before this is treated as a user-visible bug.

### F5 — `RestaurantMenu` persists two different ways, and only one of them syncs. **Minor; confirm intent.**

Three display preferences round-trip through the scoped backend — `sort`, `cardsize`, `fontsize` — via `setUserPreferencesScoped` (`RestaurantMenu.tsx:201-208`) and are rehydrated from `getUserPreferencesScoped` on mount and on session-token rotation (`:234-257`).

Four others are **localStorage-only**: `pinned`, `colors`, `unavailable`, and the popularity counts (`:39-88` helpers, `:266-274` save effect). They are namespaced per user (`restaurant-${uid}-${name}`, `:27-29`) but never sent to the server.

So a user's card size follows them to another terminal while their pinned items and colour coding do not. That may well be deliberate — pins and colours are arguably terminal-local, and `unavailable` in particular may be a local workaround rather than shared state — but the split is not documented and the two mechanisms sit in the same component. Worth one sentence of intent either way.

---

## 4. What is in good shape

This surface is not neglected, and the findings above are narrow:

- **`RestaurantMenu.test.tsx` is 859 lines and genuinely thorough** — loading/empty states, per-user rehydration, storage-unavailable fallback, long-press touch semantics (including slop and jitter), keyboard menu navigation, focus restoration, autofill suppression, and the deliberate rule that category pills derive from `productType === 'restaurant'` products only (`RestaurantMenu.tsx:312-315`, tested at `:285`).
- **`WorkspaceRestaurantPosSettings.test.tsx` is real** — 12 tests, zero tautologies.
- **The restaurant stack has capabilities retail does not**: open bills (`OpenBillModals`, 22 references in `PosScreen`), course firing, `TableManagementScreen`, `SalesHistoryScreen`, a promotions picker and the FastPIN manager-override overlay — all rendered unconditionally in `PosScreen`, so retail has none of them in this form.
- **The shared-contract discipline is documented rather than accidental.** `PosScreen.tsx:568-576` explains why `CartPanelProps` stays a 77-field type and only the call site is regrouped, and `:569` records that `RetailCartPanel.test.tsx` asserts it. Anyone adding the 78th field will hit a typecheck error at that call site, by design.
- **The `usePosState` / `usePosCartActions` split is a real seam, not a mistake** — it is where F1's dropped argument lives, but the wrapper also carries the shift-open guard and the ADR-19 §5.1 deduction-location guard (`usePosCartActions.ts:121-129`), which are the reasons it exists.

---

## 5. Not verified in this pass

Recorded so the next reader knows the edges of these claims:

1. **F4's runtime reachability** — see above. One manual check settles it.
2. **Whether F1/F2 are deliberate deferrals.** Neither is marked as a deferral anywhere I found, and the retail-side care (`RetailPosScreen.tsx:363-371` preserving `courseId`/`modifiers`) argues they are not — but a plan doc may exist that I did not read. The open work orders under `todo-refactor-pos-screen-agents-*.md` are about `CartPanel` and `PaymentModal`, not this.
3. **Backend course/modifier defaults.** I confirmed the backend persists `course` and `modifiers_json` on a sale line and publishes `order.course_fired`, but I did not read the cart/order backend far enough to say whether it applies a default course when the UI omits one. If it does, F2 is a UI-only gap and less severe than it reads.
4. **The KDS side.** `CourseSelectorBar`'s firing feeds the KDS, which is a large surface I did not open.

---

## 6. Suggested order, if these are picked up

1. **F1 and F2 together** — they are one seam, and the second pass changed the shape of the fix. This is **not** "add a prop": `handleAddProduct` must forward `meta`, `RestaurantMenu`'s prop surface must carry it, and the restaurant path must acquire a course-assignment affordance it currently has no panel-level home for. There are two ways, and they should be chosen deliberately:
   - **(a) Port into the shared panel.** Move `onAssignCourse` / `onEditModifiers` from `CartLineActions` into `CartPanelProps`, or adopt the `lineActions` / `panelActions` grouping the retail fork already proves out. Cost: the 77-field type grows further, and `PosScreen.tsx:568-576` documents why that type is deliberately flat — so this is the option that fights an existing decision.
   - **(b) Put the restaurant path on the retail panel.** Migrate `PosScreen` from `sales/components/CartPanel.tsx` to `RetailCartPanel.tsx` and delete the older panel, collapsing the fork. Cost: `RetailCartPanel` is retail-shaped (`retail-cart-remove-btn`, `RETAIL_CART_WIDTH_*`) and would need its naming and width constants generalised; the benefit is one cart panel instead of two, which is what the current split is really costing.

   `ItemModifierModal` and `assignCourse` already exist, so either way this is wiring, not construction. Doing F1 without F2 leaves the modifier picker reachable but unpersisted; F2 without F1 leaves the course bar populated but unfirable.
2. **F3** — replace the 26 tautologies with real assertions, or delete them. A named-but-vacuous test is worse than no test, because it reads as coverage. The course-firing block is the natural place to start, since F2 will need real tests anyway.
3. **F4** — one-line fix once confirmed, but confirm first; if route `sales` is genuinely unreachable from non-POS workspaces then the hardcode is harmless and the real fix is to make the unreachability explicit.
4. **F5** — documentation or nothing.

---

> Every count in this document was produced by the command shown beside it. First pass at HEAD `97a176e5f`; second pass at HEAD `074655fb0c`, which re-verified F1 and F3 unchanged (one production importer of `ItemModifierModal`; 26 tautologies of 106, 34 repo-wide) and sharpened F2. Where I could not close a claim I have said so rather than rounded it — and one of those, §5.2, was closed rather than carried.

---

## 7. Corrections, 2026-09-16 at HEAD `51936522f` (third pass)

The branch moved under this review. Three findings are superseded — kept verbatim above per
convention, corrected here with the commit that changed each:

- **F2 — CLOSED (assignment half in the cart; persistence + firing now wired end to end).**
  The chip + `assignCourse` prop the second pass already noted (`CartPanel.tsx:131,585-589`)
  are joined by: `course` on `foundation::CartLine` (`foundation/src/cart.rs:62-78`, normalized
  `drinks→beverage`), `set_line_course_scoped` + `AddLineArgs.course` in `oz_bridge::pos`,
  `from_cart_with_user` filling `course` from the cart (`modules/sales/src/models.rs:198`),
  the fan-out's existing `course: l.course.clone()` (`kds_lines.rs:159`) now receiving `Some`,
  the checkout push carrying `course` on both `lineArgs` loops (`PaymentModal.tsx:597-612,
  :902-917`) and the shortfall rebuild (`pos.rs:1808-1816`, `CartLineData.course` both sides),
  and a sale-based `publish_course_fired_scoped` emitting `order.course_fired` with the REAL
  `sale_id` after the KDS fan-out (`PaymentModal:publishFiredCourses`, both checkout tails).
  The cart-id-as-correlation design from the plan's §2/§4.6 was superseded before landing:
  firing publishes at checkout, where the sale exists. What remains UI-only by design:
  `coursingStatus` (hold/fired) never crosses IPC, so fired-but-uncompleted state does not
  survive reload. Vocabulary unified on the KDS set (`CourseId =
  appetizer|main|side|dessert|beverage`, `ui/src/types/domain.ts:39`; legacy `drinks`
  normalizes at every boundary). `restaurant.course_firing` now actually gates the bar + chip
  (`PosScreen.tsx:493-501`, `CartPanel.tsx:556,593`; null/failure-open by design).
- **F3 — CLOSED.** `PosScreen.integration.test.tsx` now holds 80 cases with the `expect(true)`
  string surviving only in the header comment (`:9`). The 26 tautologies are gone.
- **F4 — CLOSED (moot).** The vestigial workspace settings modal was dropped (`3af8e2989`);
  no `workspaceType=` remains in `PosScreen.tsx`. There is no hardcode left to fix.
- **F5 — DOCUMENTED, still open as a product question.** The two-tier split is now recorded
  in code (`RestaurantMenu.tsx:42-63`) and in `f4455548a`, but `unavailable` (86) staying
  terminal-local is still an undocumented intent vs gap — no ADR or product decision backs it.
- **F1 — STILL OPEN, unchanged.** `ItemModifierModal`'s only production importer is still
  `RetailPosScreen`; the restaurant path still cannot attach modifiers. Explicitly deferred
  to a later tranche (same wire, once the picker has a home) — see the tackle-all plan §1.

Committed in this pass: `a8a5eeb79` (backend: cart course, set/fire commands, sale fill,
fan-out course test), `b07e8c3ac` (sale-based publish rework, UI API types), `51936522f`
(checkout carry, publish-per-fired-course, gating, vocabulary, 188-case scoped green).
`set_line_course_scoped` is registered but callerless by design (no live backend cart exists
at chip time — the UI cart is local-only until checkout) and sits on the IPC parity
`scoped_orphans` allowlist; it leaves the list when a live-cart caller wires it.
