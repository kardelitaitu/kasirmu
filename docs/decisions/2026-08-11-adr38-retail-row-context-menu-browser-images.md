<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass — D1–D4 all shipped and every named artifact exists. The context-menu component is real (`ui/src/features/retail/RetailProductContextMenu.tsx`, with `ui/src/__tests__/RetailProductContextMenu.test.tsx` covering it), the API wrapper the project rule requires is `ui/src/api/browser.ts`, the Tauri command `open_product_images_scoped` is in `apps/desktop-tauri/src/commands/browser.rs`, and the D3 plugin wiring is exactly as described — `tauri-plugin-opener = "2"` in the root `Cargo.toml:138`, consumed via `{ workspace = true }` at `apps/desktop-tauri/Cargo.toml:72`. The command module's own doc comment describes the https-only, percent-encoded contract the ADR mandates, so the security claim in D3 is enforced in the code rather than only asserted. · REPAIRED: the three capability-file and two `lib.rs` paths, which named `apps/desktop-client/` and `apps/tablet-client/` — both renamed, to `apps/desktop-tauri/` and `apps/mobile-tauri/`. The ADR also writes `apps/*/capabilities/*.json` generically in one place, which still reads correctly and was left alone. · The "No product images exist" premise in Context is now HISTORICAL rather than current: `product_images` shipped via `crates/kasirmu-core/migrations/20260901_product_images.sql`, which is the exact seam D2 predicted ("stored product images plug in at the same seam"). I have not edited the Context section, because for a decision record the Context is the record of what was known when the decision was made, and D2 explicitly scopes the work as the web-search fallback — a reader checking whether the feature is done should read Implementation Status, which is correct. Noted here so nobody reads the Context as a present-tense claim. · NOT re-measured: the commit hashes and the exact FTL key names. -->
---
num: 38
area: products
title: ADR #38: Retail POS Row Context Menu — View Product Images in Browser
status: Implemented (2026-08-12)
---
# ADR #38: Retail POS Row Context Menu — View Product Images in Browser

Date: 2026-08-11

Status: Implemented (2026-08-12)

## Context

The retail POS product grid (`ui/src/features/retail/RetailProductGrid.tsx`) is
a dense table: SKU | Stock | Name | Price | Action (extended in ADR #36 with
Barcode, Category, Brand, Rack, Notes). Operators need a way to quickly
**verify what a product is** — packaging, label, barcode identity — without
leaving the counter.

The product owner requested a **right-click context menu on the product row**
with a **"view product images on browser"** action.

State of the codebase:

- **No product images exist** — there is no image column on `products`, no
  image storage, and no image URL anywhere (ADR #36 reviewed and deferred the
  image feature). The menu action therefore works today by **searching the web
  for the product** (Google Images query from name + brand), which is the
  practical retail workflow for identifying a product. This is deliberately the
  seam where stored product images can plug in later (D2).
- **No browser-opening mechanism exists** — the apps register
  `tauri-plugin-updater`, `tauri-plugin-dialog`, `tauri-plugin-clipboard-manager`,
  and `tauri-plugin-window-state` (root `Cargo.toml` + both `lib.rs`). Opening
  an external URL requires adding `tauri-plugin-opener` following that exact
  pattern (workspace dependency, `.plugin(init())` in both clients, capability
  permission in `apps/*/capabilities/*.json`).
- **Right-click is currently untouched** — the table renders the native
  browser context menu. There is no existing context-menu component.

## Decision

### D1 — Row context menu (retail grid)

- `ProductCard` rows (`<tr>`) handle `onContextMenu` (`preventDefault`) and
  open a small menu at the cursor position, clamped to the viewport. The
  context-menu key (`Menu` / `Shift+F10`) opens the menu for the focused row.
- The menu is a new `RetailProductContextMenu` component (role `menu`,
  `menuitem` items), rendered by `RetailProductGrid` from local
  `{x, y, product}` state — presentation only; actions flow through the
  existing `ProductGridActions` (a new `onOpenProductImages(p)` callback).
- Closes on outside click, `Escape`, scroll, or `blur`. Keyboard: arrows
  navigate, `Enter`/`Space` activates, focus returns to the originating row on
  close (the CUST-11 focus-return pattern).
- **Menu contents:** the requested **"View product images in browser"** item
  only, for now. The menu shell is deliberately extensible — Edit / Add to
  cart / Rack lookup items can join later without redesign.

### D2 — The action: web search for product images

- The item opens the default browser at a **Google Images search** for the
  product: query = `name + brand` (brand omitted when empty), percent-encoded.
  Barcode is deliberately excluded — raw barcodes are not reliably indexed and
  pollute results.
- Rationale: no stored images exist, and this is the fastest way for an
  operator to confirm "this SKU is this product". When stored product images
  land (deferred in ADR #36), the same menu item can prefer local images and
  fall back to the web search — the action is the seam, not the implementation.

### D3 — Browser opening via `tauri-plugin-opener`

- Add `tauri-plugin-opener` to the workspace `Cargo.toml` and register
  `.plugin(tauri_plugin_opener::init())` in both
  `apps/desktop-tauri/src/lib.rs` and `apps/mobile-tauri/src/lib.rs`; add the
  `opener:allow-open-url` permission (or `opener:default`) to
  `apps/desktop-tauri/capabilities/default.json`,
  `apps/mobile-tauri/capabilities/default.json`, and
  `apps/mobile-tauri/capabilities/mobile.json`.
- New Tauri command `open_product_images_scoped(sessionToken, name, brand)` in
  **both clients** (`commands/*`, registered in each `lib.rs`) — it resolves
  the session (auth precedent, ADR #7), percent-encodes the query, and calls
  `tauri_plugin_opener::open_url` with an `https://` URL only. The URL is
  constructed and escaped server-side; raw product strings never reach the
  opener unescaped.
- Frontend call goes through a new `ui/src/api/browser.ts` wrapper
  (`openProductImagesScoped`) per the project rule (no `invoke` in
  components), with a `dev-mock/tauri-api.ts` handler that falls back to
  `window.open` in dev/demo/browser-preview mode.
- Not synced, not stored: the action is stateless. No schema change, no sync
  surface, no offline-queue involvement.

### D4 — i18n, a11y, tests

- FTL keys (en + id bundles) for the menu item and its ARIA label; bundle
  parity + dedupe gates pass.
- a11y: `role="menu"` / `role="menuitem"`, keyboard operation, focus return,
  jsx-a11y clean.
- Tests: right-click opens the menu at the cursor, the item fires
  `onOpenProductImages`, Escape/outside-click closes with focus restored,
  Menu-key opens on a focused row; the command percent-encodes name+brand and
  passes an https URL to the opener (mocked); dev-mock falls back to
  `window.open`.

## Consequences

- Operators verify products visually from the counter in two clicks, without a
  second device — the retail grid becomes self-servicing for product identity
  checks (helpful with barcode scanner misreads).
- First browser-opening capability in the apps, reusable for future "open in
  browser" actions (support links, analytics exports).
- No schema/sync/storage footprint; the feature is stateless and local.

## Tradeoffs / risks

- **Google Images is a third-party dependency** for the lookup. Accepted: it is
  a convenience action, not a critical path; a failed open degrades to nothing
  (logged, no error dialog).
- **No stored images yet** — the action shows web results, not the store's own
  catalog photos. Accepted per D2; stored images plug in at the same seam.
- **Right-click is desktop-oriented** — tablets rely on the Menu-key path
  (keyboard covers) or future long-press. The command is mirrored in the
  tablet client for parity; no touch gesture in this change.
- **New dependency** (opener plugin) — standard Tauri v2, minimal surface,
  permission-scoped to https open-url only.

## Verification

- Command tests (both clients): session auth, percent-encoded query, https-only
  URL construction, opener invocation mocked.
- UI tests: menu open/close/keyboard/focus-return, item fires the action,
  i18n keys present in both bundles.
- Capability + plugin wiring verified by both clients building; the single
  verification pass from ADR #36 covers the combined change.

---

## Implementation Status

**Implemented (2026-08-12).** D1–D4 shipped: `RetailProductContextMenu`
(right-click + Menu/Shift+F10, keyboard navigation, focus return),
`tauri-plugin-opener` registered in both clients with `opener:allow-open-url`
in all three capability files, and `open_product_images_scoped`
(percent-encoded name+brand query, https-only URL) with the
`ui/src/api/browser.ts` wrapper and a dev-mock `window.open` fallback.
Key commits: `2913d49c`, `be37eac1`. Stored product images remain the
documented future seam (D2) — the action currently searches Google Images.

> last audited 29-09-26 by docs-auditor
