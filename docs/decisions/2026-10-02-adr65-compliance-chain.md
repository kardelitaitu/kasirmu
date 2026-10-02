---
num: 65
area: compliance
title: "ADR-65: The Compliance Chain — where fiscal integrity attaches, and the three seams a second market will exercise"
status: Proposed (2026-10-02) — the anchor point is decided; no chain, no certification module and no second locale is built
---

# ADR-65: The Compliance Chain

**Status:** Proposed (2026-10-02). **D1–D2 decide where integrity attaches and when it may ship.
Nothing in §3 is built by this record.**
**Date:** 2026-10-02
**Recorded against:** branch `0.0.41`
**Related:** ADR-64 §2.1 (the anchor this record inherits), ADR-59 §2.3–§2.4 (fiscal data is built;
certification is the module), ADR-59 §Q3 (do not build against an imagined market),
`docs/decisions/2026-10-02-global-kernel-and-region-pack-strategy.md` §2 (the open items this
record takes ownership of).
**Tags:** compliance, fiscal, audit, modules, localisation, gates

> Cite this record by filename, not by number (`docs/decisions/README.md`: numbering has collided
> before — #43 —).

## 1. Context

**1.1 The audit trail is real, append-only, and about actors — not about documents.**
`audit_log` (`20260813_init.sql:38-47`) carries `user_id`, `action`, `target_type`, `target_id`,
`details`, `outcome`, `created_at`, and the migration-`20260920` trigger
`audit_log_immutable_delete` raises on `DELETE` in both engines
(`docs/security/data-residency-and-retention.md:66`; trigger parity pinned at
`platform/core/src/database/migrations_tests.rs:930`, `:939`, `:954`, and the PG port at
`apps/cloud-server/tests/pg_trigger_ports.rs:175`). **No hash, no chain, no link between rows.**
The shape a chain needs is already present and used for something else:
`audit_review_checkpoints` (:49-57) carries `reviewed_through_created_at` **plus** a
tie-breaker `reviewed_through_id` — an ordering pair, built to let a reviewer prove what they had
seen. The same pair is what a content chain would hash over.

**1.2 Numbering proves order, not content.** ADR-59 §2.3 records `fiscal_schemes` and
`document_number_sequences` as **BUILT**, and `db/fiscal.rs` as gap-free by construction: the
counter advances in one `UPDATE … RETURNING` that reads the row's own `period_key`, and a
rolled-back sale consumes no number. That is a strong guarantee about *sequence*. **Nothing hashes
what the document says.** The draft's `fiscal_hash` / `previous_receipt_hash` proposal is
therefore not a refinement of what exists — it is a different guarantee, with no owner.

**1.3 The module kernel has never carried market code.** ADR-59 §1.5 measures fourteen registered
crates, ten of them substantive; §2.4 records that the *fiscal* use is conditional on committing a
market that needs certified signing. So the one seam that must work for a second country is
**unproven** — exercised by ten verticals that share no property with a government integration.

**1.4 Localisation has carried exactly one language.** `shared-ui/locales/` holds 54 `.ftl` files
in two variants, `(default)` and `id`. The mechanism is the right one (@fluent/react, per
`AGENTS.md` §6.3 — **not** ICU MessageFormat, which the draft proposed). The seam has simply never
held a second language, so its failure mode is unknown.

**1.5 The state machine that a chain would hang from does not exist yet.** ADR-64 D4 defines the
tender states and names the transition as the anchor (§2.1 there). ADR-64 is **Proposed**; nothing
is built.

## 2. Decision

**D1 — fiscal integrity attaches to the ADR-64 tender/sale state transition, not to document
numbering and not to `audit_log`.** A numbering chain proves *order*; an audit chain proves *who
did what*. What a fiscal regime asks is that a document's **content** cannot be altered after
issue, so the hash covers the sale/payment state transition, whose fields are already enumerated
and persisted. `audit_log` stays the actor-action record and is **not** rehashed — two chains over
one table is how a later auditor cannot tell which one they are reading.

**D2 — no chain ships until a market mandates one.** The decision taken here is the **anchor
point**, not the build. ADR-59 §2.4's rule is the binding constraint: building `modules/fiscal-*`
against an imagined market is the named error. When a second market with a certification
obligation is committed, the chain lands on the anchor D1 fixed — and the interface it lands on is
already shaped by a real first customer rather than by this record.

**D3 — the chain is not rehashed on re-derivation.** Where a regime requires that a corrected
document carry its predecessor's hash, ADR-64 D4 rule 4 already decides the shape: a correction is
a **new** payment row against the same sale, never an edit of a settled one. A chain that could be
rewritten by an update is not a chain.

## 3. What a second market must exercise, and does not yet

These are the acceptance tests this record adopts. None is built here; each is a gate a second
market has to pass, and each is currently unproven.

| # | Seam | State, measured | Fails how, when exercised |
|---|---|---|---|
| 1 | **A certification module under the kernel** — a `modules/fiscal-*` crate implementing `foundation::contracts::Module` (ADR-59 §2.3) | **Never built.** 14 registered crates, 10 substantive, none market-specific | Dependency edges or a signing key are unavailable to a module; or the release matrix cannot ship a per-market binary |
| 2 | **A second locale through Fluent** | 54 `.ftl` files, one language | Missing keys, plural/select-rule differences, or a receipt template that cannot render the script |
| 3 | **The tender classification across markets** (ADR-64 D1) | TO BUILD | A rail that needs neither of D1's four modes, or a kind the seven-value set cannot hold |
| 4 | **An integrity chain over the D4 transitions** | TO BUILD, and D2 says not yet | The hash cannot be computed offline-first, or the chain forks on a replayed sync packet |

**Acceptance for this record** is a reading, not a build: D1 and D2 recorded here, and the four
rows above either green or explicitly waived with the reason written.

## 4. Consequences

- **Good:** the anchor is fixed while it is cheap to fix, so the chain that eventually ships lands
  on a transition that has a real first market behind it. The four seams above become named
  acceptance tests rather than things the second market discovers.
- **Cost, accepted:** three of the four rows stay red for as long as there is no second market with
  a certification obligation. That is the deliberate price of ADR-59 §2.4's rule, and it is the
  same trade the kernel already made in ADR-59 §3.2.
- **Risk, named:** a second market may need integrity over something ADR-64's tender state does
  not model — a cancellation, a price change after issue, a partial refund. D1 is cheap to revise
  only while the state machine is unbuilt; after D4 ships, extending the hashed transition is a
  migration and a chain break. **That is the deadline this record sets implicitly.**
- **Not decided here:** what a regime's hashing algorithm or canonicalisation must be; retention
  periods; the reviewer workflow over a chain (`audit_review_checkpoints` is the existing shape);
  whether per-country flags are a third axis beside tier and market (still open in the strategy
  note §2).

## References

- `crates/kasirmu-core/migrations/20260813_init.sql:38-47` — `audit_log`; `:49-57` —
  `audit_review_checkpoints` and its ordering pair
- `platform/core/src/database/migrations_tests.rs:930`, `:939`, `:954` — the
  `audit_log_immutable_delete` trigger, both engines
- `apps/cloud-server/tests/pg_trigger_ports.rs:175` — the PG port parity test
- `docs/security/data-residency-and-retention.md:66` — both engines raise on DELETE
- `crates/kasirmu-core/src/db/fiscal.rs` — the gap-free counter ADR-59 §2.3 cites
- `foundation/src/contracts.rs` — the `Module` contract a certification crate implements
- `shared-ui/locales/` — 54 `.ftl` files, `(default)` + `id` only
- `AGENTS.md` §6.3 — @fluent/react is the localisation standard
- ADR-64 §2.1 (anchor), D4 rule 4 (a correction is a new row), D1 (the classification)
- ADR-59 §1.5, §2.3, §2.4, §3.2, §Q3 — kernel state, fiscal data built, certification conditional,
  the accepted cost, and the no-imagined-market rule
- `docs/decisions/2026-10-02-global-kernel-and-region-pack-strategy.md` §2 — the open items

> last audited 02-10-26 by DSH
