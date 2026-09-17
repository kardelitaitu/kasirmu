<!-- Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (2 findings repaired) · F1: "35 unit tests pass" -> 136 in src/ (incl. drivers/) · F2: "Next: real adapters (Stripe, Square, EMV terminal)" -> Stripe, Square, QRIS, Paddle already exist; EMV terminal not present · verified accurate: PaymentProcessor trait in processor.rs:37 with authorize/capture/refund/void/sale lifecycle + receipt/device_info; MockPaymentProcessor in drivers/mock.rs -->

# oz-payment

Payment processor abstraction for OZ-POS.

## Status

✅ `PaymentProcessor` trait defined with the full lifecycle:
`authorize → capture → refund → void`. Includes a `sale()`
default implementation (authorize + capture in one call).

✅ `MockPaymentProcessor` — programmable test double with call
counters, one-shot decline/timeout simulation. 136 unit tests pass.

Real adapters: Stripe (`drivers/stripe.rs`), Square (`drivers/square.rs`),
QRIS (`drivers/qris.rs`), Paddle (`drivers/paddle.rs`). EMV terminal
adapter not yet implemented.

> last audited 29-08-26 by docs-auditor
