<!-- Acceptance verified 2026-10-25: cd ui && npx vitest run src/__tests__/warehouseShellSplit.test.ts (3/3 passed), commit a004429bc under Ruling 2 (per-location stock read withheld on tablet with warehouse-stock-desktop-only notice). Earned done- prefix per AGENTS.md §7.4. -->
# Warehouse console on the tablet: a live route calling a desktop-only command

> **RESOLVED 2026-10-25 (round 154) by `a004429bc`, under RULING 2 below.** The Count mode and
> the per-location stock read are now withheld on the tablet rather than degraded, and the
> console shows a distinct `warehouse-stock-desktop-only` notice instead of a load error.
> Ruling 1 (register the command on the tablet) remains available if per-location stock is
> ever wanted on the device; nothing here forecloses it. Kept as the record of the measurement.

**Measured 2026-10-25 (round 150) at HEAD `ef7f80ed9`.** Not a hypothesis: the route is
registered for both shells, and the command it loads on mount exists in one.

## The measurement

```
$ grep -rn 'list_warehouse_products_at_location' apps/
apps/desktop-tauri/src/lib.rs:1613          <- desktop ONLY
apps/desktop-tauri/src/commands/products.rs:95

$ grep -rn 'list_warehouse_products' apps/mobile-tauri
apps/mobile-tauri/src/lib.rs:1381: commands::products::list_warehouse_products_scoped,
```

The tablet registers `list_warehouse_products_scoped` and NOT
`list_warehouse_products_at_location`. Meanwhile the warehouse route is live on the tablet:

- `ui/src/features/warehouse/register.tsx:8` registers `route: 'warehouse'`;
- `ui/src/features/index.ts` calls `registerWarehouseFeature()` for BOTH shells
  (`ui/src/App.tsx:8` desktop, `ui/src/main.mobile.tsx:16` tablet);
- `ui/src/app/tablet/TabletAppShell.tsx:103` maps `warehouse: 'warehouse'` as a tablet workspace.

So opening Warehouse on a tablet mounts a screen whose first effect calls a command that
shell does not have. `WarehouseConsole.tsx:112` catches it and sets `loadError`, so the
cashier sees a load-failure state rather than a crash -- which is worse, because it reads
as "the data is broken" rather than "this screen is not for this device".

There is a second call site: `WarehouseCountFlow.tsx:125`.

## CORRECTION 2026-10-25 (round 154): there were TWO call sites, and the count one was live

The measurement above named `WarehouseConsole.tsx:112` and `WarehouseCountFlow.tsx:125` but
described the console as failing on mount. Both sites are real and they are different sizes:

- `WarehouseConsole.tsx` loads products for EVERY mode on mount, so opening Warehouse on a
  tablet failed immediately -- that was the visible symptom.
- `WarehouseCountFlow.tsx:125` fires only when the user opens the Count tab
  (`WarehouseConsole.tsx:588` `onCount` -> `mode === "count"` -> :466), which is a second,
  independent way in that no amount of fixing the first site would have closed.

A round-154 subagent audit of the topology/warehouse cluster reached the same verdict
independently (LIVE_DEFECT, "WarehouseConsole.tsx:466 renders <WarehouseCountFlow> when
mode===count... with no isTabletShell guard anywhere in WarehouseConsole.tsx").

Six sibling topology findings in the same audit are NOT defects: `TopologyScreen.tsx:173-175`
returns a notice and `:847-849` repeats the gate before `NodeTopologyEditor` (:860) and
`TopologyRevisionBrowser` (:1016) mount, so every one of those call sites is unreachable on
the tablet. The gate reports them only because the calls sit in `useCallback` bodies outside
the brace block it walks.

## Why this is not a mechanical fix

The obvious move -- call `list_warehouse_products_scoped` instead -- is WRONG, and the
signatures say why:

| | desktop | tablet |
|---|---|---|
| command | `list_warehouse_products_at_location` | `list_warehouse_products_scoped` |
| args | `session_token`, `location_id` | `session_token` |
| filters by location | **yes** (`store.list_warehouse_products_at_location(location_id)`) | **no** (`store.list_warehouse_products()`) |
| permission | `INVENTORY_ADJUST` | none enforced at the bridge |

They are not twins. The warehouse console shows **per-location stock levels** for the
bound warehouse from the topology editor; the tablet command returns every warehouse
product with no location filter. Substituting one for the other would silently show the
wrong numbers on a counting screen -- the class of defect that survives a screenshot and
is found by an auditor weeks later.

## The two rulings, and what each costs

1. **Register the command on the tablet.** Add `list_warehouse_products_at_location` to
    `apps/mobile-tauri`, with a tablet-native body (the tablet `AppState` cannot build a
    `BridgeCtx` yet, so this means a global-db read taking `location_id` -- the same shape
    as the sibling tablet product commands). Honours the existing UX. Cost: a new tablet
    command, its `INVENTORY_ADJUST` check, and tests.
2. **Gate the warehouse route off the tablet.** Ruling that counting is a back-office
    action, like topology and memo authoring, and showing the same
    `topology-tablet-unavailable`-style notice. Cost: one guard plus copy, and the tablet
    loses a workspace it is currently offered.

Both are defensible. Ruling 2 is smaller and matches three existing precedents (topology,
memo authoring, KDS rule editing); ruling 1 preserves the shipped navigation map. **The one
thing not defensible is leaving it as it is**, because the tablet advertises a workspace
that cannot load.

## What a reader should not conclude

That this is the same class as the `dev-mock` allowlist entries. Those record a command the
UI calls and a shell does not register, with the UI correct for its shell. Here the UI is
wrong for the shell it is running on: no guard, no twin, no notice.

## Filed by

The round-150 lane, while auditing the `verify-scoped-reads --shell tablet` findings by
whether they can actually execute. No file edited for this item; the ruling is an owner
decision, and guessing it would invent policy in the same way note 45 declined to.
