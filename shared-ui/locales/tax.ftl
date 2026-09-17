# shared-ui/locales/tax.ftl — Tax configuration

tax-config-title = Tax Configuration
tax-config-add = Add Tax Rate
tax-config-empty = No tax rates configured
tax-config-col-name = Name
tax-config-col-rate = Rate (%)
tax-config-modal-title = { $editing ->
    [true] Edit Tax Rate
   *[other] Add Tax Rate
}
tax-config-field-name = Tax Name
tax-config-field-rate = Rate (%)
tax-config-btn-cancel = Cancel
tax-config-btn-save = Save
tax-config-btn-delete = Delete
tax-config-col-type = Type
tax-config-col-actions =
    .aria-label = Actions
tax-config-table-aria = Tax rates
tax-config-cat-table-aria = Category tax rates
tax-config-col-default = Default
tax-config-col-category = Category
tax-config-col-assigned = Assigned Tax Rates
tax-config-default-badge = Default
tax-config-type-inclusive = Inclusive
tax-config-type-exclusive = Exclusive
tax-config-yes = Yes
tax-config-edit = Edit
tax-config-edit-aria =
    .aria-label = Edit { $name }
tax-config-delete-aria =
    .aria-label = Delete { $name }
tax-config-cat-title = Category Tax Rates
tax-config-cat-desc = Assign default tax rates to product categories. Products inherit their category&rsquo;s tax rates unless overridden at the product level.
tax-config-no-categories = No categories available.
tax-config-no-rates-assigned = No rates assigned
tax-config-cat-edit-aria =
    .aria-label = Edit tax rates for { $name }
tax-config-field-name-placeholder = e.g. Sales Tax
tax-config-field-rate-placeholder = 825
tax-config-rate-hint = Enter rate in basis points (e.g. 825 = 8.25%)
tax-config-tax-type = Tax Type
tax-config-tax-type-aria = Tax type
tax-config-type-exclusive-label = Exclusive
tax-config-type-exclusive-desc = Added at checkout
tax-config-type-inclusive-label = Inclusive
tax-config-type-inclusive-desc = Included in price
tax-config-set-default = Set as default tax rate
tax-config-cat-modal-title = Tax Rates &mdash; { $name }
tax-config-cat-modal-desc = Select the tax rates that apply to all products in this category.
tax-config-no-rates = No tax rates available. Create one first.
tax-config-save-error = Failed to save tax rate
tax-config-delete-error = Failed to delete tax rate
tax-config-cat-save-error = Failed to save category tax rates
tax-config-load-error = Failed to load tax configuration.
tax-config-load-retry = Retry
tax-config-rate-invalid = Rate must be between 0 and { $max } basis points.
tax-config-delete-confirm-title = Delete { $name }?
tax-config-delete-confirm-message = Archive “{ $name }”? This hides it from listings and removes its product/category assignments. Historical sales keep their rate linkage.
tax-config-delete-blocked-title = Cannot delete { $name }
tax-config-delete-blocked-message = “{ $name }” is referenced by { $count } historical sale(s) and cannot be archived. Rates used by past sales are kept so receipts and audit records stay intact.
tax-config-delete-deps-products = { $count ->
    [one] 1 product assignment
   *[other] { $count } product assignments
}
# F1: scope provenance badge (resolver walks Location → Legal entity → Global)
tax-config-scope-location = Location · { $id }
tax-config-scope-legal-entity = Legal entity · { $id }
tax-config-scope-global = Global
# F1: scope + validity-window authoring
tax-config-field-legal-entity = Legal entity id
tax-config-field-legal-entity-placeholder = e.g. default:default-legal-entity
tax-config-field-location = Location id
tax-config-field-location-placeholder = e.g. default
tax-config-scope-hint = Fill one scope arm — or neither for the tenant-global tier.
tax-config-field-from = Effective from
tax-config-field-to = Effective to (exclusive)
tax-config-tier-change-warning = Moving this rate to another tier leaves the vacated tier without a default — author a replacement there first.
# F1: delete-refusal remedy dialog (last-covering-row guard)
tax-config-delete-refusal-title = Cannot delete { $name }
tax-config-delete-refusal-message = “{ $name }” is the last rate covering its tier — deleting it would leave that tier without tax. Author a replacement covering the same scope first, then delete.
tax-config-delete-refusal-replace = Create replacement
tax-config-delete-deps-categories = { $count ->
    [one] 1 category assignment
   *[other] { $count } category assignments
}

# E1-8: per-rate rounding provenance (statutory directive vs store preference)
tax-config-rounding-statutory = Rounding: { $mode } (statutory)
tax-config-rounding-preference = Rounding: { $mode } (store preference)

# E1-6: per-rate rounding authoring (device-global arm only; scoped rows are hub-authored)
tax-config-rounding-label = Rounding Mode
tax-config-rounding-aria = Rounding mode
tax-config-rounding-preference-option = Store preference ({ $mode })
tax-config-rounding-scoped-readonly = Scoped rates are authored at the hub — rounding is read-only here.
