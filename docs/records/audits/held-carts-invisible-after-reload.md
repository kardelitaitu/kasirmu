# Held carts were invisible after a reload, and F4 silently took one over

**Round 23 · 2026-10-11 · retail POS · UI**

## How this was found

Round 22 closed the held-cart *replacement* class and ended by noting a suspicion:
that the shared `usePosState` mock returns an empty cart, so retail tests pressing
F4 were "silently exercising handleHold's early return". Chasing that suspicion led
somewhere other than expected, in three steps that are worth recording because two
of them were wrong.

**Wrong turn 1 — the role="status" hypothesis.** `RetailReminderPopup.tsx:43` gives
the popup `role="status" aria-live="polite"` while `:46-88` put three buttons inside
it. I hypothesised that a live region must not contain interactive controls and that
the buttons were therefore unreachable. Measured instead of assumed:

```
PROBE buttons-by-role= 4  names= ["retail-reminder-low-stock-aria", ...
PROBE dom-buttons= 4   statusEl= DIV  containsButtons= 4
```

All four buttons resolve by role, and ESLint is silent — so the "unreachable"
claim is false. `RetailCartPanel.tsx:368-378` uses the *identical* pattern for the
undo bar and a prior audit
(`2026-07-29-retail-pos-ux-audit.md:291`) cites it as a strength. This is a
deliberate repo-wide convention, and my recollection of the ARIA rule could not be
checked (web search returned HTTP 401 on its own endpoint). **Dropped rather than
pursued on an unverifiable premise.**

A crude structural count ("live region whose next 600 chars contain `<button>`")
returned 34 files, which is not a believable defect count — it matches across
element boundaries. Discarded rather than acted on.

**Wrong turn 2 — "every F4 test".** The round-22 note was too narrow.
`RetailPosScreen.tsx:1821` opens the held-carts list from the reminder popup with
`setShowHeldCartsList(true)`, bypassing `handleHold` entirely, so F4 is not the only
entry point. Corrected.

## The two real defects, both measured

### 1. Held carts were invisible after a reload

Probe on a freshly-rendered screen with **three held carts on the server**:

```
PROBE listCalls= 1  popupPresent= true  heldRow= false  anyReminderRow= 1
      lowStockRow= true
```

The server *was* queried (`listCalls=1` via the mount effect at :1373), but
`heldCartsList` stayed `[]`: that effect called `setHeldCartId(first.id)` and never
`setHeldCartsList`. The popup renders its held-cart row off `heldCartsList.length`
(:1817), so the **only affordance telling a cashier "there are carts on hold" could
not appear at the start of a shift** — precisely when it is needed.

### 2. F4 silently committed when the cashier meant to browse

```
PROBE2 singleHold deleteCalls= 0  getCalls= 1  listModalOpen= false  alerts= []
```

With a lone hold, F4's binding `if (heldCartId) handleResume(); else handleHold();`
(:1513) reached `handleResume`, whose `:1343-1345` auto-resumes a lone hold. Combined
with defect 1's mount effect — which sets `heldCartId` from the first hold on the
server — pressing F4 to *look* at held carts on a reloaded till loaded that hold
into the current sale with **no modal, no confirmation, and no toast**. Browsing had
become a committing action. This is the same hazard round 22 guarded against from
the other direction (a rejected delete reported as a success): the operator's intent
and the system's action diverge silently.

## The fixes

1. **Mount effect seeds the list**, not just the id: `setHeldCartsList(held)` — so
   the popup advertises the holds it has already fetched.
2. **F4 browses when the cart is empty.** The new order is
   `if (lines.length === 0) showHeldCartList(); else if (heldCartId) handleResume();
   else handleHold();`. With an empty cart there is nothing to hold and nothing to
   update, so F4 can only mean "show me the held carts". A new `showHeldCartList`
   callback opens the list without resuming anything; the auto-resume branch in
   `handleResume` now only runs on a genuine resume intent. The callback was added
   to the keydown effect's dependency array — omitting it would have been a
   stale-closure bug.

## Verification

Both tests were written failing-first and both failed on
`AssertionError: expected null not to be null` — the modal genuinely did not open.

**Both fixes were kill-tested**, because round 22 closed with a new test that
passed without any source change:

| Kill-test | Result |
|---|---|
| revert `setHeldCartsList(held)` on mount | test 1 goes **red** |
| revert the F4 browse gate | test 2 goes **red** |

Restored, and confirmed no `KILLTEST` marker remains in the source.

- `RetailPosScreenInteractions.test.tsx`: **44 passed**
- Related retail suites (RetailPosScreen, Checkout, ReminderPopup, CustomerSearch,
  ShortcutParity): **5 files / 84 passed**
- `npm run typecheck` clean; ESLint **0 errors** (1 pre-existing
  `react-refresh/only-export-components` warning, unrelated)

## Method notes

- Two of the three hypotheses in this round were wrong, and both were cheap to
  falsify by measurement. The expensive habit is not hypothesising; it is shipping
  on a hypothesis that a probe could have settled.
- The previous audit record called the popup's `aria-live` a *strength*, and it
  still passes lint. **A prior "audited, no findings" stamp is about the claims it
  actually tested**, not a blanket clearance — the held-cart row's *absence* was
  outside its scope.
- `heldCartsList` had exactly two writers (:1347, :1361) and neither ran on mount.
  Counting the writers of a piece of state — not the readers — is what exposed it.

> last audited 16-10-26 by docs-auditor
