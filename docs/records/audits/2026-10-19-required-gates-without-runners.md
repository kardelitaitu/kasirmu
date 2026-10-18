# Every required gate now has a runner it can actually reach — 2026-10-19

**Scope:** all 123 entries in `scripts/gates.json`. **Result:** 8 gates corrected, 0 required
gates left with no working runner, all 14 doc/CI gates green.

## The defect class: "required" with no runner

`gates.json` uses `status: "required"` to mean *this must pass before a change lands*. That
claim is only true if something can actually run the gate. Two ways it silently stops being true,
and both were present:

1. **A `check.sh` runner naming a step that does not exist.** `rust-clippy` declared its runner as
   `clippy` while `scripts/check.sh:96` defines the step as `clippy workspace`. The gate WAS wired
   — a name-matching sweep just could not see it. A registry that disagrees with the script on a
   step name is indistinguishable from an unwired gate, which is the worse outcome: the sweep that
   exists to catch unwired gates reports a false positive and the real state stays unknown.
2. **No `ci` block at all.** Six docs checkers (`check-orphans.py`, `check-site-links.py`,
   `check-nav-paths.py`, `check-env-docs.py`, `check-adr-status.py`, `check-ci-claims.py`) were
   wired into `check.sh` and marked `required`, with no CI job. So "required" meant *required of a
   developer who remembers to run `check.sh`* — diligence, not enforcement. That is the same gap
   this corpus already records for the script tests and for the audit-record footers.

A third, narrower instance: `rust-clippy`'s own note had said since 2026-10-07 that a live
`cargo-clippy` job exists and that a green CI does say something about clippy — while the gate
carried **no `ci` block**. The prose was right and the machine-readable record was empty, so
nothing could act on it.

## What changed

- Six docs checkers added to `dev-ci.yml#static-gates`. All are **stdlib-only** and read the
  working tree — the site-links checker parses `website/astro.config.mjs`, `src/pages/` and
  `public/`, not a build — so none needs a toolchain the job lacks. Verified by running each
  before wiring, not by reading its imports.
- `cite-lines` and `doc-parity` (added earlier the same day) got the `ci` blocks they were already
  entitled to: both were already steps in `static-gates`, so the registry under-reported two gates
  that were in fact enforced.
- `rust-clippy` got its `ci` block and its runner name corrected to `clippy workspace`.

## The check that found it

A sweep over every `status: "required"` entry asking a single question: *is there a runner — a
`check.sh` step that actually exists, another declared runner, or a `ci` block?* It reported 8
non-conforming entries out of 123 and **0 after the repairs**.

That question is cheap and none of the existing checkers ask it. `verify-ci-docs-drift.py` compares
docs to workflows; `verify-agents-mirrors.py` compares prose claims to gates. Neither asks whether
a gate can be run. Worth folding into a checker rather than repeating as a hand sweep — recorded
here as the candidate.

## What remains untested

Wiring a step into `static-gates` is not the same as proving CI executes it. `dev-ci.yml` has no
`push`-triggered verification of its own steps run in this session, and none of the six new steps
has been observed green on a runner. The evidence here is that each exits 0 locally on a clean
tree and that the YAML parses with the steps present in the right job — a real but weaker claim
than a green CI run, and the distinction is worth keeping.

> last audited 19-10-26 by docs-auditor
