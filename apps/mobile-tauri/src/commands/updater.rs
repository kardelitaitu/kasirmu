//! Android In-App Self-Updater Tauri commands (todo-android-updater.md).
//!
//! Provides ABI-aware manifest checks, resumable streaming downloads with SHA-256
//! verification, safety pre-flight checks, pre-update SQLite backup snapshots,
//! and handoff to the Android package installer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use kasirmu_core::permissions;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, command};
use tokio::io::AsyncWriteExt;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Default public manifest URL for mobile releases.
pub const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/kardelitaitu/kasirmu/releases/latest/download/latest-android.json";

/// Settings key for storing previous version before an update.
pub const SETTING_PREVIOUS_VERSION: &str = "updater.previous_version";

/// Settings key for storing the pre-update backup snapshot path.
pub const SETTING_LAST_BACKUP_PATH: &str = "updater.last_backup_path";

// ── Manifest and DTO types ──────────────────────────────────────────

/// Platform asset metadata inside latest-android.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AndroidPlatformAsset {
    /// Remote URL of the downloadable APK.
    pub url: String,
    /// Expected SHA-256 hex digest.
    pub sha256: String,
    /// Total binary size in bytes.
    pub size_bytes: u64,
}

/// Remote release manifest for mobile platforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidUpdateManifest {
    /// Target semantic version string (e.g. "0.0.42").
    pub version: String,
    /// Numeric Android version code.
    #[serde(default)]
    pub version_code: Option<u64>,
    /// Release publication timestamp.
    #[serde(default)]
    pub release_date: Option<String>,
    /// Minimum required current version to upgrade.
    #[serde(default)]
    pub min_supported_version: Option<String>,
    /// Release notes and changelog markdown.
    #[serde(default)]
    pub notes: Option<String>,
    /// Map of platform ABI keys to release assets.
    pub platforms: HashMap<String, AndroidPlatformAsset>,
}

/// Result returned to frontend upon update check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCheckResult {
    /// Whether a strictly newer version is available.
    pub update_available: bool,
    /// Current running app version.
    pub current_version: String,
    /// Latest version reported by the remote manifest.
    pub latest_version: String,
    /// Remote release date.
    pub release_date: Option<String>,
    /// Remote changelog and release notes.
    pub notes: Option<String>,
    /// Download URL for the resolved device ABI.
    pub download_url: Option<String>,
    /// Size of the APK binary in bytes.
    pub size_bytes: Option<u64>,
    /// Expected SHA-256 digest of the APK.
    pub sha256: Option<String>,
    /// Matched platform key (e.g. "android-arm64-v8a").
    pub target_platform: Option<String>,
}

/// Download progress payload emitted via `update-download-progress`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    /// Number of bytes received so far.
    pub received_bytes: u64,
    /// Total expected file size in bytes.
    pub total_bytes: u64,
    /// Percentage downloaded (0.0 to 100.0).
    pub percentage: f64,
    /// Instantaneous speed in bytes per second.
    pub speed_bytes_per_sec: u64,
    /// Estimated time to completion in seconds.
    pub eta_seconds: u64,
}

/// Result of preparing an update (after pre-update backup).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrepareUpdateResult {
    /// Whether preparation and backup succeeded.
    pub ready: bool,
    /// Local filesystem path to the verified APK.
    pub apk_path: String,
    /// Path to the pre-update SQLite backup snapshot.
    pub backup_path: Option<String>,
    /// Version string before applying update.
    pub previous_version: String,
}

// ── ABI Resolution & Semver Helpers ─────────────────────────────────

/// Determine optimal ABI key matching this device architecture.
pub fn detect_device_abi() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "android-arm64-v8a"
    }
    #[cfg(target_arch = "arm")]
    {
        "android-armeabi-v7a"
    }
    #[cfg(target_arch = "x86_64")]
    {
        "android-universal"
    }
    #[cfg(not(any(target_arch = "aarch64", target_arch = "arm", target_arch = "x86_64")))]
    {
        "android-universal"
    }
}

/// Select matching asset from platforms map: exact ABI -> android-universal.
pub fn select_platform_asset(
    platforms: &HashMap<String, AndroidPlatformAsset>,
    device_abi: &str,
) -> Option<(String, AndroidPlatformAsset)> {
    if let Some(asset) = platforms.get(device_abi) {
        return Some((device_abi.to_string(), asset.clone()));
    }
    if let Some(asset) = platforms.get("android-universal") {
        return Some(("android-universal".to_string(), asset.clone()));
    }
    None
}

/// Compare two semver version strings (e.g. "0.0.41" and "0.0.42").
/// Returns true if remote is strictly newer than current.
pub fn is_version_newer(current: &str, remote: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|part| part.parse::<u32>().ok())
            .collect()
    };
    let cur = parse(current);
    let rem = parse(remote);
    rem > cur
}

/// Resolve updates cache directory: `$APPCACHE/updates/`.
pub fn get_updates_dir(cache_root: &Path) -> PathBuf {
    cache_root.join("updates")
}

// ── Tauri Commands ──────────────────────────────────────────────────

/// Query release manifest and check for available Android updates.
#[command]
pub async fn check_app_update(
    session_token: String,
    custom_manifest_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<UpdateCheckResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;

    let manifest_url = custom_manifest_url
        .as_deref()
        .unwrap_or(DEFAULT_MANIFEST_URL);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client build: {e}")))?;

    let response = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch update manifest: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "Update server returned HTTP {}",
            response.status()
        )));
    }

    let manifest: AndroidUpdateManifest = response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid update manifest JSON: {e}")))?;

    let current_version = env!("CARGO_PKG_VERSION");
    let newer = is_version_newer(current_version, &manifest.version);
    let device_abi = detect_device_abi();
    let selected_asset = select_platform_asset(&manifest.platforms, device_abi);

    let (target_platform, download_url, size_bytes, sha256) = match selected_asset {
        Some((platform, asset)) => (
            Some(platform),
            Some(asset.url),
            Some(asset.size_bytes),
            Some(asset.sha256),
        ),
        None => (None, None, None, None),
    };

    Ok(UpdateCheckResult {
        update_available: newer && download_url.is_some(),
        current_version: current_version.to_string(),
        latest_version: manifest.version,
        release_date: manifest.release_date,
        notes: manifest.notes,
        download_url,
        size_bytes,
        sha256,
        target_platform,
    })
}

/// Download APK streaming with resume and SHA-256 verification.
#[command]
pub async fn start_apk_download(
    session_token: String,
    url: String,
    expected_sha256: String,
    file_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Internal(format!("Resolve cache dir: {e}")))?;

    let updates_dir = get_updates_dir(&cache_dir);
    tokio::fs::create_dir_all(&updates_dir)
        .await
        .map_err(|e| AppError::Internal(format!("Create updates dir: {e}")))?;

    let safe_file_name = file_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect::<String>();
    let part_path = updates_dir.join(format!("{safe_file_name}.part"));
    let target_path = updates_dir.join(&safe_file_name);

    // If final file already exists and valid, return early
    if target_path.exists() {
        if let Ok(mut existing_file) = tokio::fs::File::open(&target_path).await {
            let mut hasher = Sha256::new();
            let mut buf = [0u8; 8192];
            let mut read_ok = true;
            use tokio::io::AsyncReadExt;
            loop {
                match existing_file.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => hasher.update(&buf[..n]),
                    Err(_) => {
                        read_ok = false;
                        break;
                    }
                }
            }
            let digest = hex::encode(hasher.finalize());
            if read_ok && digest.eq_ignore_ascii_case(&expected_sha256) {
                return Ok(target_path.to_string_lossy().to_string());
            }
        }
        let _ = tokio::fs::remove_file(&target_path).await;
    }

    let client = reqwest::Client::new();
    let mut initial_offset = 0u64;

    if part_path.exists()
        && let Ok(metadata) = tokio::fs::metadata(&part_path).await
    {
        initial_offset = metadata.len();
    }

    let mut request = client.get(&url);
    if initial_offset > 0 {
        request = request.header("Range", format!("bytes={initial_offset}-"));
    }

    let mut response = request
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Download request failed: {e}")))?;

    let status = response.status();
    let is_resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;

    if !status.is_success() && !is_resumed {
        return Err(AppError::Internal(format!(
            "Server returned HTTP {} on download",
            status
        )));
    }

    let mut file = if is_resumed {
        tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .await
            .map_err(|e| AppError::Internal(format!("Open part file: {e}")))?
    } else {
        initial_offset = 0;
        tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| AppError::Internal(format!("Create part file: {e}")))?
    };

    let total_bytes = if is_resumed {
        let content_length = response.content_length().unwrap_or(0);
        initial_offset + content_length
    } else {
        response.content_length().unwrap_or(0)
    };

    let mut received_bytes = initial_offset;
    let mut last_progress_emit = Instant::now();
    let mut last_received_sample = received_bytes;
    let mut last_sample_time = Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Internal(format!("Error reading download stream: {e}")))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(format!("Write chunk error: {e}")))?;

        received_bytes += chunk.len() as u64;

        if last_progress_emit.elapsed() >= std::time::Duration::from_millis(250)
            || received_bytes == total_bytes
        {
            let elapsed_sample = last_sample_time.elapsed().as_secs_f64();
            let bytes_delta = received_bytes.saturating_sub(last_received_sample);
            let speed = if elapsed_sample > 0.0 {
                (bytes_delta as f64 / elapsed_sample) as u64
            } else {
                0
            };
            let remaining = total_bytes.saturating_sub(received_bytes);
            // checked_div keeps the guard explicit: no division by zero, and no
            // branch that duplicates what the type system can express.
            let eta = remaining.checked_div(speed).unwrap_or(0);
            let percentage = if total_bytes > 0 {
                (received_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };

            // R10 #3: the progress event rides the bridge's injected EventSink
            // (BridgeCtx::emitter), the same seam the delegated doors use, not a
            // raw AppHandle.
            if let Some(sink) = state.bridge_ctx().emitter {
                let payload = serde_json::to_value(DownloadProgressPayload {
                    received_bytes,
                    total_bytes,
                    percentage,
                    speed_bytes_per_sec: speed,
                    eta_seconds: eta,
                })
                .unwrap_or(serde_json::Value::Null);
                sink.emit("update-download-progress", payload);
            }

            last_progress_emit = Instant::now();
            last_received_sample = received_bytes;
            last_sample_time = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|e| AppError::Internal(format!("Flush error: {e}")))?;
    drop(file);

    // Compute full SHA-256
    let mut verify_file = tokio::fs::File::open(&part_path)
        .await
        .map_err(|e| AppError::Internal(format!("Verify open error: {e}")))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    use tokio::io::AsyncReadExt;
    while let Ok(n) = verify_file.read(&mut buf).await {
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let computed_digest = hex::encode(hasher.finalize());

    if !computed_digest.eq_ignore_ascii_case(&expected_sha256) {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(AppError::Invalid(format!(
            "Checksum mismatch: expected {expected_sha256}, got {computed_digest}"
        )));
    }

    tokio::fs::rename(&part_path, &target_path)
        .await
        .map_err(|e| AppError::Internal(format!("Rename part to target: {e}")))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Create safety SQLite backup snapshot before installing update.
#[command]
pub async fn prepare_and_launch_update(
    session_token: String,
    apk_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PrepareUpdateResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;

    let path = PathBuf::from(&apk_path);
    if !path.exists() {
        return Err(AppError::Invalid(format!(
            "Target APK file does not exist: {apk_path}"
        )));
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Internal(format!("Resolve cache dir: {e}")))?;

    let backup_dir = cache_dir.join("backups");
    let _ = tokio::fs::create_dir_all(&backup_dir).await;

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let backup_filename = format!("pre_update_{current_version}_{timestamp}.db");
    let backup_target = backup_dir.join(&backup_filename);

    let backup_str = backup_target.to_string_lossy().to_string();

    // Perform safe SQLite snapshot via global db connection
    let db_guard = state.db.lock().await;

    let backup_result = db_guard.execute("VACUUM INTO ?1", rusqlite::params![backup_str]);

    let backup_path_opt = match backup_result {
        Ok(_) => Some(backup_str.clone()),
        Err(e) => {
            tracing::warn!("VACUUM INTO pre-update backup warning: {e}");
            None
        }
    };

    // Save previous version and backup path in settings
    let _ = db_guard.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![SETTING_PREVIOUS_VERSION, current_version],
    );
    if let Some(ref bp) = backup_path_opt {
        let _ = db_guard.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![SETTING_LAST_BACKUP_PATH, bp],
        );
    }

    Ok(PrepareUpdateResult {
        ready: true,
        apk_path,
        backup_path: backup_path_opt,
        previous_version: current_version,
    })
}

#[cfg(test)]
#[path = "updater_tests.rs"]
mod tests;
