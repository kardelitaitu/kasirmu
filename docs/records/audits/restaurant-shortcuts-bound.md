# The shortcut manifest is bound to the till, restaurant-only (round 159)

## What round 158 left open

The manifest existed and was parity-tested, but nothing consumed it, so the keys did nothing.
Wiring was deferred because the target is `PosScreen`, shared with the retail till.

## The gate that decided the design

`activeWorkspace === 'restaurant-pos'` is this screen's established restaurant idiom (eight
uses: `:395`, `:586`, `:1312`, `:1811`, …), and `PosScreen` has **no** workspace prop. So the
handler object is built per-active-workspace and is **empty** on retail — none of the five keys
exists there, which is what makes this safe on a shared component.

## Every action routes through an existing handler

| Key | Path | Why that path |
|---|---|---|
| `Shift+K` | `handleSendToKitchen` | self-guards on session/lines/undelivered delta (`:1042-1052`) |
| `Shift+P` | `handlePrintBill` | self-guards on lines/total/session (`:845-850`) |
| `Shift+B` | `setShowSplitBillModal(true)` | opens the MODAL, so the dine-in-only rule in `handleConfirmSplitBill` (`:884`) still applies |
| `Shift+L` | `setShowTables(true)` | the sidebar row's own action, already feature-gated |
| `Shift+T` | claims `pos-cart-save-tab-btn` and clicks it | see below |

**Save Tab is the one indirection, and it is deliberate.** Its precondition chain — the shift
guard's toast, then the branch that opens the open-bill INPUT when no table or name is recorded
— was inline in `CartActionBar`'s `onClick`. Rather than copy it (and let the copy drift), the
chain was **extracted to `handleSaveTabClick`**, which the button now calls, and the shortcut
clicks the button. Both reach the same code, including the guard that stops a tab being saved
with no table.

## Three mistakes, each caught by a gate

1. **`verify-bundle-parity` refused the source commit** — five label ids with no translation.
   Added to both `.ftl` bundles before the source could land.
2. **`eslint` refused the placement twice.** `react-hooks/rules-of-hooks` fired at the first
   placement and again after the first move, because `PosScreen` has **eight** early
   `return (` statements between `:1505` and `:1627` for its sub-screens, and a hook after any
   of them is conditional by construction. Both times the lint named the rule and the line.
3. **The suite caught the third**, before the hook was moved: 9 failures from the same cause.

A detail worth recording from the first move: `grep '^  return'` found **zero** returns before
the hook, which was misleading — the sub-screen returns sit at **four**-space indent inside
their `if` blocks. The reliable finder was listing every `^\s+return\s*\($` after the
component's opening line.

## Verified

| Gate | Result |
|---|---|
| `eslint` (PosScreen, CartActionBar) | 0 errors |
| `tsc` | clean |
| `verify-bundle-parity` | 0 missing keys |
| Full UI suite | 12,678 passed, 0 failed |
| Hook placement | `:1504-1539`, before the first sub-screen return at `:1542` |
| Retail effect | handler object empty — no keys bound outside `restaurant-pos` |
| Diff | `PosScreen.tsx` +38, `CartActionBar.tsx` +48/-14, comments included |