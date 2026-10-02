<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with a prior marker re-verified rather than replaced. It is the index of the decision directory, and the count in it matters more than the layout: twenty-eight distinct decision references were resolved against the tree this pass, and all twenty-eight correspond to real files. An index listing decisions that do not exist sends a reader looking for an argument never written, and that failure is absent here. · THE KNOWN DUPLICATE IS ITS MOST INTERESTING PROPERTY, because it is a number that appears twice and the tree says so rather than hiding it. Numbering has collided before in this directory — a companion record audited earlier in this campaign cited the collision explicitly and instructed readers to cite decisions by FILENAME rather than by number, and the top-level documentation index independently records the same collision producing a duplicate row. Three documents agreeing on one known defect is healthy redundancy: the number is ambiguous, everyone says so, and the workaround is written down. A repository that renumbered to hide this would have produced a cleaner index and a worse record. · WHAT THE INDEX IS FOR, given the volume: fifty-plus decisions is past the point where a reader browses. Its job is to let someone find the decision governing a specific question without reading all of them — a lookup problem rather than a reading problem. The companion architecture-boundary decision and the headless bridge decision are both findable here, which is how this campaign reached them. · NOT re-measured: whether each decision's own status line is accurate, beyond the automated drift check this campaign has run every round and which reports no drift across the hand-maintained table. Whether the CODE matches each decision is the per-decision question those documents now carry stamps for. · Prior marker retained; footer re-dated to match the new stamp. -->
# Architectural Decision Records

Every significant architectural decision in the POS framework is recorded as
an ADR in this directory (`docs/decisions/`). Each ADR follows the
"Context — Decision — Consequences" template and carries a `Status:` line in
its header. Some ADRs have a companion `*.status.md` file with a fuller
implementation-status walkthrough.

- Numbered ADRs run **#1–#61** and are the primary record. Re-derive the ceiling rather than
  trusting it: `ls docs/decisions/*adr*.md | sed 's/.*adr\([0-9]*\).*/\1/' | sort -n | tail -1`
  → `61` (measured 2026-09-28; the ceiling was 52 when this line was written, which is exactly
  how a range claim rots — it grows by one per ADR and nothing re-derives it).
- **Seven numbers are unused** — #16 and #24–#29 are claimed by no file. `ADR #16` and
  `ADR #24`–`#29` are cited by nothing anywhere in the repo
  (re-derive: `grep -rn 'ADR #16\|ADR #2[4-9]' --include='*.md' .` → one hit, this sentence).
  They are skipped numbers, not lost documents; do not go looking for them.
- **The hand table below is NOT the authority.** It used to be incomplete — **#53 had
  no row** while the file existed on disk and in the generated `docs/records/README.md`
  (`docs/decisions/2026-09-15-adr53-ui-vocabulary-boundary.md`) — and the row was added
  2026-09-23; as of 2026-09-24 every numbered ADR file has exactly one row (re-derive:
  match frontmatter `num:` files against the `^| N |` rows below; measured 54/54).
  Find a missing row the same way. The generated index still wins where they disagree.
  **Re-measured 2026-09-28 and this bullet's stated method does not reproduce its own number:**
  `Select-String -Path 'docs/decisions/*adr*.md' -Pattern '^num:'` returns **28** files against the
  **55** rows the table now holds, while `check-adr-status.py` reports **0 status drift across those
  55 rows** — so every row resolves to a file and every verdict matches, but `num:`-matching is not
  the method that produced "54/54". Recorded rather than swapped: a count whose stated method cannot
  reproduce it is a finding for a docs-auditor pass, not a number to edit.
- **`#43` is ambiguous and has been since 2026-09-02.** Two files claim it:
  `2026-07-24-react-only-decision.md` (ADR #43 – React-only UI decision) and
  `2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md` (ADR #43: Cloud Sync
  Performance & Scale-Out Roadmap). The collision arrived when the newer file took a
  number already in use, and both meanings are cited in the wild — `docs/guides/EXTENDING.md`
  means the cloud-sync one when it writes "the transactional outbox (ADR #43 D7)" (D7 is a
  phase of it), while `docs/records/README.md` maps 43 to the React-only decision. 37
  references to `ADR #43` exist across the repo. Renaming either file would break those
  citations, so this is recorded rather than fixed: **cite #43 by filename, not number**,
  until someone decides which one moves.
- Research notes and phased implementation docs (topology phases, sync
  phases) are recorded here too, keyed by date rather than number.

## Numbered ADRs

> **[`docs/records/README.md`](../records/README.md) is the generated, authoritative index** — produced by
> `scripts/generate-records-index.mjs` from each record's YAML front matter. The table below is a
> hand-maintained convenience copy: it can lag, and where the two disagree the generated index wins.

| # | Title | Status |
|---|-------|--------|
| 1 | [Module System Design](./2026-01-15-module-system-design.md) | Implemented (2026-07-15) |
| 2 | [Event Bus Design](./2026-02-01-event-bus-design.md) | Implemented (2026-07-15) |
| 3 | [Frontend Restructure](./2026-03-01-frontend-restructure.md) | Implemented (2026-07-15) |
| 4 | [Store-First Tenancy & Workspace Type/Instance Architecture](./2026-07-10-workspace-type-instance-design.md) | Implemented (2026-07-10) |
| 5 | [Subscription Tier & Entitlement Architecture](./archived/2026-07-10-subscription-tier-entitlement.md) | Superseded (2026-07-10) — tier lineup & quotas superseded by `subscription-tiers.md` (FINAL, approved 2026-08-17) |
| 6 | [CRDT Delta Ledger & Offline Sync](./2026-07-10-crdt-delta-ledger-offline-sync.md) | Implemented (2026-07-15) |
| 7 | [Data Scope Guard & Query Enforcement](./2026-07-10-data-scope-guard.md) | Implemented (2026-07-10) |
| 8 | [Scoped Real-Time Event Bus](./2026-07-10-scoped-event-bus.md) | Implemented (2026-07-10) |
| 9 | [License Server Architecture (PocketBase on Northflank)](./2026-07-10-license-server.md) | Implemented (2026-07-15) |
| 10 | [Sync Performance Strategy](./2026-07-13-sync-performance-compression-batching.md) | Implemented (all 3 phases complete as of 2026-07-15) |
| 11 | [Zero-Downtime VPS Migration Strategy](./2026-07-13-zero-downtime-vps-migration.md) | Implemented (2026-07-15) |
| 12 | [Whitelabel Branding System](./2026-07-15-whitelabel-branding-system.md) | Implemented (2026-07-15) |
| 13 | [Desktop App Updater](./2026-07-16-desktop-app-updater.md) | Partially Implemented (2026-07-16) — Settings About page UI is live; see ADR #14 for release automation |
| 14 | [Release Automation](./2026-07-16-release-automation.md) | Proposed (2026-07-16) |
| 15 | [Shadow Banding Mitigation — CSS Noise Dithering](./2026-07-18-shadow-banding-css-dither.md) | Implemented (2026-07-26) |
| 17 | [KDS Multi-Layout System](./2026-07-18-kds-multi-layout-system.md) | Implemented (2026-07-26) |
| 18 | [Multi-Location Inventory](./2026-07-18-multi-location-inventory.md) | Implemented (2026-07-19) |
| 19 | [Sale-Deduction Flow for Multi-Location Inventory](./2026-07-19-sale-deduction-multi-location.md) | Implemented (see [status](./2026-07-19-sale-deduction-multi-location.status.md)) |
| 20 | [Payment-Capture Ordering — Stock Reservation Before Payment Capture](./2026-07-19-payment-capture-ordering.md) | Implemented (see [status](./2026-07-19-payment-capture-ordering.status.md)) |
| 21 | [Sync Conflict Resolution Strategy](./2026-07-20-sync-conflict-resolution-strategy.md) | Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor) |
| 22 | [Visual Node-Based Store & Workspace Topology Builder](./2026-07-20-node-based-store-topology-builder.md) | Implemented (2026-07-22) — Amended (2026-07-23) |
| 23 | [Free Trial Lifecycle & License Activation Workflow](./archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md) | Re-scoped — superseded by subscription-tiers.md §4 (FINAL, approved 2026-08-17) |
| 30 | [Domain Module Extraction & oz-core Decomposition](./2026-07-24-domain-module-extraction.md) | Accepted — Phase 4 (Currency) Complete (2026-07-25) |
| 43 | [React-only UI Decision](./2026-07-24-react-only-decision.md) | Accepted (2026-07-24) |
| 31 | [Decentralized UI Feature Module Registration](./2026-07-24-decentralized-ui-module-registration.md) | Accepted (2026-07-24) |
| 32 | [DB Layer Extraction (R2) & Platform File Split (R5)](./2026-07-25-db-extraction-and-platform-split.md) | Proposed |
| 33 | [Panic Policy & Production unwrap/expect Enforcement](./2026-08-03-panic-policy.md) | Implemented (2026-08-03) |
| 34 | [Topology Editor as the Business Logic Builder](./2026-08-07-adr34-business-logic-topology-builder.md) | Proposed |
| 44 | [Typed Connection Gating & Live Validation (Implementation)](./2026-08-08-adr44-typed-connection-gating.md) | Implemented (2026-08-08) |
| 35 | [RBAC — Role Assignments with Branch/Workspace Scopes and User Profile Data](./2026-08-11-adr35-rbac-role-assignments-user-profile.md) | Accepted (ratified 2026-08-11) |
| 36 | [Retail POS Product Attributes — Cost, Brand, Rack, Notes + Configurable Columns](./2026-08-11-adr36-retail-product-attributes.md) | Implemented (2026-08-12) |
| 37 | [Product Popularity Index — Weighted Activity Score for Retail Sorting](./2026-08-11-adr37-product-popularity-index.md) | Implemented (2026-08-12) |
| 38 | [Retail POS Row Context Menu — View Product Images in Browser](./2026-08-11-adr38-retail-row-context-menu-browser-images.md) | Implemented (2026-08-12) |
| 39 | [Midtrans QRIS Subscription Payments (Phase 2)](./2026-08-18-adr39-midtrans-subscription-payments.md) | Implemented (2026-08-18) — `docs/plans/_active/todo.md` C3.1 |
| 40 | [Multi-Terminal Peer Model](./2026-08-20-adr40-multi-terminal-peer-model.md) | Implemented (2026-08-20) |
| 41 | [App Lifecycle, Device Onboarding, Dynamic Topology Workspaces, and Two-Layer Gated Home (Tier & RBAC)](./2026-08-28-adr41-app-lifecycle-device-onboarding-topology-home-gating.md) | Accepted (2026-08-28) |
| 42 | [Website Admin Dashboard & User Dashboard (Subdomain Architecture)](./2026-08-28-adr42-website-admin-and-user-dashboard.md) | Partially Implemented (2026-08-28) |
| 43 | [Cloud Sync Performance & Scale-Out Roadmap](./2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md) | Implemented (D1–D4, D7, D9-ready) |
| 45 | [Topology Semantic Contract v2 — Endpoint Predicates, Kind Registry, Deliberate Cold Start, and Theme Parity](./2026-09-02-adr45-topology-semantic-contract-v2.md) | Accepted — §1–§3, §4.1, §5, §4.2 storage + IPC + migration function, §4.3 ordering rule + backend parity implemented (2026-09-02); §4.2 UI swap and §4.3 checklist UI proposed |
| 46 | [Topology Revision History, Change Notes, and Draft Restore](./2026-09-07-adr46-topology-revision-history-and-restore.md) | Accepted (2026-09-07) — Phase 1 complete (racing-publishes gate met), Phase 2 in progress (graph differ 51ad987f) |
| 47 | [Scoped Authorization — Role Assignments with Explicit Scopes](./2026-09-07-adr47-scoped-authorization-assignments.md) | Accepted (2026-09-07, sole-maintainer ruling — all five recommendations adopted: `role_assignments` table, single scoped choke point, downward-only inheritance, key-set custom roles, org-wide backfill) — assignment model built across slices (scope axis 94e8a100, scoped pairs 8c0ae0b4, staff UI 7f7d4ec4, choke-point gate 453c629f); gates §B entitlements, audit baseline, Phase 3 roles |
| 48 | [Location Timezone Representation & as_of Semantics](./2026-09-09-adr48-timezone-representation.md) | Accepted (2026-09-09) |
| 49 | [Headless Command Bridge — Moving Command Bodies into crates/oz-bridge](./2026-09-11-adr49-headless-command-bridge.md) | Accepted (2026-09-11) — implemented for the desktop shell; tablet client not started |
| 50 | [Sync Authentication Hardening (token refresh, gating, terminal credentials)](./2026-09-11-adr50-sync-auth-hardening.md) | Accepted (2026-09-11) - partially implemented |
| 51 | [Sealed Settings Ingest Policy — One Funnel for Every Untrusted Settings Lane](./2026-09-11-adr51-sealed-settings-ingest-policy.md) | Accepted (2026-09-11) |
| 52 | [Tracked Settings Funnel Refuses Cleartext Credentials](./2026-09-12-adr52-tracked-settings-funnel-refuses-cleartext-credentials.md) | Accepted (2026-09-12) |
| 53 | [The UI Vocabulary Boundary — what the application layer may say about a renderer](./2026-09-15-adr53-ui-vocabulary-boundary.md) | Adopted (2026-09-15) — Option A implemented as rule ui-framework-vocabulary at 0ca2c0f27, landing at zero findings with no baseline; the Option A premise was corrected ~22:55, see Correction. **Row added 2026-09-23 (C30): it was missing from this hand table while existing on disk and in the generated index** |
| 54 | [Google Sign-In — web sign-in/sign-up and desktop setup-wizard account linking](./2026-09-19-adr54-google-sign-in.md) | Proposed (2026-09-19) — nothing implemented |
| 55 | [One Server Origin — the compiled list, the fallback pair and the allowlists that must agree with it](./2026-09-19-adr55-server-origin-model.md) | Implemented (2026-09-19) — resolver, literal collapse, drift gate, attestation (endpoint and client) and the boot-time cascade all shipped |
| 56 | [First-Run Provisioning — identity-first onboarding, one provisioning transaction, and the retirement of the multi-boolean boot gate](./2026-09-21-adr56-first-run-provisioning.md) | Partially implemented (2026-09-21; re-audited 2026-09-22) — §2.1, §2.2, §2.5, §2.6, §5 and the `local` tier of §2.3/§2.4 shipped; §2.3's `identify` leg (linked tier) still pending |
| 57 | [Client Tamper Resistance Without Play Integrity — signature pinning, a bounded grace ceiling, and server-side detection](./2026-09-21-adr57-client-tamper-resistance.md) | Proposed (2026-09-21) — part implemented, part to build |
| 58 | [Pre-Expiry Re-Authentication, Manual Revocation, and the Locked State](./2026-09-21-adr58-online-licence-heartbeat-and-revocation.md) | Partially implemented (2026-09-21; re-audited 2026-09-22) — Revoked state, session lock, export twin command, ride-along, per-device renewal refusal and the Rust-side pre-expiry re-auth shipped; the export twin has no UI caller, so §2.6 is unreachable |
| 59 | [Regional Topology and Modular Delivery — market scope on the Legal Entity, residency on the Organization, and the built-vs-module seam](./2026-09-21-adr59-regional-topology-and-modular-delivery.md) | Proposed (2026-09-21) — region field, admin route and audit trail shipped; topology and modules not |
| 60 | [Orientation & Adaptive Layout Strategy — the hybrid ladder (shell media queries, container queries, a declared escape hatch, and a walker gate)](./2026-09-21-adr60-orientation-and-adaptive-layout-strategy.md) | Implemented (2026-09-21) — all four tiers landed and gated; 7 sheets migrated |
| 61 | [Architecture Boundary Rule Tiers — a named rule for re-export-only edges and a governed expiry](./2026-09-28-adr61-architecture-boundary-rule-tiers.md) | Implemented (2026-09-28) — the core-type-shim rule, the quarter-renewal invariant, the baseline re-tier, the currency edge closure and all seven type-shim edges closed and the baseline emptied to 0 tracked findings |
| 62 | [Module Seam Taxonomy — command contributors, projection subscribers, and the reporting-facade exception](./2026-09-30-adr62-module-seam-taxonomy.md) | Accepted (2026-09-30) — the taxonomy is written and grounded in the Phase 0 handler census; the check that enforces it (a handler_type classification gate) is not built |
| 63 | [The EventSink Seam — grading R10 #3 with a rule that arrived at zero](./2026-10-01-adr63-event-sink-seam.md) | Implemented (2026-10-04) — rule `event-sink-seam` landed at zero findings with no baseline; the four remaining raw-handle broadcasts were routed through BridgeCtx::emitter; R10's other three invariants disposed of by measurement (D6) |
| 64 | [The Tender Vocabulary and the Offline Tender State — one classification per payment, and no electronic tender settles on trust](./2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md) | Proposed (2026-10-02) — every decision D1–D6 is TO BUILD; §1 measurements taken in this checkout on branch `0.0.41` |
| 65 | [The Compliance Chain — where fiscal integrity attaches, and the three seams a second market will exercise](./2026-10-02-adr65-compliance-chain.md) | Proposed (2026-10-02) — the anchor point is decided and D2 forbids building the chain before a market mandates it; the four acceptance rows in §3 are unproven |

## Research notes

- [Global Kernel and Region Packs — strategy note](./2026-10-02-global-kernel-and-region-pack-strategy.md) — the demoted ADR-64 draft; decides nothing, defers to ADR-59
- [On-Device ML for Demand Forecasting](./2026-07-20-ai-demand-forecasting-research.md)
- [Cloud Warehouse Analytics Export](./2026-07-20-cloud-warehouse-analytics-research.md)
- [CRDT-Based Conflict-Free Replication](./2026-07-20-crdt-sync-research.md)
- [Voice-Controlled Checkout Research](./2026-07-20-voice-controlled-checkout-research.md)

## Phased implementation docs

- **Sync:** [Phase 1 diagnostics](./2026-08-09-local-sync-phase1-diagnostics.md),
  [Phase 2 startup](./2026-08-09-local-sync-phase2-startup.md),
  [Phase 3 Tauri diagnostics](./2026-08-09-local-sync-phase3-tauri-diagnostics.md),
  [Phase 4 verification](./2026-08-09-local-sync-phase4-verification.md),
  [isolated E2E harness](./2026-08-09-local-sync-isolated-e2e-harness.md),
  [status/retry](./2026-08-09-local-sync-status-retry.md),
  [auth hardening / ADR #50](./2026-09-11-adr50-sync-auth-hardening.md),
  [plan gating](./2026-08-09-sync-plan-gating.md)
- **Topology:** [Phase 1 branch persistence](./2026-08-09-topology-phase1-branch-persistence.md),
  [Phase 2 KDS source parity](./2026-08-09-topology-phase2-kds-source-parity.md),
  [Phase 3 semantic wire parity](./2026-08-09-topology-phase3-semantic-wire-parity.md),
  [Phase 4 runtime compiler](./2026-08-09-topology-phase4-runtime-compiler.md),
  [Phase 5 cycle validation](./2026-08-09-topology-phase5-cycle-validation.md),
  [Phase 6 legacy wire hardening](./2026-08-09-topology-phase6-legacy-wire-hardening.md),
  [Phase 7 KDS runtime consumer](./2026-08-09-topology-phase7-kds-runtime-consumer.md),
  [Phase 8 KDS fan-out](./2026-08-09-topology-phase8-kds-fanout.md),
  [Phase 9 stock routing](./2026-08-09-topology-phase9-stock-routing.md),
  [Phase 10 multi-warehouse allocation](./2026-08-09-topology-phase10-multi-warehouse-allocation.md)

## Trial & Billing Path — Cross-Reference

The trial lifecycle, license activation, and payment webhooks span four ADRs.
This table summarizes each ADR's implementation status and deviations from
the original design, so a reader can trace the shipped behavior back to the
authoritative record.

| ADR | Title | Status | Deviations from Original Design |
|-----|-------|--------|--------------------------------|
| [#5](./archived/2026-07-10-subscription-tier-entitlement.md) | Subscription Tier & Entitlement Architecture | Superseded for tier lineup/quotas by `subscription-tiers.md`; mechanism still valid | Tier lineup updated to Free · Plus · Pro · Premium · Enterprise (ADR #5 had Free / Pro / Premium / Enterprise). Quota values migrated in `subscription.rs` (C0.1). |
| [#9](./2026-07-10-license-server.md) | License Server Architecture (PocketBase on Northflank) | Implemented (2026-07-15) | **Dev 1:** `/status` changed from `GET /{tenant_id}` to `POST` with `Authorization: Bearer` auth (avoids leaking api_key in URLs). **Dev 2:** `trial_registrations` schema updated with `tenant_id` relation and `macos`/`unknown` platform values. |
| [#23](./archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md) | Free Trial Lifecycle & License Activation Workflow | Re-scoped by `subscription-tiers.md` §4 | **Dev 1:** Segmented trials shipped (14-day Plus general / 14-day Pro restaurant-cafe / 30-day Pro enterprise-referral). **Dev 2:** Paddle `custom_data` contract documented (`email` + `bundle` + `phone`; vertical not carried). **Dev 3:** Hardware-fingerprint trial lock shipped end-to-end (`trial_registrations` + `POST /license/trial` + `enforceTrialLock` + client `get_hardware_fingerprint`). |
| [#39](./2026-08-18-adr39-midtrans-subscription-payments.md) | Midtrans QRIS Subscription Payments (Phase 2) | Implemented (2026-08-18) | **Dev 1:** Signature is plain SHA-512 (not HMAC-SHA512). **Dev 2:** Midtrans custom-field contract documented (`custom_field1` tier, `custom_field2` email, `custom_field3` period, `custom_field4` bundle). **Dev 3:** `custom_field3` period cross-checked against price map. **Dev 4:** Amount-authoritative tier resolution (amount → map lookup is primary; custom_field1 cross-checked). **Dev 5:** Failed-payment grace via `calculateGraceUntil`. **Dev 6:** Dedup by `transaction_id` only. **Dev 7:** Subscription-notification canonical string not implemented (falls through default branch). **Dev 8:** Webhook-minted key activation fast-path in `activate.go`. |

> The `subscription-tiers.md` source-of-truth spec (§4 trial strategy, §3
> quota matrix) and `docs/plans/_active/todo.md` Phase C track the implementation details.

## Conventions

- Add new ADRs as `docs/decisions/YYYY-MM-DD-adrNN-<slug>.md` with a
  `Status:` line in the header; update this index when a new ADR lands.
- **The Status column's *status word* must match the ADR's own YAML frontmatter
  `status:`** — Proposed / Accepted / Approved / Implemented / Partially Implemented /
  Superseded / Re-scoped. What follows the word may be abbreviated, extended, or replaced
  by a link to a companion `*.status.md` (rows #19 and #20 do exactly that), but a cell may
  not silently change the verdict. Two live divergences were corrected on 08-09-26: #45
  opened its cell with "§1–§3, … Implemented (2026-09-02)" and dropped the "Accepted —"
  that begins its own frontmatter, making an accepted-with-work-remaining decision read as
  finished; and #39 said "Approved" in three places while its body lists D1–D4 all checked
  and `docs/plans/_active/todo.md` records "Phase C complete. All items C0–C4.3 shipped". Its
  Go files exist (`apps/license-server/midtrans_checkout.go`, `midtrans_webhook.go`,
  `midtrans_webhook_test.go`, plus a smoke-verification record), so the record was updated
  to Implemented rather than the index being made consistently wrong.
  Until 08-09-26, 26 of the 41 rows
  showed `—`, and this page explained that away as "older ADRs predate the `Status:`
  convention". That explanation was false for all 26: every one of those files *does*
  carry a `status:` key in its frontmatter — #1, #2, #3 and the rest were marked
  `Implemented (2026-07-15)` while the index called them unknown. The cells were empty
  because nobody had filled them in, and the page then supplied a tidy reason for the
  gap. An invented explanation is worse than the gap: it stops anyone looking again.
  Re-derive the column with a script that reads the frontmatter, never by hand — and
  since 2026-09-24 one runs in every full local matrix:
  `.agents/skills/docs-auditor/scripts/check-adr-status.py` compares each row's status
  word against its file's frontmatter (check.sh step `adr status drift`, gates.json
  `adr-status`), so the next drift fails a gate instead of waiting for a re-audit.
  A third sweep on 23-09-26 caught three more cells trailing their frontmatter — #55 read `Accepted` while the decision had shipped as `Implemented`, and #56/#58 read `Proposed` while both frontmatters had been re-audited to `Partially implemented` on 2026-09-22 — and corrected them to match. The duplicate #43 rows were left as they are: the collision is documented at the top of this file and renaming either file would break the citations counted there.
- **On 23-09-26 the five future-dated records were re-dated to their authored dates.**
  ADRs #56–#60 had October-2026 prefixes and in-body dates no commit could produce;
  `git log -S` attribution pinned their authoring and every recorded event to 2026-09-21,
  so the files, status lines, the cells above and the in-body claims were corrected together
  (line counts preserved — cross-file line anchors still hold). The superseded labels live
  in git history; the method and the second, unfixed date cluster are recorded in
  `docs/records/audits/documentation-audit-23-09-26.md`.
- **`TODO.md` no longer exists at the repo root.** It was moved to
  `docs/plans/todo.md` by `f3d9cca60` ("tidy up project root files into docs, dev, and
  scripts") — a pure rename, content intact, so every `TODO.md` C-phase citation went dead
  at once. Nine were still live across six docs on 08-09-26 and have been repointed. If you
  are holding an old note or shell history that says `TODO.md`, the file you want is
  `docs/plans/_active/todo.md` (it moved again when the plans were split into `_active/`,
  `_backlog/` and `_done/`).

---

> last audited 29-09-26 by docs-auditor
