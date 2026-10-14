# The real backend creates the ticket; the mock only reports them (round 139)

## What round 138 left open

Round 138 established that the dev mock's `create_kds_order_from_sale_scoped` is a READER — it
filters `mockKdsOrders` by an `kds-order-e2e-*` id prefix and creates nothing — while the real
creator is `pushKdsOrderFromCart`, called on sale completion. It recorded that as the mock's
design but could not confirm the **production** command behaves differently.

It does. This round read it.

## The production command creates

`crates/kasirmu-bridge/src/kds.rs:435`:

```rust
pub async fn create_kds_order_from_sale_scoped(
    ctx: &BridgeCtx<'_>, session_token: &str, sale_id: &str,
) -> Result<Vec<KdsOrder>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE).await?;
    ...
    store.complete_sale_to_kds_fanout(sale_id, Some(&session.store_id), target_instance_ids)?
```

So the same command NAME is a creator in Rust and a reader in the mock. A reader of round 138
would conclude the POS-to-KDS link was broken; it is not.

## The eligibility filter is more careful than the mock's

`crates/kasirmu-core/src/db/kds_lines.rs:66-81` keeps only lines whose product type is
`restaurant` or `both`, and its comment records a real defect that was fixed:

> *The eligibility read has two different absences and they must not be conflated: `Ok(None)` =
> the SKU has no product row (a legitimate "not a kitchen item" — skipped), `Err` = the read
> itself failed. Collapsing them with `.ok().flatten()` made a PAID line ineligible on a
> transient error, so it vanished from every ticket with no ticket and no error. Only the error
> may abort — and it now does.*

Empty-in, empty-out is explicit too (`:83`): a sale with no kitchen lines returns `Ok(vec![])`.

## The routing gate

`kds.rs:81`:

```rust
pub fn should_create_kds_tickets(runtime_targets: Option<&[String]>) -> bool {
    runtime_targets.is_none_or(|targets| !targets.is_empty())
}
```

Documented at `:76-80`: a MISSING runtime plan is the legacy compatibility path (create), while
a plan with an EMPTY target list means routing is intentionally disabled and must not create an
untargeted ticket. Two absences, opposite answers, named.

## The item I dispatched would qualify

`catalog.ts` gives the restaurant fixtures `product_type: 'restaurant'` — the `LATTE` entry
carries it explicitly (28 of the 37 restaurant lines do; the rest are the same object shape).
So the line my round-138 dispatch sent meets the production filter. The mock's silence is its
own simplification, not an eligibility rejection.

## What this changes

Nothing in the product. It **closes** round 138's open question in the direction that matters:
the production path creates KDS tickets on sale completion, with a permission gate, a routing
gate and a product-type filter, and the dev mock reproduces only the read side of the command.

The practical consequence is for anyone using the browser preview to test the kitchen flow:
**a dispatch will never produce a ticket there, and that is the mock, not the POS.**

## Verified

| Item | Result |
|---|---|
| Production `create_kds_order_from_sale_scoped` | creates, via `complete_sale_to_kds_fanout` (`kds.rs:464`) |
| Eligibility | `restaurant` or `both` product types (`kds_lines.rs:76`) |
| Empty kitchen line set | returns `Ok(vec![])` (`:83-85`) |
| Routing gate | missing plan -> create; empty targets -> do not (`kds.rs:81-83`) |
| `LATTE` in the mock catalog | `product_type: 'restaurant'` — would qualify |
| `cargo test -p kasirmu-bridge kds_tests` | **38 passed; 0 failed** (83.7s) — covers the three cited `create_kds_order_from_sale_scoped` tests at `kds_tests.rs:1247`, `:1278`, `:1369` |
| Tree | no source changed this round |