//! Postgres connectivity and FK-safe copy ordering for the migration bin.
//!
//! `connect_postgres` (schema applied via PG_INIT), `pg_fk_edges` (reads the
//! live `pg_constraint` graph), and the pure `topo_sort` over it. Split from
//! the bin's monolith on 13-09-26; behaviour unchanged.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
/// Connect to Postgres and apply the full schema (mirrors
/// `cloud_server::db::DbPool::connect_postgres` — the bin target is a
/// separate crate so it cannot reach the library module).
pub async fn connect_postgres(url: &str) -> Result<Pool, String> {
    let config =
        tokio_postgres::Config::from_str(url).map_err(|e| format!("invalid DATABASE_URL: {e}"))?;
    let mgr_config = ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    };
    let mut roots = rustls::RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        roots
            .add(cert)
            .map_err(|e| format!("failed to add root certificate: {e}"))?;
    }
    let tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let tls = tokio_postgres_rustls::MakeRustlsConnect::new(tls_config);
    let manager = Manager::from_config(config, tls, mgr_config);
    let pool = Pool::builder(manager)
        .max_size(20)
        .build()
        .map_err(|e| format!("build pool: {e}"))?;
    let client = pool.get().await.map_err(|e| format!("connect: {e}"))?;
    client
        .execute("SELECT 1", &[])
        .await
        .map_err(|e| format!("connect: {e}"))?;
    client
        .batch_execute(oz_core::migrations::PG_INIT)
        .await
        .map_err(|e| format!("apply schema: {e}"))?;
    Ok(pool)
}

/// Build the FK dependency edges from Postgres metadata: (table → tables it
/// references). Used to topologically order the copy.
pub async fn pg_fk_edges(pool: &Pool) -> Result<Vec<(String, String)>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let rows = client
        .query(
            "SELECT tc.table_name AS src, ccu.table_name AS target
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY'",
            &[],
        )
        .await
        .map_err(|e| format!("read FK metadata: {e}"))?;
    let mut edges = Vec::new();
    for row in rows {
        let src: String = row.get(0);
        let target: String = row.get(1);
        if src != target {
            edges.push((src, target));
        }
    }
    Ok(edges)
}

/// Topologically sort `tables` so every table comes after the tables it
/// references (Kahn's algorithm). Tables without edges keep input order.
pub fn topo_sort(tables: &[String], edges: &[(String, String)]) -> Vec<String> {
    let set: HashSet<&str> = tables.iter().map(|s| s.as_str()).collect();
    let mut deps: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut indegree: HashMap<&str, usize> = tables.iter().map(|t| (t.as_str(), 0usize)).collect();
    for (src, target) in edges {
        if set.contains(src.as_str()) && set.contains(target.as_str()) {
            deps.entry(target.as_str()).or_default().push(src.as_str());
            *indegree.entry(src.as_str()).or_default() += 1;
        }
    }
    // Seed with zero-indegree tables in their configured order.
    let mut ready: Vec<&str> = tables
        .iter()
        .map(|t| t.as_str())
        .filter(|t| indegree[t] == 0)
        .collect();
    let mut out: Vec<String> = Vec::with_capacity(tables.len());
    let mut seen: HashSet<&str> = HashSet::new();
    while let Some(t) = ready.pop() {
        if !seen.insert(t) {
            continue;
        }
        out.push(t.to_string());
        if let Some(children) = deps.get(t) {
            for child in children {
                // SAFETY: `deps` is only populated from `edges` whose src and
                // target are both in `set` (derived from `tables`), and
                // `indegree` is seeded from the same `tables` — so every
                // child here is guaranteed to exist in the map — SAFETY.
                let d = indegree.get_mut(child).unwrap();
                *d -= 1;
                if *d == 0 {
                    ready.push(child);
                }
            }
        }
    }
    if out.len() != tables.len() {
        // Cycle — fall back to the configured order (PG constraints will
        // reject bad orders loudly rather than silently corrupting).
        eprintln!(
            "warning: FK graph cycle detected among {} tables; using configured order",
            tables.len()
        );
        return tables.to_vec();
    }
    out
}
