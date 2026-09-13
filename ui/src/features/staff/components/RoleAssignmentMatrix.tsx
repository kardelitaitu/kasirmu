/**
 * RoleAssignmentMatrix — the "Assignment Access" editor of the Staff detail
 * drawer (ADR #35 D5 / #47, spec 0048), extracted verbatim from
 * StaffManagementScreen.
 *
 * Presents the role's coverage matrix: the global/scoped radio pair, the
 * explicit all-or-list toggles per dimension (branches, workspaces) and the
 * ADR #47 resource axis (organization / legal entity / location). Each
 * scoped dimension is an explicit `all` or a list — the all/list toggle and
 * the list checkboxes never express an implicit "all".
 *
 * Key props:
 * - `form` / `setForm` — the drawer's form state; only the assignment fields
 *   (`scopeMode`, `branchesAll`, `branchIds`, `workspacesAll`,
 *   `workspaceKeys`, `resourceScope`, `resourceId`) are read or written here.
 * - `branches` / `allWorkspaces` / `entities` — option sources loaded by the
 *   drawer.
 * - `disabled` — the drawer's incomplete-profile gate (ADR #35 D6); applied
 *   to the fieldset, so its controls drop out of the a11y tree as a unit.
 *
 * Invariants:
 * - Renders only in edit mode (the drawer gates it) — creation has no
 *   assignment section.
 * - Styles come from `StaffManagementScreen.css` (global classes imported by
 *   the composition root) — this file owns no CSS.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceTypeDto } from '@/api/workspaces';
import type { LocationProfile } from '@/api/locations';
import type { LegalEntity } from '@/api/legalEntities';
import { requiredLocalized } from '@/frontend/shared';
import type { FormData } from './StaffDetailDrawer';

// ── SVG icon props ────────────────────────────────────────────────

const ICON_PROPS = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function wsIcon(key: string): React.ReactNode {
  switch (key) {
    case 'restaurant':
      return <svg {...ICON_PROPS}><path d="M6 2v20m12-20v5.3c0 3.3-2.7 6-6 6s-6-2.7-6-6V2"/></svg>;
    case 'store':
      return <svg {...ICON_PROPS}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'inventory':
      return <svg {...ICON_PROPS}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
    case 'admin':
      return <svg {...ICON_PROPS}><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9.9-4.9l1.4 1.4m12.8 1.4l1.4-1.4M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4"/></svg>;
    default:
      return <svg {...ICON_PROPS}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  }
}

interface RoleAssignmentMatrixProps {
  /** The drawer's form state (assignment fields are read/written here). */
  form: FormData;
  /** The drawer's form setter — the toggles are functional updates. */
  setForm: Dispatch<SetStateAction<FormData>>;
  /** Branch picker source — `store_profiles` rows (ADR #35 D5). */
  branches: LocationProfile[];
  /** Workspace picker source — all workspace types. */
  allWorkspaces: WorkspaceTypeDto[];
  /** Active legal entities for the ADR #47 resource axis. */
  entities: LegalEntity[];
  /** ADR #35 D6: incomplete profiles disable the whole section. */
  disabled: boolean;
}

/** The assignment scope editor: mode radio, branch/workspace dimensions,
 * resource axis. */
export function RoleAssignmentMatrix({
  form,
  setForm,
  branches,
  allWorkspaces,
  entities,
  disabled,
}: RoleAssignmentMatrixProps) {
  const { l10n } = useLocalization();

  // ── Assignment editor toggles (ADR #35 D5 / spec 0048) ────────────
  //
  // Each scoped dimension is an explicit `all` or a list — the all/list
  // toggle and the list checkboxes never express an implicit "all".

  const toggleBranch = (id: string) => {
    setForm((prev) => ({
      ...prev,
      branchIds: prev.branchIds.includes(id)
        ? prev.branchIds.filter((b) => b !== id)
        : [...prev.branchIds, id],
    }));
  };

  const toggleWorkspace = (key: string) => {
    setForm((prev) => ({
      ...prev,
      workspaceKeys: prev.workspaceKeys.includes(key)
        ? prev.workspaceKeys.filter((k) => k !== key)
        : [...prev.workspaceKeys, key],
    }));
  };

  return (
    <fieldset className="staff-mgmt-ws-section" disabled={disabled}>
      <Localized id="staff-assignment-section-label">
        <legend className="staff-mgmt-label">Assignment Access</legend>
      </Localized>

      <div className="staff-mgmt-radio">
        <input
          type="radio"
          name="scopeMode"
          value="global"
          checked={form.scopeMode === 'global'}
          onChange={() => setForm((prev) => ({ ...prev, scopeMode: 'global' }))}
          aria-label={l10n.getString('staff-assignment-global')}
        />
        <Localized id="staff-assignment-global">
          <span>All branches &amp; workspaces</span>
        </Localized>
      </div>

      <div className="staff-mgmt-radio">
        <input
          type="radio"
          name="scopeMode"
          value="scoped"
          checked={form.scopeMode === 'scoped'}
          onChange={() => setForm((prev) => ({ ...prev, scopeMode: 'scoped' }))}
          aria-label={l10n.getString('staff-assignment-scoped')}
        />
        <Localized id="staff-assignment-scoped">
          <span>Restrict by branch or workspace</span>
        </Localized>
      </div>

      {form.scopeMode === 'scoped' && (
        <>
          {/* ── Branch dimension (explicit all or list) ── */}
          <div className="staff-mgmt-dimension">
            <Localized id="staff-assignment-branches-label">
              <span className="staff-mgmt-dimension-label">Branches</span>
            </Localized>
            <label className="staff-mgmt-ws-checkbox" htmlFor="staff-assignment-all-branches">
              <input
                id="staff-assignment-all-branches"
                type="checkbox"
                aria-label={requiredLocalized(l10n, 'staff-assignment-all-branches')}
                checked={form.branchesAll}
                onChange={() =>
                  setForm((prev) => ({ ...prev, branchesAll: !prev.branchesAll, branchIds: [] }))
                }
              />
              <Localized id="staff-assignment-all-branches">
                <span>All branches</span>
              </Localized>
            </label>
            {!form.branchesAll && branches.length > 0 && (
              <div className="staff-mgmt-ws-checkboxes">
                {branches.map((b) => (
                  <label key={b.id} className="staff-mgmt-ws-checkbox">
                    <input
                      type="checkbox"
                      checked={form.branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                    />
                    <span className="staff-mgmt-ws-checkbox-label">{b.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Workspace dimension (explicit all or list) ── */}
          <div className="staff-mgmt-dimension">
            <Localized id="staff-assignment-workspaces-label">
              <span className="staff-mgmt-dimension-label">Workspaces</span>
            </Localized>
            <label className="staff-mgmt-ws-checkbox" htmlFor="staff-assignment-all-workspaces">
              <input
                id="staff-assignment-all-workspaces"
                type="checkbox"
                aria-label={requiredLocalized(l10n, 'staff-assignment-all-workspaces')}
                checked={form.workspacesAll}
                onChange={() =>
                  setForm((prev) => ({
                    ...prev,
                    workspacesAll: !prev.workspacesAll,
                    workspaceKeys: [],
                  }))
                }
              />
              <Localized id="staff-assignment-all-workspaces">
                <span>All workspaces</span>
              </Localized>
            </label>
            {!form.workspacesAll && allWorkspaces.length > 0 && (
              <div className="staff-mgmt-ws-checkboxes">
                {allWorkspaces.map((ws) => (
                  <label key={ws.key} className="staff-mgmt-ws-checkbox">
                    <input
                      type="checkbox"
                      checked={form.workspaceKeys.includes(ws.key)}
                      onChange={() => toggleWorkspace(ws.key)}
                    />
                    <span className="staff-mgmt-ws-checkbox-label">
                      {ws.icon && (
                        <span className="staff-mgmt-ws-icon" aria-hidden="true">
                          {wsIcon(ws.icon)}
                        </span>
                      )}
                      {ws.name}
                    </span>
                    <span className="staff-mgmt-ws-desc">{ws.description}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Resource scope (ADR #47 ruling 1A) ── the axis is
          orthogonal to the branch/workspace dimensions above: it
          names WHICH location or entity the assignment covers, and
          the choke-point gate enforces it on every location
          mutation. */}
      <div className="staff-mgmt-dimension">
        <Localized id="staff-assignment-resource-label">
          <span className="staff-mgmt-dimension-label">Resource scope</span>
        </Localized>
        <select
          id="staff-assignment-resource-scope"
          className="staff-mgmt-input"
          value={form.resourceScope}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              resourceScope: e.target.value as FormData['resourceScope'],
              resourceId: '',
            }))
          }
          aria-label={l10n.getString('staff-assignment-resource-label')}
        >
          <option value="organization">{l10n.getString('staff-assignment-resource-organization')}</option>
          <option value="legal_entity">{l10n.getString('staff-assignment-resource-legal-entity')}</option>
          <option value="location">{l10n.getString('staff-assignment-resource-location')}</option>
        </select>
        {form.resourceScope === 'location' && (
          <select
            id="staff-assignment-resource-location"
            className="staff-mgmt-input"
            value={form.resourceId}
            onChange={(e) => setForm((prev) => ({ ...prev, resourceId: e.target.value }))}
            aria-label={l10n.getString('staff-assignment-resource-location-select')}
          >
            <option value="">{l10n.getString('staff-assignment-resource-location-select')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        {form.resourceScope === 'legal_entity' && (
          <select
            id="staff-assignment-resource-entity"
            className="staff-mgmt-input"
            value={form.resourceId}
            onChange={(e) => setForm((prev) => ({ ...prev, resourceId: e.target.value }))}
            aria-label={l10n.getString('staff-assignment-resource-entity-select')}
          >
            <option value="">{l10n.getString('staff-assignment-resource-entity-select')}</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        )}
        {(form.resourceScope === 'location' && branches.length === 0) && (
          <Localized id="staff-assignment-resource-empty-hint">
            <span className="staff-mgmt-ws-desc">No locations available.</span>
          </Localized>
        )}
        {(form.resourceScope === 'legal_entity' && entities.length === 0) && (
          <Localized id="staff-assignment-resource-empty-hint">
            <span className="staff-mgmt-ws-desc">No legal entities available.</span>
          </Localized>
        )}
        {form.resourceScope !== 'organization' &&
          !form.resourceId.trim() &&
          (form.resourceScope === 'location' ? branches.length : entities.length) > 0 && (
          <Localized id="staff-assignment-resource-required-hint">
            <span className="staff-mgmt-ws-desc">Choose a resource to scope this assignment.</span>
          </Localized>
        )}
      </div>
    </fieldset>
  );
}
