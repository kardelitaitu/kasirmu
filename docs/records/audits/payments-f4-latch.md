# The payments F4 latch, and a red suite that was not mine (round 227)

## What the spec pins — 4 passed, both projects

The payments screen is the weakest restaurant surface, and its uncovered set is mostly
credential forms — but `restaurant-payments-load-error` and its retry are the F4 guard, the
same shape round 223 proved valuable on receipts.

The screen's own comment states the defect it prevents (`:470-474`):

> these two used to `.catch(() => null)` INDEPENDENTLY, which swallowed a failed read. Combined
> with the `if (midtransGw)` / `if (stripeGw)` guards and the baseline seeded before this point,
> a failure left the screen looking CLEAN while showing empty fields — so saving wrote the
> BLANKS over the stored credentials.

And the latch (`:987-988`):

> F4: the read failed, so the values shown are defaults. Without Retry the flag is a one-way
> latch and Save could never return this session.

| Case | Asserts |
|---|---|
| the failure | the banner is visible with `role="alert"`, **Save stays DISABLED**, and Retry is offered |
| the retry | clearing the injection and pressing Retry clears the banner |

The Save assertion is the substantive one, and it is the F4 property exactly: with empty
credential fields on screen and a clean-looking form, an armed Save writes those blanks over the
stored keys. `dirty` is false because the baseline is seeded, so a screen that LOOKED clean would
have enabled it.

## One claim binds, one has a stated limit

| Mutation | Result |
|---|---|
| the retry stops bumping `reloadNonce` | **both cases fail** — binds |
| the midtrans read catches silently again | **SURVIVES** |

The second survives because **both** gateway reads set the flag, and the injection seam matches
by command NAME only (`mockDispatcher.ts:126-134`) — there is no per-args granularity, so failing
`get_payment_gateway_config_scoped` fails midtrans and stripe together. My case cannot isolate
one gateway's guard from the other's.

Recorded rather than papered over. Isolating it would need the seam to accept an args predicate,
which is a change to a shared fixture — and round 193's rule applies: **a spec's need is not a
licence to change shared state.**

## The suite went red, and it was not mine

The full run reported `1 failed | 12708 passed`, in `TableManagementScreen.test.tsx` —
*"moves focus into the dialog when opened (TBL-06)"*. I had not touched that file this round, and
every kill-test restore had been verified byte-identical to HEAD.

Checking the tree:

```
SCREEN_DIFFERS      ui/src/features/tables/TableManagementScreen.tsx
ui/src/features/tables/TableManagementScreen.css   |  93 ++++
ui/src/features/tables/TableManagementScreen.tsx    | 342 +++++++++++
```

**Another lane is mid-flight on a table-reservation feature** — 432 added lines, uncommitted.
Its new dialog changes the focus behaviour TBL-06 asserts, so the test is red for a reason "that
has nothing to do with this round.

That is a shared-checkout fact rather than a defect to fix, and the response is the one AGENTS.md
§7.3 prescribes: **commit only my own paths.**

```
git add -- ui/e2e/restaurant-payments-load-failure.spec.ts
git commit -m 'test(e2e): cover the payments F4 load failure and its one-way latch' \
  -- ui/e2e/restaurant-payments-load-failure.spec.ts
```

`git show --stat` confirms **one file, 85 insertions** — none of the other lane's work swept in.

## The durable lesson

**A red test in a shared checkout is not evidence about your change until you have checked whose
file it is.** The instinct on seeing `1 failed` is to look for one's own mistake; the first
question is whether the failing surface is even one this round touched. `git hash-object` against
`git show HEAD:<path>` answers it in one call, and it is the same instrument the earlier rounds
used for their kill-test restores.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-tests | 1 binds, 1 documented as not isolable |
| `RestaurantPaymentsScreen.tsx` | unchanged, byte-identical to HEAD |
| Commit | 1 file, 85 insertions — no other lane's work |
| Full UI suite | 12,708 passed, 1 failed in ANOTHER LANE's in-flight file |