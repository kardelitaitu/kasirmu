# The mock's feature vocabulary is wrong, and the cost is now measured (round 131)

## Already known in-tree

`ui/src/__tests__/dev-mock-preset-features.test.ts:115-118` states the defect in a test
comment, written by whoever added that file:

> *The placeholder drift this catches is real and already present beside it: the
> `get_enabled_features` handler above answers with `['sales', 'inventory', ...]`, which are
> **NOT feature keys**.*

So rounds 129-130 did not discover this. What they add is the measurement the comment does not
make, which is what the repair decisions need.

## The precise defect: wrong vocabulary, not a stale preset

The mock's answer is `['sales','inventory','reporting','staff','settings']`. Against the 39
values in `FEATURES`:

| Mock key | Is a `FEATURES` value? |
|---|---|
| `sales` | **no** |
| `inventory` | **no** |
| `reporting` | yes |
| `staff` | **no** |
| `settings` | **no** |

Four of five are domain/module names. `reporting` coincides, which is why the mismatch is not
obviously total from a glance.

## The measured cost

**1 of 39 consumed feature values is enabled in the preview** (`reporting`, by coincidence).
Every other `isEnabled(FEATURES.X)` returns `false`: `kitchen-display`, `table-management`,
`discount-engine`, `receipt-printing`, `tax-engine`, `cash-payment`, `barcode-scanning`,
`categories-enabled`, `restaurant`, `staff-login` and the rest — 35 keys take their disabled
branch in the browser preview and in E2E.

That is larger than round 129's "10 of 10 restaurant features off": it is every feature in
the product except one.

## Round 130's stated blocker, re-measured

It said fixing this "changes which surfaces the preview and the E2E specs exercise", risking
spec breakage. That risk is real but **much smaller than assumed**, and checking it is
straightforward:

| Instrument | Reaches a feature-gated row? |
|---|---|
| `ui/e2e/*.spec.ts` | **no** — `helpers.ts:87` `selectWorkspace()` drives the workspace PICKER, not the restaurant sidebar |
| `ui/src/__tests__` | 70 references to `useFeatures`, **0** override `isEnabled` |
| unit-test default | the real hook; its initial `enabled` Set is empty (`useFeatures.ts:96`) |

Two E2E specs touch the KDS surface (`e2e-kds-critical-path.spec.ts`,
`e2e-pos-to-kds.spec.ts`), and both navigate by `selectWorkspace(page, WORKSPACES.KDS)`. The
hidden sidebar row does not affect them. So enabling the real feature set would change what
those specs see only where a spec asserts feature-gated UI *inside* the screen it reached — a
grep for it, not a guess.

## The two options, now costed

**Option 1 — give the mock store a preset, answer from the table.** The first-run state
(`system.ts:528-539`) carries no preset field, so this needs one added. Choose `restaurant`
(the workspace set the mock emphasises) or `simple-retail`. Either way **one** workspace type
gets a complete preview: `restaurant` enables `kitchen-display` and `table-management` and
leaves `barcode-scanning` off; `simple-retail` does the reverse. `full-store` (27 keys) covers
most of both and is the only option that does not pick a loser — at the cost of no preview
exercising a *restricted* feature set at all.

**Option 2 — multi-store.** `mockSeedData.ts:209-213` binds all five workspace instances to
`store-1`; one store per workspace makes each preset answer correct. Faithful, and a change to
every handler that resolves a store or location.

## NOT done, and the reason is now specific

Round 130 declined because the impact was unmeasured. It is measured now, and the reason to
still decline is narrower and different: **the choice of preset is a choice about which
workspace type the preview is complete for**, and this session has no standing to make it.
`full-store` looks like the safe default, but adopting it would also mean no preview ever
exercises a store with restrictions — losing the ability to notice when a restricted store
breaks something.

What this round produces is the number the decision needs (1 of 39) and the finding that the
E2E exposure is much smaller than assumed, which is what makes option 1 cheap enough to take.

## Verified

| Item | Result |
|---|---|
| Mock keys that are `FEATURES` values | 1 of 5 |
| Consumed feature values enabled in preview | **1 of 39** |
| E2E navigation path | `selectWorkspace` -> workspace picker |
| Unit tests overriding `isEnabled` | 0 |
| In-tree acknowledgement | `dev-mock-preset-features.test.ts:116-118` |
| Tree | no source changed this round |