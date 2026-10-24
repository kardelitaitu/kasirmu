//! InventoryThresholdsScreen — Inventory → Low-Stock Thresholds.
//!
//! Composition, following the pattern used by every mount since round 155: the route lives
//! here, the feature keeps its own component and stylesheet.
//!
//! ROUND 168 mounted this, and it is the door. `ThresholdConfigScreen` is the SOLE consumer of
//! `getStockThresholds` / `setStockThreshold` / `deleteStockThreshold`, and all three are
//! registered on BOTH shells (desktop lib.rs:1545-1547, tablet lib.rs:1491-1493) -- so this was
//! a missing route rather than a shell asymmetry or dead code.
//!
//! CORRECTION 2026-10-25 (round 174): this header used to end "it is a working feature with no
//! door (recorded as FORGOTTEN in todo-orphan-module-dispositions.md)". That was already false
//! when it was written -- `inventory/register.tsx` registers route `inventory-thresholds` and a
//! nav item at :53-62, and `registerInventoryFeature()` is called from `features/index.ts`. A
//! reader arriving here first was told the opposite of the truth about the file they were
//! reading. Left in place by round 173's audit, which found the mismatch but had another
//! subject.
//!
//! No new copy: its 23 `inv-threshold-*` keys live in inventory.ftl / inventory.id.ftl and were
//! never removed.

import ThresholdConfigScreen from './ThresholdConfigScreen';

/** Inventory → Low-Stock Thresholds: per-product, per-location reorder points. */
export function InventoryThresholdsScreen() {
  return <ThresholdConfigScreen />;
}
