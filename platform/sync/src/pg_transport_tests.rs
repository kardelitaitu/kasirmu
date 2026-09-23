//! `pg_transport` unit tests — extracted from the production file
//! (F-018) per the AGENTS test-file rule. Covers the PG-backed
//! transport: batch wiring, pin-hash handling, and error mapping.

use super::*;
// ── PgTransport::new() ────────────────────────────────────────────

#[test]
fn new_succeeds_with_valid_params() {
    let transport = PgTransport::new("localhost", 5432, "testdb", "user", "pass", "default");
    assert!(transport.is_ok(), "pool creation should succeed");
}

#[test]
fn new_succeeds_with_ip_address_host() {
    let transport = PgTransport::new("192.168.1.100", 5432, "mydb", "admin", "s3cret", "default");
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_fqdn_host() {
    let transport = PgTransport::new(
        "db.internal.example.com",
        5432,
        "production",
        "app_user",
        "p@ssw0rd!",
        "default",
    );
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_custom_port() {
    let transport = PgTransport::new("localhost", 5433, "db", "u", "p", "default");
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_max_port() {
    let transport = PgTransport::new("localhost", 65535, "db", "u", "p", "default");
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_min_port() {
    let transport = PgTransport::new("localhost", 1, "db", "u", "p", "default");
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_special_chars_in_password() {
    let transport = PgTransport::new(
        "localhost",
        5432,
        "testdb",
        "user",
        "p@ss!w0rd#with%special&chars",
        "default",
    );
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_long_strings() {
    let long = "a".repeat(255);
    let transport = PgTransport::new(&long, 5432, &long, &long, &long, "default");
    assert!(transport.is_ok());
}

#[test]
fn new_succeeds_with_unicode_dbname() {
    let transport = PgTransport::new("localhost", 5432, "café_db", "user", "pass", "default");
    assert!(transport.is_ok());
}

#[test]
fn new_handles_empty_string_params_gracefully() {
    // deadpool-postgres may accept or reject empty params at pool
    // creation time — either outcome is acceptable as long as it
    // doesn't panic.
    let result = PgTransport::new("", 5432, "", "", "", "default");
    match result {
        Ok(_) => {} // pool created lazily, will fail on first use
        Err(e) => {
            let msg = e.to_string();
            assert!(
                msg.contains("pool") || msg.contains("transport"),
                "expected pool or transport error, got: {msg}"
            );
        }
    }
}

// ── Debug ─────────────────────────────────────────────────────────

#[test]
fn pg_transport_debug_output() {
    let transport = PgTransport::new("localhost", 5432, "db", "u", "p", "default")
        .expect("pool creation should succeed");
    let debug = format!("{transport:?}");
    assert!(debug.contains("PgTransport"));
    // Debug should not expose connection details.
    assert!(!debug.contains("localhost"));
    assert!(!debug.contains("5432"));
}

// ── Send + Sync ───────────────────────────────────────────────────

#[test]
fn pg_transport_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PgTransport>();
}

// ── push_items edge cases ─────────────────────────────────────────

#[tokio::test]
async fn push_items_empty_list_handles_missing_server() {
    // Even with an empty items list, push_items calls pool.get() for
    // the CREATE TABLE IF NOT EXISTS statement. If PG is running
    // locally, the empty list produces an empty outcomes vec; if not,
    // we get a transport error. Either outcome is acceptable.
    // Use short timeout (500ms) since connection to missing PG should fail fast.
    let result = tokio::time::timeout(std::time::Duration::from_millis(500), async {
        let transport = PgTransport::new("localhost", 5432, "nonexistent", "u", "p", "default")?;
        transport.push_items(&[]).await
    })
    .await;
    match result {
        Ok(Ok(outcomes)) => assert!(outcomes.is_empty()),
        Ok(Err(e)) => {
            let msg = e.to_string();
            assert!(
                msg.contains("transport") || msg.contains("connection"),
                "expected transport or connection error, got: {msg}"
            );
        }
        Err(_elapsed) => {
            // Timed out — no PG server reachable, which is expected.
        }
    }
}

// ── Anchor expiry ───────────────────────────────────────────────────

#[test]
fn expired_anchor_returns_oldest_available_without_cursor() {
    let result = classify_anchor_expiry(
        Some("2026-01-01T00:00:00Z"),
        None,
        Some("2026-02-01T00:00:00Z"),
    );

    match result {
        Some(SyncError::AnchorExpired { oldest_available }) => {
            assert_eq!(oldest_available.as_deref(), Some("2026-02-01T00:00:00Z"));
        }
        other => panic!("expected expired anchor, got {other:?}"),
    }
}

#[test]
fn anchor_expiry_is_skipped_for_current_or_cursor_pulls() {
    assert!(
        classify_anchor_expiry(
            Some("2026-02-02T00:00:00Z"),
            None,
            Some("2026-02-01T00:00:00Z"),
        )
        .is_none()
    );
    assert!(
        classify_anchor_expiry(
            Some("2026-01-01T00:00:00Z"),
            Some("2026-02-01T00:00:00Z|item-1"),
            Some("2026-02-01T00:00:00Z"),
        )
        .is_none()
    );
}

// ── Composite (created_at, id) cursor ──────────────────────────────
#[test]
fn decode_pull_cursor_splits_on_pipe() {
    let (ts, id) = decode_pull_cursor(Some("2026-01-01T00:00:00Z|item-42"));
    assert_eq!(ts.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(id.as_deref(), Some("item-42"));
}

#[test]
fn decode_pull_cursor_missing_or_malformed() {
    assert_eq!(decode_pull_cursor(None), (None, None));
    assert_eq!(decode_pull_cursor(Some("no-pipe")), (None, None));
}

#[test]
fn build_pull_sql_filters_on_created_at_not_synced_at() {
    // The strict `synced_at > anchor` filter skipped any row sharing the
    // anchor's exact timestamp. Anchoring on created_at (the composite
    // cursor's first key) never skips an equal-timestamp row.
    let sql = build_pull_sql(Some("2026-01-01"), None);
    assert!(
        sql.contains("tenant_id = $1"),
        "every pull must be tenant-scoped, got: {sql}"
    );
    assert!(
        sql.contains("created_at >= $2"),
        "since filter must compare created_at, got: {sql}"
    );
    assert!(
        !sql.contains("synced_at >"),
        "strict synced_at filter must be gone, got: {sql}"
    );
    assert!(sql.contains("ORDER BY created_at ASC, id ASC"));
}

#[test]
fn build_pull_sql_with_cursor_has_composite_tiebreak() {
    // Equal-timestamp rows are handled by the (created_at, id) tiebreak
    // — mirroring the HTTP server's cursor semantics. The tenant filter
    // is $1; the tiebreak shifted to $3/$4.
    let sql = build_pull_sql(Some("2026-01-01"), Some("2026-01-02|item-42"));
    assert!(
        sql.contains("tenant_id = $1"),
        "every pull must be tenant-scoped, got: {sql}"
    );
    assert!(
        sql.contains("created_at > $3 OR (created_at = $3 AND id > $4)"),
        "cursor branch must carry the composite tiebreak, got: {sql}"
    );
}

#[test]
fn build_pull_sql_cursor_without_since_omits_lower_bound() {
    // Regression (review RUST-07): a cursor-without-since must not emit
    // `created_at >= $1` — the HTTP server can bind '' (SQLite text
    // comparison) but PostgreSQL rejects an empty-string cast to
    // timestamptz with `invalid input syntax`. The cursor alone already
    // encodes the exact resume point, so the lower bound is redundant.
    let sql = build_pull_sql(None, Some("2026-01-02|item-42"));
    assert!(
        sql.contains("tenant_id = $1"),
        "every pull must be tenant-scoped, got: {sql}"
    );
    assert!(
        !sql.contains("created_at >="),
        "cursor-without-since must omit the lower bound, got: {sql}"
    );
    assert!(
        sql.contains("created_at > $2 OR (created_at = $2 AND id > $3)"),
        "cursor-only branch must carry the composite tiebreak, got: {sql}"
    );
    // C3 S5 moved the arity: the origin identity is now $4, so the LIMIT
    // is $5 (tenant + tiebreak + origin + limit). The lower-bound and
    // tiebreak assertions above are the semantics this test protects and
    // they are unchanged.
    assert!(
        sql.contains("LIMIT $5"),
        "cursor-only branch has 5 params (tenant + tiebreak + origin + limit), got: {sql}"
    );
    assert!(
        sql.contains("$4::text IS NULL OR origin_terminal_id IS NULL"),
        "cursor-only branch must carry the self-origin filter, got: {sql}"
    );
}

#[test]
fn build_pull_sql_without_since_or_cursor_is_tenant_scoped() {
    // The initial sync still carries the tenant filter — a shared
    // multi-tenant database must never dump every tenant's queue to a
    // fresh terminal.
    let sql = build_pull_sql(None, None);
    assert!(
        sql.contains("tenant_id = $1"),
        "initial sync must be tenant-scoped, got: {sql}"
    );
}

/// C3 S5: every one of the four pull arms excludes rows this terminal
/// originated, and each binds the identity at the placeholder its own
/// renumbering produced — a mismatch here is a bind error at runtime, not a
/// compile error, so it is asserted per arm.
#[test]
fn build_pull_sql_filters_self_origin_in_all_four_arms() {
    for (label, sql, placeholder) in [
        ("bare", build_pull_sql(None, None), "$2"),
        ("since", build_pull_sql(Some("2026-01-01"), None), "$3"),
        (
            "cursor-only",
            build_pull_sql(None, Some("2026-01-02|item-42")),
            "$4",
        ),
        (
            "since+cursor",
            build_pull_sql(Some("2026-01-01"), Some("2026-01-02|item-42")),
            "$5",
        ),
    ] {
        assert!(
            sql.contains("origin_terminal_id IS NULL"),
            "{label}: a NULL origin must always match, got: {sql}"
        );
        let clause = format!(
            "{placeholder}::text IS NULL OR origin_terminal_id IS NULL OR origin_terminal_id <> {placeholder}"
        );
        assert!(
            sql.contains(&clause),
            "{label}: filter must bind {placeholder}, got: {sql}"
        );
        // The filter is a WHERE-list addition only: ordering and page size
        // semantics are untouched in every arm.
        assert!(
            sql.contains("ORDER BY created_at ASC, id ASC"),
            "{label}: ordering must be untouched, got: {sql}"
        );
    }
}

/// C3 S5: a transport that never declares a terminal identity keeps the
/// unfiltered pull — the unpaired-install and admin-minted-token case. The
/// field is a builder default, not a constructor parameter, so existing
/// callers (including the ignored PG integration tests) keep compiling.
#[test]
fn transport_without_a_terminal_identity_has_no_filter() {
    let transport = PgTransport::new("localhost", 5432, "db", "u", "p", "default")
        .expect("transport builds without connecting");
    assert_eq!(
        transport.terminal_id, None,
        "the default must be None: no identity, no filter"
    );

    let paired = transport.with_terminal_id(Some("terminal-A".into()));
    assert_eq!(paired.terminal_id.as_deref(), Some("terminal-A"));

    // An unpaired install explicitly passes None, which is the same state.
    let unpaired = PgTransport::new("localhost", 5432, "db", "u", "p", "default")
        .unwrap()
        .with_terminal_id(None);
    assert_eq!(unpaired.terminal_id, None);
}

#[test]
fn derive_next_cursor_from_last_kept_row_when_full_page() {
    let mut items: Vec<OfflineQueueItem> = (0..501)
        .map(|i| {
            let mut it = OfflineQueueItem::new("test", "{}");
            it.id = format!("id-{i}");
            it.created_at = format!("2026-01-01T00:00:00.{:03}Z", i % 1000);
            it
        })
        .collect();
    let next = derive_next_cursor(&mut items);
    assert_eq!(items.len(), 500, "page must truncate to 500 rows");
    // Cursor derives from the last KEPT row (index 499), not the 501st.
    let kept = &items[499];
    assert_eq!(
        next.as_deref(),
        Some(format!("{}|{}", kept.created_at, kept.id).as_str())
    );
}

#[test]
fn derive_next_cursor_none_when_page_not_full() {
    let mut items: Vec<OfflineQueueItem> = (0..10)
        .map(|i| {
            let mut it = OfflineQueueItem::new("test", "{}");
            it.id = format!("id-{i}");
            it.created_at = "2026-01-01T00:00:00.000Z".into();
            it
        })
        .collect();
    let next = derive_next_cursor(&mut items);
    assert_eq!(items.len(), 10, "short pages are not truncated");
    assert_eq!(next, None, "no next cursor when the page is not full");
}

#[test]
fn derive_next_cursor_roundtrips_via_decode() {
    let mut items: Vec<OfflineQueueItem> = (0..501)
        .map(|i| {
            let mut it = OfflineQueueItem::new("test", "{}");
            it.id = format!("id-{i}");
            it.created_at = "2026-01-01T00:00:00.000Z".into();
            it
        })
        .collect();
    let next = derive_next_cursor(&mut items).unwrap();
    let (ts, id) = decode_pull_cursor(Some(&next));
    assert_eq!(ts.as_deref(), Some("2026-01-01T00:00:00.000Z"));
    assert_eq!(id.as_deref(), Some("id-499"));
}

// ── pull_updates edge cases ───────────────────────────────────────

#[tokio::test]
async fn pull_updates_both_with_and_without_since() {
    let transport = PgTransport::new("localhost", 5432, "nonexistent", "u", "p", "default")
        .expect("pool creation should succeed");

    // Use short timeout (500ms) since connection to missing PG should fail fast.
    const SHORT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

    // pull_updates with since = None, cursor = None
    let result1 = tokio::time::timeout(SHORT_TIMEOUT, transport.pull_updates(None, None)).await;
    match result1 {
        Ok(Ok(_resp)) => {} // PG running locally
        Ok(Err(e)) => {
            assert!(e.to_string().contains("transport") || e.to_string().contains("connection"));
        }
        Err(_elapsed) => {} // timed out — expected without PG
    }

    // pull_updates with since = Some, cursor = None
    let result2 = tokio::time::timeout(
        SHORT_TIMEOUT,
        transport.pull_updates(Some("2026-01-01T00:00:00Z"), None),
    )
    .await;
    match result2 {
        Ok(Ok(_resp)) => {}
        Ok(Err(e)) => {
            assert!(e.to_string().contains("transport") || e.to_string().contains("connection"));
        }
        Err(_elapsed) => {}
    }

    // pull_updates with since = Some, cursor = Some
    let result3 = tokio::time::timeout(
        SHORT_TIMEOUT,
        transport.pull_updates(
            Some("2026-01-01T00:00:00Z"),
            Some("2026-01-02T00:00:00Z|item-42"),
        ),
    )
    .await;
    match result3 {
        Ok(Ok(_resp)) => {}
        Ok(Err(e)) => {
            assert!(e.to_string().contains("transport") || e.to_string().contains("connection"));
        }
        Err(_elapsed) => {}
    }
}

// ── Tenant isolation (real Postgres, skip if unreachable) ──────────

/// RED: `pull_updates` must return only the caller's tenant rows. The
/// transport is a DIRECT connection (bypasses the HTTP server + auth),
/// so without an explicit tenant scope a shared database leaks every
/// tenant's offline_queue rows to any terminal.
#[tokio::test]
async fn pull_updates_scopes_to_tenant() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let ns = format!("pg-isolation-{}", std::process::id());
    let tenant_a = format!("{ns}-a");
    let tenant_b = format!("{ns}-b");
    // Raw connection WITHOUT schema (we seed minimal rows ourselves).
    let transport = match PgTransport::new_raw(&url, &tenant_a) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("tenant isolation test skipped: cannot create raw pool");
            return;
        }
    };
    let pool = transport.pool.clone();
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("tenant isolation test skipped: {e}");
            return;
        }
    };

    client
        .batch_execute(&format!(
            "CREATE TABLE IF NOT EXISTS offline_queue (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    retry_count BIGINT NOT NULL DEFAULT 0,
                    last_error TEXT,
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    synced_at TIMESTAMPTZ
                 );
                 DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';
                 INSERT INTO offline_queue (id, action, payload, tenant_id, created_at)
                 VALUES ('{ns}-a1', 'act', '{{}}', '{tenant_a}', '2026-01-01T00:00:00Z'),
                        ('{ns}-b1', 'act', '{{}}', '{tenant_b}', '2026-01-01T00:00:00Z');"
        ))
        .await
        .unwrap();

    // Pull from tenant A's perspective: must see ONLY tenant A's row.
    // RED: the query has a tenant filter now (this test pins it).
    let resp = transport.pull_updates(None, None).await.unwrap();
    let ids: Vec<String> = resp.items.iter().map(|i| i.id.clone()).collect();
    assert!(
        ids.iter().all(|id| id.starts_with(&format!("{ns}-a"))),
        "tenant A pull must not return tenant B rows, got: {ids:?}"
    );
    assert!(
        ids.contains(&format!("{ns}-a1")),
        "tenant A pull must return tenant A's own row, got: {ids:?}"
    );

    // Cleanup.
    client
        .batch_execute(&format!(
            "DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';"
        ))
        .await
        .ok();
}

/// C3 S5 against a REAL PostgreSQL: the transport's pull excludes rows its
/// own `terminal_id` originated, returns the same row to a DIFFERENT
/// terminal, and — with no identity declared — returns everything, exactly
/// as before. The NULL-origin row is asserted in every case: an unstamped or
/// legacy row is never suppressed.
///
/// Skips (does not fail) when the disposable PostgreSQL is unreachable, in
/// the same style as the tenant-isolation test above.
#[tokio::test]
async fn pull_updates_excludes_self_origin_rows() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let ns = format!("pg-origin-{}", std::process::id());
    let tenant = format!("{ns}-t");
    let transport_a = match PgTransport::new_raw(&url, &tenant) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("origin-filter test skipped: cannot create raw pool");
            return;
        }
    };
    let pool = transport_a.pool.clone();
    // PgTransport is not Clone; three handles over the SAME pool, each with
    // its own declared identity, stand in for three terminals.
    let as_terminal = |id: Option<&str>| {
        PgTransport::new_raw(&url, &tenant)
            .expect("raw pool")
            .with_terminal_id(id.map(str::to_owned))
    };
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("origin-filter test skipped: {e}");
            return;
        }
    };

    client
        .batch_execute(&format!(
            "CREATE TABLE IF NOT EXISTS offline_queue (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    retry_count BIGINT NOT NULL DEFAULT 0,
                    last_error TEXT,
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    synced_at TIMESTAMPTZ
                 );
                 ALTER TABLE offline_queue ADD COLUMN IF NOT EXISTS origin_terminal_id TEXT;
                 DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';
                 INSERT INTO offline_queue (id, action, payload, tenant_id, created_at, origin_terminal_id)
                 VALUES ('{ns}-mine', 'act', '{{}}', '{tenant}', '2026-01-01T00:00:00Z', 'terminal-A'),
                        ('{ns}-theirs', 'act', '{{}}', '{tenant}', '2026-01-01T00:00:01Z', 'terminal-B'),
                        ('{ns}-legacy', 'act', '{{}}', '{tenant}', '2026-01-01T00:00:02Z', NULL);"
        ))
        .await
        .unwrap();

    let ids_of = |resp: &super::super::transport::PullResponse| -> Vec<String> {
        let mut v: Vec<String> = resp.items.iter().map(|i| i.id.clone()).collect();
        v.sort();
        v
    };

    // Case 1: pulling AS terminal A must not return A's own row.
    let as_a = as_terminal(Some("terminal-A"))
        .pull_updates(None, None)
        .await
        .unwrap();
    let ids = ids_of(&as_a);
    assert!(
        !ids.contains(&format!("{ns}-mine")),
        "terminal A must not be handed back its own push, got: {ids:?}"
    );
    assert!(
        ids.contains(&format!("{ns}-theirs")),
        "another terminal's row must still travel, got: {ids:?}"
    );
    assert!(
        ids.contains(&format!("{ns}-legacy")),
        "a NULL origin is never suppressed, got: {ids:?}"
    );

    // Case 2: the SAME row IS returned when pulling as terminal B.
    let as_b = as_terminal(Some("terminal-B"))
        .pull_updates(None, None)
        .await
        .unwrap();
    let ids = ids_of(&as_b);
    assert!(
        ids.contains(&format!("{ns}-mine")),
        "A's row must reach B — the filter is per-caller: {ids:?}"
    );
    assert!(!ids.contains(&format!("{ns}-theirs")));

    // Case 3: no terminal identity — the unpaired install / admin token path.
    let unpaired = as_terminal(None).pull_updates(None, None).await.unwrap();
    let ids = ids_of(&unpaired);
    assert_eq!(
        ids,
        vec![
            format!("{ns}-legacy"),
            format!("{ns}-mine"),
            format!("{ns}-theirs")
        ],
        "no identity → every tenant row, exactly as before"
    );

    client
        .batch_execute(&format!(
            "DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';"
        ))
        .await
        .ok();
}

/// RED: `fetch_snapshot` must scope products/tax_rates/users to the
/// tenant. Same direct-connection leak as pull.
#[tokio::test]
async fn fetch_snapshot_scopes_to_tenant() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let ns = format!("pg-snap-isolation-{}", std::process::id());
    let tenant_a = format!("{ns}-a");
    let tenant_b = format!("{ns}-b");
    let transport = match PgTransport::new_raw(&url, &tenant_a) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("snapshot isolation test skipped: cannot create raw pool");
            return;
        }
    };
    let pool = transport.pool.clone();
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("snapshot isolation test skipped: {e}");
            return;
        }
    };

    client
        .batch_execute(&format!(
            "CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    sku TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price_minor BIGINT NOT NULL,
                    currency TEXT NOT NULL,
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TEXT, updated_at TEXT, price_updated_at TEXT,
                    track_serial BIGINT DEFAULT 0, store_id TEXT, brand TEXT,
                    rack_location TEXT, notes TEXT, unit TEXT, is_active BIGINT DEFAULT 1,
                    category_id TEXT, barcode TEXT
                 );
                 CREATE TABLE IF NOT EXISTS tax_rates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    rate_bps BIGINT NOT NULL DEFAULT 0,
                    is_default TEXT DEFAULT '0',
                    is_inclusive TEXT DEFAULT '0',
                    -- Scope + validity window + statutory rounding: the hub
                    -- SELECT (pg_transport.rs fetch_snapshot) reads all five;
                    -- a fixture table without them fails the live-PG path.
                    legal_entity_id TEXT, location_id TEXT,
                    effective_from TEXT, effective_to TEXT,
                    rounding_mode TEXT NOT NULL DEFAULT ''
                       CHECK (rounding_mode IN ('', 'half_up', 'truncate')),
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TEXT, updated_at TEXT
                 );
                 CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    display_name TEXT,
                    role_id TEXT,
                    is_active TEXT DEFAULT '1',
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TEXT, updated_at TEXT
                 );
                 -- The fixture runs against the SHARED dev PG: a tax_rates
                 -- table created by an earlier fixture run predates the
                 -- E1 scope/window/rounding columns the hub SELECT reads.
                 ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS legal_entity_id TEXT;
                 ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS location_id TEXT;
                 ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS effective_from TEXT;
                 ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS effective_to TEXT;
                 ALTER TABLE tax_rates
                    ADD COLUMN IF NOT EXISTS rounding_mode TEXT
                    NOT NULL DEFAULT '';
                 DELETE FROM products WHERE tenant_id LIKE '{ns}%';
                 DELETE FROM tax_rates WHERE tenant_id LIKE '{ns}%';
                 DELETE FROM users WHERE tenant_id LIKE '{ns}%';
                 INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
                 VALUES ('{ns}-pa', 'SKU-A', 'Alpha', 100, 'USD', '{tenant_a}'),
                        ('{ns}-pb', 'SKU-B', 'Beta', 200, 'USD', '{tenant_b}');
                 INSERT INTO tax_rates (id, name, rate_bps, rounding_mode, tenant_id)
                 VALUES ('{ns}-ta', 'VAT A', 1100, 'half_up', '{tenant_a}'),
                        ('{ns}-tb', 'VAT B', 2200, 'truncate', '{tenant_b}');"
        ))
        .await
        .unwrap();

    let resp = transport.fetch_snapshot().await.unwrap();
    let skus: Vec<String> = resp.products.iter().map(|p| p.sku.clone()).collect();
    assert!(
        skus.iter().all(|s| s == "SKU-A"),
        "tenant A snapshot must not include tenant B products, got: {skus:?}"
    );
    assert!(
        skus.contains(&"SKU-A".to_string()),
        "tenant A snapshot must include its own product"
    );

    // E1 wire: the hub SELECT reads tax_rates.rounding_mode (fixture must
    // carry the column or fetch_snapshot errors on a live PG), the value
    // survives the Option<String> read, and the tenant B row stays out.
    let tax: Vec<_> = resp
        .tax_rates
        .iter()
        .filter(|t| t.id.starts_with(&ns))
        .collect();
    assert!(
        tax.iter().all(|t| t.id != format!("{ns}-tb")),
        "tenant A snapshot must not include tenant B tax rates, got: {tax:?}"
    );
    let own = tax
        .iter()
        .find(|t| t.id == format!("{ns}-ta"))
        .expect("tenant A snapshot must include its own tax rate");
    assert_eq!(
        own.rounding_mode, "half_up",
        "E1 mode must survive the PG wire"
    );

    client
        .batch_execute(&format!(
            "DELETE FROM products WHERE tenant_id LIKE '{ns}%';
                 DELETE FROM tax_rates WHERE tenant_id LIKE '{ns}%';
                 DELETE FROM users WHERE tenant_id LIKE '{ns}%';"
        ))
        .await
        .ok();
}
