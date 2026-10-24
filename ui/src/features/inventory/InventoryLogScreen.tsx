//! InventoryLogScreen — Inventory → Transaction Log.
//!
//! Composition, following the settings-screen pattern (DataManagementScreen:5-7,
//! EmailReportsScreen, AppearanceScreen, LocalApiScreen): the route lives here, and the
//! feature keeps its own component and stylesheet.
//!
//! ROUND 161 mounted this. `TransactionLogScreen` is the SOLE consumer of
//! `listInventoryTransactions` / `getInventoryTransaction`, and every command it uses is
//! registered on BOTH shells (desktop lib.rs:1541-1544, tablet lib.rs:1487-1490) -- a pure
//! mounting gap, not a shell asymmetry. The screen was dropped when the inventory workspace
//! was reorganised; the craft survived, the route did not.
//!
//! No new copy: its 27 `inv-log-*` FTL keys live in `inventory.ftl` / `inventory.id.ftl`
//! and were never removed, so this needed a route and nothing else.
//!
//! The composed screen renders its own title (`inv-log-title`) and its own `.log-container`,
//! so this shell deliberately adds neither -- a second heading would duplicate it, the same
//! ambiguity the tax screen hit before it grew its `embedded` prop.

import TransactionLogScreen from './TransactionLogScreen';

/** Inventory → Transaction Log: the per-location audit trail of stock movements. */
export function InventoryLogScreen() {
  return <TransactionLogScreen />;
}
