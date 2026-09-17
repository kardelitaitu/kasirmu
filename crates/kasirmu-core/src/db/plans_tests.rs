use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

#[test]
fn missing_tenant_returns_none() {
    let conn = fresh();
    let plan = store(&conn).get_tenant_plan("tenant-nope").unwrap();
    assert_eq!(plan, None, "a tenant with no row has no assigned plan");
}

#[test]
fn set_then_get_roundtrips() {
    let conn = fresh();
    let s = store(&conn);
    s.set_tenant_plan("tenant-a", TenantPlan::Pro).unwrap();
    assert_eq!(
        s.get_tenant_plan("tenant-a").unwrap(),
        Some(TenantPlan::Pro)
    );
}

#[test]
fn default_is_free_when_unset_plan_value_unknown() {
    assert_eq!(TenantPlan::from_db("free"), TenantPlan::Free);
    assert_eq!(TenantPlan::from_db("pro"), TenantPlan::Pro);
    // Unknown/future values degrade safely to free (fail closed).
    assert_eq!(TenantPlan::from_db("enterprise"), TenantPlan::Free);
}

#[test]
fn upsert_overwrites_existing_plan() {
    let conn = fresh();
    let s = store(&conn);
    s.set_tenant_plan("tenant-a", TenantPlan::Free).unwrap();
    s.set_tenant_plan("tenant-a", TenantPlan::Pro).unwrap();
    assert_eq!(
        s.get_tenant_plan("tenant-a").unwrap(),
        Some(TenantPlan::Pro),
        "upsert must overwrite the previous plan"
    );
}

#[test]
fn list_plans_returns_all_ordered() {
    let conn = fresh();
    let s = store(&conn);
    s.set_tenant_plan("tenant-b", TenantPlan::Pro).unwrap();
    s.set_tenant_plan("tenant-a", TenantPlan::Free).unwrap();
    let plans = s.list_tenant_plans().unwrap();
    assert_eq!(
        plans,
        vec![
            ("tenant-a".to_string(), TenantPlan::Free),
            ("tenant-b".to_string(), TenantPlan::Pro),
        ]
    );
}
