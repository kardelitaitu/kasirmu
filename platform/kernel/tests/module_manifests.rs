//! Integration test: every real `modules/*/manifest.json` must parse and
//! validate through the kernel's own `ModuleManifest`.
//!
//! The per-module unit tests assert that a manifest's `dependencies` match its
//! `Module::dependencies()`. This test asserts the complementary property: the
//! manifests on disk are actually well-formed by the rules the kernel enforces
//! (`docs/specs/module-manifest.schema.json`) — kebab-case id, semver version,
//! unique dependencies and permissions, `<domain>:<action>` permission shape.
//!
//! Without this, a hand-edited manifest could carry a malformed version or a
//! duplicate permission and nothing would notice, because nothing in the
//! running app calls `ModuleManifest::load_from_file` today.

use platform_kernel::Capability;
use platform_kernel::ModuleManifest;

/// Repository `modules/` directory, resolved from this crate's location.
fn modules_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("modules")
}

/// Every `(directory name, manifest path)` pair found on disk.
fn manifest_paths() -> Vec<(String, std::path::PathBuf)> {
    let mut found = Vec::new();
    let dir = modules_dir();
    let entries = std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("read {}: {e}", dir.display()));
    for entry in entries {
        let entry = entry.expect("readable dir entry");
        if !entry.path().is_dir() {
            continue;
        }
        let manifest = entry.path().join("manifest.json");
        if manifest.is_file() {
            let name = entry.file_name().to_string_lossy().into_owned();
            found.push((name, manifest));
        }
    }
    found.sort();
    found
}

#[test]
fn modules_directory_is_not_empty() {
    // Guards the tests below against silently passing on an empty iterator if
    // the relative path ever breaks.
    assert!(
        manifest_paths().len() >= 10,
        "expected at least 10 module manifests, found {}",
        manifest_paths().len()
    );
}

#[test]
fn every_manifest_parses_and_validates() {
    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path)
            .unwrap_or_else(|e| panic!("modules/{name}/manifest.json is invalid: {e}"));
        assert!(
            !manifest.id.is_empty(),
            "modules/{name}/manifest.json has an empty id"
        );
    }
}

#[test]
fn manifest_id_matches_its_directory_name() {
    // Directory name and id are kept identical so a reader can map a kernel
    // error mentioning an id straight to a path.
    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path).expect("valid manifest");
        assert_eq!(
            manifest.id, name,
            "modules/{name}/manifest.json declares id '{}'; directory and id must match",
            manifest.id
        );
    }
}

#[test]
fn manifest_ids_are_unique() {
    let mut seen = std::collections::HashSet::new();
    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path).expect("valid manifest");
        assert!(
            seen.insert(manifest.id.clone()),
            "duplicate module id '{}' (modules/{name})",
            manifest.id
        );
    }
}

#[test]
fn no_manifest_depends_on_itself() {
    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path).expect("valid manifest");
        assert!(
            !manifest.dependencies.contains(&manifest.id),
            "modules/{name} depends on itself"
        );
    }
}

#[test]
fn every_dependency_names_an_existing_module() {
    let ids: std::collections::HashSet<String> = manifest_paths()
        .into_iter()
        .map(|(_, path)| {
            ModuleManifest::load_from_file(&path)
                .expect("valid manifest")
                .id
        })
        .collect();

    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path).expect("valid manifest");
        for dep in &manifest.dependencies {
            assert!(
                ids.contains(dep),
                "modules/{name} depends on '{dep}', which is not a module directory"
            );
        }
    }
}

#[test]
fn dependency_graph_is_acyclic() {
    // The kernel's topological sort reports a cycle at runtime; catching it
    // here means a bad manifest edit fails in CI rather than at app startup.
    let manifests: Vec<ModuleManifest> = manifest_paths()
        .into_iter()
        .map(|(_, path)| ModuleManifest::load_from_file(&path).expect("valid manifest"))
        .collect();

    let mut in_degree: std::collections::HashMap<&str, usize> =
        manifests.iter().map(|m| (m.id.as_str(), 0usize)).collect();
    for m in &manifests {
        for _dep in &m.dependencies {
            *in_degree.get_mut(m.id.as_str()).expect("known id") += 1;
        }
    }

    // Kahn: repeatedly remove zero-in-degree nodes.
    let mut queue: Vec<&str> = in_degree
        .iter()
        .filter(|&(_, &d)| d == 0)
        .map(|(id, _)| *id)
        .collect();
    let mut removed = 0usize;
    while let Some(id) = queue.pop() {
        removed += 1;
        for m in &manifests {
            if m.dependencies.iter().any(|d| d == id) {
                let entry = in_degree.get_mut(m.id.as_str()).expect("known id");
                *entry -= 1;
                if *entry == 0 {
                    queue.push(m.id.as_str());
                }
            }
        }
    }

    assert_eq!(
        removed,
        manifests.len(),
        "modules/*/manifest.json dependency graph contains a cycle; \
         {} of {} modules could not be ordered",
        manifests.len() - removed,
        manifests.len()
    );
}

#[test]
fn every_declared_capability_parses() {
    // Phase 2 (P2): a manifest `capabilities` entry is what the kernel turns
    // into a required+granted capability at boot. If one is malformed, boot
    // would fail at runtime with `KernelError::InvalidCapability`; catching it
    // here means a bad manifest edit fails in CI instead.
    for (name, path) in manifest_paths() {
        let manifest = ModuleManifest::load_from_file(&path).expect("valid manifest");
        for cap in &manifest.capabilities {
            assert!(
                Capability::parse(cap).is_ok(),
                "modules/{name}/manifest.json declares malformed capability '{cap}'"
            );
        }
    }
}

/// The JSON Schema's `properties` keys must match the manifest struct's
/// serde field names, so the schema and the code cannot drift. This is the
/// parity half of the P2 acceptance criterion: `capabilities` is in the
/// schema AND the Rust struct, and no schema property lacks a field (or vice
/// versa).
#[test]
fn schema_properties_match_the_manifest_struct() {
    let schema_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("docs")
        .join("specs")
        .join("module-manifest.schema.json");
    let raw = std::fs::read_to_string(&schema_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", schema_path.display()));
    let schema: serde_json::Value = serde_json::from_str(&raw).expect("schema is valid JSON");
    let props = schema["properties"]
        .as_object()
        .expect("schema has a properties object");

    // The exact serde field names of `ModuleManifest`.
    let struct_fields = [
        "id",
        "name",
        "version",
        "description",
        "author",
        "dependencies",
        "permissions",
        "capabilities",
        "database_namespace",
    ];

    let schema_keys: std::collections::BTreeSet<&str> = props.keys().map(String::as_str).collect();
    let expected: std::collections::BTreeSet<&str> = struct_fields.iter().copied().collect();
    assert_eq!(
        schema_keys, expected,
        "docs/specs/module-manifest.schema.json properties drifted from the ModuleManifest struct fields"
    );

    // `capabilities` must be declared as an array of namespace:action strings.
    let caps = props.get("capabilities").expect("capabilities in schema");
    assert_eq!(caps["type"], "array", "capabilities must be an array");
    assert_eq!(
        caps["items"]["type"], "string",
        "capabilities items must be strings"
    );
}
