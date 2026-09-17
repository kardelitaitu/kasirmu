//! Purchasing command bodies (Wave C / C4) — the tauri-free half of
//! `apps/desktop-client/src/commands/purchasing.rs`.
//!
//! Key functions: the global-database supplier and purchase-order operations
//! ([`list_suppliers`], [`get_supplier`], [`create_supplier`],
//! [`update_supplier`], [`list_purchase_orders`],
//! [`get_purchase_order`], [`create_purchase_order`],
//! [`update_po_status`], [`receive_purchase_order`],
//! [`receive_purchase_order_with_lines`]) and their session-scoped ADR #7
//! variants (the `*_scoped` set), each consuming a [`BridgeCtx`]. There is
//! no `run_*` `&Connection` helper here: the bodies were logic-inline in
//! the shell, so the store work stays inside the command functions.
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves. The scoped variants
//! authorize through the scope-aware global-identity gate
//! (`ctx.require_session_permission`, mirroring
//! `commands/authz.rs::require_permission_for_session`) exactly as the
//! shell did.

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use kasirmu_core::db::Store;
use kasirmu_core::db::purchase_orders::{CreatePoLineInput, ReceivePoLineInput};
use kasirmu_core::permissions;
use kasirmu_core::{PurchaseOrderLine, PurchaseOrderWithLines, Supplier};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── Supplier DTO ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
/// Supplierdto.
pub struct SupplierDto {
    /// Unique identifier.
    pub id: String,
    /// Code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Contact Person.
    pub contact_person: String,
    /// Phone number.
    pub phone: String,
    /// Email address.
    pub email: String,
    /// Street address.
    pub address: String,
    /// ID of the associated tax.
    pub tax_id: String,
    /// Payment Terms.
    pub payment_terms: String,
    /// Notes.
    pub notes: String,
    /// Current status.
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<Supplier> for SupplierDto {
    fn from(s: Supplier) -> Self {
        Self {
            id: s.id,
            code: s.code,
            name: s.name,
            contact_person: s.contact_person,
            phone: s.phone,
            email: s.email,
            address: s.address,
            tax_id: s.tax_id,
            payment_terms: s.payment_terms,
            notes: s.notes,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

// ── Purchase Order DTOs ─────────────────────────────────────────────

#[derive(Debug, Serialize)]
/// Purchaseorderlinedto.
pub struct PurchaseOrderLineDto {
    /// Unique identifier.
    pub id: String,
    /// ID of the associated po.
    pub po_id: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Product Name.
    pub product_name: String,
    /// Quantity.
    pub qty: i64,
    /// Unit Cost Minor.
    pub unit_cost_minor: i64,
    /// Total amount in minor currency units.
    pub line_total_minor: i64,
}

#[derive(Debug, Serialize)]
/// Purchaseorderdto.
pub struct PurchaseOrderDto {
    /// Unique identifier.
    pub id: String,
    /// Po Number.
    pub po_number: String,
    /// ID of the associated supplier.
    pub supplier_id: String,
    /// Current status.
    pub status: String,
    /// Order Date.
    pub order_date: String,
    /// Expected Date.
    pub expected_date: String,
    /// Received Date.
    pub received_date: Option<String>,
    /// Total amount in minor currency units.
    pub subtotal_minor: i64,
    /// Tax Minor.
    pub tax_minor: i64,
    /// Total amount in minor currency units.
    pub total_minor: i64,
    /// Notes.
    pub notes: String,
    /// Created By.
    pub created_by: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// Lines.
    pub lines: Vec<PurchaseOrderLineDto>,
    /// Supplier Name.
    pub supplier_name: Option<String>,
}

impl From<PurchaseOrderLine> for PurchaseOrderLineDto {
    fn from(l: PurchaseOrderLine) -> Self {
        Self {
            id: l.id,
            po_id: l.po_id,
            sku: l.sku,
            product_name: l.product_name,
            qty: l.qty,
            unit_cost_minor: l.unit_cost_minor,
            line_total_minor: l.line_total_minor,
        }
    }
}

impl From<PurchaseOrderWithLines> for PurchaseOrderDto {
    fn from(po: PurchaseOrderWithLines) -> Self {
        Self {
            id: po.order.id,
            po_number: po.order.po_number,
            supplier_id: po.order.supplier_id,
            status: po.order.status,
            order_date: po.order.order_date,
            expected_date: po.order.expected_date,
            received_date: po.order.received_date,
            subtotal_minor: po.order.subtotal_minor,
            tax_minor: po.order.tax_minor,
            total_minor: po.order.total_minor,
            notes: po.order.notes,
            created_by: po.order.created_by,
            created_at: po.order.created_at,
            updated_at: po.order.updated_at,
            lines: po
                .lines
                .into_iter()
                .map(PurchaseOrderLineDto::from)
                .collect(),
            supplier_name: po.supplier_name,
        }
    }
}

// ── Input DTOs ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Createsupplierargs.
pub struct CreateSupplierArgs {
    /// Code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Contact Person.
    pub contact_person: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Email address.
    pub email: Option<String>,
    /// Street address.
    pub address: Option<String>,
    /// ID of the associated tax.
    pub tax_id: Option<String>,
    /// Payment Terms.
    pub payment_terms: Option<String>,
    /// Notes.
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Updatesupplierargs.
pub struct UpdateSupplierArgs {
    /// Unique identifier.
    pub id: String,
    /// Code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Contact Person.
    pub contact_person: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Email address.
    pub email: Option<String>,
    /// Street address.
    pub address: Option<String>,
    /// ID of the associated tax.
    pub tax_id: Option<String>,
    /// Payment Terms.
    pub payment_terms: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// Current status.
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Polineinput.
pub struct PoLineInput {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Product Name.
    pub product_name: String,
    /// Quantity.
    pub qty: i64,
    /// Unit Cost Minor.
    pub unit_cost_minor: i64,
}

#[derive(Debug, Deserialize)]
/// Createpurchaseorderargs.
pub struct CreatePurchaseOrderArgs {
    /// Po Number.
    pub po_number: String,
    /// ID of the associated supplier.
    pub supplier_id: String,
    /// Expected Date.
    pub expected_date: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// Lines.
    pub lines: Vec<PoLineInput>,
}

#[derive(Debug, Deserialize)]
/// Updatepostatusargs.
pub struct UpdatePoStatusArgs {
    /// Unique identifier.
    pub id: String,
    /// Current status.
    pub status: String,
}

/// Input for receiving one PO line with damage accounting (IPC DTO).
#[derive(Debug, Deserialize)]
pub struct ReceivePoLineDto {
    /// PO line identifier.
    pub line_id: String,
    /// Quantity physically received for this line.
    pub received_qty: i64,
    /// Quantity received but damaged for this line.
    pub damaged_qty: i64,
}

// ── Supplier commands (global database) ─────────────────────────────

/// List suppliers from the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the supplier query fails.
pub async fn list_suppliers(ctx: &BridgeCtx<'_>) -> Result<Vec<SupplierDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let suppliers = Store::new(&db).list_suppliers()?;
    Ok(suppliers.into_iter().map(SupplierDto::from).collect())
}

/// Get one supplier from the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the supplier query fails.
pub async fn get_supplier(
    ctx: &BridgeCtx<'_>,
    id: &str,
) -> Result<Option<SupplierDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let supplier = Store::new(&db).get_supplier(id)?;
    Ok(supplier.map(SupplierDto::from))
}

/// Create a supplier in the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty name/code and
/// [`BridgeError::Core`] on validation or DB failures.
pub async fn create_supplier(
    ctx: &BridgeCtx<'_>,
    args: &CreateSupplierArgs,
) -> Result<SupplierDto, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let db = ctx.lock_global().await;
    let supplier = Store::new(&db).create_supplier(
        args.code.trim(),
        args.name.trim(),
        args.contact_person.as_deref().unwrap_or_default(),
        args.phone.as_deref().unwrap_or_default(),
        args.email.as_deref().unwrap_or_default(),
        args.address.as_deref().unwrap_or_default(),
        args.tax_id.as_deref().unwrap_or_default(),
        args.payment_terms.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
    )?;
    Ok(SupplierDto::from(supplier))
}

/// Update a supplier in the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty name/code and
/// [`BridgeError::Core`] on validation or DB failures.
pub async fn update_supplier(
    ctx: &BridgeCtx<'_>,
    args: &UpdateSupplierArgs,
) -> Result<SupplierDto, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let db = ctx.lock_global().await;
    let supplier = Store::new(&db).update_supplier(
        &args.id,
        args.code.trim(),
        args.name.trim(),
        args.contact_person.as_deref().unwrap_or_default(),
        args.phone.as_deref().unwrap_or_default(),
        args.email.as_deref().unwrap_or_default(),
        args.address.as_deref().unwrap_or_default(),
        args.tax_id.as_deref().unwrap_or_default(),
        args.payment_terms.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
        args.status.as_deref().unwrap_or("active"),
    )?;
    Ok(SupplierDto::from(supplier))
}

// ── Purchase Order commands (global database) ───────────────────────

/// List purchase orders from the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the purchase-order query fails.
pub async fn list_purchase_orders(
    ctx: &BridgeCtx<'_>,
) -> Result<Vec<PurchaseOrderDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let pos = Store::new(&db).list_purchase_orders()?;
    Ok(pos.into_iter().map(PurchaseOrderDto::from).collect())
}

/// Get one purchase order from the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the purchase-order query fails.
pub async fn get_purchase_order(
    ctx: &BridgeCtx<'_>,
    id: &str,
) -> Result<Option<PurchaseOrderDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let po = Store::new(&db).get_purchase_order(id)?;
    Ok(po.map(PurchaseOrderDto::from))
}

/// Create a purchase order in the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty po_number and
/// [`BridgeError::Core`] on validation or DB failures.
pub async fn create_purchase_order(
    ctx: &BridgeCtx<'_>,
    args: &CreatePurchaseOrderArgs,
) -> Result<PurchaseOrderDto, BridgeError> {
    validate_not_empty("po_number", &args.po_number)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let db = ctx.lock_global().await;
    let lines: Vec<CreatePoLineInput> = args
        .lines
        .iter()
        .map(|l| CreatePoLineInput {
            sku: l.sku.clone(),
            product_name: l.product_name.clone(),
            qty: l.qty,
            unit_cost_minor: l.unit_cost_minor,
        })
        .collect();
    let po = Store::new(&db).create_purchase_order(
        args.po_number.trim(),
        &args.supplier_id,
        args.expected_date.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
        None,
        &lines,
    )?;
    Ok(PurchaseOrderDto::from(po))
}

/// Update a purchase order's status in the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the status transition fails.
pub async fn update_po_status(
    ctx: &BridgeCtx<'_>,
    args: &UpdatePoStatusArgs,
) -> Result<PurchaseOrderDto, BridgeError> {
    let db = ctx.lock_global().await;
    let po = Store::new(&db).update_po_status(&args.id, &args.status)?;
    Ok(PurchaseOrderDto::from(po))
}

/// Receive a purchase order in full from the global database.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the receipt fails.
pub async fn receive_purchase_order(
    ctx: &BridgeCtx<'_>,
    id: &str,
) -> Result<PurchaseOrderDto, BridgeError> {
    let db = ctx.lock_global().await;
    let po = Store::new(&db).receive_purchase_order(id)?;
    Ok(PurchaseOrderDto::from(po))
}

/// Receive a purchase order with per-line received/damaged quantities
/// (warehouse Phase 2 — damage marking).
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the receipt fails.
pub async fn receive_purchase_order_with_lines(
    ctx: &BridgeCtx<'_>,
    id: &str,
    lines: &[ReceivePoLineDto],
) -> Result<PurchaseOrderDto, BridgeError> {
    let db = ctx.lock_global().await;
    let input: Vec<ReceivePoLineInput> = lines
        .iter()
        .map(|l| ReceivePoLineInput {
            line_id: l.line_id.clone(),
            received_qty: l.received_qty,
            damaged_qty: l.damaged_qty,
        })
        .collect();
    let po = Store::new(&db).receive_purchase_order_with_lines(id, &input)?;
    Ok(PurchaseOrderDto::from(po))
}

// ── Scoped variants (ADR #7) ────────────────────────────────────────

/// Scoped variant of [`list_suppliers`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:view`, and
/// [`BridgeError::Core`] on store errors.
pub async fn list_suppliers_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<SupplierDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_VIEW)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let suppliers = Store::new(&db).list_suppliers()?;
    Ok(suppliers.into_iter().map(SupplierDto::from).collect())
}

/// Scoped variant of [`get_supplier`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:view`, and
/// [`BridgeError::Core`] on store errors.
pub async fn get_supplier_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<Option<SupplierDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_VIEW)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let supplier = Store::new(&db).get_supplier(id)?;
    Ok(supplier.map(SupplierDto::from))
}

/// Scoped variant of [`create_supplier`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty name/code,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn create_supplier_scoped(
    ctx: &BridgeCtx<'_>,
    args: &CreateSupplierArgs,
    session_token: &str,
) -> Result<SupplierDto, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let supplier = Store::new(&db).create_supplier(
        args.code.trim(),
        args.name.trim(),
        args.contact_person.as_deref().unwrap_or_default(),
        args.phone.as_deref().unwrap_or_default(),
        args.email.as_deref().unwrap_or_default(),
        args.address.as_deref().unwrap_or_default(),
        args.tax_id.as_deref().unwrap_or_default(),
        args.payment_terms.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
    )?;
    Ok(SupplierDto::from(supplier))
}

/// Scoped variant of [`update_supplier`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty name/code,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn update_supplier_scoped(
    ctx: &BridgeCtx<'_>,
    args: &UpdateSupplierArgs,
    session_token: &str,
) -> Result<SupplierDto, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let supplier = Store::new(&db).update_supplier(
        &args.id,
        args.code.trim(),
        args.name.trim(),
        args.contact_person.as_deref().unwrap_or_default(),
        args.phone.as_deref().unwrap_or_default(),
        args.email.as_deref().unwrap_or_default(),
        args.address.as_deref().unwrap_or_default(),
        args.tax_id.as_deref().unwrap_or_default(),
        args.payment_terms.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
        args.status.as_deref().unwrap_or("active"),
    )?;
    Ok(SupplierDto::from(supplier))
}

/// Scoped variant of [`list_purchase_orders`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn list_purchase_orders_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<PurchaseOrderDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let pos = Store::new(&db).list_purchase_orders()?;
    Ok(pos.into_iter().map(PurchaseOrderDto::from).collect())
}

/// Scoped variant of [`get_purchase_order`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:view`, and
/// [`BridgeError::Core`] on store errors.
pub async fn get_purchase_order_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<Option<PurchaseOrderDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_VIEW)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let po = Store::new(&db).get_purchase_order(id)?;
    Ok(po.map(PurchaseOrderDto::from))
}

/// Scoped variant of [`create_purchase_order`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty po_number,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn create_purchase_order_scoped(
    ctx: &BridgeCtx<'_>,
    args: &CreatePurchaseOrderArgs,
    session_token: &str,
) -> Result<PurchaseOrderDto, BridgeError> {
    validate_not_empty("po_number", &args.po_number)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let lines: Vec<CreatePoLineInput> = args
        .lines
        .iter()
        .map(|l| CreatePoLineInput {
            sku: l.sku.clone(),
            product_name: l.product_name.clone(),
            qty: l.qty,
            unit_cost_minor: l.unit_cost_minor,
        })
        .collect();
    let po = Store::new(&db).create_purchase_order(
        args.po_number.trim(),
        &args.supplier_id,
        args.expected_date.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
        None,
        &lines,
    )?;
    Ok(PurchaseOrderDto::from(po))
}

/// Scoped variant of [`update_po_status`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn update_po_status_scoped(
    ctx: &BridgeCtx<'_>,
    args: &UpdatePoStatusArgs,
    session_token: &str,
) -> Result<PurchaseOrderDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let po = Store::new(&db).update_po_status(&args.id, &args.status)?;
    Ok(PurchaseOrderDto::from(po))
}

/// Scoped variant of [`receive_purchase_order`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn receive_purchase_order_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<PurchaseOrderDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let po = Store::new(&db).receive_purchase_order(id)?;
    Ok(PurchaseOrderDto::from(po))
}

/// Scoped variant of [`receive_purchase_order_with_lines`] (ADR #7).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `purchasing:manage`, and
/// [`BridgeError::Core`] on store errors.
pub async fn receive_purchase_order_with_lines_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    lines: &[ReceivePoLineDto],
    session_token: &str,
) -> Result<PurchaseOrderDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    // Receiving a PO mutates stock — require PURCHASING_MANAGE (write),
    // matching receive_purchase_order_scoped, not PURCHASING_VIEW (read).
    ctx.require_session_permission(&session, permissions::PURCHASING_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let input: Vec<ReceivePoLineInput> = lines
        .iter()
        .map(|l| ReceivePoLineInput {
            line_id: l.line_id.clone(),
            received_qty: l.received_qty,
            damaged_qty: l.damaged_qty,
        })
        .collect();
    let po = Store::new(&db).receive_purchase_order_with_lines(id, &input)?;
    Ok(PurchaseOrderDto::from(po))
}

#[cfg(test)]
#[path = "purchasing_tests.rs"]
mod tests;
