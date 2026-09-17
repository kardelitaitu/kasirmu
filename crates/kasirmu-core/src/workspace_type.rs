//! Workspace type keys — the vertical a workspace instance is licensed for.
//!
//! # Two axes, deliberately separate
//!
//! A terminal's identity is described by two **independent** axes, and reading
//! one as the other is a category error:
//!
//! * **`profile_type`** ([`crate::terminal_profile::TerminalProfile`]) is the
//!   *lockdown* axis — `unrestricted`, `counter_pos`, `kds_kiosk`,
//!   `customer_display`. It answers "how much UI may this device show, and is
//!   navigation restricted?". Its only consumer is `isKdsKiosk`, which forces
//!   the KDS route. Both POS terminals are `counter_pos`, and that is correct:
//!   neither is locked down.
//! * **`type_key`** ([`crate::session::SessionContext`]) is the *vertical*
//!   axis — the keys in this module. It answers "which business surface is this
//!   session licensed for?".
//!
//! So a workspace type is not a terminal profile. Adding `restaurant_pos` or
//! `retail_pos` to `profile_type` would be a category error *and* a migration:
//! the column carries a `CHECK` constraint (`migrations/20260813_init.sql`),
//! so widening it means rebuilding the table.
//!
//! Authorization decisions that need "which vertical is calling" read
//! `SessionContext::type_key`, which `create_session` validates against the
//! licence's `allowed_types` and which is then fixed for the session's
//! lifetime — a sound basis for a decision, unlike a value that arrives afresh
//! on every call.
//!
//! # Why these constants exist
//!
//! These keys are a wire contract with the licence server's `allowed_types`
//! (`apps/license-server`) and with the topology canvas. They were previously
//! spelled as bare literals at a dozen call sites across `kasirmu-core` and
//! `kasirmu-bridge`, where a typo would fail closed in one place and silently widen
//! a quota in another. Spelling them once makes a rename a compile error rather
//! than a hunt.

/// Store POS — the retail counter terminal.
pub const STORE_POS: &str = "store-pos";

/// Restaurant POS — the restaurant counter terminal.
pub const RESTAURANT_POS: &str = "restaurant-pos";

/// Kitchen Display System.
pub const KDS: &str = "kds";

/// Warehouse — the stock-control surface.
pub const WAREHOUSE: &str = "warehouse";

/// Inventory surface.
pub const INVENTORY: &str = "inventory";

/// Back-office administration.
pub const ADMIN: &str = "admin";

/// The two POS terminal verticals, in a stable order.
///
/// Both are registers: they share the per-store register quota
/// (`max_pos_instances`) and the `PosInstances` availability feature, which is
/// why every site that consults that quota or that feature tests them together.
pub const POS_TYPES: [&str; 2] = [STORE_POS, RESTAURANT_POS];

/// True when `type_key` is one of the two POS terminal verticals.
///
/// Named `…_type` because the caller has a *type key*, not a session: this must
/// not be confused with `SessionContext::restaurant_pos_id`, which is a
/// **terminal id** (the ADR #40 peer-terminal binding), not a vertical.
#[must_use]
pub fn is_pos_type(type_key: &str) -> bool {
    POS_TYPES.contains(&type_key)
}

/// True when `type_key` is the Restaurant POS vertical.
///
/// Named `…_type` for the same reason as [`is_pos_type`].
#[must_use]
pub fn is_restaurant_pos_type(type_key: &str) -> bool {
    type_key == RESTAURANT_POS
}

#[cfg(test)]
#[path = "workspace_type_tests.rs"]
mod tests;
