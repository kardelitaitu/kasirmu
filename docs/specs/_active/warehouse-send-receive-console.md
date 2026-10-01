<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. This is an approved design spec whose falsifiable surface is the §2 "What exists to build on" table and the command names the workflows call, so that is what was checked. Every command the workflows invoke resolves to a real Tauri command: `receive_purchase_order` is implemented in `apps/desktop-tauri/src/commands/purchasing.rs`; `list_in_transit_transfers_scoped`, `receive_stock_transfer_scoped`, `create_stock_transfer` and `send_stock_transfer` are all in `apps/desktop-tauri/src/commands/stock_transfers.rs`. That is the load-bearing claim of §5 and §6 — the spec asserts the core send/receive/count flows need no new backend — and it holds against the current tree, which has not drifted from what the spec was written against. The schema anchors are real too: the `stock_counts` table is `crates/kasirmu-core/migrations/20260813_init.sql:699` with its `stock_count_lines` child at `:688`, and `products.rack_location` is a column at `:457` exactly as cited. `print_sales_receipt` and the barcode-scanner surface are in `apps/desktop-tauri/src/commands/hardware.rs`, and `useBarcodeScanner` is exercised across the POS test suites, consistent with §2 placing the hook in the sales feature for copying. · Deliberately NOT treated as drift: §7's file tree lists files to CREATE, and §8's FTL keys are illustrative, so neither is a claim about what exists — that is the same reason `check-dead-refs.py` excludes a plan naming files it intends to create, and re-verifying them would be auditing a proposal against itself. · NOT re-measured: the phased-delivery status in §9, which records what has since been built; the spec is dated 2026-08-23 and its Version 2.0 header is a design statement, not a version-manifest claim (the project version lock is a different thing entirely and is untouched). · No stamp or footer existed on this file before this pass. -->

# Warehouse POS — Professional Operations Console

> **Status:** Approved — decisions locked · **Area:** inventory, warehouse · **Version:** 2.0 (professional warehouse POS)

**Architecture rule:** each workspace type is independently evolvable. The warehouse workspace **copies** its UI structure from the retail POS (`features/retail/`) rather than sharing components — no imports from `features/retail/*` or `features/sales/*`. This keeps warehouse and retail-pos free to diverge without coupling.

**Backend rule:** reuse the existing Rust domains (`stock_transfers`, `purchase_orders`, `stock_counts`, `inventory_locations`, `products.barcode/rack_location`) and ESC/POS printing. Add backend only where a workflow genuinely needs new state (damage marking, pick-list status).

---

## 1. Goal

A **professional warehouse POS**: barcode-first, document-driven daily operations for inbound receiving, outbound picking/sending, cycle counting, and bin-level stock visibility — the warehouse equivalent of a retail POS, with the retail POS's speed and feel.

## 2. What exists to build on (no re-invention)

| Capability | Existing artifact | Reuse |
|---|---|---|
| Send/receive stock between locations | `stock_transfers` domain (draft → in_transit → received, partial receive) | Direct reuse |
| Receive against supplier purchase orders | `purchase_orders` domain + `receive_purchase_order` (updates inventory) | Direct reuse |
| Cycle counting | `stock_counts` domain (full / cyclic / spot → draft / in_progress → complete + adjustments) | Direct reuse |
| Barcode scanning | `useBarcodeScanner` hook (sales) — **copied** into warehouse | Copy + edit |
| Bin/rack per product | `products.rack_location` (ADR #36) | Direct reuse |
| Printing | ESC/POS `print_receipt` / `print_sales_receipt` commands + printer abstraction | Add warehouse print payloads (label, packing slip, receiving report) |

---

## 3. Console layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Warehouse · [RECEIVE ▸] [SEND ▸] [COUNT] [STOCK]   (mode tabs)     │
├───────────────────────────────────────────┬─────────────────────────┤
│  SCAN / PICK INPUT                        │  SESSION PANEL (cart)   │
│  ┌─────────────────────────────────────┐  │  Document: PO-2411 /     │
│  │  [ 🔍 scan barcode or type SKU… ]  │  │  TRF-092  (source)      │
│  └─────────────────────────────────────┘  │  ───────────────────    │
│  [quick product grid — fallback tap]     │  SKU-042 Bolt      3×   │
│  [SKU-001] [SKU-002] [SKU-003]          │  SKU-103 Spring    1×   │
│  (bin: A-12)  (bin: B-04)  (bin: A-07)  │  ───────────────────    │
│                                          │  Lines: 2 · Items: 4    │
│                                          │  [Complete RECEIVE]     │
│                                          │  [Print Label] [Print]  │
├──────────────────────────────────────────┴─────────────────────────┤
│  [F1 Receive] [F2 Send] [F3 Count] [F4 Stock] [F5 Print]  F3–F10  │
│  F11 Fullscreen · F12 reserved                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Barcode-first**: the top input is a persistent scan field; a hardware scan (or Enter) resolves the product and adds it to the session. The grid is a fallback for products without barcodes.
- **Session panel** is the "cart" — but it shows the active document (PO or transfer), line quantities, and per-line bin hints.
- **FnBar** mirrors the retail pattern (`warehouseShortcuts.ts` manifest + `WarehouseFnBar.tsx` + parity test).

---

## 4. F-key map

| Key | Action | Behavior |
|---|---|---|
| **F1** | `receive` | Incoming popup session — receive (PO or transfer) |
| **F2** | `send` | Outgoing popup session — pick + send |
| **F3** | `count` | Cycle-count popup session |
| **F4** | `stock` | Stock view (bin-level) |
| **F5** | `print` | Print menu (label / packing slip / receiving report) |
| **F6–F10** | *(placeholder)* | Reserved — rendered, no handler |
| **F11** | `fullscreen` | Global shell binding (already active for warehouse) — badge only |
| **F12** | *(reserved)* | Placeholder |

**Popup sessions** (F1/F2/F3): persistent floating mini-consoles that stay open until dismissed (Esc / ✕) and can be held open while switching to another task. F1+F2 can be open simultaneously (interleaved inbound/outbound day). Re-press focuses instead of stacking.

---

## 5. Workflows

### 5.1 RECEIVE (inbound)

Two receive sources, selected at session start:

**A. Receive against Purchase Order (supplier inbound)** — primary
1. Pick a PO (open/approved) → session pre-fills with its lines (SKU, expected qty, bin)
2. **Scan each barcode** → line highlights, staff enters/confirms received qty
3. Per-line **damage/quality marking**: `ok` / `damaged` / `short` (missing) — new state per line
4. "Complete Receive" → `receive_purchase_order` for the good qty + a stock adjustment for damaged/short (new backend: record damage on the PO line)
5. Auto-print **receiving report** (or queue for batch print)

**B. Receive against Stock Transfer (inter-warehouse inbound)**
1. Pick an in-transit transfer destined for this location (`list_in_transit_transfers_scoped`)
2. Scan lines, adjust `received_qty` per line (partial receive supported)
3. "Complete Receive" → `receive_stock_transfer_scoped`

### 5.2 SEND (outbound — pick list + verify)

1. Pick a **destination** (store/warehouse from topology)
2. Build the cart (scan or grid tap) — each line shows its **bin** (pick-from hint)
3. **Pick-verify**: as items are picked, staff scans each one against the cart → line marks `picked` (new pick-list state)
4. "Complete Send" → `create_stock_transfer` + `send_stock_transfer` (stock leaves, transfer → in_transit)
5. Auto-print **packing slip**

### 5.3 COUNT (cycle counting)

Reuses the `stock_counts` domain end-to-end:
- Create count (full / cyclic / spot) → scan or type counted quantities per line → complete → adjustments posted
- Warehouse console adds barcode-first counting UX on top of the existing `stock_counts` commands (existing StockCountsFlow screens stay for full management)

### 5.4 STOCK (bin-level visibility)

- Location-scoped stock table with **bin column** (`rack_location`) + search by SKU/name/barcode + sort + low-stock alerts
- Manual ± adjust preserved (audit path) — same as current WarehouseScreen, kept as this tab

### 5.5 PRINT

- **Product label**: single item → `print_receipt`-style ESC/POS payload (SKU, name, barcode)
- **Packing slip**: send document → lines + qty + destination
- **Receiving report**: receive document → lines + received/damaged/short
- Reuses the printer abstraction; new payload builders in the warehouse feature

---

## 6. Backend additions (minimal, only where workflows need new state)

| Addition | Why | Where |
|---|---|---|
| PO line damage/short state | receive workflow must record quality per line | `purchase_order_lines` + `receive_purchase_order` extension or a `po_receive_lines` table |
| Pick-list status on transfer lines | send workflow marks `picked` per line | `stock_transfer_lines.picked_qty` or status |
| Scan-lookup command | resolve barcode → product at this location quickly | existing product lookup suffices — verify before adding |

Everything else reuses existing commands — no backend change needed for the core send/receive/count flows.

---

## 7. Files to create (`ui/src/features/warehouse/` — all self-contained copies)

```
├── WarehouseConsole.tsx        ← main screen (copied from RetailPosScreen.tsx, edited)
├── WarehouseScanInput.tsx      ← barcode-first input (copied from ProductLookupScreen/useBarcodeScanner)
├── useWarehouseScanner.ts      ← copied from sales/useBarcodeScanner.ts
├── WarehouseProductGrid.tsx    ← fallback grid with bin column (copied from RetailProductGrid.tsx)
├── WarehouseSessionPanel.tsx   ← the "cart" — document + lines + qty (copied from RetailCartPanel.tsx)
├── useWarehouseSession.ts      ← session state (copied from usePosState.ts / useRetail*, simplified)
├── warehouseShortcuts.ts       ← F-key manifest (copied from retailShortcuts.ts)
├── WarehouseFnBar.tsx          ← F-key bar (copied from RetailFnBar.tsx)
├── warehouseShortcutParity.test.tsx
├── receive/
│   ├── WarehouseReceiveFlow.tsx    ← PO/transfer source picker + receive session
│   └── WarehouseDamageDialog.tsx   ← per-line ok/damaged/short marking
├── send/
│   ├── WarehouseSendFlow.tsx       ← destination picker + pick-verify session
│   └── WarehouseDestinationDialog.tsx
├── count/
│   └── WarehouseCountFlow.tsx      ← barcode-first counting (wraps stock_counts commands)
├── stock/
│   └── WarehouseStockTab.tsx       ← bin-level view (existing WarehouseScreen body)
├── print/
│   ├── labelPayload.ts             ← ESC/POS payload builders (label, packing slip, receiving)
│   └── WarehousePrintDialog.tsx
├── warehouseUtils.ts, warehouseTypes.ts, WarehouseScreen.css
└── register.tsx (kept)
```

**Retired:** the standalone `StockTransfersScreen` (form-based) is replaced by the warehouse SEND/RECEIVE console; the purchasing POs screen stays for PO creation, warehouse adds the receiving UX.

---

## 8. FTL keys (en — illustrative)

```
warehouse-title = Warehouse
warehouse-mode-receive = Receive
warehouse-mode-send = Send
warehouse-mode-count = Count
warehouse-mode-stock = Stock

warehouse-scan-placeholder = Scan barcode or type SKU…
warehouse-scan-no-match = No product matches that barcode
warehouse-bin = Bin: { $bin }

warehouse-receive-source-po = Receive from purchase order
warehouse-receive-source-transfer = Receive from transfer
warehouse-receive-expected = Expected
warehouse-receive-received = Received
warehouse-receive-damaged = Damaged
warehouse-receive-short = Short
warehouse-receive-complete = Complete Receive

warehouse-send-destination = Send to…
warehouse-send-pick-verify = Scan to verify picked
warehouse-send-complete = Complete Send

warehouse-count-create = Start Count
warehouse-count-scan = Scan to count
warehouse-count-complete = Complete Count

warehouse-print-label = Print Label
warehouse-print-packing = Print Packing Slip
warehouse-print-receiving = Print Receiving Report

warehouse-fn-receive = Receive
warehouse-fn-send = Send
warehouse-fn-count = Count
warehouse-fn-stock = Stock
warehouse-fn-print = Print
warehouse-fn-reserved = { $key }
warehouse-fn-fullscreen = Fullscreen
warehouse-fn-bar-aria = Function keys

warehouse-popup-receive-title = Incoming session
warehouse-popup-send-title = Outgoing session
warehouse-popup-count-title = Count session
warehouse-popup-close = Close
```

(Same keys in the ID bundle with Indonesian translations.)

---

## 9. Phased delivery

| Phase | Scope | Depends on |
|---|---|---|
| **P1 — Console + SEND/RECEIVE core** | `warehouseShortcuts` + `WarehouseFnBar`, console shell, scan input, session panel; receive against **transfers** + send with pick-verify (existing commands only) | None (foundations exist) |
| **P2 — PO receiving + damage marking** | receive against **purchase orders**, damage/short per line, receiving-report print | New backend: PO-line receive state |
| **P3 — Count** | barcode-first counting popup wrapping `stock_counts` commands | P1 console |
| **P4 — Print** | label + packing slip + receiving report payloads + dialog | P1 (ESC/POS exists) |
| **P5 — Stock tab + polish** | bin-level stock view, low-stock, manual adjust | P1 |

P1 alone delivers the "professional warehouse POS" daily flow for inter-warehouse movement; P2 adds supplier receiving; P3–P5 round it out.

---

## 10. Test level

- Vitest: `useWarehouseSession` (add/remove line, qty, mode switch, pick-verify state)
- Vitest: scan input resolves barcode → adds line; no-match shows toast
- Vitest: receive flow against transfer + PO renders and submits correct commands
- Vitest: damage dialog posts per-line state
- Vitest: F-key parity (manifest ⇄ FnBar ⇄ keydown; placeholders have no handlers; F11 shell-owned)
- Rust: new backend additions (PO receive state, picked_qty) get unit + integration tests; existing send/receive/count tests remain green

---

## 11. Resolved decisions

All six design decisions are **resolved** (2026-08-23) and locked into this spec:

1. **Popup concurrency — simultaneous.** F1 (Receive) and F2 (Send) popup sessions can be open at the same time, each holding independent session state; re-pressing a key focuses the existing popup instead of stacking. Interleaved inbound/outbound day is the normal warehouse workflow.
2. **Damage handling — inline per line, during receive.** Each received line records `ok / damaged / short` while scanning; good qty hits stock via the existing command, damaged/short quantities persist on the PO line (small backend addition: PO-line receive state) and optionally auto-generate a stock adjustment. Damage is captured at the dock, not afterwards.
3. **Pick-verify strictness — warn + manager override.** Complete Send stays disabled until `picked == qty` on every line (the daily discipline); a manager can override with a confirmation dialog that records who overrode and why. Not a hard block.
4. **Receive confirmation — toast + cart reset + print offer.** On complete: success toast with the document number, cart clears, and a non-blocking "Print packing slip? [Yes]/[No]" offer appears. No blocking success screen (matches retail's `retail-toast-sale-complete` pattern).
5. **Transfer number format — reuse existing `TRF-` numbers.** One document, one number across workspaces; the UI shows status + source columns for type visibility instead of encoding the workspace in the prefix.
6. **Grid vs scan-only — keep the fallback grid.** Scan input is primary and always focused; the searchable grid (name/SKU/barcode) sits below as the manual path for non-barcoded or unreadable items. Tap = same "add to session" as a scan.

> last audited 29-09-26 by docs-auditor
