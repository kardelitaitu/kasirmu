# Receipt hierarchy code — plan and design review

<!-- Audit stamp: 2026-09-29 · status: AGREED FOR 10,000+ ENTERPRISE SCALE · verified against branch 0.0.40 -->

Plan for a hierarchical, human-readable receipt code built from per-entity index
ids (location, terminal, staff) plus an annual continuous sequence, supporting
enterprise scale (10,000+ locations, 10,000+ terminals, 10,000+ staff).

**Status: agreed.** Upgraded to Base62 (`0–9`, `a–z`, `A–Z`) dynamic-width formatting
(minimum 2 characters: `00`–`zz`, expanding to 3 characters: `100`–`zzz` when ≥ 3,844).
Supports 10,000+ entities per tenant with 238,328 capacity per axis while keeping normal
receipt codes ultra-compact at 22–23 characters.

---

## 1. Agreed format

```
01-02-260929-10a-000123
│  │   │      │  └────── sequence: continuous, 6 digits (000001–999999 per terminal/year)
│  │   │      └───────── staff: Base62 min 2 chars (01–zz, expands to 100–zzz when ≥ 3,844; 00 = none)
│  │   └──────────────── date: store-local, YYMMDD (6 digits)
│  └──────────────────── terminal: Base62 min 2 chars (01–zz, expands to 100–zzz when ≥ 3,844)
└─────────────────────── location: Base62 min 2 chars (01–zz, expands to 100–zzz when ≥ 3,844)
```

**22–25 characters.** Base62 alphanumeric segments separated by hyphens.
- **22 characters** for typical operations where location, terminal, and staff are under 3,844 (e.g. `01-02-260929-05-000123`).
- **23 characters** when one segment reaches 3 characters (e.g. `01-02-260929-10a-000123` or `a01-02-260929-05-000123`).
- **25 characters** max when all three segments exceed 3,843 (e.g. `a01-c02-260929-10a-000123`).
- Fits on **1 line** with huge margins on standard 58 mm thermal receipt printers (Font A: 32 columns; Font B: 42 columns).
- Fits with > 23 columns to spare on 80 mm printers (Font A: 48 columns).
- The sequence is **continuous per terminal per fiscal year** — starts at `000001` on 1 January and runs to `999999`, so **999,999 per terminal per year** (2,739/day). It does **not** reset daily.

Sorting is chronological within a fiscal year: `…260929-10a-000123` sorts after
`…260101-01-000900`. That is correct for a continuous series — the date segment
is the issue date, not part of the ordering key.


### Two-digit year — consequences, accepted

- The code is unique for **100 years**. Accepted, and written down so nobody
  rediscovers it in 2126.
- **The counter key is `(terminal_idx, fiscal_year)`** (§5). Because the series
  is continuous, the daily-boundary trap in §4.4 no longer threatens numbering:
  a sale at 23:59 and one at 00:01 still get strictly increasing numbers. The
  timezone still decides *which date is printed*, and still decides the year the
  counter belongs to, so §4.4 remains in scope.

### Separator — hyphens, and keep every field separate

`01-02-260929-10a-000123`, **not** `0102/260929/10a/000123`. Three reasons:

1. **`/` cannot safely appear in the payment-link QR.** `receipt.rs:546-549`
   substitutes `{receipt}` into `payment_link_template` with a raw
   `str::replace` — **no URL-encoding anywhere**. In a path-style template a `/`
   silently becomes extra path segments; in a query-style template it depends on
   the framework. `-` is inert in both. Wanting slashes is fine, but then the fix
   is to percent-encode at that call site — a separate change with its own risk.
2. **Dynamic widths require clear delimiters.** Because segments can be 2 characters
   (`01`) or 3 characters (`10a`), hyphens ensure exact, unambiguous parsing:
   `code.split('-')` yields `[loc, term, date, staff, seq]`.
3. **Barcode fits comfortably.** 22–25 characters easily encodes in Code 128 Mode B/C
   and QR codes, scanning reliably on 58 mm heads.

### Decisions taken 2026-09-18 (updated 2026-09-29)

| Question | Decision |
|---|---|
| Sixth segment (`01-01`)? | **Dropped.** Five segments. |
| Scale per axis | **Base62 dynamic width (`00`–`zz`, expanding to `100`–`zzz` at ≥ 3,844)** — supports up to 238,328 per tenant, keeping normal codes at 22 chars. |
| Date width | **`YYMMDD`** (6 chars). Counter key is `(terminal, fiscal year)`. |
| Terminal index scope | **Per tenant**, not per location. |
| Source of the terminal | **New `sales.terminal_id` column.** |
| Sequence tail | **`000123`** (6 digits) — continuous per terminal per fiscal year (up to 999,999/yr). |
| Separator | **Hyphens, five separate fields.** Not slashes, not merged. |
| Is this the tax number? | **It is the internal nomor faktur.** A Faktur Pajak number is DJP-issued — see §4.3. |
| PKP / e-Faktur | **Yes, in scope** — carry the 17-digit DJP number and kode status (§4.3). |

---

## 2. What the code measures today (read at fc1804290)

| Fact | Location |
|---|---|
| Printed receipt number is `sale.id` (UUID v7) | `crates/kasirmu-core/src/db/sales_checkout.rs:632`, `sales_lifecycle.rs:580` |
| `SALE-` prefix is invented by the UI, not core | `ui/src/features/sales/PaymentModal.tsx:1327`, `payment/completedSale.ts:81` |
| Sales history shows the bare UUID | `ui/src/features/sales/SalesHistoryScreen.tsx:435` |
| Renderer prints `#{receipt_number}` and barcodes it | `crates/kasirmu-hal/src/drivers/receipt.rs:427`, `:541` |
| NPWP is already printed | `crates/kasirmu-hal/src/drivers/receipt.rs:420` |
| `locations` = renamed `store_profiles`; has `tenant_id`, `legal_entity_id`, `timezone`, `ticket_prefix` | `migrations/20260813_init.pg.sql:2073`, `20260906_rename_store_to_location.sql` |
| `terminals` has `tenant_id`, `bound_store_id` — **re-bindable** | `migrations/20260813_init.sql:926`, `20260912_terminals_tenant.sql` |
| `users` (staff) is per-tenant; multi-store via `user_store_access` | `migrations/20260813_init.sql:972`, `:946` |
| **`sales` has NO `terminal_id`** — only `user_id` (nullable) and `store_id` | `migrations/20260813_init.sql:599-622` |
| `shifts` does have `terminal_id` | `migrations/20260813_init.sql:642` |
| `tz_modifier()` returns the **primary** store's fixed offset, UTC fallback | `crates/kasirmu-core/src/db/reports/datetime.rs:87-99` |
| `kds_daily_counters` keys by `(date, store_id)` but uses the primary tz | `crates/kasirmu-core/src/db/kds.rs:123-149` |
| Atomic single-statement counter pattern already exists | `crates/kasirmu-core/src/db/fiscal.rs:429-446` |
| Statutory series already supports `yearly` reset and arbitrary padding | `crates/kasirmu-core/src/db/fiscal.rs:164-171` |
| Freeze-on-issue precedent for display facts | `kds.rs:155-167` (D16/W2-A), `20260926_location_ticket_prefix.sql` |

---

## 3. What is good about this

- **Barcode width.** The barcode currently encodes `SALE-<36-char uuid>` (41
  chars). 31 fixed-width numeric chars encodes in Code 128 Mode C with high density
  and scans far more reliably on a 58 mm head.
- **Customers stop seeing UUIDs.**
- **Fixed-width segments** parse without a delimiter hunt.
- **999,999/terminal/year is far beyond any restaurant** (2,739/day).
- **Supports large-scale enterprise deployments (10,000+ stores, terminals, staff)** without running into ID exhaustion.

---

## 4. Design constraints

### 4.1 An index must never be reused (highest)

If location `00002` is deleted and the next location reuses `00002`, every historic
receipt whose code says `00002` now resolves to a *different* store. The code stops
being evidence. The index is therefore **not** "the Nth location" — it is an
immutable badge, allocated monotonically, tombstoned on delete.

Corollary: the allocator must **fail loudly at `238,328`** ($62^3$), never wrap. A silent
wrap reissues live codes — and with a tax number on the receipt, that is
falsification.

### 4.2 Enterprise scale: Base62 dynamic width (10,000+ support, 22–25 chars)

The original 2-hex draft capped each axis at 256. For enterprise tenants with
franchises, large mall footprints, or high staff turnover, 256 is inadequate:
- **10,000 locations:** chains, franchises, and regional branches easily exceed 256.
- **10,000 terminals:** multi-lane supermarkets and quick-service restaurant networks operate thousands of POS registers.
- **10,000 staff:** cashier turnover burns through employee indices over 5–10 years.

**Resolution:** Base62 (`0–9`, `a–z`, `A–Z`) with **dynamic width (minimum 2 characters)** provides:
- **Minimum 2 characters:** `00`–`zz` covers up to **3,844** entities per tenant. `00` is reserved as the "none" sentinel (kiosk / online sale).
- **Expands to 3 characters:** `100`–`zzz` automatically at $\ge 3,844$, covering up to **238,328** entities ($23.8\times$ the 10,000 requirement).
- **Headroom:** 238,328 unique immutable indices per tenant for each axis (location, terminal, staff).
- **Format:**
  - Standard store (< 3,844 entities): `01-02-260929-05-000123` (**22 characters**).
  - High turnover staff (≥ 3,844 staff): `01-02-260929-10a-000123` (**23 characters**).
  - All large (≥ 3,844 loc, term, staff): `a01-c02-260929-10a-000123` (**25 characters**).
- **Thermal printer fit:** 22–25 characters easily fits on 1 single line on 58 mm printers (Font A = 32 columns; Font B = 42 columns) and 80 mm printers (Font A = 48 columns).
- **Barcode & QR fit:** Code 128 Mode B and QR codes scan rapidly and reliably on 58 mm heads.


### 4.3 REVISED 2026-09-18 — "Faktur" has two meanings, and one is not ours to design

You asked for a Faktur number rather than `INV/26/000123`. That reframes the
problem, because under **PER-11/PJ/2025 Pasal 37** a *Faktur Pajak* number is
not ours to invent:

- The complete number is **17 digits**: 2-digit *kode transaksi* (`01`–`10`,
  fixed by DJP) + 2-digit *kode status* (`00` = normal, `01`/`02`/… = *faktur
  pengganti* ke-1, ke-2) + **13-digit NSFP**.
- The NSFP is **2-digit year + 11-digit sequence**, and it is **issued by DJP** —
  automatically, when the e-Faktur is uploaded to Coretax and approved. 2025
  starts at `2500000000001`.
- A *faktur pengganti* **keeps the same NSFP**; only the kode status increments.

Sources: [DDTC](https://news.ddtc.co.id/literasi/kamus/1811165/update-2025-apa-itu-kode-dan-nomor-seri-faktur-pajak)
(2025-06-02) and [Ortax](https://www.ortax.org/ketentuan-terbaru-kode-transaksi-dan-nomor-seri-faktur-pajak)
(2025-06-11), both citing PER-11/PJ/2025.

Two different things, only one of which we own:

| Thing | Number | Who owns the format |
|---|---|---|
| **Faktur Pajak** — VAT invoice, PKP only | `01` `00` `2600000000123` (17 digits) | **DJP**, assigned on upload |
| **Nomor faktur / nota** — commercial invoice | ours | **Us** |

`01-02-260918-01-A001` can never be the NSFP. It **can** be the commercial nomor
faktur, which is what a POS receipt actually needs; the DJP number arrives later,
and only if the sale is reported through e-Faktur.

**Printed result:**

```
#01-02-260918-01-A001                nomor faktur (ours)
NPWP: 00.000.000.0-000.000
Faktur Pajak: 01002600000000123      DJP, printed only once issued
```

**This also retires the earlier blocker.** Because the hierarchy code is not the
statutory series, a daily-reset tail is legally fine — the date keeps every code
unique, and continuity is DJP's problem, not ours. What remains is an
operational choice, not a compliance one: see §7.

Voids still consume a number in our series; that is correct, and the void is
recorded against the sale. DJP models correction differently — a *faktur
pengganti* reuses the NSFP and bumps kode status — so the correction lifecycle
needs modelling explicitly, below.

### 4.3.1 e-Faktur fields (in scope)

You confirmed you are a PKP issuing e-Faktur. Two consequences:

- **The DJP number is not known at checkout.** It is assigned when the e-Faktur
  is uploaded and approved, so it arrives *after* the sale. It cannot be part of
  the code we mint at the till; it is a separate stored field, printed only once
  it exists.
- **A correction does not get a new number.** A *faktur pengganti* keeps the same
  NSFP and increments kode status (`00` → `01` → `02`). The model is therefore
  "one NSFP per sale, plus a revision counter" — not "a new number per reprint".

Fields on `sales` (§5): `faktur_pajak_nsfp` (13 digits, DJP-issued),
`faktur_pajak_kode_transaksi` (2 digits, default `01`) and `faktur_pajak_status`
(2 digits, default `00`, incremented per pengganti). Print the 17-digit string
only when `faktur_pajak_nsfp` is non-null.

### 4.4 The daily boundary must be per-location

Both the date segment and the counter must agree on when the day ends.
`tz_modifier()` reads `WHERE is_primary = 1` (`datetime.rs:91`), and `kds.rs:128`
already inherits that for its per-store counter — so in a multi-offset chain a
non-primary store's counter resets at the wrong instant and two receipts can
collide. **Fix: resolve the offset per location, not per primary.** This is a
pre-existing latent bug in the KDS path, not something this plan introduces.

### 4.5 Freeze the code on the sale

Derive and store the assembled string at checkout. Do not rebuild it at print
time — a terminal re-bound to another store, or a reprint six months later, must
show what the receipt showed then. Same ruling as D16/W2-A froze
`kds_orders.ticket_prefix`.

### 4.6 Overflow must error, not wrap

At `999999` the allocator must **error**. Wrapping to `000001` replays numbers
already issued in the same fiscal year.

### 4.7 Migration plumbing

`20260813_init.pg.sql` is **generated** by `scripts/generate-pg-migration.py` and
must not be hand-edited. New columns go into a SQLite migration and flow through
the generator, and the PG drift guard runs on it. `PG_INIT` cannot evolve an
existing database, so cloud rollout needs the reconciliation path, not just a
new migration.

---

## 5. Proposed design

**New columns** (one SQLite migration; PG side via the generator)

- `locations.index_id INTEGER` — unique per `tenant_id` (1–238,328)
- `terminals.index_id INTEGER` — unique per `tenant_id` (1–238,328)
- `users.index_id INTEGER` — unique per `tenant_id` (1–238,328)
- `sales.terminal_id TEXT` — populated at checkout
- `sales.display_code TEXT` — the frozen 22–25 char string
- `sales.faktur_pajak_nsfp TEXT` — 13 digits, DJP-issued, NULL until approved
- `sales.faktur_pajak_kode_transaksi TEXT NOT NULL DEFAULT '01'`
- `sales.faktur_pajak_status TEXT NOT NULL DEFAULT '00'`

All three index columns: monotonic allocator, tombstone on delete, **refuse at
238,328** ($62^3$), `0` / `"00"` reserved as the "none" sentinel (kiosk / system sale has no
staff).

**New table** `receipt_number_counters`

```
(terminal_idx TEXT, fiscal_year TEXT, counter INTEGER,
 PRIMARY KEY (terminal_idx, fiscal_year))
```

Claim with the same single-statement shape as `fiscal.rs:429-446` — the
increment-vs-reset decision reads the row's own `fiscal_year` at write time,
inside the sale transaction, so a rolled-back sale consumes no number.

The key is **terminal + year only**, deliberately: the series is continuous, so a
terminal re-bound to another location must *continue* its counter rather than
restart it. No collision results — the location segment still differs, so
`01-02-…-000123` and `03-02-…-000124` are distinct strings.

**Assembly** — inside the existing checkout tx, beside the statutory claim:

```
{loc_base62}-{term_base62}-{YYMMDD}-{staff_base62}-{seq:06}
```
Where each entity index is formatted via `format_base62_index(idx, min_width=2)`:
- `idx < 3,844`: pads to 2 Base62 characters (`01`–`zz`, `00` for none/sentinel).
- `idx >= 3,844`: formats naturally as 3 characters (`100`–`zzz`, up to 238,328).

**Print** — `receipt.rs:427` shows the code; `:541` barcodes the code instead of
the 41-char UUID. `sales.id` stays the immutable identity everywhere in the DB —
nothing keys off the display code. The 17-digit DJP Faktur Pajak number (§4.3) is
a separate stored field, printed only once issued.

---

## 6. Phases

1. **Migration + allocator** — index columns, `sales.terminal_id`,
   `sales.display_code`, counter table, Base62 dynamic encoder (`format_base62_index`),
   monotonic allocator with tombstone, refuse at 238,328. Tests for concurrency,
   rollover, formatting, and exhaustion.
2. **Per-location timezone** — parameterise the offset resolver; fix the
   `kds.rs` inheritance while touching it.
3. **Checkout assembly** — claim + freeze + store `display_code`, populate
   `sales.terminal_id`.
4. **Renderer + UI** — `receipt.rs`, barcode, `ReceiptPreview`, sales history.
5. **Backfill** — existing sales keep `display_code = NULL` and fall back to
   today's behaviour. Do **not** retro-generate codes; they would be fiction.
6. **e-Faktur (independent, later)** — the three `faktur_pajak_*` columns, an
   import path that stamps the NSFP once an e-Faktur is approved, a *pengganti*
   operation that increments kode status, and the printed 17-digit line. Not
   blocked by 1–5.

---

## 7. Remaining

- **Overflow policy at 238,328** (§4.2) — hard refuse confirmed.
- **Century** (§1) — `YYMMDD` bounds uniqueness to 100 years. Accepted.
- **Fiscal year** (§5) — assumed to be the calendar year, matching the Indonesian
  tax year. A non-calendar year changes the counter key and nothing else.
- **Kode transaksi** (§4.3.1) — assumed `01` for every sale. If some sales need
  `04`/`05`/`07`, that becomes per-sale data rather than a constant.

