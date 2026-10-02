<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 structural finding — a footer that contradicted its own evidence) · Audited on branch 0.0.40. STAMPS MERGED INTO THIS ONE: the 2026-07-26 Hermes-Agent stamp above is retained verbatim and its three findings all still hold; this entry supersedes it, it does not replace it. THE FINDING WORTH ACTING ON is not in the body but in the audit metadata: this file carried a top stamp saying "status: STALE" and listing three real findings, directly above a machine-read footer asserting "status: ACCURATE (0 findings) · verified accurate: … all file references valid". Both cannot be true, and the footer is the field that tooling and humans read to decide whether a document needs work — so the file was advertising itself as clean while its own evidence said otherwise. This is precisely the stale-look the footer convention exists to prevent, inverted. Repaired: the false footer block is gone and replaced with the single machine-read line. I checked how widespread this is before treating it as a one-off: across all 28 `.md` files in `docs/archived/`, exactly TWO carry a STALE stamp together with that false ACCURATE footer — this file and `docs/archived/i18n-todo.md`. It is a bounded defect, not a systemic one, and both are now fixed. · DELIBERATELY NOT REWRITTEN: the P36-1 table paths (`oz-hal/drivers/escpos.rs`, `oz-payment/drivers/*`, `cloud-server/*`, `foundation/contracts.rs`, `oz-lua/lib.rs`, `oz-core/cache.rs`, `desktop-client/workspaces.rs`, `oz-hal/serial_display.rs`) and the P36-3 line numbers. This is an archived audit snapshot of 2026-07-20, and those rows are its evidence. Repointing them at today's tree would convert a record into a fabrication: the count of 27 `#[allow(dead_code)]`, the two crates with cargo-doc warnings, and the five TODO findings were true of that tree and are the reason the document has value. An archived record that has been silently updated to match the present is worse than one that is honestly dated. · NOT re-measured, and why: the dead-code count, the cargo-doc warning tally, and the TODO locations are all point-in-time measurements of a tree that no longer exists in that shape. Re-running them would produce numbers that contradict the body without correcting anything, so the 2026-07-26 observations (current total 26 annotations; ADR-4 note at `db/workspaces.rs:356`; `archive_instance()` at `:856`) stand as the last verified reading. · The title's "0.0.14" is the version this audit ran against, not a manifest version, and the project version lock makes it wrong to "correct" it here. -->

# Code Quality Audit — 0.0.14

<!-- Superseded audit stamp (2026-07-26, body kept verbatim) · Hermes-Agent · status: STALE (dated 2026-07-20 audit; layout-path + version drift) · F1: file paths use the OLD root crate layout (oz-hal/drivers/escpos.rs, cloud-server/webhooks.rs, desktop-client/workspaces.rs, foundation/contracts.rs) but the real layout is crates/oz-hal/, apps/cloud-server/, crates/foundation/, etc.; desktop-client/workspaces.rs does NOT exist at all anymore (no such file) · F2: dead_code count "27" — current workspace total is 26 #[allow(dead_code)] (close, but the per-file breakdown is stale) · F3: version "0.0.14" vs current 0.0.22 (user-owned version divergence) · O1: db/workspaces.rs TODO(ADR #4) cited at line 354 -> actual ADR-4 user_store_access check at line 356; archive_instance() exists at line 856 (doc cited 1198) — line drift only · verified: location_resolver.rs has greedy-fill comment (459/467); cloud-server webhooks.rs + db.rs exist under apps/cloud-server/src/; rate_sync.rs exists under platform/startup/src/; treat as a historical audit snapshot, not current state -->

## P36-1: Dead Code

`cargo doc` compiled successfully. 27 `#[allow(dead_code)]` annotations found — all intentional:

| File | Count | Rationale |
|------|-------|-----------|
| `oz-hal/drivers/escpos.rs` | 7 | ESC/POS command enums (barcode types, print modes) — used by trait, not directly |
| `oz-payment/drivers/*` | 6 | Gateway error variants + test fixture fields |
| `cloud-server/webhooks.rs` | 3 | Webhook event type discriminators |
| `cloud-server/db.rs` | 3 | DB pool config fields |
| `foundation/contracts.rs` | 1 | Contract status enum variant reserved for future |
| `oz-lua/lib.rs` | 1 | Sandbox internals accessible via FFI |
| `oz-core/cache.rs` | 1 | Cache eviction policy field |
| `platform/startup/rate_sync.rs` | 1 | Currency rate sync config |
| `desktop-client/workspaces.rs` | 1 | Workspace registry lookup |
| `oz-hal/serial_display.rs` | 1 | Display command enum |

**Verdict:** No dead code to remove. All 27 are intentional suppressions with documented rationale.

## P36-2: `cargo doc` Coverage

`cargo doc --workspace --no-deps` generated successfully. Warnings found in 2 crates:

- **`foundation`**: 2 warnings — `Sku` Display impl, `CartId` new()
- **`oz-core`**: 20 warnings — mostly database module internal functions

**Recommendation:** Add `///` doc comments to the 22 flagged public items. Non-blocking — all critical public API is already documented.

## P36-3: TODO/FIXME/HACK Audit

5 items found across the codebase:

| File | Text | Status |
|------|------|--------|
| `sync_api.rs:293` | TODO: add POST endpoints for tax_rates and users | Deferred feature |
| `location_resolver.rs:464` | TODO(ADR-19): greedy-fill across locations | ADR-19 in progress |
| `db/workspaces.rs:354` | TODO(ADR #4): user_store_access check | ADR-4 deferred |
| `db/workspaces.rs:1198` | TODO(ADR #5): public archive_instance() | ADR-5 deferred |
| `currency_integration.rs:463` | `"XXX"` in test (not a real TODO) | Test-only — intentionally invalid |

**Verdict:** All 5 are deferred features or test-only artifacts. No immediate action needed.

> last audited 29-09-26 by docs-auditor

