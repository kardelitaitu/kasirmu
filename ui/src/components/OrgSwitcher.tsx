import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocalization } from '@fluent/react';
import { listOrganizations, type OrganizationSummary } from '@/api/staff';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import './OrgSwitcher.css';

// Seeded default legal entity carries no real org meaning; hide it from the
// switch list so operators only pick a genuine Organization (SaaS-3 L194).
const DEFAULT_SEEDED_ID = 'default:default-legal-entity';

/**
 * Post-login Organization switcher (SaaS-3 L194).
 *
 * Lets an authenticated operator re-scope the session to a different
 * Organization (legal entity) they are assigned to. The actual re-scoping is
 * performed by the backend switch_organization command (invalidate-then-mint,
 * fail-closed on assignment coverage, full PIN re-auth) — this component only
 * gathers the choice + PIN and calls WorkspaceContext.switchOrganization, which
 * swaps the session token and display label. The workspace (store/instance) is
 * unchanged.
 */
export default function OrgSwitcher() {
  const { l10n } = useLocalization();
  const { orgLabel, switchOrganization: switchOrg, sessionToken } = useWorkspace();
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingOrg, setPendingOrg] = useState<OrganizationSummary | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listOrganizations();
      setOrgs(data.filter((o) => o.id !== DEFAULT_SEEDED_ID));
    } catch {
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Hide until we know there is more than one real org to switch between.
  if (!loading && orgs.length <= 1) return null;

  const currentLabel = orgLabel ?? l10n.getString('org-switcher-default');

  const beginSwitch = (org: OrganizationSummary) => {
    setPendingOrg(org);
    setPin('');
    setError(null);
    setBusy(false);
    setOpen(false);
    setPinOpen(true);
  };

  const confirmSwitch = async () => {
    if (!pendingOrg || !sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      await switchOrg?.(pendingOrg.id, pin);
      setPinOpen(false);
      setPendingOrg(null);
      setPin('');
    } catch {
      setError(l10n.getString('org-switcher-invalid-pin'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="org-switcher" ref={rootRef}>
      <button
        type="button"
        className="org-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={l10n.getString('org-switcher-trigger')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="org-switcher-current">{currentLabel}</span>
      </button>
      {open && (
        <ul
          className="org-switcher-list"
          role="listbox"
          aria-label={l10n.getString('org-switcher-list')}
        >
          {orgs.map((org) => (
            <li key={org.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={org.name === currentLabel}
                className="org-switcher-option"
                onClick={() => beginSwitch(org)}
              >
                {org.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pinOpen && (
        <div
          className="org-switcher-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="org-switcher-modal-title"
        >
          <p className="org-switcher-modal-title" id="org-switcher-modal-title">
            {l10n.getString('org-switcher-pin-title')}
          </p>
          <p className="org-switcher-modal-sub">{pendingOrg?.name}</p>
          <input
            type="password"
            inputMode="numeric"
            className="org-switcher-pin"
            aria-label={l10n.getString('org-switcher-pin')}
            value={pin}
            disabled={busy}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmSwitch();
            }}
          />
          {error && (
            <p className="org-switcher-error" role="alert">
              {error}
            </p>
          )}
          <div className="org-switcher-modal-actions">
            <button
              type="button"
              className="org-switcher-cancel"
              onClick={() => {
                setPinOpen(false);
                setPendingOrg(null);
              }}
            >
              {l10n.getString('org-switcher-cancel')}
            </button>
            <button
              type="button"
              className="org-switcher-confirm"
              disabled={busy || pin.length === 0}
              onClick={confirmSwitch}
            >
              {l10n.getString('org-switcher-confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
