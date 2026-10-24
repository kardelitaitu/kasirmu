---
num: 67
area: architecture
title: "ADR-67: The core-size ratchet — what it can and cannot measure, and the ruling it needs"
status: Proposed (2026-10-24) — needs an owner ruling; recommends REPLACING the single crate-wide ceiling with a per-area budget
---

# ADR-67: The core-size ratchet

**Status:** Proposed (2026-10-24) — not ratified.
**Date:** 2026-10-24
**Recorded against:** branch `0.0.41` at `3002ac2db`
**Related:** Phase 3 P3.4 / plan section 11.1 (which introduced the ratchet), ADR-21 (modular scaffolding), ADR-61 / C26 (loyalty + inventory types moved to `foundation`), ADR-66 (centralized topology authoring), `docs/records/findings/2026-10-24-kasirmu-core-over-size-ceiling.md`.
**Tags:** architecture, debt, gates, crate-boundaries, ratchet

> Cite this record by filename: `docs/decisions/2026-10-24-adr67-core-size-ratchet-measurement.md`.

---

## 1. Context — what the ratchet was for, and whether that job is done

`scripts/verify-core-size.py` counts non-blank production lines under `crates/kasirmu-core/src`
(masking comments and strings, excluding test files and inline `#[cfg(test)]` modules) and fails
when the total rises above `scripts/core-size-baseline.json`'s ceiling. Its own roster note states
the intent verbatim:

> *"The plan's boundary rule for extraction has a number: `crates/kasirmu-core` must not grow as
> modules move out. Without a measured ceiling the extraction is reversible by accident — new logic
> lands back in core and nothing notices."* (`scripts/gates.json`, `core-size-ratchet`)

**That job is complete.** The feature modules the ratchet was guarding did move out: `modules/`
now holds fourteen of them (`crm`, `currency`, `giftcards`, `inventory`, `kitchen`, `loyalty`,
`promotions`, `purchasing`, `reporting`, `sales`, `settings`, `staff`, `tax`, `terminal`), and
`crates/kasirmu-core/src/modules/` no longer exists. So the ratchet is no longer protecting an
extraction in progress; it is counting a number after the extraction finished.

## 2. The measurement that decides this ADR

All figures re-derived 2026-10-24 by importing the checker's own masker, not by counting raw
lines — the two disagree by 38% on the largest file.

| what | production lines | share of the measured total |
|---|---|---|
| `crates/kasirmu-core/src/db/` — the `Store` layer | **27,481** | **67.7%** |
| everything else in the crate | 13,135 | 32.3% |
| **crate total (the measured number)** | **40,616** | 100% |

The `db/` layer is one `impl Store<'_>` surface — inherent methods on the crate's own database
handle. It cannot move out of the crate without moving the crate, so **68% of what the ratchet
measures is immovable by construction.** The ceiling is therefore not a statement about
modularity; it is mostly a statement about how much SQL the product contains.

## 3. The only extraction available, measured

| candidate | production lines | why it is or is not movable |
|---|---|---|
| `topology.rs` | 669 | **movable** — zero `impl Store`, 11 free `pub fn`, Tauri-free, value-level |
| `workspace_type.rs` | 15 | **movable** — bare `&str` constants, and it is the topology contract's vocabulary |
| `db/popularity.rs` | 834 | not movable — one `impl Store` block |
| `db/audit.rs` | 743 | not movable — one `impl Store` block |
| `export/mod.rs` | 620 | not movable — built on `crate::db::Store` + `db::reports` |

**The movable total is 684 lines, 1.7% of the measured number**, taking the ceiling from 40,616 to
39,932.

### 3.1 What that move would cost, and why it is not free

Unlike the framing in the earlier finding, this needs **no new crate**. `foundation` is the correct
home and already exists: its manifest describes it as *"shared contracts, errors, enums"*, it does
not depend on `kasirmu-core` (so no cycle), and it already carries `serde` and `serde_json`. Its
own comment records that it was built to sit below `kasirmu-core`, `kasirmu-api` and the modules at
once — the same position the topology validator needs.

But the move is **five artefacts, not one**:

1. `crates/kasirmu-core/src/topology.rs` → `foundation/src/topology.rs`;
2. `topologySemantics.json` (the vendored contract, 2,515 bytes) and its `.matrix.json` sibling;
3. `scripts/verify-topology-parity.py`, which names a `kasirmu-core` path in **14 places** — but
   only **two are executable** (`VENDORED` and `MATRIX`, the two `Path(...)` constants at :91 and
   :98); the other twelve are prose in the docstring and in two operator-facing message strings.
   Re-verified 2026-10-24: every one of those paths resolves, and the gate is wired in BOTH
   `.github/workflows/dev-ci.yml:1429` and `scripts/check.sh:967`. It was also defect-planted this
   round — adding a single byte to the UI copy produces `DRIFT ... first divergence around line 2`
   and exit 1, with the `cp` command that fixes it. **So this artefact is the cheapest of the five,
   not the riskiest: a two-constant edit in a gate that is known to work.** An earlier draft of this
   ADR called it "six hardcoded paths", which overstated the churn; the conclusion does not change,
   but the cost column was wrong and is corrected here;
4. `workspace_type.rs` and its tests;
5. a `pub use foundation::topology;` re-export in `kasirmu-core`'s `lib.rs`, because all ten
   consumers import `kasirmu_core::topology::…` and the re-export is what keeps every call site
   unchanged.

### 3.2 And it does not decouple anything

The tempting argument for extracting topology is that `kasirmu-api` (the cloud server's router)
would stop depending on `kasirmu-core`. **It would not.** Measured: `kasirmu-api` uses **41
distinct `kasirmu_core::` symbols across 39 files**, including `db::Store`, `migrations::run`,
`migrations::PG_INIT`, `Cart`, `Category`, `crypto::*` and `auth::hash_pin`. Topology is five lines
of that. The dependency edge survives the extraction untouched.

## 4. Decision

**Recommendation (needs ratification):**

**D1 — Stop raising the whole-crate ceiling as a routine act.** The four raises on record moved it
39,068 → 39,069 → 40,417 → 40,597 → 40,616: **+1,548 lines in five days**. Each was individually
justified and correctly attributed, and that is the problem — a ratchet that is raised correctly
every time it fires is not a ratchet, it is a changelog with a build step.

**D2 — Split the measure into the two things it is conflating.** The number currently adds an
immovable database layer (67.7%) to a movable remainder (32.3%). Budget them separately:

| budget | current | what a rise means |
|---|---|---|
| `core::db` | 27,481 | SQL debt; a rise is a product decision, not a modularity regression |
| `core` (everything else) | 13,135 | modularity; a rise means logic landed back in core |

Only the second is what Phase 3 P3.4 was written about. Policing it alone makes the gate say what
it means, and makes 13,135 a number a lane can actually move.

**D3 — The `topology.rs` extraction is APPROVED IN PRINCIPLE but NOT URGENT.** It is technically
clean and needs no new crate, but it buys 1.7% and decouples nothing (§3.1–3.2). It should happen
when `topology.rs` is next edited for its own reasons, not as a size-reduction exercise.

**D4 — Whatever is decided, the baseline's `description` keeps the raise history.** It is the only
place the five-day trajectory above is recorded, and `--emit-baseline` overwrites it with a
one-line default. That hazard is already documented in the file; this decision depends on it.

## 5. Alternatives considered

| alternative | rejected because |
|---|---|
| Extract `topology.rs` now | 1.7% for five artefacts of churn, and it does not decouple `kasirmu-api` |
| Delete the ratchet | It still catches the one thing it was built for — logic landing back in core |
| Raise the ceiling again | The fifth raise in six days; D1 is the argument against |
| Count only non-`db` lines, silently | That is D2, but done without saying so; the split must be visible in the gate's output |

## 6. Consequences

- **If ratified:** `verify-core-size.py` gains a second budget and prints both; the baseline gains a
  `db_ceiling`; `gates.json`'s note is updated to say which budget the Phase 3 P3.4 rule polices.
  The gate stays green at today's numbers — this is a measuring change, not a code change.
- **If declined:** the ceiling keeps being raised with attribution, and the 67.7% immovable share
  continues to make each raise look like drift when it is arithmetic.
- **Either way:** the `topology.rs` move remains available and documented, so the option is not lost.

## 7. What this ADR does NOT claim

- It does not claim `kasirmu-core` is too big. 40,616 lines for a POS kernel plus its whole SQL
  layer is not obviously wrong; the claim is that the *measurement* conflates two questions.
- It does not claim the four raises were mistakes. §D1 says the opposite: they were each correct,
  which is what makes the trend informative.
- It does not re-open the extraction of the fourteen modules that already left.
