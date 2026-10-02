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
  | 'other';
