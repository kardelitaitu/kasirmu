# A green citation gate that could not see two dead citations — 2026-10-19

**Scope:** `check-cite-lines.py` (the only docs checker that grades a line number), the
`TMP` guard in `scripts/check.sh`, and the scoped sales read behind `VoidOrdersScreen`.
**Result:** 2 genuinely stale citations found and marked, 1 unbounded IPC read bounded,
1 gate that was red for the wrong reason fixed. 6 commits.

## 1. "No graded citation is on the wrong line" was true and insufficient

The checker grades a `path:NN` citation by looking for a backticked symbol on the doc
line and testing whether it lands within ±8 lines of `NN`. When the doc line names no
symbol it reports `NO-ANCHOR` and says, correctly, that this is *not a pass*. It then
prints the ungraded count and exits 0.

That is honest, and it was still a blind spot I could not see into, because nothing
listed the ungraded rows. Adding `--list-no-anchor` (read-only; a listing must not be a
failure) made them enumerable for the first time: 40 rows. Two were plainly broken:

- `docs/security/PCI-DSS_CHECKLIST.md:58` cited `modules/loyalty/src/models.rs:88-125`.
  That file is **13 lines** — it became a re-export stub when the loyalty types moved to
  `foundation/src/loyalty.rs` (ADR-61 / C26). The range cannot resolve. It is also
  *correct as history*: the paragraph records the PIN being removed on 2026-09-29, so
  re-pointing it would describe code the same page says was deliberately deleted. Marked
  `dead-ref: ok:` rather than repaired.
- `docs/guides/developer/api-reference.md:31` cited `apps/mobile-tauri/src/lib.rs:445`,
  which is a `);`. The `generate_handler!` registry moved to `:1014`. The paragraph is a
  dated 2026-09-14 record, so it keeps its numbers and gains a note giving the current
  ones (`desktop:1362-1906`, `tablet:1014-1496`) and the current counts
  (`500/428/519`, was `453/322/478`).

Both repairs are `dead-ref: ok:` annotations, not re-pointed numbers, because in both
cases the citation is *supposed* to be historical.

## 2. The lesson that did not generalise: I tried to close the blind spot and could not

The obvious fix was a fallback verdict for "the doc line names one symbol and that symbol
lives elsewhere". I wrote `SYMBOL-ELSEWHERE`, wired it into the counts and the report,
and then tried to make it fire on a planted defect: I changed `main.rs:630` to `:640`
(the `sync_queue_depth` field instead of `db`). **It did not fire.** The symbol there is
the two-letter field `db`, below `anchors_on`'s four-character floor — and that floor
exists because short generic words produced confident false passes earlier.

So the code was inert. I removed it rather than ship a verdict that never triggers. This
is the same failure mode as the empty `ci` block recorded in
`2026-10-19-required-gates-without-runners.md`: machinery that looks like coverage and
isn't. **What the tool can honestly say is that 178 citations are on the right line and
94 cannot be graded** — not that 272 citations are correct. A planted `:640` for a `:630`
citation still passes, and that is now written into `SKILL.md` instead of being implied
away by a green exit code.

## 3. The `TMP` guard measured the shell, not the test binary

`scripts/check.sh` grew a guard that defaults `TMP` into `target/.tmp-check`, because
`kasirmu-bridge` seeds a real SQLite store in the temp dir and under confinement the
spawned binary is denied writes there ("Access is denied (os error 5)", `testing.rs:536`).

The guard read `if [ -z "$TMP" ] || [ ! -w "$TMP" ]` and **did not fire**, because Git
Bash reports `TMP=/tmp` and `test -w /tmp` is true. The test binary then resolves `/tmp`
to `C:\Users\<user>\AppData\Local\Temp` and is denied. Full matrix, step 31: 93 failures.

Same bug shape as section 1 — a measurement taken from the wrong vantage point. The
guard now also requires `TMP` to be *inside the checkout*, the only place both the shell
and the child are known to write. Verified: `kasirmu-bridge` 1516/1516 pass with an
in-tree `TMP`, and step 31 drops from 93 failures to 1.

## 4. `_bounded` in the name, no bound in the query

`Store::list_sales_with_history_cap_bounded` appends `LIMIT` **only when a limit is
given** (`sales_crud.rs:308-314`). `VoidOrdersScreen` called `listSalesScoped(sessionToken)`
with no limit, so the session path read every sale in the tier window into memory, while
`SalesHistoryScreen` read at most 500 from the same store. The tier cap is a *time*
window (Free 3 months, Plus 1 year, Pro 5 years), not a count — so "capped" still meant an
unbounded row count inside the window.

Fixed by passing an explicit 500 ceiling and pinning it with a test that asserts the
**argument**, not just the call. The earlier test asserted `toHaveBeenCalledWith('session-1')`,
which passed happily on the unbounded call and is exactly why the omission survived.

## What is still open, honestly

- **93 citations remain ungraded** (94 including one added by the note above). Several
  sampled ones are correct (`Settings::set_sync_api_key` at `sync.rs:79`,
  `RESTORE_REQUEST_SUFFIX` at `recovery.rs:31`, `list_restore_candidates` at `restore.rs:124`);
  a bare `path:NN` with the symbol named in prose simply cannot be machine-graded. Read
  the count as the tool's blind spot, not a backlog with a known size.
- **Step 31 still reports 1 failure**: `pg::tests::pg_exchange_rates_roundtrip` panics with
  "PG test enabled but the resource is unreachable" because `--all-features` turns on
  `pg-tests` and there is no Postgres at `localhost:15432` (docker is not running on this
  host). Deliberate by design (`6f0f4c62fd`), environmental here — not a regression.
- **Steps 32-161 of the matrix have never run this session**; the matrix stops at the
  first failure, so everything after test-workspace is unexercised until PG is reachable.

> last audited 19-10-26 by docs-auditor
