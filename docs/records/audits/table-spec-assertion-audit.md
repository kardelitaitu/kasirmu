# Auditing my own assertions for round 196's flaw, and where it did not apply (round 197)

## Why this round

Round 196's three surviving mutations were all assertions about the TABLE SCREEN that used
text or count filters. Rounds 194 (delete) and 195 (move) wrote assertions in the same style on
the same screen, so the question was whether they share the flaw.

The audit was mechanical: kill each behaviour and see whether the spec notices.

## The results

| Spec | Mutation | Result |
|---|---|---|
| round 194 — delete | bypass the confirmation and delete on click | **FAILED correctly** — the case binds |
| round 195 — move | remove the move's `releaseTableScoped` | **SURVIVED** — the case did not bind |

So one of the two was already sound, and one was not. Reporting both matters: the audit was not
a fishing expedition that found what it wanted.

## Why round 195's survived, and it is two flaws at once

```ts
await expect(
  page.locator('.tables-table--available').filter({ hasText: sourceName }).first(),
).toBeVisible();
```

1. **The plan already has four available tiles.** `.first()` was satisfied by one of them,
   whether or not the source changed.
2. **`Table 1` is a substring of `Table 12`** — round 195's own collision class, in the spec that
   documented that collision.

Fixed the way round 196 taught: the source tile is captured **by index** before the move, and
the assertion polls that index's class.

## Then the SAME wrong-state mistake as round 196

With the assertion binding, it failed — expecting `tables-table--available` and receiving:

```
tables-table--cleaning
```

A move releases the source to **cleaning**, exactly as a merge does (`floorplan.ts:152-154`).
Round 196 recorded this; round 197 hit it again. **Two instances of the same wrong assumption is
a fact about how easy it is to guess an end state — which is the argument for probing rather
than reasoning.**

## Verified

| Item | Result |
|---|---|
| Round 194 delete spec | kills correctly, unchanged |
| Round 195 move spec | rewritten; **now kills correctly** |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

## The process note

While killing the move I read the file, took `indexOf` for a second occurrence that did not
exist (`-1`), and spliced at `-1` — which **duplicated the entire file body** 1,363 lines deep.
`git diff --stat` showed `1 file changed, 1 insertion(+), 1 deletion(-)` for a correct mutation
and the corruption was caught within one call. The lesson is narrow and worth keeping: **guard a
splice on its index being non-negative**; `-1` is a valid array index and a silent disaster.

> last audited 14-10-26 by docs-auditor
