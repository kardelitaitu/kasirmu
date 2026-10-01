use super::*;

use crate::manager::PluginManager;

/// Write a plugin directory containing one plugin with the given declared
/// permissions, plus an optional grants file body. Mirrors the fixture helper
/// used by `manager_tests.rs` / `loader_tests.rs`.
fn plugin_dir(declared: &[&str], grants_json: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let plugin = dir.path().join("p");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(
        plugin.join("plugin.toml"),
        format!(
            "[plugin]\nname = \"p\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"a.lua\"]\n\n[permissions]\nrequired_permissions = [{}]\n",
            declared
                .iter()
                .map(|p| format!("\"{p}\""))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    )
    .unwrap();
    std::fs::write(plugin.join("a.lua"), "return true\n").unwrap();
    if let Some(json) = grants_json {
        std::fs::write(dir.path().join(GRANTS_FILE_NAME), json).unwrap();
    }
    dir
}

// ── load() ──────────────────────────────────────────────────────────

#[test]
fn absent_grants_file_is_empty_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let grants = load(dir.path()).unwrap();
    assert!(grants.is_empty());
    assert!(grants.granted_for("anything").is_empty());
}

#[test]
fn parses_a_well_formed_grants_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(GRANTS_FILE_NAME),
        r#"{"schema_version":1,"grants":{"p":["cart:read","log:write"]}}"#,
    )
    .unwrap();

    let grants = load(dir.path()).unwrap();
    assert!(!grants.is_empty());
    assert_eq!(
        grants.granted_for("p"),
        &[Permission::CartRead, Permission::LogWrite]
    );
    assert!(grants.granted_for("other").is_empty());
}

#[test]
fn malformed_json_is_an_error_naming_the_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(GRANTS_FILE_NAME), "{ not json").unwrap();

    let err = load(dir.path()).unwrap_err().to_string();
    assert!(
        err.contains(GRANTS_FILE_NAME),
        "the error must name the file, got: {err}"
    );
}

#[test]
fn unknown_permission_in_a_grant_is_rejected_by_name() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(GRANTS_FILE_NAME),
        r#"{"schema_version":1,"grants":{"p":["cart:read","cart:DELETE"]}}"#,
    )
    .unwrap();

    let err = load(dir.path()).unwrap_err().to_string();
    assert!(
        err.contains("cart:DELETE"),
        "the error must name the offending value, got: {err}"
    );
    // The remedy lists the legal set, so the operator does not have to guess.
    assert!(
        err.contains("cart:read"),
        "the error must list known permissions, got: {err}"
    );
}

#[test]
fn unknown_top_level_field_is_rejected_rather_than_ignored() {
    // A typo in the KEY ("grant" for "grants") must not read as "no approvals"
    // — that would silently disable the gate on every plugin at once.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(GRANTS_FILE_NAME),
        r#"{"schema_version":1,"grant":{"p":["cart:read"]}}"#,
    )
    .unwrap();

    assert!(load(dir.path()).is_err(), "a typo'd key must fail closed");
}

#[test]
fn wrong_schema_version_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(GRANTS_FILE_NAME),
        r#"{"schema_version":99,"grants":{"p":["cart:read"]}}"#,
    )
    .unwrap();

    let err = load(dir.path()).unwrap_err().to_string();
    assert!(
        err.contains("99"),
        "the error must name the version it found, got: {err}"
    );
}

// ── ungranted() — the decision function ─────────────────────────────

#[test]
fn ungranted_is_order_independent() {
    assert!(
        ungranted(
            &[Permission::CartWrite, Permission::CartRead],
            &[Permission::CartRead, Permission::CartWrite],
        )
        .is_empty()
    );
    assert!(
        ungranted(
            &[Permission::CartRead, Permission::CartWrite],
            &[Permission::CartWrite, Permission::CartRead],
        )
        .is_empty()
    );
}

#[test]
fn ungranted_reports_exactly_the_difference() {
    let missing = ungranted(
        &[
            Permission::CartRead,
            Permission::CartWrite,
            Permission::LogWrite,
        ],
        &[Permission::CartRead],
    );
    assert_eq!(missing, vec![Permission::CartWrite, Permission::LogWrite]);
}

#[test]
fn a_superset_grant_still_leaves_the_omitted_one_ungranted() {
    // Guards against comparing counts instead of sets: granting MORE than
    // declared must not excuse a declared permission that was left out.
    let missing = ungranted(&[Permission::CartRead], &[Permission::LogWrite]);
    assert_eq!(missing, vec![Permission::CartRead]);
}

// ── the manager gate (the security-critical assertions) ─────────────

#[test]
fn a_fully_granted_plugin_loads() {
    let dir = plugin_dir(
        &["cart:read", "cart:write"],
        Some(r#"{"schema_version":1,"grants":{"p":["cart:read","cart:write"]}}"#),
    );
    assert!(
        PluginManager::new(dir.path()).is_ok(),
        "a fully granted plugin must load"
    );
}

#[test]
fn an_ungranted_permission_refuses_the_plugin_and_names_both() {
    let dir = plugin_dir(
        &["cart:read", "cart:write"],
        Some(r#"{"schema_version":1,"grants":{"p":["cart:read"]}}"#),
    );

    let err = PluginManager::new(dir.path())
        .expect_err("a plugin with an ungranted permission must be refused")
        .to_string();

    assert!(
        err.contains("'p'"),
        "the refusal must name the plugin, got: {err}"
    );
    assert!(
        err.contains("cart:write"),
        "the refusal must name the missing permission, got: {err}"
    );
    // It must point at the file to edit, and show the shape.
    assert!(
        err.contains(GRANTS_FILE_NAME),
        "the refusal must name the grants file, got: {err}"
    );
    assert!(
        err.contains("schema_version"),
        "the refusal must show the JSON shape, got: {err}"
    );
    // The granted permission must NOT be reported as missing.
    assert!(
        !err.contains("cart:read"),
        "only the ungranted permission should appear, got: {err}"
    );
}

#[test]
fn a_plugin_with_no_grant_at_all_is_refused() {
    // The fail-closed default: installing this change must not silently arm
    // every already-present plugin.
    let dir = plugin_dir(&["cart:write"], None);

    let err = PluginManager::new(dir.path())
        .expect_err("a plugin with no recorded grant must be refused")
        .to_string();
    assert!(err.contains("cart:write"), "got: {err}");
}

#[test]
fn the_shipped_example_plugin_is_granted_and_loads() {
    // The in-repo example ships with its own grants file so that copying the
    // directory wholesale still yields a loadable plugin. If a permission is
    // added to the example manifest without updating its grants file, this
    // fails — which is the point.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let example = root.join("scripts/examples/example-discount");
    assert!(
        example.join(GRANTS_FILE_NAME).exists(),
        "the shipped example expects a grants file at {}",
        example.join(GRANTS_FILE_NAME).display()
    );

    // Build a plugins dir whose single entry is the example, and load it.
    let dir = tempfile::tempdir().unwrap();
    let plugin = dir.path().join("example-discount");
    std::fs::create_dir_all(&plugin).unwrap();
    for entry in std::fs::read_dir(&example).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(entry.path(), plugin.join(entry.file_name())).unwrap();
    }
    std::fs::copy(
        example.join(GRANTS_FILE_NAME),
        dir.path().join(GRANTS_FILE_NAME),
    )
    .unwrap();

    assert!(
        PluginManager::new(dir.path()).is_ok(),
        "the shipped example must load with its own grants file"
    );
}
