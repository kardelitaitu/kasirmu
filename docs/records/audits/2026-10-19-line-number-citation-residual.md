# Line-number citation drift: measured, partly repaired, and still open — 2026-10-19

**Scope:** `<path>:<line>` citations in LIVE documentation (the three root READMEs, `docs/architecture/`,
`docs/security/`, `docs/operations/`, `docs/guides/developer/`). `docs/records/` excluded.
**Repaired this pass:** 18 citations across 2 files. **Still open:** ~13 drifted in the examined
sample plus ~78 citations never examined, because the sweep hit its cap.

## Why this class exists

A prior pass repaired 186 stale **path** citations in dated records so every cited *file* resolves.
That sweep said explicitly what it could not do:

> **Line numbers are unverified and unverifiable by this method.** A path resolving does not mean
> `:429` still means what the record claims.

This pass started closing that. **No checker in the repository grades a line number.** `check-dead-refs.py`
resolves a path and stops. `check-api-surface.py` reconciles command *names*, not coordinates. So a
citation can point at the right file and the wrong hundred lines forever, and every gate stays green.

## What the measurement found

Method: extract every `` `path:N` `` with a symbol named on the same doc line, open the target, and test
whether that symbol appears within ±8 lines of N. 150 citations examined (228 found; the rest hit the cap).

| verdict | count | meaning |
|---|---|---|
| verified-ok | 43 | symbol present near the cited line |
| **DRIFTED** | **23** | right file, **wrong line** |
| SYMBOL-GONE | 7 | symbol absent from the file entirely |
| no anchor | 77 | citation names no symbol; untestable this way |

The worst cluster was a single settings/sync block in `docs/operations/runbook.md` whose citations were
**35 to 333 lines off** — and the further off a citation is, the more likely a reader concludes the
symbol was deleted rather than moved. All of that block was re-derived and repaired; a note there
records that it was.

## The repair rule, and why it is not "update every number"

A citation is repaired only when the named symbol still exists in the same file and is found by
`grep -n '\bfn <name>\b'`. Re-deriving a line by re-running the doc's own command is the only method
that generalises, because these coordinates move whenever anything is inserted above them — which the
runbook block itself demonstrates at 333 lines of drift in a file that is edited often.

**Two citations in `CRITICAL_PATH_INVARIANTS.md` were left exactly as written on purpose.** They are
out of range for their target file (`models.rs:368` in a 14-line file) because they sit inside a
"**Repaired 2026-10-07**" note that QUOTES what the file used to cite. Rewriting them would erase the
evidence that the repair happened. A future sweep that "fixes" them mechanically will have broken the
record — this paragraph exists so it does not.

## What remains open

- **~78 citations were never examined** (the 150-cap). They are concentrated in `docs/operations/`.
- **13 of the 23 DRIFTED** were counted but not enumerated in the report.
- **The anchor heuristic has a known bias**: a doc citing line N for *surrounding context* rather than a
  symbol definition reads as drift. Each reported drift was eyeballed, but the residue was not.
- **Prose citations are invisible here.** A sentence that says "the writer catches the violation" and
  names no path cannot be graded by this or any current tool.

A checker that parsed `path.rs:NN` + a symbol name and asserted the symbol is within a window would
close most of this class — `CRITICAL_PATH_INVARIANTS.md` notes at its foot that no such check exists and
that "a future pass could assert each named test exists by name". This is that future pass, still
unwritten. Recording it rather than implying the class is closed.

## Follow-up, same day: the checker this record asked for now exists

The paragraph above ended by naming the missing tool and declining to imply the class was closed.
It has since been written: **`.agents/skills/docs-auditor/scripts/check-cite-lines.py`**, wired as
`check.sh` step `cite lines`, `gates.json` id `cite-lines`, and `dev-ci.yml#static-gates` step
`path:line citations`. It grades a citation by anchoring on a **backticked symbol** on the doc line
and asking whether that symbol sits within ±8 lines of N.

Repaired under it: **40+ citations** across `docs/operations/runbook.md`, `docs/guides/developer/admin-guide.md`,
`ARCHITECTURE.md` and four `docs/architecture/` files. The live set now reports **0 DRIFTED and
0 SYMBOL-GONE out of 136 graded citations**.

Three design decisions came out of getting it wrong three times, and each is pinned by a self-test case:

1. **Bare prose identifiers are never anchors.** The first version accepted them and reported a
   *correct* citation as drift: `state.rs:279 (AppState::new)` matched a prose `AppState` at `:32` in a
   1005-line file. A false OK is worse than no check.
2. **Longest-token-first is the wrong order.** It anchored a `` `adjust.rs:249` | `.filter(...)` ``
   cell onto `adjust_stock_at_location_with_reason`, defined at `:190`, and called a right citation
   wrong. Anchors are now tried **nearest-first** from the citation.
3. **A near hit on ANY anchor wins.** Breaking on the first symbol *present* anywhere in the file
   reproduced the same error one layer down. The question is "is a named symbol near N", not "is the
   closest-named one".

**What the tool still cannot do, stated so its green is not over-read.** It reports **130 citations as
NO-ANCHOR** — ungraded, never counted as passes — because they name no backticked symbol. Those include
the `(path:line)` pair style where the symbol is on a neighbouring line, the deliberate historical
citations, and every prose claim with no coordinate at all. The check is a **floor**, not a certificate.
That limit is printed on success, not only on failure, so a reader cannot mistake the 0 for full coverage.


> last audited 19-10-26 by docs-auditor
