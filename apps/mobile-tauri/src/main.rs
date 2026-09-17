// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Tablet shell binary entry point.
//!
//! Delegates immediately to `kasirmu_mobile_lib::run`, which owns Tauri
//! setup, `AppState` construction, and command registration. On Android and
//! iOS the platform loads the `cdylib` instead, so this binary exists for
//! desktop-hosted development and testing of the tablet UI.

fn main() {
    kasirmu_mobile_lib::run();
}
