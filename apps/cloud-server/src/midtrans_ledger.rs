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
//! Idempotency: [`mark_status`](crate::midtrans_ledger::LedgerDb::mark_status)
//! refuses to move a row OUT of any TERMINAL
//! status, and the webhook handler treats the row's status as the
//! already-processed gate. Fully concurrent duplicates (both handlers read
//! before either writes) may double-enqueue — a benign no-op on the device —
//! because the alternative order would let a transient enqueue failure eat a
//! paid sale forever.
//!
//! **The terminal set is three statuses and lives in exactly two places that
//! must agree**: `mark_status`'s SQL guard (Postgres and SQLite arms) and the
//! webhook's `already_processed` check
//! (`webhooks/midtrans.rs:219-221`). They are `settlement`, `capture` and
//! `amount_mismatch`. **`amount_mismatch` is NOT a settled status** — it is an
//! INCIDENT status, written when a correctly-signed settlement disagrees with the
//! amount charged — and it belongs in the set for the opposite reason to the
//! other two: a settlement must not be downgraded because the money arrived, and a
//! mismatch must not be overwritten because the discrepancy still needs a human.
//! Dropping it from either list silently erases an incident record while leaving
//! the discrepancy in place; that is the defect `16a2f454c` fixed, and this
//! paragraph exists so the next editor changing one list sees the other.

use std::sync::Arc;

use rusqlite::OptionalExtension as _;
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

/// Decide whether an existing `order_id` row is a REPLAY of the call in hand or a
/// COLLISION with a different charge.
///
/// Extracted so the Postgres and SQLite arms cannot drift: they read the same
/// four columns and must reach the same verdict, and a rule written twice is a
/// rule that will eventually be one rule and one bug.
///
/// `None` means the row vanished between the conflict and the read — treated as a
/// collision, because the alternative is reporting success for a write that is
/// not there.
fn check_replay(
    existing: Option<(String, String, i64, String)>,
    order_id: &str,
    tenant_id: &str,
    sale_id: &str,
    amount_minor: i64,
    currency: &str,
) -> Result<(), String> {
    let Some((t, s, a, c)) = existing else {
        return Err(format!(
            "ledger row for {order_id} disappeared between the insert conflict and the replay read"
        ));
    };
    if t == tenant_id && s == sale_id && a == amount_minor && c == currency {
        // The same charge, retried. The ledger already says exactly this.
        return Ok(());
    }
    Err(format!(
        "ledger order_id collision: {order_id} is already recorded for tenant {t}, \
         sale {s}, {a} {c}, but this charge is tenant {tenant_id}, sale {sale_id}, \
         {amount_minor} {currency} — refusing to re-point it"
    ))
}

impl LedgerDb {
    /// Record a freshly issued QR.
    ///
    /// **Idempotent on a replay, strict on a collision** (R9(a), owner
    /// 2026-09-20; `done-todo-owner-rulings.md:246`). The two cases used to be
    /// one, and that was a latent defect the gate-key derivation exposed: since
    /// the driver now reuses the gateway key on a retry
    /// (`drivers/qris.rs:338-352`), a timeout-plus-retry arrives with the SAME
    /// `order_id` — and a bare INSERT answered `UNIQUE constraint failed`, so a
    /// charge that had already been issued was reported as
    /// `500 charge issued but not journaled`. That is the worst possible
    /// outcome: the QR is live, the caller sees a failure, and the recovery it
    /// asks for is manual reconciliation of a row that is already correct.
    ///
    /// So an existing row is compared field by field. Identical
    /// `(tenant_id, sale_id, amount_minor, currency)` is a REPLAY and returns
    /// `Ok(())` — the ledger already says exactly what this call would write.
    /// Any difference is a genuine collision on a primary key two different
    /// charges are claiming, which must still fail loudly, because silently
    /// re-pointing `order_id` would attribute one sale's settlement to another.
    /// The original invariant is therefore preserved rather than relaxed.
    ///
    /// # Errors
    ///
    /// Returns `Err` on a connection, transaction or write failure, and on a
    /// collision whose stored facts differ from the ones supplied.
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
            tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                .await
                .map_err(|e| format!("ledger tenant scope: {e}"))?;
            // ON CONFLICT DO NOTHING makes the replay a no-op at the storage
            // layer; the follow-up read then decides replay vs collision.
            let inserted = tx
                .execute(
                    "INSERT INTO midtrans_transactions
                        (order_id, tenant_id, sale_id, amount_minor, currency, status, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, 'issued', $6, $6)
                     ON CONFLICT (order_id) DO NOTHING",
                    &[&order_id, &tenant_id, &sale_id, &amount_minor, &currency, &now],
                )
                .await
                .map_err(|e| format!("ledger insert: {e}"))?;
            if inserted == 0 {
                let row = tx
                    .query_opt(
                        "SELECT tenant_id, sale_id, amount_minor, currency
                         FROM midtrans_transactions WHERE order_id = $1",
                        &[&order_id],
                    )
                    .await
                    .map_err(|e| format!("ledger replay read: {e}"))?;
                check_replay(
                    row.as_ref().map(|r| {
                        (
                            r.get::<_, String>(0),
                            r.get::<_, String>(1),
                            r.get::<_, i64>(2),
                            r.get::<_, String>(3),
                        )
                    }),
                    order_id,
                    tenant_id,
                    sale_id,
                    amount_minor,
                    currency,
                )?;
            }
            tx.commit()
                .await
                .map_err(|e| format!("ledger commit: {e}"))?;
            return Ok(());
        }
        let conn = self.db.lock().await;
        let inserted = conn
            .execute(
                "INSERT INTO midtrans_transactions
                    (order_id, tenant_id, sale_id, amount_minor, currency, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'issued', ?6, ?6)
                 ON CONFLICT (order_id) DO NOTHING",
                params![order_id, tenant_id, sale_id, amount_minor, currency, now],
            )
            .map_err(|e| format!("ledger insert: {e}"))?;
        if inserted == 0 {
            let existing: Option<(String, String, i64, String)> = conn
                .query_row(
                    "SELECT tenant_id, sale_id, amount_minor, currency
                     FROM midtrans_transactions WHERE order_id = ?1",
                    params![order_id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, i64>(2)?,
                            r.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| format!("ledger replay read: {e}"))?;
            check_replay(
                existing,
                order_id,
                tenant_id,
                sale_id,
                amount_minor,
                currency,
            )?;
        }
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
        // The terminal set is THREE statuses, not two. `amount_mismatch` is written
        // by the webhook when a correctly-signed settlement disagrees with the amount
        // we charged (`webhooks/midtrans.rs:212`), and that same file treats it as
        // terminal when deciding whether a redelivery is already processed
        // (`:219-221`). Leaving it out here made the incident record overwritable by
        // any later notification — Midtrans redelivers as a matter of course, and a
        // `pending` or `expire` follow-up is ordinary — so the flag that exists to
        // make a money discrepancy visible could be erased while the discrepancy
        // itself remained. The two lists are now the same list.
        let sql = "UPDATE midtrans_transactions SET status = $2, updated_at = $3
             WHERE order_id = $1 AND status NOT IN ('settlement', 'capture', 'amount_mismatch')";
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
            tx.commit()
                .await
                .map_err(|e| format!("ledger commit: {e}"))?;
            return Ok(());
        }
        let conn = self.db.lock().await;
        // SQLite arm: same three-status terminal set as the Postgres arm above.
        let sql3 = "UPDATE midtrans_transactions SET status = ?2, updated_at = ?3
             WHERE order_id = ?1 AND status NOT IN ('settlement', 'capture', 'amount_mismatch')";
        conn.execute(sql3, params![order_id, status, now])
            .map_err(|e| format!("ledger mark: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "midtrans_ledger_tests.rs"]
mod tests;
