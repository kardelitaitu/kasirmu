# 30-Day Development Plan — 2026-11-09 → 2026-12-09

> Version locked at `0.0.41`. Branch: stay on the checked-out branch; never create or switch one.
> This plan ends 6 days before the beta code freeze (2026-12-15, per
> `todo-beta-testing-january-2027.md` §3.3), so its last week is deliberately a
> freeze-readiness week and not a feature week.
>
> Acceptance command for the plan as a whole:
>
> ```bash
> cargo check -p kasirmu-app -p kasirmu-mobile && cd ui && npm run check:all
> ```
>
> Every path and command below was checked against the live tree on 2026-11-09 before
> being written here. Nothing in this plan is a hope: each item names the command that
> decides it.

---

## 1. Where the tree actually is (measured, not remembered)

| Fact | Value at plan start | Command that produced it |
|---|---|---|
| Debt ledger | **165 defined, 165 closed, 0 open** | `python scripts/check-debt-ledger.py` |
| Round log | 182 entries, 51–232 consecutive, 1 addendum | `python scripts/check-register-hygiene.py` |
| Checker contracts | **18 of 70** contracted; 52 owed | `python scripts/census-checker-contracts.py` |
| Docker daemon | **UP** (was down at the last probe, r159) | `docker info` |
| Beta Phase 1–2 | **complete** (fault injection, telemetry, packaging) | `todo-beta-testing-january-2027.md` §2 |
| Beta Phase 3 | onboarding wizard done; recruitment + freeze open | same, §3 |
| Root policy | **RED**: `todo.md` stray + 2 empty temp dirs | `python scripts/verify-root-policy.py` |
| Core size | **RED**: ADR-59 +64 over the ratchet | `python scripts/verify-core-size.py` |

The honest reading of that table: **the debt ledger is empty and the beta checklist is
nearly empty**, which means the remaining risk is not "unfinished work items". It is
that three of the tree's own gates are RED or have been unable to run, and a beta
cannot be certified on gates that cannot execute. Week 1 targets exactly that.

---

## 2. Objective of the 30 days

By 2026-12-09 the tree must satisfy four sentences:

1. **Every gate in `scripts/check.sh` exits 0**, or carries a dated, owned exception.
2. **The PG-gated evidence class is recorded again** — E2E, coverage floors and
   nextest-junit receipts exist with counts and dates, not silence.
3. **The money paths survive disaster** — a rehearsed backup/restore and upgrade
   round-trip that asserts ledger equality, not a claim that backup exists.
4. **A merchant can go from install to first receipt in five minutes on both
   platforms**, timed on real hardware, with no raw error text in front of them.

**Non-goals, stated so they are not smuggled in:** no new features, no version bumps,
no branch changes, no schema migrations without an ADR, and no attempt to "close the
backlog" — 52 un-contracted checkers cannot be finished in 30 days and pretending
otherwise is how a plan becomes fiction.

---

## 3. Week 1 — 2026-11-09 → 11-15 · Make the gates that cannot run, run

*Rationale: a gate that cannot execute is indistinguishable from a gate that passes.
Three of them have been in that state, and the Docker one suppressed the heaviest
evidence class for a long stretch of rounds.*

### 1.1 Re-record the PG-gated receipts (the highest-value item in the plan)

Docker is up, so the evidence that has been missing can finally be produced.

```bash
python scripts/verify-pg-tests-ran.py
python scripts/verify-coverage-floors.py
python scripts/verify-deployment.py
```

- **Acceptance:** each exits 0, and the counts they print are pasted into this file's
  Week 1 log with the date. A green exit with no number quoted is not evidence.
- **Risk:** the first run may be red for reasons unrelated to the code (stale image,
  PG state). `bash scripts/reset-dev-pg.sh` through Git's bash is the documented reset;
  a red that survives the reset becomes a bug ticket, not a blocker.

### 1.2 Close the root-policy RED

```bash
python scripts/verify-root-policy.py
```

- `todo.md` is the owner's working plan at the root — the same class as
  `todo-review-type.md` and `todo-optimize-crates.md`, which are already allowlisted.
  Add its name to `ROOT_FILE_ALLOWLIST` in `scripts/verify-root-policy.py` **in the same
  commit that keeps the file**, per that gate's own instruction.
- Remove the two empty temp directories it names (git cannot see them, so no other
  detector ever will).
- **Acceptance:** `python scripts/verify-root-policy.py` exits 0.

### 1.3 Resolve the core-size RED (ADR-59)

```bash
python scripts/verify-core-size.py
```

- ADR-59's SEA market presets added +64 lines over the ratchet. Two legitimate exits:
  move the preset table into its own module, or raise the ratchet **with a dated
  justification recorded in the register**. Silently bumping the number is the one
  outcome this item forbids.
- **Acceptance:** gate exits 0 and the chosen route is named in the Week 1 log.

### 1.4 First full E2E run with Docker available

```bash
cd ui && npm run e2e
```

- **Acceptance:** the suite either passes, or every failure is filed with the spec name
  and the error text. A skipped suite must be explained in the log, not omitted.

---

## 4. Week 2 — 11-16 → 11-22 · Prove the money paths survive disaster

*Rationale: beta merchants will lose a tablet, pull a plug, and unplug a router. The
code has the primitives; the plan's job is to make them *demonstrated*.*

### 2.1 Backup/restore rehearsal with ledger equality

The primitives exist: `Database::backup` (`crates/kasirmu-core/src/db/mod.rs:308`) and
`restore_from` (`crates/kasirmu-core/src/db/recovery.rs:310`).

- **Build:** a test that seeds a shift with sales, tenders, stock movements and gift
  cards; backs up mid-shift; restores into a fresh path; then asserts **equality of
  money totals (`Money`, minor units), stock levels, and the audit hash chain**.
- **Acceptance:** the new test passes and a `*_tests.rs` sibling holds it (no tests
  inside production `.rs`, per `AGENTS.md` §6.2). Quote the asserted quantities.
- **Also record:** an RPO/RTO sentence a support person could act on ("up to N
  seconds of sales lost if the tablet dies mid-shift") derived from the test's
  checkpoint interval, not invented.

### 2.2 Upgrade round-trip

```bash
node scripts/verify-updater-signature.mjs
```

- Verify the v0.0.41 → next install preserves the database and settings, and write the
  rollback procedure. **Acceptance:** signature check exits 0 and the round-trip is
  described as numbered steps someone else could follow.

### 2.3 Sync convergence under hostile clocks

- Exercise the existing vector-clock tests with skewed and equal timestamps and assert
  **zero divergence and no duplicate ledger rows**. The two named cases already live at
  `reconnection_and_deterministic_monotonic_delta_sync_after_offline_sales`
  (`platform/sync/src/daemon_tests.rs:2405`) and
  `network_jitter_resilience_and_exponential_backoff_retry`
  (`platform/sync/src/daemon_tests.rs:2535`); this item adds the clock-skew case, which
  is the one beta means by "two tablets".
  > Citation correction, 2026-11-09: `todo-beta-testing-january-2027.md` §2.1 names these
  > as `test_reconnection_delta_sync` and `test_network_jitter_resilience`, and **neither
  > name exists in the tree** (measured by `grep -rn` over `crates/` and `platform/`).
  > The names above are the real ones. The beta plan's copy is stale and should be
  > repaired by its owner rather than inherited by this plan.
- **Acceptance:** named tests pass; the convergence assertion is stated in money and
  row counts, not "looks right".

---

## 5. Week 3 — 11-23 → 11-29 · Merchant-facing truthfulness

*Rationale: Phase 2 built the diagnostics. Week 3 is about what the merchant actually
sees — the part no unit test can certify.*

### 3.1 The five-minute audit, timed on real hardware

- Desktop: install → onboarding → seed products → pair printer → print test receipt →
  first sale. **Timed with a stopwatch, then repeated once** so the number is not a
  first-run fluke.
- Tablet: same path over wireless ADB against the running app, using the device
  evidence route (screenshots + UI dump), not a desktop proxy.
- **Acceptance:** two timings per platform, in the log, plus a list of every friction
  that cost more than 20 seconds. Fixes ship only where the fix is smaller than the
  friction.

### 3.2 Error-message quality

- Audit every user-visible error path reachable while offline: no raw Rust error text,
  no silent failure, and no "success" toast for an operation that was queued rather
  than applied. Queued work must say so.
- **Acceptance:** a table of (path, what it says, what it should say) with the resolved
  rows marked; `cd ui && npm run lint` and `npm run typecheck` clean.

### 3.3 Decide the i18n cleanup debt

- 55 Indonesian-only keys are recorded cleanup debt, deliberately preserved as test
  fixtures (`I18N-01`). Decide *this month*: translate them, or document them as
  permanent fixtures with the tests that pin them.
- **Acceptance:** either route leaves `python scripts/verify-ftl-orphans.py` and
  `python scripts/verify-bundle-parity.py` green, and the decision is written down.

### 3.4 Security posture before strangers touch it

- Exercise the RBAC matrix (staff vs owner vs admin) on both shells; confirm no
  secret reaches a bundle; confirm licence enforcement **fails closed** where it is
  meant to (`OZ_ADMIN_KEY`, `OZ_API_SECRET`, `OZ_LICENSE_PRIVATE_KEY`) and that the
  one fail-open knob (`OZ_ENFORCE_PLANS`) is deliberate.
- **Acceptance:** `python scripts/verify-ipc-parity.py` clean plus a written
  fail-open/fail-closed table naming each variable and its direction.

---

## 6. Week 4 — 11-30 → 12-09 · Freeze-ready

### 4.1 Full acceptance dry run

```bash
# run through Git's bash BY FULL PATH -- bare `bash` resolves to WSL here and hangs
bash scripts/check.sh            # full local matrix, every step
cd ui && npm run check:all
```

- **Acceptance:** every step's exit code recorded. Any red is either fixed or added to
  the freeze backlog with an owner. This is the week's primary deliverable and it may
  not be compressed.

### 4.2 Bounded reliability sweep

- At most **four** checkers/week from
  `python scripts/census-checker-contracts.py --next-target`. The census exists so this
  is a decision, not a guess; the quota exists so the sweep never eats a Week 1–3 item.
- **Acceptance:** each converted checker has a ladder whose probe kills; the census
  count decreases by exactly the number converted.

### 4.3 Rebuild release artifacts from a clean tree

- Rebuild the signed installers and verify digests rather than trusting a cached
  artifact. **Acceptance:** digests quoted before and after; a mismatch is a finding.

### 4.4 Freeze declaration

- Publish the bug-triage template, state the scope lock date, and list every known
  exception with its owner. **Acceptance:** the freeze is declared in a commit, so it
  has a timestamp rather than a memory.

---

## 7. Success criteria for these 30 days

| # | Criterion | Decided by |
|---|---|---|
| 1 | `scripts/check.sh` fully green or every red owned | §4.1 run |
| 2 | PG-gated receipts exist with counts and dates | §1.1 |
| 3 | Backup/restore proves ledger equality | §2.1 test |
| 4 | Five-minute onboarding timed on both platforms | §3.1 |
| 5 | Zero raw error text on offline paths | §3.2 |
| 6 | Root-policy and core-size REDs closed | §1.2, §1.3 |
| 7 | Tree frozen with a dated commit | §4.4 |

---

## 8. Honest limits of this plan

- **It cannot prove recruitment.** Cohorts A and B are business work; the plan can only
  ensure the software is worth recruiting for.
- **On-device claims need the device.** Every tablet timing in §3.1 is void unless the
  physical tablet is attached; a desktop proxy would be a false certificate.
- **30 days cannot close 52 checkers.** The §4.2 quota is deliberate and the plan does
  not pretend the arc finishes.
- **The baseline table rots.** It is a dated measurement (2026-11-09), not a constant.
  Re-run the commands rather than quoting this file at a later date.
- **Two REDs may be deeper than they look.** If the core-size excess is structural
  rather than local, §1.3 may consume more of Week 1 than planned; the fallback is to
  record a dated ratchet and move on, not to hide it.

---

## 9. Week logs (fill in as the work lands)

### Week 1
- [ ] 1.1 PG-gated receipts re-recorded — counts:
- [ ] 1.2 Root-policy RED closed
- [ ] 1.3 Core-size RED resolved — route:
- [ ] 1.4 E2E baseline — result:

### Week 2
- [ ] 2.1 Backup/restore equality test — asserted:
- [ ] 2.2 Upgrade round-trip + rollback written
- [ ] 2.3 Clock-skew convergence test

### Week 3
- [ ] 3.1 Five-minute timings (desktop / tablet):
- [ ] 3.2 Error-path table complete
- [ ] 3.3 i18n decision recorded
- [ ] 3.4 Security table written

### Week 4
- [ ] 4.1 Full acceptance run — step exit codes recorded
- [ ] 4.2 Sweep conversions:
- [ ] 4.3 Artifact digests verified
- [ ] 4.4 Freeze declared (commit):
