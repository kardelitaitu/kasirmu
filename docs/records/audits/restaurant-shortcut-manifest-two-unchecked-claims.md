# The restaurant shortcut manifest could lie in two ways it was never checked against

**Round 24 · 2026-10-11 · restaurant POS · UI**

## Where this came from

Round 23's fix made F4 a browse gesture on the retail till. The stated next target was
the restaurant POS, on the suspicion that the same browse-vs-commit ambiguity lived
there. Tracing it led to `features/restaurant/restaurantShortcuts.ts` — a manifest
with a parity test that already looked thorough.

## What the existing parity test actually proves

`restaurantShortcutParity.test.ts` claims three things, and all three are real:

1. no key is bound twice (a duplicate is silently dead — the hook returns at the
   first match);
2. no key collides with a retail binding or AppShell's global F10;
3. every advertised action appears in the hook's `RestaurantShortcutHandlers` interface.

Claim 3 is the interesting one. It parses the **hook's interface** — which states what
the hook *can* run — and compares that against the manifest. That is a genuine check
and it passes. But it is not the claim a reader would assume. Two things fall outside
it, and neither had any other coverage.

## Gap 1 — `editableGuard` was a dead field and the header said otherwise

`useRestaurantShortcuts.ts:43` read:

```ts
if (isEditableTarget(e.target)) return;   // blanket
```

while the manifest declares a **per-entry** `editableGuard` and this file's own header
claimed *"Suppressed while an editable target has focus, per the manifest's
`editableGuard`"*. The field was never read — `grep editableGuard` over the hook
matched only that comment. Its sibling `WarehouseConsole.tsx:249` does read it:

```ts
if (typing && WAREHOUSE_SHORTCUTS.find((x) => x.action === action)?.editableGuard) return;
```

**Measured scope:** all five restaurant entries are `editableGuard: true`, so the dead
field and the blanket guard agreed perfectly. This is therefore a *latent* divergence
and a false comment, not an active bug — and I am recording it as such rather than
dressing it up. The failure it was waiting for: the first `editableGuard: false` entry
(a bare key meant to work while typing) would have been silently suppressed forever,
with the manifest insisting otherwise.

Fixed to read the flag per entry, matching the warehouse contract. Guard semantics
verified by probe before and after: both keys fire when not typing, both are
suppressed while typing.

## Gap 2 — nothing checked that PosScreen supplies the handlers

Claim 3 parses the hook's interface, which says what the hook *can* run — **not what
`PosScreen` passes it**. `PosScreen.tsx:1631-1645` builds the handler object in a
`useMemo`; a missing or misspelled key there would leave claim 3 green while the key
`preventDefault`s and then does nothing, with the help overlay still advertising it.

Verified this was genuinely uncovered: `grep` for `useRestaurantShortcuts`,
`RESTAURANT_SHORTCUT` and the action names across `ui/src/__tests__` found the hook
referenced **only** by the parity test — no test ever fires a restaurant shortcut
through `PosScreen`. The restaurant till's entire keyboard surface had no
end-to-end assertion.

A second claim now parses PosScreen's handler object and requires every advertised
action to be present.

## Verification

Both new claims were **kill-tested**, because a test written after the code it checks
is a test that has never been seen to fail:

| Kill-test | Result |
|---|---|
| revert the hook to the blanket `if (typing) return;` | claim 4 → **red** |
| rename a key in PosScreen's handler object | claim 5 → **red** |

Restored; no `KILLTEST` marker remains. The regex in claim 5 was then rewritten to
satisfy `no-regex-spaces` and **re-kill-tested**, since a rewritten matcher is a new
matcher that might no longer match anything — it still goes red.

- `restaurantShortcutParity.test.ts`: **6 passed** (4 existing + 2 new)
- POS + shortcut + cart suites: **6 files / 174 passed, 1 skipped**
- `npm run typecheck` clean; ESLint **0 errors**

## Method notes

- **"Every advertised key reaches a real handler" was true of the interface and false
  of the wiring.** The test's own phrasing was broader than its assertion. Reading what
  a guard *reads* — here, that claim 3 parses the hook and never PosScreen — is what
  separated the two.
- A manifest field that no code reads is worse than a missing one: it documents an
  intent the code does not implement, and it will be believed. `editableGuard` had a
  comment asserting it was honoured, which is how it survived.
- Both findings are latent rather than active. Saying so is the point: the previous
  round's lesson was that a plausible mechanism is not a measured one, and the honest
  scope here is "the guard cannot currently be fooled", not "the till was broken".
- A usable pattern for this tree: `grep` a validator's key phrase against the file it
  claims to validate. Claim 3 named the hook, so PosScreen was outside it by
  construction.

> last audited 16-10-26 by docs-auditor
