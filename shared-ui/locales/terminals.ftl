# shared-ui/locales/terminals.ftl — Terminal management

terminal-management-title = Terminal Management
terminal-management-empty = No terminals registered yet. Register the first terminal to get started.
terminal-management-error = Failed to load terminals. Please try again.
terminal-management-retry = Retry
terminal-register = Register Terminal
terminal-register-title = Register New Terminal
terminal-edit-title = Edit Terminal
terminal-delete-title = Delete Terminal
terminal-delete-confirm = Are you sure you want to delete terminal "{ $name }"? This action cannot be undone.
terminal-name = Name
terminal-name-label = Terminal name
terminal-name-placeholder =
    .placeholder = e.g. Front Counter
terminal-device-id = Device ID
terminal-device-id-label = Device identifier
terminal-device-id-placeholder =
    .placeholder = e.g. hostname or MAC address
terminal-secret-label = Optional shared secret for sync authentication
terminal-metadata-label = Optional JSON metadata
# Save-handler validation. Key names match the l10n.getString() call sites
# in TerminalManagementScreen verbatim.
terminal-error-name-required = Terminal name is required
terminal-error-device-id-required = Device ID is required
terminal-is-active = Active
terminal-is-inactive = Inactive
terminal-status = Status
terminal-last-seen = Last Seen
terminal-created = Created
terminal-never = Never
terminal-cancel = Cancel
terminal-save = Save
terminal-delete = Delete
terminal-register-action = Register
terminal-edit-action =
    .aria-label = Edit { $name }
terminal-delete-action =
    .aria-label = Delete { $name }
terminal-error-load = Failed to load terminals
terminal-error-overrides-load = Failed to load feature overrides
terminal-error-override-update = Failed to update feature override
terminal-error-override-reset = Failed to reset overrides
terminal-error-save = Failed to save terminal
terminal-field-name-aria = Terminal name
terminal-field-device-id-aria = Device identifier
terminal-field-secret-aria = Shared secret
terminal-field-metadata-aria = JSON metadata
terminal-feature-overrides = Feature Overrides
terminal-overridden = overridden
terminal-override-aria = Override { $feature }
terminal-reset-overrides = Reset all overrides
terminal-col-actions =
    .aria-label = Actions
terminal-table-label = Terminals

# Terminal Status Panel
terminal-status-title = Terminal Status
terminal-status-online-count = { $online } / { $total } online
terminal-status-empty = No terminals registered.
terminal-status-list-aria = Terminal statuses
terminal-status-online = Online
terminal-status-offline = Offline
terminal-status-never = Never
terminal-status-just-now = Just now
terminal-status-minutes-ago = { $n }m ago
terminal-status-hours-ago = { $n }h ago
terminal-status-error-load = Failed to load terminals

# Device binding (ADR #4 Phase 3)
terminal-binding-title = Device Binding
terminal-binding-bound-store = Bound to store:
terminal-binding-signature = Signature
terminal-binding-valid = Valid
terminal-binding-invalid = Invalid / Tampered
terminal-binding-store-label = Store
terminal-binding-instance-label = Workspace Instance
# Conjunction following middot in binding info paragraph (lowercase).
terminal-binding-instance-conjunction = instance:
terminal-binding-select-store = -- Select store --
terminal-binding-select-instance = -- Select instance --
terminal-binding-primary = (Primary)
terminal-binding-update = Update Binding
terminal-binding-bind = Bind Terminal
terminal-binding-clear = Clear Binding
# Failure copy for the three binding mutations, shown in the binding panel.
terminal-error-binding-load = Failed to load the terminal binding.
terminal-error-binding-save = Failed to save the terminal binding.
terminal-error-binding-clear = Failed to clear the terminal binding.

# Feature override counts
terminal-overrides-count = { $count ->
    [one] { $count } override
   *[other] { $count } overrides
}

# C2.2: terminal-limit banner (Plus→Pro trigger).
terminal-limit-reached = You have reached the { $limit }-register limit for your plan. Upgrade to Pro for up to 5 registers per store.
terminal-limit-upgrade-cta = Upgrade to Pro
