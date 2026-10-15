# The plan-empty state needs a release chain the seed makes expensive (round 267)

## What round 266 missed

Round 266 summarised the tables screen as closed apart from the tab-conflict pair. **The scan
disagreed**, and the scan was right:

```
tables   18/21   missing: tables-empty-add-table-btn, tables-tab-conflict-banner, tables-tab-takeover-btn
```

`tables-empty-add-table-btn` is a **second empty state**, on a different branch from the one round
246 covered:

| Branch | Condition | Control |
|---|---|---|
| `:1026` | `showEmpty && section === null` | **`tables-empty-add-table-btn`** |
| `:1045` | `showEmpty && section !== null` | `All` (round 246) |

Round 246's spec reaches the second by emptying ONE section. The first needs **every** table gone.

**The lesson is the one round 266's own record argued for and then did not follow:** a summary of
coverage is not a measurement of it. The scan is the instrument; the summary was prose.

## The route, and where it stalls

`deleteDeletable` frees the already-deletable tiles. The seeded plan has **13 tables, 7
deletable, 6 occupied** — and the delete guard is `activeBill || occupied` (`:1422`).

**Occupied tables ARE releasable**, which round 246's record did not consider:

```ts
} else if (table.status === 'occupied') {
  updated = await releaseTableScoped(sessionToken, table.id);   // :467-468
}
```

and a released table becomes `cleaning`, which the delete guard permits. So the chain is
**release → close panel → delete**, six times, then delete the seven free ones.

A spec was written to do exactly that and **timed out at roughly the twelfth lifecycle
operation** — the release loop alone costs several round trips per table, each with a panel-close
and a settle.

## Why it was reverted rather than made to pass

The spec was restored to its committed state (2 passed, verified) rather than shipped with a
longer timeout or a loop bound raised until it fit. **A test that needs thirteen UI lifecycle
operations to reach one assertion is a test that will flake**, and a flaky test is worse than a
named gap — this session has spent four rounds on the consequences of one.

The honest state is:

| Fact | Value |
|---|---|
| the branch exists | `:1026`, its own message and its own control |
| the seed permits reaching it | yes — via release-then-delete on 13 tables |
| the cost | ~13 lifecycle operations, exceeding a single test's budget |
| what is unproven | that the branch renders correctly when the plan IS empty |

## What would make it cheap

**A seed with an empty floor plan.** `mockTables` is a module literal
(`dev-mock/handlers/floorplan.ts:63`), so the honest fix is a dev-mock seam that starts the plan
empty — the same mechanism `?memos=3` provides for the memo stack. **Adding one is a shared-fixture
change and round 193's rule applies: a spec's need is not a licence to change shared state.** It
should be proposed, not taken.

## Verified

| Item | Result |
||---|---|
| `restaurant-tables-empty-section.spec.ts` | restored, 2 passed on both profiles |
| Probes | 0 remaining |
| Source changed | none |
| New tests | zero |

## The corrected state of the seven surfaces

| Screen | Coverage | Remainder |
|---|---|---|
| CartLineItem | 100% | — |
| tables | 86% | **`tables-empty-add-table-btn` (needs an empty-plan seed)** + the second-terminal pair |
| settings | 83% | chrome |
| editor | 86% | chrome |
| receipts | 80% | chrome |
| payments | 62% | field plumbing, invariant covered |
| CartPanel | 50% | architecture |

**One behavioural gap more than round 266 reported**, found by re-running the scan against the
summary rather than restating it.