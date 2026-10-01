//! Early single-instance process mutual exclusion guard.
//!
//! Enforces single-instance execution at the process boundary, before the Tauri runtime,
//! WebView2, or SQLite databases are initialized. Without early acquisition, two
//! concurrent launches race for the same EBWebView profile directory (HRESULT
//! 0x800700AA, "The requested resource is in use") and the same kasir.db database file
//! (SQLite lock-upgrade failures reading "attempt to write a readonly database").
//!
//! This module began in apps/desktop-tauri and moved here on 2026-09-29 so the tablet
//! shell could call the same implementation instead of carrying a copy of it. The unsafe
//! it needs appears in exactly four shapes: two extern block declarations, the ownership
//! handoff in InstanceGuard, and the Win32 call sites in acquire_windows. Each carries its
//! own SAFETY note; nothing here relies on a crate-wide allow.
//!
//! scripts/start-desktop.bat shuts down a prior development instance with taskkill /T,
//! which terminates its WebView2 descendants together with the application. This module
//! deliberately does not enumerate generic WebView2 processes: Windows exposes their
//! executable path but not a safe, supported way to attribute an orphaned process to this
//! application's user-data directory.
//!
//! Key types:
//! - InstanceGuard: RAII guard maintaining ownership of the platform process mutex.
//! - Acquisition: Outcome of the mutex acquisition attempt.
//!
//! Invariants:
//! - On Windows, uses a session-local named mutex (Local\mu.kasir.app-primary-instance).
//! - If another instance holds the mutex, checks for active application windows (kasir.mu
//!   or the IPC target). If one is found, it is brought to the foreground, the arguments
//!   are forwarded when the IPC target answered, and the second instance terminates.
//! - If the mutex is held but no window is found, polls briefly with a timeout to allow
//!   the previous instance to exit cleanly before giving up.

/// RAII guard representing active single-instance ownership of the process.
///
/// When dropped, releases the mutex handle so subsequent launches can acquire it.
#[derive(Debug)]
pub struct InstanceGuard {
    #[cfg(windows)]
    handle: Handle,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        if !self.handle.is_null() {
            // SAFETY: self.handle is the non-null kernel handle CreateMutexW returned and
            // no other code closes it. This is the single owner releasing it exactly once,
            // which is what CloseHandle requires.
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

// SAFETY: A Win32 handle names a kernel object owned by this process. The only operation
// this type performs on it, CloseHandle in Drop, is thread-safe, and the ownership rule
// above guarantees one guard closes one handle exactly once. Sending the guard between
// threads therefore transfers that sole ownership rather than granting shared access.
unsafe impl Send for InstanceGuard {}
unsafe impl Sync for InstanceGuard {}

/// Outcome of attempting to acquire single-instance ownership.
#[derive(Debug)]
pub enum Acquisition {
    /// Acquired exclusive ownership. The caller should proceed with booting.
    Acquired(InstanceGuard),
    /// Another instance is already running or holding the lock. The caller should exit cleanly.
    AlreadyRunning,
}

/// Attempts to acquire the single-instance guard.
///
/// On Windows, acquires Local\mu.kasir.app-primary-instance. On every other platform it
/// returns Acquisition::Acquired unconditionally, because the platforms the tablet ships
/// on enforce one instance per application themselves.
pub fn acquire() -> Acquisition {
    #[cfg(windows)]
    {
        acquire_windows(
            "Local\\mu.kasir.app-primary-instance",
            std::time::Duration::from_millis(2000),
        )
    }
    #[cfg(not(windows))]
    {
        Acquisition::Acquired(InstanceGuard {})
    }
}

/// A Win32 kernel handle, as returned by CreateMutexW.
#[cfg(windows)]
type Handle = *mut std::ffi::c_void;
/// A Win32 window handle, as returned by FindWindowW.
#[cfg(windows)]
type Hwnd = *mut std::ffi::c_void;
/// A Win32 BOOL: zero is false, non-zero is true.
#[cfg(windows)]
type Bool = i32;
/// A Win32 DWORD: a 32-bit unsigned integer.
#[cfg(windows)]
type Dword = u32;
/// A pointer to a NUL-terminated UTF-16 string, which Win32 spells LPCWSTR.
#[cfg(windows)]
type WideStrPtr = *const u16;

/// GetLastError value meaning the named object already existed.
#[cfg(windows)]
const ERROR_ALREADY_EXISTS: Dword = 183;
/// ShowWindow flag: restore a minimised or maximised window to its normal size.
#[cfg(windows)]
const SW_RESTORE: i32 = 9;
/// SendMessageW message id: copy a data block to another process.
#[cfg(windows)]
const WM_COPYDATA: u32 = 0x004A;
/// dwData tag identifying this application's single-instance payload.
#[cfg(windows)]
const WMCOPYDATA_SINGLE_INSTANCE_DATA: usize = 1542;

/// Win32's COPYDATASTRUCT, passed by pointer to SendMessageW.
///
/// The field names keep the Windows header's spelling so a reader cross-checking against
/// winuser.h does not have to translate them, which is why this struct carries
/// non_snake_case for the fields alone.
#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct CopyDataStruct {
    dwData: usize,
    cbData: u32,
    lpData: *const std::ffi::c_void,
}

// SAFETY: These are declarations, not calls. Each names a real kernel32 export with the
// signature Windows documents (CreateMutexW, GetLastError, CloseHandle), so the linker
// binds the symbol; the obligation they create, calling them with valid arguments, is
// discharged at each call site below.
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateMutexW(
        lpMutexAttributes: *mut std::ffi::c_void,
        bInitialOwner: Bool,
        lpName: WideStrPtr,
    ) -> Handle;
    fn GetLastError() -> Dword;
    fn CloseHandle(hObject: Handle) -> Bool;
}

// SAFETY: Declarations again, this time for user32. Every window parameter is either a
// handle returned by FindWindowW or checked for null before use, and every pointer
// argument is a NUL-terminated wide string this module builds and keeps alive.
#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn FindWindowW(lpClassName: WideStrPtr, lpWindowName: WideStrPtr) -> Hwnd;
    fn ShowWindow(hWnd: Hwnd, nCmdShow: i32) -> Bool;
    fn SetForegroundWindow(hWnd: Hwnd) -> Bool;
    fn GetWindowThreadProcessId(hWnd: Hwnd, lpdwProcessId: *mut Dword) -> Dword;
    fn AllowSetForegroundWindow(dwProcessId: Dword) -> Bool;
    fn SendMessageW(hWnd: Hwnd, Msg: u32, wParam: usize, lParam: *const std::ffi::c_void) -> isize;
}

/// Encode a Rust string as NUL-terminated UTF-16 for the W-suffixed Win32 entry points.
#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// The Windows acquisition loop: claim the mutex, or find the holder and hand off to it.
#[cfg(windows)]
fn acquire_windows(mutex_name: &str, timeout: std::time::Duration) -> Acquisition {
    use std::time::Instant;

    let wide_mutex = to_wide(mutex_name);
    let wide_sic = to_wide("mu.kasir.app-sic");
    let wide_siw = to_wide("mu.kasir.app-siw");
    let wide_main = to_wide("kasir.mu");

    let start = Instant::now();

    loop {
        // SAFETY: wide_mutex is a live NUL-terminated UTF-16 buffer that outlives this
        // call, and a null security descriptor with a null attribute pointer is documented
        // as legal for CreateMutexW. The returned handle is either null or owned by us, and
        // both branches below account for it: it is either moved into the guard or closed.
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 1, wide_mutex.as_ptr()) };
        // SAFETY: GetLastError takes no arguments, reads the calling thread's own error
        // slot, and cannot fail. It is read immediately after the call whose outcome it
        // describes, the only interval in which the value means anything.
        let err = unsafe { GetLastError() };

        if !handle.is_null() && err != ERROR_ALREADY_EXISTS {
            return Acquisition::Acquired(InstanceGuard { handle });
        }

        if !handle.is_null() {
            // SAFETY: handle is non-null and was just returned by CreateMutexW. It is the
            // already-exists handle this function owns, no copy of it escapes this branch,
            // and closing it releases that one reference.
            unsafe {
                CloseHandle(handle);
            }
        }

        // SAFETY: Both arguments point at buffers kept alive above, and a null class-name
        // parameter is documented as "any class". The returned handle is only compared and
        // passed on to the user32 calls below, never dereferenced here.
        let target_hwnd = unsafe { FindWindowW(wide_sic.as_ptr(), wide_siw.as_ptr()) };
        // SAFETY: The same contract as the call above, with the main window title.
        let main_hwnd = unsafe { FindWindowW(std::ptr::null(), wide_main.as_ptr()) };

        if !target_hwnd.is_null() || !main_hwnd.is_null() {
            let active_hwnd = if !main_hwnd.is_null() {
                main_hwnd
            } else {
                target_hwnd
            };

            // SAFETY: active_hwnd is non-null, the branch above guarantees it, and it came
            // from FindWindowW. pid is a live stack slot for the duration of the calls that
            // read it. Every remaining call takes that handle or its pid. data outlives cds
            // and cds outlives the SendMessageW that reads it, which is what WM_COPYDATA
            // requires: the receiver reads the block before the sender returns.
            unsafe {
                let mut pid: Dword = 0;
                GetWindowThreadProcessId(active_hwnd, &mut pid);
                if pid != 0 {
                    AllowSetForegroundWindow(pid);
                }
                ShowWindow(active_hwnd, SW_RESTORE);
                SetForegroundWindow(active_hwnd);

                if !target_hwnd.is_null() {
                    let cwd = std::env::current_dir().unwrap_or_default();
                    let cwd = cwd.to_str().unwrap_or_default();
                    let args = std::env::args().collect::<Vec<String>>().join("|");
                    let data = format!("{cwd}|{args}\0");
                    let bytes = data.as_bytes();
                    let cds = CopyDataStruct {
                        dwData: WMCOPYDATA_SINGLE_INSTANCE_DATA,
                        cbData: bytes.len() as _,
                        lpData: bytes.as_ptr() as _,
                    };
                    SendMessageW(target_hwnd, WM_COPYDATA, 0, &cds as *const _ as _);
                }
            }
            return Acquisition::AlreadyRunning;
        }

        if start.elapsed() >= timeout {
            tracing::warn!(
                "another instance of kasir.mu is holding the instance mutex; terminating secondary launch"
            );
            return Acquisition::AlreadyRunning;
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[cfg(test)]
#[path = "single_instance_tests.rs"]
mod tests;
