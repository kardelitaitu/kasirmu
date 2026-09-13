/**
 * StaffDetailDrawer — the member detail/edit surface of the Staff management
 * screen, extracted verbatim from StaffManagementScreen.
 *
 * Renders the add/edit `SettingsPopup`: identity fields (username, display
 * name, PIN rotation — STAFF-03), the five-role taxonomy selector with its
 * read-only granted-permission chips (0046), the ADR #35 D6 profile fieldset
 * (wage, contact, documents), and — edit mode only — the Assignment Access
 * editor (ADR #35 D5 / #47, spec 0048).
 *
 * Key props:
 * - `member` — the row being edited, or `null` for create mode. Opening the
 *   drawer with a member reproduces the old `openEdit`: the form resets
 *   synchronously from the DTO (render-phase, so the dialog appears
 *   pre-filled in the same click), then `getStaffProfileScoped` + the option
 *   lists merge in when they resolve (STAFF-05 / spec 0048).
 * - `onClose` / `onSaved` — the parent's modal gate and list reload.
 *
 * Invariants:
 * - `is_active` rides the update unchanged (STAFF-09); PIN rotates only when
 *   a new one was entered; profile + assignment are ONE atomic IPC call.
 * - Management-role and assignment controls are disabled while the edited
 *   member's profile is incomplete (ADR #35 D6).
 * - A tier staff-limit rejection swaps the generic error line for the
 *   upgrade banner (C1.1); errors go through `l10nErrorMessage`.
 * - Styles come from `StaffManagementScreen.css` (global classes imported by
 *   the composition root) — this file owns no CSS.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  createStaffScoped,
  updateStaffScoped,
  getStaffProfileScoped,
  isStaffQuotaLimitError,
  type StaffMemberDto,
  type RoleDto,
  type ProfileArgs,
  type AssignmentArgs,
} from '@/api/staff';
import { listAllWorkspacesScoped, type WorkspaceTypeDto } from '@/api/workspaces';
import { listLocationsScoped, type LocationProfile } from '@/api/locations';
import { listLegalEntitiesScoped, type LegalEntity } from '@/api/legalEntities';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/frontend/shared/Toast';
import { LocaleContext } from '@/i18n/LocaleContext';
import { openUpgradePricing as openUpgradePricingPage } from '@/utils/upgrade';
import { Button } from '@/components/Button';
import { SettingsPopup, requiredLocalized } from '@/frontend/shared';
import { l10nErrorMessage } from '@/utils/app-error';
import { parseMinorUnits } from '@/types/domain';
import SettingsSelect from '@/features/settings/SettingsSelect';
import { RoleAssignmentMatrix } from './RoleAssignmentMatrix';

// ── Five-role taxonomy (ADR #35 D4 / spec 0048) ──────────────────────
//
// The staff screen presents exactly the five preset roles, in this order.
// Cashier/kitchen are retired (0048 2c) and custom roles have no UI yet
// (0048 non-goal) — so the dropdown is the taxonomy, never the raw role
// table. Role ids are the seeded preset ids (platform-core `ROLE_PRESETS`).
const PRESET_ROLE_ORDER = [
  'role-owner',
  'role-admin',
  'role-manager',
  'role-staff',
  'role-auditor',
] as const;

/**
 * The roles presented in the dropdown, filtered to the five-role taxonomy
 * and ordered Owner → Admin → Manager → Staff → Auditor.
 */
function taxonomyRoles(roles: RoleDto[]): RoleDto[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const ordered: RoleDto[] = [];
  for (const id of PRESET_ROLE_ORDER) {
    const role = byId.get(id);
    if (role) ordered.push(role);
  }
  return ordered;
}

// ── Form state ──────────────────────────────────────────────────────

export interface FormData {
  username: string;
  displayName: string;
  pin: string;
  roleId: string;
  /** STAFF-09: current active state — preserved unchanged on profile edits. */
  isActive: boolean;
  /** Only used when editing — assignment scope mode (ADR #35 D5). */
  scopeMode: 'global' | 'scoped';
  /** Only used when editing — branch dimension is explicit `all`. */
  branchesAll: boolean;
  /** Only used when editing — branch ids in scope when not all. */
  branchIds: string[];
  /** Only used when editing — workspace dimension is explicit `all`. */
  workspacesAll: boolean;
  /** Only used when editing — workspace keys in scope when not all. */
  workspaceKeys: string[];
  /** Only used when editing — ADR #47 resource axis (ruling 1A). */
  resourceScope: 'organization' | 'legal_entity' | 'location';
  /** Only used when editing — the resource id when the axis is not
   * organization; empty there. */
  resourceId: string;
  // ── ADR #35 D6 profile fields ────────────────────────────────
  dateOfBirth: string;
  phone: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  /** Monthly take-home pay — kept as a string in the form, parsed to minor
   * units on submit. */
  monthlyTakeHome: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  jobTitle: string;
  notes: string;
  address: string;
  language: string;
  avatar: string;
  taxId: string;
  nationalIdExpiresAt: string;
  emergencyContactRelationship: string;
  hireDate: string;
}

const EMPTY_FORM: FormData = {
  username: '',
  displayName: '',
  pin: '',
  roleId: '',
  isActive: true,
  scopeMode: 'global',
  branchesAll: true,
  branchIds: [],
  workspacesAll: true,
  workspaceKeys: [],
  resourceScope: 'organization',
  resourceId: '',
  dateOfBirth: '',
  phone: '',
  nationalIdType: '',
  nationalId: '',
  email: '',
  monthlyTakeHome: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  jobTitle: '',
  notes: '',
  address: '',
  language: '',
  avatar: '',
  taxId: '',
  nationalIdExpiresAt: '',
  emergencyContactRelationship: '',
  hireDate: '',
};

/**
 * The form seeded when the drawer opens — the create form, or the member's
 * identity + CURRENT effective assignment (ADR #35 D5 / spec 0048): global
 * roles show as global, scoped members show their all/list dimensions. The
 * ADR #35 D6 profile fields start empty and merge in from
 * `getStaffProfileScoped`.
 */
function baseFormFor(member: StaffMemberDto | null): FormData {
  if (!member) {
    return EMPTY_FORM;
  }
  return {
    ...EMPTY_FORM,
    username: member.username,
    displayName: member.display_name,
    roleId: member.role_id,
    // STAFF-09: preserve the member's current active state so a profile
    // edit never silently reactivates a deactivated account.
    isActive: member.is_active,
    scopeMode: member.assignment.scope_mode,
    branchesAll: member.assignment.branches_all,
    branchIds: member.assignment.branch_ids,
    workspacesAll: member.assignment.workspaces_all,
    workspaceKeys: member.assignment.workspace_keys,
    resourceScope: member.assignment.scope_type ?? 'organization',
    resourceId: member.assignment.scope_id ?? '',
  };
}

/** Build the IPC `ProfileArgs` from the form, skipping empty optionals. */
function profileArgsFromForm(form: FormData): ProfileArgs {
  // MONEY-02: exact decimal parse; garbage input is treated as absent
  // (the old parseFloat path stored NaN).
  const payMinor = form.monthlyTakeHome.trim()
    ? parseMinorUnits(form.monthlyTakeHome, 2) ?? undefined
    : undefined;
  const profile: ProfileArgs = {};
  const set = (key: keyof ProfileArgs, value: string | number | undefined) => {
    if (value !== undefined && String(value).trim() !== '') {
      // exactOptionalPropertyTypes: assign via bracket to keep the key set.
      (profile as Record<string, string | number>)[key] = value;
    }
  };
  set('date_of_birth', form.dateOfBirth.trim());
  set('phone', form.phone.trim());
  set('national_id_type', form.nationalIdType.trim());
  set('national_id', form.nationalId.trim());
  set('email', form.email.trim());
  set('monthly_take_home_minor', payMinor);
  set('emergency_contact_name', form.emergencyContactName.trim());
  set('emergency_contact_phone', form.emergencyContactPhone.trim());
  set('job_title', form.jobTitle.trim());
  set('notes', form.notes.trim());
  set('address', form.address.trim());
  set('language', form.language.trim());
  set('avatar', form.avatar.trim());
  set('tax_id', form.taxId.trim());
  set('national_id_expires_at', form.nationalIdExpiresAt.trim());
  set('emergency_contact_relationship', form.emergencyContactRelationship.trim());
  set('hire_date', form.hireDate.trim());
  return profile;
}

/**
 * ADR #35 D6 field-level validation. Returns localized per-field errors for
 * the 9 mandatory fields (username + full name included) plus shape checks
 * for email / phone / national id / pay. Empty object means valid.
 */
function validateProfileForm(form: FormData, l10n: ReturnType<typeof useLocalization>['l10n'], isEditing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = (field: keyof FormData, key: string) => {
    if (!String(form[field]).trim()) {
      errors[field] = l10n.getString(key);
    }
  };
  if (!isEditing) {
    required('username', 'staff-error-username-required');
  }
  required('displayName', 'staff-error-display-name-required');
  required('dateOfBirth', 'staff-error-dob-required');
  required('phone', 'staff-error-phone-required');
  required('nationalIdType', 'staff-error-national-id-type-required');
  required('nationalId', 'staff-error-national-id-required');
  required('email', 'staff-error-email-required');
  required('monthlyTakeHome', 'staff-error-pay-required');
  required('emergencyContactName', 'staff-error-emergency-name-required');
  required('emergencyContactPhone', 'staff-error-emergency-phone-required');

  const email = form.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors['email'] = l10n.getString('staff-error-email-invalid');
  }
  const phone = form.phone.trim();
  if (phone && !/^\+\d{7,14}$/.test(phone)) {
    errors['phone'] = l10n.getString('staff-error-phone-invalid');
  }
  const idType = form.nationalIdType.trim();
  const nationalId = form.nationalId.trim();
  if (nationalId) {
    const expected = idType === 'nik' ? 16 : 9;
    if (!/^\d+$/.test(nationalId) || nationalId.length !== expected) {
      errors['nationalId'] = l10n.getString('staff-error-national-id-invalid');
    }
  }
  const pay = form.monthlyTakeHome.trim();
  if (pay && (!/^\d+(\.\d{1,2})?$/.test(pay) || parseFloat(pay) <= 0)) {
    errors['monthlyTakeHome'] = l10n.getString('staff-error-pay-invalid');
  }
  const dob = form.dateOfBirth.trim();
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    errors['dateOfBirth'] = l10n.getString('staff-error-dob-invalid');
  }
  return errors;
}

interface StaffDetailDrawerProps {
  /** Whether the drawer is open. */
  open: boolean;
  /** The member being edited; `null` in create mode. */
  member: StaffMemberDto | null;
  /** Raw role rows from `list_roles_scoped` — filtered to the taxonomy here. */
  roles: RoleDto[];
  /** Dismiss the drawer (Cancel, backdrop, Escape, close button). */
  onClose: () => void;
  /** Reload the staff list — called after a successful create/update. */
  onSaved: () => Promise<void> | void;
}

/** Add/edit drawer for a staff member. */
export function StaffDetailDrawer({ open, member, roles, onClose, onSaved }: StaffDetailDrawerProps) {
  const { l10n } = useLocalization();
  // C1.1 upgrade link needs the active locale for the pricing URL; tests
  // render without LocaleContext, so default to English there.
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();

  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** C1.1: the last save was rejected by the tier's staff-user limit. */
  const [quotaUpgrade, setQuotaUpgrade] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceTypeDto[]>([]);
  /** Branch picker source — `store_profiles` rows are the branch ids the
   * assignment model scopes on (ADR #35 D5). */
  const [branches, setBranches] = useState<LocationProfile[]>([]);
  const [entities, setEntities] = useState<LegalEntity[]>([]);

  const isEditing = member !== null;
  // ADR #35 D6: the member being edited has an incomplete profile —
  // management-role and assignment controls are disabled until complete.
  const editingIncomplete = member ? !member.is_profile_complete : false;

  // ── Open reset ─────────────────────────────────────────────────
  //
  // The drawer mirrors the old openCreate/openEdit: every open synchronously
  // re-seeds the form from the member DTO (or the empty create form) before
  // the dialog paints, and clears validation/error/quota state. Render-phase
  // state adjustment keeps that in the same commit as the opening click.
  const [prevRequest, setPrevRequest] = useState({ open, member });
  if (prevRequest.open !== open || prevRequest.member !== member) {
    setPrevRequest({ open, member });
    if (open) {
      setForm(baseFormFor(member));
      setFieldErrors({});
      setError(null);
      setQuotaUpgrade(false);
    }
  }

  // ── Profile + option load (edit opens) ─────────────────────────
  //
  // Same work the old openEdit did inline after the form reset: load the
  // full profile (masked/withheld per the caller's grants) and the
  // workspace/branch/entity options. Read through a ref so the trigger stays
  // exactly "a new open request" — sessionToken/l10n/addToast identities are
  // not effect dependencies here, matching the old one-shot call shape.
  const latest = useRef({ sessionToken, addToast, l10n });
  latest.current = { sessionToken, addToast, l10n };

  useEffect(() => {
    if (!open || !member) {
      return;
    }
    const { sessionToken, addToast, l10n } = latest.current;
    void (async () => {
      try {
        if (!sessionToken) {
          return;
        }
        const [profile, workspaces, storeProfiles, legalEntities] = await Promise.all([
          getStaffProfileScoped(sessionToken, member.id),
          listAllWorkspacesScoped(sessionToken),
          listLocationsScoped(sessionToken),
          listLegalEntitiesScoped(sessionToken),
        ]);
        setForm((prev) => ({
          ...prev,
          dateOfBirth: profile.date_of_birth ?? '',
          phone: profile.phone ?? '',
          nationalIdType: profile.national_id_type ?? '',
          nationalId: profile.national_id ?? '',
          email: profile.email ?? '',
          monthlyTakeHome: profile.monthly_take_home_minor != null
            ? String(profile.monthly_take_home_minor / 100)
            : '',
          emergencyContactName: profile.emergency_contact_name ?? '',
          emergencyContactPhone: profile.emergency_contact_phone ?? '',
          jobTitle: profile.job_title ?? '',
          notes: profile.notes ?? '',
          address: profile.address ?? '',
          language: profile.language ?? '',
          avatar: profile.avatar ?? '',
          taxId: profile.tax_id ?? '',
          nationalIdExpiresAt: profile.national_id_expires_at ?? '',
          emergencyContactRelationship: profile.emergency_contact_relationship ?? '',
          hireDate: profile.hire_date ?? '',
        }));
        setAllWorkspaces(workspaces);
        setBranches(storeProfiles);
        setEntities(legalEntities.filter((e) => e.status === 'active'));
      } catch {
        addToast({ message: requiredLocalized(l10n, 'staff-error-workspaces-failed'), type: 'error' });
        setAllWorkspaces([]);
        setEntities([]);
      }
    })();
  }, [open, member]);

  /** Assignment args derived from the form — `global` ignores both
   * dimensions; `scoped` keeps the explicit all/list per dimension. The
   * ADR #47 resource axis rides along: organization omits the id, a
   * narrowed kind carries it (the backend rejects an id-less narrow pair
   * with a typed error, mirrored by the save-disabled guard below). */
  const assignmentArgsFromForm = (): AssignmentArgs => ({
    scope_mode: form.scopeMode,
    branches_all: form.scopeMode === 'global' ? true : form.branchesAll,
    branch_ids: form.scopeMode === 'global' ? [] : form.branchIds,
    workspaces_all: form.scopeMode === 'global' ? true : form.workspacesAll,
    workspace_keys: form.scopeMode === 'global' ? [] : form.workspaceKeys,
    scope_type: form.resourceScope,
    ...(form.resourceScope === 'organization' ? {} : { scope_id: form.resourceId.trim() }),
  });

  // ── Assignment editor is delegated to RoleAssignmentMatrix ─────
  //
  // It owns the branch/workspace toggle handlers and the wsIcon helper;
  // this component only supplies the form state + option lists.

  // ── Save / Update ──────────────────────────────────────────────

  // handleSave reads form state directly on every invocation — no useCallback
  // needed since it's only used as an onClick handler on a single button.
  //
  // Validation runs BEFORE setSaving(true) to avoid:
  //   (a) calling setSaving(false) twice (once in try, once in finally)
  //   (b) a visible loading flicker (saving → true → false instantly).
  const handleSave = async () => {
    const username = form.username.trim().toLowerCase();
    const displayName = form.displayName.trim();

    // ADR #35 D6: field-level, localized validation of the 9 mandatory
    // fields + shapes. The form cannot submit with any required field
    // missing.
    const errors = validateProfileForm(form, l10n, isEditing);
    if (!form.roleId) {
      errors['roleId'] = l10n.getString('staff-error-role-required');
    }
    if (!isEditing && (!form.pin || form.pin.length < 4)) {
      errors['pin'] = l10n.getString('staff-error-pin-length');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const first = Object.values(errors)[0];
      setError(first ?? null);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    setError(null);
    setQuotaUpgrade(false);
    try {
      if (!sessionToken) {
        setError(l10n.getString('staff-error-save-failed'));
        return;
      }
      const profile = profileArgsFromForm(form);
      if (member) {
        const trimmedPin = form.pin.trim();
        // STAFF-05: profile + workspace assignment are now ONE IPC call —
        // the backend commits both and rolls the profile back if the
        // workspace write fails, so a partial failure can't leave the
        // account half-updated.
        await updateStaffScoped(sessionToken, {
          id: member.id,
          username,
          display_name: displayName,
          role_id: form.roleId,
          // STAFF-09: send the preserved active state unchanged.
          is_active: form.isActive,
          // STAFF-03: rotate PIN only when a new one was entered.
          ...(trimmedPin ? { pin: trimmedPin } : {}),
          // ADR #35 D5 (spec 0048): the assignment scope rides the same
          // atomic update — the backend replaces it inside the transaction.
          assignment: assignmentArgsFromForm(),
          // ADR #35 D6: the profile columns ride the same atomic update.
          profile,
        });
      } else {
        await createStaffScoped(sessionToken, {
          username,
          pin: form.pin,
          display_name: displayName,
          role_id: form.roleId,
          // ADR #35 D6: creation requires the 9 mandatory fields.
          profile,
        });
      }

      onClose();
      addToast({
        type: 'success',
        message: member
          ? l10n.getString('staff-toast-updated', { name: displayName })
          : l10n.getString('staff-toast-created', { name: displayName }),
      });
      await onSaved();
    } catch (err) {
      if (isStaffQuotaLimitError(err)) {
        // C1.1: tier staff limit reached — the banner (message + upgrade CTA)
        // replaces the generic error line.
        setQuotaUpgrade(true);
        setError(null);
      } else {
        setQuotaUpgrade(false);
        setError(l10nErrorMessage(err, l10n, 'staff-error-save-failed'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** C1.1: open the website pricing page so the owner can upgrade the plan. */
  const openUpgradePricing = () => {
    openUpgradePricingPage(locale, 'plus');
  };

  const selectableRoles = taxonomyRoles(roles);
  const hasRoleSelected = selectableRoles.length > 0;
  // The role chosen in the editor — its granted permission keys render as
  // read-only chips so an admin sees exactly what the role can do (0046).
  const selectedRole = selectableRoles.find((r) => r.id === form.roleId) ?? null;

  return (
    <SettingsPopup
      open={open}
      onClose={onClose}
      title={l10n.getString(isEditing ? 'staff-modal-edit-title' : 'staff-modal-add-title')}
      error={error}
      saving={saving}
      onSave={handleSave}
      saveLabel={l10n.getString(isEditing ? 'staff-btn-update' : 'staff-btn-create')}
      saveDisabled={
        !form.username.trim() ||
        !form.displayName.trim() ||
        !form.roleId ||
        (!isEditing && (!form.pin || form.pin.length < 4)) ||
        // ADR #35 D5: a scoped assignment must not save with an empty
        // list dimension — `list` with no ids is a deny, never an
        // implicit "all" (the all/list toggle is the explicit marker).
        (isEditing &&
          form.scopeMode === 'scoped' &&
          ((!form.branchesAll && branches.length > 0 && form.branchIds.length === 0) ||
            (!form.workspacesAll && allWorkspaces.length > 0 && form.workspaceKeys.length === 0))) ||
        // ADR #47: a narrowed resource scope without its id is an
        // invalid pair — the backend would reject it; disable save and
        // let the inline hint explain.
        (isEditing && form.resourceScope !== 'organization' && !form.resourceId.trim())
      }
      cancelLabel={l10n.getString('staff-btn-cancel')}
    >
      {/* C1.1 staff-limit upgrade banner */}
      {quotaUpgrade && (
        <div className="staff-mgmt-quota-banner" role="alert">
          <span>{l10n.getString('staff-error-quota-limit')}</span>
          <Button variant="primary" size="sm" onClick={openUpgradePricing}>
            {l10n.getString('staff-upgrade-cta')}
          </Button>
        </div>
      )}
      {/* Username */}
      <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-username" aria-label={l10n.getString('staff-field-username-aria')}>
        <Localized id="staff-field-username-label">
          <span className="staff-mgmt-label">Username *</span>
        </Localized>
        <Localized id="staff-username-placeholder" attrs={{ placeholder: true }}>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-username"
            value={form.username}
            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
            placeholder="e.g. jane"
            disabled={isEditing}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-gramm="false"
          />
        </Localized>
      </label>

      {/* Display name */}
      <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-name" aria-label={l10n.getString('staff-field-name-aria')}>
        <Localized id="staff-field-name-label">
          <span className="staff-mgmt-label">Display Name *</span>
        </Localized>
        <Localized id="staff-name-placeholder" attrs={{ placeholder: true }}>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-name"
            value={form.displayName}
            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="e.g. Jane Smith"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-gramm="false"
          />
        </Localized>
      </label>

      {/* PIN */}
      <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-pin" aria-label={l10n.getString('staff-field-pin-aria')}>
        <Localized id={isEditing ? 'staff-field-pin-edit-label' : 'staff-field-pin-label'}>
          <span className="staff-mgmt-label">
            {isEditing ? 'New PIN (leave blank to keep current)' : 'PIN * (4+ characters)'}
          </span>
        </Localized>
        <Localized id={isEditing ? 'staff-pin-edit-placeholder' : 'staff-pin-placeholder'} attrs={{ placeholder: true }}>
                  <input
                    className="staff-mgmt-input"
                    type="password"
                    id="staff-field-pin"
                    value={form.pin}
                    onChange={(e) => setForm((prev) => ({ ...prev, pin: e.target.value }))}
                    placeholder={isEditing ? 'Leave blank to keep current' : 'Enter PIN'}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-gramm="false"
                  />
        </Localized>
      </label>

            {/* Role selector — disabled for incomplete profiles (ADR #35
                D6: management-role assignment requires a complete
                profile) */}
            {hasRoleSelected && (
              <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-role">
                <Localized id="staff-field-role-label">
                  <span className="staff-mgmt-label">Role *</span>
                </Localized>
                <SettingsSelect
                  id="staff-field-role"
                  value={form.roleId}
                  disabled={editingIncomplete}
                  onChange={(value) => setForm((prev) => ({ ...prev, roleId: value }))}
                  options={selectableRoles.map((r) => ({ value: r.id, label: `${r.name} — ${r.description}` }))}
                  placeholder={l10n.getString('staff-role-select-default')}
                  ariaLabel={l10n.getString('staff-field-role-label')}
                />
              </label>
            )}

            {/* Granted permission keys for the selected role (0046) —
                read-only chips; the backend list_roles_scoped carries
                them verbatim from the role's permissions JSON. */}
            {selectedRole && selectedRole.permissions.length > 0 && (
              <div className="staff-mgmt-role-permissions">
                <Localized id="staff-role-permissions-label">
                  <span className="staff-mgmt-role-permissions-label">Role permissions</span>
                </Localized>
                <div
                  className="staff-mgmt-role-permissions-chips"
                  role="list"
                  aria-label={l10n.getString('staff-role-permissions-label')}
                >
                  {selectedRole.permissions.map((p) => (
                    <span key={p} className="staff-mgmt-role-permission-chip" role="listitem">{p}</span>
                  ))}
                </div>
              </div>
            )}

      {/* ── Profile section (ADR #35 D6) ──────────────────────── */}
      {editingIncomplete && (
        <p className="staff-mgmt-incomplete-hint" role="note">
          <Localized id="staff-profile-incomplete-edit-hint">
            <span>Complete this member&apos;s profile to unlock role and workspace assignment.</span>
          </Localized>
        </p>
      )}
      <fieldset className="staff-mgmt-profile-section">
        <Localized id="staff-profile-section-label">
          <legend className="staff-mgmt-label">Profile</legend>
        </Localized>

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-dob" aria-label={l10n.getString('staff-field-dob-aria')}>
          <Localized id="staff-field-dob-label">
            <span className="staff-mgmt-label">Date of Birth *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="date"
            id="staff-field-dob"
            value={form.dateOfBirth}
            onChange={(e) => setForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
          />
        </label>
        {fieldErrors['dateOfBirth'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['dateOfBirth']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-phone" aria-label={l10n.getString('staff-field-phone-aria')}>
          <Localized id="staff-field-phone-label">
            <span className="staff-mgmt-label">Phone *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="tel"
            id="staff-field-phone"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="+62 812 3456 7890"
          />
        </label>
        {fieldErrors['phone'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['phone']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-national-id-type" aria-label={l10n.getString('staff-field-national-id-type-aria')}>
          <Localized id="staff-field-national-id-type-label">
            <span className="staff-mgmt-label">National ID Type *</span>
          </Localized>
          <select
            className="staff-mgmt-input"
            id="staff-field-national-id-type"
            value={form.nationalIdType}
            onChange={(e) => setForm((prev) => ({ ...prev, nationalIdType: e.target.value }))}
          >
            <option value="">{l10n.getString('staff-national-id-type-select')}</option>
            <option value="ssn">{l10n.getString('staff-national-id-type-ssn')}</option>
            <option value="nik">{l10n.getString('staff-national-id-type-nik')}</option>
          </select>
        </label>
        {fieldErrors['nationalIdType'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['nationalIdType']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-national-id" aria-label={l10n.getString('staff-field-national-id-aria')}>
          <Localized id="staff-field-national-id-label">
            <span className="staff-mgmt-label">National ID *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-national-id"
            value={form.nationalId}
            onChange={(e) => setForm((prev) => ({ ...prev, nationalId: e.target.value }))}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        {fieldErrors['nationalId'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['nationalId']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-email" aria-label={l10n.getString('staff-field-email-aria')}>
          <Localized id="staff-field-email-label">
            <span className="staff-mgmt-label">Email *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="email"
            id="staff-field-email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="name@example.com"
            autoComplete="off"
          />
        </label>
        {fieldErrors['email'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['email']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-pay" aria-label={l10n.getString('staff-field-pay-aria')}>
          <Localized id="staff-field-pay-label">
            <span className="staff-mgmt-label">Monthly Take-Home Pay *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-pay"
            value={form.monthlyTakeHome}
            onChange={(e) => setForm((prev) => ({ ...prev, monthlyTakeHome: e.target.value }))}
            inputMode="decimal"
            placeholder="5000000"
          />
        </label>
        {fieldErrors['monthlyTakeHome'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['monthlyTakeHome']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-emergency-name" aria-label={l10n.getString('staff-field-emergency-name-aria')}>
          <Localized id="staff-field-emergency-name-label">
            <span className="staff-mgmt-label">Emergency Contact *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-emergency-name"
            value={form.emergencyContactName}
            onChange={(e) => setForm((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
            autoComplete="off"
          />
        </label>
        {fieldErrors['emergencyContactName'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['emergencyContactName']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-emergency-phone" aria-label={l10n.getString('staff-field-emergency-phone-aria')}>
          <Localized id="staff-field-emergency-phone-label">
            <span className="staff-mgmt-label">Emergency Contact Phone *</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="tel"
            id="staff-field-emergency-phone"
            value={form.emergencyContactPhone}
            onChange={(e) => setForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
            placeholder="+62 812 3456 7890"
          />
        </label>
        {fieldErrors['emergencyContactPhone'] && (
          <span className="staff-mgmt-field-error" role="alert">{fieldErrors['emergencyContactPhone']}</span>
        )}

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-job-title" aria-label={l10n.getString('staff-field-job-title-aria')}>
          <Localized id="staff-field-job-title-label">
            <span className="staff-mgmt-label">Job Title</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-job-title"
            value={form.jobTitle}
            onChange={(e) => setForm((prev) => ({ ...prev, jobTitle: e.target.value }))}
          />
        </label>

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-notes" aria-label={l10n.getString('staff-field-notes-aria')}>
          <Localized id="staff-field-notes-label">
            <span className="staff-mgmt-label">Notes</span>
          </Localized>
          <textarea
            className="staff-mgmt-input"
            id="staff-field-notes"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </label>

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-address" aria-label={l10n.getString('staff-field-address-aria')}>
          <Localized id="staff-field-address-label">
            <span className="staff-mgmt-label">Address</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-address"
            value={form.address}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
          />
        </label>

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-tax-id" aria-label={l10n.getString('staff-field-tax-id-aria')}>
          <Localized id="staff-field-tax-id-label">
            <span className="staff-mgmt-label">Tax ID</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="text"
            id="staff-field-tax-id"
            value={form.taxId}
            onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))}
          />
        </label>

        <label className="staff-mgmt-field staff-mgmt-field--horizontal" htmlFor="staff-field-hire-date" aria-label={l10n.getString('staff-field-hire-date-aria')}>
          <Localized id="staff-field-hire-date-label">
            <span className="staff-mgmt-label">Hire Date</span>
          </Localized>
          <input
            className="staff-mgmt-input"
            type="date"
            id="staff-field-hire-date"
            value={form.hireDate}
            onChange={(e) => setForm((prev) => ({ ...prev, hireDate: e.target.value }))}
          />
        </label>
      </fieldset>

      {/* ── Assignment Access Section (edit only, ADR #35 D5) ── */}
      {isEditing && (
        <RoleAssignmentMatrix
          form={form}
          setForm={setForm}
          branches={branches}
          allWorkspaces={allWorkspaces}
          entities={entities}
          disabled={editingIncomplete}
        />
      )}
    </SettingsPopup>
  );
}
