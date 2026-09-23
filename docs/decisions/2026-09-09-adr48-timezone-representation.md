---
num: 48
area: regional
title: ADR #48: Location Timezone Representation & as_of Semantics
status: Accepted (2026-09-09)
---

# ADR #48: Location Timezone Representation & as_of Semantics

**Status:** Accepted (2026-09-09)
**Date:** 2026-09-09
**Author:** finisher-E (coder-6) on behalf of the Architecture Team
**Tags:** regional, timezone, iana, as_of, tax, business-date

---

## 1. Context & Motivation

The regional-configuration work (todo-global-saas-2.md, "Regional configuration —
design") needs a location-level timezone. Three decisions are open and were
blocking slice-4 of the regional editor:

1. the **stored** representation of `locations.timezone`,
2. the **editor** format the admin uses to set it, and
3. the **as_of** semantics for the tax/exchange-rate lookups that currently pass
   `Utc::now()` as a placeholder business date.

Indonesia is the launch market. It spans three IANA zones — `Asia/Jakarta` (+07,
WIB), `Asia/Makassar` (+08, WITA), `Asia/Jayapura` (+09, WIT) — and has **never
observed DST**; the last DST-aligned offset change (UTC+7:30 → +07) occurred in
1964 and no seasonal offset has been reintroduced since. Any representation choice
must be honest about that: DST machinery is dead weight here, but political
offset changes remain possible and must be absorbed by zone-data updates rather
than by data migration.

---

## 2. Decision 1 — Stored format: IANA zone names, not fixed UTC offsets

**DECIDED: store `locations.timezone` (and the legal-entity override) as an IANA
zone name string.** Fixed-offset columns are rejected as the stored format.

Rationale:

- (a) **Geography is three-zone, not one-offset.** A fixed-offset picker cannot
  express WIB/WITA/WIT without hardcoding the mapping per row; an IANA name does,
  in one column, and survives a future fourth zone. `crates/oz-core/migrations/20260813_init.sql:803`
  already declares `timezone TEXT NOT NULL DEFAULT 'UTC'`, and
  `crates/oz-core/src/location_profile.rs:31` documents it as "IANA timezone
  (e.g. \"America/New_York\", \"Asia/Jakarta\")". The schema is already IANA-shaped;
  we ratify that rather than retrofit an offset column.
- (b) **No DST, so IANA's DST machinery is unused cost** — but that is not a reason
  to drop IANA. Indonesia's political offset changes (the 1964 +7:30→+07 shift, and
  any future decree) are handled by updating tzdata / the zone name, **not** by
  migrating every location row. A fixed offset would instead fossilize a snapshot
  and require a data migration on every political change.
- (c) **Display format is orthogonal.** Fixed offsets remain a legitimate *display*
  decision (e.g. show "+07:00" in the UI). Storage = IANA name; presentation =
  offset derived from the name at render time. `regional.rs:185` already notes
  `LocationProfile::timezone` documents IANA names and the resolver reports the
  effective value with its provenance.

Since Indonesia has no DST, `Utc::now().with_timezone(&tz)` yields a stable offset
for any stored name; the resolver in `crates/oz-core/src/export/email_sender.rs:253-341`
(`resolve_now_in_timezone`) is the existing precedent for "name → instant" and
falls back to UTC on an unknown name.

---

## 3. Decision 2 — Editor format: bounded IANA preset list

**DECIDED: the regional slice-4 editor presents a bounded preset list of the three
Indonesian IANA zones** (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`), with no
free-text offset field and no search box.

Rationale: fewer than five options, so a native dropdown/segmented control is
cheaper and less error-prone than an offset picker or a full IANA search. The
preset map is the authoritative enumerable set; a future non-Indonesian deployment
extends the same bounded list rather than opening free entry (which would let an
admin store an unparseable string the resolver must then fall back from). Today
the location row is a full-overwrite surface
(`crates/oz-core/src/db/regional.rs:6-7`), so the preset must be enforced at the
write boundary when the regional write path lands.

---

## 4. Decision 3 — as_of semantics: business date in the location's zone

**DECIDED: `as_of` is a business date (YYYY-MM-DD) resolved in the location's IANA
zone**, not a raw UTC instant. Keep `Utc::now()` as the *instant* source and
convert: take the current UTC instant, apply the location's IANA zone, and take
the local calendar date as `as_of`.

The contract already expects this: `crates/oz-core/src/db/tax.rs:476` states
"`as_of` must be a business date, `YYYY-MM-DD`", `parse_effective_date` validates
it (`tax.rs:491-493`), and the validity window is **exclusive** on `effective_to`
(`tax.rs:771`, `is_live` `tax.rs:819-828`), so a boundary day must have exactly one
answer. Mixing UTC-date and local-date at a boundary risks the cart preview and
the checkout receipt resolving on opposite sides of that exclusive edge — the
failure mode the current placeholder explicitly avoids by pinning both to UTC
(`apps/desktop-client/src/commands/pos.rs:33-44`).

**Correction to the task brief:** the brief asserted "9 wired call sites" passing
`as_of: Utc::now()`. The grep shows **4** production sites that *construct* the
placeholder from `Utc::now().format("%Y-%m-%d")`:

| # | Site | Line |
|---|------|------|
| 1 | `apps/desktop-client/src/commands/pos.rs` | 44 |
| 2 | `apps/tablet-client/src/commands/pos.rs` | 42 |
| 3 | `apps/desktop-client/src/commands/exchange_rates.rs` | 238 |
| 4 | `apps/tablet-client/src/commands/exchange_rates.rs` | 274 |

The remaining `as_of` occurrences are the resolver's signature/consumer sites,
not placeholders: `tax.rs:485` `resolve_tax_rate_for_location(as_of: &str)`,
`tax.rs:728` `TaxSaleScope.as_of: String`, `tax.rs:731-745` `TaxEffectiveDate::new`
parsing, `tax.rs:760`/`:824` `is_live(as_of)`, and
`crates/oz-core/src/db/sales_tax.rs:450` passing `&sc.as_of` into the resolver. All
four placeholder sites should convert through the location's IANA zone before
formatting, per Decision 3.

---

## 5. Status & Follow-ups

- Stored format already IANA-shaped (ratified, no migration needed).
- Slice-4 editor: implement bounded preset list; enforce at the regional write
  boundary (open: regional write path, todo-global-saas-2.md).
- Placeholder sites (table above) to convert `Utc::now()` → location-zone business
  date; leave `Utc::now()` as the instant source.
