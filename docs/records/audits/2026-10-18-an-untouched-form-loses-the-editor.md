# A real defect found, and deliberately not fixed — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 177 - status: 1 REAL POS defect found and
     fully characterised, fix NOT landed because the file is held by another lane; the
     Escape sweep CLEARED the other 6 cases - branch: 0.0.41 - commit: none -->

<!- - Scope: the carry-forward from round 176 — grep the suite for Escape-as-panel-closer. -->

## The sweep, and what it cleared

7 Escape presses exist in the whole suite. Read in context, **6 are correct** — each asserts the
true owner of the key, which turns out to be a different component in every case:

| spec | what Escape does | owner |
|---|---|---|
| `adr22-workspace-settings` | closes a real modal | the modal (useFocusTrap) |
| `restaurant-shortcuts-e2e` | closes the split-bill modal | the modal |
| `e2e-kds-critical-path` | clears the KDS ticket selection | KDS own handler |
| `narrow-shell` | dismisses the portrait sidebar overlay | AppLayout capture phase |
| `new-flows` | returns to the workspace picker | the shell (its stated job) |
| `restaurant-cart-portrait` | closes the cart sheet | verified green |

The 7th, `restaurant-menu-editor.spec.ts:69`, FAILS — and it is asserting the correct thing.

## The defect

The spec opens the item form, presses Escape, and asserts the EDITOR survives:

```js
// Escape must not leave the editor: the form is inside it, and a stray Escape that closes
// the whole screen would drop the operator back to a sale mid-edit.
await page.keyboard.press('Escape');
await expect(page.locator('[data-testid="restaurant-menu-editor-header"]')).toBeVisible();
```

Measured, that assertion is false. Escape on a form with **nothing typed**:

```
before  header=1  form=1  pos=0
after   header=0  form=0  pos=27   <- editor and form gone, back at the POS grid
```

And with a name typed the unsaved-changes dialog catches it (`header=1 form=1 dialogs=1`).
**So the gap only shows on an untouched form** — which is exactly when an operator presses Escape
to dismiss a form they decided not to fill in.

## The mechanism, traced to the component

Three probes, each ruling something out:

1. The menu editor HAS an Escape handler (`RestaurantMenuEditorScreen.tsx:883-898`) and it
   deliberately guards the case — but only via `closest('[role="dialog"]')`, and the item form
   is a plain `<form>` (`:1247`), so that guard never matches it.
2. I added the missing branch (close the form first, mirroring `cancelDraft`) — and the
   behaviour did NOT change for the fresh case.
3. So I instrumented the handler directly: **`handler log=[]` — it never runs.**

The real cause is one line in another component:

```js
PosScreen.tsx:1996    if (showMenuEditor) { setShowMenuEditor(false); return; }
```

PosScreen owns Escape for the restaurant workspace and its own comment says so — "Scope,
outermost first: a sub-screen (each of the seven is an early return below), then the sidebar
popover, then the dialogs." From PosScreen point of view the menu editor IS a sub-screen, so
Escape closes it. The editor own handler is attached and correct, but PosScreen branch fires
first and the editor is on its way out before its listener is reached.

**Both components are individually reasonable. The defect is the stacking order between them:**
a layer inside the editor (the item form) is not visible to the layer that actually owns the key.

## Why I did not fix it

The fix belongs in `PosScreen.tsx` — and that file is DIRTY, held by another lane (last
written ~40 minutes before this round, 66 insertions / 43 deletions in flight). A pathspec commit
would take the working-tree copy and **sweep in their 66 lines**, which the repo rules forbid
outright. I verified their hunks stop at `+605` — nowhere near `:1996` — so the change
itself is safe; it is the COMMIT that is not mine to make.

My own candidate fix (in the editor, which IS clean) was measured ineffective and reverted rather
than left in as a plausible-looking non-fix. That is the same discipline as round 172 contain
attempt: a change that does not move the measurement does not ship.

## What the next owner needs

The editor handler at `:883` is currently unreachable for the item form. Either:

1. `PosScreen.tsx:1996` should ask the editor whether it consumed the key, or
2. the editor should register its listener in the CAPTURE phase so it wins, or
3. the editor Escape handler should be given a way to signal upward that a nested layer is open.

Option 1 is the smallest and matches how `isAnyAriaModalOpen()` already works for modals.
The reproducing assertion already exists — `restaurant-menu-editor.spec.ts:60` fails today.

## Evidence

- All 7 Escape sites read in context; 6 run green when executed (`restaurant-cart-portrait` +
  `restaurant-menu-editor` -> 5 passed | 1 failed, the failure being the case above).
- The fresh-vs-dirty table is live measurement, as is the `header=0 form=0 pos=27` trace.
- `handler log=[]` is the probe that relocated the cause from the editor (where I was
  about to fix it) to PosScreen.
- **No production file changed.** Editor probe and candidate fix reverted; verified clean against
  HEAD. All scratch probes deleted (0 `zz-*` remain).

## Carried forward

1. This is an OPEN defect with a reproducing test. It should be fixed the moment
   `PosScreen.tsx` is clean, and that is worth re-checking every round until it is.
2. The generalisable finding, sharper than round 176: **two correct Escape handlers can still
   produce a wrong result, because ownership is decided by listener order rather than by layer
   depth.** A nested overlay invisible to the outer owner is silently un-dismissable.
3. The other 6 Escape sites are now cleared; do not re-sweep this class without a new reason.

> last audited 18-10-26 by docs-auditor
