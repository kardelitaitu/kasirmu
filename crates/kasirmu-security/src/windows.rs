/*
last audited DD-MM-YY by DSH-Agent
crate: oz-security (windows) | status: SAFE | lint: CLEAN
findings: 8 unsafe blocks (not 6 — prior stamp miscount) — all with SAFETY comments (CredReadW, GetLastError×3, from_raw_parts+CredFree, zeroed FILETIME, CredWriteW, CredDeleteW). SEC-3 FIXED — zero-size CredentialBlob no longer passes a potentially-null pointer to from_raw_parts (uses &[] instead). CredFree called on every path. Module-level #[allow(unsafe_code)] is necessary for Win32 FFI; crate root #[deny(unsafe_code)] holds for all other files.
next: none — SEC-3 closed | perf: FFI overhead negligible
*/

//! Windows Credential Manager implementation of [`Keyring`].
//!
//! Wraps `wincred` / `CredWriteW` / `CredReadW` / `CredDeleteW`
//! from `advapi32.dll` to store secrets.

#![allow(unsafe_code)]

use crate::Keyring;
use crate::error::SecurityError;
use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, FALSE, GetLastError};
use windows_sys::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW,
    CredWriteW,
};

/// Windows Credential Manager keyring.
///
/// Stores secrets in the Windows Credential Manager under the
/// target name `OZ-POS:{name}`.
pub struct WindowsCredentialManager;

impl WindowsCredentialManager {
    /// Create a new Windows Credential Manager keyring instance.
    pub fn new() -> Result<Self, SecurityError> {
        Ok(Self)
    }
}

impl Keyring for WindowsCredentialManager {
    fn get_secret(&self, name: &str) -> Result<Option<String>, SecurityError> {
        let target = encode_utf16_null(&format!("OZ-POS:{name}"));

        let mut p_cred: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: CredReadW reads a credential from Windows Credential Manager.
        // `target` is a valid null-terminated UTF-16 string. The output pointer
        // `p_cred` is checked via the return value and is only dereferenced if
        // the call succeeds.
        let rc = unsafe {
            CredReadW(
                target.as_ptr() as *mut u16,
                CRED_TYPE_GENERIC,
                0,
                &mut p_cred,
            )
        };

        if rc == FALSE {
            // SAFETY: GetLastError retrieves the calling thread's last-error code.
            // Safe to call immediately after a failed Win32 API call.
            let err = unsafe { GetLastError() };
            if err == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(SecurityError::KeyUnavailable(format!(
                "CredReadW failed: {err}"
            )));
        }

        // SAFETY: p_cred is guaranteed non-null because CredReadW returned
        // success above. The CredentialBlob pointer and CredentialBlobSize
        // describe a valid byte buffer allocated by the Win32 API. from_raw_parts
        // creates a temporary slice for the lifetime of the unsafe block only.
        // CredFree releases the memory allocated by CredReadW — called exactly
        // once here on every path (including the SEC-3 zero-size guard below),
        // matching the Win32 convention that the caller frees.
        let secret = unsafe {
            let cred = &*p_cred;
            // SEC-3: a zero-size CredentialBlob means the pointer is dangling
            // or null — from_raw_parts(ptr, 0) with a null/dangling pointer is
            // UB. Treat it as an empty secret rather than slicing.
            let blob = if cred.CredentialBlobSize == 0 {
                &[]
            } else {
                std::slice::from_raw_parts(
                    cred.CredentialBlob as *const u8,
                    cred.CredentialBlobSize as usize,
                )
            };
            let s = String::from_utf8_lossy(blob).into_owned();
            CredFree(p_cred as *const core::ffi::c_void);
            s
        };

        Ok(Some(secret))
    }

    fn set_secret(&self, name: &str, value: &str) -> Result<(), SecurityError> {
        let target = encode_utf16_null(&format!("OZ-POS:{name}"));
        let blob = value.as_bytes().to_vec();

        let cred = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr() as *mut u16,
            Comment: std::ptr::null_mut(),
            // SAFETY: FILETIME is a POD struct (two u32 fields);
            // zero-initialization is valid and produces a well-defined value.
            LastWritten: unsafe { std::mem::zeroed() },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: std::ptr::null_mut(),
        };

        // SAFETY: The CREDENTIALW struct is fully initialized with valid
        // pointers (target name, blob) and sizes. CredWriteW copies the data
        // internally and does not retain the pointers after returning.
        let rc = unsafe { CredWriteW(&cred, 0) };
        if rc == FALSE {
            // SAFETY: GetLastError retrieves the calling thread's last-error code.
            // Safe to call immediately after a failed Win32 API call.
            let err = unsafe { GetLastError() };
            return Err(SecurityError::KeyUnavailable(format!(
                "CredWriteW failed: {err}"
            )));
        }
        Ok(())
    }

    fn delete_secret(&self, name: &str) -> Result<bool, SecurityError> {
        let target = encode_utf16_null(&format!("OZ-POS:{name}"));

        // SAFETY: The target name is a valid null-terminated UTF-16 string.
        // CredDeleteW is safe with valid arguments and does not retain pointers.
        let rc = unsafe { CredDeleteW(target.as_ptr() as *mut u16, CRED_TYPE_GENERIC, 0) };

        if rc == FALSE {
            // SAFETY: GetLastError retrieves the calling thread's last-error code.
            // Safe to call immediately after a failed Win32 API call.
            let err = unsafe { GetLastError() };
            if err == ERROR_NOT_FOUND {
                return Ok(false);
            }
            return Err(SecurityError::KeyUnavailable(format!(
                "CredDeleteW failed: {err}"
            )));
        }
        Ok(true)
    }

    // `rotate_key` and `key_created_at` use the default implementations
    // from the `Keyring` trait.
}

fn encode_utf16_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
