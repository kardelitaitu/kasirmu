use super::*;

#[test]
fn load_empty_directory() {
    let dir = tempfile::tempdir().unwrap();
    let registry = load_plugins(dir.path()).unwrap();
    assert!(registry.is_empty());
}

#[test]
fn load_single_plugin() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("my-plugin");
    std::fs::create_dir(&plugin_dir).unwrap();

    let manifest = r#"
[plugin]
name = "my-plugin"
version = "1.0.0"

[capabilities]
scripts = ["test.lua"]
"#;
    std::fs::write(plugin_dir.join("plugin.toml"), manifest).unwrap();
    std::fs::write(plugin_dir.join("test.lua"), "-- test script").unwrap();

    let registry = load_plugins(dir.path()).unwrap();
    assert_eq!(registry.len(), 1);
    assert_eq!(registry.plugins[0].manifest.plugin.name, "my-plugin");
    assert_eq!(registry.plugins[0].scripts.len(), 1);
}

#[test]
fn skip_directories_without_manifest() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("no-manifest")).unwrap();
    let registry = load_plugins(dir.path()).unwrap();
    assert!(registry.is_empty());
}

// ── PluginRegistry struct tests ──────────────────────────────────

#[test]
fn registry_default_is_empty() {
    let reg = PluginRegistry::default();
    assert!(reg.is_empty());
    assert_eq!(reg.len(), 0);
}

#[test]
fn registry_new_equals_default() {
    let new = PluginRegistry::new();
    let default = PluginRegistry::default();
    assert_eq!(new.len(), default.len());
    assert!(new.is_empty());
    assert!(default.is_empty());
}

#[test]
fn registry_len_reflects_plugins() {
    let dir = tempfile::tempdir().unwrap();
    for i in 1..=3 {
        let plugin_dir = dir.path().join(format!("plugin-{i}"));
        std::fs::create_dir(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                format!("[plugin]\nname = \"plugin-{i}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = []\n"),
            )
            .unwrap();
    }
    let registry = load_plugins(dir.path()).unwrap();
    assert_eq!(registry.len(), 3);
    assert!(!registry.is_empty());
}

// ── LoadedPlugin struct tests ────────────────────────────────────

#[test]
fn loaded_plugin_debug() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("debug-plugin");
    std::fs::create_dir(&plugin_dir).unwrap();
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        "[plugin]\nname = \"debug-plugin\"\nversion = \"1.0.0\"\n",
    )
    .unwrap();
    let registry = load_plugins(dir.path()).unwrap();
    let debug = format!("{:?}", registry.plugins[0]);
    assert!(debug.contains("debug-plugin"));
}

#[test]
fn plugin_with_missing_scripts_dir() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("no-scripts");
    std::fs::create_dir(&plugin_dir).unwrap();
    std::fs::write(
            plugin_dir.join("plugin.toml"),
            "[plugin]\nname = \"no-scripts\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"missing.lua\"]\n",
        )
        .unwrap();
    let registry = load_plugins(dir.path()).unwrap();
    assert_eq!(registry.len(), 1);
    assert!(registry.plugins[0].scripts.is_empty());
}

#[test]
fn load_nonexistent_directory() {
    let registry = load_plugins(std::path::Path::new("/nonexistent/path/for/plugins")).unwrap();
    assert!(registry.is_empty());
}

// ── PLG-02: script path confinement ───────────────────────────────

/// Helper: write a plugin dir with the given manifest `scripts` list and
/// return the plugins_root. Scripts that should exist on disk are passed
/// as (name, contents) pairs.
fn write_plugin(dir: &std::path::Path, name: &str, scripts_decl: &[&str], files: &[(&str, &str)]) {
    let plugin_dir = dir.join(name);
    std::fs::create_dir_all(&plugin_dir).unwrap();
    let scripts_list = scripts_decl
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(", ");
    std::fs::write(
            plugin_dir.join("plugin.toml"),
            format!(
                "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [{scripts_list}]\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
            ),
        )
        .unwrap();
    for (file, contents) in files {
        if let Some(parent) = plugin_dir.join(file).parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(plugin_dir.join(file), contents).unwrap();
    }
}

#[test]
fn plugin_with_dotdot_script_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    // Declare a script that escapes the plugin dir via `..`.
    write_plugin(dir.path(), "evil", &["../../escape.lua"], &[]);
    // Plant a file at the target location to prove it would be reachable.
    std::fs::write(dir.path().join("escape.lua"), "-- pwn").unwrap();

    let registry = load_plugins(dir.path()).unwrap();
    assert!(
        registry.is_empty(),
        "plugin declaring a '..' script must be rejected"
    );
}

#[test]
fn plugin_with_absolute_script_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    write_plugin(dir.path(), "evil", &["/etc/passwd"], &[]);
    let registry = load_plugins(dir.path()).unwrap();
    assert!(
        registry.is_empty(),
        "plugin declaring an absolute script must be rejected"
    );
}

#[test]
fn plugin_with_directory_as_script_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    // Declare a script that is actually a directory.
    write_plugin(dir.path(), "evil", &["scripts"], &[]);
    std::fs::create_dir_all(dir.path().join("evil/scripts")).unwrap();
    let registry = load_plugins(dir.path()).unwrap();
    assert!(
        registry.is_empty(),
        "plugin whose declared script is a directory must be rejected"
    );
}

#[test]
fn plugin_with_symlink_escape_is_rejected() {
    // Symlink creation requires privileges on Windows — skip there.
    #[cfg(unix)]
    {
        let dir = tempfile::tempdir().unwrap();
        // Target file OUTSIDE the plugins root.
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.lua"), "-- outside").unwrap();

        let plugin_dir = dir.path().join("evil");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                "[plugin]\nname = \"evil\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"link.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n",
            )
            .unwrap();
        // Symlink INSIDE the plugin dir pointing OUTSIDE it.
        std::os::unix::fs::symlink(
            outside.path().join("secret.lua"),
            plugin_dir.join("link.lua"),
        )
        .unwrap();

        let registry = load_plugins(dir.path()).unwrap();
        assert!(
            registry.is_empty(),
            "plugin whose script symlinks outside its dir must be rejected"
        );
    }
}

#[test]
fn plugin_with_legit_scripts_still_loads() {
    let dir = tempfile::tempdir().unwrap();
    write_plugin(
        dir.path(),
        "good",
        &["a.lua", "sub/b.lua"],
        &[("a.lua", "-- a"), ("sub/b.lua", "-- b")],
    );
    let registry = load_plugins(dir.path()).unwrap();
    assert_eq!(registry.len(), 1);
    let plugin = &registry.plugins[0];
    assert_eq!(plugin.scripts.len(), 2);
    // Scripts are canonicalised and confined to the plugin dir.
    for script in &plugin.scripts {
        let canonical_dir = std::fs::canonicalize(dir.path().join("good")).unwrap();
        assert!(
            script.starts_with(&canonical_dir),
            "script {:?} must stay inside the plugin dir",
            script
        );
    }
}

#[test]
fn plugin_with_missing_script_is_still_tolerated() {
    let dir = tempfile::tempdir().unwrap();
    // Declared script does not exist on disk — tolerated (optional script).
    write_plugin(dir.path(), "sparse", &["missing.lua"], &[]);
    let registry = load_plugins(dir.path()).unwrap();
    assert_eq!(registry.len(), 1);
    assert!(registry.plugins[0].scripts.is_empty());
}
