use super::*;
use std::io::Write;

/// Helper: build an in-memory `.ozpkg` zip archive from a list of
/// (path_in_archive, content) pairs.
fn build_ozpkg(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buf);

    for (name, data) in files {
        zip.start_file::<&str, ()>(*name, zip::write::FileOptions::default())
            .unwrap();
        zip.write_all(data).unwrap();
    }

    zip.finish().unwrap();
    buf.into_inner()
}

/// Owned-string variant of `build_ozpkg` for tests that need to build
/// many or large entries programmatically.
fn build_ozpkg_owned(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buf);

    for (name, data) in files {
        zip.start_file::<&str, ()>(name.as_str(), zip::write::FileOptions::default())
            .unwrap();
        zip.write_all(data).unwrap();
    }

    zip.finish().unwrap();
    buf.into_inner()
}

#[test]
fn open_valid_ozpkg_with_manifest() {
    let manifest = br#"{"id": "my-plugin", "name": "My Plugin", "version": "1.0.0"}"#;
    let lua = b"-- hello.lua\nfunction run() end";
    let sql = b"CREATE TABLE test (id INTEGER);";

    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("hello.lua", lua),
        ("init.sql", sql),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "test.ozpkg").unwrap();
    assert!(archive.manifest().is_some());
    assert_eq!(archive.scripts(), vec!["hello.lua"]);
    assert_eq!(archive.migrations(), vec!["init.sql"]);
    assert_eq!(archive.len(), 3);
}

#[test]
fn open_ozpkg_missing_manifest_fails() {
    let lua = b"-- orphan.lua";
    let bytes = build_ozpkg(&[("orphan.lua", lua)]);
    let result = OzpkArchive::from_bytes(&bytes, "bad.ozpkg");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("missing manifest.json"), "got: {err}");
}

#[test]
fn open_ozpkg_invalid_manifest_json_fails() {
    let bytes = build_ozpkg(&[("manifest.json", b"not valid json")]);
    let result = OzpkArchive::from_bytes(&bytes, "bad.ozpkg");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("invalid manifest.json"), "got: {err}");
}

#[test]
fn open_ozpkg_invalid_zip_fails() {
    let result = OzpkArchive::from_bytes(b"not a zip file at all", "bad.ozpkg");
    assert!(result.is_err());
}

#[test]
fn open_ozpkg_empty_zip_with_manifest() {
    let manifest = br#"{"id": "empty", "name": "Empty", "version": "0.1.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive = OzpkArchive::from_bytes(&bytes, "empty.ozpkg").unwrap();
    assert!(archive.manifest().is_some());
    assert!(archive.scripts().is_empty());
    assert!(archive.migrations().is_empty());
    assert!(!archive.has_scripts());
    assert!(!archive.has_migrations());
    assert_eq!(archive.len(), 1);
}

#[test]
fn archive_with_subdirectories() {
    let manifest = br#"{"id": "subdirs", "name": "Subdirs", "version": "1.0.0"}"#;
    let lua = b"-- sub/helper.lua";
    let sql = b"CREATE TABLE x (id);";

    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("scripts/helper.lua", lua),
        ("migrations/001_init.sql", sql),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "subdirs.ozpkg").unwrap();
    // scripts() returns filenames only (last component)
    assert_eq!(archive.scripts(), vec!["helper.lua"]);
    assert_eq!(archive.migrations(), vec!["001_init.sql"]);
    assert_eq!(archive.len(), 3);

    // Can read by filename (falls back to last component)
    assert!(archive.read_entry("helper.lua").is_some());
    assert!(archive.read_entry("001_init.sql").is_some());

    // Can read by exact path
    assert!(archive.read_entry_exact("scripts/helper.lua").is_some());
}

#[test]
fn read_entry_exact_vs_fallback() {
    let manifest = br#"{"id": "test", "name": "Test", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest), ("scripts/foo.lua", b"-- foo")]);

    let archive = OzpkArchive::from_bytes(&bytes, "test.ozpkg").unwrap();

    // read_entry with filename works (fallback)
    assert_eq!(archive.read_entry("foo.lua"), Some(&b"-- foo"[..]));

    // read_entry with exact path works
    assert_eq!(
        archive.read_entry_exact("scripts/foo.lua"),
        Some(&b"-- foo"[..])
    );

    // read_entry_exact with just filename does NOT work (no fallback)
    assert!(archive.read_entry_exact("foo.lua").is_none());
}

// ── PLG-01: path-traversal protection ─────────────────────────────

#[test]
fn extract_to_rejects_dotdot_escape() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("../escape.lua", b"-- escaped"),
    ]);
    // Entry names are sanitised at parse time — a `..` component fails closed.
    let result = OzpkArchive::from_bytes(&bytes, "evil.ozpkg");
    assert!(
        result.is_err(),
        "archive with '..' entry should be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".."), "got: {err}");
}

#[test]
fn extract_to_rejects_rooted_path() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("/etc/cron.d/evil", b"* * * * * root pwn"),
    ]);
    let result = OzpkArchive::from_bytes(&bytes, "evil.ozpkg");
    assert!(
        result.is_err(),
        "archive with absolute entry should be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(err.contains("absolute"), "got: {err}");
}

#[test]
fn extract_to_rejects_windows_drive_path() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("C:\\windows\\system32\\evil.dll", b"MZ"),
    ]);
    let result = OzpkArchive::from_bytes(&bytes, "evil.ozpkg");
    assert!(
        result.is_err(),
        "archive with drive prefix should be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(err.contains("drive"), "got: {err}");
}

#[test]
fn extract_to_rejects_unc_path() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("//server/share/evil.lua", b"-- evil"),
    ]);
    let result = OzpkArchive::from_bytes(&bytes, "evil.ozpkg");
    assert!(result.is_err(), "archive with UNC entry should be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("UNC"), "got: {err}");
}

#[test]
fn extract_to_rejects_empty_component() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("scripts//evil.lua", b"-- evil"),
    ]);
    let result = OzpkArchive::from_bytes(&bytes, "evil.ozpkg");
    assert!(
        result.is_err(),
        "archive with empty component should be rejected"
    );
}

#[test]
fn extract_to_keeps_legit_subdirectories() {
    let manifest = br#"{"id": "sub", "name": "Sub", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("scripts/a.lua", b"-- a"),
        ("migrations/b.sql", b"-- b"),
    ]);
    let archive = OzpkArchive::from_bytes(&bytes, "sub.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    archive.extract_to(dest.path()).unwrap();
    assert!(dest.path().join("scripts/a.lua").exists());
    assert!(dest.path().join("migrations/b.sql").exists());
}

// ── PLG-06: resource limits ────────────────────────────────────────

#[test]
fn archive_exceeding_entry_count_is_rejected() {
    let manifest = br#"{"id": "big", "name": "Big", "version": "1.0.0"}"#;
    // 513 tiny entries + manifest > MAX_ARCHIVE_ENTRIES (512)
    let mut files: Vec<(String, Vec<u8>)> = vec![("manifest.json".into(), manifest.to_vec())];
    for i in 0..513 {
        files.push((format!("f{i:04}.lua"), b"-- x".to_vec()));
    }
    let bytes = build_ozpkg_owned(&files);
    let result = OzpkArchive::from_bytes(&bytes, "big.ozpkg");
    assert!(result.is_err(), "archive over entry cap should be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("entry count"), "got: {err}");
}

#[test]
fn archive_with_oversized_compressed_entry_is_rejected() {
    // A single entry whose COMPRESSED size exceeds the cap. We build a
    // large incompressible payload (random bytes) so the stored size is
    // large; the parse-time `compressed_size()` check rejects it early.
    let manifest = br#"{"id": "big", "name": "Big", "version": "1.0.0"}"#;
    // 10 MiB of incompressible pseudo-random bytes (xorshift64), written
    // 8 bytes per iteration so the debug-build test loop runs 1.25M times
    // instead of 10M — same payload, same assertion, 8× less CPU.
    let mut payload: Vec<u8> = Vec::with_capacity(10 * 1024 * 1024);
    let mut seed = 0x1234_5678u64;
    for _ in 0..payload.capacity() / 8 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        payload.extend_from_slice(&seed.to_le_bytes());
    }
    payload.truncate(10 * 1024 * 1024);
    let files = vec![
        ("manifest.json".to_string(), manifest.to_vec()),
        ("big.lua".to_string(), payload),
    ];
    let bytes = build_ozpkg_owned(&files);
    let result = OzpkArchive::from_bytes(&bytes, "big.ozpkg");
    assert!(result.is_err(), "oversized entry should be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("size"), "got: {err}");
}

#[test]
fn archive_with_zip_bomb_ratio_is_rejected() {
    // A highly compressible entry (all zeros, 1 MiB) compresses to a few
    // KB — a ratio far above MAX_COMPRESSION_RATIO (100).
    let manifest = br#"{"id": "bomb", "name": "Bomb", "version": "1.0.0"}"#;
    let files = vec![
        ("manifest.json".to_string(), manifest.to_vec()),
        ("zeros.lua".to_string(), vec![0u8; 1024 * 1024]),
    ];
    let bytes = build_ozpkg_owned(&files);
    let result = OzpkArchive::from_bytes(&bytes, "bomb.ozpkg");
    assert!(result.is_err(), "zip-bomb ratio should be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("ratio"), "got: {err}");
}

#[test]
fn sanitise_entry_name_accepts_normal_paths() {
    assert_eq!(
        sanitise_entry_name("scripts/a.lua").unwrap(),
        "scripts/a.lua"
    );
    assert_eq!(sanitise_entry_name("a\\b.lua").unwrap(), "a/b.lua");
}

#[test]
fn extract_to_directory() {
    let manifest = br#"{"id": "extract", "name": "Extract", "version": "1.0.0"}"#;
    let lua = b"-- extracted.lua";
    let sql = b"CREATE TABLE t (id);";

    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("extracted.lua", lua),
        ("init.sql", sql),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "extract.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    archive.extract_to(dest.path()).unwrap();

    // All files should be written
    assert!(dest.path().join("manifest.json").exists());
    assert!(dest.path().join("extracted.lua").exists());
    assert!(dest.path().join("init.sql").exists());

    // Contents match
    assert_eq!(
        std::fs::read(dest.path().join("extracted.lua")).unwrap(),
        lua
    );
    assert_eq!(std::fs::read(dest.path().join("init.sql")).unwrap(), sql);
}

#[test]
fn extract_to_with_subdirectories() {
    let manifest = br#"{"id": "sub", "name": "Sub", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("scripts/a.lua", b"-- a"),
        ("migrations/b.sql", b"-- b"),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "sub.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    archive.extract_to(dest.path()).unwrap();

    assert!(dest.path().join("manifest.json").exists());
    assert!(dest.path().join("scripts/a.lua").exists());
    assert!(dest.path().join("migrations/b.sql").exists());
}

#[test]
fn extract_scripts_and_migrations_only() {
    let manifest = br#"{"id": "x", "name": "X", "version": "1.0.0"}"#;
    let lua = b"-- script.lua";
    let sql = b"CREATE TABLE t (id);";
    let extra = b"some extra data";

    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("script.lua", lua),
        ("001_create.sql", sql),
        ("readme.txt", extra),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "x.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    archive.extract_scripts_and_migrations(dest.path()).unwrap();

    // Scripts and migrations extracted
    assert!(dest.path().join("scripts/script.lua").exists());
    assert!(dest.path().join("migrations/001_create.sql").exists());

    // Other files NOT extracted
    assert!(!dest.path().join("readme.txt").exists());
    assert!(!dest.path().join("manifest.json").exists());
}

#[test]
fn read_entry_nonexistent() {
    let manifest = br#"{"id": "x", "name": "X", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive = OzpkArchive::from_bytes(&bytes, "x.ozpkg").unwrap();
    assert!(archive.read_entry("nonexistent.lua").is_none());
}

#[test]
fn from_bytes_path_preserved() {
    let manifest = br#"{"id": "p", "name": "P", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive =
        OzpkArchive::from_bytes(&bytes, PathBuf::from("/custom/path/plugin.ozpkg")).unwrap();
    assert_eq!(archive.path(), PathBuf::from("/custom/path/plugin.ozpkg"));
}

#[test]
fn archive_with_multiple_scripts_and_migrations() {
    let manifest = br#"{"id": "multi", "name": "Multi", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("a.lua", b"-- a"),
        ("b.lua", b"-- b"),
        ("x.sql", b"-- x"),
        ("y.sql", b"-- y"),
        ("z.sql", b"-- z"),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "multi.ozpkg").unwrap();

    let mut scripts = archive.scripts();
    scripts.sort();
    assert_eq!(scripts, vec!["a.lua", "b.lua"]);

    let mut migrations = archive.migrations();
    migrations.sort();
    assert_eq!(migrations, vec!["x.sql", "y.sql", "z.sql"]);

    assert_eq!(archive.len(), 6);
    assert!(archive.has_scripts());
    assert!(archive.has_migrations());
}

#[test]
fn other_entry_types() {
    let manifest = br#"{"id": "o", "name": "O", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("data.json", br#"{"key": "value"}"#),
        ("config.yaml", b"key: value"),
        ("README.md", b"# Plugin"),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "other.ozpkg").unwrap();
    // Scripts and migrations should be empty
    assert!(archive.scripts().is_empty());
    assert!(archive.migrations().is_empty());
    // But entries count includes manifest + other files
    assert_eq!(archive.len(), 4);
}

#[test]
fn archive_is_empty_with_only_manifest() {
    let manifest = br#"{"id": "e", "name": "E", "version": "0.0.1"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive = OzpkArchive::from_bytes(&bytes, "e.ozpkg").unwrap();
    assert!(!archive.is_empty());
    assert_eq!(archive.len(), 1);
}

#[test]
fn archive_debug_output() {
    let manifest = br#"{"id": "debug-me", "name": "Debug", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive = OzpkArchive::from_bytes(&bytes, "debug.ozpkg").unwrap();
    let debug = format!("{archive:?}");
    assert!(debug.contains("debug.ozpkg"), "got: {debug}");
}

#[test]
fn ozpk_entry_variant_tests() {
    let manifest_val: Value =
        serde_json::from_str(r#"{"id": "t", "name": "T", "version": "1.0.0"}"#).unwrap();

    let m = OzpkEntry::Manifest(manifest_val.clone());
    let s = OzpkEntry::Script("test.lua".into());
    let mig = OzpkEntry::Migration("001.sql".into());
    let o = OzpkEntry::Other("data.txt".into());

    assert_eq!(m.filename(), "manifest.json");
    assert_eq!(s.filename(), "test.lua");
    assert_eq!(mig.filename(), "001.sql");
    assert_eq!(o.filename(), "data.txt");

    assert!(s.is_script());
    assert!(!m.is_script());
    assert!(mig.is_migration());
    assert!(!o.is_migration());

    // Debug output
    let s_debug = format!("{s:?}");
    assert!(s_debug.contains("test.lua"));
}

#[test]
fn open_from_file() {
    let manifest = br#"{"id": "file-test", "name": "FileTest", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);

    let dir = tempfile::tempdir().unwrap();
    let ozpkg_path = dir.path().join("test.ozpkg");
    std::fs::write(&ozpkg_path, &bytes).unwrap();

    let archive = OzpkArchive::open(&ozpkg_path).unwrap();
    assert_eq!(archive.path(), ozpkg_path);
    assert!(archive.manifest().is_some());
}

#[test]
fn open_nonexistent_file_fails() {
    let result = OzpkArchive::open(Path::new("/does/not/exist/plugin.ozpkg"));
    assert!(result.is_err());
}

#[test]
fn extract_to_creates_dest_dir() {
    let manifest = br#"{"id": "c", "name": "C", "version": "1.0.0"}"#;
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);

    let archive = OzpkArchive::from_bytes(&bytes, "c.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    let sub_dir = dest.path().join("nested/dir");
    archive.extract_to(&sub_dir).unwrap();
    assert!(sub_dir.join("manifest.json").exists());
}

#[test]
fn extract_scripts_and_migrations_creates_dirs() {
    let manifest = br#"{"id": "m", "name": "M", "version": "1.0.0"}"#;
    let lua = b"-- test.lua";
    let sql = b"CREATE TABLE t (id);";

    let bytes = build_ozpkg(&[
        ("manifest.json", manifest),
        ("test.lua", lua),
        ("create.sql", sql),
    ]);

    let archive = OzpkArchive::from_bytes(&bytes, "m.ozpkg").unwrap();
    let dest = tempfile::tempdir().unwrap();
    let sub = dest.path().join("extracted");
    archive.extract_scripts_and_migrations(&sub).unwrap();

    assert!(sub.join("scripts/test.lua").exists());
    assert!(sub.join("migrations/create.sql").exists());
}

#[test]
fn has_scripts_and_has_migrations_edge_cases() {
    let manifest = br#"{"id": "e", "name": "E", "version": "1.0.0"}"#;

    // Only manifest
    let bytes = build_ozpkg(&[("manifest.json", manifest)]);
    let archive = OzpkArchive::from_bytes(&bytes, "e.ozpkg").unwrap();
    assert!(!archive.has_scripts());
    assert!(!archive.has_migrations());

    // Only scripts
    let bytes = build_ozpkg(&[("manifest.json", manifest), ("s.lua", b"-- s")]);
    let archive = OzpkArchive::from_bytes(&bytes, "e.ozpkg").unwrap();
    assert!(archive.has_scripts());
    assert!(!archive.has_migrations());

    // Only migrations
    let bytes = build_ozpkg(&[("manifest.json", manifest), ("m.sql", b"-- m")]);
    let archive = OzpkArchive::from_bytes(&bytes, "e.ozpkg").unwrap();
    assert!(!archive.has_scripts());
    assert!(archive.has_migrations());
}
