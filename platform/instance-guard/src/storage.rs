//! Storage health and disk space detection across platforms.
//!
//! Provides available and total disk capacity measurement for the volume
//! containing a database or application directory, and checks against the
//! critical 500 MB threshold (todo-beta-testing-january-2027.md §2.2).
//!
//! Key items:
//! - [`DiskSpace`] — available and total bytes on the checked volume.
//! - [`LOW_STORAGE_THRESHOLD_BYTES`] — 500 MiB floor (524,288,000 bytes).
//! - [`get_disk_space`] — platform FFI query (`GetDiskFreeSpaceExW` / `statvfs`).
//! - [`is_storage_low`] — boolean check against the 500 MiB floor.

use std::path::Path;

/// Available and total storage in bytes for a volume containing `path`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DiskSpace {
    /// Available bytes to the caller on the filesystem volume.
    pub available_bytes: u64,
    /// Total bytes on the filesystem volume.
    pub total_bytes: u64,
}

/// Critical low storage threshold: 500 MiB (524,288,000 bytes).
pub const LOW_STORAGE_THRESHOLD_BYTES: u64 = 500 * 1024 * 1024;

/// Returns available and total disk space for the volume containing `path`.
pub fn get_disk_space(path: &Path) -> Result<DiskSpace, String> {
    imp::get_disk_space(path)
}

/// Checks whether storage on `path` is below the critical 500 MB threshold.
pub fn is_storage_low(path: &Path) -> bool {
    match get_disk_space(path) {
        Ok(space) => space.available_bytes < LOW_STORAGE_THRESHOLD_BYTES,
        Err(_) => false,
    }
}

#[cfg(windows)]
mod imp {
    use super::DiskSpace;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    pub fn get_disk_space(path: &Path) -> Result<DiskSpace, String> {
        let dir = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let mut wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
        wide.push(0);

        let mut available: u64 = 0;
        let mut total: u64 = 0;
        let mut total_free: u64 = 0;

        // SAFETY: wide is a null-terminated UTF-16 string; out pointers are valid stack references.
        let ret = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                &mut total,
                &mut total_free,
            )
        };

        if ret != 0 {
            Ok(DiskSpace {
                available_bytes: available,
                total_bytes: total,
            })
        } else {
            let err = std::io::Error::last_os_error();
            Err(format!("GetDiskFreeSpaceExW failed: {err}"))
        }
    }
}

#[cfg(unix)]
mod imp {
    use super::DiskSpace;
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    pub fn get_disk_space(path: &Path) -> Result<DiskSpace, String> {
        let dir = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let c_path = CString::new(dir.as_os_str().as_bytes())
            .map_err(|e| format!("invalid path for statvfs: {e}"))?;

        // SAFETY: stat is an all-zeroed buffer passed to statvfs; c_path is a null-terminated C string.
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let ret = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };

        if ret == 0 {
            let available = (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64);
            let total = (stat.f_blocks as u64).saturating_mul(stat.f_frsize as u64);
            Ok(DiskSpace {
                available_bytes: available,
                total_bytes: total,
            })
        } else {
            let err = std::io::Error::last_os_error();
            Err(format!("statvfs failed: {err}"))
        }
    }
}

#[cfg(not(any(windows, unix)))]
mod imp {
    use super::DiskSpace;
    use std::path::Path;

    pub fn get_disk_space(_path: &Path) -> Result<DiskSpace, String> {
        Ok(DiskSpace {
            available_bytes: u64::MAX,
            total_bytes: u64::MAX,
        })
    }
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
