# Half-committed money-write sweep — 2026-10-16

<!- - Audit stamp: 2026-10-16 · autonomous goal round 79 · status: SWEPT CLEAN, 0 open findings · branch: 0.0.41 -->

<!- - Scope: every `async` handler under `ui/src/features/` (tests excluded). The question is whether any
     handler performs TWO OR MORE MUTATING WRITES INSIDE ONE `try` and, on failure, neither reports nor
     re-reads — leaving the screen asserting a state the backend has moved past. -->

## Why this class

A multi-step money write has THREE failure states, and the middle one is the one that hides:

1. **Nothing happened** — safe by ordering (write the new record before deleting the old).
2. **Everything happened** — the happy path.
3. **Half happened** — the first write committed, a later one failed. The database now holds a state
   the UI was never told about.

State 3 is dangerous because a catch that only calls `addToast(...)` *looks* correct: the operator is
told something failed. But if `loadTables()` / `loadOpenBills()` sits on the success path only, the
screen keeps rendering the PRE-write layout under a failure toast — and the operator retries against a
plan the backend has moved on from. Reporting is not the same as refreshing.

Fixed in this session for: `TableManagementScreen` (move, merge, reserve, seat) and `PosScreen`
(split balance, save-tab/kitchen dispatch).

## The detector, and the four ways it was wrong

A sweep is not a finding. The count going 5 -> 1 -> 1 -> 1 -> 1 while the code did not change is the
whole record: each revision removed a false-positive mode, and each was validated against the PRE-FIX
shape of the table screen's `handleMove` (4 mutating awaits, a catch that toasts but does not refresh),
which the detector must flag.

| Revision | Reported | What it got wrong |
| --- | --- | --- |
| v1 | 1 | `REPORT` listed `setError`/`setActionError` but not `setFormError`, so a reporting catch looked silent. |
| v2 | 5 | Counted `if/else` branches as sequential writes. `StaffDetailDrawer.handleSave` was flagged, but its two awaits are mutually exclusive — only one write runs, and STAFF-05 makes even that one atomic server-side. |
| v3 | 1 | `LicenseActivationScreen.handleActivate`: `getMachineId`/`getHardwareFingerprint` matched the verb list. They are READS. |
| v4 | 1 | Same handler: the remaining match is a `? :` ternary — `activateLicense` appears in both arms, so exactly one write runs. |

## Result

**0 open findings.** The final detector (sequential mutating writes, reads excluded, catch must
re-read) reports nothing across `ui/src/features`. The class is uniform.

The one residual name, `LicenseActivationScreen.handleActivate`, is a false positive of the ternary kind
and is separately triaged: `activateLicense` is a remote HTTP call with no local INSERT, so there is no
partial local state to refresh.

## Re-running

The check is a read-only AST-free sweep: for each `async` arrow under `ui/src/features`, collect
`await <name>(...)` whose leaf name matches a mutating verb and does NOT start with a read verb
(`get|list|fetch|load|read|check|compute|...`); require two such awaits with no `else`/`try`/`catch`
between them; then require at least one `catch` body to lack a re-read
(`loadTables|loadOpenBills|loadData|refresh|reload|invalidate|refetch|onSaved`).

A non-zero result is a candidate, never a finding — every candidate needs a hand check, because all
four false-positive modes above look exactly like a real hit to the script.

> last audited 16-10-26 by autonomous-goal-round-79
