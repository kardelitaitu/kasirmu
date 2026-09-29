<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 72 lines, with no prior stamp, footer or marker. It is a short record of a genuinely uncomfortable finding — the repository's own formatting gate is red on committed code — and the reason it was written down rather than quietly fixed is the subject of the document itself. · IT RULES OUT THE TWO EXPLANATIONS THAT WOULD HAVE MADE IT BORING, and that is the value here. The obvious explanations for a formatter suddenly failing on code it formatted before are line endings and a toolchain change, and the record eliminates both with evidence rather than assertion: it shows the violating file is line-feed-only with a measured carriage-return count of zero despite the checkout's autocrlf setting, and it reasons from commit dates that code written after the installed formatter's release cannot have been formatted by a different version of it. A record that had stopped at 'the gate is red' would have been filed and forgotten; a record that excludes the boring causes is one someone can act on. · THE CONFIGURATION CLAIMS CHECK OUT, which is the part a reader can re-verify. There is no formatter configuration file in the repository, so the failing style genuinely is the tool's default, and the toolchain file pins the stable channel as the document states. Both were confirmed this pass rather than taken on trust, because a claim about which style is in force is exactly the kind that quietly changes. · AND THE REPOSITORY'S OWN HISTORY CORROBORATES THE DECISION THAT FOLLOWS. The pre-commit hook carries a comment recording that a commit-time auto-format step rewrote other agents' in-flight source files — the same class of harm this campaign's own operating rules exist to prevent, and the reason formatting is check-only at push time rather than a commit step. So this snapshot is not an isolated complaint about a red gate; it is the evidence behind a policy change that the root agent guide now records. A reader who wonders why formatting is not enforced at commit time has the answer here, and it is a good one. · NOT re-measured: the fifty diffs themselves. Re-running the formatter check is cheap for whoever owns the tree, and the count will have moved since — which is exactly the caveat the record's own header carries by naming the date, the branch and the fact that other lanes' edits were present in the working tree at the time. That scoping is what makes the number quotable. · No stamp existed; this is the first. -->
# The formatting gate is red — 50 rustfmt diffs on committed code

**Measured:** 2026-09-28, branch `0.0.40`, in a working tree also carrying concurrent lanes' edits.
**Command:** `cargo fmt --all -- --check` -> **exit 1**, **50** `Diff in` blocks.
**Toolchain:** `rustfmt 1.9.0-stable (88d9e12ae1 2026-08-18)`, from the `channel = "stable"` pin in
`rust-toolchain.toml`. There is no `.rustfmt.toml`, so this is rustfmt's default style.

## What the diffs are

Not line endings. `crates/kasirmu-hal/src/drivers/edc/mod.rs` is LF-only (`crlf=0`, `bare_lf=45`)
even though `core.autocrlf=true`, and the hunks are argument wrapping:

```diff
-    assert!(r.transaction_id.is_none(), "a declined sale has no transaction");
+    assert!(
+        r.transaction_id.is_none(),
+        "a declined sale has no transaction"
+    );
```

## Why this is not toolchain drift

The violating files were last touched between 2026-09-25 and 2026-09-28
(`loopback_tests.rs` at `3aaf22d04`, `mod.rs` and `kasirmu-api/src/lib.rs` at `34135db16`,
`cloud-server/src/main.rs` at `5d91fb9d4`), and the installed rustfmt is dated **2026-08-18** —
six weeks older than those commits. Code formatted by this rustfmt cannot fail this rustfmt, so
for these files the alternative explanation (a style change inside `stable`) is excluded: the
committed text was produced without running the formatter.

## Why it matters

`.github/workflows/dev-ci.yml#rust-fmt` runs exactly `cargo fmt --all -- --check`, installing
`rustfmt` from `dtolnay/rust-toolchain@stable` and gating on the `changes` job reporting Rust
changes. Nothing else enforces formatting: `cargo fmt` is deliberately **not** a pre-commit step
(AGENTS.md §2) — it is check-only via pre-push, `scripts/check.sh`, and this CI job.

## Why it was recorded and NOT fixed here

A repo-wide `cargo fmt --all` rewrites every file it wants to change, **including files carrying
another lane's uncommitted edits** — `crates/kasirmu-core/src/sync_pull.rs` was dirty at the time
of measurement. A pathspec commit would then record their content under this lane's message,
which AGENTS.md §7.3 forbids. Excluding the dirty subset is a moving target rather than a fix:
**77 commits touched `crates/` in the previous 24 hours.** The sanctioned command is `cargo fmt
--all` run as a pre-push step, and it wants a quiet window.


> **Outcome, same day — commit `1f83abfaf`: 30 of the 31 files are formatted and committed; 1 diff block(s) remain.**
> The command went from **50 diff blocks across 31 files** to **1** in **modules/inventory/src/handlers_tests.rs**. The 30 fixed
> files were each verified clean in `git status` *before* the write, so no other lane's in-flight edit was
> recorded under that commit; the write set was exactly the pre-measured diff set minus the excluded file.
>
> The survivor needs one `cargo fmt -p modules-inventory` once its owning lane lands — at measurement time it was
> **dirty** (`git status` records an uncommitted edit), and formatting another lane's uncommitted file would write
> into their work, so it was deliberately left. Same quiet-window rule as above, now with a much smaller surface.

## What would close it

1. **Now:** in a quiet window, `cargo fmt --all`, then `cargo fmt --all -- --check` -> exit 0,
   committed as one formatting-only change. Verify the block count falls from 50 to 0, not just
   that the command returns 0 — a clean run over an empty scope also returns 0 (see the
   architecture-boundary checker's own note on that failure mode).
2. **Durably:** either pin the rustfmt the tree is formatted with instead of `channel =
   "stable"`, or move this check into a gate that runs per commit. Under a `stable` pin the
   formatter moves under every contributor without a diff anyone reviews, and the failure
   surfaces as a red CI job on code nobody edited.

## Evidence provenance

All figures re-derived in this pass; no suite, no build, no Docker. Diff-block count from
`cargo fmt --all -- --check`; the per-file `Diff in` list, the line-ending census
(`[IO.File]::ReadAllText` + regex), the `git status --porcelain` cleanliness checks, and the
`git log -1 --date=short` dates were each read on this checkout on 2026-09-28.

> last audited 29-09-26 by docs-auditor
