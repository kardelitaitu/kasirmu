# Merge Table, and three assertions that survived their own kill-test (round 196)

## Why it was unreachable

Merge is the most demanding of the table screen's tab actions: it needs TWO tables with bills
(`TableManagementScreen.tsx:589`) and its candidate list is bills-only too (`:572`). Round 193's
single bill made Move reachable and left Merge unreachable; this round seeds a SECOND bill —
still from the spec, still with the dev-mock untouched.

## The finding: my assertions were the defect, three times

Every kill-test in this round SURVIVED, and each survival was a different mistake in MY test.
Recording all three because the pattern is the point.

| Attempt | Assertion | Why it survived |
|---|---|---|
| 1 | option COUNT at most the billed-tile count | a count cannot see identity; the plan offers about as many tables as it has bills |
| 2 | `--available` carrying the source name | WRONG END STATE - a release sets `cleaning`, not available (`floorplan.ts:152-154`) |
| 3 | `--cleaning` filtered by source name | the seeded plan ALREADY CONTAINS a cleaning tile, and the text filter matched a different one |

Attempt 2 is the one that was PASSING for the wrong reason. The probe showed the post-merge tile
class as `tables-table--cleaning`, which the code sets deliberately and documents; my assertion had
asked for `available` and been satisfied because a merge makes the source look released either
way. Only probing the actual class exposed it.

## What finally binds

The source tile is addressed BY INDEX, captured before the merge:

```ts
const sourceIndex = await page.locator('.tables-table')
  .evaluateAll((els) => els.findIndex((e) => e.className.includes('tables-table--has-bill')));
```

Text filters are ambiguous on this fixture — twelve tiles, one already cleaning — and an index
cannot be satisfied by a different table. With that, removing the source release fails the case.

## What is pinned — 4 passed

| Case | Asserts |
|---|---|
| candidates | the modal opens with billed destinations, compared BY NAME using `Table N` tokens (not substrings — round 195's collision) |
| merge completes | the source tile goes to `cleaning` BY INDEX, loses its bill, and the mock holds ONE open bill totalling 400000 (250000 + 150000) |

**One mutation still survives and is documented in the spec**: dropping the
`Boolean(getTableBill(tbl.name))` half of the candidate filter. Probing with it removed showed the
select still offering one option, because the other ten tables are in different SECTIONS and
`activeTableList` is section-scoped — the filter and the section scope produce the same list here.
Making that rule observable needs a section holding both a billed and an unbilled table.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed |
| Kill-tests | 3 survived (my defect), 1 fails correctly, 1 documented as unobservable |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

> last audited 14-10-26 by docs-auditor
