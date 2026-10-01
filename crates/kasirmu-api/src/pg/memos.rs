//! Memo cloud-read serving layer for the cloud Postgres replica.
//!
//! Memos are authored on the desktop (local SQLite) and must display on
//! KDS/tablet terminals whose local `memos` table is structurally empty, so
//! cloud Postgres is the serving layer: the desktop pushes the tenant's
//! COMPLETE memo state (reconciling upsert — self-healing, no tombstones),
//! terminals ack through the cloud, and terminals read their active memos
//! from here.
//!
//! Key types: [`MemoSyncRow`]/[`MemoRecipientSyncRow`] (push wire shape),
//! [`ActiveMemoPg`] (terminal read shape), [`MemoSyncResult`]/
//! [`MemoAckResult`] (outcomes). Main functions: [`sync_memos`],
//! [`ack_memo`], [`list_active_memos_for_terminal`].
//!
//! Invariant: every statement runs inside one transaction that has already
//! set `oz.tenant_id` LOCAL, exactly like the rest of the `pg` module.

use deadpool_postgres::Pool;

use super::PgError;

/// One memo + its derived audience, as the desktop pushes it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoSyncRow {
    /// Memo id (UUID v7, desktop-minted).
    pub id: String,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot at publish time.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Lifecycle status (`draft`/`published`/`expired`/`stopped`/`archived`).
    pub status: String,
    /// Display duration (`12h`/`24h`/`3d`/`7d`/`30d`).
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant (ISO-8601), if published.
    #[serde(default)]
    pub published_at: Option<String>,
    /// Expiry instant (ISO-8601), if published.
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Early-stop instant, if stopped.
    #[serde(default)]
    pub stopped_at: Option<String>,
    /// Who stopped it.
    #[serde(default)]
    pub stopped_by: Option<String>,
    /// Archival instant — the retention-deletion clock.
    #[serde(default)]
    pub archived_at: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last-update timestamp.
    pub updated_at: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    #[serde(default)]
    pub location_ids: Vec<String>,
    /// The published fan-out: one recipient per target terminal.
    #[serde(default)]
    pub recipients: Vec<MemoRecipientSyncRow>,
}

/// One recipient row of a pushed memo.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoRecipientSyncRow {
    /// Recipient row id (desktop-minted).
    pub id: String,
    /// The terminal this row addresses.
    pub terminal_id: String,
    /// Delivery state (`pending`/`delivered`/`acknowledged`).
    pub delivery_status: String,
    /// Delivery instant, if delivered.
    #[serde(default)]
    pub delivered_at: Option<String>,
    /// Acknowledgement instant, if acknowledged.
    #[serde(default)]
    pub acknowledged_at: Option<String>,
    /// Who acknowledged.
    #[serde(default)]
    pub acknowledged_by: Option<String>,
}

/// Result of the reconciling memo push.
#[derive(Debug, serde::Serialize)]
pub struct MemoSyncResult {
    /// Memos upserted (the snapshot size).
    pub upserted: i64,
    /// Memo rows deleted because the desktop no longer has them.
    pub deleted: i64,
}

/// Reconcile the tenant's memo state in PG with the desktop's snapshot.
///
/// The snapshot IS the truth for memo CONTENT and row EXISTENCE: every memo
/// in it is upserted (`ON CONFLICT (id)`), its targeting rows replaced, and
/// any PG memo of this tenant NOT present in the snapshot is deleted (its
/// children cascade) — the desktop-side retention delete propagates by
/// omission. Recipient rows reconcile by EXISTENCE but their DELIVERY STATE
/// merges monotonically (pending < delivered < acknowledged): memos reach
/// terminals through the cloud, so acks land here (`ack_memo`) while the
/// desktop still holds older state, and a wholesale replace would downgrade
/// them on every push.
/// Idempotent: pushing the same state twice is a no-op the second time.
/// The memo's CHECK constraints on status/duration reject garbage payloads.
pub async fn sync_memos(
    pool: &Pool,
    tenant_id: &str,
    memos: &[MemoSyncRow],
) -> Result<MemoSyncResult, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    for m in memos {
        tx.execute(
            "INSERT INTO memos (id, tenant_id, author_user_id, author_role, title, body,
                                status, duration, revision, published_at, expires_at,
                                stopped_at, stopped_by, archived_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO UPDATE SET
                author_user_id = EXCLUDED.author_user_id,
                author_role = EXCLUDED.author_role,
                title = EXCLUDED.title,
                body = EXCLUDED.body,
                status = EXCLUDED.status,
                duration = EXCLUDED.duration,
                revision = EXCLUDED.revision,
                published_at = EXCLUDED.published_at,
                expires_at = EXCLUDED.expires_at,
                stopped_at = EXCLUDED.stopped_at,
                stopped_by = EXCLUDED.stopped_by,
                archived_at = EXCLUDED.archived_at,
                updated_at = EXCLUDED.updated_at",
            &[
                &m.id,
                &tenant_id,
                &m.author_user_id,
                &m.author_role,
                &m.title,
                &m.body,
                &m.status,
                &m.duration,
                &m.revision,
                &m.published_at,
                &m.expires_at,
                &m.stopped_at,
                &m.stopped_by,
                &m.archived_at,
                &m.created_at,
                &m.updated_at,
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

        // Targeting is small and derived: replace the set wholesale so a
        // desktop-side change can never leave a stale row behind.
        tx.execute("DELETE FROM memo_locations WHERE memo_id = $1", &[&m.id])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        for location_id in &m.location_ids {
            tx.execute(
                "INSERT INTO memo_locations (memo_id, location_id, tenant_id) VALUES ($1, $2, $3)",
                &[&m.id, location_id, &tenant_id.to_string()],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        }

        // Recipients are MERGED, not replaced: memos now reach terminals
        // through the cloud (2026-09-07 cloud-read ruling), so a recipient
        // row's delivery state can advance here (terminal acks land via
        // `ack_memo`) while the desktop still holds the older state. A
        // wholesale replace would downgrade cloud-side acks on every push;
        // instead the higher-ranked state wins (pending < delivered <
        // acknowledged), with the desktop winning ties (it is the
        // authoring authority and equal ranks cannot regress). Existence
        // still reconciles by omission below — a recipient the desktop no
        // longer has is gone for good.
        let existing: std::collections::HashMap<String, i32> = {
            let rows = tx
                .query(
                    "SELECT terminal_id, CASE delivery_status
                                        WHEN 'pending' THEN 0
                                        WHEN 'delivered' THEN 1
                                        ELSE 2 END AS rank
                     FROM memo_recipients WHERE memo_id = $1",
                    &[&m.id],
                )
                .await
                .map_err(|e| PgError::Db(e.to_string()))?;
            rows.iter()
                .map(|r| (r.get::<_, String>(0), r.get::<_, i32>(1)))
                .collect()
        };
        for r in &m.recipients {
            let incoming_rank = match r.delivery_status.as_str() {
                "pending" => 0,
                "delivered" => 1,
                _ => 2,
            };
            let keep_existing = existing
                .get(&r.terminal_id)
                .is_some_and(|existing_rank| *existing_rank > incoming_rank);
            if keep_existing {
                continue;
            }
            tx.execute(
                "INSERT INTO memo_recipients (id, memo_id, terminal_id, delivery_status,
                                             delivered_at, acknowledged_at, acknowledged_by, tenant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (memo_id, terminal_id) DO UPDATE SET
                    delivery_status = EXCLUDED.delivery_status,
                    delivered_at = EXCLUDED.delivered_at,
                    acknowledged_at = EXCLUDED.acknowledged_at,
                    acknowledged_by = EXCLUDED.acknowledged_by,
                    id = EXCLUDED.id",
                &[
                    &r.id,
                    &m.id,
                    &r.terminal_id,
                    &r.delivery_status,
                    &r.delivered_at,
                    &r.acknowledged_at,
                    &r.acknowledged_by,
                    &tenant_id.to_string(),
                ],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        }
        // Existence reconcile: drop recipients the snapshot no longer
        // carries (only possible when the memo itself is leaving, whose
        // rows cascade, or a backup restore rewound the desktop).
        let terminals: Vec<String> = m.recipients.iter().map(|r| r.terminal_id.clone()).collect();
        tx.execute(
            "DELETE FROM memo_recipients WHERE memo_id = $1 AND NOT (terminal_id = ANY($2))",
            &[&m.id, &terminals],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    // Reconciliation: drop every tenant memo the desktop did not push. The
    // snapshot is the complete non-deleted set, so absence IS the deletion
    // signal (the retention sweep's deletes propagate here naturally).
    let ids: Vec<String> = memos.iter().map(|m| m.id.clone()).collect();
    let deleted = tx
        .execute(
            "DELETE FROM memos WHERE tenant_id = $1 AND NOT (id = ANY($2))",
            &[&tenant_id.to_string(), &ids],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(MemoSyncResult {
        upserted: memos.len() as i64,
        deleted: deleted as i64,
    })
}

/// Outcome of a terminal acknowledgement call.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoAckResult {
    /// The memo that was acknowledged.
    pub memo_id: String,
    /// The terminal whose recipient row moved.
    pub terminal_id: String,
    /// The recipient's delivery state after the call (always
    /// `acknowledged` — the call is a no-op if it already was).
    pub delivery_status: String,
    /// When the acknowledgement landed.
    pub acknowledged_at: String,
    /// True when THIS call moved the row (`pending`/`delivered` →
    /// `acknowledged`); false when it was already acknowledged.
    pub changed: bool,
}

/// Record a terminal's acknowledgement of a memo directly in PG.
///
/// This is the upstream half of the cloud-read path: memos reach a
/// terminal through the cloud, so the ack must flow back through the
/// cloud too — the tablet's local `memo_recipients` table is
/// structurally empty and the desktop only learns ack state through the
/// next push's monotonic merge (see `sync_memos`).
///
/// Semantics mirror `Store::acknowledge_memo`: an ack proves receipt, so
/// `delivered_at` is backfilled when the row is still `pending`; a
/// second ack is a no-op success (`changed: false`); an unknown
/// recipient is `NotFound`. The terminal comes from the authenticated
/// claims — the caller cannot name another terminal — and the row's
/// tenant was stamped at push time from the same claim source.
pub async fn ack_memo(
    pool: &Pool,
    tenant_id: &str,
    memo_id: &str,
    terminal_id: &str,
    acknowledged_by: Option<&str>,
) -> Result<MemoAckResult, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let changed = tx
        .execute(
            "UPDATE memo_recipients
             SET delivery_status = 'acknowledged',
                 delivered_at = COALESCE(delivered_at, $3),
                 acknowledged_at = $3,
                 acknowledged_by = COALESCE($4, acknowledged_by)
             WHERE memo_id = $1 AND terminal_id = $2
               AND delivery_status IN ('pending', 'delivered')",
            &[&memo_id, &terminal_id, &now, &acknowledged_by],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    if changed == 0 {
        // Either the recipient does not exist or it is already
        // acknowledged — distinguish so an already-acked memo stays a
        // no-op success (the UI's re-ack must not 404).
        // A `None` below is AMBIGUOUS: the recipient row may be genuinely
        // absent (NotFound is then correct) or the SELECT may have failed on a
        // row that exists — e.g. an already-acknowledged one, which should have
        // returned the no-op success above and now reads as a 404. The
        // fall-through is deliberate: the UPDATE's `changed == 0` is the
        // authoritative write-side backstop (nothing was written either way),
        // and the warning is how you tell the two None cases apart.
        let existing: Option<String> = match tx
            .query_one(
                "SELECT delivery_status FROM memo_recipients
                 WHERE memo_id = $1 AND terminal_id = $2",
                &[&memo_id, &terminal_id],
            )
            .await
        {
            Ok(row) => Some(row.get(0)),
            Err(e) => {
                tracing::warn!(
                    tenant_id = %tenant_id,
                    memo_id = %memo_id,
                    terminal_id = %terminal_id,
                    operation = "ack_memo delivery_status read",
                    error = %e,
                    "memo recipient lookup failed after a no-op ack; answering NotFound"
                );
                None
            }
        };
        match existing.as_deref() {
            Some("acknowledged") => {
                let acknowledged_at: String = tx
                    .query_one(
                        "SELECT COALESCE(acknowledged_at, $3) FROM memo_recipients
                         WHERE memo_id = $1 AND terminal_id = $2",
                        &[&memo_id, &terminal_id, &now],
                    )
                    .await
                    .map_err(|e| PgError::Db(e.to_string()))?
                    .get(0);
                tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
                return Ok(MemoAckResult {
                    memo_id: memo_id.to_string(),
                    terminal_id: terminal_id.to_string(),
                    delivery_status: "acknowledged".to_string(),
                    acknowledged_at,
                    changed: false,
                });
            }
            _ => return Err(PgError::NotFound),
        }
    }

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(MemoAckResult {
        memo_id: memo_id.to_string(),
        terminal_id: terminal_id.to_string(),
        delivery_status: "acknowledged".to_string(),
        acknowledged_at: now,
        changed: true,
    })
}

/// One active memo served to a terminal, mirroring the banner's read shape.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActiveMemoPg {
    /// Memo id.
    pub id: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    pub location_ids: Vec<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Display duration.
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant.
    pub published_at: Option<String>,
    /// Expiry instant.
    pub expires_at: Option<String>,
    /// Creation timestamp (the tablet's display DTO requires it).
    pub created_at: String,
    /// This terminal's delivery state.
    pub delivery_status: String,
}

/// Read the memos a terminal should currently display, tenant-scoped by RLS
/// and audience-scoped by the recipient join — the PG twin of
/// `Store::list_active_for_terminal` (Location stacked above Organization,
/// newest-published first, expiry checked in the WHERE so an un-swept row
/// cannot display past its deadline).
pub async fn list_active_memos_for_terminal(
    pool: &Pool,
    tenant_id: &str,
    terminal_id: &str,
    now: &str,
) -> Result<Vec<ActiveMemoPg>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let rows = tx
        .query(
            "SELECT m.id, m.author_user_id, m.author_role, m.title, m.body,
                    m.duration, m.revision, m.published_at, m.expires_at,
                    m.created_at, r.delivery_status,
                    (SELECT string_agg(ml.location_id, ',')
                     FROM memo_locations ml WHERE ml.memo_id = m.id) AS location_ids_csv
             FROM memos m
             JOIN memo_recipients r ON r.memo_id = m.id
             WHERE m.tenant_id = $1 AND r.terminal_id = $2
               AND m.status = 'published'
               AND (m.expires_at IS NULL OR m.expires_at > $3)
             ORDER BY (EXISTS (SELECT 1 FROM memo_locations ml WHERE ml.memo_id = m.id)) DESC,
                      m.published_at DESC",
            &[
                &tenant_id.to_string(),
                &terminal_id.to_string(),
                &now.to_string(),
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let location_ids_csv: Option<String> = row.get("location_ids_csv");
        out.push(ActiveMemoPg {
            id: row.get("id"),
            location_ids: location_ids_csv
                .map(|csv| {
                    csv.split(',')
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            author_user_id: row.get("author_user_id"),
            author_role: row.get("author_role"),
            title: row.get("title"),
            body: row.get("body"),
            duration: row.get("duration"),
            revision: row.get("revision"),
            published_at: row.get("published_at"),
            expires_at: row.get("expires_at"),
            created_at: row.get("created_at"),
            delivery_status: row.get("delivery_status"),
        });
    }
    Ok(out)
}
