/**
 * PaymentModalCustomerBadge - the selected-customer row of PaymentModal.
 *
 * Markup only, in the shape ./CardTenderPanel and ../payment/LoyaltyTenderPanel
 * set: who the tender is being taken FROM, with the two affordances that change
 * or clear that choice. No state, no effect, no memo, no fetch and no IPC moved
 * in, and none created here - useLocalization is the only hook this file reads,
 * the same way ./CardTenderPanel reads it for its own aria-label. The roster
 * fetch (listCustomersScoped at PaymentModal.tsx:367), the four atoms behind the
 * search (showCustomerSearch :141, customerSearchQuery :175, customerRoster :180,
 * loadingCustomers :181) and the overlay that renders from them all stay in the
 * shell: the overlay is a SIBLING of this row in the DOM, not a child of it, so
 * taking the atoms would strand the overlay without a filter.
 *
 * THREE PROPS, and the count is the seam. `customer` is a read-only value, not a
 * getter; `onOpenSearch` and `onRemove` are the shell's own handlers passed back
 * in. Deliberately absent: any callback that carries a CustomerDto OUT. The
 * selection is written only by the shell's notifyCustomerChange (:153), which
 * owns both `selectedCustomer` and the `onCustomerChange` report to the host, so
 * a badge that could set the customer itself would re-parent the atom - and a
 * re-parented atom is exactly what S6 in PaymentModalCustomerSection.test.tsx
 * catches, via its assertion that the settle payload still carries
 * `customerId: 'cust-ade'`. Nothing in this file decides who is selected.
 *
 * SELF-GATING, in the form this row actually needs. It has no feature flag to
 * inherit, so refusing itself is not a null return - the section rendered
 * unconditionally at :1692 (PaymentModal.tsx, `<PaymentModalCustomerBadge`) with
 * the branch INSIDE the wrapper, and S1 asserts
 * `section()` is non-null while S1b asserts the same for the empty case. So the
 * honest version is that BOTH states are derived here from the one input: a null
 * `customer` renders the Select Customer prompt and this file never touches
 * `customer.name` on a null. A caller cannot mount a broken badge by omission,
 * and cannot suppress the row either - which is the pre-existing contract, kept
 * verbatim.
 *
 * Strings: the two <Localized> ids (payment-customer-change, payment-customer-
 * select) and the aria-label read (payment-customer-remove-aria, with its inline
 * fallback) moved WITH the markup, so all three stay referenced from the features
 * tree for the bundle-parity walk and the FTL orphan gate. No key added, no
 * English introduced. Class names are unchanged and still styled by
 * ../PaymentModal.css, which the modal imports once for the whole surface - the
 * arrangement both tender siblings rely on, and the reason this file belongs in
 * the PaymentModal entry's `additionalTsx` - registered there by 86c1af41c,
 * "bring the extracted customer badge inside the PaymentModal entry that cites its
 * sheet", the commit that added this path to that entry's file list, so a class
 * that leaves with this markup cannot read as dead CSS. It named 038c79024 until
 * now, which is wrong twice over: that entry registers PaymentModal with its FIVE
 * tender panels and no badge, and it predates this file's own commit, 2b456338b,
 * so it cannot have registered something that did not exist yet.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { CustomerDto } from '@/api/customers';

export interface PaymentModalCustomerBadgeProps {
  /** Who the tender is taken from. Null is a real state: it renders the prompt. */
  customer: CustomerDto | null;
  /** Open the roster overlay (the shell's setShowCustomerSearch(true)). */
  onOpenSearch: () => void;
  /** Clear the selection (the shell's notifyCustomerChange(null)). */
  onRemove: () => void;
}

/** The customer row: the selected name with Change / remove, or the Select prompt. */
export default function PaymentModalCustomerBadge({
  customer,
  onOpenSearch,
  onRemove,
}: PaymentModalCustomerBadgeProps) {
  const { l10n } = useLocalization();

  return (
    <div className="payment-customer-section">
      {customer ? (
        <div className="payment-customer-badge">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
            <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
          </svg>
          <span className="payment-customer-name">{customer.name}</span>
          <Localized id="payment-customer-change">
            <button
              type="button"
              className="payment-customer-change"
              onClick={onOpenSearch}
            >
              <span>Change</span>
            </button>
          </Localized>
          <button
            type="button"
            className="payment-customer-remove"
            onClick={onRemove}
            aria-label={l10n.getString('payment-customer-remove-aria', null, 'Remove customer')}
          >
            &times;
          </button>
        </div>
      ) : (
        <Localized id="payment-customer-select">
          <button
            type="button"
            className="payment-customer-select-btn"
            onClick={onOpenSearch}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
              <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
            </svg>
            <span>Select Customer</span>
          </button>
        </Localized>
      )}
    </div>
  );
}
