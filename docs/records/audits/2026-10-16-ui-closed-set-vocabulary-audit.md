# UI writes vs the schema closed sets — 2026-10-16

<!- - Audit stamp: 2026-10-16 · autonomous goal round 83 · status: SWEPT, 2 defects fixed (rounds 81 and 82), remaining sets correct · branch: 0.0.41 -->

<!- - Scope: every string `CHECK ... IN (...)` constraint in crates/kasirmu-core/migrations, cross-referenced
     against the literals ui/src writes to those columns. -->

## The method, and why it found things reading did not

A CHECK constraint is a statement about what the database will refuse. UI code that writes a
string outside the set does not fail at the call site — it fails at INSERT, inside a transaction,
after whatever else already happened. For a payment that means the gateway has the customer's
money and the sale cannot be recorded.

So the sweep is: collect the newest `CHECK IN` per column from the dated migrations, then grep the
UI for literals written to that column, then hand-check each.

## Closed sets audited

| Column | Set (newest migration) | UI status |
| --- | --- | --- |
| `product_type` | `retail` \| `restaurant` \| `service` (20261020) | **Fixed r81** — grid filters matched impossible `'standard'`/`'both'`, and `'service'` was sellable nowhere |
| `payments.gateway_status` | 9 values (20261018, ADR-64 D4) | **Fixed r82** — UI wrote `'captured'`/`'completed'`, both rejected; the CHECK fails the whole checkout |
| `kds_routing_rules.matcher_kind` | `sku` \| `category` \| `tag` (20261005) | Correct — `KdsRuleMatcher` union + `MATCHERS` array both match |
| `kds_devices.connection_status` | `connected` \| `disconnected` \| `stale` (20260820) | Correct — `KdsConnectionStatus` (api/kds.ts:167) matches; `KdsDeviceStatusIndicator` derives `stale` from a partial set |
| `document_number_sequences.document_kind` | `receipt` \| `invoice` (20260928) | Correct — `DOCUMENT_KINDS` (StatutoryNumberingCard.tsx:43) matches, and the select's options come only from that array |

`payments.method` (12 values, 20261018) is correct and separately typed — `PaymentMethod` has had a
union since its column was constrained.

### `payments.method` — the near-miss, and why the asymmetry matters

`useEdcTenderPhase` writes `'CARD'`, `useGatewayQr` and `useAutoQr` write `'QRIS'`, and
`migrations_tests.rs:3742` lists `"CASH"` as a value the CHECK **rejects**. On the surface it looks
like a third defect of the same class. It is not, and the reason is worth writing down because the
looks are otherwise identical:

| Insert path | `method` | `gateway_status` |
| --- | --- | --- |
| `sales_checkout.rs:728,737` | `to_ascii_lowercase()` — **normalised** | verbatim |
| `sales_lifecycle.rs:580` | `method_norm` — **normalised** | verbatim |
| `payments.rs:107-108` | verbatim | verbatim |

So `'QRIS'` becomes `'qris'` and `'CARD'` becomes `'card'` on every sale path before the row is
written, while `gateway_status` is inserted raw on all of them. `payments.rs` normalises NEITHER —
it is the one unguarded writer, and it is not reachable from the tender hooks (they all go through
`settleGatewaySale` → `finalize_sale` → `sales_lifecycle.rs`).

The generalisable rule: **check the insert before believing a literal is wrong.** `method` was
normalised on purpose; `gateway_status` was not. Both are CHECK-constrained, both were written
verbatim by the UI, and only one is reachable unnormalised.


## The two findings, and the shape they share

**`gateway_status` (r82).** The migration that widened the set states its own premise:
*"Nothing in production reads or compares gateway_status (verified: zero comparison sites)"*. That
was true when written and is false now — the UI WRITES it. The risk was never a comparison; it is on
the INSERT path. `payments.rs:122` inserts `split.gateway_status` verbatim, unvalidated, so the
vocabulary only constrains the writer.

**`product_type` (r81).** A migration backfilled legacy values and closed the set, but nothing
checked what UI filters still compared against. The code matched two values the database can no
longer hold, kept alive by an `as string` cast that bypassed the checker — the cast is the smell.

Both are the same failure: **a schema change landed without a sweep of the UI literals that
describe that schema.**

## What to re-check, and when

Re-run this after any migration that adds or re-vocabularises a `CHECK IN` column. The cheap version:

```
# newest CHECK IN per column, dated migrations only
rg "CHECK \(\w+ IN " crates/kasirmu-core/migrations --no-filename -o
# then grep ui/src for literals written to those columns
```

A migration that widens a set is safe for existing writers; one that NARROWS it, or replaces
values (20261017 → 20261018 replaced `chargeback` with `voided`/`disputed`/`unconfirmed`), is not.
Narrowing is the case to sweep for.

> last audited 16-10-26 by autonomous-goal-round-83
