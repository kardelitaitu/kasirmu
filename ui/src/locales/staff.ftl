# ui/src/locales/staff.ftl — Staff management

staff-title = Staff
staff-add-button = Add Staff
staff-empty = No staff members yet.
staff-empty-cta = Add your first staff member
staff-col-name = Name
staff-col-username = Username
staff-col-role = Role
staff-col-status = Status
staff-col-workspace = Workspace
staff-col-actions =
    .aria-label = Actions
staff-status-active = Active
staff-status-inactive = Inactive
staff-edit = Edit
staff-edit-aria =
    .aria-label = Edit { $name }
staff-deactivate = Deactivate
staff-deactivate-aria =
    .aria-label = Deactivate { $name }
staff-restore = Restore
staff-restore-aria =
    .aria-label = Reactivate { $name }
staff-modal-add-title = Add Staff Member
staff-modal-edit-title = Edit Staff Member
staff-field-username-label = Username *
staff-username-placeholder =
    .placeholder = e.g. jane
staff-field-name-label = Display Name *
staff-name-placeholder =
    .placeholder = e.g. Jane Smith
staff-field-pin-edit-label = New PIN (leave blank to keep current)
staff-field-pin-label = PIN * (4+ characters)
staff-pin-edit-placeholder =
    .placeholder = Leave blank to keep current
staff-pin-placeholder =
    .placeholder = Enter PIN
staff-field-role-label = Role *
staff-role-permissions-label = Role permissions
staff-role-select-default = Select a role…
staff-btn-cancel = Cancel
staff-btn-update = Update
staff-btn-create = Create
staff-error-username-required = Username is required
staff-error-display-name-required = Display name is required
staff-error-role-required = Please select a role
staff-error-pin-length = PIN must be at least 4 characters
staff-error-save-failed = Failed to save staff member
# C1.1: subscription tier staff-user limit reached (Free 1 / Plus 5 / Pro 20).
staff-error-quota-limit = Your plan allows a limited number of staff. Upgrade to add more team members.
staff-upgrade-cta = Upgrade plan
staff-error-workspaces-failed = Failed to load workspace settings
staff-table-aria = Staff members
staff-field-username-aria = Username
staff-field-name-aria = Display Name
staff-field-pin-aria = PIN
staff-error-load = Failed to load staff data
staff-retry = Retry

# ── Workspace Data Unavailable (STAFF-08) ────────────────────────────────
staff-workspaces-unavailable = Workspace data unavailable
staff-workspaces-unavailable-hint = Could not load workspace assignments. Staff data below is still current.

# ── Deactivate Confirmation (STAFF-10) ───────────────────────────────────
staff-deactivate-confirm-title = Deactivate staff member?
staff-deactivate-confirm-body = This will remove { $name }'s access to all stores immediately. They can be reactivated later. Continue?
staff-deactivate-confirm-confirm = Deactivate
staff-deactivate-confirm-cancel = Cancel

# ── Toast Notifications ───────────────────────────────────────────────────
staff-toast-created = { $name } created successfully
staff-toast-updated = { $name } updated successfully
staff-toast-deactivated = { $name } deactivated
staff-toast-restored = { $name } restored

# ── Assignment Access (ADR #35 D5 / spec 0048) ──────────────────────────
staff-assignment-section-label = Assignment Access
staff-assignment-global = All branches & workspaces
staff-assignment-scoped = Restrict by branch or workspace
staff-assignment-branches-label = Branches
staff-assignment-workspaces-label = Workspaces
staff-assignment-all-branches = All branches
staff-assignment-all-workspaces = All workspaces
staff-assignment-all-workspaces-short = All

# ── Assignment Resource Scope (ADR #47 ruling 1A) ──────────────────────
staff-assignment-resource-label = Resource scope
staff-assignment-resource-organization = Organization-wide (all locations)
staff-assignment-resource-legal-entity = Legal entity
staff-assignment-resource-location = Location
staff-assignment-resource-location-select = Choose a location
staff-assignment-resource-entity-select = Choose a legal entity
staff-assignment-resource-empty-hint = No matching resources available.
staff-assignment-resource-required-hint = Choose a resource to scope this assignment.

# ── Staff Login ──────────────────────────────────────────────────────────
staff-login-step-username = Enter your username
staff-login-progress-aria = Login progress
staff-login-username-placeholder =
    .placeholder = Username
staff-login-username-aria =
    .aria-label = Username
staff-login-next = Next
staff-login-pin-section-aria = PIN entry — type digits on your keyboard or use the on-screen keypad
staff-login-pin-aria = PIN entry: { $length } of { $max } digits
staff-login-keypad-aria = Numeric keypad
staff-login-clear = Clear
staff-login-clear-aria =
    .aria-label = Clear
staff-login-backspace-aria =
    .aria-label = Backspace
staff-login-digit-aria =
    .aria-label = { $digit }
staff-login-submit = Login
staff-login-submitting = Logging in…
staff-login-error-connection = Could not verify username. Check your connection.
staff-login-pin-min-length = PIN must be at least 4 digits.
staff-login-back = ← Back
staff-login-copyright = © 2026 OZ-POS. All rights reserved.
staff-login-attempts-remaining = ({ $count } attempt{ $count -> [1] { "" } *{ "s" } } remaining)
staff-login-lockout = Locked out. Try again in { $seconds }s

# ── Fast User Switching (ADR #6) ──────────────────────────────────────────

staff-login-close-aria = Close
staff-login-last-login-title = Last login timestamp for this device
# Visible footer text. The English previously read "Last login: " glued to the
# timestamp as bare JSX text, which the audit's scanner initially missed
# because the node is text-then-expression rather than text alone.
staff-login-last-login = Last login: { $time }
staff-login-next-aria = Next

fastpin-switch-user = Switch User
fastpin-active-user = Active: { $name }
fastpin-enter-pin = Enter PIN for { $user }

# ── Session Lock Screen (i18n parity fix) ────────────────────────────────
session-lock-expired = Session expired. Please log in again.
session-lock-invalid-pin = Invalid PIN
session-lock-pin-aria = PIN: { $length } of { $max } digits entered
session-lock-pad-aria = PIN pad
session-lock-lockout = Wait { $seconds }s.

# ── Connection Status (shared between StaffLoginScreen + SessionLockScreen) ──
staff-login-connection-checking = Checking…
staff-login-connection-connected = Connected
staff-login-connection-disconnected = Disconnected
staff-login-connection-auth = Auth
staff-login-connection-sync = Sync

# ── ADR #35 D6 user profile (spec 0049) ─────────────────────────────────

staff-col-id = ID
staff-id-masked-aria = National ID (masked)
staff-profile-incomplete = Profile incomplete
staff-profile-incomplete-edit-hint = Complete this member's profile to unlock role and workspace assignment.
staff-profile-section-label = Profile
staff-field-dob-label = Date of Birth *
staff-field-dob-aria = Date of birth (required)
staff-field-phone-label = Phone *
staff-field-phone-aria = Phone number (required)
staff-field-national-id-type-label = National ID Type *
staff-field-national-id-type-aria = National ID type (required)
staff-national-id-type-select = Select type
staff-national-id-type-ssn = SSN (US)
staff-national-id-type-nik = NIK / KTP (Indonesia)
staff-field-national-id-label = National ID *
staff-field-national-id-aria = National ID number (required)
staff-field-email-label = Email *
staff-field-email-aria = Email address (required)
staff-field-pay-label = Monthly Take-Home Pay *
staff-field-pay-aria = Monthly take-home pay (required)
staff-field-emergency-name-label = Emergency Contact *
staff-field-emergency-name-aria = Emergency contact name (required)
staff-field-emergency-phone-label = Emergency Contact Phone *
staff-field-emergency-phone-aria = Emergency contact phone (required)
staff-field-job-title-label = Job Title
staff-field-job-title-aria = Job title
staff-field-notes-label = Notes
staff-field-notes-aria = Notes
staff-field-address-label = Address
staff-field-address-aria = Address
staff-field-tax-id-label = Tax ID
staff-field-tax-id-aria = Tax ID
staff-field-hire-date-label = Hire Date
staff-field-hire-date-aria = Hire date

# Per-field validation errors (localized, shown inline)
staff-error-dob-required = Date of birth is required.
staff-error-phone-required = Phone number is required.
staff-error-national-id-type-required = National ID type is required.
staff-error-national-id-required = National ID is required.
staff-error-email-required = Email address is required.
staff-error-pay-required = Monthly take-home pay is required.
staff-error-emergency-name-required = Emergency contact name is required.
staff-error-emergency-phone-required = Emergency contact phone is required.
staff-error-email-invalid = Enter a valid email address.
staff-error-phone-invalid = Phone must be in +country number format.
staff-error-national-id-invalid = National ID must be 9 digits (SSN) or 16 digits (NIK).
staff-error-pay-invalid = Enter a positive amount.
staff-error-dob-invalid = Use YYYY-MM-DD format.

# C2.2: Pro→Premium approaching-limit banner (16+ staff, Pro caps at 20).
staff-limit-approaching-premium = You are nearing the Pro plan's 20-staff limit. Upgrade to Premium for up to 50 staff.
staff-limit-approaching-premium-cta = Upgrade to Premium

# ── Role authoring (ADR #47 ruling 4) ────────────────────────────────
# A custom role is a named permission-set row. The picker is fed by the
# permission registry, so no key name is hardcoded in the UI.
role-authoring-title = Roles
role-authoring-subtitle = Built-in roles are defaults; custom roles are permission sets you author.
role-create = New role
role-create-aria = Create a new custom role
role-list-aria = All roles
role-empty-title = No roles yet
role-badge-builtin = Built-in
role-badge-custom = Custom
role-grant-count = { $count ->
    [one] 1 permission
   *[other] { $count } permissions
  }
role-edit = Edit
role-edit-aria = Edit the { $name } role
role-delete = Delete
role-delete-aria = Delete the { $name } role
role-in-use = { $count ->
    [one] Used by 1 account
   *[other] Used by { $count } accounts
  }
role-editor-create-title = New role
role-editor-edit-title = Edit role
role-field-name = Role name
role-field-description = Role description
role-field-permissions = Permissions
role-perm-sensitive = Sensitive
role-cancel = Cancel
role-cancel-aria = Cancel editing this role
role-save = Save role
role-save-aria = Save this role
role-saved = Saved the { $name } role.
role-deleted = Deleted the { $name } role.
role-delete-confirm-title = Delete this role?
role-delete-confirm-body = Accounts holding { $name } will lose its permissions. This cannot be undone.
