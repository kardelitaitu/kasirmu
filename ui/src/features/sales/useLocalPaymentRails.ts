//! Local payment rails for the checkout — the one config surface that
//! actually shipped for "which payment methods does this site offer".
//!
//! The master payment doc sketches a `payment:qris-manual / :midtrans / :edc`
//! feature-key model; measured against HEAD (agents-4 inventory), none of
//! those keys exist. What exists is the regional slice-6 rail store
//! (`getLocalPaymentMethodsScoped`), keyed by a stable `rail_code`
//! (`qris`, `va-bca`, `ewallet-ovo`, …) with an `is_enabled` flag and a
//! credential-free `parameters` bag. QRIS is the only rail code that maps
//! to a PaymentModal tab, so this hook answers exactly one question the
//! modal can't decide on its own: is the `qris` rail offered here?
//!
//! Fail-open by contract: a null list (no session, still loading, or an
//! IPC error) and an empty list (nothing configured) both mean "offer it"
//! — legacy tills and dev-mock builds keep QRIS exactly as before. Only a
//! NON-EMPTY list that names — or omits — the `qris` rail is a real
//! answer, and then the flag governs.

import { useCallback, useEffect, useState } from 'react';
import { getLocalPaymentMethodsScoped, readStaticQrPayload, type LocalPaymentRail } from '@/api/local-payment';
import { getPrimaryLocationScoped } from '@/api/locations';
import type { ActiveMarketProfile } from '@/api/regional';

export interface LocalPaymentRails {
  /** null while loading / no session / error; the effective list otherwise. */
  rails: LocalPaymentRail[] | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Is `railCode` offered given the effective rails? Fail-open on null or
 * empty (see the module contract); a populated list is authoritative.
 *
 * ⚠️ The comparison is CASE-INSENSITIVE, and that is a correctness fix rather
 * than a convenience. `rail_code` is a free-form string the operator can create
 * (RestaurantPaymentsScreen's "add a custom rail" form), nothing normalises it on
 * write — the bridge passes it straight through
 * (crates/kasirmu-bridge/src/local_payment.rs:95) and the column carries no CHECK
 * constraint — and the SETTINGS screen normalises with `.toLowerCase()` at every
 * one of its lookups. A raw `===` here therefore disagreed with the surface that
 * configured the rail: one saved as `QRIS` was switchable ON in settings and then
 * not matched here, falling through to `is_enabled: false` and HIDING the tender
 * the operator had just enabled. Same failure shape as the `midtrans isActive`
 * disagreement between that screen and the charge modal.
 */
export function railOffered(rails: LocalPaymentRail[] | null, railCode: string): boolean {
  if (rails === null || rails.length === 0) return true;
  const wanted = railCode.toLowerCase();
  const rail = rails.find((r) => r.rail_code.toLowerCase() === wanted);
  return rail ? rail.is_enabled : false;
}

/** A tender tab the checkout offers, in the order the modal lists them. */
export type TenderMethod = 'cash' | 'card' | 'qris' | 'credit';

/**
 * The tab list and the rail that gates each entry — `null` means no rail
 * gates it. Derived from what PaymentModal rendered before this lived here
 * (a literal `['cash','card','qris','credit']` filtered on `qrisOffered`),
 * so replacing that literal with `visibleMethods()` changes nothing:
 *
 *  · `cash` is universal — no rail models it.
 *  · `card` is universal TOO. The `edc` rail gates the *pay-on-terminal
 *    button inside* the card panel (`terminalOffered` on CardTenderPanel),
 *    never the card tab; a site with no terminal still takes a card by
 *    hand. Folding `edcOffered` in here would be a behaviour change.
 *  · `qris` is the one rail-gated tab, and `railOffered` is the gate —
 *    including its fail-open rule for a null or empty list.
 *  · `credit` carries NO gate. Whether it is a tender tab or a facility
 *    orthogonal to tender (todo-payment.md :887) is a parked owner
 *    question; until it is answered, the derivation renders exactly what
 *    renders today, which is: always.
 *
 * Subscription caps are deliberately absent too: `caps.supportsQris` gates
 * what the QRIS panel lets you DO, not whether the tab is listed.
 */
const TENDER_RAILS: ReadonlyArray<{ method: TenderMethod; railCode: string | null }> = [
  { method: 'cash', railCode: null },
  { method: 'card', railCode: null },
  { method: 'qris', railCode: 'qris' },
  { method: 'credit', railCode: null },
];

/**
 * The tender tabs to offer for `rails` and optional `marketProfile`, in operator order.
 * Same list the modal hardcoded, now named: an entry survives unless a non-empty rail
 * list answers that its `railCode` is withheld.
 */
export function visibleMethods(
  rails: LocalPaymentRail[] | null,
  marketProfile?: ActiveMarketProfile | null,
): TenderMethod[] {
  const methods = TENDER_RAILS.filter(
    ({ railCode }) => railCode === null || railOffered(rails, railCode),
  ).map(({ method }) => method);

  if (marketProfile && Array.isArray(marketProfile.enabled_payment_rails) && marketProfile.enabled_payment_rails.length > 0) {
    return methods.filter((m) => {
      const rail = TENDER_RAILS.find((t) => t.method === m);
      if (!rail || rail.railCode === null) {
        return true;
      }
      return marketProfile.enabled_payment_rails.includes(rail.railCode);
    });
  }

  return methods;
}

/**
 * Resolve the dynamic market tender label for a method.
 *
 * For electronic/QR rails (e.g. `qris`), priority order:
 *  1. Custom display label on the active `local_payment_methods` rail (e.g. "PayNow", "PromptPay", "PIX").
 *  2. Statutory/national QR scheme mapped from `ActiveMarketProfile.country_code` (e.g. SG -> "PayNow / SGQR", MY -> "DuitNow QR", TH -> "PromptPay", IN -> "UPI", BR -> "PIX", non-ID -> "QR Code").
 *  3. Localized default string (e.g. "QRIS").
 */
export function resolveTenderDisplayName(
  method: string,
  rails: LocalPaymentRail[] | null,
  marketProfile: ActiveMarketProfile | null | undefined,
  fallback: string,
): string {
  if (method === 'qris' || method.toLowerCase() === 'qris') {
    // Case-insensitive for the same reason `railOffered` is: the settings screen
    // lowercases every lookup and nothing normalises the stored code.
    const rail = rails?.find((r) => r.rail_code.toLowerCase() === 'qris');
    if (rail?.label && rail.label.trim().length > 0) {
      return rail.label.trim();
    }
    const cc = marketProfile?.country_code?.toUpperCase();
    if (cc === 'SG') return 'PayNow / SGQR';
    if (cc === 'MY') return 'DuitNow QR';
    if (cc === 'TH') return 'PromptPay';
    if (cc === 'IN') return 'UPI';
    if (cc === 'BR') return 'PIX';
    if (cc && cc !== 'ID') return 'QR Code';
    return fallback;
  }
  return fallback;
}

/**
 * The merchant static-QR payload for manual QRIS, or null when no
 * non-empty string is configured. Parse/serialize semantics live with
 * the wire model (`api/local-payment`); this is the checkout's view.
 */
export function staticQrisPayload(rails: LocalPaymentRail[] | null): string | null {
  // Case-insensitive: a merchant whose rail is stored as `QRIS` used to get null
  // here, so the static QR payload never reached the display even though the
  // settings screen showed the rail as configured and enabled.
  const rail = rails?.find((r) => r.rail_code.toLowerCase() === 'qris');
  return rail ? readStaticQrPayload(rail.parameters) : null;
}

/** Load the primary location's effective rails for a session. Pass an
 *  undefined/null token to stay in the fail-open state (no fetch). */
export function useLocalPaymentRails(sessionToken: string | null | undefined): LocalPaymentRails {
  const [rails, setRails] = useState<LocalPaymentRail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!sessionToken) {
      setRails(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const primary = await getPrimaryLocationScoped(sessionToken);
        if (cancelled) return;
        if (!primary) {
          setRails(null);
          return;
        }
        const rows = await getLocalPaymentMethodsScoped(sessionToken, primary.id);
        // Trust but verify: the real IPC and dev-mock both resolve to an
        // array; anything else (a test default, a future shape change) is
        // an unknown surface — fail open rather than crash the checkout.
        if (!cancelled) setRails(Array.isArray(rows) ? rows : null);
      } catch {
        // Unknown surface — fail open rather than hide a tender the
        // cashier may well need.
        if (!cancelled) setRails(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { rails, loading, reload };
}
