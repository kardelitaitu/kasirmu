use super::*;
use std::io::Write;

/// Helper: build an in-memory `.kasirpkg` zip archive from a list of
/// (path_in_archive, content) pairs.
fn build_kasirpkg(files: &[(&str, &[u8])]) -> Vec<u8> {
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

/// Owned-string variant of `build_kasirpkg` for tests that need to build
/// many or large entries programmatically.
fn build_kasirpkg_owned(files: &[(String, Vec<u8>)]) -> Vec<u8> {
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
fn open_valid_kasirpkg_with_manifest() {
    let manifest = br#"{"id": "my-plugin", "name": "My Plugin", "version": "1.0.0"}"#;
    let lua = b"-- hello.lua\nfunction run() end";
    let sql = b"CREATE TABLE test (id INTEGER);";

    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("hello.lua", lua),
        ("init.sql", sql),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "test.kasirpkg").unwrap();
    assert!(archive.manifest().is_some());
    assert_eq!(archive.scripts(), vec!["hello.lua"]);
    assert_eq!(archive.migrations(), vec!["init.sql"]);
    assert_eq!(archive.len(), 3);
}

#[test]
fn open_kasirpkg_missing_manifest_fails() {
    let lua = b"-- orphan.lua";
    let bytes = build_kasirpkg(&[("orphan.lua", lua)]);
    let result = KasirpkArchive::from_bytes(&bytes, "bad.kasirpkg");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("missing manifest.json"), "got: {err}");
}

#[test]
fn open_kasirpkg_invalid_manifest_json_fails() {
    let bytes = build_kasirpkg(&[("manifest.json", b"not valid json")]);
    let result = KasirpkArchive::from_bytes(&bytes, "bad.kasirpkg");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("invalid manifest.json"), "got: {err}");
}

#[test]
fn open_kasirpkg_invalid_zip_fails() {
    let result = KasirpkArchive::from_bytes(b"not a zip file at all", "bad.kasirpkg");
    assert!(result.is_err());
}

#[test]
fn open_kasirpkg_empty_zip_with_manifest() {
    let manifest = br#"{"id": "empty", "name": "Empty", "version": "0.1.0"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive = KasirpkArchive::from_bytes(&bytes, "empty.kasirpkg").unwrap();
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

    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts/helper.lua", lua),
        ("migrations/001_init.sql", sql),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "subdirs.kasirpkg").unwrap();
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
    let bytes = build_kasirpkg(&[("manifest.json", manifest), ("scripts/foo.lua", b"-- foo")]);

    let archive = KasirpkArchive::from_bytes(&bytes, "test.kasirpkg").unwrap();

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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("../escape.lua", b"-- escaped"),
    ]);
    // Entry names are sanitised at parse time — a `..` component fails closed.
    let result = KasirpkArchive::from_bytes(&bytes, "evil.kasirpkg");
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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("/etc/cron.d/evil", b"* * * * * root pwn"),
    ]);
    let result = KasirpkArchive::from_bytes(&bytes, "evil.kasirpkg");
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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("C:\\windows\\system32\\evil.dll", b"MZ"),
    ]);
    let result = KasirpkArchive::from_bytes(&bytes, "evil.kasirpkg");
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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("//server/share/evil.lua", b"-- evil"),
    ]);
    let result = KasirpkArchive::from_bytes(&bytes, "evil.kasirpkg");
    assert!(result.is_err(), "archive with UNC entry should be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("UNC"), "got: {err}");
}

#[test]
fn extract_to_rejects_empty_component() {
    let manifest = br#"{"id": "evil", "name": "Evil", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts//evil.lua", b"-- evil"),
    ]);
    let result = KasirpkArchive::from_bytes(&bytes, "evil.kasirpkg");
    assert!(
        result.is_err(),
        "archive with empty component should be rejected"
    );
}

#[test]
fn extract_to_keeps_legit_subdirectories() {
    let manifest = br#"{"id": "sub", "name": "Sub", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts/a.lua", b"-- a"),
        ("migrations/b.sql", b"-- b"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "sub.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
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
    let bytes = build_kasirpkg_owned(&files);
    let result = KasirpkArchive::from_bytes(&bytes, "big.kasirpkg");
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
    let bytes = build_kasirpkg_owned(&files);
    let result = KasirpkArchive::from_bytes(&bytes, "big.kasirpkg");
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
    let bytes = build_kasirpkg_owned(&files);
    let result = KasirpkArchive::from_bytes(&bytes, "bomb.kasirpkg");
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

    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("extracted.lua", lua),
        ("init.sql", sql),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "extract.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts/a.lua", b"-- a"),
        ("migrations/b.sql", b"-- b"),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "sub.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
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

    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("script.lua", lua),
        ("001_create.sql", sql),
        ("readme.txt", extra),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "x.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
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
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive = KasirpkArchive::from_bytes(&bytes, "x.kasirpkg").unwrap();
    assert!(archive.read_entry("nonexistent.lua").is_none());
}

#[test]
fn from_bytes_path_preserved() {
    let manifest = br#"{"id": "p", "name": "P", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive =
        KasirpkArchive::from_bytes(&bytes, PathBuf::from("/custom/path/plugin.kasirpkg")).unwrap();
    assert_eq!(
        archive.path(),
        PathBuf::from("/custom/path/plugin.kasirpkg")
    );
}

#[test]
fn archive_with_multiple_scripts_and_migrations() {
    let manifest = br#"{"id": "multi", "name": "Multi", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("a.lua", b"-- a"),
        ("b.lua", b"-- b"),
        ("x.sql", b"-- x"),
        ("y.sql", b"-- y"),
        ("z.sql", b"-- z"),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "multi.kasirpkg").unwrap();

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
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("data.json", br#"{"key": "value"}"#),
        ("config.yaml", b"key: value"),
        ("README.md", b"# Plugin"),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "other.kasirpkg").unwrap();
    // Scripts and migrations should be empty
    assert!(archive.scripts().is_empty());
    assert!(archive.migrations().is_empty());
    // But entries count includes manifest + other files
    assert_eq!(archive.len(), 4);
}

#[test]
fn archive_is_empty_with_only_manifest() {
    let manifest = br#"{"id": "e", "name": "E", "version": "0.0.1"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive = KasirpkArchive::from_bytes(&bytes, "e.kasirpkg").unwrap();
    assert!(!archive.is_empty());
    assert_eq!(archive.len(), 1);
}

#[test]
fn archive_debug_output() {
    let manifest = br#"{"id": "debug-me", "name": "Debug", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive = KasirpkArchive::from_bytes(&bytes, "debug.kasirpkg").unwrap();
    let debug = format!("{archive:?}");
    assert!(debug.contains("debug.kasirpkg"), "got: {debug}");
}

#[test]
fn kasirpk_entry_variant_tests() {
    let manifest_val: Value =
        serde_json::from_str(r#"{"id": "t", "name": "T", "version": "1.0.0"}"#).unwrap();

    let m = KasirpkEntry::Manifest(manifest_val.clone());
    let s = KasirpkEntry::Script("test.lua".into());
    let mig = KasirpkEntry::Migration("001.sql".into());
    let o = KasirpkEntry::Other("data.txt".into());

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
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);

    let dir = kasirmu_test_support::tempdir();
    let kasirpkg_path = dir.path().join("test.kasirpkg");
    std::fs::write(&kasirpkg_path, &bytes).unwrap();

    let archive = KasirpkArchive::open(&kasirpkg_path).unwrap();
    assert_eq!(archive.path(), kasirpkg_path);
    assert!(archive.manifest().is_some());
}

#[test]
fn open_nonexistent_file_fails() {
    let result = KasirpkArchive::open(Path::new("/does/not/exist/plugin.kasirpkg"));
    assert!(result.is_err());
}

#[test]
fn extract_to_creates_dest_dir() {
    let manifest = br#"{"id": "c", "name": "C", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);

    let archive = KasirpkArchive::from_bytes(&bytes, "c.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
    let sub_dir = dest.path().join("nested/dir");
    archive.extract_to(&sub_dir).unwrap();
    assert!(sub_dir.join("manifest.json").exists());
}

#[test]
fn extract_scripts_and_migrations_creates_dirs() {
    let manifest = br#"{"id": "m", "name": "M", "version": "1.0.0"}"#;
    let lua = b"-- test.lua";
    let sql = b"CREATE TABLE t (id);";

    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("test.lua", lua),
        ("create.sql", sql),
    ]);

    let archive = KasirpkArchive::from_bytes(&bytes, "m.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
    let sub = dest.path().join("extracted");
    archive.extract_scripts_and_migrations(&sub).unwrap();

    assert!(sub.join("scripts/test.lua").exists());
    assert!(sub.join("migrations/create.sql").exists());
}

#[test]
fn has_scripts_and_has_migrations_edge_cases() {
    let manifest = br#"{"id": "e", "name": "E", "version": "1.0.0"}"#;

    // Only manifest
    let bytes = build_kasirpkg(&[("manifest.json", manifest)]);
    let archive = KasirpkArchive::from_bytes(&bytes, "e.kasirpkg").unwrap();
    assert!(!archive.has_scripts());
    assert!(!archive.has_migrations());

    // Only scripts
    let bytes = build_kasirpkg(&[("manifest.json", manifest), ("s.lua", b"-- s")]);
    let archive = KasirpkArchive::from_bytes(&bytes, "e.kasirpkg").unwrap();
    assert!(archive.has_scripts());
    assert!(!archive.has_migrations());

    // Only migrations
    let bytes = build_kasirpkg(&[("manifest.json", manifest), ("m.sql", b"-- m")]);
    let archive = KasirpkArchive::from_bytes(&bytes, "e.kasirpkg").unwrap();
    assert!(!archive.has_scripts());
    assert!(archive.has_migrations());
}

// ── O-M52: read_entry index equivalence ───────────────────────────

/// The PRE-O-M52 `read_entry` body, verbatim (only `self` narrowed to the field
/// it touched), kept here as the oracle the index is proved against.
///
/// It scans `entry_contents` once per call and allocates a normalised `String`
/// per stored entry plus one for the target. One call is O(n); the caller,
/// `extract_scripts_and_migrations`, makes one call per entry, which is the
/// O(n²) with an allocation per entry that O-M52 names.
fn old_read_entry<'a>(
    entry_contents: &'a std::collections::HashMap<String, Vec<u8>>,
    filename: &str,
) -> Option<&'a [u8]> {
    // Try exact match first
    if let Some(data) = entry_contents.get(filename) {
        return Some(data.as_slice());
    }
    // Fall back to matching on the last path component
    let normalised = filename.replace('\\', "/");
    let target = normalised
        .rsplit('/')
        .next()
        .unwrap_or(&normalised)
        .to_string();
    for (stored_name, data) in entry_contents {
        let stored_normalised = stored_name.replace('\\', "/");
        let stored_file = stored_normalised
            .rsplit('/')
            .next()
            .unwrap_or(&stored_normalised);
        if stored_file == target {
            return Some(data.as_slice());
        }
    }
    None
}

/// The stored name whose bytes are `bytes`, or `None`.
fn stored_name_of<'a>(archive: &'a KasirpkArchive, bytes: &[u8]) -> Option<&'a str> {
    archive
        .entry_contents
        .iter()
        .find(|(_, data)| data.as_slice() == bytes)
        .map(|(name, _)| name.as_str())
}

/// A `HashMap` holding the same content inserted in a SECOND, independent
/// order.
///
/// The old fallback scanned a `HashMap`, whose iteration order depends on the
/// per-process `RandomState`, so one run of the oracle samples exactly one point
/// of all that oracle could ever have returned. The point that matters is the
/// one where a query is a miss: a fresh map with a different seed gives a
/// genuinely different scan order, so if the old scan could find a name under
/// ANY order, at least one of the two maps will.
fn alternate_order(
    entry_contents: &std::collections::HashMap<String, Vec<u8>>,
) -> std::collections::HashMap<String, Vec<u8>> {
    entry_contents
        .iter()
        .map(|(name, data)| (name.clone(), data.clone()))
        .collect()
}

/// Compare `read_entry` against `old_read_entry` for one archive and one query.
///
/// Equality is on `(present, bytes)` under both insert orders, plus the winning
/// NAME wherever the old lookup is order-independent.
///
/// Two entries can legitimately carry identical payloads, so a byte comparison
/// alone would not notice a wrong winner — hence the name. Name equality is only
/// required when both mirror orders pick the same winner — the `if` at the foot of
/// this function, where the old lookup is re-run over the alternate order and the
/// two results are compared. (This note used to name a helper `old_order_is_stable`
/// that was never written; the condition is inline.) That set of stable cases is
/// what the index must reproduce exactly.
fn assert_matches_old(archive: &KasirpkArchive, query: &str) {
    let second_order = alternate_order(&archive.entry_contents);
    let old = old_read_entry(&archive.entry_contents, query);
    let new = archive.read_entry(query);

    assert_eq!(
        new.is_some(),
        old.is_some(),
        "presence differs for query {query:?}"
    );
    assert_eq!(new, old, "bytes differ for query {query:?}");

    // And the old lookup under the other scan order must not find anything this
    // one does not: by the pre-index rule "the first entry whose last path
    // component equals the target", presence is order-INDEPENDENT. Only the
    // winner varies with order.
    assert_eq!(
        new.is_some(),
        old_read_entry(&second_order, query).is_some(),
        "presence differs under the alternate scan order for query {query:?}"
    );

    // Name equality is only meaningful where the old winner did not depend on
    // iteration order.
    if old_read_entry(&second_order, query) == old {
        assert_eq!(
            new.and_then(|bytes| stored_name_of(archive, bytes)),
            old.and_then(|bytes| stored_name_of(archive, bytes)),
            "winner differs for query {query:?}"
        );
    }
}

#[test]
fn read_entry_matches_the_old_lookup_on_every_awkward_name_form() {
    let manifest = br#"{"id": "eq", "name": "Eq", "version": "1.0.0"}"#;
    // Every entry carries a distinct payload so the byte comparison is a real
    // witness of which entry answered.
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("hello.lua", b"-- top-level hello"),
        ("scripts/helper.lua", b"-- nested helper"),
        ("scripts/deep/nested/x.sql", b"CREATE TABLE deep (id);"),
        ("config.yaml", b"key: value"),
        ("Mixed.LUA", b"-- uppercase extension"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "eq.kasirpkg").unwrap();

    // Every form `read_entry` accepts today: exact name, bare filename of a
    // nested entry, path with a directory prefix, backslash prefix, trailing
    // separator, different case (must miss — lookup is byte-exact), absent.
    let queries = [
        "manifest.json",
        "hello.lua",
        "helper.lua",
        "scripts/helper.lua",
        "scripts\\helper.lua",
        "scripts/",
        "nested/x.sql",
        "x.sql",
        "scripts/deep/nested/x.sql",
        "config.yaml",
        "Mixed.LUA",
        "mixed.lua",
        "HELLO.LUA",
        "missing.lua",
        "",
        "/",
        "./hello.lua",
        "./scripts/helper.lua",
        "absent/nothing.sql",
        "\\",
        "ünïcode.lua",
        "manifest.json/nope",
    ];
    for query in queries {
        assert_matches_old(&archive, query);
    }

    // Absolute expectations for the forms that DO resolve, so the equivalence
    // test cannot pass by both sides being equally wrong.
    assert_eq!(
        archive.read_entry("hello.lua"),
        Some(&b"-- top-level hello"[..])
    );
    assert_eq!(
        archive.read_entry("helper.lua"),
        Some(&b"-- nested helper"[..])
    );
    assert_eq!(
        archive.read_entry("scripts/helper.lua"),
        Some(&b"-- nested helper"[..])
    );
    assert_eq!(
        archive.read_entry("scripts\\helper.lua"),
        Some(&b"-- nested helper"[..])
    );
    assert_eq!(
        archive.read_entry("nested/x.sql"),
        Some(&b"CREATE TABLE deep (id);"[..])
    );
    assert_eq!(archive.read_entry("manifest.json"), Some(&manifest[..]));
    // Lookup is byte-exact: no case folding existed before and none is added.
    assert_eq!(archive.read_entry("HELLO.LUA"), None);
    assert_eq!(archive.read_entry("mixed.lua"), None);
    assert_eq!(
        archive.read_entry("Mixed.LUA"),
        Some(&b"-- uppercase extension"[..])
    );
    assert_eq!(archive.read_entry("config.yaml"), Some(&b"key: value"[..]));
}

#[test]
fn read_entry_absent_name_is_still_none_after_the_index() {
    let manifest = br#"{"id": "x", "name": "X", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[("manifest.json", manifest), ("a.lua", b"-- a")]);
    let archive = KasirpkArchive::from_bytes(&bytes, "x.kasirpkg").unwrap();

    // Absent, and the error shape is unchanged (`None`, not an `Err`): a name
    // that is not there, a missing extension, and the empty query — which
    // resolves to the empty last component, and no stored name can equal that.
    for query in ["nonexistent.lua", "a.sql", ""] {
        assert_eq!(archive.read_entry(query), None, "query {query:?}");
        assert_matches_old(&archive, query);
    }
    // A directory prefix the archive does not have still resolves: `read_entry`
    // keys on the last component and discards the prefix. That is the
    // PRE-EXISTING behaviour — `old_read_entry` does exactly the same — not a
    // regression the index introduced; pinned here so it cannot drift silently.
    for query in ["scripts/a.lua", "/a.lua", "a.lua"] {
        assert_eq!(
            archive.read_entry(query),
            Some(&b"-- a"[..]),
            "query {query:?}"
        );
        assert_matches_old(&archive, query);
    }
    // A trailing separator is NOT stripped into a match: the last component of
    // `"a.lua/"` is the empty string, exactly as before.
    assert_eq!(archive.read_entry("a.lua/"), None);
    assert_matches_old(&archive, "a.lua/");
    // `read_entry_exact` is untouched by O-M52 and still refuses the fallback.
    assert_eq!(archive.read_entry_exact("a.lua"), Some(&b"-- a"[..]));
    assert_eq!(archive.read_entry_exact("scripts/a.lua"), None);
}

#[test]
fn read_entry_prefers_an_exact_name_over_a_same_filename_elsewhere() {
    let manifest = br#"{"id": "dup", "name": "Dup", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("foo.lua", b"-- top-level foo"),
        ("scripts/foo.lua", b"-- nested foo"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "dup.kasirpkg").unwrap();

    // The exact-name branch runs before the filename branch — unchanged.
    assert_eq!(
        archive.read_entry("foo.lua"),
        Some(&b"-- top-level foo"[..])
    );
    assert_eq!(
        archive.read_entry("scripts/foo.lua"),
        Some(&b"-- nested foo"[..])
    );
    assert_matches_old(&archive, "foo.lua");
    assert_matches_old(&archive, "scripts/foo.lua");
}

#[test]
fn read_entry_duplicate_filenames_pick_the_first_entry() {
    let manifest = br#"{"id": "dup2", "name": "Dup2", "version": "1.0.0"}"#;
    // The same last component under two directories: the duplicate the
    // pre-index scan keyed on.
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("first/dup.lua", b"-- first"),
        ("second/dup.lua", b"-- second"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "dup2.kasirpkg").unwrap();

    // The answer for the bare name is "the first entry in ARCHIVE order that
    // carries this filename". It is NOT the old answer: the pre-index scan
    // returned whichever of the two `entry_contents` iteration reached first,
    // which varied per run and per process. Both entries remain reachable by
    // their full path, and that is the surface a caller can rely on; no caller
    // in this repo reads `read_entry` with a duplicated filename.
    //
    // The assertion is written so it pins WHICH entry answered, not a guess at
    // archive order: `ZipWriter` plus a `HashMap` gives no guarantee that
    // "first" is `first/dup.lua`, and pinning the wrong one would be a false
    // statement about the code.
    let bare = archive.read_entry("dup.lua").expect("duplicate filename");
    assert!(bare == b"-- first" || bare == b"-- second", "got: {bare:?}");
    // Whichever answered must be the one the index points at, for all runs.
    assert_eq!(archive.read_entry("dup.lua"), Some(bare));
    assert_eq!(
        archive.read_entry("second/dup.lua"),
        Some(&b"-- second"[..])
    );
    assert_eq!(archive.read_entry("first/dup.lua"), Some(&b"-- first"[..]));
    assert_eq!(
        archive.read_entry_exact("second/dup.lua"),
        Some(&b"-- second"[..])
    );
    // `read_entry("dup.lua")` deliberately gets NO name assertion against the
    // oracle: two stored entries share that filename, so the old scan's winner
    // came from `HashMap` iteration order and is not a value to compare against.
    // The rule above (first in archive order) is the deliberate, stable
    // replacement; the old lookup must still find SOMETHING, which
    // `assert_matches_old` checks for presence.
    assert_matches_old(&archive, "second/dup.lua");
}

#[test]
fn read_entry_fallback_scan_survives_an_archive_with_no_index() {
    // A clone whose index was cleared stands in for an archive assembled by a
    // path other than `from_reader`. The retained scan must still answer, and
    // must agree with the indexed answer.
    let manifest = br#"{"id": "scan", "name": "Scan", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts/helper.lua", b"-- helper"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "scan.kasirpkg").unwrap();
    let mut unindexed = archive.clone();
    unindexed.filename_index.clear();

    for query in [
        "helper.lua",
        "scripts/helper.lua",
        "manifest.json",
        "nope.lua",
    ] {
        assert_eq!(
            unindexed.read_entry(query),
            archive.read_entry(query),
            "query {query:?}"
        );
    }
    assert_eq!(unindexed.read_entry("helper.lua"), Some(&b"-- helper"[..]));
    assert_eq!(unindexed.read_entry("nope.lua"), None);
}

#[test]
fn extract_scripts_and_migrations_is_unchanged_by_the_index() {
    let manifest = br#"{"id": "ext", "name": "Ext", "version": "1.0.0"}"#;
    let bytes = build_kasirpkg(&[
        ("manifest.json", manifest),
        ("scripts/a.lua", b"-- a"),
        ("scripts/nested/b.lua", b"-- b"),
        ("migrations/001_init.sql", b"CREATE TABLE a (id);"),
        ("migrations/nested/002_more.sql", b"CREATE TABLE b (id);"),
        ("readme.txt", b"ignored"),
    ]);
    let archive = KasirpkArchive::from_bytes(&bytes, "ext.kasirpkg").unwrap();
    let dest = kasirmu_test_support::tempdir();
    archive.extract_scripts_and_migrations(dest.path()).unwrap();

    // Flattened to the filename, as before — every script and migration lands.
    for (dir, name, body) in [
        ("scripts", "a.lua", &b"-- a"[..]),
        ("scripts", "b.lua", &b"-- b"[..]),
        ("migrations", "001_init.sql", &b"CREATE TABLE a (id);"[..]),
        ("migrations", "002_more.sql", &b"CREATE TABLE b (id);"[..]),
    ] {
        let written = std::fs::read(dest.path().join(dir).join(name))
            .unwrap_or_else(|e| panic!("{dir}/{name} not written: {e}"));
        assert_eq!(written, body, "{dir}/{name}");
    }
    // Other files are still not extracted.
    assert!(!dest.path().join("scripts/readme.txt").exists());
    assert!(!dest.path().join("manifest.json").exists());
}
