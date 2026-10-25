# todo-verify-scoped-reads-tablet-gap

> Status: open. Opened 2026-10-26 (round 240). Not an owner decision — this is a
> gate-coverage job with a known, measured blocker recorded below.

## The gap

`scripts/verify-scoped-reads.py` has `--shell` with `default="desktop"`. Every
invocation in the repo omits the flag:

- `.github/workflows/dev-ci.yml:1565` — `python3 scripts/verify-scoped-reads.py`
- `scripts/check.sh:221` — same, no flag

So **no gate grades the tablet shell.** The desktop shell is graded (15 of 15
allowlisted names resolve, 19 call sites cleared) and the tablet shell is
printed on every run as a note and then ignored:

```
verify-scoped-reads: 1 shell section graded by no verdict in this run -- tablet:
15 unguarded call site(s) across 8 file(s) and 13 command(s), 43 cleared --
stated for visibility only; nothing in this run reads these numbers ...
```

That is the same shape as the `verify-shell-syntax.py` defect fixed in the same
round: the tool knows the answer, says it, and exits 0. The difference is that
this one is **deliberate** — it names the exact flag that would grade it.

## Why it cannot simply be wired in

`--shell tablet` exits **1** on 15 findings. All 15 are FALSE POSITIVES, and the
script says so in its own output: *"every one of the 15 tablet findings on
2026-10-25 (round 174) was guarded, and this reader could not see the guard."*

Three guard shapes defeat the brace-region reader, each verified in source this
round:

1. **An early return after the hooks.** `TopologyScreen.tsx:854` returns a notice
   before the body that owns the calls, so the editor's `useCallback` deps are
   never rendered on tablet. Comment at `:842-853` explains why the allowlist
   entries stay: they lie outside the arm the gate can see.
2. **A hoisted availability const + effect guard.** `useRestore.ts:143`
   `const isAvailable = !isTabletShell() && ...`, gated at `:148`. Gates the three
   restore commands.
3. **A shell branch inside the handler.** `useBackupStatus.ts:140` routes tablet to
   `create_backup_to` and never reaches `create_backup`.

Wiring `--shell tablet` in unconditionally would therefore make every run red on
15 findings that are already adjudicated. A permanently-red gate gets muted, and
muting it loses the desktop coverage too.

There is **no suppression mechanism** in the script (no pragma, no
known-findings file, no baseline — confirmed by reading it). The allowlist is the
only suppression, and the entries must stay because the *code shape* is
unreadable, not because the gap is real.

## What would close it

Pick one, in preference order:

1. **Teach the reader the three shapes.** The most valuable fix: an early-return
   guard, a hoisted `isAvailable`, and an in-handler shell branch are all
   statically visible. If the reader learns them, the 15 findings disappear for
   the right reason and the allowlist entries can be retired.
2. **A dated, owned known-findings file** for this gate, with an expiry per entry —
   the pattern `architecture-boundaries-baseline.json` already uses. This ships
   tablet grading now and records the 15 as transitional debt rather than
   silently.
3. **Wire `--shell desktop,tablet` with a `--expect-findings N` ratchet**, so the
   count can fall but not rise. Cheapest, weakest: it converts 15 findings into a
   number, not a reason.

Until then the tablet numbers are **stated but ungraded**, and any claim that
the scoped-reads gate covers both shells is false.

## Acceptance

`python scripts/verify-scoped-reads.py --shell tablet` exits 0, and the same
command is reachable from `scripts/check.sh` and `dev-ci.yml`.

> last audited 26-10-26 by docs-auditor
