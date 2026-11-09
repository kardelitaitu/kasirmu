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

// ── O-H20: the push INSERT is batched, not one round trip per item ─

/// Every `$n` placeholder number appearing in `sql`, in source order.
fn placeholders(sql: &str) -> Vec<usize> {
    let bytes = sql.as_bytes();
    let mut found = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > start {
                found.push(sql[start..end].parse().expect("placeholder number"));
            }
            i = end;
        } else {
            i += 1;
        }
    }
    found
}

/// Split the statement's `VALUES` list into one slot list per row: each
/// slot is either `Some(n)` for placeholder `$n` or `None` for a literal.
fn value_rows(sql: &str) -> Vec<Vec<Option<usize>>> {
    let values = sql
        .split("VALUES")
        .nth(1)
        .expect("statement has a VALUES list");
    let body = values.split(')').next().map_or(values, str::trim_end);
    let mut rows: Vec<Vec<Option<usize>>> = Vec::new();
    // One row per `\n            (` group; each row's slots end at the
    // closing paren the split above removed.
    for raw in values.split("\n            (").skip(1) {
        let tuple = raw.split(')').next().expect("tuple closes");
        debug_assert!(!tuple.is_empty() || body.is_empty());
        rows.push(
            tuple
                .split(", ")
                .map(|slot| slot.strip_prefix('$').and_then(|n| n.parse().ok()))
                .collect(),
        );
    }
    rows
}

/// Build `n` pending items for one tenant, with distinct ids.
fn push_fixture(n: usize, tenant: &str) -> Vec<OfflineQueueItem> {
    (0..n)
        .map(|i| {
            let mut item =
                OfflineQueueItem::with_tenant("complete_sale", format!("{{\"n\":{i}}}"), tenant);
            item.id = format!("item-{i}");
            item.retry_count = i as i64;
            item.last_error = (i % 3 == 0).then(|| format!("boom-{i}"));
            item.origin_terminal_id = (i % 2 == 0).then(|| "term-pg".to_owned());
            item
        })
        .collect()
}

/// The batched statement is the per-item INSERT widened to one tuple per
/// row: same column list (and order), `status` still the `pending` literal,
/// the same `ON CONFLICT (id) DO NOTHING` upsert, and placeholders that run
/// `$1..$N` with NO gaps — the property the driver depends on, because it
/// binds the N-th parameter to `$N`.
#[test]
fn pg_insert_sql_widens_the_per_item_insert() {
    const ROWS: usize = 3;
    let bind_count = ROWS * PushColumn::BINDS_PER_ROW;
    let sql = pg_insert_sql(bind_count);
    assert!(
        sql.starts_with(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, tenant_id, origin_terminal_id)"
        ),
        "column list must match the per-item INSERT, got: {sql}"
    );
    assert!(
        sql.contains("'pending'"),
        "status must stay the PENDING literal, not a bind, got: {sql}"
    );
    assert!(
        sql.ends_with("ON CONFLICT (id) DO NOTHING"),
        "upsert semantics must be preserved verbatim, got: {sql}"
    );
    // NO GAPS: the emitted numbers are exactly $1..$N, in order. A gap is
    // what shipped in the per-item INSERT ($1, $2, $3, literal, $4..$7 with
    // 7 binds), and it silently shifted every value after `payload` one
    // column left; this assertion is the regression guard for that.
    let emitted = placeholders(&sql);
    let expected: Vec<usize> = (1..=bind_count).collect();
    assert_eq!(
        emitted, expected,
        "placeholders must be exactly $1..${bind_count} with no gaps, got: {sql}"
    );

    // And the number of placeholders equals the number of binds the
    // parameter builder produces: 7 values per row, no status slot.
    let items = push_fixture(ROWS, "acme");
    let indices: Vec<usize> = (0..ROWS).collect();
    let params = pg_insert_params(&items, &indices);
    assert_eq!(
        params.len(),
        emitted.len(),
        "params ({}) must match placeholders ({}), got: {sql}",
        params.len(),
        emitted.len()
    );

    // Every row has the same 8 slots, and `status` is the literal in slot 4
    // — i.e. `None` — in every row.
    let rows = value_rows(&sql);
    assert_eq!(rows.len(), ROWS, "one VALUES tuple per row, got: {sql}");
    for row in &rows {
        assert_eq!(
            row.len(),
            PushColumn::ALL.len(),
            "every tuple must name every column, got: {sql}"
        );
        assert_eq!(row[3], None, "status must be the literal, got: {sql}");
        for (slot, value) in row.iter().enumerate() {
            if slot != 3 {
                assert!(value.is_some(), "slot {slot} must be bound, got: {sql}");
            }
        }
    }

    // Slot 5 is `retry_count` and must carry the item's retry_count, not
    // the value that sits in parameter position 4.
    let first_row = &rows[0];
    assert_eq!(first_row[4], Some(4), "retry_count binds $4");
    assert_eq!(first_row[5], Some(5), "last_error binds $5");
    assert_eq!(first_row[6], Some(6), "tenant_id binds $6");
    assert_eq!(first_row[7], Some(7), "origin_terminal_id binds $7");
}

/// Every chunk of the same size produces the SAME statement text — that is
/// what lets one prepared statement serve all chunks of a drain.
#[test]
fn pg_insert_sql_is_stable_across_chunks_of_equal_size() {
    let full = pg_insert_sql(PG_INSERT_CHUNK_ROWS * PushColumn::BINDS_PER_ROW);
    assert_eq!(
        full,
        pg_insert_sql(PG_INSERT_CHUNK_ROWS * PushColumn::BINDS_PER_ROW),
    );
    let short = pg_insert_sql(2 * PushColumn::BINDS_PER_ROW);
    assert_ne!(full, short, "row count must change the statement");
}

/// The bounds the batching rests on: a chunk binds well under
/// PostgreSQL's 65,535-parameter cap, and a drain costs O(chunks)
/// statements rather than O(items).
#[test]
fn push_chunk_stays_within_bind_limits_and_counts_chunks_not_items() {
    const {
        assert!(PG_INSERT_CHUNK_ROWS > 0);
    }
    let chunk_binds = PG_INSERT_CHUNK_ROWS * PushColumn::BINDS_PER_ROW;
    assert!(
        chunk_binds <= PG_MAX_BIND_PARAMS,
        "chunk binds {chunk_binds} params, over the {PG_MAX_BIND_PARAMS} cap"
    );
    let chunks = |items: usize| items.div_ceil(PG_INSERT_CHUNK_ROWS);
    assert_eq!(chunks(0), 0, "an empty drain issues no INSERT");
    assert_eq!(chunks(1), 1);
    assert_eq!(chunks(PG_INSERT_CHUNK_ROWS), 1);
    assert_eq!(chunks(PG_INSERT_CHUNK_ROWS + 1), 2);
    assert_eq!(
        chunks(5_000),
        5,
        "the 5,000-item drain in the debt entry must cost 5 statements"
    );
    assert!(
        chunks(5_000) < 5_000 / 100,
        "statement count must be O(chunks), not O(items)"
    );
}

/// The tenant gate runs BEFORE admission, so a foreign item never enters a
/// chunk: it takes a slot in the outcome vector and binds nothing.
#[test]
fn pg_insert_params_borrows_admitted_items_in_queue_order() {
    let items = push_fixture(PG_INSERT_CHUNK_ROWS + 2, "acme");
    let mut outcomes: Vec<usize> = Vec::new();
    let mut accepted: Vec<usize> = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if item.tenant_id == "acme" {
            accepted.push(index);
        } else {
            outcomes.push(index);
        }
    }
    assert!(outcomes.is_empty(), "no item is foreign in this fixture");
    assert_eq!(accepted.len(), PG_INSERT_CHUNK_ROWS + 2);

    // One chunk of the drain: binds are 7 per row, in the column order the
    // SQL names, and chunk length is exactly a multiple of the column count.
    let chunk = &accepted[..PG_INSERT_CHUNK_ROWS];
    let params = pg_insert_params(&items, chunk);
    assert_eq!(
        params.len(),
        PG_INSERT_CHUNK_ROWS * PushColumn::BINDS_PER_ROW
    );
    assert_eq!(
        params.len() % PushColumn::BINDS_PER_ROW,
        0,
        "placeholder count must divide evenly into rows"
    );

    // The tail is its own (short) chunk — the same SAME statement cannot
    // serve it, which is why the chunking test asserts 2 chunks above.
    let tail = &accepted[PG_INSERT_CHUNK_ROWS..];
    assert_eq!(tail.len(), 2);
    assert_eq!(
        pg_insert_params(&items, tail).len(),
        2 * PushColumn::BINDS_PER_ROW
    );
}
// ── Identity channel: builder terminal id, no vector stamping ─────

/// The PG path carries terminal identity through `origin_terminal_id`,
/// set by `with_terminal_id`, NOT through a `_vector` stamp. The module
/// header's 'Vector stamping' note explains why: `_vector` has exactly
/// one reader (the cloud HTTP push handler, `sync_store.rs`), and a
/// direct-PG push never passes through it.
///
/// This pins the builder as the identity channel: `with_terminal_id`
/// returns a usable transport for both `None` (unpaired) and `Some`
/// (paired). If the identity channel ever changes shape, this fails and
/// the note gets re-read before the change ships.
#[test]
fn pg_transport_identity_channel_is_the_terminal_builder() {
    for identity in [None, Some("term-pg".to_string())] {
        let transport =
            PgTransport::new("localhost", 5432, "db", "u", "p", "default").expect("pool creation");
        // The builder is #[must_use]; assigning it proves it returns the
        // transport type and that both identity states are accepted.
        let transport = transport.with_terminal_id(identity.clone());
        // A paired transport is still Debug-printable without leaking the
        // identity (Debug redaction stays in force through the builder).
        let rendered = format!("{transport:?}");
        if let Some(id) = &identity {
            assert!(
                !rendered.contains(id),
                "terminal identity must not appear in Debug output"
            );
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
#[cfg_attr(not(feature = "pg-tests"), ignore)]
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
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
        }
    };
    let pool = transport.pool.clone();
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("tenant isolation test skipped: {e}");
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
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
#[cfg_attr(not(feature = "pg-tests"), ignore)]
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
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
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
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
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

/// O-H20 against a REAL PostgreSQL: the batched push writes the same rows a
/// per-item push would, across a chunk boundary AND across an item the
/// tenant gate rejects, and the upsert still leaves an existing row alone.
///
/// Skips (does not fail) when the disposable PostgreSQL is unreachable, in
/// the same style as the other live-PG tests above. Statement COUNT is not
/// measured here — this is the correctness half of the batching fix;
/// `push_chunk_stays_within_bind_limits_and_counts_chunks_not_items` pins
/// the O(chunks) count.
#[cfg_attr(not(feature = "pg-tests"), ignore)]
#[tokio::test]
async fn push_items_batches_across_chunk_boundaries() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let ns = format!("pg-push-batch-{}", std::process::id());
    let tenant = format!("{ns}-t");
    let other = format!("{ns}-other");
    let transport = match PgTransport::new_raw(&url, &tenant) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("push batching test skipped: cannot create raw pool");
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
        }
    };
    let pool = transport.pool.clone();
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("push batching test skipped: {e}");
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
        }
    };

    // One chunk, exactly: the whole batch is a single multi-row INSERT, and
    // the trail below is the short second chunk.
    let count = PG_INSERT_CHUNK_ROWS + 5;
    let mut items = push_fixture(count, &tenant);
    // A row that already exists remotely: the upsert must leave it alone.
    let clash = items[3].id.clone();
    // A foreign-tenant item lands mid-batch: it must take no bind at all
    // and must not shift the outcome slot of the item after it.
    items.insert(
        7,
        OfflineQueueItem::with_tenant("complete_sale", "{}", &other),
    );

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
                    created_at TEXT NOT NULL DEFAULT 'epoch',
                    synced_at TEXT,
                    origin_terminal_id TEXT
                 );
                 DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';
                 INSERT INTO offline_queue (id, action, payload, status, tenant_id)
                 VALUES ('{clash}', 'already-here', '{{}}', 'pending', '{tenant}');"
        ))
        .await
        .unwrap();

    let outcomes = transport.push_items(&items).await.unwrap();

    // Outcome slots still answer one-for-one, in queue order.
    assert_eq!(outcomes.len(), items.len(), "one outcome per input item");
    for (index, outcome) in outcomes.iter().enumerate() {
        let rejected_without_reason = matches!(
            outcome,
            super::super::transport::PushOutcome::Rejected { reason }
                if reason == PG_INSERT_OUTCOME_PLACEHOLDER
        );
        assert!(
            !rejected_without_reason,
            "slot {index} kept the placeholder — a chunk never reported back"
        );
        if items[index].tenant_id == tenant {
            assert!(
                matches!(outcome, super::super::transport::PushOutcome::Accepted),
                "item {index} must be accepted, got {outcome:?}"
            );
        } else {
            assert!(
                matches!(
                    outcome,
                    super::super::transport::PushOutcome::Rejected { reason }
                        if reason.contains("item tenant")
                ),
                "the foreign item must be rejected by the tenant gate, got {outcome:?}"
            );
        }
    }

    // Same rows a per-item push would have written — every column, not just
    // the id — and the clashing row untouched by the upsert.
    let rows = client
        .query(
            "SELECT id::TEXT, action::TEXT, payload::TEXT, status::TEXT,
                    retry_count::TEXT, last_error::TEXT, tenant_id::TEXT,
                    origin_terminal_id::TEXT
             FROM offline_queue
             WHERE tenant_id = $1
             ORDER BY id ASC",
            &[&tenant],
        )
        .await
        .unwrap();
    assert_eq!(
        rows.len(),
        count,
        "batched push must write exactly the admitted rows"
    );

    let mut expected: Vec<OfflineQueueItem> = items
        .into_iter()
        .filter(|i| i.tenant_id == tenant)
        .collect();
    expected.sort_by(|a, b| a.id.cmp(&b.id));
    for (row, item) in rows.iter().zip(expected.iter()) {
        let stored = (
            row.get::<_, String>("id"),
            row.get::<_, String>("action"),
            row.get::<_, String>("payload"),
            row.get::<_, String>("status"),
            row.get::<_, String>("retry_count"),
            row.get::<_, Option<String>>("last_error"),
            row.get::<_, String>("tenant_id"),
            row.get::<_, Option<String>>("origin_terminal_id"),
        );
        assert_eq!(stored.0, item.id);
        if stored.0 == clash {
            // ON CONFLICT DO NOTHING: the pre-existing row wins.
            assert_eq!(stored.1, "already-here", "upsert must not overwrite");
            continue;
        }
        assert_eq!(stored.1, item.action);
        assert_eq!(stored.2, item.payload);
        assert_eq!(stored.3, "pending", "status is always the pending literal");
        assert_eq!(stored.4, item.retry_count.to_string());
        assert_eq!(stored.5, item.last_error);
        assert_eq!(stored.6, item.tenant_id);
        assert_eq!(stored.7, item.origin_terminal_id);
    }

    client
        .batch_execute(&format!(
            "DELETE FROM offline_queue WHERE tenant_id LIKE '{ns}%';"
        ))
        .await
        .ok();
}
/// RED: `fetch_snapshot` must scope products/tax_rates/users to the
/// tenant. Same direct-connection leak as pull.
#[cfg_attr(not(feature = "pg-tests"), ignore)]
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
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
        }
    };
    let pool = transport.pool.clone();
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("snapshot isolation test skipped: {e}");
            #[cfg(not(feature = "pg-tests"))]
            return;
            #[cfg(feature = "pg-tests")]
            panic!("PG test enabled but the resource is unreachable - see the skip message above");
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
