//! Early single-instance process mutual exclusion guard.
//!
//! Enforces single-instance execution at the process boundary before the Tauri runtime,
//! WebView2, or SQLite databases are initialized. Without early acquisition, two
//! concurrent launches race for the same `EBWebView` profile directory (resulting in
//! `HRESULT 0x800700AA: The requested resource is in use`) and the same `kasir.db`
//! database file (resulting in SQLite lock upgrade errors: `attempt to write a readonly database`).
//!
//! Key types:
//! - [`InstanceGuard`]: RAII guard maintaining ownership of the platform process mutex.
//! - [`Acquisition`]: Outcome of the mutex acquisition attempt.
//!
//! Invariants:
//! - On Windows, uses a session-local named mutex (`Local\mu.kasir.app-primary-instance`).
//! - If another instance holds the mutex, checks for active application windows (`kasir.mu` or IPC target).
//!   If found, brings the active window to the foreground, forwards arguments if applicable, and terminates.
//! - If the mutex is held but no window is found (e.g. during rapid `tauri dev` watch reload where the
//!   old process is in mid-termination), polls briefly with timeout to allow the previous instance to exit
//!   cleanly and release file locks before failing.

/// RAII guard representing active single-instance ownership of the process.
///
/// When dropped, releases the mutex handle so subsequent launches can acquire it.
#[derive(Debug)]
pub struct InstanceGuard {
    #[cfg(windows)]
    handle: *mut std::ffi::c_void,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        if !self.handle.is_null() {
            // SAFETY: `self.handle` is a valid Win32 kernel HANDLE created by `CreateMutexW`.
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

// SAFETY: The Win32 HANDLE represents a kernel object handle owned exclusively
// by this process; it can safely be sent and shared across threads.
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
/// On Windows, acquires `Local\mu.kasir.app-primary-instance`.
/// On other platforms, returns [`Acquisition::Acquired`] unconditionally.
pub fn acquire() -> Acquisition {
    #[cfg(windows)]
    {
        acquire_windows(
            "Local\\mu.kasir.app-primary-instance",
            std::time::Duration::from_millis(1500),
        )
    }
    #[cfg(not(windows))]
    {
        Acquisition::Acquired(InstanceGuard {})
    }
}

#[cfg(windows)]
type HANDLE = *mut std::ffi::c_void;
#[cfg(windows)]
type HWND = *mut std::ffi::c_void;
#[cfg(windows)]
type BOOL = i32;
#[cfg(windows)]
type DWORD = u32;
#[cfg(windows)]
type LPCWSTR = *const u16;

#[cfg(windows)]
const ERROR_ALREADY_EXISTS: DWORD = 183;
#[cfg(windows)]
const SW_RESTORE: i32 = 9;
#[cfg(windows)]
const WM_COPYDATA: u32 = 0x004A;
#[cfg(windows)]
const WMCOPYDATA_SINGLE_INSTANCE_DATA: usize = 1542;

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct COPYDATASTRUCT {
    dwData: usize,
    cbData: u32,
    lpData: *const std::ffi::c_void,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateMutexW(
        lpMutexAttributes: *mut std::ffi::c_void,
        bInitialOwner: BOOL,
        lpName: LPCWSTR,
    ) -> HANDLE;
    fn GetLastError() -> DWORD;
    fn CloseHandle(hObject: HANDLE) -> BOOL;
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn FindWindowW(lpClassName: LPCWSTR, lpWindowName: LPCWSTR) -> HWND;
    fn ShowWindow(hWnd: HWND, nCmdShow: i32) -> BOOL;
    fn SetForegroundWindow(hWnd: HWND) -> BOOL;
    fn GetWindowThreadProcessId(hWnd: HWND, lpdwProcessId: *mut DWORD) -> DWORD;
    fn AllowSetForegroundWindow(dwProcessId: DWORD) -> BOOL;
    fn SendMessageW(hWnd: HWND, Msg: u32, wParam: usize, lParam: *const std::ffi::c_void) -> isize;
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn acquire_windows(mutex_name: &str, timeout: std::time::Duration) -> Acquisition {
    use std::time::Instant;

    let wide_mutex = to_wide(mutex_name);
    let wide_sic = to_wide("mu.kasir.app-sic");
    let wide_siw = to_wide("mu.kasir.app-siw");
    let wide_main = to_wide("kasir.mu");

    let start = Instant::now();

    loop {
        // SAFETY: Calling Win32 CreateMutexW with a null security descriptor and a null-terminated UTF-16 name.
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 1, wide_mutex.as_ptr()) };
        let err = unsafe { GetLastError() };

        if !handle.is_null() && err != ERROR_ALREADY_EXISTS {
            return Acquisition::Acquired(InstanceGuard { handle });
        }

        if !handle.is_null() {
            unsafe {
                CloseHandle(handle);
            }
        }

        // Check if an existing instance's window is available.
        let target_hwnd = unsafe { FindWindowW(wide_sic.as_ptr(), wide_siw.as_ptr()) };
        let main_hwnd = unsafe { FindWindowW(std::ptr::null(), wide_main.as_ptr()) };

        if !target_hwnd.is_null() || !main_hwnd.is_null() {
            let active_hwnd = if !main_hwnd.is_null() {
                main_hwnd
            } else {
                target_hwnd
            };

            unsafe {
                let mut pid: DWORD = 0;
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
                    let cds = COPYDATASTRUCT {
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
