# The menu editor's Save did nothing on a blank name, and never said so (round 163)

## The gap that led to it

Round 149 covered the sidebar ROUTE to the Menu Editor. Rounds 126 and 138 drove the editor
by hand. No spec exercised its **item form** — the part an operator uses to change what the
kitchen can sell — and the screen carries 21 testids none of them touched.

## The defect, measured before the fix

`New Item` opens the form seeded from `EMPTY_DRAFT` (`:244-253`), whose `name` is `''`. The
Save button gated on `!draft || saving` only (`:983`), while `handleSaveDraft` begins:

```ts
if (!draft || !sessionToken || !draft.name.trim()) return;   // :641
```

So Save rendered **enabled** beside an empty required field. Probed live on 2026-10-14:

```
NAME_VALUE=""
SAVE_DISABLED=false
FORM_STILL_OPEN=1        // after clicking Save
TOASTS=[]
```

No request, no toast, no state change. **The operator taps Save and the till does nothing
without saying why** — F40's shape on a different screen.

## The fix

One code line:

```diff
-            disabled={!draft || saving}
+            disabled={!draft || saving || !draft.name.trim()}
```

Disabled rather than validated-on-click, and the expression **matches the handler's own test**,
so the button can never be armed for a save the handler would refuse. Eleven lines of comment
record the measurement and the reasoning; the diff is 12 insertions and 1 deletion
(re-counted 2026-10-14: `git show c6ab59a65 -- …RestaurantMenuEditorScreen.tsx | grep -c '^+.*//'` → 11).

## Covered, and kill-tested

`ui/e2e/restaurant-menu-editor.spec.ts` — **4 passed**, desktop and tablet:

| Assertion | Why it is that one |
|---|---|
| blank name → Save disabled | the defect's exact state |
| typing a name → Save enabled | proves the gate is the NAME, not something incidental |
| whitespace only → Save disabled | a space would otherwise arm a save the handler `trim()`s away |
| Escape keeps the editor mounted | a stray Escape that closed the screen would drop the operator into a sale mid-edit |

**Kill-tested**: reverting the gate to `!draft || saving` fails the case on both projects.

## Verified

| Item | Result |
|---|---|
| Probe before | `SAVE_DISABLED=false`, no toast, form unchanged |
| Probe after | `SAVE_DISABLED=true` |
| New spec | **4 passed** |
| Kill-test | **2 failed** (both projects) |
| Code diff | one line; the rest is the comment |
| Full UI suite | 12,680 passed |

> last audited 14-10-26 by docs-auditor
