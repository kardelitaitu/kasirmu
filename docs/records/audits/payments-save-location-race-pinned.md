# Round 156's third finding was a false alarm, and it is now pinned (round 157)

## The claim under test

Round 156 ended with a finding it had no test for: `handleSave` guards on
`if (!sessionToken || !locationId) return;` (`RestaurantPaymentsScreen.tsx:740`) while the Save
button is disabled by `!dirty || saving || loadFailed` (`:997`). `locationId` appears in neither
of those, so the two looked to disagree — Save clickable, the save silently doing nothing, the
same shape as F40.

**It was wrong, and the reason is one screen further down.** The header, Save button included,
is inside `{!loading && …}` (`:976`), and `locationId` is resolved *inside the same `loadAll`*
that clears `loading` (`getPrimaryLocationScoped` at `:374`, `setLoading(false)` at `:540`). So the
header cannot mount before the location exists. The silent return is **unreachable through the
UI**.

## Why a closed hole still earns a test

What makes the claim true is an **ordering**, not a line number: that `locationId` resolves in the
same load pass that clears `loading`. Two refactors reopen it, and neither looks dangerous:

* lifting the header out of the `!loading` branch so it can render a save affordance during the
  load;
* resolving the location in a second effect, which reopens the window no matter how the header is
  gated.

`ui/src/__tests__/paymentsSaveLocationRace.test.tsx` holds `getPrimaryLocationScoped` open
forever and asserts Save is not on screen, then resolves it and asserts Save appears — so it
catches both, and the second assertion stops it passing on a blank screen.

**Kill-tested:** replacing `!loading` with `true` at `:976` fails it with the message written for
the case — *"Save must not be reachable before the location resolves"*. Restored, file verified
byte-identical to HEAD.

## A note on how the test is wired

The screen takes **no `sessionToken` prop** — it reads `useWorkspace()`, which
`ui/src/test-setup.ts:145` mocks globally with `HARNESS_SESSION_TOKEN`. So the harness is the
global stub plus `ToastProvider`; the test only replaces `@/api/locations`.

## The pattern this is the third instance of

Round 151 (the 86 list's `unavailable` comment), round 154 (a citation citing a file that had
moved), and now round 156's `locationId` finding were all **one node in a file being stale or
wrongly read**, with the code around it correct. In each case the round's real deliverable is the
corrected statement or the pin — not a fix — because there was no defect to fix.

## Verified

| Item | Result |
|---|---|
| Race test | **1 passed** |
| Kill-test (`{true && (` at `:976`) | **fails** with the message written for it |
| `RestaurantPaymentsScreen.tsx` | identical to HEAD |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,672 passed, 0 failed |