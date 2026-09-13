//! Role-Based Access Control primitives.
/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section A)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — 3-level wildcard resolver (global/domain/exact) is fail-closed: malformed granted JSON => deny-all via unwrap_or_default, malformed granted strings match exactly only; zero unsafe/unwrap/expect, single documented assert in Role::new; permission catalog constants well-formed domain:action with legacy composites (products:crud, categories:manage) delegated to the permission registry (Section C); retired cashier/kitchen roles absent from taxonomy (doc prose only); evidence: 67 unit + 4 doctests green
next: observation only — a malformed REQUIRED string could match a granted "<req>:*" domain wildcard; unreachable today because required values come from the compile-time catalog, Section D verifies IPC callers use the constants | perf: linear scan over small grant lists — fine
*/
//!
//! Provides the [`Role`] and [`Permission`] types, the [`permissions`]
//! constant catalog, and the [`has_permission`] resolver that handles
//! wildcard permission strings (`"*"`, `"sales:*"`, `"sales:void"`).
//!
//! # Permission format
//!
//! Permissions follow `<domain>:<action>`. The wildcard `*` matches
//! everything. Domain-level wildcards like `sales:*` match every action
//! within that domain.
//!
//! # Examples
//!
//! ```
//! use platform_core::rbac::{has_permission, permissions};
//!
//! // Exact match
//! assert!(has_permission(&["sales:void".into()], permissions::SALES_VOID));
//!
//! // Domain wildcard
//! assert!(has_permission(&["sales:*".into()], "sales:process"));
//!
//! // Global wildcard
//! assert!(has_permission(&["*".into()], "settings:edit"));
//!
//! // Deny
//! assert!(!has_permission(&["products:read".into()], "sales:void"));
//! ```

use serde::{Deserialize, Serialize};
use std::fmt;

/// Error returned when a role does not have the required permission.
///
/// Contains both the permission that was checked and the role name,
/// so callers can produce actionable error messages.
#[derive(Debug, Clone, thiserror::Error)]
#[error("permission denied: '{required}' — role '{role_name}' lacks this permission")]
pub struct AuthorizationError {
    /// The permission string that was required but not granted.
    pub required: String,
    /// The name of the role that was checked.
    pub role_name: String,
}

/// A named role with an optional set of permissions.
///
/// Roles are the primary mechanism for grouping permissions —
/// staff members are assigned a role, and the role determines
/// what actions they can perform in the POS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Role {
    /// Unique identifier (UUID or short slug like "role-custom").
    pub id: String,
    /// Human-readable name (e.g. "Owner", "Manager", "Cashier").
    pub name: String,
    /// Optional description of what this role covers.
    pub description: String,
    /// JSON-encoded array of permission strings (e.g. `["sales:void"]`).
    pub permissions: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl Role {
    /// Create a new role with no permissions.
    ///
    /// # Panics
    ///
    /// Panics if `name` is empty after trimming.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into().trim().to_owned();
        assert!(!name.is_empty(), "role name must not be empty");
        Self {
            id: id.into(),
            name,
            description: String::new(),
            permissions: "[]".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Set the description (builder-style).
    #[must_use]
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }

    /// Parse the JSON `permissions` field and check whether this role
    /// grants a specific action.
    ///
    /// Malformed JSON is treated as an empty permission set (deny all).
    ///
    /// # Examples
    ///
    /// ```
    /// use platform_core::rbac::Role;
    ///
    /// let role = Role::new("role-test", "Test")
    ///     .with_permissions_json("[\"sales:void\"]");
    /// assert!(role.has_permission("sales:void"));
    /// assert!(!role.has_permission("settings:edit"));
    ///
    /// // Wildcard
    /// let admin = Role::new("role-admin", "Admin")
    ///     .with_permissions_json("[\"*\"]");
    /// assert!(admin.has_permission("any:thing"));
    /// ```
    #[must_use]
    pub fn has_permission(&self, required: &str) -> bool {
        let granted: Vec<String> = serde_json::from_str(&self.permissions).unwrap_or_default();
        has_permission(&granted, required)
    }

    /// Convenience: same as [`has_permission`] but returns
    /// [`AuthorizationError`] on failure for use with `?`.
    ///
    /// # Errors
    ///
    /// Returns [`AuthorizationError`] when the required permission
    /// is not granted by this role.
    ///
    /// # Examples
    ///
    /// ```
    /// use platform_core::rbac::Role;
    ///
    /// let role = Role::new("role-test", "Cashier")
    ///     .with_permissions_json("[\"sales:process\"]");
    ///
    /// assert!(role.authorize("sales:process").is_ok());
    /// assert!(role.authorize("sales:void").is_err());
    /// ```
    pub fn authorize(&self, required: &str) -> Result<(), AuthorizationError> {
        if self.has_permission(required) {
            Ok(())
        } else {
            Err(AuthorizationError {
                required: required.to_owned(),
                role_name: self.name.clone(),
            })
        }
    }

    /// Builder-style: replace the `permissions` JSON string.
    ///
    /// Does **not** validate the JSON — the caller is responsible for
    /// supplying a valid JSON array of strings.
    #[must_use]
    pub fn with_permissions_json(mut self, json: &str) -> Self {
        self.permissions = json.to_owned();
        self
    }
}

/// A single permission string representing an action in the POS.
///
/// Permissions follow the format `<domain>:<action>` where domain is
/// the feature area (sales, products, settings, staff, etc.) and
/// action is the specific operation (create, read, update, delete,
/// void, export, etc.).
///
/// # Examples
///
/// - `"sales:void"` — void a completed sale
/// - `"products:update"` — update existing product details
/// - `"settings:edit"` — modify store settings
/// - `"staff:update"` — update an existing staff member
/// - `"reports:view"` — view sales reports
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Permission {
    /// The permission string (e.g. `"sales:void"`).
    pub name: String,
    /// Human-readable description of what this permission grants.
    pub description: String,
}

impl Permission {
    /// Create a new permission.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: String::new(),
        }
    }

    /// Set the description (builder-style).
    #[must_use]
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.name.fmt(f)
    }
}

// ── Resolver ────────────────────────────────────────────────────────

/// Check whether a set of granted permission strings authorises a
/// required action.
///
/// Supports three levels of wildcard:
/// - `"*"` — grants **every** action
/// - `"<domain>:*"` — grants every action within that domain
///   (e.g. `"sales:*"` matches `"sales:void"`, `"sales:process"`, etc.)
/// - `"<domain>:<action>"` — grants only that exact action
///
/// The empty set grants nothing. Malformed permission strings (those
/// without a `:`) are matched exactly — they never match a wildcard
/// and are only matched by `"*"` or an identical string.
///
/// # Examples
///
/// ```
/// use platform_core::rbac::has_permission;
///
/// // Global wildcard
/// assert!(has_permission(&["*".into()], "sales:void"));
/// assert!(has_permission(&["*".into()], "anything:here"));
///
/// // Domain wildcard
/// assert!(has_permission(&["sales:*".into()], "sales:void"));
/// assert!(has_permission(&["sales:*".into()], "sales:process"));
/// assert!(!has_permission(&["sales:*".into()], "products:read"));
///
/// // Exact match
/// assert!(has_permission(&["sales:void".into()], "sales:void"));
/// assert!(!has_permission(&["sales:void".into()], "sales:process"));
///
/// // Multiple granted permissions (OR logic)
/// assert!(has_permission(
///     &["products:read".into(), "sales:process".into()],
///     "sales:process",
/// ));
/// assert!(!has_permission(
///     &["products:read".into(), "sales:process".into()],
///     "settings:edit",
/// ));
///
/// // Empty set denies everything
/// assert!(!has_permission(&[] as &[String], "sales:void"));
/// ```
#[must_use]
pub fn has_permission(granted: &[String], required: &str) -> bool {
    let (domain, _action) = required.split_once(':').unwrap_or((required, ""));
    let wildcard_domain = format!("{domain}:*");

    granted
        .iter()
        .any(|p| p == "*" || p == required || p == &wildcard_domain)
}

// ── Built-in role ids ───────────────────────────────────────────────

/// Well-known built-in role ids.
pub mod builtin_roles {
    /// Owner — full access to all features and settings.
    pub const OWNER: &str = "role-owner";
    /// Manager — can manage products, categories, and view reports.
    pub const MANAGER: &str = "role-manager";
    /// Admin — global scope, everything except ownership/billing/irreversible org actions.
    pub const ADMIN: &str = "role-admin";
    /// Auditor — global, read-only.
    pub const AUDITOR: &str = "role-auditor";
    /// Staff — operational role with Manager-level access minus settings.
    /// The retired cashier/kitchen roles fold into Staff (migration 129).
    pub const STAFF: &str = "role-staff";
    /// Custom — fully flexible role with no preset permissions.
    pub const CUSTOM: &str = "role-custom";
}

// ── Role presets ─────────────────────────────────────────────────────

/// A preset role definition with a fixed id, name, description, and set
/// of permission strings. Use [`RolePreset::permissions_json`] to get the
/// JSON array for storage.
pub struct RolePreset {
    /// Role id constant (e.g. `"role-owner"`).
    pub id: &'static str,
    /// Human-readable name.
    pub name: &'static str,
    /// Short description.
    pub description: &'static str,
    /// Permission strings to grant.
    pub permissions: &'static [&'static str],
}

impl RolePreset {
    /// Serialise the permission list to a JSON string.
    ///
    /// Returns e.g. `"[\"sales:process\",\"sales:view\"]"`.
    pub fn permissions_json(&self) -> String {
        let items: Vec<String> = self
            .permissions
            .iter()
            .map(|p| format!("\"{p}\""))
            .collect();
        format!("[{}]", items.join(","))
    }

    /// Build a [`Role`] from this preset, filling timestamps with the
    /// current UTC time.
    pub fn into_role(&self) -> Role {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        Role {
            id: self.id.to_owned(),
            name: self.name.to_owned(),
            description: self.description.to_owned(),
            permissions: self.permissions_json(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[path = "rbac_presets.rs"]
mod rbac_presets;

pub use rbac_presets::{ALL_ENFORCED, ROLE_PRESETS, is_builtin_role_id};

#[cfg(test)]
#[path = "rbac_preset_tests.rs"]
mod preset_tests;

#[cfg(test)]
#[path = "rbac_tests.rs"]
mod tests;

// ── Permission constants ────────────────────────────────────────────

/// Well-known permission strings organised by domain.
///
/// Every constant follows the `<domain>:<action>` format. Use these
/// constants instead of raw strings to get compile-time checking and
/// IDE autocompletion.
pub mod permissions {
    // ── Sales ─────────────────────────────────────────────────────
    /// Process a new sale (add items, accept payment, complete).
    pub const SALES_PROCESS: &str = "sales:process";
    /// Void a completed sale.
    pub const SALES_VOID: &str = "sales:void";
    /// Process a full or partial refund.
    pub const SALES_REFUND: &str = "sales:refund";
    /// View sales history and transaction details.
    pub const SALES_VIEW: &str = "sales:view";
    /// Apply a discount to a sale.
    pub const SALES_DISCOUNT: &str = "sales:discount";
    /// Split a sale across multiple payments or tickets.
    pub const SALES_SPLIT: &str = "sales:split";
    /// Override the unit price of a line in an active cart.
    pub const SALES_OVERRIDE_PRICE: &str = "sales:override_price";

    // ── Products ──────────────────────────────────────────────────
    /// Create a new product.
    pub const PRODUCTS_CREATE: &str = "products:create";
    /// View product catalog and details.
    pub const PRODUCTS_READ: &str = "products:read";
    /// Update existing product details.
    pub const PRODUCTS_UPDATE: &str = "products:update";
    /// Delete a product from the catalog.
    pub const PRODUCTS_DELETE: &str = "products:delete";
    /// Bulk-import products from a file.
    pub const PRODUCTS_IMPORT: &str = "products:import";
    /// Export the product catalog.
    pub const PRODUCTS_EXPORT: &str = "products:export";
    /// Legacy composite seed key (create/read/update/delete) kept
    /// byte-identical — registered in the permission registry (spec 0046).
    pub const PRODUCTS_CRUD: &str = "products:crud";
    /// Set or override a product's cost (HPP). Manager+ only — cost is
    /// local-only and sensitive (ADR #36 D7); staff can create/update
    /// products without ever touching cost.
    pub const PRODUCTS_EDIT_COST: &str = "products:edit_cost";

    // ── Inventory ─────────────────────────────────────────────────
    /// View stock levels.
    pub const INVENTORY_VIEW: &str = "inventory:view";
    /// Adjust stock quantities (add / remove).
    pub const INVENTORY_ADJUST: &str = "inventory:adjust";
    /// Transfer stock between stores or locations.
    pub const INVENTORY_TRANSFER: &str = "inventory:transfer";
    /// Perform a physical inventory count.
    pub const INVENTORY_COUNT: &str = "inventory:count";
    /// Create, rename, deactivate, or rebind inventory locations.
    pub const INVENTORY_LOCATIONS_MANAGE: &str = "inventory:locations_manage";

    // ── Staff ─────────────────────────────────────────────────────
    /// Create a new staff user.
    pub const STAFF_CREATE: &str = "staff:create";
    /// View staff members and their details.
    pub const STAFF_READ: &str = "staff:read";
    /// Update an existing staff member.
    pub const STAFF_UPDATE: &str = "staff:update";
    /// Delete / deactivate a staff member. RESERVED (G-3): registered and
    /// sensitive, but no enforcement consumer yet across desktop, tablet,
    /// cloud, and CLI — deactivation rides [`Self::STAFF_UPDATE`]; any
    /// future hard-delete surface must gate on this key.
    pub const STAFF_DELETE: &str = "staff:delete";
    /// Create, edit, or delete roles and their permission sets.
    pub const STAFF_MANAGE_ROLES: &str = "staff:manage_roles";
    /// Read a staff member's identity fields (national id, tax id) unmasked.
    pub const STAFF_READ_IDENTITY: &str = "staff:read_identity";
    /// Read a staff member's payroll fields (monthly take-home pay).
    pub const STAFF_READ_PAYROLL: &str = "staff:read_payroll";
    /// Edit a staff member's free-text notes.
    pub const STAFF_EDIT_NOTES: &str = "staff:edit_notes";

    // ── Settings ──────────────────────────────────────────────────
    /// View store and system settings.
    pub const SETTINGS_READ: &str = "settings:read";
    /// Modify store and system settings.
    pub const SETTINGS_EDIT: &str = "settings:edit";

    // ── Reports ───────────────────────────────────────────────────
    /// View sales, inventory, and shift reports.
    pub const REPORTS_VIEW: &str = "reports:view";
    /// Export reports to file (PDF, CSV, etc.).
    pub const REPORTS_EXPORT: &str = "reports:export";
    /// Schedule automated report generation.
    pub const REPORTS_SCHEDULE: &str = "reports:schedule";

    // ── Analytics ─────────────────────────────────────────────────
    /// View per-staff shift + sales analytics (owner / admin / manager).
    pub const ANALYTICS_VIEW: &str = "analytics:view";

    // ── Shifts ────────────────────────────────────────────────────
    /// Open a new cashier shift.
    pub const SHIFTS_OPEN: &str = "shifts:open";
    /// Close the current shift.
    pub const SHIFTS_CLOSE: &str = "shifts:close";
    /// View shifts belonging to other cashiers.
    pub const SHIFTS_VIEW_ANY: &str = "shifts:view_any";

    // ── Audit ─────────────────────────────────────────────────────
    /// View the audit log.
    pub const AUDIT_VIEW: &str = "audit:view";
    /// Export the audit log.
    pub const AUDIT_EXPORT: &str = "audit:export";

    // ── Payments ──────────────────────────────────────────────────
    /// Handle cash payments (open drawer, count change).
    pub const PAYMENTS_CASH: &str = "payments:cash";
    /// Process card / contactless payments.
    pub const PAYMENTS_CARD: &str = "payments:card";
    /// Process a payment refund.
    pub const PAYMENTS_REFUND: &str = "payments:refund";
    /// Settle / reconcile payment batches.
    pub const PAYMENTS_SETTLE: &str = "payments:settle";

    // ── Customers ─────────────────────────────────────────────────
    /// Create a new customer record.
    pub const CUSTOMERS_CREATE: &str = "customers:create";
    /// View customer details and history.
    pub const CUSTOMERS_VIEW: &str = "customers:view";
    /// Edit an existing customer record.
    pub const CUSTOMERS_EDIT: &str = "customers:edit";
    /// Delete a customer record.
    pub const CUSTOMERS_DELETE: &str = "customers:delete";

    // ── Loyalty ──────────────────────────────────────────────────
    /// View loyalty accounts, balances, and tiers.
    pub const LOYALTY_VIEW: &str = "loyalty:view";
    /// Earn loyalty points for completed sales.
    pub const LOYALTY_EARN: &str = "loyalty:earn";
    /// Redeem loyalty points during checkout.
    pub const LOYALTY_REDEEM: &str = "loyalty:redeem";
    /// Manage loyalty tier configuration.
    pub const LOYALTY_MANAGE: &str = "loyalty:manage";

    // ── Tables ────────────────────────────────────────────────────
    /// Assign a table to a customer or server.
    pub const TABLES_ASSIGN: &str = "tables:assign";
    /// Merge two or more tables.
    pub const TABLES_MERGE: &str = "tables:merge";
    /// Split a table into separate checks.
    pub const TABLES_SPLIT: &str = "tables:split";
    /// Close / clear a table.
    pub const TABLES_CLOSE: &str = "tables:close";

    // ── Discounts ─────────────────────────────────────────────────
    /// Apply an existing discount to a sale.
    pub const DISCOUNTS_APPLY: &str = "discounts:apply";
    /// Create a new discount rule.
    pub const DISCOUNTS_CREATE: &str = "discounts:create";
    /// Manage all discount rules (edit, delete, enable/disable).
    pub const DISCOUNTS_MANAGE: &str = "discounts:manage";

    // ── Workspaces ────────────────────────────────────────────────
    /// Switch between workspaces / stores.
    pub const WORKSPACES_SWITCH: &str = "workspaces:switch";

    // ── KDS ─────────────────────────────────────────────────────
    /// View the KDS order queue.
    pub const KDS_VIEW: &str = "kds:view";
    /// Update KDS order status (advance tickets).
    pub const KDS_UPDATE: &str = "kds:update";

    // ── Promotions ──────────────────────────────────────────────
    /// Create a new promotion rule.
    pub const PROMOTIONS_CREATE: &str = "promotions:create";
    /// Edit an existing promotion rule.
    pub const PROMOTIONS_EDIT: &str = "promotions:edit";
    /// Delete a promotion rule.
    pub const PROMOTIONS_DELETE: &str = "promotions:delete";
    /// Apply a promotion to a sale.
    pub const PROMOTIONS_APPLY: &str = "promotions:apply";

    // ── Tables (CRUD) ────────────────────────────────────────────
    /// Create a new table.
    pub const TABLES_CREATE: &str = "tables:create";
    /// Edit table properties (name, capacity, position, shape, section).
    pub const TABLES_EDIT: &str = "tables:edit";
    /// Delete a table from the floor plan.
    pub const TABLES_DELETE: &str = "tables:delete";

    // ── Terminals ────────────────────────────────────────────────
    /// Register a new POS terminal.
    pub const TERMINALS_REGISTER: &str = "terminals:register";
    /// Edit terminal configuration.
    pub const TERMINALS_EDIT: &str = "terminals:edit";
    /// Delete / unregister a terminal.
    pub const TERMINALS_DELETE: &str = "terminals:delete";
    /// View terminal, profile, override, and device-binding state.
    pub const TERMINALS_READ: &str = "terminals:read";

    // ── Categories ────────────────────────────────────────────────
    /// Legacy seed key (create/update/delete) kept byte-identical —
    /// registered in the permission registry (spec 0046).
    pub const CATEGORIES_MANAGE: &str = "categories:manage";
    /// Read product categories (spec 0047 read-tier map).
    pub const CATEGORIES_READ: &str = "categories:read";

    // ── Plugins ───────────────────────────────────────────────────
    /// Manage plugins (install, enable, disable, remove).
    pub const PLUGINS_MANAGE: &str = "plugins:manage";

    // ── Purchasing ───────────────────────────────────────────────
    /// View suppliers and purchase orders.
    pub const PURCHASING_VIEW: &str = "purchasing:view";
    /// Create/update suppliers and purchase orders, and receive deliveries.
    pub const PURCHASING_MANAGE: &str = "purchasing:manage";

    // ── Gift cards ───────────────────────────────────────────────
    /// Issue a new gift card or top up stored value (money creation).
    pub const GIFTCARDS_ISSUE: &str = "giftcards:issue";
    /// Redeem gift card stored value as payment.
    pub const GIFTCARDS_REDEEM: &str = "giftcards:redeem";
    /// Freeze, unfreeze, and inspect gift cards.
    pub const GIFTCARDS_MANAGE: &str = "giftcards:manage";

    // ── Sync ─────────────────────────────────────────────────────
    /// Configure, trigger, and manage data synchronization.
    pub const SYNC_MANAGE: &str = "sync:manage";

    // ── Security ─────────────────────────────────────────────────
    /// Rotate at-rest encryption keys and inspect key state.
    pub const SECURITY_MANAGE: &str = "security:manage";

    // ── Reference (global read-tier data, spec 0047) ─────────────
    /// Read global reference data (tax rates, exchange rates, categories).
    pub const REFERENCE_READ: &str = "reference:read";

    // ── Plan ─────────────────────────────────────────────────────
    /// Read tier plan information.
    pub const PLAN_READ: &str = "plan:read";

    // ── Data ─────────────────────────────────────────────────────
    /// Create a full data backup (bulk export of all records).
    pub const DATA_EXPORT: &str = "data:export";

    // ── Memo ──────────────────────────────────────────────────────
    /// Author or publish a Memo (Organization or Location). Phase 1 §F /
    /// Phase 2 Memo lifecycle: Location Memo is manager+, Organization Memo
    /// owner/admin — the role split is enforced by the memo surface itself;
    /// this key is the write gate. Early-stop lives on [`Self::MEMO_STOP`].
    pub const MEMO_WRITE: &str = "memo:write";

    /// Early-stop (end before `expiresAt`) a published Memo — the author may
    /// always stop their own; this key covers stopping anyone's (Owner/Admin
    /// presets). Ruled 2026-09-07 (option A2): "higher role" is expressed as
    /// a registry grant, not a rank map, so custom roles stay deny-by-default.
    pub const MEMO_STOP: &str = "memo:stop";

    // ── Topology ──────────────────────────────────────────────────
    /// Mutate the topology graph (Apply, location creation, rename,
    /// templates, property edits). Phase 1 §I: dedicated key replacing
    /// the broader `staff:update` gate the editor currently rides;
    /// admin/owner only (Owner holds it via the global wildcard).
    pub const TOPOLOGY_WRITE: &str = "topology:write";

    // ── Payables (Hutang / Beli Tempo — AP) ───────────────────────
    /// View vendor bills, due dates, and the payables aging report. Phase 4
    /// (AP) of `docs/plans/payment-methods-plan.md`. Owner holds it via the
    /// global wildcard; the Auditor preset grants read-only visibility.
    pub const PAYABLES_VIEW: &str = "payables:view";

    /// Raise a payable — the "On Account" option at purchasing stock-in
    /// (create a supplier debt). Owner-only, mirroring purchasing's reality.
    pub const PAYABLES_CREATE: &str = "payables:create";

    /// Record a payment to the vendor against a payable (partial or full).
    /// Owner-only.
    pub const PAYABLES_SETTLE: &str = "payables:settle";

    /// Forgive a vendor debt without payment (money destruction — audited).
    /// Owner-only.
    pub const PAYABLES_WRITEOFF: &str = "payables:writeoff";

    // ── operator ──
    /// Act as another user within the operator's authorized tenant scope for
    /// support. `operator:` names the capability class (support impersonation),
    /// not any vendor/cloud-operator status. The impersonated session carries
    /// only the target's grants — the operator's own grants are never merged,
    /// and this key is never propagated into the produced token.
    pub const OPERATOR_IMPERSONATE: &str = "operator:impersonate";
}
