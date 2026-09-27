//! Tax-rate cloud serving layer for the cloud Postgres replica.
//!
//! Owns the `TaxRateWrite` argument shape, the write validator, and the three
//! create/update functions the REST surface dispatches to when a PG pool is
//! configured, together with the scope-resolution helpers they share.
//!
//! Main functions: [`validate_tax_rate_write`], [`create_tax_rate`],
//! [`create_tax_rate_scoped`], [`update_tax_rate_scoped`].
//!
//! Invariant: every statement runs inside one transaction that has already
//! set `oz.tenant_id` LOCAL, exactly like the rest of the `pg` module. The
//! tier-default clearing and scope-existence probes run in that same
//! transaction, so a rate cannot be made default against a scope that does
//! not exist.

use deadpool_postgres::Pool;

use kasirmu_core::db::tax::{TaxRateScope, TaxRateWindow};
use kasirmu_core::tax_rate::TaxRate;

use super::PgError;
use super::helpers::{bump_snapshot_version, is_fk_violation, is_unique_violation, now_rfc3339};

/// The tier and window a tax-rate write is authored into, as the resolver
/// reads them: the tenant-global tier when neither scope column names a row,
/// an unbounded window when neither date is set.
///
/// [TaxRateScope] cannot name a row scoped to BOTH columns, so an ambiguous
/// rate is unrepresentable at this boundary as well as unwritable at the
/// schema CHECK that migration 20260926 rebuilt the table with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaxRateWrite {
    /// Which tier the row prices.
    pub scope: TaxRateScope,
    /// Its validity window: effective_from inclusive, effective_to EXCLUSIVE.
    pub window: TaxRateWindow,
    /// E1-9: the statutory rounding mode the row prices with — '' (store
    /// preference), 'half_up' or 'truncate' (the column core's migration
    /// 20260929 landed). Validated to exactly those three values at the
    /// boundary, mirroring the table CHECK, so a hub-authored mode can
    /// never carry a spelling the branch CHECK would refuse.
    pub rounding_mode: String,
}

impl TaxRateWrite {
    /// The tenant-global, never-expiring write: what a body with no scope and
    /// no window fields means, and what every pre-scoping rate row is.
    #[must_use]
    pub fn tenant_global() -> Self {
        Self {
            scope: TaxRateScope::Global,
            window: TaxRateWindow::default(),
            rounding_mode: String::new(),
        }
    }
}

/// The error naming a scope target this tenant may not write.
///
/// One text for no such row and for a row of another tenant, and a 400 rather
/// than a 404: the missing row is the TARGET, not the resource the request
/// addressed.
fn unknown_scope_target(scope: &TaxRateScope) -> PgError {
    let (table, column, target) = match scope {
        TaxRateScope::Global => {
            return PgError::Validation("the tenant-global tier has no scope target".into());
        }
        TaxRateScope::LegalEntity(id) => ("legal_entities", "legal_entity_id", id.as_str()),
        TaxRateScope::Location(id) => ("locations", "location_id", id.as_str()),
    };
    let msg = format!("{column} {target:?} does not reference an existing {table} of this tenant");
    PgError::Validation(msg)
}

/// Whether the scope names a row that exists AND belongs to tenant_id.
///
/// Two facts, one read, because the foreign key alone gives only the first:
/// legal_entities is on the RLS-exempt list, so a tenant-blind check would let
/// one tenant scope a rate onto another tenant entity, and the branch that pulls
/// the snapshot would then price itself under the wrong rule. Table and column
/// come from the match arms, never from the request body; only the two ids are
/// parameters. The tenant-global tier has no target to check.
async fn scope_target_exists(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
    scope: &TaxRateScope,
) -> Result<bool, PgError> {
    let (table, column, target) = match scope {
        TaxRateScope::Global => return Ok(true),
        TaxRateScope::LegalEntity(id) => ("legal_entities", "legal_entity_id", id.as_str()),
        TaxRateScope::Location(id) => ("locations", "location_id", id.as_str()),
    };
    // Table and column come from the match arms, never from the request.
    let sql =
        format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {column} = $1 AND tenant_id = $2)");
    let exists: bool = tx
        .query_one(&sql, &[&target, &tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .get(0);
    Ok(exists)
}

/// Clear is_default inside ONE tier only: the Postgres twin of the tier-scoped
/// clear core does in db/tax.rs.
///
/// The statement this replaces cleared is_default across the whole tenant, and
/// that stopped being harmless the moment defaults became per-tier: it silently
/// un-defaulted every OTHER tier, so authoring one entity-level default could
/// strip the tenant-global rate every location with no rate of its own was
/// pricing on. Each arm below is that tier partial-unique-index predicate plus
/// the tenant key.
async fn clear_tier_default(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
    scope: &TaxRateScope,
) -> Result<(), PgError> {
    let global_sql = "UPDATE tax_rates SET is_default = 0 WHERE tenant_id = $1 AND is_default = 1 AND legal_entity_id IS NULL AND location_id IS NULL";
    let entity_sql = "UPDATE tax_rates SET is_default = 0 WHERE tenant_id = $1 AND is_default = 1 AND legal_entity_id = $2 AND location_id IS NULL";
    let location_sql = "UPDATE tax_rates SET is_default = 0 WHERE tenant_id = $1 AND is_default = 1 AND location_id = $2";
    match scope {
        TaxRateScope::Global => tx.execute(global_sql, &[&tenant_id]).await,
        TaxRateScope::LegalEntity(entity) => {
            tx.execute(entity_sql, &[&tenant_id, &entity.as_str()])
                .await
        }
        TaxRateScope::Location(location) => {
            tx.execute(location_sql, &[&tenant_id, &location.as_str()])
                .await
        }
    }
    .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Log which per-tier default index a write tripped, then report the 409.
///
/// Both writers clear the tier own default first inside the same transaction,
/// so a hit on one of the three default indexes means a CONCURRENT author
/// claimed the same tier in between: retryable, and a 409 the client can act
/// on, never the 500 an unmapped Db(_) would return.
fn tax_rate_unique_error(e: &tokio_postgres::Error) -> PgError {
    let constraint = e.as_db_error().and_then(|d| d.constraint()).unwrap_or("");
    if constraint.starts_with("idx_tax_rates_default_") {
        tracing::warn!(
            constraint,
            "tax rate tier default claimed by a concurrent author"
        );
    }
    PgError::Conflict
}

/// Validate one request's scope + window into the write both data layers take.
///
/// The boundary half of the scoped-authoring contract: a body may not name BOTH
/// scope arms (the schema CHECK would refuse the row, but the error must say
/// which request field was wrong), a scope id must be non-empty, and the window
/// must be strict `YYYY-MM-DD` with a non-empty period — mirroring the exact
/// rules core's own writers enforce, so a hub-authored row and a device-authored
/// row cannot disagree on shape.
pub fn validate_tax_rate_write(
    legal_entity_id: Option<&str>,
    location_id: Option<&str>,
    effective_from: Option<&str>,
    effective_to: Option<&str>,
    rounding_mode: Option<&str>,
) -> Result<TaxRateWrite, PgError> {
    // E1-9: same three-value set as the tax_rates.rounding_mode CHECK
    // (migration 20260929). '' and None both mean "store preference
    // applies"; anything else is a clean 400, never a silent ''.
    let rounding = match rounding_mode {
        None | Some("") => String::new(),
        Some(m @ ("half_up" | "truncate")) => m.to_owned(),
        Some(other) => {
            return Err(PgError::Validation(format!(
                "rounding_mode: expected '' (store preference), 'half_up' or 'truncate', got {other:?}"
            )));
        }
    };
    let scope = TaxRateScope::classify(legal_entity_id, location_id).ok_or_else(|| {
        PgError::Validation(
            "legal_entity_id and location_id are mutually exclusive: a rate is scoped to a \
             legal entity or to a location, not both"
                .into(),
        )
    })?;
    if let TaxRateScope::LegalEntity(id) | TaxRateScope::Location(id) = &scope
        && id.trim().is_empty()
    {
        return Err(PgError::Validation(
            "scope id must not be empty: omit the field for the tenant-global tier".into(),
        ));
    }
    let window = TaxRateWindow {
        effective_from: effective_from.map(str::to_owned),
        effective_to: effective_to.map(str::to_owned),
    };
    // Window rules mirror core's TaxRateWindow::validate (private — the
    // boundary repeats them rather than widening core for one caller).
    for (field, value) in [
        ("effective_from", &window.effective_from),
        ("effective_to", &window.effective_to),
    ] {
        if let Some(v) = value
            && chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_err()
        {
            return Err(PgError::Validation(format!(
                "{field}: expected a business date 'YYYY-MM-DD', got {v:?}"
            )));
        }
    }
    if let (Some(from), Some(to)) = (&window.effective_from, &window.effective_to) {
        // Both arms parsed above, so these defaults are unreachable.
        let from =
            chrono::NaiveDate::parse_from_str(from, "%Y-%m-%d").unwrap_or(chrono::NaiveDate::MIN);
        let to =
            chrono::NaiveDate::parse_from_str(to, "%Y-%m-%d").unwrap_or(chrono::NaiveDate::MAX);
        if from >= to {
            return Err(PgError::Validation(format!(
                "effective_to: {to} must fall after effective_from {from}; the end date is \
                 exclusive, so equal dates cover no period at all"
            )));
        }
    }
    Ok(TaxRateWrite {
        scope,
        window,
        rounding_mode: rounding,
    })
}

/// Bounds every tax-rate write shares, so the global and scoped entry points
/// cannot drift apart.
fn validate_tax_rate_identity(name: &str, rate_bps: i64) -> Result<(), PgError> {
    if name.trim().is_empty() {
        return Err(PgError::Validation(
            "tax rate name must not be empty".into(),
        ));
    }
    if rate_bps < 0 {
        return Err(PgError::Validation("rate_bps must be non-negative".into()));
    }
    Ok(())
}
/// Create a tenant-global tax rate, scoped to tenant_id.
///
/// Thin delegation to [create_tax_rate_scoped] with the global write, so the
/// pre-scoping entry point (still what a body without scope fields means, and
/// still what this module PG tests call) cannot drift from the scoped one on
/// validation, the tenant GUC, the default swap or the snapshot bump.
pub async fn create_tax_rate(
    pool: &Pool,
    tenant_id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    is_inclusive: bool,
) -> Result<TaxRate, PgError> {
    create_tax_rate_scoped(
        pool,
        tenant_id,
        name,
        rate_bps,
        is_default,
        is_inclusive,
        &TaxRateWrite::tenant_global(),
    )
    .await
}

/// Insert a tax rate at an explicit tier and window, scoped to tenant_id.
///
/// The hub scoped-rate authoring door. Order is load-bearing: the scope target
/// is resolved BEFORE the INSERT (a typed 400 naming the column, not a bare FK
/// violation), the tier own default is cleared BEFORE the INSERT (that tier
/// unique index is immediate, so claiming the flag while a peer of the same
/// tier still holds it fails), and both happen inside ONE transaction that has
/// already set the RLS tenant GUC LOCAL. legal_entity_id, location_id,
/// effective_from and effective_to are parameters 9 to 12; a None binds SQL
/// NULL, which IS the answer tenant-global tier or unbounded window to the
/// resolver.
pub async fn create_tax_rate_scoped(
    pool: &Pool,
    tenant_id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    is_inclusive: bool,
    write: &TaxRateWrite,
) -> Result<TaxRate, PgError> {
    validate_tax_rate_identity(name, rate_bps)?;

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    let guc_sql = "SELECT set_config($1, $2, true)";
    tx.execute(guc_sql, &[&"oz.tenant_id", &tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    if !scope_target_exists(&tx, tenant_id, &write.scope).await? {
        return Err(unknown_scope_target(&write.scope));
    }

    if is_default {
        clear_tier_default(&tx, tenant_id, &write.scope).await?;
    }

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    let (entity, location) = write.scope.scope_columns();
    let insert_sql = "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, tenant_id, legal_entity_id, location_id, effective_from, effective_to, rounding_mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)";
    if let Err(e) = tx
        .execute(
            insert_sql,
            &[
                &id,
                &name.trim(),
                &rate_bps,
                &(is_default as i64),
                &(is_inclusive as i64),
                &now,
                &now,
                &tenant_id,
                &entity,
                &location,
                &write.window.effective_from,
                &write.window.effective_to,
                &write.rounding_mode,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(tax_rate_unique_error(&e));
        }
        if is_fk_violation(&e) {
            return Err(unknown_scope_target(&write.scope));
        }
        return Err(PgError::Db(e.to_string()));
    }

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(TaxRate {
        id,
        name: name.trim().to_owned(),
        rate_bps,
        is_default,
        is_inclusive,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Rewrite an existing tax rate in place: its fields, tier and window together.
///
/// The cloud twin of core Store::update_tax_rate_scoped. The row is read inside
/// the transaction so created_at survives unchanged (a rewrite is not a
/// re-creation), and the tenant filter sits in the SAME predicate as the TAX-03
/// is_active guard: another tenant row, an archived row and a missing row all
/// answer 404, because confirming that a row belongs to somebody else is not
/// this endpoint to say. Moving a row between tiers is allowed; the tier it
/// leaves then has no default, which is why the flag is only ever claimed inside
/// the tier being written.
#[allow(clippy::too_many_arguments)]
pub async fn update_tax_rate_scoped(
    pool: &Pool,
    tenant_id: &str,
    id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    is_inclusive: bool,
    write: &TaxRateWrite,
) -> Result<TaxRate, PgError> {
    validate_tax_rate_identity(name, rate_bps)?;

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let guc_sql = "SELECT set_config($1, $2, true)";
    tx.execute(guc_sql, &[&"oz.tenant_id", &tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let find_sql =
        "SELECT created_at FROM tax_rates WHERE id = $1 AND tenant_id = $2 AND is_active = 1";
    let created_at: Option<String> = tx
        .query_opt(find_sql, &[&id, &tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|row| row.get("created_at"));
    let Some(created_at) = created_at else {
        return Err(PgError::NotFound);
    };

    if !scope_target_exists(&tx, tenant_id, &write.scope).await? {
        return Err(unknown_scope_target(&write.scope));
    }

    if is_default {
        clear_tier_default(&tx, tenant_id, &write.scope).await?;
    }

    let now = now_rfc3339();
    let (entity, location) = write.scope.scope_columns();
    let update_sql = "UPDATE tax_rates SET name = $1, rate_bps = $2, is_default = $3, is_inclusive = $4, legal_entity_id = $5, location_id = $6, effective_from = $7, effective_to = $8, updated_at = $9, rounding_mode = $10 WHERE id = $11 AND tenant_id = $12 AND is_active = 1";
    if let Err(e) = tx
        .execute(
            update_sql,
            &[
                &name.trim(),
                &rate_bps,
                &(is_default as i64),
                &(is_inclusive as i64),
                &entity,
                &location,
                &write.window.effective_from,
                &write.window.effective_to,
                &now,
                &write.rounding_mode,
                &id,
                &tenant_id,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(tax_rate_unique_error(&e));
        }
        if is_fk_violation(&e) {
            return Err(unknown_scope_target(&write.scope));
        }
        return Err(PgError::Db(e.to_string()));
    }

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(TaxRate {
        id: id.to_owned(),
        name: name.trim().to_owned(),
        rate_bps,
        is_default,
        is_inclusive,
        created_at,
        updated_at: now,
    })
}
