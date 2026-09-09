import { useContext, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getPrimaryLocationScoped } from '@/api/locations';
import { getRegionalConfigScoped } from '@/api/regional';

/**
 * Bridge between the workspace session and the org/entity default locale
 * (regional slice 4, todo-global-saas-2.md slice queue #4).
 *
 * LocaleProvider sits ABOVE WorkspaceProvider — it must negotiate the boot
 * locale before any session exists — so it can never observe a session by
 * itself. This component renders below WorkspaceProvider and pushes ONE
 * read of the slice-1 regional chain (primary location → its resolved
 * locale axis: organization → legal entity → location with provenance)
 * into `setOrgDefaultLocale`, which feeds the negotiation order BELOW the
 * stored per-user choice. The `ui.locale` KV the chain reads at the org
 * layer is exactly what GeneralSection has always written on locale
 * switches — this is the reader the design says it "finally gets".
 *
 * Read-only influence: nothing here deletes, migrates or writes
 * `ui.locale` (open question 2 stays open), and the org default never
 * persists to localStorage — only an explicit user choice via
 * `setLocale` does. Renders nothing.
 */
export function OrgLocaleSync() {
  const { sessionToken } = useWorkspace();
  const { setOrgDefaultLocale } = useContext(LocaleContext);

  useEffect(() => {
    if (!sessionToken) {
      // No session → no org → the boot heuristic (browser → built-in)
      // answers again; a stale org default must not outlive logout.
      setOrgDefaultLocale(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const primary = await getPrimaryLocationScoped(sessionToken);
        if (!primary) {
          if (!cancelled) setOrgDefaultLocale(null);
          return;
        }
        const config = await getRegionalConfigScoped(sessionToken, primary.id);
        if (cancelled) return;
        // `built_in` means nothing was configured anywhere in the chain —
        // the org default must not masquerade as a configured one, so the
        // browser heuristic keeps answering in that case.
        setOrgDefaultLocale(
          config.locale.scope === 'built_in' ? null : config.locale.value,
        );
      } catch {
        // Boot must not break because the default locale could not be
        // resolved; the browser heuristic stays in charge for this session.
        if (!cancelled) setOrgDefaultLocale(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, setOrgDefaultLocale]);

  return null;
}