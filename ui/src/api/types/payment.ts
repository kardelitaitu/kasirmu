/**
 * Canonical closed-set tender method vocabulary (ADR-64 D1 & D2).
 *
 * Strictly matches the SQLite `payments.method CHECK` constraint:
 * ('cash', 'card', 'card_debit', 'card_credit', 'qris_manual', 'qris',
 *  'bank_transfer', 'ewallet', 'open_bill', 'credit', 'pay_later', 'other')
 */
export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'card_debit'
  | 'card_credit'
  | 'qris_manual'
  | 'qris'
  | 'bank_transfer'
  | 'ewallet'
  | 'open_bill'
  | 'credit'
  | 'pay_later'
  | 'gift_card'
  | 'other';

/**
 * Canonical closed-set `gateway_status` vocabulary (ADR-64 D4).
 *
 * Strictly matches the SQLite `payments.gateway_status CHECK` constraint
 * (migration `20261018_gateway_status_adr64_vocabulary.sql`):
 * ('pending', 'authorized', 'confirmed', 'settled', 'failed',
 *  'voided', 'refunded', 'disputed', 'unconfirmed')
 *
 * WHY THIS UNION EXISTS. `PaymentMethod` above has had a type from the day the
 * column was constrained, but `gateway_status` did not — and the two call sites that
 * write it drifted into values the CHECK rejects. `'captured'` (the EDC tender) and
 * `'completed'` (manual QRIS confirmation) were both written verbatim into
 * `paymentSplits[].gateway_status`, which `payments.rs:122` inserts without
 * validation, so an EDC payment or a confirmed QRIS raised a CHECK violation and
 * failed the whole checkout transaction — AFTER the customer had paid.
 *
 * Typing the field is what turns that from a runtime failure into a compile error:
 * the sites that wrote the old strings no longer compile until they map to a real
 * status. The two mappings now in use: `'captured'` -> `'settled'` (the terminal has
 * taken the money, which is what ADR-64's own tests use for card payments,
 * `payment_tests.rs:266`), and `'completed'` -> `'confirmed'` (the cashier asserted
 * the QRIS landed).
 */
export type GatewayStatus =
  | 'pending'
  | 'authorized'
  | 'confirmed'
  | 'settled'
  | 'failed'
  | 'voided'
  | 'refunded'
  | 'disputed'
  | 'unconfirmed';
