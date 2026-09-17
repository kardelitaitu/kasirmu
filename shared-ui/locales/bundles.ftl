# shared-ui/locales/bundles.ftl — Product bundle management

bundles-title = Product Bundles
bundles-add = Add Bundle
bundles-no-bundles = No bundles yet.
bundles-name = Name
bundles-sku = Bundle SKU
bundles-price = Price
bundles-items = Items
bundles-active = Active
bundles-edit = Edit
bundles-delete = Delete
bundles-description = Description
bundles-add-item = + Add Item
bundles-cancel = Cancel
bundles-create = Create
bundles-save = Update
bundles-table-aria = Product bundles
bundles-actions-aria =
    .aria-label = Actions
bundles-toggle-aria =
    .aria-label = { $state ->
        [active] Deactivate bundle
       *[inactive] Activate bundle
    }
bundles-toggle-active = Active
bundles-toggle-inactive = Inactive
bundles-edit-aria =
    .aria-label = Edit { $name }
bundles-delete-aria =
    .aria-label = Delete { $name }
bundles-sku-placeholder =
    .placeholder = e.g. GIFT-BOX
bundles-name-placeholder =
    .placeholder = e.g. Gift Box
bundles-description-placeholder =
    .placeholder = Optional description
bundles-price-placeholder =
    .placeholder = Leave empty to use sum of items
bundles-item-sku-field =
    .placeholder = SKU
    .aria-label = Item { $number } SKU
bundles-item-qty-field =
    .placeholder = Qty
    .aria-label = Item { $number } quantity
bundles-item-price-field =
    .placeholder = Price override
    .aria-label = Item { $number } unit price override
bundles-item-remove-aria =
    .aria-label = Remove item { $number }
bundles-error-invalid-price = Bundle price must be a whole, non-negative number
bundles-error-invalid-item = Item quantities and prices must be whole numbers
bundles-error-save = Failed to save bundle
bundles-error-delete = Failed to delete bundle
