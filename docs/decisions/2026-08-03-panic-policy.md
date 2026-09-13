---
num: 33
area: architecture
title: ADR #33: Panic Policy & Production unwrap/expect Enforcement
status: Implemented (2026-08-03)
---
# ADR #33: Panic Policy & Production unwrap/expect Enforcement
<!-- Audit stamp: 2026-09-09 · DSH · status: HISTORICAL-RECORD, annotated not rewritten (3 findings from .agents/skills/docs-auditor/scripts/check-ci-claims.py, all in one family: the ADR names the `rust-panic-inventory` CI job twice and `.github/workflows/ci.yml` once, and that workflow was renamed to `.github/workflows/ci.yml.bak` by `23c963303` on 2026-09-02 so GitHub never executes it) · NOTHING HERE WAS REWRITTEN: dated ADR (front-matter `status: Implemented (2026-08-03)`, dated section headers), so the original sentences stand verbatim and each flagged line carries a `ci-claim: ok` pragma pointing at the Currency note added at the end of ## Status, which is where the correction lives · VERIFIED, not recalled: enforcement moved rather than vanished — `.github/workflows/dev-ci.yml:483` runs `python3 scripts/scan-unwrap-panic.py --fail-on-recoverable` as the static-gates step "Panic inventory (ADR #33)" (`dev-ci.yml:482`), and `scripts/gates.json` maps gate `panic-inventory` to dev-ci.yml/static-gates with status `required` · RE-MEASURED: `python3 scripts/scan-unwrap-panic.py --json` → total 130, invariant_annotated 130, recoverable 0, 26 files; `--fail-on-recoverable` exits 0, so the ADR's actual contract still holds while its 98/98 figure is stale-as-of-today · LEFT ALONE: the 2026-08-03 status prose, commit citations (`d82b133d`, `6f7307b3`), and the deferred-ideas paragraph — none is a CI claim this pass is entitled to touch. -->

**Status:** Implemented (2026-08-03), with a violated invariant recorded below
> **Live re-measurement (2026-09-13, 15:57) — the contractual zero in this record is
> violated, and the recipe this file gives for checking it cannot detect that.** Measured
> on this checkout, `python3 scripts/scan-unwrap-panic.py --fail-on-recoverable` exits
> **1** with **4** recoverable calls, `crates/oz-bridge/src/testing.rs:255,266,268` and
> `crates/oz-cli/src/commands/credential_deltas.rs:676`, while `--json` reports
> **total 136 / invariant_annotated 132 / recoverable 4**. Both source files are clean in
> `git status`, so this red is committed, not in flight, and `dev-ci.yml#static-gates`
> fails here. The paragraph above this block tells a reader to re-measure with `--json`:
> that command **exits 0 whatever it finds**, because it is an inventory report and not
> the gate, so following the documented recipe returns a clean-looking run over a
> violated contract. Mechanism 9 with a receipt on it, a claim that a rule holds plus a
> re-check instruction that cannot fail. The gate that means it is `--fail-on-recoverable
> and the value to read is its exit code. Correcting the four calls is a code change
> owned elsewhere and `scripts/gates.json` is outside this session's authority; what is
> mine to correct is that a stale figure became a false claim about a rule. Three commits
> landed on the reporting script today, `573df3164`, `0bd9b469a`, `7ceb22344`, the second
> and third being refusals of blank list values, one of which had silently widened
> `--roots ''` to a whole-directory scan, 146 calls, and `--roots crates ''` to a
> double-counted 242, now exit 2 and a correct 96.

> **Closed (2026-09-13, 19:06) — the contractual zero holds again, and the check that proves it
> is the exit code, not the figure.** All four calls were annotated by `2accc5513` (2 files,
> `crates/oz-bridge/src/testing.rs` +15, `crates/oz-cli/src/commands/credential_deltas.rs` +7).
> Re-measured on the committed tree at 19:05: `python3 scripts/scan-unwrap-panic.py
> --fail-on-recoverable` exits **0** where it exited **1** at 18:40, and the bare run still exits
> **0**, so `dev-ci.yml#static-gates` is green here for the first time in this session.
> **The invariant is an equation, not a count.** `--json` now reports `total 136 /
> invariant_annotated 136 / recoverable 0`; the block above wrote the middle figure as
> `annotated 132`, which is the number I read but not the key the tool emits — a reader
> greping `--json` output for `"annotated"` finds nothing and may conclude the field was
> removed. The load-bearing form is `invariant_annotated == total` (and equivalently
> `recoverable == 0`), which is machine-checkable and cannot be satisfied by an unannotated
> call drifting in, because either side moving breaks the equality. The `total` staying at 136
> while `recoverable` fell 4 to 0 is also the evidence that these were annotations and not new
> suppression: no call was deleted, reclassified, or added.
> What this record still cannot do is *keep* the invariant: nothing runs
> `--fail-on-recoverable` in `scripts/gates.json` or the pre-commit hook, so the green above is
> a property of a command nobody invokes automatically. That wiring remains owner territory.

**Date:** 2026-08-03
**Author:** Architecture Team & OZ-POS Contributors
**Tags:** reliability, panic, unwrap, expect, error-handling, RUST-07, enforcement

---

## Context

RUST-07 (audit 25, Rust Backend — see `docs/records/audit-open-findings.md` for the audit record) found that panic-oriented APIs remained in
production startup/API paths: `oz_api::serve()` unwrapped DB open, pragma/WAL
setup, migration application, port binding, and the server loop, and numerous
`unwrap`/`expect` calls lived in production modules outside test contexts. A
bad path, unavailable port, migration failure, or malformed runtime value could
terminate an unattended desktop/cloud process without a structured error or
actionable recovery, obscuring the original failure from callers.

The remediation closed the startup boundary first (`oz_api::serve()` returns
`Result`, commit `d82b133d`) and then swept the remaining recoverable panics
into `Result`/fallback paths and introduced a workspace panic-inventory gate
(commit `6f7307b3`). This ADR records the policy that remediation established:
when a panic is an acceptable, documented invariant and when it is a defect that
must be a `Result`.

---

## Decision

Panic is a **fallback of last resort reserved for proven-impossible states**.
Every production `unwrap`/`expect` that is not a documented invariant is a
defect. The line between the two categories is defined below and enforced by
`scripts/scan-unwrap-panic.py` as an inventory gate wired into
`scripts/check.sh`.

### When a panic is acceptable

A panic is acceptable **only** when all three hold: the failure is provably
impossible at runtime, the reason is documented in a `// SAFETY:`/`// INVARIANT:`
comment on the same or immediately preceding line, and a reviewer can verify the
invariant. Concretely:

- **Compile-time constants & static initialization.** Static, immutable
  registration that cannot fail once compiled — e.g. static Prometheus metric
  registration (`oz-reporting`/`oz-cloud-server` `metrics.rs`) and the
  `OnceLock`-cached SQL-validation regexes in `oz-plugin/db.rs` (compiled from
  `const` pattern literals). Because the literals are compile-time constants,
  a malformed edit fails the new `sql_validation_regexes_compile` test under CI
  — never a live process. This collapsed 10 per-regex `.expect("invalid … regex")`
  sites into one unreachable helper.
- **Validated input.** An `unwrap`/`expect` on a value already validated by the
  same function is acceptable when the validation immediately precedes the
  unwrap and the `// SAFETY:` comment says so — e.g. `Percentage::new` calls on
  already-validated percentages in desktop/tablet `pos.rs`.
- **Poisoned locks.** A `Mutex`/`RwLock` poisoned only by an in-process panic in
  the same mock/driver (test doubles) may `expect` — the lock's poisoned state
  is itself the failure signal, and the data behind it is irrelevant in a mock.
  This is the one production-facing exception: **real** production lock poison
  must recover via `PoisonError::into_inner()` rather than panic
  (see the platform-startup rate-sync DB lock, converted in `6f7307b3`).
- **Convenience wrappers & setup that cannot fail by construction.**
  `LuaRuntime::default()`, `SyncTransport::new()` (a convenience wrapper over
  the fallible `try_new`), `oz-logging::init()` documented-panic wrappers, and
  in-memory `fresh_db()` ops are acceptable — each documents why the setup path
  is unconditional.

Test code is exempt by definition: `#[cfg(test)]`, `mod tests`, `#[test]`,
`*/tests/`, benches, and `test_helpers.rs` are excluded from the inventory.

### When it must be `Result`

Any failure whose possibility depends on runtime state — environment, I/O,
user input, network, filesystem, or lock state across threads — must propagate
as `Result`, with context attached via `thiserror`/`anyhow` at the application
edge. The RUST-07 residual converted 16 such sites:

- **Startup/command boundaries return `Result`:** `oz-api::serve()` and
  `oz-cloud-server` `main`/`serve` return
  `Result<(), Box<dyn Error + Send + Sync>>` for logging init, DB init,
  in-memory SQLite, port bind, and server-loop failures.
- **String decoding:** `oz-cli` import-path currency decoding
  (`currency_to_utf8`) returns `anyhow` errors instead of `from_utf8().unwrap()`.
- **Post-commit lookups:** `oz-core` gift-card lookups use
  `ok_or_else(NotFound)` instead of `?.unwrap()`.
- **Optional/fallible infrastructure:** `shutdown_signal()` logs and falls back
  to `pending()` when signal-handler installation fails; the sync pagination
  cursor uses `last().map(...)` instead of `last().unwrap()`.
- **Lock poison in production:** platform-startup rate-sync DB locks recover
  via `unwrap_or_else(|e| e.into_inner())` rather than panicking on poison.

Rule of thumb: **if a human, a file, the network, or another thread can make it
fail, it is `Result`. If only a programming error can make it fail, it is a
documented invariant panic — or better, a test.**

### How `scripts/scan-unwrap-panic.py` enforces it

The script is a **grep-precise inventory** — it makes the policy auditable
rather than pretending textual analysis can prove invariants. It is
fail-closed only through the explicit `--fail-on-recoverable` gate: the
scanner never asserts that a tagged site is truly unreachable; it requires
the reviewer's `// SAFETY:` / `// INVARIANT:` comment to be present and
verifiable.

- **Scope:** scans `crates/`, `apps/`, `platform/`, `modules/` for `*.rs`.
- **Exclusions (test/dev contexts):** skips `*/tests/` dirs, `#[cfg(test)]`
  blocks, `mod tests`/`mod test` blocks, `#[test]`-annotated functions,
  `/benches/` harnesses, and `test_helpers.rs`.
- **Invariant tagging:** a `# SAFETY:`/`// INVARIANT:` (or `cannot fail` /
  `must not fail` / `impossible`) comment on the same or immediately preceding
  line marks a finding as `[INVARIANT]` — the documented-acceptable set.
- **Output:** `--json` emits `total`, `invariant_annotated`, `recoverable`, and
  per-file counts; plain mode prints every finding with its `[INVARIANT]` tag.
  `--fail-on-recoverable` prints a single summary line on success and the
  failing findings on failure (exit 1).
- **Gate (fail-closed):** `scripts/scan-unwrap-panic.py --fail-on-recoverable`
  exits 1 when any finding lacks a documented invariant comment; wired into
  both `scripts/check.sh` and the CI `rust-panic-inventory` job. The rule is <!-- ci-claim: ok: dated ADR record (2026-08-03), kept verbatim per docs-auditor rule E; see the Currency note at the end of ## Status -->
  now enforced mechanically: **the recoverable set (non-INVARIANT) must stay
  at zero**. Current production inventory: **98/98 documented invariants**, verified
  live on 2026-08-03 — down from 123 before remediation; the recoverable set
  is provably zero. New `unwrap`/`expect` in production code fails the gate
  unless it carries a verifiable invariant comment.

---

## Status

Implemented. Startup and command boundaries return `Result` (`d82b133d`); 16
recoverable panics converted to `Result`/fallback and the panic-inventory gate
added (`6f7307b3`); the residual production panic inventory is 98/98
documented invariants (from 123 before remediation; the recoverable set is
provably zero, verified live 2026-08-03). RUST-07 is closed as fully
remediated in audit 25 (Rust Backend audit; full record in `docs/records/audit-open-findings.md`).

**2026-08-03 — upgraded to a hard gate.** The gate is now fail-closed in both
`scripts/check.sh` and CI (`rust-panic-inventory` job in <!-- ci-claim: ok: dated ADR record (2026-08-03), kept verbatim per docs-auditor rule E; see the Currency note at the end of ## Status -->
`.github/workflows/ci.yml`): `scripts/scan-unwrap-panic.py --fail-on-recoverable` <!-- ci-claim: ok: dated ADR record (2026-08-03), kept verbatim per docs-auditor rule E; see the Currency note at the end of ## Status -->
exits 1 when any finding lacks a documented invariant comment, so the
recoverable-set-at-zero rule is enforced mechanically, not by review.

Remaining ideas (deferred, not planned): a diff-scoped variant that scans only
files touched by a PR (`git diff --name-only`) for faster feedback, and a
tracked baseline JSON to chart inventory history over time.

> **Currency (2026-09-09, docs-auditor; the text above is left as written on
> 2026-08-03).** The job named twice above — `rust-panic-inventory` in
> `.github/workflows/ci.yml` — no longer exists, because the whole file was renamed
> to `.github/workflows/ci.yml.bak` by `23c963303` on 2026-09-02 and GitHub never
> executes a `.bak`. **The gate itself survived the retirement and is still enforced,
> under a different name and location:** `dev-ci.yml#static-gates`, step
> "Panic inventory (ADR #33)", running
> `python3 scripts/scan-unwrap-panic.py --fail-on-recoverable` at
> `.github/workflows/dev-ci.yml:483`, plus `scripts/check.sh` locally. `scripts/gates.json`
> records gate id `panic-inventory` as `required` with
> `"ci": {"workflow": "dev-ci.yml", "job": "static-gates"}` and a `_note` saying exactly
> that ("Was ci.yml#rust-panic-inventory … now enforced in dev-ci.yml#static-gates").
> Note the trigger change, which the ADR predates: `dev-ci.yml` runs on
> `pull_request` targeting `main` and `workflow_dispatch`, with **no push trigger**, so
> "fail-closed in CI" now means "on a PR", not on a push.
> **How to re-measure:** `git grep -n scan-unwrap-panic -- .github/workflows/dev-ci.yml`
> for the wiring, and `python3 scripts/scan-unwrap-panic.py --json` for the inventory —
> re-run today it reports **total 130 / invariant_annotated 130 / recoverable 0**
> across 26 files, so the *rule* this ADR set (recoverable set at zero) still holds even
> though the 98/98 figure quoted above is a 2026-08-03 measurement that the tree has
> since grown past. The counts move; only the zero is contractual.

> last audited 09-09-26 by docs-auditor
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

