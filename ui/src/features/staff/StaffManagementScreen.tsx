import { useState, useCallback, useEffect, useContext } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listStaffScoped,
  listRolesScoped,
  createStaffScoped,
  updateStaffScoped,
  getStaffProfileScoped,
  type StaffMemberDto,
  type RoleDto,
  type ProfileArgs,
  type AssignmentArgs,
  isStaffQuotaLimitError,
} from '@/api/staff';
import { listAllWorkspacesScoped, type WorkspaceTypeDto } from '@/api/workspaces';
import { listLocationsScoped, type LocationProfile } from '@/api/locations';
import { listLegalEntitiesScoped, type LegalEntity } from '@/api/legalEntities';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseMinorUnits } from '@/types/domain';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { openUpgradePricing as openUpgradePricingPage } from '@/utils/upgrade';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized } from '@/frontend/shared';
import { l10nErrorMessage } from '@/utils/app-error';
import { RoleIcon } from '@/components/RoleIcon';
import { useToast } from '@/frontend/shared/Toast';
import { EmptyState } from '@/frontend/shared';
import { NoStaffIcon } from '@/components/EmptyStateIllustrations';
import SettingsSelect from '@/features/settings/SettingsSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import './StaffManagementScreen.css';

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

interface FormData {
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

// ── Component ───────────────────────────────────────────────────────

/** Staff management screen — manage user accounts, roles, PIN codes, and workspace assignments. */
export default function StaffManagementScreen() {
  const { l10n } = useLocalization();
  // C1.1 upgrade link needs the active locale for the pricing URL; tests
  // render without LocaleContext, so default to English there.
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  // C2.2: Pro→Premium trigger — at 16+ staff (Pro caps at 20), nudge the
  // owner toward Premium before they hit the hard limit.
  const { caps } = useSubscription();
  const atProStaffCap = caps?.tier === 'pro' && (caps.staffCount ?? 0) >= 16;
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceTypeDto[]>([]);
  const [workspaceNameMap, setWorkspaceNameMap] = useState<Map<string, string>>(new Map());
  /** Branch picker source — `store_profiles` rows are the branch ids the
   * assignment model scopes on (ADR #35 D5). */
  const [branches, setBranches] = useState<LocationProfile[]>([]);
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  /** STAFF-08: primary staff/roles load failed — show error + retry. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** STAFF-08: workspace data failed to load — staff rows still render. */
  const [workspacesUnavailable, setWorkspacesUnavailable] = useState(false);
  /** STAFF-10: member awaiting deactivation confirmation. */
  const [confirmTarget, setConfirmTarget] = useState<StaffMemberDto | null>(null);
  /** STAFF-10: true while the confirmed deactivation request is in flight. */
  const [deactivating, setDeactivating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** ADR #35 D6: the member being edited has an incomplete profile —
   * management-role and assignment controls are disabled until complete. */
  const [editingIncomplete, setEditingIncomplete] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** C1.1: the last save was rejected by the tier's staff-user limit. */
  const [quotaUpgrade, setQuotaUpgrade] = useState(false);

  // ── Load data

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!sessionToken) {
        return;
      }
      const [staffData, rolesData] = await Promise.all([
        listStaffScoped(sessionToken),
        listRolesScoped(sessionToken),
      ]);
      setStaff(staffData);
      setRoles(rolesData);

      // Load workspace names + branch ids for the table column and the
      // assignment editor. STAFF-08: a workspace failure must NOT hide
      // staff rows — show an explicit "workspace data unavailable" notice
      // instead. The workspace column derives from the DTO assignment
      // (spec 0048), so it only needs the name map, not per-user lookups.
      try {
        const [workspaces, storeProfiles] = await Promise.all([
          listAllWorkspacesScoped(sessionToken),
          listLocationsScoped(sessionToken),
        ]);
        const nameMap = new Map<string, string>();
        for (const w of workspaces) {
          nameMap.set(w.key, w.name);
        }
        setWorkspaceNameMap(nameMap);
        setAllWorkspaces(workspaces);
        setBranches(storeProfiles);
        setWorkspacesUnavailable(false);
      } catch {
        setWorkspacesUnavailable(true);
      }
    } catch (err) {
      // STAFF-08: surface a retryable error instead of swallowing it.
      setLoadError(l10nErrorMessage(err, l10n, 'staff-error-load'));
      setStaff([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n]);

  useEffect(() => { load(); }, [load]);

  // ── Modal handlers

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditingIncomplete(false);
    setFieldErrors({});
    setError(null);
    setQuotaUpgrade(false);
    setShowModal(true);
  }, []);

  const openEdit = useCallback(async (member: StaffMemberDto) => {
    // STAFF-09: preserve the member's current active state so a profile
    // edit never silently reactivates a deactivated account.
    setForm({
      username: member.username,
      displayName: member.display_name,
      pin: '',
      roleId: member.role_id,
      isActive: member.is_active,
      // The assignment editor starts from the member's CURRENT effective
      // assignment (ADR #35 D5 / spec 0048) — global roles show as global,
      // scoped members show their all/list dimensions.
      scopeMode: member.assignment.scope_mode,
      branchesAll: member.assignment.branches_all,
      branchIds: member.assignment.branch_ids,
      workspacesAll: member.assignment.workspaces_all,
      workspaceKeys: member.assignment.workspace_keys,
      resourceScope: member.assignment.scope_type ?? 'organization',
      resourceId: member.assignment.scope_id ?? '',
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
    });
    setEditingId(member.id);
    // ADR #35 D6: incomplete-profile members get management-role and
    // assignment controls disabled until their profile is complete.
    setEditingIncomplete(!member.is_profile_complete);
    setFieldErrors({});
    setError(null);
    setQuotaUpgrade(false);
    setShowModal(true);

    // Load the full profile (masked/withheld per the caller's grants) and
    // the workspace/branch options in parallel.
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
  }, [sessionToken, addToast, l10n]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setFieldErrors({});
    setError(null);
    setQuotaUpgrade(false);
  }, []);

  // ── Assignment editor toggles (ADR #35 D5 / spec 0048) ────────────
  //
  // Each scoped dimension is an explicit `all` or a list — the all/list
  // toggle and the list checkboxes never express an implicit "all".

  const toggleBranch = useCallback((id: string) => {
    setForm((prev) => ({
      ...prev,
      branchIds: prev.branchIds.includes(id)
        ? prev.branchIds.filter((b) => b !== id)
        : [...prev.branchIds, id],
    }));
  }, []);

  const toggleWorkspace = useCallback((key: string) => {
    setForm((prev) => ({
      ...prev,
      workspaceKeys: prev.workspaceKeys.includes(key)
        ? prev.workspaceKeys.filter((k) => k !== key)
        : [...prev.workspaceKeys, key],
    }));
  }, []);

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
    if (!editingId && (!form.pin || form.pin.length < 4)) {
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
      if (editingId) {
        const trimmedPin = form.pin.trim();
        // STAFF-05: profile + workspace assignment are now ONE IPC call —
        // the backend commits both and rolls the profile back if the
        // workspace write fails, so a partial failure can't leave the
        // account half-updated.
        await updateStaffScoped(sessionToken, {
          id: editingId,
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

      closeModal();
      addToast({
        type: 'success',
        message: editingId
          ? l10n.getString('staff-toast-updated', { name: displayName })
          : l10n.getString('staff-toast-created', { name: displayName }),
      });
      await load();
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
  const openUpgradePricing = useCallback(() => {
    openUpgradePricingPage(locale, 'plus');
  }, [locale]);

  // ── Deactivate / Reactivate ────────────────────────────────────

  const performActivate = useCallback(async (member: StaffMemberDto) => {
    try {
      if (!sessionToken) {
        addToast({ message: l10n.getString('staff-error-save-failed'), type: 'error' });
        return;
      }
      await updateStaffScoped(sessionToken, {
        id: member.id,
        username: member.username,
        display_name: member.display_name,
        role_id: member.role_id,
        is_active: !member.is_active,
      });
      addToast({
        type: 'success',
        message: member.is_active
          ? l10n.getString('staff-toast-deactivated', { name: member.display_name })
          : l10n.getString('staff-toast-restored', { name: member.display_name }),
      });
      await load();
    } catch {
      addToast({ message: l10n.getString('staff-error-save-failed'), type: 'error' });
    }
  }, [load, sessionToken, addToast, l10n]);

  // STAFF-10: deactivating an account is high-impact — require an explicit
  // confirmation with the staff member's name before sending the request.
  // Reactivating (restoring) an inactive account needs no confirmation.
  const toggleActive = useCallback((member: StaffMemberDto) => {
    if (member.is_active) {
      setConfirmTarget(member);
    } else {
      void performActivate(member);
    }
  }, [performActivate]);

  const confirmDeactivate = useCallback(async () => {
    if (!confirmTarget) return;
    setDeactivating(true);
    try {
      await performActivate(confirmTarget);
      setConfirmTarget(null);
    } finally {
      setDeactivating(false);
    }
  }, [confirmTarget, performActivate]);

  const cancelDeactivate = useCallback(() => {
    if (deactivating) return;
    setConfirmTarget(null);
  }, [deactivating]);

  // ── Role colour mapping ────────────────────────────────────────

  const roleVariant = (roleName: string): 'warning' | 'info' | 'default' | 'success' => {
    switch (roleName.toLowerCase()) {
      case 'owner':
      case 'role-owner':
      case 'admin':
      case 'role-admin':   return 'warning';
      case 'manager':
      case 'role-manager': return 'info';
      case 'staff':
      case 'role-staff':  return 'default';
      case 'auditor':
      case 'role-auditor': return 'success';
      case 'custom':
      case 'role-custom': return 'default';
      default:             return 'default';
    }
  };

  // ── Render ─────────────────────────────────────────────────────

  const isEditing = editingId !== null;
  const selectableRoles = taxonomyRoles(roles);
  const hasRoleSelected = selectableRoles.length > 0;
  // The role chosen in the editor — its granted permission keys render as
  // read-only chips so an admin sees exactly what the role can do (0046).
  const selectedRole = selectableRoles.find((r) => r.id === form.roleId) ?? null;

  return (
    <div className="staff-mgmt" onContextMenu={(e) => e.preventDefault()}>
      <div className="staff-mgmt-header">
        <Localized id="staff-title">
          <h1 className="staff-mgmt-title">Staff</h1>
        </Localized>
        <Localized id="staff-add-button">
          <Button onClick={openCreate}>Add Staff</Button>
        </Localized>
      </div>

      {/* C2.2: Pro tier near its 20-staff cap — upgrade nudge. */}
      {atProStaffCap && (
        <div className="staff-mgmt-approaching-banner" role="note">
          <span>{l10n.getString('staff-limit-approaching-premium')}</span>
          <Button variant="primary" size="sm" onClick={() => openUpgradePricingPage(locale, 'premium')}>
            {l10n.getString('staff-limit-approaching-premium-cta')}
          </Button>
        </div>
      )}

      {loadError ? (
        <Card shadow="sm">
          <div className="staff-mgmt-load-error" role="alert">
            <p className="staff-mgmt-load-error-message">{loadError}</p>
            <Button onClick={() => load()} variant="secondary">
              <Localized id="staff-retry"><span>Retry</span></Localized>
            </Button>
          </div>
        </Card>
      ) : loading ? (
        <div className="staff-mgmt-loading-skeleton" aria-hidden="true">
          <div className="staff-mgmt-header">
            <Skeleton variant="block" width="6rem" height="1.75rem" />
            <Skeleton variant="block" width="6rem" height="2.25rem" />
          </div>
          <div className="staff-mgmt-table-wrap">
            <table className="staff-mgmt-table">
              <thead>
                <tr>
                  {['Role', 'Workspace', 'Name', 'Username', 'Status', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width="4rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 4 }).map((_, r) => (
                  <tr key={r}>
                    <td><Skeleton variant="block" width="5rem" height="1.25rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="6rem" /></td>
                    <td><Skeleton variant="text" width="7rem" /></td>
                    <td><Skeleton variant="text" width="4rem" /></td>
                    <td><Skeleton variant="text" width="3.5rem" /></td>
                    <td><Skeleton variant="block" width="5rem" height="1.5rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : staff.length === 0 ? (
        <Card shadow="sm">
          <div className="staff-mgmt-empty">
            <EmptyState
              icon={<NoStaffIcon />}
              title={requiredLocalized(l10n, 'staff-empty')}
              action={{ label: requiredLocalized(l10n, 'staff-empty-cta'), onClick: openCreate }}
            />
          </div>
        </Card>
      ) : (
        <div className="staff-mgmt-table-wrap">
          {workspacesUnavailable && (
            <div className="staff-mgmt-ws-unavailable" role="status">
              <Localized id="staff-workspaces-unavailable">
                <strong>Workspace data unavailable</strong>
              </Localized>
              <Localized id="staff-workspaces-unavailable-hint">
                <span>Could not load workspace assignments. Staff data below is still current.</span>
              </Localized>
            </div>
          )}
          <table className="staff-mgmt-table" aria-label={l10n.getString('staff-table-aria')}>
            <thead>
              <tr>
                <Localized id="staff-col-role"><th>Role</th></Localized>
                <Localized id="staff-col-workspace"><th>Workspace</th></Localized>
                <Localized id="staff-col-name"><th>Name</th></Localized>
                <Localized id="staff-col-username"><th>Username</th></Localized>
                <Localized id="staff-col-id"><th>ID</th></Localized>
                <Localized id="staff-col-status"><th>Status</th></Localized>
                <Localized id="staff-col-actions" attrs={{ "aria-label": true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{staff.map((member) => (
                <tr key={member.id} className={!member.is_active ? 'staff-mgmt-row--inactive' : ''}>
                  <td>
                    <Badge variant={roleVariant(member.role_name)}>
                      <span className="staff-mgmt-role-badge-content">
                        <RoleIcon role={member.role_name} size={16} className="staff-mgmt-role-icon" />
                        <span>{member.role_name}</span>
                      </span>
                    </Badge>
                  </td>
                  <td className="staff-mgmt-cell-username">
                    {member.assignment.scope_mode === 'global' || member.assignment.workspaces_all ? (
                      <Localized id="staff-assignment-all-workspaces-short">
                        <span>All</span>
                      </Localized>
                    ) : (
                      member.assignment.workspace_keys
                        .map((k) => workspaceNameMap.get(k) ?? k)
                        .join(', ') || '—'
                    )}
                  </td>
                  <td>
                    <span>{member.display_name}</span>
                    {!member.is_profile_complete && (
                      <Badge variant="warning" className="staff-mgmt-incomplete-badge">
                        <Localized id="staff-profile-incomplete">
                          <span>Profile incomplete</span>
                        </Localized>
                      </Badge>
                    )}
                  </td>
                  <td className="staff-mgmt-cell-username">{member.username}</td>
                  <td className="staff-mgmt-cell-username">
                    <span aria-label={l10n.getString('staff-id-masked-aria')}>
                      {member.national_id_masked}
                    </span>
                  </td>
                  <td>
                    {member.is_active ? (
                      <Localized id="staff-status-active">
                        <span className="staff-mgmt-status-active">Active</span>
                      </Localized>
                    ) : (
                      <Localized id="staff-status-inactive">
                        <span className="staff-mgmt-status-inactive">Inactive</span>
                      </Localized>
                    )}
                  </td>
                  <td>
                    <div className="staff-mgmt-cell-actions">
                    <Localized id="staff-edit-aria" attrs={{ "aria-label": true }} vars={{ name: member.display_name }}>
                      <button
                        type="button"
                        className="staff-mgmt-action-btn"
                        onClick={() => openEdit(member)}

                      >
                        <Localized id="staff-edit"><span>Edit</span></Localized>
                      </button>
                    </Localized>
                    <Localized id={member.is_active ? 'staff-deactivate-aria' : 'staff-restore-aria'} attrs={{ "aria-label": true }} vars={{ name: member.display_name }}>
                      <button
                        type="button"
                        className={`staff-mgmt-action-btn ${member.is_active ? 'staff-mgmt-action-btn--warn' : 'staff-mgmt-action-btn--restore'}`}
                        onClick={() => toggleActive(member)}

                      >
                        <Localized id={member.is_active ? 'staff-deactivate' : 'staff-restore'}>
                          <span>{member.is_active ? 'Deactivate' : 'Restore'}</span>
                        </Localized>
                      </button>
                    </Localized>
                    </div>
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      {/* ── Add/Edit Modal ──────────────────────────────────────── */}
      <SettingsPopup
        open={showModal}
        onClose={closeModal}
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
          <fieldset className="staff-mgmt-ws-section" disabled={editingIncomplete}>
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
        )}
      </SettingsPopup>

      {/* ── Deactivate Confirmation (STAFF-10) ─────────────────── */}
      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={cancelDeactivate}
        onConfirm={() => void confirmDeactivate()}
        title={l10n.getString('staff-deactivate-confirm-title')}
        message={l10n.getString('staff-deactivate-confirm-body', { name: confirmTarget?.display_name ?? '' })}
        variant="danger"
        loading={deactivating}
        confirmLabel={l10n.getString('staff-deactivate-confirm-confirm')}
        cancelLabel={l10n.getString('staff-deactivate-confirm-cancel')}
      />
    </div>
  );
}
