import { useCallback, useEffect, useMemo, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listRolesScoped,
  listPermissionKeysScoped,
  createRoleScoped,
  updateRoleScoped,
  deleteRoleScoped,
  type RoleDto,
  type PermissionKeyDto,
} from '@/api/staff';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, requiredLocalized } from '@/frontend/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/frontend/shared/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import './RoleAuthoringScreen.css';

/**
 * Role authoring — create, edit and delete custom roles (ADR #47 ruling 4).
 *
 * A custom role is a named key-set row in the same registry vocabulary
 * enforcement already speaks; this screen is the write surface for it. Two
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
 */
export default function RoleAuthoringScreen() {
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
    } catch (e) {
      setError(l10nErrorMessage(e, l10n));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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


  const openEditor = (role: RoleDto | null) => {
    setEditingId(role ? role.id : '');
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setGranted(new Set(role?.permissions ?? []));
    setError(null);
  };

  const closeEditor = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setGranted(new Set());
  };

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
        <div className="role-authoring-header">
          <div>
            <Localized id="role-authoring-title">
              <h2>Roles</h2>
            </Localized>
            <Localized id="role-authoring-subtitle">
              <p className="role-authoring-subtitle">
                Built-in roles are defaults; custom roles are named permission
                sets you author.
              </p>
            </Localized>
          </div>
          <Button variant="primary" onClick={() => openEditor(null)} aria-label={l10n.getString('role-create-aria')}>
            <Localized id="role-create">New role</Localized>
          </Button>
        </div>

        {error && (
          <p className="role-authoring-error" role="alert">
            {error}
          </p>
        )}

        {roles.length === 0 ? (
          <EmptyState title={requiredLocalized(l10n, 'role-empty-title')} />
        ) : (
          <ul className="role-list" aria-label={l10n.getString('role-list-aria')}>
            {roles.map((role) => (
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
                <div className="role-list-actions">
                  {/* Preset rows carry no Edit/Delete at all: the seeder owns
                      them, so an accepted edit would be silently reverted. */}
                  {!role.is_builtin && (
                    <>
                      <Button variant="ghost" onClick={() => openEditor(role)} aria-label={l10n.getString('role-edit-aria', { name: role.name })}>
                        <Localized id="role-edit">Edit</Localized>
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={role.reference_count > 0}
                        onClick={() => setPendingDelete(role)}
                        aria-label={l10n.getString('role-delete-aria', { name: role.name })}>
                        <Localized id="role-delete">Delete</Localized>
                      </Button>
                      {role.reference_count > 0 && (
                        <Localized
                          id="role-in-use"
                          vars={{ count: role.reference_count }}>
                          <span className="role-in-use">In use</span>
                        </Localized>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editingId !== null && (
        <Card>
          <Localized id={editingId === '' ? 'role-editor-create-title' : 'role-editor-edit-title'}>
            <h3>Role details</h3>
          </Localized>
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

          <div className="role-editor-actions">
            <Button variant="ghost" onClick={closeEditor} aria-label={l10n.getString('role-cancel-aria')}>
              <Localized id="role-cancel">Cancel</Localized>
            </Button>
            <Button
              variant="primary"
              disabled={saving || name.trim().length === 0}
              onClick={() => void save()}
              aria-label={l10n.getString('role-save-aria')}>
              <Localized id="role-save">Save role</Localized>
            </Button>
          </div>
        </Card>
      )}

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
