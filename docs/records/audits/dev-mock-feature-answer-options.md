# The mock's feature answer: why it cannot be fixed by pointing at a preset (round 130)

## What round 129 left open, and what closes it

`dev-mock-feature-answer.md` recorded that `get_enabled_features` (`system.ts:744`) answers with
`['sales','inventory','reporting','staff','settings']`, matching no preset, and proposed
answering from `MOCK_PRESET_FEATURE_KEYS` instead. It listed one blocker: the mock serves one
store to two differently-provisioned workspaces. **That blocker is real, and there is a second
one this round measured.**

## The live list is not a preset — it is a literal

Checked exhaustively against all six presets in the table:

| Preset | Keys | Exact match for the live list |
|---|---|---|
| `simple-retail` | 7 | no |
| `restaurant` | 10 | no |
| `full-store` | 27 | no |
| `cafe` | 10 | no |
| `franchise` | 21 | no |
| `custom` | 0 | no |

So the answer is not a stale copy of any preset — it is a hand-written list with no derivation
at all. That is why the mismatch is total rather than partial: `restaurant` shares **zero** of
its ten keys with it.

## The blocker, measured

`mockSeedData.ts:209-213` binds **all five** workspace instances to one store:

```
ws-1  store-pos       store-1
ws-2  restaurant-pos  store-1
ws-3  kds             store-1
ws-4  warehouse       store-1
ws-5  admin           store-1
```

In the real product a feature set is a property of the STORE's provisioning, not of a
workspace: `features.rs:427` `preset_registry(slug)` returns a `FeatureRegistry`, and
`kasirmu-bridge/src/setup.rs:208-215` reads `.enabled_features()` off it. One store, one preset,
shared by its workspaces.

That means the mock's single `store-1` **has exactly one correct answer**, and no per-workspace
answer exists to give. Choosing `restaurant` would disable the retail-only keys
(`barcode-scanning`, `simple-retail`) for the Store POS workspace; choosing `simple-retail` would
disable `kitchen-display` and `table-management` for the restaurant one. The mock cannot satisfy
both because it is one store pretending to be five.

## The store declares no preset at all

`get_first_run_state` (`system.ts:528-539`) reports the provisioned store as:

```ts
{ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1',
  mode: 'local', home_region: 'global', tenant_id: null }
```

**No preset field.** So there is nothing in the mock's own state for
`get_enabled_features` to read a preset from — the fix round 129 proposed has no operand.

## What a real fix would take

Not a re-derivation but a decision about what the mock store IS, plus the state to carry it:

1. **give the store a preset.** Add it to the first-run state (or the seed) and answer
   `get_enabled_features` from `MOCK_PRESET_FEATURE_KEYS[preset]`. One store, one preset, honest
   about which workspace types are fully exercised in the preview.
2. **or make the mock multi-store.** One `store-N` per workspace instance, each with its own
   preset. This is the faithful model and the larger change: every handler that resolves a
   store or location would need the workspace in scope.

Option 1 is small and makes the preview internally consistent. Option 2 makes it faithful. Both
are decisions about which surfaces the preview and E2E are for, which is why two rounds have
left this recorded rather than patched.

## Why not option 1 now

It changes which features are ON in the preview, so every feature-gated assertion in the E2E
specs re-evaluates. Round 129 raised that; this round adds that the choice also silently decides
which workspace type gets a COMPLETE preview — a `restaurant` store makes the Store POS preview
partial, and vice versa. Picking one without knowing which preview the team relies on risks
degrading the instrument that found rounds 118-120's findings.

## Verified

| Item | Result |
|---|---|
| Live list vs every preset | matches none of six |
| Shared keys with `restaurant` | 0 of 10 |
| Workspace-to-store binding | all five -> `store-1` |
| Real feature scoping | per store (`preset_registry` -> `FeatureRegistry`) |
| Store's own preset | not recorded in the mock at all |
| Tree | no source changed this round |