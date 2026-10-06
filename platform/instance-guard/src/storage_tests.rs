use super::*;
use std::path::PathBuf;

#[test]
fn test_get_disk_space_current_dir() {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let res = get_disk_space(&cwd);
    assert!(res.is_ok(), "failed to read disk space on current dir: {:?}", res.err());
    let space = res.unwrap();
    assert!(space.total_bytes > 0, "total bytes must be > 0");
    assert!(space.available_bytes > 0, "available bytes must be > 0");
    assert!(space.available_bytes <= space.total_bytes, "available cannot exceed total");
}

#[test]
fn test_threshold_constant() {
    assert_eq!(LOW_STORAGE_THRESHOLD_BYTES, 500 * 1024 * 1024);
    assert_eq!(LOW_STORAGE_THRESHOLD_BYTES, 524_288_000);
}

#[test]
fn test_is_storage_low_live() {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    // Under normal circumstances in development, disk space is >= 500 MB.
    let is_low = is_storage_low(&cwd);
    let space = get_disk_space(&cwd).unwrap();
    assert_eq!(is_low, space.available_bytes < LOW_STORAGE_THRESHOLD_BYTES);
}
