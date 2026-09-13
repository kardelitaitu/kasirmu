//! Cloud-side Midtrans QRIS issue ledger (table `midtrans_transactions`,
//! migration `20261004_midtrans_transactions.sql`).
//!
//! Resolves `order_id -> (tenant_id, sale_id)` without depending on the
//! device having synced its sale, which closes the race the
//! `payments JOIN sales` webhook resolver cannot cross: a customer can pay
//! seconds after the QR renders, long before `gateway_reference` reaches the
//! cloud. Written by `payment_api.rs` at issue time (tenant from JWT claims);
//! read and advanced by the `webhooks.rs` notification handler.
//!
//! PostgreSQL arms follow the established split: the pre-tenant lookup runs
//! in a transaction scoped to `oz_webhook_resolver` (BYPASSRLS via
//! membership — same pattern as `lookup_sale_by_gateway_reference`), while
//! every write sets `oz.tenant_id` first so RLS scopes it to one tenant.
//!
//! Idempotency: [`mark_status`] refuses to move a row OUT of a settled
//! status, and the webhook handler treats the row's status as the
//! already-processed gate. Fully concurrent duplicates (both handlers read
//! before either writes) may double-enqueue — a benign no-op on the device —
//! because the alternative order would let a transient enqueue failure eat a
//! paid sale forever.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tokio::sync::Mutex;

/// One ledger row as needed by the webhook handler.
#[derive(Debug, Clone, Serialize)]
pub struct LedgerEntry {
    /// Midtrans `order_id` (also the primary key).
    pub order_id: String,
    /// Tenant that issued the charge (from its JWT claims).
    pub tenant_id: String,
    /// Device-side sale the QR was raised for. No FK: the row is written
    /// before the sale can reach the cloud (claim-before-sale).
    pub sale_id: String,
    /// Requested amount in IDR minor units (for IDR: whole Rupiah).
    pub amount_minor: i64,
    /// ISO currency code (the driver is IDR-fixed; kept for the audit).
    pub currency: String,
    /// Latest status seen: `issued` or a verbatim Midtrans
    /// `transaction_status`.
    pub status: String,
}

/// Shared connection handles so the module serves both `CloudServerState`
/// (webhooks) and `PaymentState` (charge endpoint) without a trait.
#[derive(Clone)]
pub struct LedgerDb {
    /// SQLite connection (single-store / dev deployments).
    pub db: Arc<Mutex<rusqlite::Connection>>,
    /// PostgreSQL pool when running on Postgres (`None` on the SQLite arm).
    pub pg: Option<deadpool_postgres::Pool>,
}

/// RFC3339-millis UTC timestamp, matching the format every sibling writer
/// in this crate uses (`enqueue_finalize_sale`, sync push rows).
fn now_ms() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl LedgerDb {
    /// Record a freshly issued QR. Fails if the `order_id` already exists —
    /// a duplicate means a retry that must not silently re-point the ledger.
    pub async fn record_issue(
        &self,
        order_id: &str,
        tenant_id: &str,
        sale_id: &str,
        amount_minor: i64,
        currency: &str,
    ) -> Result<(), String> {
        let now = now_ms();
        if let Some(pool) = &self.pg {
            let mut client = pool
                .get()
                .await
                .map_err(|e| format!("ledger connect: {e}"))?;
            let tx = client
                .transaction()
                .await
                .map_err(|e| format!("ledger tx: {e}"))?;
            // RLS: scope the write to the issuing tenant (LOCAL, resets on
            // commit) — same discipline as `enqueue_finalize_sale`.
            tx.execute(
                "SELECT set_config('oz.tenant_id', $1, true)",
                &[&tenant_id],
            )
            .await
            .map_err(|e| format!("ledger tenant scope: {e}"))?;
            tx.execute(
                "INSERT INTO midtrans_transactions
                    (order_id, tenant_id, sale_id, amount_minor, currency, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'issued', $6, $6)",
                &[&order_id, &tenant_id, &sale_id, &amount_minor, &currency, &now],
            )
            .await
            .map_err(|e| format!("ledger insert: {e}"))?;
            tx.commit().await.map_err(|e| format!("ledger commit: {e}"))?;
            return Ok(());
        }
        let conn = self.db.lock().await;
        conn.execute(
            "INSERT INTO midtrans_transactions
                (order_id, tenant_id, sale_id, amount_minor, currency, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'issued', ?6, ?6)",
            params![order_id, tenant_id, sale_id, amount_minor, currency, now],
        )
        .map_err(|e| format!("ledger insert: {e}"))?;
        Ok(())
    }

    /// Resolve a notification's `order_id` to its ledger row — deliberately
    /// BEFORE the tenant is known, so the Postgres arm reads through the
    /// signature-verified webhook resolver role exactly as the payment/sales
    /// lookup does. Returns `Ok(None)` for orders this server never issued.
    pub async fn lookup(&self, order_id: &str) -> Result<Option<LedgerEntry>, String> {
        if let Some(pool) = &self.pg {
            let mut client = pool
                .get()
                .await
                .map_err(|e| format!("ledger connect: {e}"))?;
            let tx = client
                .transaction()
                .await
                .map_err(|e| format!("ledger tx: {e}"))?;
            let is_resolver_member: bool = tx
                .query_one(
                    "SELECT EXISTS(
                        SELECT 1 FROM pg_roles r
                        JOIN pg_auth_members m ON m.roleid = r.oid
                        WHERE r.rolname = 'oz_webhook_resolver'
                          AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     )",
                    &[],
                )
                .await
                .map_err(|e| format!("ledger resolver membership: {e}"))?
                .get(0);
            if is_resolver_member {
                tx.execute("SET LOCAL ROLE oz_webhook_resolver", &[])
                    .await
                    .map_err(|e| format!("ledger resolver scope: {e}"))?;
            }
            let row = tx
                .query_opt(
                    "SELECT order_id, tenant_id, sale_id, amount_minor, currency, status
                     FROM midtrans_transactions WHERE order_id = $1 LIMIT 1",
                    &[&order_id],
                )
                .await
                .map_err(|e| format!("ledger lookup: {e}"))?;
            let _ = tx.commit().await;
            return Ok(row.map(|r| LedgerEntry {
                order_id: r.get(0),
                tenant_id: r.get(1),
                sale_id: r.get(2),
                amount_minor: r.get(3),
                currency: r.get(4),
                status: r.get(5),
            }));
        }
        let conn = self.db.lock().await;
        let row = conn
            .query_row(
                "SELECT order_id, tenant_id, sale_id, amount_minor, currency, status
                 FROM midtrans_transactions WHERE order_id = ?1 LIMIT 1",
                params![order_id],
                |r| {
                    Ok(LedgerEntry {
                        order_id: r.get::<_, String>(0)?,
                        tenant_id: r.get::<_, String>(1)?,
                        sale_id: r.get::<_, String>(2)?,
                        amount_minor: r.get::<_, i64>(3)?,
                        currency: r.get::<_, String>(4)?,
                        status: r.get::<_, String>(5)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// Record the latest (non-terminal) status verbatim. A row already in a
    /// settled status is never downgraded — notifications can arrive out of
    /// order and `settlement` must win.
    pub async fn mark_status(
        &self,
        order_id: &str,
        tenant_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let now = now_ms();
        let sql =
            "UPDATE midtrans_transactions SET status = $2, updated_at = $3
             WHERE order_id = $1 AND status NOT IN ('settlement', 'capture')";
        if let Some(pool) = &self.pg {
            let mut client = pool
                .get()
                .await
                .map_err(|e| format!("ledger connect: {e}"))?;
            let tx = client
                .transaction()
                .await
                .map_err(|e| format!("ledger tx: {e}"))?;
            tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                .await
                .map_err(|e| format!("ledger tenant scope: {e}"))?;
            tx.execute(sql, &[&order_id, &status, &now])
                .await
                .map_err(|e| format!("ledger mark: {e}"))?;
            tx.commit().await.map_err(|e| format!("ledger commit: {e}"))?;
            return Ok(());
        }
        let conn = self.db.lock().await;
        let sql3 =
            "UPDATE midtrans_transactions SET status = ?2, updated_at = ?3
             WHERE order_id = ?1 AND status NOT IN ('settlement', 'capture')";
        conn.execute(sql3, params![order_id, status, now])
            .map_err(|e| format!("ledger mark: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "midtrans_ledger_tests.rs"]
mod tests;
