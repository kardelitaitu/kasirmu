//! Tests for [`snowflake_insert_statement`], the SQL text the Snowflake
//! exporter sends.
//!
//! Separate module rather than extra cases in `cloud_destination_tests.rs`:
//! test files are where commits have already collided in this worktree.
//!
//! The existing six tests in this module cover defaults, labels, serde
//! round-trips and an empty bundle — nothing covered the statement text,
//! which is the artifact COR-35 changed. So the security fix had no
//! regression protection: reintroducing concatenated literals would fail
//! no test.

use super::*;

const ROW_GROUP: &str = "(?, ?, ?, ?, PARSE_JSON(?))";

// ── Contract of the extraction (behavior as it was) ──────────────────────

#[test]
fn a_single_row_statement_has_the_expected_shape() {
    let sql = snowflake_insert_statement("ANALYTICS", "PUBLIC", "EXPORT_TABLE", 1).unwrap();
    assert_eq!(
        sql,
        "INSERT INTO ANALYTICS.PUBLIC.EXPORT_TABLE (exported_at, tenant_id, store_name, \
         report_type, report_data) VALUES (?, ?, ?, ?, PARSE_JSON(?));"
    );
}

#[test]
fn each_row_gets_its_own_placeholder_group() {
    // The caller builds a 1-based bindings map with 5 entries per row; a
    // mismatch between the two is a warehouse-side error, so the count is
    // pinned here.
    let sql = snowflake_insert_statement("DB", "SC", "T", 3).unwrap();
    assert_eq!(sql.matches(ROW_GROUP).count(), 3);
    assert_eq!(sql.matches('?').count(), 15);
}

#[test]
fn a_full_batch_and_a_remainder_share_the_same_shape() {
    // 50-row batches with a trailing remainder: the last, short batch must
    // not change the column list or the terminator.
    let full = snowflake_insert_statement("DB", "SC", "T", 50).unwrap();
    let rest = snowflake_insert_statement("DB", "SC", "T", 1).unwrap();
    for sql in [&full, &rest] {
        assert!(sql.starts_with("INSERT INTO DB.SC.T ("));
        assert!(sql.ends_with(");"));
    }
    assert_eq!(full.matches('?').count(), 250);
}

#[test]
fn the_statement_carries_no_string_literals_at_all() {
    // COR-35's guarantee, stated structurally rather than by example: every
    // value travels in the bindings map, so there is no quoted literal in
    // the SQL for a value to escape from. If someone goes back to
    // inlining literals, this fails.
    let sql = snowflake_insert_statement("DB", "SC", "T", 2).unwrap();
    assert!(!sql.contains('"'), "quoted literal in: {sql}");
    assert!(!sql.contains('\\'), "escape sequence in: {sql}");
}

// ── The half of the class COR-35 did not close ───────────────────────────

#[test]
fn a_hostile_table_name_is_rejected_not_embedded() {
    // Bind variables take the VALUES out of SQL text. They cannot do
    // anything about the identifiers, which are still interpolated at
    // lines that read config.database/schema/table straight from the
    // persisted `cloud_export_config` setting.
    let result = snowflake_insert_statement("DB", "SC", "T1; DROP TABLE users; --", 1);
    let err = result.expect_err("a hostile table name must be rejected, not embedded in the SQL");
    assert!(
        err.to_string().contains("table"),
        "the error must name the offending field, got: {err}"
    );
}

#[test]
fn a_hostile_database_or_schema_name_is_rejected() {
    for (i, db) in ["DB; DELETE FROM x", "\"DB\"", "DB\nSC"].iter().enumerate() {
        let err = snowflake_insert_statement(db, "SC", "T", 1)
            .err()
            .unwrap_or_else(|| panic!("database #{i} must be rejected"));
        assert!(err.to_string().contains("database"), "got: {err}");
    }
    let err = snowflake_insert_statement("DB", "SC; SELECT 1", "T", 1)
        .expect_err("a hostile schema name must be rejected");
    assert!(err.to_string().contains("schema"), "got: {err}");
}

#[test]
fn a_dotted_identifier_cannot_retarget_the_insert() {
    // Subtler than the semicolon and needs no statement terminator: putting
    // "OTHER.PUBLIC.T" in the table slot silently rewrites the qualified
    // name the batch is written to, sending rows to a different table than
    // the one configured.
    let err = snowflake_insert_statement("DB", "SC", "OTHER.PUBLIC.T", 1)
        .expect_err("a dotted identifier must be rejected");
    assert!(err.to_string().contains("table"), "got: {err}");
}

#[test]
fn ordinary_warehouse_names_still_work() {
    // The guard must not reject the names real configs use, including the
    // digits, underscores and $ that Snowflake allows.
    for table in [
        "T",
        "export_table",
        "EXPORT_TABLE",
        "t1",
        "_staging",
        "fin$2",
    ] {
        assert!(
            snowflake_insert_statement("ANALYTICS", "PUBLIC", table, 1).is_ok(),
            "{table} is a legitimate identifier and must still export"
        );
    }
}

// ── The same class on the BigQuery URL path ──────────────────────────────

#[test]
fn bigquery_url_has_the_expected_shape() {
    let url = bigquery_insert_url("my-project", "analytics", "events").unwrap();
    assert_eq!(
        url,
        "https://bigquery.googleapis.com/bigquery/v2/projects/my-project/datasets/analytics/tables/events/insertAll"
    );
}

#[test]
fn a_bigquery_identifier_cannot_inject_path_or_query_segments() {
    // The host is a literal, so these cannot redirect the request or leak
    // the bearer token - but each one silently changes WHICH table the
    // batch lands in, or truncates the call.
    for hostile in [
        "p/datasets/other/tables/victim",
        "t?pretty=1&x=",
        "t#frag",
        "t/insertAll",
        "evil.example.com",
        "",
        "has space",
    ] {
        let err = bigquery_insert_url(hostile, "ds", "tb")
            .err()
            .unwrap_or_else(|| panic!("{hostile:?} must not reach the URL"));
        assert!(
            err.to_string().contains("project_id"),
            "the error must name the field, got: {err}"
        );
    }
}

#[test]
fn bigquery_dataset_and_table_are_validated_too() {
    assert!(bigquery_insert_url("proj", "ds;x", "tb").is_err());
    assert!(bigquery_insert_url("proj", "ds", "../tb").is_err());
    assert!(bigquery_insert_url("proj", "ds", "tb").is_ok());
}

#[test]
fn a_gcp_project_id_may_contain_hyphens() {
    // Found by the contract test above, not by review: reusing the SQL
    // identifier rule for project_id rejected "my-project", and GCP project
    // ids are hyphenated almost without exception. The two rules must stay
    // separate, so this is pinned rather than left to the reader.
    for project in ["my-project", "oz-pos-prod-2", "a_b"] {
        assert!(
            bigquery_insert_url(project, "analytics", "events").is_ok(),
            "{project} is a real GCP project id shape and must export"
        );
    }
    // A hyphen being legal does not make path syntax legal.
    assert!(bigquery_insert_url("proj/../x", "d", "t").is_err());
    assert!(bigquery_insert_url("proj?x=1", "d", "t").is_err());
}

// ── COR-31: no outbound request may be unbounded ─────────────────────────

#[test]
fn the_client_timeout_outlives_the_statement_timeout_we_ask_for() {
    // The real risk in fixing a hang is fixing it by cutting the request
    // short: the Snowflake body tells the warehouse a batch may take
    // SNOWFLAKE_STATEMENT_TIMEOUT_SECS, so a client bound below that would
    // abort legitimate exports - worse than the bug being closed, and
    // silent until a big batch happens to run slow. Both numbers are now
    // named constants used by the request itself, so this compares the
    // values that are actually sent rather than two literals that can drift
    // away from the code.
    assert!(
        HTTP_REQUEST_TIMEOUT.as_secs() > SNOWFLAKE_STATEMENT_TIMEOUT_SECS,
        "client gives up after {}s but asks the warehouse for {}s",
        HTTP_REQUEST_TIMEOUT.as_secs(),
        SNOWFLAKE_STATEMENT_TIMEOUT_SECS,
    );
    // The connect bound is the tight one, and it must stay well under the
    // overall bound or it buys nothing over just waiting for the request.
    assert!(
        HTTP_CONNECT_TIMEOUT < HTTP_REQUEST_TIMEOUT,
        "connect bound must be the tighter of the two"
    );
}
