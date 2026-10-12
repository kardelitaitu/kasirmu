# Pilot Merchant Onboarding & Verification Playbook

> Operational manual for the 10–20 pilot merchant onboarding campaign in Indonesia (Retail & F&B / Restaurant Dining).

---

## 1. Executive Summary & Goals

The Pilot Merchant program prepares kasir.mu for live production deployment across 10–20 selected retail and dining venues in Indonesia. This playbook standardizes the 5-minute first-run onboarding flow, hardware configuration, Indonesian tax presets (PB1 / PPN), multi-terminal dining operations, and resilient offline shift reconciliation.

---

## 2. 5-Minute First-Run Provisioning Checklist

```
[ Step 1: Device Link ] ──→ [ Step 2: Store Profile ] ──→ [ Step 3: Tax Preset ] ──→ [ Step 4: Hardware Check ] ──→ [ Step 5: First Sale ]
```

### Step 1: Device Authentication & Provisioning
- **Desktop (Windows / macOS / Linux):** One-click Google Authentication via browser handshake (`ProvisioningFlow.tsx`).
- **Tablet (Android 10+):** 6-digit Crockford device pairing code or email OTP.
- **Offline Fallback:** If internet is unavailable during initial deployment, select **Local Standalone Mode** to provision SQLite ledger immediately without cloud dependency.

### Step 2: Store Profile & Currency
- **Store Name:** Input legal or trade name (e.g., *Warung Kopi Nusantara*).
- **Store Timezone:** Set store-local IANA timezone (`Asia/Jakarta` WIB, `Asia/Makassar` WITA, or `Asia/Jayapura` WIT) to guarantee correct business date roll-over and tax boundary computations.
- **Currency:** Locked to `IDR` (minor units = 0 exponent, Rupiah formatting).

### Step 3: Indonesian Tax & Service Charge Presets
Select the matching merchant category preset:
- **F&B / Restaurant Dining (PB1 / Pajak Restoran):**
  - PB1 Rate: **10%** (applied to food & beverage subtotals).
  - Optional Service Charge: **5%** (calculated before or after tax based on local regional regulation).
- **Retail Store (PPN):**
  - PPN Rate: **11%** (tax-inclusive or tax-exclusive pricing).

### Step 4: Hardware Pairing & Thermal Printer Test Chit
1. Connect 58mm or 80mm ESC/POS thermal printer via USB, Bluetooth, or LAN.
2. Navigate to **Settings $\to$ Hardware $\to$ Printers**.
3. Tap **Print Test Receipt**.
4. Confirm:
   - Header shop name, address, and timestamp.
   - Clean line-feed and paper-cut command execution.
   - Indonesian Rupiah glyph / formatting (`Rp 25.000`).

### Step 5: Test Sale & Multi-Tender Payment
1. Ring up sample item.
2. Select **Split Bill** or **Multi-Tender**:
   - Split Cash (e.g., Rp 50.000) and QRIS (e.g., Rp 25.000).
3. Verify QRIS 0% MDR validation: gross amount matches net charged minor units.
4. Verify drawer kick on cash payment.

---

## 3. F&B Dining Operations & Multi-Terminal Procedures

### 3.1 2D Floor Plan Setup & Table Merging
1. Open **Table Management** screen (`/tables`).
2. Arrange dining tables according to physical layout (Indoor, Outdoor, Bar zones).
3. If a large party arrives, drag Table A over Table B to trigger **Table Merge** (`merged_into` link). Orders placed on either table aggregate into a single unified bill.

### 3.2 Real-Time Tab Handover & Optimistic Concurrency Leases
- When a server tablet opens Table 4 to add drinks, an optimistic tab lease (`tabs:changed`) is broadcast over LAN P2P.
- If the cashier counter opens Table 4 simultaneously to tender, a prominent yellow conflict banner alerts:
  > *"Floor Tablet is currently editing this tab"* with an emergency **Take Over** button.
- Leases automatically expire after 60 seconds of inactivity to prevent deadlocks.

### 3.3 Recipe Inventory & Automated "86 / Habis" Badging
- Composite dishes (e.g. *Nasi Goreng Spesial*) automatically deplete component raw ingredients (*Beras*, *Telur*) from the kitchen storage ledger.
- When an essential ingredient stock hits 0:
  - The menu grid displays an immediate red **86** badge on the dish tile.
  - Cashiers cannot ring up the item unless a supervisor override is granted.

---

## 4. End-of-Day (EOD) Reconciliation & Crash Recovery

### 4.1 Shift Closure & Cash Drawer Reconciliation
1. At the end of cashier shift, tap **Close Shift**.
2. Count physical cash in till and input amount.
3. System compares physical cash against:
   $$\text{Expected Cash} = \text{Opening Float} + \sum \text{Cash Sales} - \sum \text{Cash Refunds}$$
4. If difference is non-zero, require mandatory shift note explaining discrepancy.
5. Print Z-Report receipt summarizing total revenue, gross profit, PB1 collected, and tender breakdowns.

### 4.2 Power Cut & Dirty Shutdown Recovery Protocol
- SQLite runs under `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL`.
- In the event of sudden blackout or battery drain:
  1. Power device back on and launch kasir.mu.
  2. SQLite automatically replays uncheckpointed WAL frames on open.
  3. Verify zero transaction loss: active draft carts restore from local crash cache.
  4. Run `PRAGMA integrity_check` to confirm database health.
