# Unblocking round 192's unreachable guard — and backing the wrong fix out (round 193)

## The round's arc

Round 192 wrote a spec for the table release confirmation and reported that the guard was
UNREACHABLE on the seeded floor plan, with the unblocking condition named: seed a held cart
against a table. This round did that — twice, and the second attempt is the interesting one.

## Attempt 1: seed the shared mock. It broke the suite.

`loadMockHeldCarts` was changed to return a seeded `Table 1` open bill instead of an empty array.
The release spec passed, and **4 tests failed** — `dev-mock-auth-contract.test.ts`'s
held-cart persistence cases:

```
expected [ { …(8) }, { …(8) } ] to deeply equal [ ObjectContaining{…} ]
open-bill listing separates table bills from parked holds: expected length 1 but got 2
```

Those tests assert the slice is EMPTY until the app holds one. They are right, and my seed
changed a real invariant of the mock — **starting empty is a documented property, not an
oversight**. The whole change was reverted and verified byte-identical to HEAD.

## Attempt 2: the spec seeds itself. Nothing else changes.

The seed moved into `restaurant-table-release.spec.ts` via `page.addInitScript`:

| Property | Why |
|---|---|
| init script, not `page.evaluate` | the mock reads the slice once at module init, and `loginAs` navigates itself, so a later write is read by nobody |
| guarded by `if (localStorage.getItem(key) !== null) return` | a re-navigation must not reset a bill the test has just released |
| label `Table 1` | `matchesTableBill` matches a `Table N` / `Meja N` token against the tile's bare number (`tableLabel.ts:81-107`) |
| `bill_type: 'open_bill'` | that is what `list_open_bills_*` filters on (`sales.ts:703-704`) |

The dev-mock is **untouched** — `git status` after the revert shows nothing in `src/dev-mock`.

## What is pinned — 4 passed

| Case | Asserts |
|---|---|
| confirmation required | the primary action reads Release, one click opens a confirmation that **names the tab amount**, and cancelling leaves the table occupied |

| release completes | confirming frees the table to available |

**Kill-tested**: disabling the `activeBill` half of the guard (`:1129`) fails both cases. Restored,
byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| Release spec | 4 passed |
| Kill-test | 2 failed |
| `dev-mock` | unchanged, byte-identical to HEAD |
| Dependent specs (tables x2, sidebar) | 18 passed |
| eslint | 0 |
| Full UI suite | 12,703 passed — **0 failed** |

## The lesson, stated plainly

**A test's need is not a licence to change shared state.** The first fix would have made round
192's spec pass and moved the cost into four tests describing a real invariant. The full-suite run
is what caught it; without it the fixture change would have looked like the unblock.

The generalisation is worth the record: when a test cannot reach a branch, ask whether the
SCOPING is wrong before concluding the SHARED fixture is wrong.

> last audited 14-10-26 by docs-auditor
