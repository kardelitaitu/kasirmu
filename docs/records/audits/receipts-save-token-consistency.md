# The receipts Save pushed a task with an empty token, unlike its five siblings (round 164)

## How it was found

Round 163 found a defect by covering an unswept surface, so this round swept for the same
CLASS mechanically: every restaurant `.tsx` with BOTH a `disabled={…}` gate and an
`if (…) return;` guard, then compare what each protects. Fourteen files; the interesting hit
was `RestaurantReceiptsScreen.tsx`.

## The asymmetry

`handleSave` guarded its LATER tasks (`:1121` `if (sessionToken && receiptWorkspaceId)`, `:1143`
`if (sessionToken)`) but pushed its FIRST one with a fallback:

```ts
setReceiptSettingsScoped(sessionToken ?? '', { … });   // :1101
```

The file guards `!sessionToken` at five other sites (`:533`, `:806`, `:972`, `:1012`, `:1121`),
so this was the odd one out. With an empty token it fired a bogus
`set_receipt_settings_scoped('')` before the guarded tasks skipped.

## Reachability, checked before making a claim

Round 157's lesson was that an asymmetry can be closed upstream, so this was probed first:

```
SAVE_PRESENT=1
SAVE_DISABLED_ON_ARRIVAL=true        // dirty is false until an edit
```

and the dev mock's handler is `'set_receipt_settings_scoped': () => null` — it ignores the token
entirely, and **no mock handler validates one**. So the path is **not reachable through the UI
today**. Against the real backend an empty token is rejected, and a rejected task inside the
`Promise.all` would surface as a failed save for a form the operator never submitted — but that
is a future-shaped risk, not a present defect.

## What changed, described as what it is

Three code lines (the rest is comment):

| Change | Why |
|---|---|
| `if (!sessionToken) return;` at the top of `handleSave` | the file's own idiom, five times over |
| `sessionToken ?? ''` → `sessionToken` | with the guard, the fallback would only MASK a future regression |
| `… || !sessionToken` in the Save gate | the button can no longer arm a save the handler refuses |

## The kill-test SURVIVED, and that is the correct result

Removing the new guard leaves the suite at **12,680 passed** — because the guard protects a path
that cannot be reached. Recording this rather than presenting the change as a repaired bug is the
point: a surviving mutation here means **unreachable**, not **untested** (rounds 113-134's
standing distinction).

The spec therefore asserts only what IS reachable: Save inert on arrival, every switch reporting
`aria-checked`, and Save re-armed only by a real edit. It deliberately does not claim to kill the
token guard.

## Verified

| Item | Result |
|---|---|
| Probe | Save present, disabled on arrival; mock ignores the token |
| New spec | **2 passed** (desktop 3.1s, tablet 4.6s) |
| Kill-test | **survived** — the path is unreachable, stated as such |
| Code diff | 3 lines; the rest is the comment |
| Full UI suite | 12,680 passed |