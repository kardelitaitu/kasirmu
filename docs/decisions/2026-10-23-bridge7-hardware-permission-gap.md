---
title: BRIDGE-7 — the hardware commands take a session but name no permission
date: 2026-10-23
status: CLOSED — ruled Option B on 2026-11-10
owners: [BK, Dika]
---

# BRIDGE-7: device commands are open to any authenticated operator

## The finding

Eleven `_scoped` functions in `crates/kasirmu-bridge/src/hardware.rs` call
`ctx.resolve_scope(session_token)?` and then read the store, the receipt config or the HAL, with **no
permission check of any kind**. `resolve_scope` proves a session is valid; it says nothing about what
that session may do. `scripts/verify-scoped-authorization.sh` grades exactly this property, and all
eleven carry an `// ungated-ok:` marker rather than a gate.

They are otherwise indistinguishable from the rest of the bridge: 281 call sites in this crate name a
permission key (`permissions::SALES_PROCESS`, `permissions::CUSTOMERS_VIEW`, ...). These eleven do not.

## Why this is not a false positive, and why it is also not obviously wrong

The commands print receipts, open the cash drawer, print sales and settlement slips, and show device
status. A receiving clerk must be able to print a receipt for the sale they just rang up without also
holding `settings:edit`. That is a real argument for *some* of the eleven being ungated, and it is the
reason this has sat as a marker rather than a defect ticket.

**But one command in the set carries data none of the others do.**

`print_kasbon_settlement_slip_scoped` takes `PrintKasbonSettlementArgs`, which includes `customer_name`,
`customer_phone` and three money fields — `previous_balance`, `amount_paid`, `remaining_balance` — and
prints them onto paper. Any authenticated operator on that terminal can reprint another customer's
receivable balance by supplying the arguments. That is a disclosure of customer financial data, and it
is the one member of the group where "the operator is at the till" is not a sufficient answer.

## What is already recorded, and what it does NOT settle

`apps/desktop-tauri/src/commands/registration_gate_tests.rs:214` records that the ten AR/AP commands
that landed in `be153f8cf` and `160734e90` arrived already gated at the bridge layer, and that
`print_kasbon_settlement_slip_scoped` is the tenth — "gated by `resolve_scope` rather than by a
permission key — the same shape as the other print commands". It then says, of raising the
registration floor:

> Raising the floor records what landed; it does not approve it.

So the precedent is *recorded*, not *ruled*. This document asks for the ruling.

## Options, with their real costs

### A. Permission-key all eleven

Gate each command on the permission its effect implies — `SALES_VIEW`/`CUSTOMERS_VIEW` for the
receipt and settlement prints, `SETTINGS_READ` for device status. Precedent exists (`sales:void`,
`customers:delete`, `receivables:writeoff` are all narrow keys).

*Cost:* every tenant whose cashier role does not already hold those keys stops being able to print.
That is a **behaviour change on a revenue path** for existing installations, and it needs a role
migration, not just a key. It is also the only option that closes the disclosure.

### B. Gate only the Kasbon settlement slip

Add `SALES_VIEW` (or a new `customers:receivables_read`) to `print_kasbon_settlement_slip_scoped` and
leave the ten device commands as they are.

*Cost:* closes the disclosure with the smallest blast radius. A cashier without the key can still ring
up and print a receipt but cannot reprint someone else's receivable — which is likely the intended
product behaviour, but it is a product decision. Note the command landed 2026-10-23, so almost
certainly no tenant depends on it yet: **this is the cheapest moment to decide it.**

### C. Leave as-is, and say so

Keep the markers, and record that device access is open by design on a single-operator till.

*Cost:* the Kasbon disclosure stays. If that is acceptable, the marker on that one function should say
so explicitly rather than sharing the boilerplate, so the next reader does not have to rediscover which
of the eleven is different.

## Recommendation

**B**, now, while the command is days old and has no dependants — and then A as a separate, scheduled
change with a role migration, because ten commands with no permission is a larger product question
than this document should decide.

## What this document does not do

It does not change any code. The eleven markers stay, and `verify-scoped-authorization.sh --strict`
stays green at 379 scanned / 0 unreasoned. Nothing here weakens the gate: the marker's purpose is to
make "ungated" a stated fact rather than an oversight, and that purpose is working.

## How to close it

Adopt A, B or C above; implement it; then convert the corresponding `// ungated-ok:` markers to a
`ctx.require_session_permission(...)` call (A, B) or reword them to cite this record (C). The
`_scoped`-authorization gate re-runs on every matrix pass and will keep the count honest either way.

---

## Closure — 2026-11-10

**Option B adopted and shipped.**
- `print_kasbon_settlement_slip_scoped` is gated on `permissions::RECEIVABLES_VIEW` via
  `ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)`.
- Unit test `print_kasbon_settlement_slip_requires_receivables_view` added to
  `crates/kasirmu-bridge/src/hardware_tests.rs`, proving unauthorized sessions receive
  `BridgeError::PermissionDenied`.
- The remaining ten device commands are confirmed session-authenticated and carry no cross-customer
  PII, with comments updated to cite this ruling.
- Status: **CLOSED**.
