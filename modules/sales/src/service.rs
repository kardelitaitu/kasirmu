//! Sales Service — domain business logic, checkout orchestration, and event dispatching.
/*
last audited 25-07-26 by RSA-Agent (modules-sales slice B: service deep read)
crate: modules-sales | status: SAFE | lint: CLEAN
findings: MSL-2 FIXED — void_sale enforces the transition matrix (Active-to-Voided only via SaleStatus::can_transition_to; Completed sales are rejected with refund-flow guidance): the guard only rejects an already-voided sale, then writes SaleStatus::Voided directly via update_sale_status, which previously let a COMPLETED sale be voided without transition_to (which forbids Completed-to-Voided); voiding also neither records a Refund nor restores stock, so the refund path (Refund model) should be the route for completed sales. Proposed: enforce the transition matrix here (Active-to-Voided only; route Completed-to-Voided to the refund flow or make the bypass an explicit policy). process_checkout is clean: cart construction validated, double transition enforces the DAG, tx-scoped insert, versioned
next: none | perf: N/A
MSL-2 is CLOSED: void_sale enforces the transition matrix via
SaleStatus::can_transition_to(sale.status, SaleStatus::Voided) at
service.rs:76, so an already-voided sale is rejected and a Completed sale is
refused with refund-flow guidance instead of being voided directly, verified
2026-10-04.
*/

use crate::error::SalesError;
use foundation::{Cart, SaleStatus};
use rusqlite::Connection;

use crate::models::Sale;
use crate::repository::SalesRepository;

/// Service encapsulating sales workflows and business operations.
pub struct SalesService;

impl SalesService {
    /// Create a new sale from a cart, persist it, and transition it to Completed state.
    pub fn process_checkout(
        conn: &mut Connection,
        cart: &Cart,
        user_id: Option<String>,
        payment_method: String,
    ) -> Result<Sale, SalesError> {
        let mut sale = Sale::from_cart_with_user(cart, user_id).ok_or_else(|| {
            SalesError::validation("cart", "failed to construct sale from cart — corrupt total")
        })?;

        sale.payment_method = Some(payment_method);
        sale.transition_to(SaleStatus::Active)?;
        sale.transition_to(SaleStatus::Completed)?;

        let tx = conn.transaction()?;
        {
            let repo = SalesRepository::new(&tx);
            repo.create_sale_tx(&tx, &sale)?;
        }
        tx.commit()?;

        Ok(sale)
    }

    /// Retrieve sale by ID using `SalesRepository`.
    pub fn get_sale(conn: &Connection, id: &str) -> Result<Option<Sale>, SalesError> {
        let repo = SalesRepository::new(conn);
        repo.get_sale(id)
    }

    /// Void an active sale.
    ///
    /// MSL-2 fix: the transition matrix (`SaleStatus::can_transition_to`)
    /// allows only Active→Voided. The previous guard rejected just an
    /// already-voided sale and wrote `Voided` unconditionally, so a
    /// Completed sale could be voided — even though `transition_to`
    /// forbids Completed→Voided — with no refund recorded and no stock
    /// restored. Completed sales must go through the refund flow
    /// (`Refund` model) instead.
    pub fn void_sale(conn: &Connection, id: &str) -> Result<(), SalesError> {
        let repo = SalesRepository::new(conn);
        let sale = repo.get_sale(id)?.ok_or_else(|| SalesError::NotFound {
            entity: "sale",
            id: id.to_string(),
        })?;

        if sale.status == SaleStatus::Voided {
            return Err(SalesError::validation("status", "sale is already voided"));
        }

        if !SaleStatus::can_transition_to(sale.status, SaleStatus::Voided) {
            return Err(SalesError::validation(
                "status",
                format!(
                    "cannot void a {:?} sale; completed sales must go through the refund flow",
                    sale.status
                ),
            ));
        }

        repo.update_sale_status(id, SaleStatus::Voided)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
