//! InventoryThresholdsScreen — Inventory → Low-Stock Thresholds.
//!
//! Composition, following the pattern used by every mount since round 155: the route lives
//! here, the feature keeps its own component and stylesheet.
//!
//! ROUND 168 mounted this. `ThresholdConfigScreen` is the SOLE consumer of
//! `getStockThresholds` / `setStockThreshold` / `deleteStockThreshold`, and all three are
//! registered on BOTH shells (desktop lib.rs:1545-1547, tablet lib.rs:1491-1493) -- so this is
//! a missing route, not a shell asymmetry, and not dead code: it is a working feature with no
//! door (recorded as FORGOTTEN in todo-orphan-module-dispositions.md).
//!
//! No new copy: its 23 `inv-threshold-*` keys live in inventory.ftl / inventory.id.ftl and were
//! never removed.

import ThresholdConfigScreen from './ThresholdConfigScreen';

/** Inventory → Low-Stock Thresholds: per-product, per-location reorder points. */
export function InventoryThresholdsScreen() {
  return <ThresholdConfigScreen />;
}
