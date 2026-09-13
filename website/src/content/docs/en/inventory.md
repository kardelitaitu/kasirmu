---
title: Inventory & Warehouses
description: Track stock across warehouses with movement history.
category: guides
order: 5
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Finding: "The Inventory Transaction Log lists every movement — transfers, stock counts, and manual adjustments" — TransactionLogScreen (ui/src/features/inventory/TransactionLogScreen.tsx:119, title inv-log-title inventory.ftl:112) is registered NOWHERE: no registerPage/registerNavItem in ui/src/features/inventory/register.tsx, and a whole-repo git grep for TransactionLog (three forms, including unfiltered) finds zero references outside its own file, its test, and docs — the log is currently unreachable from the UI. Claim repaired to name the log as a ledger whose types do cover sales, voids, refunds, transfers, PO receives, stock counts, and manual adjustments (TransactionLogScreen.tsx:173-179) while recording that it cannot be opened from any screen today. · Verified true, left alone: per-product-per-location stock with register deduction location (ADR-19 deduction_location_id locked at cart start, commands/pos.rs:234-298, sales.rs:144-149), sales decrement stock automatically (complete_sale deduction test in db/sales.rs module header), location picker switches the view (LocationPicker.css/ui, features/inventory/), the seven adjustment reasons verbatim — inv-reason-restock..other inventory.ftl:40-46, ADJUSTMENT_REASONS InventoryAdjustmentScreen.tsx:20-27, custom reason text :138 — two-step pick-then-reason flow (:130-160), movement ledger entries, inventory shift for counts with e.g. Night shift count placeholder (inv-shift-notes-placeholder inventory.ftl:74-75, Start Inventory Shift :73, End Shift :77), count status filters draft/in_progress/completed/cancelled (api/inventoryCounts.ts:9), detail view with history (sc-hist-title stock-counting.ftl:42), thresholds per location with Global (All Locations) fallback and per-threshold enable/disable (ThresholdConfigScreen.tsx:152-155,203,279-280, enabled state :39-97), transit audit with source/destination/qty/sent-time and OVERDUE flag (TransitAuditScreen.tsx:68,103-112, css :45-51), transfer reversal returns stock to source (cancel_stock_transfer db/stock_transfers.rs:666-679, cancelStockTransfer api/stockTransfers.ts:132-137, StockTransfersScreen.tsx:195-204), suppliers + PO with order date and Receive landing stock automatically (register.tsx:9-27 both section: 'inventory'; purchase_orders.rs:395-470 received+damaged, good qty enters sellable stock), Inventory Report stock/threshold/unit price/unit cost/margin/stock value print+CSV (inv-report-csv-header-* inventory.ftl:57-65, InventoryReportScreen.tsx:15,45-53). · id/ counterpart repaired with the same one finding. -->

## Stock levels

Stock is tracked per product per location (warehouse or register). Sales
decrement stock automatically, and each register serves from the location it
is assigned to. A location picker switches the current view, so levels are
always read in context.

## Adjustments

Stock adjustments run as a two-step flow: pick the product, then choose a
reason — **Restock** (supplier delivery), **Stock take correction**, **Customer
return**, **Damaged / spoiled**, **Write-off / expiry**, **Transfer to other
location**, or a custom reason — and enter the change. Every adjustment writes
a movement ledger entry, so any change can be traced back to who did it, when,
and why.

## Stock counts

A stock count reconciles the system against what is physically on the shelf.
Start an **inventory shift** (for example `Night shift count`), count, and the
corrections are recorded against the shift. Counts are listed with status
filters, and each one opens a detail view with its history, so a discrepancy
found later is still explainable.

## Thresholds and alerts

Low-stock alerts flag products below their threshold. Thresholds are
configured per location, with a **Global (All Locations)** fallback for
products that have no location-specific setting, and each threshold can be
enabled or disabled independently.

## Transfers and transit

Stock moves between locations as recorded transfers. In-transit items are
audited with their source, destination, quantity, and send time; overdue
transit is flagged so nothing is lost between shelves. A mistaken transfer can
be **reversed**, returning the stock to its source location.

## Purchase orders

Restocking via suppliers goes through purchase orders: manage suppliers, create
an order with a supplier and order date, and **Receive** it when the delivery
arrives — the received quantities land in stock automatically.

## Reports and the movement ledger

The **Inventory Report** shows stock, threshold, unit price and cost, margin,
and stock value per product, and can be printed or exported as CSV. The
**Inventory Transaction Log** is the ledger behind all of it, covering sales,
voids, refunds, transfers, received purchase orders, stock counts, and manual
adjustments — where stock came from and went. (The log screen is part of the
app, though it is not currently reachable from any navigation menu.)

> last audited 09-09-26 by docs-auditor
