# The POS-to-KDS chain is closed: a completed sale appears on the board (round 141)

## The result

After three rounds of this chain failing at navigation, it works:

| Step | Result |
|---|---|
| KDS baseline | `#101 #104 #107 #110 #102 #105 #108 #103 #106 #109` — ten seeded tickets |
| Ctrl+Shift+Escape -> picker -> Restaurant POS | `GRID=27` |
| Complete a cash sale | `SALE_DONE=true` |
| Ctrl+Shift+Escape -> picker -> Kitchen Display | board now reads `... #111 #103 ...` |
| **New tickets** | **`#111`** |

No page reload at any point, so the mock's in-memory ticket survived — which is exactly what
rounds 138-140 could not achieve.

## Why the three previous rounds failed, in one line

`ui/src/app/AppShell.tsx:59-89` is the shortcut that returns to the workspace picker. Two
branches:

```ts
if (e.key === 'Escape') {
  if (isCommandModifier(e) && e.shiftKey) {
    consumeShortcut(e); onBack();          // Ctrl+Shift+Escape: ALWAYS
  } else if (... && active !== 'restaurant-pos') {
    consumeShortcut(e); onBack();          // plain Escape: NOT from restaurant-pos
  }
}
```

**Plain Escape is deliberately disabled in the restaurant workspace** (`:79`), which is why
round 137's Escape did nothing and round 140's next attempt inherited that failure. The
modifier branch at `:66` has no such guard and is documented as the escape hatch:

> *Ctrl+Shift+Escape (or Cmd+Shift+Escape on macOS) always returns to the picker, bypassing
> modals.*

So the route existed the whole time, guarded by a line that reads exactly like the reason it
looked absent. Three rounds of navigation failures came from not knowing which key owned the
exit.

## The one other thing that mattered

The picker's **card**, not the digit shortcut:

```js
page.getByTestId('workspace-card').filter({ hasText: /Restaurant POS/ })
```

A digit press from the picker worked on a fresh page load but not after a
`Ctrl+Shift+Escape` return, so the card click is the reliable input. `ui/e2e/helpers.ts:87`
`selectWorkspace` does the same and is the sanctioned form.

## What this closes

| Claim | Status |
|---|---|
| A restaurant sale completes in the browser | verified (round 140) |
| The mock mints a KDS ticket on sale completion | verified statically (rounds 138-139) |
| Production creates the ticket | verified (round 139, `kds.rs:464`, 38 Rust tests) |
| **The minted ticket appears on the KDS board** | **verified — `#111`, this round** |

The restaurant flow is now driven end to end in one browser session: menu -> cart -> charge ->
cash tender -> receipt -> workspace switch -> kitchen ticket.

## Verified

| Gate | Result |
|---|---|
| New ticket after the sale | `#111`; the other ten ids unchanged |
| Reloads used | **none** — required, since `mockKdsOrders` is page memory |
| Full suite | 12,665 passed, 0 failed |
| Tree | clean but for another lane's file; scratch script deleted; Vite stopped |