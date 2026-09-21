import { useCallback, useEffect, useImperativeHandle, useMemo, useState, type RefObject } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listRolesScoped,
  listPermissionKeysScoped,
  createRoleScoped,
  updateRoleScoped,
  deleteRoleScoped,
  listRoleHoldersScoped,
  type RoleDto,
  type PermissionKeyDto,
  type RoleHolderDto,
  type RoleHoldersDto,
} from '@/api/staff';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, SettingsPopup, requiredLocalized } from '@/components';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import './RoleAuthoringPanel.css';

/**
 * RoleAuthoringPanel — the Roles half of the staff management page: create,
 * edit and delete custom roles (ADR #47 ruling 4).
 *
 * It renders INSIDE `StaffManagementScreen`'s tab panel rather than as a
 * route of its own, so it paints no page chrome — no back button, no page
 * height, no padding. The page shell owns those, plus the header action that
 * opens the create editor; this component exposes that one entry point
 * through a ref (`RoleAuthoringPanelHandle.openCreate`) because the trigger
 * lives in the shell while the editor's state lives here.
 *
 * A custom role is a named key-set row in the same registry vocabulary
 * enforcement already speaks; this panel is the write surface for it. Two
 * rules the UI must not paper over, both enforced server-side and mirrored
 * here only to explain themselves to the user:
 *
 * - Preset rows are not authorable. `seed_default_roles` upserts preset ids
 *   and overwrites their grants, so an edit would be silently destroyed.
 *   `role-custom` is a preset, so the flag — never the name — decides.
 * - A role still referenced cannot be deleted, because dropping one out
 *   from under a holder would be a silent loss of access, not an error.
 *
 * The permission picker is fed by `list_permission_keys_scoped` rather than
 * a constant: the registry is the single source of truth (ADR #35) and a
 * hardcoded copy drifts from the keys the gate actually honors.
 *
 * The editor is a `SettingsPopup`, not an inline card, so the list keeps its
 * scroll position and the picker's 85 keys get the popup's own scroll area
 * instead of pushing the roster off-screen.
 *
 * Each row also expands to the accounts holding that role, and the scope
 * that bounds them. Three numbers ride along, and each may only be worded
 * for what it counts:
 *
 * - `reference_count` — FOREIGN-KEY rows across four tables. Gates Delete,
 *   and nothing else may gate Delete. Never worded as people.
 * - `holder_count` — accounts that RESOLVE here, from the same predicate
 *   enforcement uses (assignment first, `users.role_id` fallback). The only
 *   value allowed to say "used by N accounts", and the number the expanded
 *   list below agrees with because the two share one WHERE clause.
 * - `grant_count` — workspace configuration pointing at this role. Blocks a
 *   delete like a holder does while nobody holds anything.
 *
 * The first version of this row labelled `reference_count` as accounts,
 * which double-counted every ordinary person (`create_user` writes a users
 * row AND an assignments row) and, at its worst, reported one account for a
 * role no account held. That is the mistake this split exists to make
 * unrepresentable.
 */
/**
 * The ADR #47 resource axis for one holder, as its own message per case.
 *
 * Literal ids rather than a computed one, so the bundle-parity gate can
 * resolve every key statically — a dynamic id would let a typoed axis read
 * as a missing translation at runtime instead of failing the commit.
 */
function HolderResource({ h }: { h: RoleHolderDto }) {
  if (!h.has_assignment) {
    return (
      <Localized id="role-holders-scope-legacy">
        <span className="role-holder-scope">No assignment record</span>
      </Localized>
    );
  }
  if (h.scope_type === 'legal_entity') {
    return (
      <Localized id="role-holders-scope-legal-entity" vars={{ id: h.scope_id ?? '' }}>
        <span className="role-holder-scope">Legal entity</span>
      </Localized>
    );
  }
  if (h.scope_type === 'location') {
    return (
      <Localized id="role-holders-scope-location" vars={{ id: h.scope_id ?? '' }}>
        <span className="role-holder-scope">Location</span>
      </Localized>
    );
  }
  return (
    <Localized id="role-holders-scope-organization">
      <span className="role-holder-scope">Organization-wide</span>
    </Localized>
  );
}

/**
 * The 0048 branch/workspace dimensions, as four exhaustive combinations.
 *
 * `*_scope` is consulted before `*_count`, and that ordering is the point: a
 * scoped assignment covering every branch carries zero list rows, so a
 * column that rendered the count alone would report an all-branches manager
 * as having no branches — the opposite of the truth.
 */
function HolderDims({ h }: { h: RoleHolderDto }) {
  const branchesList = h.branch_scope === 'list';
  const workspacesList = h.workspace_scope === 'list';
  if (!branchesList && !workspacesList) {
    return (
      <Localized id="role-holders-dims-all">
        <span className="role-holder-dims">all branches and workspaces</span>
      </Localized>
    );
  }
  if (branchesList && !workspacesList) {
    return (
      <Localized id="role-holders-dims-branches" vars={{ count: h.branch_count ?? 0 }}>
        <span className="role-holder-dims">a number of branches</span>
      </Localized>
    );
  }
  if (!branchesList && workspacesList) {
    return (
      <Localized id="role-holders-dims-workspaces" vars={{ count: h.workspace_count ?? 0 }}>
        <span className="role-holder-dims">a number of workspaces</span>
      </Localized>
    );
  }
  return (
    <Localized
      id="role-holders-dims-both-lists"
      vars={{ branches: h.branch_count ?? 0, workspaces: h.workspace_count ?? 0 }}>
      <span className="role-holder-dims">branch and workspace lists</span>
    </Localized>
  );
}

/** Props for the embedded roles panel. */
export interface RoleAuthoringPanelProps {
  /**
   * Whether this panel is the view on screen. The shell owns the tabs and the
   * wrapper that hides this one, so it is also the only thing that knows when
   * the view has gone — which is what the effect below needs to dismiss the
   * panel's modal surfaces.
   */
  active: boolean;
  /**
   * The shell's handle on this panel. The header's "Add New Role" action lives
   * outside this component while the editor's state lives inside it, so the
   * shell reaches in through this ref rather than the panel hoisting six
   * pieces of editor state up to a parent that only wants to open a popup.
   *
   * A plain prop, not `forwardRef`: `useImperativeHandle` accepts any `Ref`,
   * so wrapping the component would buy nothing and make the prop invisible
   * in the signature.
   */
  handleRef: RefObject<RoleAuthoringPanelHandle>;
}

/** The one thing the shell drives from outside this panel. */
export interface RoleAuthoringPanelHandle {
  /** Open the editor in create mode — the header's "Add New Role" action. */
  openCreate: () => void;
}

function RoleAuthoringPanel({ active, handleRef }: RoleAuthoringPanelProps) {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();

  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [keys, setKeys] = useState<PermissionKeyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = not editing; '' = creating a new role; anything else = that id.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RoleDto | null>(null);
  // Holders are loaded per row on expand, not with the role list: a screen
  // with twenty roles would otherwise make twenty-one calls to answer one
  // question about one of them. Keyed by role id so two rows can be open.
  const [openHolders, setOpenHolders] = useState<Set<string>>(new Set());
  const [holdersById, setHoldersById] = useState<Record<string, RoleHoldersDto>>({});
  const [holdersLoadingId, setHoldersLoadingId] = useState<string | null>(null);
  const [holdersErrors, setHoldersErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    try {
      const [roleList, keyList] = await Promise.all([
        listRolesScoped(sessionToken),
        listPermissionKeysScoped(sessionToken),
      ]);
      setRoles(roleList);
      setKeys(keyList);
      // Any save or delete re-points holders, and refresh is what runs after
      // both — a cached list would then contradict the row beside it.
      setHoldersById({});
      setHoldersErrors({});
      setOpenHolders(new Set());
    } catch (e) {
      setError(l10nErrorMessage(e, l10n));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEditor = useCallback((role: RoleDto | null) => {
    setEditingId(role ? role.id : '');
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setGranted(new Set(role?.permissions ?? []));
    setError(null);
  }, []);

  // The create trigger lives in the page header, this state lives here, so
  // the shell reaches in through the handle prop rather than hoisting the
  // editor's state up to it. `openEditor` only calls setters, so the handle
  // never reads a stale render.
  useImperativeHandle(handleRef, () => ({ openCreate: () => openEditor(null) }), [openEditor]);

  // Grouped by family so the picker reads as capabilities rather than an
  // 85-key wall.
  const byFamily = useMemo(() => {
    const map = new Map<string, PermissionKeyDto[]>();
    for (const k of keys) {
      const list = map.get(k.family) ?? [];
      list.push(k);
      map.set(k.family, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [keys]);


  const toggleHolders = async (role: RoleDto) => {
    const next = new Set(openHolders);
    if (next.has(role.id)) {
      next.delete(role.id);
      setOpenHolders(next);
      return;
    }
    next.add(role.id);
    setOpenHolders(next);
    if (!sessionToken || holdersById[role.id]) return; // cached per role id
    setHoldersLoadingId(role.id);
    setHoldersErrors((m) => {
      const copy = { ...m };
      delete copy[role.id];
      return copy;
    });
    try {
      const page = await listRoleHoldersScoped(sessionToken, role.id);
      setHoldersById((m) => ({ ...m, [role.id]: page }));
    } catch (e) {
      // Row-local, not the screen-wide banner: a failed holder read must not
      // look like the role list itself failed.
      setHoldersErrors((m) => ({ ...m, [role.id]: l10nErrorMessage(e, l10n) }));
    } finally {
      setHoldersLoadingId((id) => (id === role.id ? null : id));
    }
  };

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setName('');
    setDescription('');
    setGranted(new Set());
  }, []);

  // A modal must not outlive the view it belongs to.
  //
  // Both the editor and the delete confirm are PORTALS, so hiding this panel
  // does not hide them: they keep rendering into document.body and stay in the
  // accessibility tree while the other tab is on screen, editing a view nobody
  // is looking at. The tab strip is under their overlay, so a click cannot
  // reach them that way — but a `hashchange` can: the browser's Back button
  // through tab history moves `#/roles` -> `#/staff` with the dialog open, and
  // that path goes through no click handler. Hence an effect on `active` rather
  // than a line in the shell's `selectTab`, which only sees clicks.
  //
  // The two nearby cases this deliberately does NOT cover, both measured in the
  // running app rather than reasoned about — because the believable-but-wrong
  // reading is that they are covered here:
  //   * a WORKSPACE SWITCH clears the hash to '' (AppShell's workspace-switch
  //     effect). That matches neither tab, so the tab does not change and the
  //     modal correctly stays: the view is unchanged, so there is no invariant
  //     to restore. It is not "covered by the listener" — the listener no-ops.
  //   * a route that LEAVES the page (`#/products`) unmounts this whole screen,
  //     so the portal goes with the subtree. Nothing to dismiss either.
  // Between them they leave exactly one hole — the tab change — and that is this
  // effect.
  useEffect(() => {
    if (active) return;
    closeEditor();
    setPendingDelete(null);
  }, [active, closeEditor]);

  const toggleKey = (key: string) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    // `editingId === ''` is the create sentinel, so a truthiness test here
    // silently no-ops the New-role path — the editor opens, Save looks
    // pressed, and nothing is sent. Only `null` means "not editing".
    if (!sessionToken || editingId === null) return;
    setSaving(true);
    setError(null);
    try {
      const permissions = keys.filter((k) => granted.has(k.key)).map((k) => k.key);
      if (editingId === '') {
        await createRoleScoped(sessionToken, { name, description, permissions });
      } else {
        await updateRoleScoped(sessionToken, { id: editingId, name, description, permissions });
      }
      addToast({ message: l10n.getString('role-saved', { name: name.trim() }), type: 'success' });
      closeEditor();
      await refresh();
    } catch (e) {
      // The backend owns the rules (preset id, unregistered key, duplicate
      // name); surfacing its message beats guessing one here.
      setError(l10nErrorMessage(e, l10n));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!sessionToken || !pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError(null);
    try {
      await deleteRoleScoped(sessionToken, target.id);
      if (editingId === target.id) closeEditor();
      addToast({ message: l10n.getString('role-deleted', { name: target.name }), type: 'success' });
      await refresh();
    } catch (e) {
      setError(l10nErrorMessage(e, l10n));
    }
  };

  if (loading) {
    return (
      <div className="role-authoring" aria-busy="true">
        <Skeleton variant="block" width="100%" height="12rem" />
      </div>
    );
  }

  return (
    <div className="role-authoring">
      <Card>
        {/* No title here: the active tab names this view. The subtitle stays
            because it explains what an authored role IS, which a tab label
            cannot. */}
        <Localized id="role-authoring-subtitle">
          <p className="role-authoring-subtitle">
            Built-in roles are defaults; custom roles are named permission
            sets you author.
          </p>
        </Localized>

        {/* The editor owns its own error while it is open — SettingsPopup
            renders it — so repeating it here would announce one failure
            twice. This banner is for failures with no editor on screen: a
            failed load, or a refused delete. */}
        {error && editingId === null && (
          <p className="role-authoring-error" role="alert">
            {error}
          </p>
        )}

        {roles.length === 0 ? (
          <EmptyState title={requiredLocalized(l10n, 'role-empty-title')} />
        ) : (
          <ul className="role-list" aria-label={l10n.getString('role-list-aria')}>
            {roles.map((role) => {
              const page = holdersById[role.id];
              const holdersOpen = openHolders.has(role.id);
              return (
              <li key={role.id} className="role-list-item">
                <div className="role-list-main">
                  <span className="role-list-name">{role.name}</span>
                  {role.is_builtin ? (
                    <Badge variant="default">
                      <Localized id="role-badge-builtin">Built-in</Localized>
                    </Badge>
                  ) : (
                    <Badge variant="info">
                      <Localized id="role-badge-custom">Custom</Localized>
                    </Badge>
                  )}
                </div>
                {role.description && <p className="role-list-desc">{role.description}</p>}
                <p className="role-list-grants">
                  <Localized
                    id="role-grant-count"
                    vars={{ count: role.permissions.length }}>
                    <span>{role.permissions.length} permissions</span>
                  </Localized>
                </p>
                <div className="role-holders">
                  <Button
                    unstyled
                    className="role-holders-toggle"
                    aria-expanded={holdersOpen}
                    onClick={() => void toggleHolders(role)}
                    aria-label={l10n.getString('role-holders-aria', { name: role.name })}
                    data-testid={`staff-role-holders-${role.id}`}>
                    <Localized id="role-holders-toggle">
                      <span>Holders</span>
                    </Localized>
                  </Button>
                  {/* Only ever the authoritative total from a completed read.
                      role.reference_count is a different number on purpose
                      (it spans four FK tables and answers deletion, not
                      holding), so it is never rendered under this label. */}
                  {page && (
                    <Localized id="role-holders-count" vars={{ count: page.total }}>
                      <span className="role-holders-count">{page.total} accounts</span>
                    </Localized>
                  )}
                </div>
                {holdersOpen && (
                  <div className="role-holders-panel">
                    {holdersLoadingId === role.id && (
                      <Localized id="role-holders-loading">
                        <span className="role-holders-loading">Loading holders…</span>
                      </Localized>
                    )}
                    {holdersErrors[role.id] && (
                      <p className="role-holders-error">
                        <Localized id="role-holders-error">
                          <span>Could not load holders.</span>
                        </Localized>
                        {" "}
                        {holdersErrors[role.id]}
                      </p>
                    )}
                    {page && page.total === 0 && (
                      <Localized id="role-holders-none">
                        <p className="role-holders-none">
                          No accounts hold this role
                        </p>
                      </Localized>
                    )}
                    {page && page.holders.length > 0 && (
                      <>
                        <ul
                          className="role-holders-list"
                          aria-label={l10n.getString('role-holders-list-aria', {
                            name: role.name,
                          })}>
                          {page.holders.map((h) => (
                            <li key={h.user_id} className="role-holder">
                              <span className="role-holder-name">
                                {h.display_name}
                                {!h.is_active && (
                                  <Badge variant="default">
                                    <Localized id="role-holders-inactive">
                                      <span>inactive</span>
                                    </Localized>
                                  </Badge>
                                )}
                              </span>
                              <span className="role-holder-user">{h.username}</span>
                              <span className="role-holder-scope">
                                <HolderResource h={h} />
                                {" · "}
                                <HolderDims h={h} />
                              </span>
                            </li>
                          ))}
                        </ul>
                        {page.holders.length < page.total && (
                          <p className="role-holders-more">
                            <Localized
                              id="role-holders-more"
                              vars={{ count: page.total - page.holders.length }}>
                              <span>
                                and {page.total - page.holders.length} more
                              </span>
                            </Localized>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="role-list-actions">
                  {/* Preset rows carry no Edit/Delete at all: the seeder owns
                      them, so an accepted edit would be silently reverted. */}
                  {!role.is_builtin && (
                    <>
                      <Button variant="ghost" onClick={() => openEditor(role)} aria-label={l10n.getString('role-edit-aria', { name: role.name })} data-testid={`staff-role-edit-${role.id}`}>
                        <Localized id="role-edit">Edit</Localized>
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={role.reference_count > 0}
                        onClick={() => setPendingDelete(role)}
                        aria-label={l10n.getString('role-delete-aria', { name: role.name })}
                        data-testid={`staff-role-delete-${role.id}`}>
                        <Localized id="role-delete">Delete</Localized>
                      </Button>
                      {/* Three cases, because these are two different kinds
                          of thing. holder_count is people; grant_count is
                          workspace configuration that blocks a delete without
                          anybody holding anything. The label formerly printed
                          their sum and called it accounts, which was never
                          what the number was. Delete itself stays on
                          reference_count: that is the FK truth, and it is the
                          only thing entitled to gate a deletion. */}
                      {role.holder_count > 0 && (
                        <span className="role-in-use">
                          <Localized
                            id="role-in-use-accounts"
                            vars={{ count: role.holder_count }}>
                            <span>{role.holder_count} accounts</span>
                          </Localized>
                          {role.grant_count > 0 && (
                            <Localized
                              id="role-in-use-grants"
                              vars={{ count: role.grant_count }}>
                              <span>and workspace grants</span>
                            </Localized>
                          )}
                        </span>
                      )}
                      {role.holder_count === 0 && role.grant_count > 0 && (
                        <span className="role-in-use">
                          <Localized
                            id="role-in-use-grants-only"
                            vars={{ count: role.grant_count }}>
                            <span>workspace grants</span>
                          </Localized>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* The editor is a popup, not a second card: the permission picker is an
          85-key wall, and inline it pushed the role list off-screen and lost
          the scroll position on every open. */}
      <SettingsPopup
        open={editingId !== null}
        onClose={closeEditor}
        title={l10n.getString(editingId === '' ? 'role-create' : 'role-editor-edit-title')}
        error={error}
        saving={saving}
        onSave={() => void save()}
        saveLabel={l10n.getString('role-save')}
        saveDisabled={saving || name.trim().length === 0}
        cancelLabel={l10n.getString('role-cancel')}
        size="lg"
      >
        <label className="role-field">
          <Localized id="role-field-name">
            <span className="role-field-label">Role name</span>
          </Localized>
          <input
            className="role-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={l10n.getString('role-field-name')}
          />
        </label>
        <label className="role-field">
          <Localized id="role-field-description">
            <span className="role-field-label">Role description</span>
          </Localized>
          <input
            className="role-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label={l10n.getString('role-field-description')}
          />
        </label>

        <fieldset className="role-perm-picker">
          <Localized id="role-field-permissions">
            <legend>Permissions</legend>
          </Localized>
          {byFamily.map(([family, entries]) => (
            <div key={family} className="role-perm-family">
              <span className="role-perm-family-name">{family}</span>
              {entries.map((entry) => (
                <label key={entry.key} className="role-perm-row">
                  <input
                    type="checkbox"
                    checked={granted.has(entry.key)}
                    onChange={() => toggleKey(entry.key)}
                    aria-label={entry.key}
                  />
                  <code className="role-perm-key">{entry.key}</code>
                  {entry.sensitive && (
                    <Badge variant="warning">
                      <Localized id="role-perm-sensitive">Sensitive</Localized>
                    </Badge>
                  )}
                  <span className="role-perm-desc">{entry.description}</span>
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      </SettingsPopup>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={l10n.getString('role-delete-confirm-title')}
        message={l10n.getString('role-delete-confirm-body', { name: pendingDelete?.name ?? '' })}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
        variant="danger"
      />
    </div>
  );
}

export default RoleAuthoringPanel;
