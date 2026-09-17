---
name: exit-animation-pattern
description: kasir.mu convention for symmetric CSS entry/exit animations + the React state machine that gates a dismiss through the CSS animation duration. Applies to pills, badges, banners, modals, and any in-flight overlay whose dismissal currently snaps to unmount. Use when adding a smooth fade-out sibling to an existing entry animation, or when reviewing a polish commit for the four required components.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2 — surface-classification row cited nonexistent commit 8d2c67b for payment-modal--exit symmetry; corrected to d6f3ae97, verified present in PaymentModal.css with mirrored slide-up keyframes) · verified this pass: ui/src/utils/animation.ts animDuration(ms) returns 0 under prefers-reduced-motion; commits fcf1d07 (undo-pill), 3dd919d (cousin-pos), 1fcb1dec (cousin-surfaces) all resolve; CSS classes pos-cart-undo-bar, pos-cart-line-wrap--exiting, pos-hold-modal, pos-close-shift-modal, pos-cart-hold-badge, pos-shift-error, payment-modal--exit all present under ui/src; relative links to ui files (../../../ui/…) and sibling skills (../) resolve · history: 31-08 docs-auditor fixed 5 broken relative links (three ui-file links ../../ui/… → ../../../ui/…, two sibling-skill links ./ → ../) -->

# Exit-Animation Pattern

The OZ-POS UI convention for dismissing UI elements gracefully. When an element enters with a CSS keyframe animation today, **its dismissal must run a mirror keyframe** rather than snapping to unmount. This skill packages the four moving parts (CSS mirror + `--exiting` class, React exiting flag, unmount-safe timer, race-safe cleanup) so you don't re-invent the wheel on each new surface.

Reference implementation: commit [`fcf1d07`](https://github.com/) on branch `0.0.3` — the undo-pill in [`ui/src/features/sales/PosScreen.tsx`](../../../ui/src/features/sales/PosScreen.tsx) and [`ui/src/features/sales/CartPanel.css`](../../../ui/src/features/sales/CartPanel.css).

## When to use

- A `useState` flag controls whether the element renders (`{flag && <Element />}`) and the dismiss handler currently snaps the flag to false.
- The element already has an entry animation (CSS keyframe). Symmetry is the goal.
- The animation is short (<300 ms) so a cashier perceives it as instant feedback.
- The dismiss handler is reachable from more than one place (e.g. an explicit `cancel` button **and** a "stack drained naturally" branch).

**Do not use** when:
- The element never disappears (a `+ Add Discount` button).
- The element's lifecycle is owned by a third-party library (`@radix-ui/dialog`).
- The dismissal triggers an IPC whose outcome depends on the DOM still being mounted (use a controlled prop instead).

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Mirror the existing entry keyframe exactly.** Reverse direction of every animated property (opacity, translate, scale). | Asymmetry reads as a bug ("did the wrong anim fire?"). |
| 2 | **CSS source order: entry rule → entry keyframe → exit keyframe → exit rule.** Same specificity, last wins. | The `.foo--exiting` rule's `animation: ...` overrides `.foo`'s `animation: ...` when both classes are present. |
| 3 | **`animation-fill-mode: both` on the exit rule.** | Locks the TO-frame across the React unmount so there is no `opacity: 1` flash between animation end and DOM removal. |
| 4 | **`pointer-events: none` on the `--exiting` rule.** | Blocks further clicks during the fade; the dismiss handler should already be done, but a stale click can double-fire callbacks. |
| 5 | **Use `animDuration(N)` for the JS timer, not a raw constant.** Returns `0` under `prefers-reduced-motion` so the fade snaps for users who suppress motion. | Consistent reduced-motion behavior across the project. |
| 6 | **Capture a snapshot of dismiss-time state; compare against live state by id-set in the timer body.** | Concurrent pushes during the 200 ms fade aren't silently wiped. |
| 7 | **`useRef<ReturnType<typeof setTimeout> \| null>` for the pending timer; clear it in an empty-deps `useEffect` cleanup.** | Never `setState` against an unmounted component. |
| 8 | **CSS rules live inside `@media (prefers-reduced-motion: no-preference)`.** | Element renders unmoving + functional in reduced-motion; JS still snaps cleanly via `animDuration() === 0`. |
| 9 | **Zero new design tokens.** Reuse `var(--duration-200)`, `var(--ease-out)`, `animDuration(N)` from [`@/utils/animation`](../../../ui/src/utils/animation.ts). | Token introduced = design-system drift; the project's tokens are the canonical source of truth. |
| 10 | **Mirror the closest sibling's shape, not a fresh invention.** If `<CartLineItem>` already uses exit-class + setTimeout, copy its shape; do not introduce a second convention. | Two patterns = downstream agents pick inconsistently. |

## The pattern: 4 components

A working exit animation is **all four** of these. If any is missing, the animation either snaps, leaves a flash, leaks a stale timer, or wipes concurrent state.

```
    ┌────────────────────────────────────────────┐
    │ CSS:  mirror keyframe + .foo--exiting rule │
    │       inside prefers-no-preference block   │
    └────────────────────────────────────────────┘
                          +
    ┌────────────────────────────────────────────┐
    │ React: useState exiting flag               │
    │        + conditional className on element  │
    └────────────────────────────────────────────┘
                          +
    ┌────────────────────────────────────────────┐
    │ React: useRef<timer> + useRef<snapshot>    │
    │        + empty-deps cleanup useEffect      │
    └────────────────────────────────────────────┘
                          +
    ┌────────────────────────────────────────────┐
    │ React: timer body uses id-set compare      │
    │        (race guard for concurrent ops)     │
    └────────────────────────────────────────────┘
```

## CSS portion

### Mirror keyframe

```css
@media (prefers-reduced-motion: no-preference) {
  /* Already-shipped entry rule + keyframe. */
  .pos-cart-undo-bar {
    animation: pos-cart-undo-in var(--duration-200) var(--ease-out);
  }
  @keyframes pos-cart-undo-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* New exit: invert opacity AND reverse translateY direction. */
  @keyframes pos-cart-undo-out {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(8px); }
  }

  /* Source order: entry rule → entry keyframe
                   → exit keyframe → exit rule.    */
  .pos-cart-undo-bar--exiting {
    animation: pos-cart-undo-out var(--duration-200) var(--ease-out) both;
    pointer-events: none;
  }
}
```

### Why `animation-fill-mode: both`?

React unmounts the element synchronously after the JS timer fires, but the next paint may be ~1 frame later. Without `fill-mode: both`, the element's computed style reverts to the non-animation default (`opacity: 1`) for that one frame — perceptible flash. With `fill-mode: both`, the TO-frame is locked until the element leaves the DOM.

### Source-order guarantee

Both `.foo` and `.foo--exiting` are single-class selectors (specificity 0,0,1,0). When both match the element, **the last rule in source order wins**. Always place the entry rule + keyframe first, then the exit keyframe, then the exit rule. If you need a different selector specificity (e.g. a nested `.parent .foo--exiting` rule is **more** specific), that wins regardless of source order — but stay on the simple two-class + source-order model for new work to keep the cascade predictable.

### Stay on `transform` + `opacity`

These are the only two compositor-friendly properties that don't cause reflow on every animation frame. Avoid animating `width`, `height`, `padding`, `top/left`, or `border` — they trigger layout, paint, and composite on every frame and will jank the cashier's tablet during rapid dismissal sequences.

## React portion

### 1. The exiting flag

```tsx
const [undoExiting, setUndoExiting] = useState(false);
```

Toggles immediately on dismiss (or on the equivalent state transition that should produce the fade). The className conditionally appends `--exiting`:

```tsx
<div
  className={`pos-cart-undo-bar${undoExiting ? ' pos-cart-undo-bar--exiting' : ''}`}
  role="status"
  aria-live="polite"
>
```

### 2. Live-mirror + snapshot + timer refs

```tsx
// Live-mirror: timer closure reads the post-snapshot value via this ref.
const undoStackRef = useRef<CartLine[]>(undoStack);
useEffect(() => {
  undoStackRef.current = undoStack;
}, [undoStack]);

// Holds dismiss-time snapshot + pending timer.
const undoExitSnapshotRef = useRef<CartLine[] | null>(null);
const undoExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

`useRef<ReturnType<typeof setTimeout> \| null>` works in both Node and browser without `import { Timeout } from 'node:timers'`.

### 3. Unmount cleanup effect

```tsx
// Cancel any pending exit timer on unmount — never setState against
// an unmounted component.
useEffect(() => {
  return () => {
    if (undoExitTimerRef.current !== null) {
      clearTimeout(undoExitTimerRef.current);
      undoExitTimerRef.current = null;
    }
  };
}, []);
```

Empty deps array → cleanup runs **only** on unmount. Refs don't trigger re-renders, so re-running on every `undoStack` change would be wasted work and would also kill the timer mid-animation if any future change adds state-related deps.

### 4. ID-set compare in the timer body

Naive:

```tsx
// DON'T:
const clear = () => {
  setUndoExiting(true);
  setTimeout(() => {
    setUndoStack([]);    // WIPES concurrent pushes from cart-line
    setUndoExiting(false); // removal during the fade. BAD.
  }, animDuration(200));
};
```

Race-safe:

```tsx
const clear = useCallback(() => {
  if (undoStack.length === 0) {
    setUndoExiting(false);
    return;
  }
  // Snapshot at dismiss so concurrent pushes during the fade
  // aren't silently wiped by the timer.
  undoExitSnapshotRef.current = undoStack;
  setUndoExiting(true);
  // Rapid re-dismiss: clear any stale timer before scheduling anew.
  if (undoExitTimerRef.current !== null) {
    clearTimeout(undoExitTimerRef.current);
  }
  undoExitTimerRef.current = setTimeout(() => {
    const liveStack = undoStackRef.current;
    const snapshot  = undoExitSnapshotRef.current;
    // Compare by id-set rather than ref equality because the cashier
    // can slice/push the live stack during the fade.
    const liveIds = new Set(liveStack.map((l) => l.id));
    const sameAsSnapshot =
      snapshot !== null &&
      liveIds.size === snapshot.length &&
      snapshot.every((l) => liveIds.has(l.id));
    if (sameAsSnapshot) {
      setUndoStack([]);
    }
    setUndoExiting(false);
    undoExitSnapshotRef.current = null;
    undoExitTimerRef.current = null;
  }, animDuration(200));
}, [undoStack, animDuration]);
```

### Scenario matrix

| User action during fade | Live state vs snapshot | Outcome |
|-------------------------|------------------------|---------|
| (nothing) | identical | clear as scheduled ✓ |
| User undoes one | smaller | `setUndoStack([])` is no-op (already empty); flag flips off ✓ |
| User removes another line via per-line X | larger / different `id`s | keep live stack, just retire visual exit ✓ |
| User dismisses twice in a row | second snapshot overwrites; old timer cleared via the `if (timer !== null) clearTimeout(...)` guard | second timer fires with new snapshot ✓ |
| User navigates away (PosScreen unmounts) | n/a | empty-deps cleanup effect clears the in-flight timer ✓ |

### 5. Reduced-motion handling

Imports the helper from `@/utils/animation`:

```tsx
import { animDuration } from '@/utils/animation';
```

`animDuration(200)` returns `0` under `prefers-reduced-motion: reduce`. Combined with the `@media (prefers-reduced-motion: no-preference)` gate on the CSS rule, the element renders unmoving while the JS timer fires on the next microtask, snapping the element away cleanly. **No additional `@media (prefers-reduced-motion: reduce)` block is needed.**

### 6. Borrow the existing pattern

If the same component family (e.g. `CartLineItem`) already has an `exiting` flag + `setTimeout`, **mirror its shape** rather than inventing a new one. The `CartLineItem` snippet below is the canonical reference:

```tsx
// Existing pattern in PosScreen.tsx::CartLineItem — copy the shape.
const MS_200 = animDuration(200);

useEffect(() => {
  if (!exiting) return;
  const timer = setTimeout(() => onRemove(line), MS_200);
  return () => clearTimeout(timer);
}, [exiting, onRemove, line.id]);
```

The `PosScreen` undo-bar uses `useRef` instead of `useEffect`-driven timer so it can survive rapid re-dismiss without double-firing; the `useRef` form is preferred when the dismiss handler is reachable from multiple branches.

## Token discipline

| Need | Reference | Why |
|------|-----------|-----|
| Duration | `var(--duration-200)` (CSS), `animDuration(200)` (JS) | They collapse to `0` under reduced-motion in `frontend/themes/tokens.css`. |
| Easing | `var(--ease-out)` | Project-wide standard; see [`ui-components`](../ui-components/SKILL.md) styling section. |
| `pointer-events` | inline `none` (CSS) | No token needed. |
| `clearTimeout` | browser built-in | No token. |

Do **not** introduce `--exit-animation-duration`, `--dismiss-fade`, or any variant — reuse the existing tokens. Touching the design tokens is a `feat(tokens)` change with its own review path, not a polish commit.

## Worked example (minimal scaffold)

Commit [`fcf1d07`](../../) on `0.0.3` is the reference. Two files changed:

- **`ui/src/features/sales/CartPanel.css`** (+19 lines in one block): mirror keyframe + `--exiting` rule appended inside the existing `@media (prefers-reduced-motion: no-preference)` block, after the existing entry rule + keyframe.
- **`ui/src/features/sales/PosScreen.tsx`** (+91 / −5): `useState exiting` flag + `clearUndoStackAnimated` helper + unmount cleanup effect + JSX className toggle, plus live-mirror ref and snapshot ref for race-safety.

For the full diff, run from project root:

```bash
git show fcf1d07 -- ui/src/features/sales/PosScreen.tsx ui/src/features/sales/CartPanel.css
```

## Anti-patterns

1. **Setting `animation-duration` inline on the element rather than via `@keyframes`.** Loses the benefit of `@media (prefers-reduced-motion: no-preference)` gating — motion collapses only if you read the duration from a CSS variable.
2. **Forgetting `pointer-events: none` on the exiting rule.** Cashier can click the button mid-fade; the click handler fires, the dismissal animation continues, and you get a double state update race in user-land.
3. **`setTimeout` without cleanup.** When the cashier navigates away mid-animation, the timer fires against an unmounted component → React 18 silently swallows it, but it's still a lint smell and breaks under React strict-mode double-mount.
4. **Reading `undoStack` directly in the timer's closure instead of via `undoStackRef`.** The closure captures the dismiss-time value; a push made during the fade is invisible to the closure.
5. **Naive `setUndoStack([])` in the timer without id-set compare.** Wipes concurrent pushes. This is the bug this entire pattern exists to avoid.
6. **Asymmetric exit (e.g. fade only opacity, doesn't reverse translateY).** Reads as "the wrong animation fired". The exit must be the **exact reverse** of the entry across every animated property.
7. **Forgetting `animation-fill-mode: both`.** Element reverts to non-animation style for one frame after the animation completes → perceptible opacity flash on exit.
8. **Introducing a new motion token (`--exiting-duration`).** Always reuse `var(--duration-NNN)`.
9. **Placing the exit rule BEFORE the entry rule in the cascade.** Same specificity, source-order loses. Entry wins and the element fades in on every render of the still-mounted `exiting=true` element.
10. **Animating a layout-affecting property (`width`, `height`, `padding`).** Causes reflow on every frame. Stay on `transform` + `opacity`.
11. **Mounting the exit class on a parent that survives.** If `--exiting` lives on a parent that stays mounted after the actual child unmounts, you have a phantom animation. Put the class on the same element whose JSX is conditionally rendered.
12. **Calling preventDefault inside the dismiss handler without re-running through queueMicrotask.** Mixing synchronous `setState` with imperative DOM calls in the same handler creates microtask race. Let React commit first, then act imperatively.

## Surface classification

| Surface | Currently snaps? | Apply this pattern? |
|---------|------------------|---------------------|
| Modal entry/exit (`.pos-hold-modal`, `.pos-close-shift-modal`, etc.) | partial — entry has slide-up, exit has none | **YES** — same approach with overlay + panel roles |
| `pos-cart-hold-badge` | n/a — never unmounts while held orders exist | NO (badge is persistent; consider hover/lift instead) |
| Toast notifications (`useToast`) | YES (snap to dismiss) | **YES** — exact same shape |
| Banner notifications (`.pos-shift-error`) | YES (instant disappear on X click) | **YES** |
| Animated success confirmations (price-flip on shift close) | n/a — only appear, never disappear | NO |
| `pos-cart-line-wrap--exiting` (existing on `<CartLineItem>`) | already uses `exiting` + timer pattern | follow this skill's rules 1–3 and 6 |
| `payment-modal--exit` (already shipping) | symmetric with `--enter` since commit `d6f3ae97` | reference for modal-scale variant |

Future work that introduces dismissals with no entry (rare) does **not** need this pattern — just snap unmount.

## Verification checklist

Before opening the PR:

- [ ] Mirror keyframe is the **exact reverse** of the entry.
- [ ] CSS source order: entry rule → entry keyframe → exit keyframe → exit rule.
- [ ] `--exiting` rule has `animation-fill-mode: both` and `pointer-events: none`.
- [ ] Both rules live inside `@media (prefers-reduced-motion: no-preference)`.
- [ ] React: `useState exiting` flag + conditional className.
- [ ] React: `useRef timer` + `useRef snapshot` (or `useEffect`-driven timer if family already does it that way).
- [ ] React: empty-deps `useEffect` cleanup clears the timer on unmount.
- [ ] React: timer body uses id-set compare, not naive `setX([])` wipe.
- [ ] React: uses `animDuration(N)`, not hardcoded ms.
- [ ] No new CSS variables, no new colors, no new easings.
- [ ] vitest for the affected screen passes.
- [ ] Manual browser sanity: dismiss, then immediately try to click the fading pill button → no-op (pointer-events: none).
- [ ] Manual reduced-motion sanity (Chrome DevTools "Emulate CSS prefers-reduced-motion: reduce"): pill snaps away cleanly with no flash.

## Cross-references

- **[`ui-components`](../ui-components/SKILL.md)** — front-end conventions (i18n, accessibility, strict TS, styling). Read first before reaching for new files or tokens.
- **[`skill-drift-guard`](../skill-drift-guard/SKILL.md)** — run after committing if the change renames a CSS class referenced here, or after this skill itself is touched (re-audit the footer format).
- **Polish commits on branch `0.0.3`** that exemplify the baseline this skill codifies:
  - `3dd919d` — `feat(ui): cousin-pos visual polish` — modal entry cohesion (overlay fade + panel slide-up on `PosScreen`).
  - `1fcb1d` — `feat(ui): cousin-surfaces polish sweep` — modal cohesion on `SalesHistoryScreen` + focus/hover/empty-state work across 5 sibling files.
  - `fcf1d07` — `feat(ui): undo-pill exit animation` — this skill's reference implementation (the undo-pill exit).

When the next polish pass lands, the contributor should be able to point at this skill in the PR description and the commit message, so the review can validate against a single source.

## Common pitfalls (consolidated)

1. **Snap dismissal produces a visible "pop".** Apply the pattern. Don't accept snap dismissals anywhere a cashier can see.
2. **Mirror keyframes manually instead of reflexive.** Reversing `transform: translateY(8px)` direction is not enough — reverse **all** animated properties together. Forgetting one (typically `opacity`) breaks the symmetry.
3. **Empty-deps `useEffect` cleanup.** If you need to clear a ref-based timer on unmount, the cleanup must run **only** on unmount — empty deps. Any deps that change mid-animation will trigger cleanup mid-fade and the timer will be cancelled while the user is mid-action.
4. **`useCallback` recreates the dismiss handler per render.** If the dismiss handler is passed as a prop, the receiving component will re-render. Either memoize the receiving component or pass the handler via a stable ref. The reference commit handles this by colocating state + handler in the same screen.
5. **In-flight async dismiss handlers.** If the dismiss triggers an IPC call (`holdCart`, `pay` etc.), the in-flight promise may still resolve after the element unmounts. The IPC wrappers under `@/api/*` already handle this — don't add an additional guard inside the pattern.
6. **React strict-mode double-mount.** React 18 strict mode mounts components twice in dev. Without unmount cleanup, the first timer survives the second mount and you see duplicate unmounts in dev only. Always clear on unmount.

> last audited 03-09-26 by DSH
