# Four refutations, then a test harness that found the defect anyway — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 144 · status: 2 real defects
     fixed (same shape, two components), 4 carry-forward leads refuted · branch:
     0.0.41 · commit: `9ec7a9066` -->

<!- - Scope: inventory / stock counts, per the active goal. Opened from round 143's
     carry-forward list of four untested writes. -->

## The four leads, checked and refuted

Round 143 named four untested write paths. Applying its own two questions — *does the handler
guard itself, and does the backend refuse or replace?* — all four came back protected:

| Lead | Backend | Verdict |
|---|---|---|
| `useImportWizard.confirmImport` | every arm keyed on the **file's own** ids (`existing_skus`, `existing_sales`, `existing_categories` loaded inside the call), so a replay takes the UPDATE branch | idempotent by construction |
| `WarehouseCountFlow.handleComplete` | compare-and-set: `WHERE id = ?3 AND status IN ('draft','in_progress')`, `claimed != 1` -> Validation (`stock_counts.rs:529-539`) | replay REFUSED |
| `StaffDetailDrawer.handleSave` | `username TEXT NOT NULL UNIQUE` + `idx_users_tenant_username`; `create_user_in_tx` maps `ConstraintViolation` to `CoreError::Conflict` (`staff.rs:593-600`) | replay REFUSED |
| `ImportSection` / `BackupSection` | presentational; the handlers live in the hooks above | not a write site |

Four for four. A round of pure refutation is a legitimate outcome — round 138 and 141 both
had them — but the interesting part came next.

## Refused is not harmless: the shape rounds 136-141 kept finding

A backend that **refuses** a replay does not make the double tap safe, and round 141 already
established why: the rejection lands in the **same catch that reports genuine failures**. The
button's `loading={saving}` is not authoritative either, because `saving` is state that
React commits on its next render — after the second tap.

So `handleComplete` was a real defect in **two** components, and both were reachable:

- `ui/src/features/inventory/StockCountDetail.tsx:157` — `setSaving(true)` then await;
  the catch sets `sc-error-complete` ("Failed to complete count").
- `ui/src/features/warehouse/WarehouseCountFlow.tsx:255` — the same shape, and this file
  **already reasons about a same-task race** at :74-87 and uses a ref (`scansInFlight`) for
  per-line scans. It just never applied the same mechanism to its own Complete button.

Consequence in both: the operator is told the count **failed** for a count that completed,
and the count is already closed so retrying cannot succeed.

## The part worth recording: I nearly shipped it untested

`WarehouseCountFlow` has no test of its own — the only reference is a scan-resolution case
in `catalogueLoadFailure.test.tsx` — and my first four attempts to drive its Complete button
all failed, because the button renders only when the count **has a line**, and the shared
`openCountFlow()` helper hard-codes `mockGetCountLines.mockResolvedValue([])`. I tried the
button after the helper, before it, and by backing out and re-opening the count; each time the
view rendered "No lines yet".

At that point I applied the guard and confirmed with a **kill-test** that it was green with
the guard removed — which means the test I thought I had proved nothing. **The honest move was
not to keep the guard and describe it as verified.** Two things happened instead:

1. `StockCountDetail` — the **same handler shape** — already had a full working harness
   (`sampleCount`, `sampleLines`, and a passing "calls completeStockCount and shows success
   message"). The shape-3 test went there first and came back red: `expected 2 to be 1`.
2. With that confirmation that the defect was real and the shape-3 approach correct, the
   warehouse harness was fixed properly — by giving `openCountFlow` a `lines` parameter
   (defaulting to `[]`, so the two existing scan cases are untouched) rather than by working
   around it.

**Both guards are now kill-proven**, and the warehouse guard has a test that did not exist
when I wrote it. The lesson is narrower than "write tests": a kill-test that comes back GREEN
means **your test does not exercise the code**, and the correct response is to fix the test or
withdraw the claim — never to keep the change and call it verified.

## Evidence

- **StockCountDetail:** red `expected 2 to be 1` before the guard; 16/16 after.
- **WarehouseCountFlow:** 6/6 pass with the new case; kill-test RED without the guard.
- **Both kill-tested** by removing `if (completePendingRef.current) return;` and restoring
  **byte-identical** from a backup.
- **Refutations** are backend-sourced, not inferred: the CAS SQL, the UNIQUE columns and the
  `ConstraintViolation` -> `Conflict` mapping are each cited by file and line above.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS.
- **Full suite:** 812 passed | 2 failed files of 814; **12,926 passed** (up 2). The 2 failures
  are the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Carried forward

`handleComplete` in **both** components is fixed; the pair is the first time this class was
found twice from one lead, which suggests the remaining value is in *shapes* rather than
files. Two concrete next steps:

- `StockCountDetail` also exposes `handleAddLine` and `handleRemoveLine` on the same
  `saving` flag (:325 uses `loading={saving}`), and neither was examined for the same
  reason `handleComplete` was not.
- The `saving`-as-guard pattern now has a complete inventory across the tree. A grep for
  `setSaving(true)` with no `PendingRef` in the same handler is the mechanical version of
  every lead this session has chased by hand, and it has not been run.

> last audited 18-10-26 by docs-auditor
