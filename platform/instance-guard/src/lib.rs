//! The process-level single-instance guard, shared by both application shells.
//!
//! Both shells must claim their instance before the Tauri runtime, the WebView and the
//! store open, because two processes racing for the same EBWebView profile and the same
//! kasir.db produce the two failures this guard was written for. See the single_instance
//! module for the mechanism and for what happens when the mutex is already held.
//!
//! Why this is a crate of its own rather than part of platform-startup: every crate under
//! platform/ carries deny(unsafe_code), and a named Win32 mutex is FFI by definition. A
//! shared startup crate that had to allow its own deny would be misstating its stance, so
//! the unsafe stays in one small crate that says so, and the shells keep the clean crates
//! clean.
//!
//! Usage:
//! Usage: call acquire() first in the shell entry point, and exit the process when it
//! returns Acquisition::AlreadyRunning. Both application shells do exactly that.
#![deny(unsafe_op_in_unsafe_fn)]

pub mod single_instance;
/// Storage health and volume capacity queries.
pub mod storage;

pub use single_instance::{Acquisition, InstanceGuard, acquire};
pub use storage::{DiskSpace, LOW_STORAGE_THRESHOLD_BYTES, get_disk_space, is_storage_low};
