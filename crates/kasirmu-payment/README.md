<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor) · Re-audit; the 2026-08-29 body is merged at the bottom as original evidence. MINOR, and it is the one number this file carries: it said "136 unit tests pass". Re-measured with the same basis the 2026-08-29 pass used (test functions under src/, drivers/ included) — **187** at HEAD (135 `#[test]` + 52 `#[tokio::test]`, 12 `*_tests.rs` files). Rather than set a new constant that rots the same way, the count now stands beside its own re-derive command, which is the convention this campaign applies to every moving figure. VERIFIED AND LEFT ALONE: the PaymentProcessor trait and its authorize→capture→refund→void lifecycle plus the sale() default (processor.rs:43); MockPaymentProcessor and its counters/one-shot decline-timeout; the four real adapters (stripe, square, qris, paddle) all present under drivers/; EMV terminal still absent, as the page says. NOT re-measured: any live processor round-trip and the webhook signature verification (webhook.rs is a planned stub). · Superseded 2026-08-29 body follows as plain quoted text:

Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (2 findings repaired) · F1: "35 unit tests pass" -> 136 in src/ (incl. drivers/) · F2: "Next: real adapters (Stripe, Square, EMV terminal)" -> Stripe, Square, QRIS, Paddle already exist; EMV terminal not present · verified accurate: PaymentProcessor trait in processor.rs:37 with authorize/capture/refund/void/sale lifecycle + receipt/device_info; MockPaymentProcessor in drivers/mock.rs -->

# kasirmu-payment

Payment processor abstraction for kasir.mu.

## Status

✅ `PaymentProcessor` trait defined with the full lifecycle:
`authorize → capture → refund → void`. Includes a `sale()`
default implementation (authorize + capture in one call).

✅ `MockPaymentProcessor` — programmable test double with call
counters, one-shot decline/timeout simulation.

Real adapters: Stripe (`drivers/stripe.rs`), Square (`drivers/square.rs`),
QRIS (`drivers/qris.rs`), Paddle (`drivers/paddle.rs`). EMV terminal
adapter not yet implemented.

**Test count (re-derive, do not quote a fixed number):**
`grep -rE '#\[(tokio::)?test\]' crates/kasirmu-payment/src | wc -l` → **187**
(135 `#[test]` + 52 `#[tokio::test]`, across 12 `*_tests.rs` files) at 2026-10-11. The page
said 136 until this pass; the suite has grown by ~50 since the 2026-08-29 reading, which is
exactly why the command is published beside it.

> last audited 11-10-26 by docs-auditor
