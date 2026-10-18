# The round-177 Escape defect is FIXED, and my first two diagnoses were wrong — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 187 · status: the Escape defect open since
     round 177 is CLOSED; two wrong mechanisms were proposed and discarded before the real one
     · branch: 0.0.41 · commit: 8337dea2e -->

<!-- Scope: apply the round-177 fix, unblocked last round when PosScreen became clean. -->

## The defect, restated

Escape on an UNTOUCHED item form in the restaurant Menu Editor closed the whole editor and
dropped the operator back on the sales grid. With a dirty form the unsaved-changes dialog caught
it, so the hole showed exactly when someone pressed Escape to abandon a form they had decided not
to fill in. Reproduced before touching anything: `restaurant-menu-editor.spec.ts:60` red.

## Two wrong mechanisms, both measured out

**Diagnosis 1 — "PosScreen bubble listener wins the race."** I moved the editor handler to the
CAPTURE phase, which by DOM spec must fire first. The spec **still failed identically.** A probe
dispatching a synthetic Escape showed `prevented: false` — so the handler was not running,
which is what made capture look reasonable and was also the clue I misread.

**Diagnosis 2 — "the served bundle is stale."** Ruled out by fetching the module from inside the
browser: `hasCapture: true`, `hasDraftBranch: true`, and no bubble-only copy. Vite was
serving my change.

**Along the way I broke the file myself.** A string-replace intended to inject a probe deleted the
`const handler = (e: KeyboardEvent) => {` line, so two probe runs measured a syntactically
broken module. I noticed only because the header stopped rendering entirely. **A probe that
measures a broken build reports the build, not the product** — and I nearly recorded its result.

## The real mechanism, found by instrumenting the handler itself

One temporary `console.log` as the handler first statement settled it in a single run:

```
EDITOR_ESCAPE_RAN onBack=true draft=true
```

The handler ran. It had everything it needed. It called `cancelDraft()` — and the editor
**still disappeared.**

That is what the earlier `prevented: false` was telling me: the handler consumed the key
but never **claimed** it. Every branch returned without `stopPropagation()`, so the event
continued to PosScreen own Escape cascade at `:2000` — which saw `showMenuEditor` still
true in its closure, called `setShowMenuEditor(false)`, and tore the screen down.

**The claim is the stop, not the return.** Two correct handlers in a parent/child relation do not
compose by both being correct; the inner one has to say it is done. The round-177 note proposed
asking the editor whether it consumed the key — that was the right instinct, and capture alone was
only half of it, because being FIRST to see the key is not the same as being LAST to act on it.

## The fix

Two lines, added to the two branches that already meant to consume the key:

```ts
if (draft) {
  e.preventDefault();
  e.stopPropagation();   // <- without this the bubble cascade closes the editor anyway
  cancelDraft();
  return;
}
```

The same pair now guards the `categoryModal` branch, which had the identical latent bug: it
closed the modal and let the key travel on to close the screen behind it.

## Verified

| check | result |
|---|---|
| the reproducing spec | **2 passed** (was 1 failed) |
| the menu editor regression sweep, 8 spec files | **16 passed** |
| kill-test: strip just the new `stopPropagation` | spec goes **red** — the line is load-bearing |
| restore | byte-identical by sha256 (`ac1b262222104153`) |
| `npm run lint` / `typecheck` | 0 errors / clean |
| stray probes | none — `zz-*` removed, verified via `git ls-files --others` |

## What this closes, and the lesson worth keeping

This was the top open item in the objective for ten rounds, blocked first on another lane dirty
file and then, for one round, on my own caution about stacking it on a mistaken commit. It is now
fixed, tested, and kill-proved.

The transferable finding is about **event ownership between nested components**:

1. Capture phase decides WHO SEES the key first.
2. `stopPropagation()` decides WHO ELSE SEES IT AT ALL.

I fixed (1) and left (2), and the symptom was indistinguishable from the original bug. A handler
that returns early looks identical, from the outside, to a handler that never ran — and only
instrumenting the handler distinguished them. Three probes that observed the DOM state could
not tell the difference; the one probe that observed the code path could.

> last audited 18-10-26 by docs-auditor
