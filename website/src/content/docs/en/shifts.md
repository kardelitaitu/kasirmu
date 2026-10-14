---
title: Shifts & Reconciliation
description: Close cashier shifts cleanly with a full audit trail.
category: guides
order: 2
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings (0 major, 0 minor, 0 ambiguous) · Second pass; the 2026-09-09 stamp is merged below as original evidence, and the 2026-10-01 freshness note that sat below the footer is folded in. Re-derived every claim at HEAD. VERIFIED, not inherited: the open-shift guard is PER USER and now also carries a partial unique index — the migration the freshness note named is present on disk (crates/kasirmu-core/migrations/20261011_open_shift_uniqueness.sql) and the code error string is unchanged (crates/kasirmu-core/src/db/shifts.rs:105 "user already has an open shift"). The cart-must-be-empty close guard moved into the hook and still exists (ui/src/features/sales/hooks/usePosShifts.ts:187 setCloseShiftError with pos-close-shift-cart-error; message sales.ftl:29). Dialog titles re-read verbatim from shared-ui/locales/shifts.ftl — Open Shift / Record Cash Payout / Close Shift at :38-40, matching the page's own labels including the 2026-09-09 rename from "Record Payout". Optional opening balance, payouts subtracted from expected cash with the 'safe drop' default, Over/Short tags, the immediate closed-shift summary, and the EOD report's KPI/reconciliation/payment/hourly sections all still hold. NOT re-measured: the close-shift and EOD flows on a running register (needs a live terminal), and the printable/CSV output — the same limit the 2026-09-09 stamp recorded. No repair was needed; the stamp and footer are refreshed, and the standalone freshness note is merged into the stamp where the tooling can see it.

STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim as plain text:

Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Finding 1: "Only one shift is open on a register at a time" — the open-shift guard is per USER, not per register: crates/oz-core/src/db/shifts.rs:68-78 counts open shifts by user_id ("user already has an open shift"), open_shift is passed session user_id (apps/desktop-tauri/src/commands/shifts.rs:131), and the shifts schema has no terminal-scoped uniqueness (migrations 20260813_init.pg.sql:965-971, only opened_at/status/user_id indexes at :1799-1803; contrast inventory_shifts, which IS unique per user+location, :962-963). Two registers can run two open shifts for one user. Reworded to "one open shift per cashier". · Finding 2, dialog-label drift: "Record Payout" renamed to the app's own modal title "Record Cash Payout" (shared-ui/locales/shifts.ftl:39); the id page's "Catat Penarikan" likewise became "Catat Penarikan Tunai" (shifts.id.ftl:33). · Verified true, left alone: optional opening balance (open_shift_scoped OpenShiftScopedArgs opening_balance_minor, commands/shifts.rs:100-105; dialog shifts.ftl:4 shift-opening-balance), live clock anchored to original opened_at (PosScreen.tsx:573-586 interval with rebase, :1397 elapsedHoursMinutes(new Date(activeShift.openedAt).getTime(), ...)), payouts subtracted from expected cash (db/shifts.rs:179, cash_payout default reason 'safe drop' ShiftManagementScreen.tsx:177), close takes counted cash + optional notes (shift-close-counted-label shifts.ftl:57, notes :60), Over/Short tags (shift-tag-over/short shifts.ftl:21-22), close refused while cart not empty (PosScreen.tsx:1095-1099 lines.length > 0 guard), immediate closed summary (ShiftManagementScreen.tsx:802,843-865), history columns status/opened/closed/opening/counted/expected/diff/sales (shift-table-* shifts.ftl:8-18), per-shift detail (shift-modal-detail-title :42), EOD with revenue/average/voids/discounts KPIs, opening-vs-counted-vs-expected reconciliation, payment breakdown, hourly breakdown, printable and CSV-exportable (EodReportScreen.tsx:244,281-295,324-325, buildCsv/downloadCsv :10, printReceiptScoped :15), full audit trail of sale/void/refund/payout/stock adjustment with user and terminal (audit.rs append-only :1,237). Dialog titles localized: Open Shift / Record Cash Payout / Close Shift / Buka Shift / Catat Penarikan Tunai / Tutup Shift (shifts.ftl:38-40, shifts.id.ftl:32-34) — the id page's own labels match. · id/ counterpart repaired with the same one finding. -->

## Opening a shift

A cashier opens a shift on a register before serving customers. The **Open
Shift** dialog accepts an optional **opening balance** — the float in the
drawer at the start of the day, for example `100.00`. Only that cashier's
sales count toward their shift, and a live clock shows how long the shift has
been running — it stays anchored to the original opening time, so a restart
or app update never resets it. A cashier has one open shift at a time, on
any register.

## Cash payouts

Money can leave the drawer mid-shift without closing it — for example a safe
drop. **Record Cash Payout** takes an amount and a reason (defaulting to
`safe drop`), and the payout is subtracted from the expected cash so the
reconciliation at close stays accurate.

## Closing and reconciling

**Close Shift** takes the **counted** cash in the drawer and any optional
notes. It shows the expected total versus what was counted and flags the
**difference** — tagged **Over** or **Short** — before the register accepts
the close, so discrepancies surface at the counter instead of at the end of
the month. The close is refused while a sale is still in progress; complete
or clear it first. A summary of the closed shift is shown immediately.

## Shift history and end of day

The shift management screen lists every shift with its status, open and close
times, opening and counted balances, expected cash, difference, and sales,
and opens a full per-shift report. The **End-of-Day Report** rolls up today's
shifts: KPI cards (total revenue, average sale, voids, discounts), a cash
reconciliation (total opening vs total counted vs total expected, with a net
difference), a payment breakdown, and sales by hour — printable and
exportable.

## Audit history

Every sale, void, refund, payout, and stock adjustment is recorded with the
user and terminal that made it, so every shift reconciles back to a complete
audit trail.

> last audited 11-10-26 by docs-auditor
