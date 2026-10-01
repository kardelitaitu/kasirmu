//! Tenant-plan serving layer for the cloud Postgres replica.
//!
//! Reads and writes a tenant's sync plan. Both functions are reached through
//! `crate::pg::<name>`; the re-export in `pg.rs` keeps the route handlers and
//! `apps/cloud-server`'s webhook path unchanged.

use deadpool_postgres::Pool;

use kasirmu_core::TenantPlan;

use super::PgError;

use super::helpers::now_rfc3339;

/// Read a tenant's sync plan, or `None` when the tenant has no row.
pub async fn get_tenant_plan(pool: &Pool, tenant_id: &str) -> Result<Option<TenantPlan>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let row = tx
        .query_opt(
            "SELECT plan FROM tenant_plans WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let result = row
        .map(|r| {
            let plan: String = r.try_get(0).map_err(|e| PgError::Db(e.to_string()))?;
            Ok(TenantPlan::from_db(&plan))
        })
        .transpose();
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Assign or change a tenant's plan (upsert).
pub async fn set_tenant_plan(
    pool: &Pool,
    tenant_id: &str,
    plan: TenantPlan,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at",
        &[&tenant_id, &plan.as_db_str(), &now_rfc3339()],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}
