//! Integration tests verifying that the module manifest JSON Schema and all
//! existing `manifest.json` files are valid and conformant.
//!
//! These tests load the formal schema from `docs/specs/module-manifest.schema.json`
//! and validate every `modules/*/manifest.json` against it.

use std::collections::HashSet;

/// Path to the JSON Schema file (relative to workspace root).
const SCHEMA_PATH: &str = "docs/specs/module-manifest.schema.json";

/// Required top-level fields that every manifest must have.
const REQUIRED_FIELDS: &[&str] = &["id", "name", "version"];

/// Allowed top-level field names (must match schema.properties).
const ALLOWED_FIELDS: &[&str] = &[
    "id",
    "name",
    "version",
    "description",
    "author",
    "dependencies",
    "permissions",
    "database_namespace",
];

/// Returns true if the string is valid kebab-case (lowercase, starts with a letter).
fn is_kebab_case(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.as_bytes()[0].is_ascii_lowercase()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Returns true if the string is a valid SemVer version (X.Y.Z, all non-negative integers).
fn is_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| p.parse::<u64>().is_ok())
}

// ── Schema validation ────────────────────────────────────────────────

#[test]
fn schema_file_is_valid_json() {
    let content = std::fs::read_to_string(schema_path()).unwrap_or_else(|e| {
        panic!("failed to read schema file '{}': {e}", SCHEMA_PATH);
    });
    let parsed: serde_json::Value =
        serde_json::from_str(&content).expect("schema file must be valid JSON");
    assert_eq!(
        parsed["$schema"], "https://json-schema.org/draft-07/schema#",
        "schema must use draft-07"
    );
    assert!(
        parsed["properties"].is_object(),
        "schema must have properties"
    );
    assert!(
        parsed["required"].is_array(),
        "schema must have required array"
    );

    let required = parsed["required"].as_array().unwrap();
    let required_set: HashSet<&str> = required.iter().filter_map(|v| v.as_str()).collect();
    for field in REQUIRED_FIELDS {
        assert!(
            required_set.contains(field),
            "schema must require '{field}'"
        );
    }
}

#[test]
fn schema_has_all_expected_properties() {
    let content = std::fs::read_to_string(schema_path()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    let props = parsed["properties"].as_object().unwrap();

    for field in ALLOWED_FIELDS {
        assert!(
            props.contains_key(*field),
            "schema must define property '{field}'"
        );
    }
    // Every property in the schema should be in our allowed list.
    for key in props.keys() {
        assert!(
            ALLOWED_FIELDS.contains(&key.as_str()),
            "unexpected property '{key}' in schema — add to ALLOWED_FIELDS if intentional"
        );
    }
}

#[test]
fn schema_allows_extra_fields_false() {
    let content = std::fs::read_to_string(schema_path()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(
        parsed["additionalProperties"], false,
        "schema must set additionalProperties to false"
    );
}

// ── Manifest validation ──────────────────────────────────────────────

/// Discover all `modules/*/manifest.json` files.
fn discover_manifests() -> Vec<String> {
    let mut manifests = Vec::new();

    let modules_dir = workspace_root().join("modules");
    if !modules_dir.is_dir() {
        panic!("no modules/ directory found at {:?}", modules_dir);
    }

    for entry in std::fs::read_dir(&modules_dir).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            let manifest_path = entry.path().join("manifest.json");
            if manifest_path.exists() {
                manifests.push(manifest_path.to_string_lossy().to_string());
            }
        }
    }

    manifests.sort();
    manifests
}

#[test]
fn all_modules_have_manifest() {
    let manifests = discover_manifests();
    assert!(
        !manifests.is_empty(),
        "no manifest.json files found in modules/*/"
    );
    eprintln!("Found {} manifest files:", manifests.len());
    for m in &manifests {
        eprintln!("  {m}");
    }
}

#[test]
fn each_manifest_is_valid_json() {
    for path in &discover_manifests() {
        let content =
            std::fs::read_to_string(path).unwrap_or_else(|e| panic!("failed to read {path}: {e}"));
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap_or_else(|e| {
            panic!("invalid JSON in {path}: {e}");
        });
        assert!(parsed.is_object(), "{path} must be a JSON object");
    }
}

#[test]
fn each_manifest_has_required_fields() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        for field in REQUIRED_FIELDS {
            assert!(
                parsed.get(*field).is_some(),
                "{path} is missing required field '{field}'"
            );
            let val = parsed[field]
                .as_str()
                .unwrap_or_else(|| panic!("{path}: '{field}' must be a string"));
            assert!(!val.is_empty(), "{path}: '{field}' must be non-empty");
        }
    }
}
#[test]
fn each_manifest_id_is_kebab_case() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let id = parsed["id"].as_str().unwrap();
        assert!(
            is_kebab_case(id),
            "{path}: 'id' must be kebab-case, got '{id}'"
        );
    }
}
#[test]
fn each_manifest_version_is_semver() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let version = parsed["version"].as_str().unwrap();
        assert!(
            is_semver(version),
            "{path}: 'version' must be SemVer (X.Y.Z), got '{version}'"
        );
    }
}

#[test]
fn each_manifest_dependencies_are_unique() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        if let Some(deps) = parsed["dependencies"].as_array() {
            let items: Vec<&str> = deps.iter().filter_map(|v| v.as_str()).collect();
            let mut unique = std::collections::HashSet::new();
            for dep in &items {
                assert!(unique.insert(dep), "{path}: duplicate dependency '{dep}'");
            }
        }
    }
}

#[test]
fn each_manifest_permissions_are_unique() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        if let Some(perms) = parsed["permissions"].as_array() {
            let items: Vec<&str> = perms.iter().filter_map(|v| v.as_str()).collect();
            let mut unique = std::collections::HashSet::new();
            for perm in &items {
                assert!(unique.insert(perm), "{path}: duplicate permission '{perm}'");
            }
        }
    }
}

#[test]
fn each_manifest_no_extra_fields() {
    for path in &discover_manifests() {
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allowed_set: HashSet<&str> = ALLOWED_FIELDS.iter().copied().collect();

        if let Some(obj) = parsed.as_object() {
            for key in obj.keys() {
                assert!(
                    allowed_set.contains(key.as_str()),
                    "{path}: unexpected field '{key}' — not in allowed fields"
                );
            }
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Resolve the workspace root by walking up from the test binary.
fn workspace_root() -> std::path::PathBuf {
    // The test binary is typically at <workspace>/target/debug/..., or it could
    // be run via `cargo test` from the workspace root. We check CARGO_MANIFEST_DIR
    // first, and if the schema exists relative to it, we use that.
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = std::path::PathBuf::from(&manifest_dir);
        if candidate.join(SCHEMA_PATH).exists() {
            return candidate;
        }
        // Otherwise walk up to find the workspace root.
        let mut dir = candidate.as_path();
        loop {
            if dir.join(SCHEMA_PATH).exists() {
                return dir.to_path_buf();
            }
            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
        }
    }
    // Fallback: assume we're running from workspace root.
    std::env::current_dir().unwrap_or_else(|_| {
        panic!("cannot determine workspace root; set CARGO_MANIFEST_DIR or run from workspace root")
    })
}

fn schema_path() -> std::path::PathBuf {
    workspace_root().join(SCHEMA_PATH)
}
