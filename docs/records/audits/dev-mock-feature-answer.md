# The dev-mock answers `get_enabled_features` with a list matching no preset (round 129)

## What round 128's fix exposed

After gating the sidebar's Kitchen Display row on `FEATURES.KITCHEN_DISPLAY`, the row
disappeared from the running app. That prompted the right question: is the fix wrong, or is
the feature genuinely off?

**The feature is genuinely off.** The dev-mock answers:

```ts
// ui/src/dev-mock/handlers/system.ts:744
'get_enabled_features': () => ({ features: ['sales', 'inventory', 'reporting', 'staff', 'settings'] }),
```

## Why that list is wrong

The same file carries `MOCK_PRESET_FEATURE_KEYS` (`:362-410`), documented as *"a MIRROR of
`FeatureRegistry::{simple_retail, restaurant, full_store, custom}` in
`crates/kasirmu-core/src/features.rs:304-414`"*. Its `restaurant` entry (`:372-383`) is:

```
cash-payment, categories-enabled, discount-engine, inventory-tracking, kitchen-display,
receipt-printing, restaurant, staff-login, table-management, tax-engine
```

The hardcoded answer shares **not one** of those ten keys. It is the only occurrence of that
string in the tree, so it is not derived from any preset.

| | |
|---|---|
| Workspace the mock serves | `restaurant-pos` (`handlers/workspaces.ts:73`, `mockSeedData.ts:210`) |
| Features the mock reports | `sales, inventory, reporting, staff, settings` |
| Restaurant-preset features | **10 of 10 absent** |

## The real backend does not do this

`kasirmu-bridge/src/setup.rs:208-215` answers from the FeatureRegistry:

```rust
pub async fn get_enabled_features(...) { ... .enabled_features() ... }
```

pinned by `setup_tests.rs:322` (*enabled_features_reads_the_feature_registry*). So a provisioned
restaurant store answers with its own preset's keys. **This is a dev-mock stand-in that does
not reflect the preset it is standing in for**, not a product defect.

## What it costs

Anything feature-gated silently takes the disabled branch in the preview and in E2E: the KDS
row (found here), Table Management, discount-engine, receipt-printing, tax-engine and
`cash-payment`. Most are consulted in few places, which is why the POS still looks functional —
but a preview that disagrees with production about which features are on is exactly the
misleading-preview shape `catalog.ts:104-115` describes for a different fixture:

> *A screen exercising optimistic UI, a filter, or a count then looks correct in the preview
> and is untestable against it.*

## NOT fixed, and why

The repair is to answer from `MOCK_PRESET_FEATURE_KEYS` for the store's preset rather than from
a literal. That is a small edit, but it changes which surfaces the preview and the E2E specs
exercise — `table-management` and `kitchen-display` among them — so specs written against the
current answer could start failing for a reason unrelated to their subject.

It also needs a decision this record cannot make alone: which preset the mock store should
claim. The workspace is `restaurant-pos`, so `restaurant` is the obvious answer, but the same
mock also serves the Retail POS workspace from one store row, and enabling the restaurant set
would disable the retail-only ones (`barcode-scanning`, `simple-retail`). The mock's single
store serving two differently-provisioned workspaces is the underlying limitation.

## Verified

| Item | Result |
|---|---|
| Mock answer | `system.ts:744`, 5 keys, matches no preset |
| Restaurant preset | `system.ts:372-383`, 10 keys, none shared |
| Real backend | `setup.rs:208-215` reads the FeatureRegistry |
| Live sidebar rows | 6; KDS absent because the feature is off |
| Round 128's fix | behaving correctly, not over-correcting |