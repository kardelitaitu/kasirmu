# Hunting round 201's closure-after-await shape across the UI (round 202)

## The hunt

Round 201 found `setLines(lines.map(...))` after an `await`, where `lines` was a closure captured
BEFORE the await — so anything added during it was discarded. The record named the shape:

> an async handler that replaces state from a closure captured before its await will discard
> anything that arrived during it.

This round looked for more of them. The pattern searched for: an `await` followed within 12 lines
by `setX(<lowercaseVar>.map|filter|concat(`).

## The result

| Scope | Candidates |
|---|---|
| `features/sales` + `features/restaurant` | **3**, of which 2 were round 201's own comment |
| all of `ui/src` (741 production files) | **10** |

Every one was checked. **None has the defect**, and the reason is uniform: the variable is the
**awaited result**, not a closure:

```ts
const [primary, edcList] = await Promise.all([...]);   // RestaurantPaymentsScreen:375
setEdcTerminals(edcList.filter((t) => t.isActive));    // :383 — the FRESH value
```

Some also carry a `cancelled` guard before the write (`:380`, `:389`), which is the other correct
answer for a load effect.

## The distinction, which is the useful output

Two shapes look identical in a grep and behave oppositely:

| Shape | Correct? |
|---|---|
| `const rows = await get(...); setDrafts(rows.map(...))` | **yes** — the awaited value is authoritative |
| `setLines(lines.map(...))` where `lines` is state read before the await | **no** — the closure is stale |

The tell is not the `.map()` and not the `await`. It is **where the variable came from**: an `await`
in this handler, or a `useState` value captured at render. A grep for the syntactic shape cannot
separate them — the same `setX(v.map(...))` is correct in one and a data-loss bug in the other.

That is why the round-201 defect survived: it reads as the correct pattern.

## Verified

| Item | Result |
|---|---|
| Files scanned | 741 production files under `ui/src` |
| Candidates | 10, all inspected |
| Defects found | 0 |
| Source changed | none |

## What would be needed to find more

A grep cannot do it, for the reason above. The mechanical version is a lint rule — flag
`setX(v.map|filter(` where `v` is bound to `useState` in the same component and an `await` appears
between — which is a real candidate for a future round rather than another sweep.

Recorded rather than left implicit: **the shape is not widespread, and the search that would find
it is not a text search.**