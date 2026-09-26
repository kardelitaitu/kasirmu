# Android 4GB POS Optimization Audit

**Status:** AUDIT COMPLETE. Supersedes the unexecuted draft checklist; no item earned a clean CORRECT, the rest are corrected, merged, deferred or deleted below.
**Date:** 2026-09-23
**Branch:** 0.0.40 (version locked at 0.0.40)
**supersedes: todo-android-checklist.md (left byte-identical; do not edit)**
**Scope:** Tauri v2 Android POS terminals assumed at 4GB RAM minimum. Covers the UI/WebView layer, the Tauri IPC command surface, the native Android scaffold, and the pre-release verification gate. Excludes cloud-server and desktop-tauri behaviour except where a shared command contract is at risk.
**Evidence provenance:** three independent investigation passes over the working tree.
- **Pass A, dependency and policy census:** every third-party package the checklist names was grepped against the workspace manifests and the UI source, and every claimed policy was checked against the file that actually encodes it.
- **Pass B, IPC and command-surface census:** the registered command list, the paging behaviour of each list command, and the front-end call sites that consume them.
- **Pass C, native scaffold and CI-gate census:** the committed `gen/android` tree, the Android manifest, the mobile `MainActivity`, and the live legs of the Android workflow.

Citations are `file:line` where the claim is local and resolved during one of those three passes. Claims that rest on external platform policy (Android 15 foreground-service limits, Google Play and AMAPI rules) have no local citation and are marked as external where they appear. Claims that did not resolve at all are listed in section 5 rather than being silently dropped.

---

## 1. How to read this document

- Section 2 is the adjudication of the draft. It is not a rewrite of the draft; it is a verdict per item with the evidence that decided it.
- Section 3 is what survives, ranked by what a cashier would notice on a 4GB terminal, not by what is cheapest to build.
- Section 4 is what was deleted and why. Nothing in section 4 should be resurrected without new evidence.
- Section 5 is a first-class deliverable. Everything listed there is an unknown; do not cite it as a finding.
- Section 6 replaces the draft's pre-release gate.
- Section 7 is the citation index for the whole document.

---

## 2. Verdict table

One row per original checklist item, plus the pre-release gate.

| Item | Verdict | Decisive evidence | Action |
|---|---|---|---|
| P1.1 DOM virtualization | WRONG as written | `@tanstack/react-virtual` is policy-banned; the large-list policy already exists at `ui/src/utils/list-policy.ts:20,27` (50 per page, virtualize at >=20 pages); `react-window` is live in 2 screens | Corrected action (page the unbounded lists) is worth doing. Folded into R3 |
| P1.2 Pagination and lazy loading (LIMIT/OFFSET over IPC) | PARTLY CORRECT | IPC paging exists only for customers: `apps/mobile-tauri/src/commands/customers.rs:230-255`, `limit.unwrap_or(50)` | Direction right, ordering wrong: UI-side paging first, IPC bounds second. Folded into R3 |
| P1.3 State disconnect | OBSOLETE (unmeasured) | 9 contexts, none holding bulk rows; no leak evidence produced | Not worth doing. Deleted |
| P1.4 Image optimization | PARTLY CORRECT | Content-addressed WebP plus LRU plus 40 per cycle cap ALREADY DONE at `apps/mobile-tauri/src/image_download.rs:195-276`; the 400x400 cap is MISSING and needs a new image dependency; the "WebView GPU crash" cause is unverified | Defer until an incident is measured. Deferred to R6 |
| P2.1 Compute offloading | OBSOLETE | 343 commands already registered at `apps/mobile-tauri/src/lib.rs:584-971`; no named JS algorithm was produced to move | Deleted |
| P2.2 IPC payload minimization | UNIMPLEMENTABLE-AS-WRITTEN | "Localized payloads" contradicts the Fluent/i18n contract (localization is UI-side); "tailored to the viewport" is P1.2 restated | Merged into R3, then deleted as a separate item |
| P2.3 Connection pooling (r2d2) | WRONG | `platform/core/src/database/pool.rs:9-11` documents that SQLite gains nothing from a multi-connection pool; the shape it uses instead is the single `Arc<Mutex<Connection>>` at `pool.rs:31-33`; r2d2 and deadpool-sqlite have 0 hits; `apps/mobile-tauri/src/state.rs:22-25` defers it explicitly | Deleted |
| P3.1 Tailwind breakpoints | WRONG | Tailwind is not a dependency (0 hits) and there are 0 utility classes across 140 CSS files; the real mechanism is tokens plus 338 `@media` rules plus `ui/src/theme/responsive.css`, `ui/src/app/tablet/tablet.css` and `themeTokenCompliance.test.ts` | Deleted |
| P3.2 resizeToAvoidBottomInset / flex | WRONG API (Flutter-only) | Keyboard avoidance already EXISTS: `AndroidManifest.xml:138` (`adjustResize`) plus `ui/src/hooks/useKeyboardAvoidance.ts`. The REAL verified gap is `ui/index.mobile.html:9`, which lacks `interactive-widget=resizes-content`, leaving the WebView on `resizes-visual` | Do the meta fix. Promoted to R1 |
| P3.3 Touch targets 48dp | PARTLY CORRECT | Tokens exist at `ui/src/theme/tokens.css:277-278` (44px min, 48px comfortable) and dp is not px; the gap is unproven adoption on checkout controls | Cheap verification pass only. Promoted to R4 |
| P4.1 WakeLock Kotlin plugin | PARTLY CORRECT | The plugin API path is correct, but a WakeLock does not address the LMK; screen-on needs `FLAG_KEEP_SCREEN_ON` with no plugin and no permission | Reframe to a one-line MainActivity change. Promoted to R2, highest impact per line in this document |
| P4.2 Foreground Service for sync | WRONG (legally bounded) | The repo targets SDK 36 (`apps/mobile-tauri/gen/android/app/build.gradle.kts:36`) and Android 15 caps `dataSync` at 6h per 24h (`Service.onTimeout`), so the checklist's own 8-hour test exceeds the legal window; Play requires a declaration plus a demo video per declared type | Deleted as written |
| P4.3 WebView anchoring via Play Console | UNIMPLEMENTABLE-AS-WRITTEN | No such mechanism exists; AMAPI `autoUpdateMode POSTPONED` caps at 90 days and then force-updates; WebView is a Play-updated system app | Deleted |
| P5.1 OpenAPI/JSON contract archival | ALREADY DONE (wrong premise) | `docs/guides/developer/api-reference.md` is an 881-line audit-stamped IPC reference; real OpenAPI exists for the HTTP surface (`crates/kasirmu-api/src/spec/`, merged by `apps/cloud-server/src/openapi.rs`); none exists for the Tauri IPC surface | Deleted |
| P5.2 Schema freeze | ALREADY DONE | 69 `.sql` files plus the `include_str!` registry at `crates/kasirmu-core/src/migrations.rs:49-61` | Deleted |
| GATE (8h idle / stress / offline drop) | WRONG as written; MISSING as automation | The 8-hour screen-on idle test is invalid twice over: the Android 15 foreground-service window caps it, and screen-on is not the LMK scenario | Keep ONE redefined soak leg. Promoted to R5 |

Rows whose decisive evidence is external policy rather than a local file: P4.3 (Google Play and AMAPI rules), and the Android 15 foreground-service window in P4.2 and the GATE row. Every other row above rests on a local citation.

### 2.1 Verdict roll-up

| Verdict | Count | Items |
|---|---|---|
| CORRECT | 0 | none |
| PARTLY CORRECT | 4 | P1.2, P1.4, P3.3, P4.1 |
| WRONG | 5 | P1.1, P2.3, P3.1, P3.2, P4.2 |
| OBSOLETE | 2 | P1.3, P2.1 |
| ALREADY DONE | 2 | P5.1, P5.2 |
| UNIMPLEMENTABLE-AS-WRITTEN | 2 | P2.2, P4.3 |
| (gate, outside the 15 items) | 1 | pre-release gate |

Sixteen rows adjudicated. Six items survived in some form: P1.1 and P1.2 merged into R3, P1.4 deferred to R6, P3.2 promoted to R1, P3.3 promoted to R4, P4.1 promoted to R2. P2.2 is not one of the six: it was found unimplementable as written and its one valid half is P1.2 restated, so it is absorbed into R3 rather than counted as a survivor. Two were promoted as originally intended plus a correction (R1, R2), two were reduced to verification or deferral (R4, R6), and one was merged two ways (R3). Everything else was deleted.

---

## 3. Surviving work

Ranked by cashier-visible impact on a 4GB Android POS terminal. R1 through R5 are in scope now; R6 is deferred behind a measured incident.

### R1. Keyboard viewport (S)

- **Purpose:** Stop the soft keyboard from hiding the pay button while a cashier types an amount.
- **Why this rank:** it is the only surviving item that is both fully verified and one line long. A cashier who cannot see the pay button is blocked at the exact moment of sale.
- **Fence:** `ui/index.mobile.html:9` only. One attribute in one meta tag.
- **Acceptance:** the meta tag contains `interactive-widget=resizes-content`; on device, focusing a numeric input keeps the field AND the pay button visible under `adjustResize`.
- **Size:** S.
- **Dependencies:** none. Do this first.

### R2. Keep screen on (S)

- **Purpose:** Stop the terminal from sleeping on an idle cashier station without asking for a foreground service or a permission.
- **Why this rank:** highest impact per line in the whole document, but it lands inside the committed scaffold, so it carries a regeneration risk that R1 does not.
- **Fence:** `apps/mobile-tauri/gen/android/app/src/main/java/mu/kasir/mobile/MainActivity.kt` only.
- **Acceptance:** the screen stays on for >=5 minutes idle with the app foreground (`adb shell dumpsys window` reports `KEEP_SCREEN_ON`); no new permission is declared.
- **Size:** S.
- **Dependencies:** none. Verify the scaffold-regeneration risk in section 5 before committing.

### R3. Bounded list data path (M/L)

- **Purpose:** Bound memory and serialization on the list screens that fetch and render every row, plus the one screen whose fetch is unbounded while its render is already paged.
- **Why this rank:** the largest user-visible risk class after the two one-liners, and the only slice that touches both layers. It is ranked third because it is the only one that can be done in the wrong order.
- **Fence (UI):** the four screens below, all to consume `usePagedList` / `LIST_PAGE_SIZE` (pattern already live at `RetailPosScreen.tsx`).

| Screen | Site |
|---|---|
| `ui/src/features/products/ProductManagementScreen.tsx` | :440 |
| `ui/src/features/customers/CustomerManagementScreen.tsx` | :549 |
| `ui/src/features/sales/VoidOrdersScreen.tsx` | :414 |
| `ui/src/features/inventory/ThresholdConfigScreen.tsx` | :194 |

- **Fence (IPC, not render):** `ui/src/features/sales/SalesHistoryScreen.tsx` already bounds its render (`:225` `pageSize` state, `:365-370` slice, `:945` render) but its fetch at `:239` is unbounded. It belongs to the IPC fence, not the unbounded-render fence.

- **Fence (IPC):** `apps/mobile-tauri/src/commands/products.rs:338-341` and `apps/mobile-tauri/src/commands/history.rs:263-266`, mirroring the existing shape at `customers.rs:250`; wrappers at `ui/src/api/products.ts:59-60` and `ui/src/api/sales.ts:513-514`.
- **Acceptance:** zero unbounded `.map(` over fetched rows remains in those four files, and the `SalesHistoryScreen.tsx` fetch at `:239` is bounded even though its render was already paged; both commands take and return `limit` plus `offset` defaulting to 50; `list-policy.test.ts` and the affected screen tests pass; one assert proves page 2 offsets correctly.
- **Size:** M for the UI half, L once the two commands and their desktop consumers are included.
- **Dependencies:** R1 and R2 are independent; do them first because they are smaller. R3 merges the original P1.1 and P1.2; P2.2's one valid half is P1.2 restated. The IPC half is not optional past the virtualize threshold; see the failure modes in section 5.
- **Ordering inside the slice:** UI paging first, because it is reversible and proves the offset arithmetic; IPC bounds second, because the signature change is the part that can break the desktop shell.

### R4. Touch-target proof (S)

- **Purpose:** Replace an unproven claim about checkout control sizes with an assertion.
- **Why this rank:** it is a verification, not a feature. It cannot be ranked above work that changes behaviour, and it must run after the screens it asserts on stop moving.
- **Fence:** `ui/src/theme/tokens.css:277-278` plus the accessibility test suite.
- **Acceptance:** checkout buttons, grid selectors and menu icons assert >=44px and are raised to the 48px token.
- **Size:** S.
- **Dependencies:** run only after R1 through R3.

### R5. Soak gate wired, not invented (S/M)

- **Purpose:** Turn the pre-release gate into an automated leg that measures the LMK scenario instead of asserting it.
- **Why this rank:** it protects the other slices rather than the cashier, but it is cheap to wire because the workflow legs and the device scripts already exist.
- **Fence:** `.github/workflows/android.yml` (the live steps `Decode keystore`, `Build Android APK` and `Assert the APK exists`) plus `scripts/android-preflight.sh` and `scripts/android-cdp.mjs`.
- **Acceptance:** one leg samples RSS via adb across a 30 to 60 minute background/doze cycle and fails on a stated threshold; the 8-hour screen-on form is gone.
- **Size:** S to wire the leg, M to make the threshold stable.
- **Dependencies:** none technically, but it needs a recorded baseline before it can fail meaningfully.

### R6. 400x400 image cap (L, DEFERRED)

- **Purpose:** Bound stored catalog asset dimensions, if a memory or GPU incident is ever measured.
- **Why this rank:** last, because its stated cause is unverified and its cost is the highest of any slice. Ranking it higher would mean spending the most on the least evidenced item.
- **Fence:** `apps/mobile-tauri/src/image_download.rs:195-276` plus a new image dependency in `apps/mobile-tauri/Cargo.toml`.
- **Acceptance:** stored asset max dimension <=400 with a decode test.
- **Size:** L. The size is an estimate, not a measurement.
- **Dependencies:** start only after a measured GPU or memory incident. The rest of the image pipeline (content-addressed WebP, LRU, 40 per cycle cap) already ships, so this slice is only the cap.

### 3.1 Slice summary

| Slice | Size | Layer | Merges | Gate |
|---|---|---|---|---|
| R1 Keyboard viewport | S | UI shell | P3.2 (corrected) | do first |
| R2 Keep screen on | S | native scaffold | P4.1 (reframed) | after R1 |
| R3 Bounded list data path | M/L | UI plus IPC | P1.1, P1.2 | after R1, R2 |
| R4 Touch-target proof | S | theme plus tests | P3.3 (narrowed) | after R1 to R3 |
| R5 Soak gate | S/M | CI plus device scripts | gate (redefined) | independent |
| R6 400x400 image cap | L | Rust plus Cargo | P1.4 (deferred) | after a measured incident |

---

## 4. Rejected items

Each of these is deleted from the plan. The reason is one line; the evidence is in section 2.

| Item | Reason it was deleted |
|---|---|
| P1.3 State disconnect | No leak was ever measured and no context holds bulk rows. |
| P2.1 Compute offloading | 343 commands already exist and no JS algorithm was named. |
| P2.3 Connection pooling | The codebase already documents that SQLite does not benefit. |
| P3.1 Tailwind breakpoints | The dependency is absent and the layout mechanism is tokens plus media queries. |
| P4.2 Foreground Service for sync | The platform's own time cap invalidates the checklist's test. |
| P4.3 WebView anchoring | No such Play Console mechanism exists. |
| P5.1 OpenAPI/JSON contract archival | Already done, and the premise about what is missing is wrong. |
| P5.2 Schema freeze | Already done and already enforced by a registry. |
| The original 8-hour screen-on idle test | Invalid on both the legal window and the scenario. |

Nine entries above, none of which also appears as a surviving slice in section 3. Two items the draft carried are deliberately absent from this table: P2.2 is not a rejection on its own merits (it was found unimplementable as written and absorbed into R3, which is where its one valid half lives), and P1.4 is not a rejection at all (it was deferred into R6). Neither is counted here.

---

## 5. Unverified claims and open unknowns

This section is a first-class deliverable. Anything here is an unknown, not a finding; do not cite it as evidence.

### 5.1 Unverified claims

1. **The "4GB minimum" fleet assumption itself.** No terminal model, Android version or installed-base evidence was produced in any pass. Every ranking in section 3 inherits this unknown.
2. **The "WebView GPU crashes" claim.** No incident, log or reproduction was produced. This is the stated cause for the P1.4 400x400 cap and the sole justification for R6.
3. **State-disconnect leak magnitude.** Explicitly not measured; P1.3 is unmeasured, not disproven.
4. **The 8-hour idle test's premise that Rust sync loops accumulate memory.** Never measured. The test asserted a mechanism nobody has observed.
5. **Whether a persistent sync thread even runs on mobile.** The outbox/sync shape appears in none of the three investigation passes. If nothing runs, both the original gate's premise and the foreground-service item are moot for a second, independent reason.
6. **Whether 44px tokens are adequate on a 10-inch tablet.** The physical dp mapping is unstated; tokens are px. R4 asserts a number whose physical meaning on the target hardware is unverified.
7. **Whether edits to the committed `gen/android` scaffold survive `tauri android init` regeneration.** This is the single largest risk to R2.
8. **Whether `MainActivity.kt` can carry the keep-screen-on flag** without the scaffold change being clobbered on the next regeneration. Related to item 7 but separable: even a regenerable scaffold has to expose an override point.
9. **Who administers the fleet and under what MDM.** This determines whether P4.3-style fleet controls exist at all through some other channel, and it determines how an R5 threshold could be pushed fleet-wide.
10. **Whether IPC paging breaks the ProductLookupScreen barcode-scan flow.** That screen is not in the R3 fence and was not traced end to end. A barcode scan that assumes a full in-memory list would regress silently.
11. **The size of R6.** It is an estimate, not a measurement, and it depends on which image dependency is chosen.

### 5.2 Concrete failure modes

- **UI-only paging still ships the full payload.** On a very large product table the IPC serialization alone can stall the WebView, so R3's IPC half is not optional once a table passes the virtualize threshold. Shipping the UI half alone would look like a fix and would not be one.
- **Adding LIMIT/OFFSET to `products.rs` and `history.rs` changes shared command contracts used by the desktop shell.** Any signature change must be additive (optional `limit`/`offset`) or desktop breaks. This is why the IPC half is second inside R3, not first.
- **Editing `gen/android` risks being overwritten by the next `tauri android init`.** R2 lives entirely inside that scaffold, so an unverified regeneration path can delete the fix with no test failure.
- **The soak gate (R5) fails closed on a flaky adb sample.** It needs a generous threshold plus a recorded baseline, or it will be disabled by the first person it blocks. A gate that gets disabled is worse than no gate, because it reads as coverage.

### 5.3 How to close these unknowns

| Unknown | Cheapest evidence that would close it |
|---|---|
| 4GB fleet assumption | one terminal model plus its Android version from the deployment records |
| WebView GPU crashes | one incident report, log or reproduction, or a decision to drop the claim |
| state-disconnect leak | an RSS sample before and after a long session |
| Rust sync memory accumulation | the same RSS sample, cross-referenced with whether a sync thread is running |
| persistent mobile sync thread | one trace of the mobile process during a sync window |
| 44px adequacy on a 10-inch tablet | the device's reported density plus one measured control |
| scaffold regeneration | one `tauri android init` run on a scratch copy |
| MainActivity override point | the same run, inspecting the generated MainActivity |
| fleet administration | a direct answer from the owner; no code evidence exists |
| ProductLookupScreen barcode flow | one trace of that screen against a paged API |
| R6 size | a spike once an image dependency is chosen |

---

## 6. Pre-release gate (redefined)

The original gate bundled three tests, of which one is invalid and the other two are real but uninstrumented. The redefined gate:

| Leg | State | What it must do |
|---|---|---|
| Soak | REPLACES the 8-hour screen-on idle test | One leg samples RSS via adb across a 30 to 60 minute background/doze cycle and fails on a stated threshold. Screen-on is not the LMK scenario, and a foreground service cannot legally run the 8-hour form anyway. |
| Rapid checkout stress | KEPT, needs instrumentation | Tap through 30 mock sales in quick succession while scanning barcodes; the pass condition must be a measured RSS ceiling, not "confirm memory resets". |
| Offline drop | KEPT, needs instrumentation | Cut Wi-Fi mid-transaction and assert that the local `rusqlite` write completes and that no unhandled JS exception hangs the WebView thread. |

Why the 8-hour form is gone, in two independent reasons:

1. **The legal window.** The repo targets SDK 36 (`apps/mobile-tauri/gen/android/app/build.gradle.kts:36`), and Android 15 caps a `dataSync` foreground service at 6 hours per 24 hours (`Service.onTimeout`; external platform policy, no local citation). An 8-hour screen-on soak held open by such a service cannot pass on a compliant device.
2. **The scenario.** Screen-on is not the Low Memory Killer scenario. Keeping the screen awake removes the very condition the test claims to measure, so even a passing 8-hour run would not be evidence about LMK behaviour.

The gate is not considered wired until the soak leg runs in `.github/workflows/android.yml` (R5) rather than by hand. Stress and offline-drop stay as manual legs until they have instrumentation; they are real tests, not placeholders.

---

## 7. Evidence index

| Citation | Supports |
|---|---|
| `ui/src/utils/list-policy.ts:20,27` | 50 per page, virtualize at >=20 pages (P1.1) |
| `ui/src/theme/tokens.css:277-278` | 44px min, 48px comfortable (P3.3, R4) |
| `ui/src/theme/responsive.css` | The real responsive mechanism (P3.1) |
| `ui/src/app/tablet/tablet.css` | The real responsive mechanism (P3.1) |
| `themeTokenCompliance.test.ts` | The test that enforces the token mechanism (P3.1) |
| `ui/src/hooks/useKeyboardAvoidance.ts` | Keyboard avoidance exists (P3.2) |
| `ui/index.mobile.html:9` | Missing `interactive-widget=resizes-content` (P3.2, R1) |
| `ui/src/features/products/ProductManagementScreen.tsx:440` | Unbounded list site (R3) |
| `ui/src/features/customers/CustomerManagementScreen.tsx:549` | Unbounded list site (R3) |
| `ui/src/features/sales/VoidOrdersScreen.tsx:414` | Unbounded list site (R3) |
| `ui/src/features/inventory/ThresholdConfigScreen.tsx:194` | Unbounded list site, the threshold table row map (R3) |
| `ui/src/features/sales/SalesHistoryScreen.tsx:239` | Unbounded IPC fetch (R3) |
| `ui/src/features/sales/SalesHistoryScreen.tsx:225,365-370,945` | Render already paged, so not an unbounded-render site (R3) |
| `ui/src/api/products.ts:59-60` | IPC wrapper to extend (R3) |
| `ui/src/api/sales.ts:513-514` | IPC wrapper to extend (R3) |
| `apps/mobile-tauri/src/commands/customers.rs:230-255` | The only existing IPC paging (P1.2, R3) |
| `apps/mobile-tauri/src/commands/customers.rs:250` | `limit.unwrap_or(50)`, the default to mirror (R3) |
| `apps/mobile-tauri/src/commands/products.rs:338-341` | Command to bound (R3) |
| `apps/mobile-tauri/src/commands/history.rs:263-266` | Command to bound (R3) |
| `apps/mobile-tauri/src/lib.rs:584-971` | 343 registered commands (P2.1) |
| `apps/mobile-tauri/src/image_download.rs:195-276` | WebP, LRU and 40 per cycle cap already done (P1.4, R6) |
| `apps/mobile-tauri/src/state.rs:22-25` | Pooling explicitly deferred (P2.3) |
| `apps/mobile-tauri/gen/android/app/src/main/java/mu/kasir/mobile/MainActivity.kt` | The R2 fence |
| `platform/core/src/database/pool.rs:9-11` | SQLite gains nothing from a multi-connection pool (P2.3) |
| `platform/core/src/database/pool.rs:31-33` | The single `Arc<Mutex<Connection>>` shape that replaces the pool (P2.3) |
| `crates/kasirmu-core/src/migrations.rs:49-61` | `include_str!` migration registry (P5.2) |
| `crates/kasirmu-api/src/spec/mod.rs:1-4` | Shared OpenAPI 3.1 document for the HTTP surface (P5.1) |
| `apps/cloud-server/src/openapi.rs` | Merges the cloud-only paths onto that spec (P5.1) |
| `docs/guides/developer/api-reference.md` | 881-line audit-stamped IPC reference (P5.1) |
| `AndroidManifest.xml:138` | `adjustResize` already configured (P3.2) |
| `apps/mobile-tauri/gen/android/app/build.gradle.kts:36` | `targetSdk = 36` (P4.2, section 6) |
| `.github/workflows/android.yml`, steps `Decode keystore`, `Build Android APK`, `Assert the APK exists` | Live Android CI steps (R5) |
| `scripts/android-preflight.sh` | Existing device tooling to extend (R5) |
| `scripts/android-cdp.mjs` | Existing device tooling to extend (R5) |

---

## Naming note

The filename keeps the `todo-` prefix deliberately. `check-dead-refs.py` exempts plan files, and the file is renamed to `done-todo-*` only once its own acceptance commands have actually run and passed. R1 through R5 have not run yet.
