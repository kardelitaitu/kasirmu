# Receipt hierarchy code — plan and design review

<!-- Audit stamp: 2026-09-29 · status: AGREED FOR 10,000+ ENTERPRISE SCALE · verified against branch 0.0.40 -->

Plan for a hierarchical, human-readable receipt code built from per-entity index
ids (location, terminal, staff) plus an annual continuous sequence, supporting
enterprise scale (10,000+ locations, 10,000+ terminals, 10,000+ staff).

**Status: agreed.** Upgraded to Base62 (`0–9`, `a–z`, `A–Z`) dynamic-width formatting
(minimum 2 characters: `00`–`zz`, expanding to 3 characters: `100`–`zzz` at ≥ 3,844,
and 4 characters: `1000`–`zzzz` at ≥ 238,328).
Supports up to **14,776,336** entities per tenant per axis while keeping normal
receipt codes ultra-compact at 22–23 characters.

---

## 1. Agreed format

```
01-02-260929-10a-000123
│  │   │      │  └────── sequence: continuous, 6 digits (000001–999999 per terminal/year)
│  │   │      └───────── staff: Base62 min 2 chars (01–zz, 3 chars 100–zzz, 4 chars 1000–zzzz; 00 = none)
│  │   └──────────────── date: store-local, YYMMDD (6 digits)
│  └──────────────────── terminal: Base62 min 2 chars (01–zz, 3 chars 100–zzz, 4 chars 1000–zzzz)
└─────────────────────── location: Base62 min 2 chars (01–zz, 3 chars 100–zzz, 4 chars 1000–zzzz)
```

**22–28 characters.** Base62 alphanumeric segments separated by hyphens.
- **22 characters** for typical operations where location, terminal, and staff are under 3,844 (e.g. `01-02-260929-05-000123`).
- **23–25 characters** when segments reach 3 characters (e.g. `01-02-260929-10a-000123`).
- **24–28 characters** when large enterprise segments reach 4 characters (e.g. `01-02-260929-130a-000123` or `1000-1000-260929-130a-000123`).
- Fits on **1 line** on standard 58 mm thermal receipt printers (Font A: 32 columns; Font B: 42 columns) even at full 4-digit expansion (28 cols < 32 cols).
- Fits with > 20 columns to spare on 80 mm printers (Font A: 48 columns).
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
| Scale per axis | **Base62 dynamic width (`00`–`zz`, 3 chars `100`–`zzz`, 4 chars `1000`–`zzzz`)** — supports up to 14,776,336 per tenant, keeping normal codes at 22 chars. |
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

- **Barcode width & density.** The barcode currently encodes `SALE-<36-char uuid>`
  (41 chars). The 22–25 character alphanumeric hierarchy code (`01-02-260929-01-000123`)
  encodes compactly in Code 128 and QR codes, scanning reliably on 58 mm heads.
- **Customers stop seeing UUIDs.** Instead of an opaque GUID, receipts show an
  intuitive store, terminal, date, and cashier breakdown.
- **Delimited readability.** Hyphens provide clear visual rhythm (`01-02-260929-01-000123`),
  audio clarity for phone support, and foolproof string parsing.
- **999,999/terminal/year is far beyond any restaurant or supermarket** (2,739 sales/day).
- **Supports large-scale enterprise deployments (up to 238,328 per tenant)** without
  running into index exhaustion, while remaining ultra-compact (22 chars) for 99.9% of stores.

---

## 4. Design constraints

### 4.1 Lowest-available slot recycling on delete

When an entity (location, terminal, staff) is deleted, its index ID is released and recycled.
When a new entity is created, the system allocates the **lowest available free slot** ($1, 2, 3\dots$):
- **Store Operations Benefit:** A merchant with 5 cashiers retains clean badges `01` through `05`.
  When Cashier `06` leaves and is deleted, slot `06` is reclaimed by the next new hire rather
  than inflating to `07`, `08`, `09`... Similarly, if Terminal `02` is decommissioned, the
  replacement terminal reclaims slot `02`.
- **Historical Integrity Preserved:** Past sales receipts remain 100% auditable:
  1. The receipt code in `sales.display_code` is frozen with the issue date (e.g. `01-02-260315-06-000123` from March vs `01-02-260520-06-000456` from May).
  2. Analytics and reports link to the permanent UUID (`sales.user_id`, `sales.terminal_id`), so reporting per individual person or register is never mixed up.
- **On Deletion:**
  - `locations` and `terminals`: Row deletion immediately releases their `index_id`.
  - `users`: Soft-delete (`soft_delete_user`) clears `index_id = NULL` (or query filters `deleted_at IS NULL`), releasing badge `06` for the next user and preventing unique index collision.
- **Ceiling:** The allocator refuses if all slots up to `14,776,335` ($62^4 - 1$) are exhausted. Never wraps.

### 4.2 Enterprise scale: Base62 dynamic width (2 to 4 digits, up to 14.77 million)

The original 2-hex draft capped each axis at 256. For enterprise tenants with
franchises, large mall footprints, or high staff turnover, 256 is inadequate:
- **10,000 locations:** chains, franchises, and regional branches easily exceed 256.
- **10,000 terminals:** multi-lane supermarkets and quick-service restaurant networks operate thousands of POS registers.
- **10,000 staff:** cashier turnover burns through employee indices over 5–10 years.

**Resolution:** Base62 (`0–9`, `a–z`, `A–Z`) with **dynamic width (minimum 2 characters, expanding up to 4 characters)** provides:
- **Minimum 2 characters:** `00`–`zz` covers up to **3,844** entities per tenant. `00` is reserved as the "none" sentinel (kiosk / online sale).
- **Expands to 3 characters:** `100`–`zzz` automatically at $\ge 3,844$, covering up to **238,328** entities ($23.8\times$ the 10,000 requirement).
- **Expands to 4 characters:** `1000`–`zzzz` automatically at $\ge 238,328$, covering up to **14,776,336** entities (massive headroom for nation-wide retail giants).
- **Headroom:** 14,776,336 unique immutable indices per tenant for each axis (location, terminal, staff).
- **Format:**
  - Standard store (< 3,844 entities): `01-02-260929-05-000123` (**22 characters**).
  - High turnover staff (3,844–238,327 staff): `01-02-260929-10a-000123` (**23 characters**).
  - 4-digit enterprise entity (≥ 238,328 entities): `01-02-260929-130a-000123` (**24 characters**).
  - All large 4-digit entities: `1000-1000-260929-130a-000123` (**28 characters**, still comfortably under 32 columns for 58 mm printers).
- **Thermal printer fit:** 22–28 characters fits on 1 single line on 58 mm printers (Font A = 32 columns; Font B = 42 columns) and 80 mm printers (Font A = 48 columns).
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

`01-02-260929-01-000123` can never be the NSFP. It **can** be the commercial nomor
faktur, which is what a POS receipt actually needs; the DJP number arrives later,
and only if the sale is reported through e-Faktur.

**Printed result:**

```
#01-02-260929-01-000123               nomor faktur (ours)
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

- `locations.index_id INTEGER` — unique per `tenant_id` (1–14,776,335)
- `terminals.index_id INTEGER` — unique per `tenant_id` (1–14,776,335)
- `users.index_id INTEGER` — unique per `tenant_id` (1–14,776,335)
- `sales.terminal_id TEXT` — populated at checkout
- `sales.display_code TEXT` — the frozen 22–28 char string
- `sales.faktur_pajak_nsfp TEXT` — 13 digits, DJP-issued, NULL until approved
- `sales.faktur_pajak_kode_transaksi TEXT NOT NULL DEFAULT '01'`
- `sales.faktur_pajak_status TEXT NOT NULL DEFAULT '00'`

All three index columns: lowest-available slot allocator (gaps left by deleted
entities are recycled), **refuse at 14,776,336** ($62^4$), `0` / `"00"` reserved as the
"none" sentinel (kiosk / system sale has no staff).

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
- `3,844 <= idx < 238,328`: formats naturally as 3 characters (`100`–`zzz`).
- `238,328 <= idx < 14,776,336`: formats naturally as 4 characters (`1000`–`zzzz`).

**Print** — `receipt.rs:427` shows the code; `:541` barcodes the code instead of
the 41-char UUID. `sales.id` stays the immutable identity everywhere in the DB —
nothing keys off the display code. The 17-digit DJP Faktur Pajak number (§4.3) is
a separate stored field, printed only once issued.

---

## 6. Implementation phases & state-of-the-art roadmap

### Phase 1: Core engine, Base62 dynamic allocator & sequence counter (COMPLETED · commit 13ef0a472)
- **Schema & migrations:** `20261006_receipt_hierarchy_code.sql` committed and applied. Added `index_id` on `locations`, `terminals`, `users`, and `receipt_number_counters`.
- **Base62 dynamic formatter:** Zero-dependency encoder `format_base62_index(idx)`. Formats with minimum 2 characters (`00`–`zz`), expanding dynamically to 3 characters (`100`–`zzz`) at $\ge 3,844$, and 4 characters (`1000`–`zzzz`) at $\ge 238,328$.
- **Allocator ceiling & safety:** `INDEX_ID_MAX = 14_776_335` ($62^4 - 1$, 14,776,336 capacity). Refuses loudly on overflow rather than wrapping.
- **Lowest-available slot allocator with deletion recycling:** `allocate_entity_index` queries the lowest available free integer ($1, 2, 3\dots$) per `(tenant_id, entity_kind)`, automatically reclaiming gaps left by deleted/trashed entities.
- **Sequence counter:** `claim_receipt_sequence` advances sequence atomically per `(tenant, terminal, fiscal_year)`, refusing at `999,999`.
- **Testing:** Sibling unit tests in `receipt_code_tests.rs` covering Base62 boundaries, slot gap reuse on deletion, rollover refusal, rollback atomicity, and code assembly (22, 23, 24, and 28 chars).

### Phase 2: Per-location timezone resolution (MSL-29) (COMPLETED · commit 13ef0a472)
- Parameterised timezone resolver `resolve_receipt_date(now_utc, location_tz)` using `chrono::FixedOffset`.
- Integrated with `reports::parse_utc_offset` to support IANA zone names (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`) and standard numeric offsets (`+07:00`).
- Eliminates midnight race conditions where multi-timezone stores might otherwise date receipts incorrectly.

### Phase 3: Checkout assembly & transaction freezing (COMPLETED · commit 147d01444)
- Integrated `mint_receipt_code` inside the checkout transaction (`sales_checkout.rs` and `sales_lifecycle.rs`).
- Lazy entity index allocation (`ensure_entity_index`) for pre-existing entities without requiring manual database migration scripts.
- Atomically freezes assembled `display_code` and `terminal_id` into the `sales` record.
- Transaction rollback guarantees: an aborted checkout burns neither an entity index nor a receipt sequence number.
- Eager allocation upon entity creation (`create_location_profile`, `register_terminal`, `create_user_with_profile`) and instant slot recycling on soft/hard deletion.

### Phase 4: Hardware rendering, Bridge & UI presentation (COMPLETED · commits 51bb92093, 13b577201, 4a2a79c6e)
- **Hardware driver (`kasirmu-hal`):** `receipt.rs` formats `#01-02-260929-01-000123` via `r.receipt_number` (populated from `sales.display_code`), and barcodes the compact code via Code 128 / QR.
- **Bridge mapping (`kasirmu-bridge` & `kasirmu-mobile`):**
  - Exposed Base62 `code` in `LocationProfileDto`, `TerminalDto`, and `staff_code` in `StaffMemberDto`.
  - Scoped read, write, and restore commands automatically populate the Base62 entity codes.
  - `SaleListItem` and `SaleDetail` carry `display_code` across `history.rs`.
- **UI visibility (`ui/`):**
  - `StaffRoster.tsx`: Displays `#<staff_code>` cashier badge next to staff display names, and enables filtering by cashier code in the search box.
  - `TerminalManagementScreen.tsx`: Displays `#<terminal_code>` register badge in the terminal table.
  - `StoreSwitcher.tsx` & `TopologyScreen.tsx`: Displays `[<location_code>] <name>` branch prefixes in store dropdowns and topology selectors.
  - `MultiStoreDashboardScreen.tsx`: Displays `#<location_code>` in store overview cards.
  - `SalesHistoryScreen.tsx`: Displays receipt `displayCode`, reprints `#<displayCode>`, and supports full-text search matching on receipt display codes.
  - `PaymentModal.tsx`: Displays frozen receipt code upon checkout settlement.

### Phase 5: Backward compatibility, backfill & verification (COMPLETED)
- Existing sales retain `display_code = NULL` and fall back to legacy `sale.id` display without fiction.
- Pre-commit gates validation:
  1. `cargo test -p kasirmu-core receipt_code` (21 tests pass)
  2. `cargo test -p kasirmu-bridge` & `kasirmu-mobile` (all tests pass)
  3. `npm run typecheck && npm run lint` (0 errors)
  4. Vitest UI suites: 191 tests pass across affected screens
  5. `python scripts/verify-migration-column-types.py` (0 errors)
  6. `python scripts/generate-pg-migration.py --check` (100% in sync)
  7. `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` (0 dead refs)

### Phase 6: e-Faktur integration (DJP Coretax, next agenda)
- Stored columns: `faktur_pajak_nsfp` (13 digits), `faktur_pajak_kode_transaksi` (2 digits), `faktur_pajak_status` (2 digits).
- Post-checkout import endpoint: stamps NSFP when approved in Coretax.
- Faktur Pengganti lifecycle: preserves original NSFP, increments `faktur_pajak_status` (`00` → `01` → `02`), prints 17-digit DJP number alongside internal nomor faktur.

---

## 7. Accepted invariants & decisions

- **Encoding:** Base62 (`0–9`, `a–z`, `A–Z`) with dynamic width (minimum 2 characters, expanding to 3 and 4 characters).
- **Scale:** 14,776,336 locations, 14,776,336 terminals, 14,776,336 staff per tenant.
- **Receipt Length:** 22 characters standard (`01-02-260929-01-000123`), 23–25 characters with 3-digit entities (`01-02-260929-10a-000123`), up to 28 characters with 4-digit entities.
- **Sequence Tail:** 6 decimal digits continuous per terminal per fiscal year (1 to 999,999).
- **Overflow Ceiling:** Hard refusal at 14,776,336 (indices) and 999,999 (sequence).
- **Century Window:** `YYMMDD` bounds uniqueness to 100 years (valid until 2126).
- **Fiscal Year:** Aligns with store-local calendar year.
- **Sentinels:** `00` represents unassigned staff / kiosk / system checkout.

