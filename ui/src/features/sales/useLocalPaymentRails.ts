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
import { getLocalPaymentMethodsScoped, type LocalPaymentRail } from '@/api/local-payment';
import { getPrimaryLocationScoped } from '@/api/locations';

export interface LocalPaymentRails {
  /** null while loading / no session / error; the effective list otherwise. */
  rails: LocalPaymentRail[] | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Is `railCode` offered given the effective rails? Fail-open on null or
 * empty (see the module contract); a populated list is authoritative.
 */
export function railOffered(rails: LocalPaymentRail[] | null, railCode: string): boolean {
  if (rails === null || rails.length === 0) return true;
  const rail = rails.find((r) => r.rail_code === railCode);
  return rail ? rail.is_enabled : false;
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
