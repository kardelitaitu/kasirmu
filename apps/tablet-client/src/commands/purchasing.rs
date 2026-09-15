use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::db::{
    Store,
    purchase_orders::{CreatePoLineInput, ReceivePoLineInput},
};
use oz_core::{PurchaseOrderLine, PurchaseOrderWithLines, Supplier, permissions};

use foundation::validate_not_empty;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

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
#[derive(Debug, serde::Deserialize)]
pub struct ReceivePoLineDto {
    /// PO line identifier.
    pub line_id: String,
    /// Quantity physically received for this line.
    pub received_qty: i64,
    /// Quantity received but damaged for this line.
    pub damaged_qty: i64,
}

// ── Tests ──────────────────────────────────────────────────────────────

/// List suppliers resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_suppliers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let suppliers = store.list_suppliers()?;
    drop(db);
    Ok(suppliers.into_iter().map(SupplierDto::from).collect())
}

/// Get one supplier resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_supplier_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SupplierDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let supplier = store.get_supplier(&id)?;
    drop(db);
    Ok(supplier.map(SupplierDto::from))
}

/// Create a supplier resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_supplier_scoped(
    session_token: String,
    args: CreateSupplierArgs,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    validate_not_empty("name", &args.name).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let supplier = store.create_supplier(
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
    drop(db);
    Ok(SupplierDto::from(supplier))
}

/// Update a supplier resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_supplier_scoped(
    session_token: String,
    args: UpdateSupplierArgs,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    validate_not_empty("name", &args.name).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("code", &args.code).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let supplier = store.update_supplier(
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
    drop(db);
    Ok(SupplierDto::from(supplier))
}

/// List purchase orders resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_purchase_orders_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PurchaseOrderDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let pos = store.list_purchase_orders()?;
    drop(db);
    Ok(pos.into_iter().map(PurchaseOrderDto::from).collect())
}

/// Get one purchase order resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_purchase_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<PurchaseOrderDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let po = store.get_purchase_order(&id)?;
    drop(db);
    Ok(po.map(PurchaseOrderDto::from))
}

/// Create a purchase order resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_purchase_order_scoped(
    session_token: String,
    args: CreatePurchaseOrderArgs,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    validate_not_empty("po_number", &args.po_number)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let lines: Vec<CreatePoLineInput> = args
        .lines
        .into_iter()
        .map(|l| CreatePoLineInput {
            sku: l.sku,
            product_name: l.product_name,
            qty: l.qty,
            unit_cost_minor: l.unit_cost_minor,
        })
        .collect();
    let po = store.create_purchase_order(
        args.po_number.trim(),
        &args.supplier_id,
        args.expected_date.as_deref().unwrap_or_default(),
        args.notes.as_deref().unwrap_or_default(),
        None,
        &lines,
    )?;
    drop(db);
    Ok(PurchaseOrderDto::from(po))
}

/// Update a purchase order's status resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_po_status_scoped(
    session_token: String,
    args: UpdatePoStatusArgs,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let po = store.update_po_status(&args.id, &args.status)?;
    drop(db);
    Ok(PurchaseOrderDto::from(po))
}

/// Receive a purchase order resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn receive_purchase_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let po = store.receive_purchase_order(&id)?;
    drop(db);
    Ok(PurchaseOrderDto::from(po))
}

/// Receive a purchase order with per-line received/damaged quantities resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn receive_purchase_order_with_lines_scoped(
    session_token: String,
    id: String,
    lines: Vec<ReceivePoLineDto>,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PURCHASING_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let input: Vec<ReceivePoLineInput> = lines
        .into_iter()
        .map(|l| ReceivePoLineInput {
            line_id: l.line_id,
            received_qty: l.received_qty,
            damaged_qty: l.damaged_qty,
        })
        .collect();
    let po = store.receive_purchase_order_with_lines(&id, &input)?;
    drop(db);
    Ok(PurchaseOrderDto::from(po))
}

#[cfg(test)]
#[path = "purchasing_tests.rs"]
mod tests;
