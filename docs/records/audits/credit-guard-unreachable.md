# Correcting round 114: the credit guard is UNREACHABLE, and the withdrawal was untested (round 115)

## The correction

`credit-rail-guard-unpinned.md` (round 114) measured that removing `PaymentModal.tsx:1160`
(`if (!creditOffered) return false;`) leaves the suite green, and concluded it was
"the only thing covering" a one-render window — a live last line of defence.

**That is wrong. The guard guards an unreachable state.**

| Step | Evidence |
|---|---|
| `method` starts as `'cash'` | `PaymentModal.tsx:162` |
| `setMethod('credit')` appears NOWHERE | every `setMethod(` call read: `:339`, `:351`, `:371`, `:409`, `:2270`, `:2309`, `:2320`, `:2335`, `:2355` — the only credit path is `:2270` |
| that path is the radio at `:2270`, inside a filter that removes credit when the rail is off | `:2258` `.filter((m) => m !== 'credit' || creditOffered)` |
| `creditOffered` cannot change during the modal's life | `useLocalPaymentRails` re-reads only on `sessionToken` or an internal `nonce` (`:267`), neither drivable from outside |

So `method === 'credit' && !creditOffered` is not producible from the public surface. Round
114's *"one render wide"* reading misidentified the mechanism: there is no window, because
there is no transition.

## What WAS untested, and is now pinned

The **withdrawal** — that a rail row with `is_enabled: false` removes the credit tender
(`:2258`). No test covered it, for the setup reason round 114 identified:
`PaymentModal.test.tsx` does not mock the rails source, so `rails` is `null` and
`coreRailWithheld` fails open (`rails === null || rails.length === 0`,
`useLocalPaymentRails.ts:78`).

`creditRailWithheld.test.tsx` supplies that source: it mocks `@/api/local-payment`'s two
IPC reads so a rail row can be returned switched off.

| Case | Killed by |
|---|---|
| no credit row -> credit still offered (fail open) | precondition |
| `is_enabled: false` -> credit NOT offered | neutralising the `:2258` filter |

## Two mistakes of mine on the way

1. **I mocked the wrong module.** The hook imports `@/api/local-payment` (singular); my
   first attempt mocked `@/api/localPayments`, so the real module loaded, `creditOffered`
   stayed true, and my case failed against a fixture that never applied. Found by probing
   the rendered radios (`["cash","card","qris","credit","other"]` — credit present when
   it should not have been).
2. **Repeated line splicing mangled the file**, leaving an orphaned fragment and an
   unbalanced brace. Rewriting the file whole was faster and safer than more surgery.

## The generalisable point

Round 114 asked *"is this guard pinned?"* and answered *"no"*, then inferred *"so it must
matter"*. The second step did not follow. **A mutation surviving can mean the code is
unreachable rather than untested**, and the two call for different responses: pin it, or
delete it. This round pinned the reachable behaviour and recorded that the guard itself is
structural redundancy that the filter already covers.

## Verified

| Gate | Result |
|---|---|
| New file | 2 passed; the withdrawal case fails when `:2258` is neutralised |
| Full suite | 12,656 passed, 0 failed (+2) |
| `tsc` / `eslint` | 0 / 0 |
| `PaymentModal.tsx` | restored; `scratch-kill.py` deleted; tree clean but for another lane |