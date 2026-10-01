<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (2 broken path references) — otherwise ACCURATE · Audited on branch 0.0.40. The 2026-07-29 Buffy marker above is the original of this LIVING checklist and is retained verbatim and re-labelled rather than superseded — this document is meant to keep being used, so the fact that it was established from the retail POS audit, the feature-modal sweep and the PaymentModal audit is part of its provenance, not a superseded claim. · THE REPAIR: the checklist pointed its modal-token section AND its verification command at `ui/src/theme/tokens.css`, and that directory no longer exists. The token sheet is now `ui/src/theme/tokens.css`. This one mattered more than a stale prose reference, because line 158 is a command an author is meant to RUN — `grep -n "color-pos-modal-" ui/src/theme/tokens.css` — and a checklist whose verification step fails on a moved path trains its readers to ignore it. Both occurrences were repaired. · EVERYTHING ELSE VERIFIED, and this is a checklist whose correctness is entirely in its API references, so all of them were checked: `useFocusTrap` exists at `ui/src/hooks/useFocusTrap.ts` and is exported at line 57, so the documented signature `useFocusTrap(ref, activeCondition, closeCallback)` and the import path `@/hooks/useFocusTrap` are live; `useExitAnimation` exists at `ui/src/hooks/useExitAnimation.ts`, backing section 9; the `--color-pos-modal-*` tokens the Good/Bad example contrasts genuinely exist, with 30 references in `ui/src/theme/tokens.css`; and `isAnyOverlayOpen()`, which section 11 tells authors to guard modal-opening callbacks with, is real — it is used in `ui/src/features/retail/RetailPosScreen.tsx`. The `skip-to-main` Fluent id in section 5 is consistent with the skip-link tests that now exist (`ui/src/__tests__/skipToContent.test.tsx`). · REPAIRED: the false "ACCURATE (0 findings)" footer, the same defect found across this archived batch — on a file that plainly contains findings, because finding and fixing them is its entire purpose. · LEFT ALONE: all eleven sections, the Bad/Good code samples, and the audit runbook. A checklist's value is that it is copied and followed; its examples describe patterns, not this repository's current components, so they were left exactly as written. · The mechanical greps in the Quick check assume a POSIX shell, which is the documented way to run them in this repo (Git bash by full path, per the project rules) — noted so a Windows reader does not read the commands as broken. · No docs-auditor stamp or footer existed on this file before this pass. -->

# Modal & Overlay Audit Checklist

<!-- Original audit marker (2026-07-29, kept verbatim — this is a LIVING checklist, not superseded) · Buffy · status: LIVING · branch: 0.0.24 -->
<!-- Scope: any .tsx modal/overlay component + its .css file in ui/src/features/ -->
<!-- Established from: retail POS audit (11 findings), feature-modal sweep (8 modals), PaymentModal audit (6 fixes) -->

## Quick mechanical check

Run these from the project root to surface most issues in one pass:

```bash
# 1. <button> used as overlay (anti-pattern)
grep -rn '<button[^>]*className="[^"]*overlay' ui/src/features/ --include="*.tsx"

# 2. Missing dialog semantics
grep -rn 'role="dialog"' ui/src/features/ --include="*.tsx" -l \
  | while read f; do
      grep -q 'aria-modal="true"' "$f" || echo "MISSING aria-modal: $f"
    done

# 3. Dialogs missing useFocusTrap
grep -rn 'aria-modal="true"' ui/src/features/ --include="*.tsx" -l \
  | while read f; do
      grep -q 'useFocusTrap' "$f" || echo "MISSING useFocusTrap: $f"
    done

# 4. Hardcoded colors with !important in modal CSS
grep -rn '#[0-9a-fA-F]\{3,6\}\|rgba\(' ui/src/features/ --include="*.css" \
  | grep '!important'

# 5. role="presentation" on backdrops (should be plain div)
grep -rn 'role="presentation"' ui/src/features/ --include="*.tsx"

# 6. role="button" on overlay divs (anti-pattern)
grep -rn 'role="button".*tabIndex' ui/src/features/ --include="*.tsx"

# 7. Touch targets below 44px (--space-8 = 32px is common offender)
grep -rn 'var(--space-8)' ui/src/features/ --include="*.css" \
  | grep -i 'close\|remove\|delete\|dismiss'
```

---

## 1. Dialog semantics (P1)

**What to check:**
- Every modal overlay must render as `<div role="dialog" aria-modal="true">` — never `<button>`, never plain `<div>`
- Must have a descriptive `aria-label` or `aria-labelledby`
- The backdrop (outer div) must be a plain `<div>` with an `onClick` handler, NOT `<button>`, NOT `role="button"`, NOT `role="presentation"`
- The inner modal content div must stop click propagation: `onClick={(e) => e.stopPropagation()}`

**Bad:**
```tsx
<button type="button" className="my-overlay" aria-label="Close" onClick={onClose}>
  <div className="my-modal" role="presentation" onClick={e => e.stopPropagation()}>
    {/* content */}
  </div>
</button>
```

**Good:**
```tsx
<div className="my-overlay" role="dialog" aria-modal="true" aria-label="Edit Item" onClick={onClose}>
  <div className="my-modal" onClick={e => e.stopPropagation()}>
    {/* content */}
  </div>
</div>
```

**Also bad (nested modal anti-pattern):**
```tsx
<div className="my-overlay" role="button" tabIndex={-1} aria-label="Close" onClick={onClose}>
  <div className="my-modal" role="dialog" aria-modal="true">...</div>
</div>
```

---

## 2. Focus trapping (P1)

**What to check:**
- Every `<div role="dialog" aria-modal="true">` must have `useFocusTrap` on its content div
- Import: `import { useFocusTrap } from '@/hooks/useFocusTrap';`
- Signature: `useFocusTrap(ref, activeCondition, closeCallback)`
- The `activeCondition` must account for exit animations: `shouldRender && !exiting`
- The `closeCallback` should use `requestClose()` or the component's close handler
- Ref goes on the modal content div, not the overlay

**Pattern:**
```tsx
import { useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const panelRef = useRef<HTMLDivElement>(null);
useFocusTrap(panelRef, isOpen && !exiting, onClose);

return (
  <div className="my-overlay" role="dialog" aria-modal="true" aria-label="..." onClick={onClose}>
    <div ref={panelRef} className="my-modal" onClick={e => e.stopPropagation()}>
      {/* content */}
    </div>
  </div>
);
```

**For standalone modals** (parent controls visibility by mounting/unmounting):
```tsx
useFocusTrap(panelRef, true, onClose); // always active while mounted
```

**For modals with exit animations** (useExitAnimation):
```tsx
useFocusTrap(panelRef, modalExit.shouldRender && !modalExit.exiting, modalExit.requestClose);
```

**Important:** If the component had a custom Escape `useEffect` + `handleKeyDown`, remove it — `useFocusTrap` handles Escape automatically.

---

## 3. Token compliance — no hardcoded colors (P1)

**What to check:**
- Zero hardcoded hex colors (`#xxx`), `rgb()`, or `rgba()` in CSS
- Zero `!important` modifiers on color-related properties
- All colors must reference CSS custom properties (tokens)

**Bad:**
```css
.my-overlay { background: rgba(0, 0, 0, 0.8) !important; }
.my-modal  {
  background: #111827 !important;
  border: 1px solid #374151 !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9) !important;
}
```

**Good:**
```css
.my-overlay { background: var(--color-pos-modal-overlay); }
.my-modal  {
  background: var(--color-pos-modal-bg);
  border: 1px solid var(--color-pos-modal-border);
  box-shadow: var(--color-pos-modal-shadow);
}
```

**Available modal tokens** (defined at `:root` in `ui/src/theme/tokens.css`, with light/dark/default variants):
| Token | Purpose |
|-------|---------|
| `--color-pos-modal-overlay` | Backdrop background |
| `--color-pos-modal-bg` | Modal surface background |
| `--color-pos-modal-border` | Modal border color |
| `--color-pos-modal-shadow` | Modal box-shadow |
| `--color-pos-modal-fg` | Modal text color |

**Verify tokens are globally available:**
```bash
grep -n "color-pos-modal-" ui/src/theme/tokens.css
```
All tokens should appear in `:root`, `[data-theme="light"]`, and `[data-theme="dark"]` blocks.

---

## 4. Touch targets — 44×44 CSS px minimum (P2)

**What to check:**
- All interactive buttons inside modals must have `min-width` and `min-height` of at least `var(--space-11)` (44px at 16px root)
- Add `display: inline-flex; align-items: center; justify-content: center;` so content stays centered

**Common offenders:**
- Close/dismiss buttons (×)
- Remove/delete buttons
- Split payment remove buttons
- Small action buttons

**Bad:**
```css
.close-btn {
  width: var(--space-8);   /* 32px */
  height: var(--space-8);
}
```

**Good:**
```css
.close-btn {
  min-width: var(--space-11);       /* 44px */
  min-height: var(--space-11);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

**WCAG reference:** SC 2.5.5 Target Size (Level AAA) — 44×44 CSS pixels. SC 2.5.8 (Level AA, newer) — 24×24 with spacing. Aim for 44px where layout permits.

---

## 5. Skip-to-content link (P2)

**What to check:**
- Every full-screen view (POS screen, sub-views) must have a skip link as the first focusable element
- Must be visually hidden off-screen, sliding into view on `:focus`
- Must target an `id` on the main content area

**CSS:**
```css
.skip-link {
  position: absolute;
  top: -100%;
  left: var(--space-2);
  z-index: 2000;
  padding: var(--space-2) var(--space-4);
  background: var(--color-primary-pos);
  color: var(--color-pos-on-primary);
  font-weight: var(--font-weight-bold);
  border-radius: var(--radius-sm);
  text-decoration: none;
}
.skip-link:focus { top: var(--space-1); }
.skip-link:focus-visible { outline: 2px solid var(--color-pos-on-primary); outline-offset: 2px; }
```

**TSX (in the main return, before the header):**
```tsx
<a href="#main-content" className="skip-link">
  {l10n.getString('skip-to-main') || 'Skip to main content'}
</a>
```

---

## 6. CSS class naming (P3)

**What to check:**
- Modal CSS classes should use semantic names that match their purpose
- Don't reuse classes from unrelated modals (e.g., credit list using `.retail-shift-modal`)
- Overlay/modal base styles should be in combined selector groups so all modals share them
- Each modal type gets its own `--exiting` variant class

**Pattern — combined base selectors:**
```css
.shift-overlay,
.discount-overlay,
.credit-overlay,
.clear-overlay,
.quick-return-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-pos-modal-overlay);
  /* ...shared styles */
}
```

**Pattern — exiting variants:**
```css
.shift-overlay--exiting,
.discount-overlay--exiting,
.credit-overlay--exiting {
  animation: modal-fade-out var(--duration-200) var(--ease-out) both;
  pointer-events: none;
}
```

**Also add new modal classes to the `prefers-reduced-motion: reduce` block.**

---

## 7. Backdrop dismissal (P2)

**What to check:**
- Clicking the overlay backdrop should close the modal
- This must be done via `onClick={onClose}` on the overlay div, NOT via a `<button>` wrapper
- The inner modal div must stop propagation to prevent clicks on modal content from closing

**Pattern:**
```tsx
<div className="my-overlay" onClick={onClose}>
  <div className="my-modal" onClick={e => e.stopPropagation()}>
    {/* clicking here does NOT close */}
  </div>
</div>
```

---

## 8. Escape key handling

**What to check:**
- Escape must close the topmost modal (not all modals)
- `useFocusTrap` handles this automatically — no custom Escape `useEffect` needed
- For nested modals (e.g., customer search inside payment modal), the parent trap must guard against double-fire:

```tsx
// Parent trap — only fires when nested modals are closed
useFocusTrap(panelRef, open && !leaving && !processing && !done, () => {
  if (!showCustomerSearch && !showQr) onClose();
});

// Nested trap — independent
useFocusTrap(nestedPanelRef, showCustomerSearch, () => setShowCustomerSearch(false));
```

- Remove any pre-existing `handleKeyDown` + `window.addEventListener('keydown', ...)` Escape handlers — they'll double-fire with `useFocusTrap`

---

## 9. Exit animations

**What to check:**
- Modals should have entry animations (fade-in + slide-up) and exit animations (fade-out + slide-down)
- Exit animations must disable `pointer-events` on the overlay during the exit phase
- `prefers-reduced-motion: reduce` must disable all animations
- Use `useExitAnimation` hook pattern or a state-machine approach (`leaving` state)

**CSS pattern:**
```css
.my-overlay { animation: modal-fade-in var(--duration-200) var(--ease-out); }
.my-modal   { animation: modal-slide-up var(--duration-200) var(--ease-out); }

.my-overlay--exiting {
  animation: modal-fade-out var(--duration-200) var(--ease-out) both;
  pointer-events: none;
}
.my-modal--exiting {
  animation: modal-slide-down var(--duration-200) var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .my-overlay, .my-modal, .my-overlay--exiting, .my-modal--exiting {
    animation: none;
  }
}
```

---

## 10. ARIA & i18n

**What to check:**
- Every interactive element has `aria-label` using `l10n.getString()` or `<Localized>` with fallback
- No hardcoded English strings in JSX — use `l10n.getString('key') || 'English fallback'`
- Modal title uses `aria-labelledby` pointing to a heading `id`, or `aria-label` with descriptive text
- The overlay itself should NOT have `aria-label="Close"` — that's the old button pattern

---

## 11. Edge cases & bugs

**What to check:**
- **Stale closures**: `useCallback`/`useEffect` deps must include all referenced state/props
- **Race conditions**: API calls in effects should use `AbortController` and check `signal.aborted` in `.then()`/`.catch()`
- **Ref memory leaks**: Sets/Maps used as caches (`pendingTrackFetchRef`) should be cleaned when their tracked items change
- **Double renders**: Multiple effects with overlapping dependency arrays may fire in sequence
- **Body scroll lock**: When a modal opens, `document.body.style.overflow` should be set to `hidden` and restored on close (handled by `useFocusTrap`)
- **Mutual exclusion**: Opening a second modal while one is already open can stack body-scroll locks — guard modal-opening callbacks with an `isAnyOverlayOpen()` check

---

## Audit runbook

1. **Run the mechanical checks** (section 0 above) — fix all grep hits
2. **Open each modal component** in `ui/src/features/**/*.tsx` and verify sections 1–10
3. **Open the corresponding CSS** and verify section 3 (token compliance) + section 4 (touch targets)
4. **Test keyboard**: Tab should cycle within the modal, Escape should close it
5. **Test screen reader**: Modal should be announced as a dialog with its aria-label
6. **Typecheck**: `cd ui && npm run typecheck` — must be clean
7. **Bundle parity**: `cd ui && npm run lint` (or commit — pre-commit hook runs `verify-bundle-parity`)

> last audited 29-09-26 by docs-auditor

