<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (2 broken cross-references) + finding-status note · Audited on branch 0.0.40. The 2026-07-29 Buffy stamp above is the original audit record and is retained verbatim; this entry adds what has changed since. THE REPAIRS are both navigational and both are real breaks. The scope comment pointed at `docs/UX_GUIDELINES.md`, which does not exist — the file is now `docs/architecture/UX_GUIDELINES.md`. The prior-audit pointer named `docs/2026-07-28-retail-pos-theming-audit.md`, which also does not exist, because that audit was itself archived to `docs/archived/2026-07-28-retail-pos-theming-audit.md`; a reader following this audit's own "Prior audit" line was sent to a dead path. Both were repaired specifically because they are the navigational spine BETWEEN two archived records — the one thing that must survive archiving is the ability to get from one audit to the one before it. That is a different class from the body text below, which is evidence and was not touched. · The component inventory in the Executive Summary still holds: all six named sub-components resolve under `ui/src/features/retail/` — `RetailHeader.tsx`, `RetailFnBar.tsx`, `RetailProductGrid.tsx`, `RetailCartPanel.constants.ts`, `RetailSubViews.tsx` and `RetailModals.tsx`. (The summary says "seven extracted sub-components" and names six; the seventh is evidently RetailPosScreen itself. The wording predates this pass, so it is recorded here rather than rewritten.) · FINDING-STATUS NOTE: the stamp above reads `status: OPEN`, and one of the eight findings has since been addressed — Finding 5, "No skip-to-content link" (P2), is no longer true. A skip-to-content link now exists and is covered by dedicated tests, `ui/src/__tests__/skipToContent.test.tsx` and `ui/src/__tests__/keyboardNavigationCompliance.test.tsx`. I have NOT flipped the stamp to CLOSED and have not checked off any finding box: the remaining seven — three P1, including the missing dialog semantics and the backdrop-as-button pattern — are accessibility findings that need a real verification pass, and this audit does not have the evidence to close them. Recording one confirmed-closed finding is more useful than either a false CLOSED or a silent OPEN. · The Findings bodies, the phased fix plan (Phases A–E) and the branch state are the audit's evidence and are left exactly as written. · REPAIRED: the false "ACCURATE (0 findings)" footer, the same defect as three sibling archived files. -->

# Retail POS UX Audit — 2026-07-29

<!-- Original audit marker (2026-07-29, kept verbatim — original finding set, status still OPEN) · Buffy · status: OPEN · branch: 0.0.24 -->
<!-- Scope: ui/src/features/retail/ (all .tsx + .css) + docs/architecture/UX_GUIDELINES.md -->
<!-- Prior audit: docs/archived/2026-07-28-retail-pos-theming-audit.md (VERIFIED — fix cycle closed) -->

## Executive Summary

Following the 2026-07-28 theming audit (all P0/P1 findings closed), this audit examines the broader UX of RetailPosScreen and its seven extracted sub-components: RetailHeader, RetailFnBar, RetailProductGrid, RetailCartPanel, RetailSubViews, and RetailModals. The decomposition is architecturally sound and the component interfaces are clean. The UX surface shows strong fundamentals — ARIA labels, keyboard shortcuts (F1–F12 + Escape), loading/empty/error states, `prefers-reduced-motion` support, and exit animations across all modals.

**8 findings** across three severity tiers: 3 P1 (high), 3 P2 (medium), 2 P3 (low). None are regressions — they are pre-existing patterns that predate the recent refactor.

---

## Findings — ranked

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| 1 | **P1** | `RetailModals.tsx` (all overlays) | Modal overlays lack `role="dialog"`, `aria-modal="true"`, and focus trapping |
| 2 | **P1** | `RetailPosScreen.css` (shortcuts overlay) | Shortcuts overlay uses hardcoded `!important` colors that bypass the token system |
| 3 | **P1** | `RetailModals.tsx` (all overlays) | Backdrop rendered as `<button>` — semantically incorrect dialog backdrop pattern |
| 4 | **P2** | `RetailSubViews.tsx` (all views) | Sub-view wrappers duplicate header markup; should reuse `RetailHeader` |
| 5 | **P2** | `RetailPosScreen.tsx` (root) | No skip-to-content link for keyboard-only navigation |
| 6 | **P2** | `RetailCartPanel.tsx` (remove button) | Cart remove button (`×`) touch target ~24px — below recommended 44px guideline |
| 7 | **P3** | `RetailModals.tsx` (credit / clear-confirm) | Credit list and clear-confirm modals reuse `.retail-shift-*` CSS classes — semantically misleading |
| 8 | **P3** | `RetailProductGrid.tsx` (numpad) | Qty picker numpad uses emoji `⌫` for backspace — inconsistent with rest of UI (SVG icons) |

---

## Finding 1 — Modal overlays lack dialog semantics (P1)

**Where**: `RetailModals.tsx` — Open Shift, Close Shift, Shift Summary, Credit List, Clear Confirm, Discount, Customer Search, Qty Picker, Held Carts, Shortcuts, Quick Return overlays.

**What's wrong**: Every overlay renders as:

```tsx
<button type="button" className="retail-shift-overlay" aria-label="Close" onClick={...}>
  <div className="retail-shift-modal" role="presentation" onClick={e => e.stopPropagation()}>
    {/* modal content */}
  </div>
</button>
```

This pattern has three gaps:

1. **No `role="dialog"`**: Screen readers don't announce the modal as a dialog. The user lands in what appears to be a plain button with no indication that focus should stay within it.
2. **No `aria-modal="true"`**: Assistive technologies don't know to hide the rest of the page from the accessibility tree.
3. **No focus trapping**: Pressing Tab at the last focusable element exits the modal into the background page (header, function bar). The Escape key is handled globally in `RetailPosScreen.tsx` but focus isn't constrained.

**Impact**: Keyboard and screen-reader users can navigate out of the modal into the background UI without realizing it, then interact with hidden elements.

**Recommendation**: Use a proper dialog pattern:

```tsx
<div className="retail-shift-overlay" role="dialog" aria-modal="true" aria-label="Open Shift" onClick={onBackdropClick}>
  <div className="retail-shift-modal" onClick={e => e.stopPropagation()}>
    {/* modal content */}
  </div>
</div>
```

Plus a `useFocusTrap` hook on the modal content div to constrain Tab/Shift+Tab cycling, and auto-focus the first input or confirm button on open.

---

## Finding 2 — Shortcuts overlay hardcoded colors (P1)

**Where**: `RetailPosScreen.css` shortcuts overlay block (lines ~1534–1562):

```css
.retail-shortcuts-overlay {
  background: rgba(0, 0, 0, 0.8) !important;
  backdrop-filter: blur(10px) !important;
}

.retail-shortcuts-modal {
  background: #111827 !important;
  border: 1px solid #374151 !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9) !important;
}
```

**What's wrong**: All four values use `!important` and hardcoded hex/rgba literals. No theme token is referenced. If the app is in light theme, the shortcuts overlay remains dark regardless. The `!important` flags block any cascade override.

**Impact**: Visual mismatch between the shortcuts overlay and the rest of the UI when the app is in light or default theme. The theming audit (2026-07-28) explicitly calls out hardcoded colors as P1-level violations.

**Recommendation**: Replace with existing POS-modal tokens (`--color-pos-modal-overlay`, `--color-pos-modal-bg`, `--color-pos-modal-border`, `--color-pos-modal-shadow`) already defined in the CSS. Drop all `!important` modifiers:

```css
.retail-shortcuts-overlay {
  background: var(--color-pos-modal-overlay);
  backdrop-filter: blur(10px);
}
.retail-shortcuts-modal {
  background: var(--color-pos-modal-bg);
  border: 1px solid var(--color-pos-modal-border);
  box-shadow: var(--color-pos-modal-shadow);
}
```

---

## Finding 3 — Backdrop-as-button pattern (P1)

**Where**: `RetailModals.tsx` — all overlay rendering blocks.

**What's wrong**: Every overlay container is a `<button>` element:

```tsx
<button type="button" className="retail-shift-overlay" aria-label="Close" onClick={...}>
```

While this enables backdrop-click-to-close, it's semantically incorrect:

- A full-screen backdrop is not a "button" in the HTML sense.
- Screen readers announce it as "Close, button" — which misleads users into thinking the only action is to dismiss, when in fact the modal content inside has interactive form elements.
- The `aria-label="Close"` on the `<button>` conflicts with the nested modal content's own close buttons and cancel buttons.
- Clicking the backdrop fires the button's click handler, but the markup suggests the *entire overlay* is a single button.

**Impact**: Confusing screen-reader experience. When a user tabs into the overlay, they land on a "Close button" that spans the entire viewport.

**Recommendation**: Use a `<div>` with an `onClick` handler for the backdrop. Only the explicit × or Cancel buttons inside the modal should be `<button>` elements:

```tsx
<div className="retail-shift-overlay" onClick={onBackdropClose}>
  <div className="retail-shift-modal" onClick={e => e.stopPropagation()}>
    {/* modal content including explicit close button */}
  </div>
</div>
```

The Escape key handler in `RetailPosScreen.tsx` already handles keyboard dismissal.

---

## Finding 4 — Sub-view wrappers duplicate header markup (P2)

**Where**: `RetailSubViews.tsx` — `SalesHistoryView`, `TableManagementView`, `StockInquiryView`.

**What's wrong**: Each sub-view manually rebuilds the header:

```tsx
<div className="retail-pos" data-theme={theme}>
  <header className="retail-header" style={{ justifyContent: 'space-between' }}>
    <div className="retail-header-store">
      <span className="retail-header-name">{l10n.getString('...')}</span>
    </div>
    <button className="retail-options-tab retail-options-tab--danger" onClick={onBack}>
      &larr; {l10n.getString('back')}
    </button>
  </header>
  <div style={{ flex: 1, overflow: 'auto' }}>
    {/* screen content */}
  </div>
</div>
```

This is a near-duplicate of the `RetailHeader` component but with:
- No store info (logo, name, address, branch)
- No shift badge
- No cashier display
- No clock
- A back button that `RetailHeader` doesn't support

**Impact**: 3× code duplication. If `RetailHeader` gets a layout/accessibility/theme fix, these three sub-views won't benefit.

**Recommendation**: Extend `RetailHeader` with a `variant?: 'full' | 'minimal'` and `onBack?: () => void` props so sub-views can reuse it instead of reconstructing it.

---

## Finding 5 — No skip-to-content link (P2)

**Where**: `RetailPosScreen.tsx` main return — no skip link before the header.

**What's wrong**: Keyboard users must Tab through the header (workspace picker button), then the low-stock banner, then the category bar (~N tabs for N categories), then the search bar, before reaching the first product in the table. For a store with 10+ categories, this could be 15+ Tabs before reaching functional content.

**Impact**: Poor keyboard efficiency for power users who want to jump directly to the product grid or cart.

**Recommendation**: Add a visually-hidden (but focus-visible) skip link as the first child of the main return:

```tsx
<a href="#retail-product-grid" className="retail-skip-link">
  {l10n.getString('retail-skip-to-products')}
</a>
```

With CSS:

```css
.retail-skip-link {
  position: absolute;
  top: -100%;
  left: var(--space-2);
  z-index: 2000;
  padding: var(--space-2) var(--space-4);
  background: var(--color-primary-pos);
  color: var(--color-pos-on-primary);
  font-weight: var(--font-weight-bold);
}
.retail-skip-link:focus {
  top: var(--space-1);
}
```

---

## Finding 6 — Small touch target on cart remove button (P2)

**Where**: `RetailCartPanel.tsx` — the `×` remove button.

**Relevant CSS**: `RetailPosScreen.css`:

```css
.retail-cart-remove-btn {
  padding: var(--space-1) var(--space-1_5);
  min-width: var(--space-8);    /* 32px */
  min-height: var(--space-8);   /* 32px */
}
```

At the minimum supported resolution (1366×768), root font-size scales to ~11.4px, making `--space-8` (2rem) ≈ 22.8px — below the 44×44 CSS-pixel minimum for touch targets recommended by WCAG 2.1 SC 2.5.5. Even at 1920px baseline (16px root), 32px is below the 44px recommendation.

**Impact**: On touch devices (tablets, all-in-one POS terminals), the remove button is difficult to tap accurately without zooming.

**Recommendation**: Increase `min-width` and `min-height` to `var(--space-11)` (44px at baseline, ~25px at minimum) or use `aspect-ratio: 1` with `min-width: var(--space-11)`.

---

## Finding 7 — Credit/clear-confirm modals reuse shift-modal classes (P3)

**Where**: `RetailModals.tsx` — credit list and clear-confirm modals.

```tsx
{/* Credit list overlay: */}
<button className="retail-shift-overlay" ...>
  <div className="retail-shift-modal" ...>
```

```tsx
{/* Clear confirm modal: */}
<button className="retail-shift-overlay" ...>
  <div className="retail-shift-modal" ...>
```

These modals reuse `.retail-shift-overlay` and `.retail-shift-modal` CSS classes despite not being shift-related. Historically this worked because all modals shared the same base styles, but after Finding 1 (dialog semantics) is addressed, each modal type should have semantic CSS class names or share a generic `.retail-modal-overlay` / `.retail-modal` base.

**Impact**: Future CSS changes to `.retail-shift-overlay` intended only for shift modals will accidentally affect credit and clear-confirm modals (or vice versa).

**Recommendation**: Extract a generic `.retail-modal-overlay` / `.retail-modal` base class and let `.retail-shift-overlay` / `.retail-shift-modal` extend it if shift-specific overrides are needed.

---

## Finding 8 — Qty picker numpad uses emoji backspace (P3)

**Where**: `RetailModals.tsx` — qty picker numpad:

```tsx
{[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k) => (...))}
```

The backspace key is the emoji character `⌫` (U+232B). Every other icon in the retail POS uses inline SVGs for consistent rendering. Emoji render differently across platforms (Windows renders it as a system emoji; macOS renders it as Apple Color Emoji).

**Impact**: Minor visual inconsistency. On Windows, the backspace emoji may appear as a colorful emoji rather than a monochrome UI glyph, clashing with the rest of the terminal-style UI.

**Recommendation**: Replace with an inline SVG backspace/delete icon matching the existing icon pattern:

```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
  <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
  <line x1="18" y1="9" x2="12" y2="15" />
  <line x1="12" y1="9" x2="18" y2="15" />
</svg>
```

---

## What's already solid

These areas passed audit with no findings — they're worth acknowledging:

| Area | Evidence |
|------|----------|
| **Loading states** | Products, categories, shift, customer search, quick return — all have loading indicators with `role="status"` or spinner SVGs |
| **Empty states** | Product grid (3 variants: no products, no category match, no search match), empty cart, no held carts, no credit sales, no customer results |
| **Error states** | Toast notifications for all API failures; fallback sample data when backend is unreachable; inline shift-close error display |
| **Keyboard shortcuts** | F1–F12 mapped, Escape closes overlays in priority order, `?` toggles shortcut reference |
| **`prefers-reduced-motion`** | Respected across all animations (resize pulse, price pulse, cart line flash, modal entry/exit, loading spinner, empty-state breathe) |
| **i18n** | All user-visible strings use `@fluent/react` `l10n.getString()` or `<Localized>`; no hardcoded English strings in JSX |
| **ARIA labels** | Every interactive element has `aria-label`; table headers have `aria-sort`; status regions use `aria-live="polite"`; undo bar is `role="status"` |
| **Exit animations** | All modals mirror entry keyframes with `--exiting` CSS classes via `useExitAnimation` hook; overlay pointer-events disabled during exit |
| **Resize handle** | Keyboard-accessible (Left/Right arrows), ARIA `role="separator"` with `aria-valuenow/min/max`, pulse animation with reduced-motion guard |
| **Cart line animations** | `retail-fade-in` + `retail-line-flash` on new lines; `retail-slide-up` on undo bar |

---

## Recommendation — phased fix plan

### Phase A — Dialog semantics (P1-1, P1-3)

- Replace `<button>` overlays with `<div>` backdrops + `onClick`
- Add `role="dialog"`, `aria-modal="true"`, `aria-label` to all overlay containers
- Implement `useFocusTrap` on modal content containers

### Phase B — Token compliance (P1-2)

- Replace hardcoded shortcuts overlay colors with `--color-pos-modal-*` tokens
- Remove all `!important` modifiers from shortcuts overlay CSS

### Phase C — Component reuse (P2-4, P3-7)

- Extend `RetailHeader` with `variant` and `onBack` props
- Replace sub-view header duplication with `<RetailHeader variant="minimal" onBack={...} />`

### Phase D — Keyboard & touch polish (P2-5, P2-6)

- Add skip-to-content link before the header
- Increase cart remove button touch target to 44×44 CSS px

### Phase E — Cosmetic (P3-8)

- Replace emoji backspace with inline SVG icon

---

## Branch state

```
0.0.22 ──► 0.0.23 ──► 0.0.24 (current)
           (theming    (theming fix
            audit)      closed + this UX audit)
```

This audit is the only deliverable for this session. No code changes have been made.

> last audited 29-09-26 by docs-auditor

