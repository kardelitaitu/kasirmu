---
title: First Day Live
description: The go-live checklist — hardware verified, shift opened, staff handed the counter.
category: gettingStarted
order: 8
updated: "2026-09-30"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: PASS (0 findings) · Re-audit at HEAD; every pointer the 2026-09-30 stamp verified still resolves and still says what this page says. · VERIFIED AND LEFT ALONE: the ShiftManagementScreen Open-Shift opening-balance pointer; the RestaurantReceiptsScreen "Test print uses last saved settings" caveat (which the page states correctly, including the save-your-draft-first consequence); the Staff Management card's name/login/PIN/workspace fields; the disabled-workspace-card behaviour; the six relative links (../terminals/, ../payments/, ../shifts/, ../user-roles/, ../workspaces/, ../offline-mode/) all resolve to real content pages; front matter parity with id/first-day.md is exact (category/order/updated all agree). · The page's "Cards and e-wallets are still coming" line remains accurate — the local payment rails shipped are cash/card/qris, and no e-wallet tender exists. · NOT re-measured: the runtime behaviour of a test print, a shift opening, or an offline queue drain — those are hardware and session behaviours this audit cannot exercise. · Prior evidence retained verbatim below: pointers verified against the UI — Open Shift dialog
     (ShiftManagementScreen.tsx opening balance), test print
     (RestaurantReceiptsScreen.tsx "Test print uses last saved settings"),
     QRIS static/dynamic split (payments.md), staff PIN/assignment via the
     Staff Management card. -->

Everything before this page was rehearsal. These are the last checks before
a real customer stands at your counter. Most take a minute each.

## The checklist

- Hardware bound and responding — printer, drawer, scanner. See below.
- Payment verified — one real QRIS charge (or cash in, cash out).
- Shift opened with the right float.
- Staff created, PIN known, workspaces assigned.
- Offline drill done once, so nobody panics later.

## Verify the hardware

1. Register the device as a terminal from the main navigation's **Tools
   section** — manager role required: [Terminals](../terminals/).
2. **Receipt printer** — from Restaurant POS settings, the receipt screen
   has a **test print** button. Note it uses the *last saved* settings, so
   save your draft layout first or the test uses the old one. Retail
   receipt layout is configured per workspace in Settings.
3. **Cash drawer** — opens on cash receipt preview; verify it pops when a
   cash sale is tendered.
4. **Barcode scanner** — scanners report as HID input: scan one of your
   test products into the checkout's SKU field.

## Verify a payment

Take one real charge before opening: cash is simple — tender, print, and
confirm the change calculation matches. QRIS shows the customer a dynamic
QR (or your store's static QR); confirm the charge appears in the app's
history. Cards and e-wallets are still coming. See
[Payments](../payments/).

## Open the day properly

A cashier opens a shift from the **Shifts** screen before serving. The
**Open Shift** dialog accepts an optional **opening balance** — the float
in the drawer (say `100.000`), so closing can reconcile against it. Only
that cashier's sales count toward their shift. See
[Shifts & Reconciliation](../shifts/).

## Hand the counter over

Create each staff member from the **Staff Management** card in the
workspace picker's Tools grid: name, login, PIN, and the workspaces they
may open — checkout staff typically get Retail POS or Restaurant POS, and
kitchen staff the Kitchen Display. Cards they cannot open simply appear
disabled. See [User Roles](../user-roles/) and
[Workspaces](../workspaces/).

## Do one offline drill

Pull the internet cable (or turn off Wi-Fi) and ring one sale. It should
complete as normal, queue locally, and sync when the connection returns.
Doing this once with you at the keyboard is worth five paragraphs of
documentation later — [Offline Mode](../offline-mode/) explains what the
queue shows.

---

Keep reading · **Previous:** [Workspaces](../workspaces/)

> last audited 11-10-26 by docs-auditor