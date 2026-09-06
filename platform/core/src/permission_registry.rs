//! Code-resident permission registry — the single source of truth for what a
//! permission key means, which family it belongs to, and whether it is
//! sensitive (ADR #35 D3 / spec 0046).
/*
last audited 31-08-26 by RSA-Agent (user-role campaign, FINAL verification pass)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — 83-key registry with family/sensitivity classification per ADR #35 D2/D3 (14 sensitive keys); validate_grant fail-closed (unregistered key, sensitive-under-family-wildcard, global * reserved for the Owner seed); G-3 CLOSED: staff:delete is documented RESERVED (no enforcement consumer; deactivation rides staff:update; any future hard-delete surface must gate on this key) in both the registry entry and the rbac.rs catalog constant; the Section-D verification held — hand-edited DB rows carrying a family wildcard for a sensitive key still deny at the registry-aware gate (db/staff.rs:122-125), so the creation-time-only sensitivity invariant has an enforcement-side backstop
next: none — campaign closed for this file | perf: linear registry scan — fine at 83 entries
*/
//!
//! Growing the system means adding keys here — never editing roles. Sensitive
//! keys (voids, refunds, settlement, role management, bulk export) are never
//! grantable through a family wildcard; only explicit grants may carry them.

/// One registered permission key.
pub struct PermissionEntry {
    /// The `domain:action` key — byte-identical to the enforced string.
    pub key: &'static str,
    /// The family (domain) this key belongs to; `family:*` wildcards grant
    /// every *operational* key in the family.
    pub family: &'static str,
    /// Whether the key is sensitive — never grantable via a family wildcard.
    pub sensitive: bool,
    /// One-line description of what the key grants.
    pub description: &'static str,
}

/// Errors from [`validate_grant`] / [`validate_grants`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RegistryError {
    /// The key (or family wildcard) is not registered.
    #[error("unregistered permission '{0}' — add it to the registry first")]
    UnknownKey(String),
    /// A family wildcard would implicitly grant sensitive key(s).
    #[error("wildcard '{0}' would grant sensitive key(s): {1}")]
    SensitiveUnderWildcard(String, String),
    /// The global `*` wildcard is reserved for the Owner seed.
    #[error("global wildcard '*' is reserved for the Owner seed")]
    GlobalWildcardDenied,
}

/// The registry — every enforced key, classified by family and sensitivity.
///
/// Sensitive per ADR #35 D2: voids, refunds, payment settlement, role
/// management, staff deletion, and bulk export of reports/audit data.
pub const REGISTRY: &[PermissionEntry] = &[
    // ── sales ────────────────────────────────────────────────────
    PermissionEntry {
        key: "sales:process",
        family: "sales",
        sensitive: false,
        description: "Process a new sale (add items, accept payment, complete).",
    },
    PermissionEntry {
        key: "sales:view",
        family: "sales",
        sensitive: false,
        description: "View sales history and transaction details.",
    },
    PermissionEntry {
        key: "sales:discount",
        family: "sales",
        sensitive: false,
        description: "Apply a discount to a sale.",
    },
    PermissionEntry {
        key: "sales:split",
        family: "sales",
        sensitive: false,
        description: "Split a sale across multiple payments or tickets.",
    },
    PermissionEntry {
        key: "sales:override_price",
        family: "sales",
        sensitive: false,
        description: "Override the unit price of a line in an active cart.",
    },
    PermissionEntry {
        key: "sales:void",
        family: "sales",
        sensitive: true,
        description: "Void a completed sale.",
    },
    PermissionEntry {
        key: "sales:refund",
        family: "sales",
        sensitive: true,
        description: "Process a full or partial refund.",
    },
    // ── products ─────────────────────────────────────────────────
    PermissionEntry {
        key: "products:create",
        family: "products",
        sensitive: false,
        description: "Create a new product.",
    },
    PermissionEntry {
        key: "products:read",
        family: "products",
        sensitive: false,
        description: "View product catalog and details.",
    },
    PermissionEntry {
        key: "products:update",
        family: "products",
        sensitive: false,
        description: "Update existing product details.",
    },
    PermissionEntry {
        key: "products:delete",
        family: "products",
        sensitive: false,
        description: "Delete a product from the catalog.",
    },
    PermissionEntry {
        key: "products:import",
        family: "products",
        sensitive: false,
        description: "Bulk-import products from a file.",
    },
    PermissionEntry {
        key: "products:export",
        family: "products",
        sensitive: false,
        description: "Export the product catalog.",
    },
    PermissionEntry {
        key: "products:crud",
        family: "products",
        sensitive: false,
        description: "Legacy composite seed key — product create/read/update/delete. Kept byte-identical.",
    },
    PermissionEntry {
        key: "products:edit_cost",
        family: "products",
        sensitive: false,
        description: "Set or override a product's cost (HPP). Granted to manager/admin presets only — cost is local-only (ADR #36 D7).",
    },
    // ── inventory ────────────────────────────────────────────────
    PermissionEntry {
        key: "inventory:view",
        family: "inventory",
        sensitive: false,
        description: "View stock levels.",
    },
    PermissionEntry {
        key: "inventory:adjust",
        family: "inventory",
        sensitive: false,
        description: "Adjust stock quantities (add / remove).",
    },
    PermissionEntry {
        key: "inventory:transfer",
        family: "inventory",
        sensitive: false,
        description: "Transfer stock between stores or locations.",
    },
    PermissionEntry {
        key: "inventory:count",
        family: "inventory",
        sensitive: false,
        description: "Perform a physical inventory count.",
    },
    PermissionEntry {
        key: "inventory:locations_manage",
        family: "inventory",
        sensitive: false,
        description: "Create, rename, deactivate, or rebind inventory locations.",
    },
    // ── staff ────────────────────────────────────────────────────
    PermissionEntry {
        key: "staff:create",
        family: "staff",
        sensitive: false,
        description: "Create a new staff user.",
    },
    PermissionEntry {
        key: "staff:read",
        family: "staff",
        sensitive: false,
        description: "View staff members and their details.",
    },
    PermissionEntry {
        key: "staff:update",
        family: "staff",
        sensitive: false,
        description: "Update an existing staff member.",
    },
    PermissionEntry {
        key: "staff:delete",
        family: "staff",
        sensitive: true,
        description: "Delete / deactivate a staff member. RESERVED (G-3): no enforcement consumer yet across desktop/tablet/cloud/CLI — deactivation rides staff:update; any future hard-delete IPC must gate on this key.",
    },
    PermissionEntry {
        key: "staff:manage_roles",
        family: "staff",
        sensitive: true,
        description: "Create, edit, or delete roles and their permission sets.",
    },
    PermissionEntry {
        key: "staff:read_identity",
        family: "staff",
        sensitive: true,
        description: "Read a staff member's identity fields (national id, tax id) unmasked.",
    },
    PermissionEntry {
        key: "staff:read_payroll",
        family: "staff",
        sensitive: true,
        description: "Read a staff member's payroll fields (monthly take-home pay).",
    },
    PermissionEntry {
        key: "staff:edit_notes",
        family: "staff",
        sensitive: true,
        description: "Edit a staff member's free-text notes.",
    },
    // ── settings ─────────────────────────────────────────────────
    PermissionEntry {
        key: "settings:read",
        family: "settings",
        sensitive: false,
        description: "View store and system settings.",
    },
    PermissionEntry {
        key: "settings:edit",
        family: "settings",
        sensitive: false,
        description: "Modify store and system settings.",
    },
    // ── reports ──────────────────────────────────────────────────
    PermissionEntry {
        key: "reports:view",
        family: "reports",
        sensitive: false,
        description: "View sales, inventory, and shift reports.",
    },
    PermissionEntry {
        key: "reports:schedule",
        family: "reports",
        sensitive: false,
        description: "Schedule automated report generation.",
    },
    PermissionEntry {
        key: "reports:export",
        family: "reports",
        sensitive: true,
        description: "Export reports to file (PDF, CSV, etc.).",
    },
    // ── analytics ────────────────────────────────────────────────
    PermissionEntry {
        key: "analytics:view",
        family: "analytics",
        sensitive: false,
        description: "View per-staff shift and sales analytics (owner / admin / manager).",
    },
    // ── shifts ───────────────────────────────────────────────────
    PermissionEntry {
        key: "shifts:open",
        family: "shifts",
        sensitive: false,
        description: "Open a new cashier shift.",
    },
    PermissionEntry {
        key: "shifts:close",
        family: "shifts",
        sensitive: false,
        description: "Close the current shift.",
    },
    PermissionEntry {
        key: "shifts:view_any",
        family: "shifts",
        sensitive: false,
        description: "View shifts belonging to other cashiers.",
    },
    // ── audit ────────────────────────────────────────────────────
    PermissionEntry {
        key: "audit:view",
        family: "audit",
        sensitive: false,
        description: "View the audit log.",
    },
    PermissionEntry {
        key: "audit:export",
        family: "audit",
        sensitive: true,
        description: "Export the audit log.",
    },
    // ── payments ─────────────────────────────────────────────────
    PermissionEntry {
        key: "payments:cash",
        family: "payments",
        sensitive: false,
        description: "Handle cash payments (open drawer, count change).",
    },
    PermissionEntry {
        key: "payments:card",
        family: "payments",
        sensitive: false,
        description: "Process card / contactless payments.",
    },
    PermissionEntry {
        key: "payments:refund",
        family: "payments",
        sensitive: true,
        description: "Process a payment refund.",
    },
    PermissionEntry {
        key: "payments:settle",
        family: "payments",
        sensitive: true,
        description: "Settle / reconcile payment batches.",
    },
    // ── customers ────────────────────────────────────────────────
    PermissionEntry {
        key: "customers:create",
        family: "customers",
        sensitive: false,
        description: "Create a new customer record.",
    },
    PermissionEntry {
        key: "customers:view",
        family: "customers",
        sensitive: false,
        description: "View customer details and history.",
    },
    PermissionEntry {
        key: "customers:edit",
        family: "customers",
        sensitive: false,
        description: "Edit an existing customer record.",
    },
    PermissionEntry {
        key: "customers:delete",
        family: "customers",
        sensitive: false,
        description: "Delete a customer record.",
    },
    // ── loyalty ──────────────────────────────────────────────────
    PermissionEntry {
        key: "loyalty:view",
        family: "loyalty",
        sensitive: false,
        description: "View loyalty accounts, balances, and tiers.",
    },
    PermissionEntry {
        key: "loyalty:earn",
        family: "loyalty",
        sensitive: false,
        description: "Earn loyalty points for completed sales.",
    },
    PermissionEntry {
        key: "loyalty:redeem",
        family: "loyalty",
        sensitive: false,
        description: "Redeem loyalty points during checkout.",
    },
    PermissionEntry {
        key: "loyalty:manage",
        family: "loyalty",
        sensitive: false,
        description: "Manage loyalty tier configuration.",
    },
    // ── tables ───────────────────────────────────────────────────
    PermissionEntry {
        key: "tables:assign",
        family: "tables",
        sensitive: false,
        description: "Assign a table to a customer or server.",
    },
    PermissionEntry {
        key: "tables:merge",
        family: "tables",
        sensitive: false,
        description: "Merge two or more tables.",
    },
    PermissionEntry {
        key: "tables:split",
        family: "tables",
        sensitive: false,
        description: "Split a table into separate checks.",
    },
    PermissionEntry {
        key: "tables:close",
        family: "tables",
        sensitive: false,
        description: "Close / clear a table.",
    },
    PermissionEntry {
        key: "tables:create",
        family: "tables",
        sensitive: false,
        description: "Create a new table.",
    },
    PermissionEntry {
        key: "tables:edit",
        family: "tables",
        sensitive: false,
        description: "Edit table properties (name, capacity, position, shape, section).",
    },
    PermissionEntry {
        key: "tables:delete",
        family: "tables",
        sensitive: false,
        description: "Delete a table from the floor plan.",
    },
    // ── discounts ────────────────────────────────────────────────
    PermissionEntry {
        key: "discounts:apply",
        family: "discounts",
        sensitive: false,
        description: "Apply an existing discount to a sale.",
    },
    PermissionEntry {
        key: "discounts:create",
        family: "discounts",
        sensitive: false,
        description: "Create a new discount rule.",
    },
    PermissionEntry {
        key: "discounts:manage",
        family: "discounts",
        sensitive: false,
        description: "Manage all discount rules (edit, delete, enable/disable).",
    },
    // ── workspaces ───────────────────────────────────────────────
    PermissionEntry {
        key: "workspaces:switch",
        family: "workspaces",
        sensitive: false,
        description: "Switch between workspaces / stores.",
    },
    // ── kds ──────────────────────────────────────────────────────
    PermissionEntry {
        key: "kds:view",
        family: "kds",
        sensitive: false,
        description: "View the KDS order queue.",
    },
    PermissionEntry {
        key: "kds:update",
        family: "kds",
        sensitive: false,
        description: "Update KDS order status (advance tickets).",
    },
    // ── promotions ───────────────────────────────────────────────
    PermissionEntry {
        key: "promotions:create",
        family: "promotions",
        sensitive: false,
        description: "Create a new promotion rule.",
    },
    PermissionEntry {
        key: "promotions:edit",
        family: "promotions",
        sensitive: false,
        description: "Edit an existing promotion rule.",
    },
    PermissionEntry {
        key: "promotions:delete",
        family: "promotions",
        sensitive: false,
        description: "Delete a promotion rule.",
    },
    PermissionEntry {
        key: "promotions:apply",
        family: "promotions",
        sensitive: false,
        description: "Apply a promotion to a sale.",
    },
    // ── terminals ────────────────────────────────────────────────
    PermissionEntry {
        key: "terminals:register",
        family: "terminals",
        sensitive: false,
        description: "Register a new POS terminal.",
    },
    PermissionEntry {
        key: "terminals:edit",
        family: "terminals",
        sensitive: false,
        description: "Edit terminal configuration.",
    },
    PermissionEntry {
        key: "terminals:delete",
        family: "terminals",
        sensitive: false,
        description: "Delete / unregister a terminal.",
    },
    PermissionEntry {
        key: "terminals:read",
        family: "terminals",
        sensitive: false,
        description: "View terminal, profile, override, and device-binding state.",
    },
    // ── categories ───────────────────────────────────────────────
    PermissionEntry {
        key: "categories:manage",
        family: "categories",
        sensitive: false,
        description: "Legacy seed key — category create/update/delete. Kept byte-identical.",
    },
    PermissionEntry {
        key: "categories:read",
        family: "categories",
        sensitive: false,
        description: "Read product categories (spec 0047 read-tier map).",
    },
    // ── plugins ──────────────────────────────────────────────────
    PermissionEntry {
        key: "plugins:manage",
        family: "plugins",
        sensitive: false,
        description: "Manage plugins (install, enable, disable, remove).",
    },
    // ── purchasing ───────────────────────────────────────────────
    PermissionEntry {
        key: "purchasing:view",
        family: "purchasing",
        sensitive: false,
        description: "View suppliers and purchase orders.",
    },
    PermissionEntry {
        key: "purchasing:manage",
        family: "purchasing",
        sensitive: false,
        description: "Create/update suppliers and purchase orders, and receive deliveries.",
    },
    // ── giftcards ────────────────────────────────────────────────
    PermissionEntry {
        key: "giftcards:issue",
        family: "giftcards",
        sensitive: true,
        description: "Issue a new gift card or top up stored value (creates money).",
    },
    PermissionEntry {
        key: "giftcards:redeem",
        family: "giftcards",
        sensitive: false,
        description: "Redeem gift card stored value as payment.",
    },
    PermissionEntry {
        key: "giftcards:manage",
        family: "giftcards",
        sensitive: false,
        description: "Freeze, unfreeze, and inspect gift cards.",
    },
    // ── sync ─────────────────────────────────────────────────────
    PermissionEntry {
        key: "sync:manage",
        family: "sync",
        sensitive: false,
        description: "Configure, trigger, and manage data synchronization.",
    },
    // ── security ─────────────────────────────────────────────────
    PermissionEntry {
        key: "security:manage",
        family: "security",
        sensitive: true,
        description: "Rotate at-rest encryption keys and inspect key state.",
    },
    // ── reference (global read-tier reference data, spec 0047) ──
    PermissionEntry {
        key: "reference:read",
        family: "reference",
        sensitive: false,
        description: "Read global reference data (tax rates, exchange rates, categories).",
    },
    // ── plan ─────────────────────────────────────────────────────
    PermissionEntry {
        key: "plan:read",
        family: "plan",
        sensitive: false,
        description: "Read the tenant's cloud sync plan (spec 0047 read tiers).",
    },
    // ── data ─────────────────────────────────────────────────────
    PermissionEntry {
        key: "data:export",
        family: "data",
        sensitive: true,
        description: "Create a full data backup (bulk export of all records).",
    },
    // ── memo (Phase 1 §F / Phase 2 Memo lifecycle) ───────────────
    PermissionEntry {
        key: "memo:write",
        family: "memo",
        sensitive: false,
        description: "Author or publish a Memo (Organization or Location).",
    },
    PermissionEntry {
        key: "memo:stop",
        family: "memo",
        sensitive: false,
        description: "Early-stop a published Memo (any author's); the author can always stop their own.",
    },
    // ── topology (Phase 1 §I) ────────────────────────────────────
    PermissionEntry {
        key: "topology:write",
        family: "topology",
        sensitive: false,
        description: "Mutate the topology graph (Apply, location creation, rename, templates, property edits).",
    },
];

/// Look up a registered key.
pub fn lookup(key: &str) -> Option<&'static PermissionEntry> {
    REGISTRY.iter().find(|e| e.key == key)
}

/// Whether the key is registered.
pub fn is_registered(key: &str) -> bool {
    lookup(key).is_some()
}

/// Whether the key is registered and sensitive.
pub fn is_sensitive(key: &str) -> bool {
    lookup(key).is_some_and(|e| e.sensitive)
}

/// Validate a single grant string.
///
/// `allow_global` permits `"*"` — the documented Owner-seed exception
/// (ADR #35 D4).
pub fn validate_grant(grant: &str, allow_global: bool) -> Result<(), RegistryError> {
    if grant == "*" {
        return if allow_global {
            Ok(())
        } else {
            Err(RegistryError::GlobalWildcardDenied)
        };
    }
    if let Some(family) = grant.strip_suffix(":*") {
        let sensitive: Vec<&str> = REGISTRY
            .iter()
            .filter(|e| e.family == family && e.sensitive)
            .map(|e| e.key)
            .collect();
        if !sensitive.is_empty() {
            return Err(RegistryError::SensitiveUnderWildcard(
                grant.to_owned(),
                sensitive.join(", "),
            ));
        }
        if REGISTRY.iter().any(|e| e.family == family) {
            Ok(())
        } else {
            Err(RegistryError::UnknownKey(grant.to_owned()))
        }
    } else if is_registered(grant) {
        Ok(())
    } else {
        Err(RegistryError::UnknownKey(grant.to_owned()))
    }
}

/// Validate a grant set, collecting every error.
pub fn validate_grants(grants: &[String], allow_global: bool) -> Result<(), Vec<RegistryError>> {
    let errors: Vec<RegistryError> = grants
        .iter()
        .filter_map(|g| validate_grant(g, allow_global).err())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
#[path = "permission_registry_tests.rs"]
mod tests;
