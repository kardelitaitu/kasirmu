import { useState, useEffect, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { listOrganizations, type OrganizationSummary } from '@/api/staff';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import './OrgSelector.css';

// Seeded default legal entity carries no real org meaning; hide it.
const DEFAULT_SEEDED_ID = 'default:default-legal-entity';

/**
 * Pre-login Organization selector (SaaS-3 L194, the "safer half").
 *
 * Shown on the workspace picker so an operator can choose which Organization
 * (legal entity) to log into before a session is minted. The choice is only a
 * routing hint: it is carried into the next create_session call as org_id and
 * the backend FAILS CLOSED by re-deriving authority from the user assignment.
 * No live session exists yet, so nothing can be invalidated here.
 */
export default function OrgSelector() {
  const { l10n } = useLocalization();
  const { setPendingOrgId } = useWorkspace();
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await listOrganizations();
        setOrgs(data.filter((o) => o.id !== DEFAULT_SEEDED_ID));
      } catch {
        setOrgs([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (orgs.length <= 1) return null;

  const choose = (org: OrganizationSummary) => {
    setSelectedId(org.id);
    setPendingOrgId?.(org.id);
    setOpen(false);
  };

  const selectedName = selectedId
    ? orgs.find((o) => o.id === selectedId)?.name ?? l10n.getString('org-selector-default')
    : l10n.getString('org-selector-default');

  return (
    <div className="org-selector" ref={rootRef}>
      <label className="org-selector-label" id="org-selector-label" htmlFor="org-selector-trigger">
        {l10n.getString('org-selector-label')}
      </label>
      <button
        id="org-selector-trigger"
        type="button"
        className="org-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="org-selector-label"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="org-selector-current">{selectedName}</span>
      </button>
      {open && (
        <ul className="org-selector-list" role="listbox" aria-labelledby="org-selector-label">
          {orgs.map((org) => (
            <li key={org.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={org.id === selectedId}
                className="org-selector-option"
                onClick={() => choose(org)}
              >
                {org.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
