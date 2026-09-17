//! Tablet image download manager (spec 0046b §3.7).
//!
//! Background daemon that keeps the local image cache (`$APPCACHE/images/`)
//! in sync with the catalog.  The missing-hash set is computed at each cycle
//! from the product image assignments already applied to the local store
//! (referenced hashes minus files present on disk) — no polling of "what's
//! new".  Downloads are **primary-first** (slot-1 before slot 2..5),
//! per-hash `GET /api/v1/images/{hash16}` (immutable `Cache-Control` +
//! per-hash 404 granularity), at most `cycle_cap()` (default 40) images per
//! cycle with 2
//! in-flight GETs.  An LRU tracker evicts the least-recently-used files when
//! the cache exceeds the configured budget (default 256 MB).

use std::collections::VecDeque;
use std::time::UNIX_EPOCH;

use kasirmu_core::sync_client::SyncConfig;

/// ── Configuration (tunable — tweak at the top) ─────────────────────────
///
/// All pull-scheduler knobs are collected here.  They ship with sensible
/// defaults for single-region fleets (≤100 devices, ≤50k images/tenant).
/// Override any via the corresponding `OZ_IMG_*` env var at container
/// launch.
///
/// | Accessor | Default | Env var | Purpose |
/// |---|---|---|---|
/// | `jitter_min()` | 60 s | `OZ_IMG_PULL_JITTER_MIN` | Min wake interval |
/// | `jitter_max()` | 300 s | `OZ_IMG_PULL_JITTER_MAX` | Max wake interval |
/// | `cycle_cap()` | 40 | `OZ_IMG_PULL_CYCLE_CAP` | Max images per cycle |
/// | `max_in_flight()` | 2 | `OZ_IMG_PULL_MAX_IN_FLIGHT` | Concurrent GETs |
/// | `default_budget_bytes()` | 256 MB | `OZ_IMG_PULL_BUDGET_BYTES` | LRU eviction budget |
#[allow(dead_code)]
pub(crate) fn jitter_min() -> u64 {
    env_or("OZ_IMG_PULL_JITTER_MIN", 60)
}
#[allow(dead_code)]
pub(crate) fn jitter_max() -> u64 {
    env_or("OZ_IMG_PULL_JITTER_MAX", 300)
}
fn cycle_cap() -> usize {
    env_or("OZ_IMG_PULL_CYCLE_CAP", 40)
}
fn max_in_flight() -> usize {
    env_or("OZ_IMG_PULL_MAX_IN_FLIGHT", 2)
}
fn default_budget_bytes() -> u64 {
    env_or("OZ_IMG_PULL_BUDGET_BYTES", 256 * 1024 * 1024)
}

/// Generate a uniform random delay in [min, max] seconds.
#[allow(dead_code)]
pub(crate) fn rand_jitter(min: u64, max: u64) -> std::time::Duration {
    use rand::Rng;
    let secs = rand::thread_rng().gen_range(min..=max);
    std::time::Duration::from_secs(secs)
}

/// Read a parseable value from the environment, falling back to `default`.
fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

// ── LRU tracker ────────────────────────────────────────────────────────

/// Tracks the cached image files and their last-access order for LRU
/// eviction.  A file counts toward the budget by its on-disk size.
#[derive(Debug)]
pub struct LruTracker {
    /// In-memory LRU order (hash, size_bytes) — most-recently-used last.
    entries: VecDeque<(String, u64)>,
    /// Total bytes currently tracked.
    total_bytes: u64,
    /// Eviction budget in bytes.
    budget_bytes: u64,
}

#[allow(dead_code)]
impl LruTracker {
    /// Create an empty tracker with the given budget.
    pub fn new(budget_bytes: u64) -> Self {
        Self {
            entries: VecDeque::new(),
            total_bytes: 0,
            budget_bytes,
        }
    }

    /// The default 256 MB budget.
    pub fn with_default_budget() -> Self {
        Self::new(default_budget_bytes())
    }

    /// Record a cache hit / download: removes any prior entry and re-adds
    /// `(hash, size)` as most-recently-used.
    pub fn touch(&mut self, hash: &str, size_bytes: u64) {
        let mut prior_size = 0u64;
        self.entries.retain(|(h, size)| {
            if h == hash {
                prior_size = *size;
                false
            } else {
                true
            }
        });
        self.total_bytes = self.total_bytes.saturating_sub(prior_size) + size_bytes;
        self.entries.push_back((hash.to_owned(), size_bytes));
    }

    /// Remove a hash (e.g. file deleted externally). Returns the freed bytes.
    pub fn remove(&mut self, hash: &str) -> u64 {
        let mut freed = 0;
        self.entries.retain(|(h, size)| {
            if h == hash {
                freed = *size;
                false
            } else {
                true
            }
        });
        self.total_bytes = self.total_bytes.saturating_sub(freed);
        freed
    }

    /// Evict least-recently-used files until the total is within budget.
    /// Returns the hashes that should be deleted from disk.
    pub fn evict(&mut self) -> Vec<String> {
        let mut to_delete = Vec::new();
        while self.total_bytes > self.budget_bytes {
            if let Some((hash, size)) = self.entries.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(size);
                to_delete.push(hash);
            } else {
                break;
            }
        }
        to_delete
    }

    /// Total bytes currently tracked.
    pub fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// The configured budget.
    pub fn budget_bytes(&self) -> u64 {
        self.budget_bytes
    }

    /// Number of tracked entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the tracker holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ── Download manager ───────────────────────────────────────────────────

/// The tablet download manager.
pub struct ImageDownloadManager {
    /// Base URL + auth resolved per cycle (config may change at runtime).
    client: reqwest::Client,
    /// LRU budget.
    lru: LruTracker,
    /// Whether the LRU has been seeded from disk yet.
    seeded: bool,
}

impl ImageDownloadManager {
    /// Create a new manager with the default 256 MB budget.
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .pool_max_idle_per_host(4)
                .build()
                .unwrap_or_default(),
            lru: LruTracker::with_default_budget(),
            seeded: false,
        }
    }

    /// One download cycle against the given store DB and cache dir.
    ///
    /// Phases (never holding the DB lock across the network):
    /// 1. Brief lock — resolve sync config + referenced hash set.
    /// 2. Async — compute missing (referenced minus present on disk),
    ///    download primaries first, up to `cycle_cap()` per cycle (default
    ///    40, tunable via `OZ_IMG_PULL_CYCLE_CAP`), 2 GETs in flight.
    /// 3. Brief lock — persist any hash-state (not required for v1; the
    ///    missing set is recomputed every cycle = self-healing).
    pub async fn run_cycle(
        &mut self,
        db: &tokio::sync::Mutex<rusqlite::Connection>,
        cache_dir: &std::path::Path,
    ) {
        // Phase 1: brief lock.
        let (config, referenced): (Option<SyncConfig>, Vec<(String, i32)>) = {
            let guard = db.lock().await;
            let store = kasirmu_core::Store::new(&guard);
            let config = SyncConfig::from_settings(&store).ok().flatten();
            // Collect all (hash, slot) assignments from product_images.
            let referenced = store.list_all_product_images().unwrap_or_default();
            (config, referenced)
        };

        let Some(config) = config else {
            return;
        };
        let Some(token) = config.api_key.filter(|k| !k.is_empty()) else {
            return;
        };
        if referenced.is_empty() {
            return;
        }

        // Seed the LRU from disk on first cycle.
        if !self.seeded {
            self.seed_lru(cache_dir);
            self.seeded = true;
        }

        // Phase 2: compute missing set (referenced minus present on disk).
        let mut missing: Vec<(String, i32)> = Vec::new();
        for (hash, slot) in &referenced {
            let path = cache_dir.join("images").join(format!("{hash}.webp"));
            if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
                missing.push((hash.clone(), *slot));
            }
        }

        // Primary-first: stable sort by slot (slot 1 before 2..5), keeping
        // the assignment order within the same slot.
        missing.sort_by_key(|(_, slot)| *slot);

        // Download up to CYCLE_CAP, MAX_IN_FLIGHT at a time. Each task
        // fetches one hash and returns its bytes; the caller writes the file
        // atomically and updates the LRU (self-healing on failure — the
        // missing set is recomputed every cycle).
        let base_url = config.server_url.trim_end_matches('/').to_owned();
        let mut tasks = tokio::task::JoinSet::new();
        let mut downloaded = 0usize;

        let mut iter = missing.iter().take(cycle_cap()).peekable();
        while iter.peek().is_some() || !tasks.is_empty() {
            while tasks.len() < max_in_flight() {
                match iter.next() {
                    Some((hash, _slot)) => {
                        let url = format!("{base_url}/api/v1/images/{hash}");
                        let client = self.client.clone();
                        let bearer = token.clone();
                        let h = hash.clone();
                        tasks.spawn(async move {
                            let resp = client.get(&url).bearer_auth(&bearer).send().await;
                            match resp {
                                Ok(r) if r.status().is_success() => {
                                    let bytes = r.bytes().await.unwrap_or_default();
                                    (h, Some(bytes.to_vec()))
                                }
                                _ => (h, None), // 404/5xx/network → retry next cycle
                            }
                        });
                    }
                    None => break,
                }
            }
            if let Some(res) = tasks.join_next().await {
                match res {
                    Ok((hash, Some(bytes))) => {
                        let path = cache_dir.join("images").join(format!("{hash}.webp"));
                        if let Some(parent) = path.parent() {
                            let _ = tokio::fs::create_dir_all(parent).await;
                        }
                        // Atomic write (temp + rename).
                        let tmp = cache_dir.join("images").join(format!(".{hash}.dl-tmp"));
                        match tokio::fs::write(&tmp, &bytes).await {
                            Ok(()) => match tokio::fs::rename(&tmp, &path).await {
                                Ok(()) => {
                                    self.lru.touch(&hash, bytes.len() as u64);
                                    downloaded += 1;
                                }
                                Err(e) => {
                                    let _ = tokio::fs::remove_file(&tmp).await;
                                    tracing::warn!(hash, error = %e, "image download: rename failed");
                                }
                            },
                            Err(e) => {
                                tracing::warn!(hash, error = %e, "image download: write failed");
                            }
                        }
                    }
                    Ok((hash, None)) => {
                        tracing::warn!(hash, "image download: fetch failed, retrying next cycle");
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "image download: task join error");
                    }
                }
            }
        }

        let _ = downloaded;

        // Phase 3: no persistence needed (missing set recomputed per cycle).
    }

    /// Seed the LRU from the on-disk cache (mtime-order = age estimate).
    fn seed_lru(&mut self, cache_dir: &std::path::Path) {
        let img_dir = cache_dir.join("images");
        let Ok(entries) = std::fs::read_dir(&img_dir) else {
            return;
        };
        let mut files: Vec<(u128, String, u64)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_stem().and_then(|s| s.to_str()) {
                Some(n) => n.to_owned(),
                None => continue,
            };
            let meta = match std::fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            files.push((mtime, name, meta.len()));
        }
        // Oldest first (least-recently-used at the front).
        files.sort_by_key(|(mtime, _, _)| *mtime);
        for (_mtime, hash, size) in files {
            self.lru.touch(&hash, size);
        }
        // Evict anything already over budget.
        for hash in self.lru.evict() {
            let _ = std::fs::remove_file(img_dir.join(format!("{hash}.webp")));
        }
    }
}

#[cfg(test)]
#[path = "image_download_tests.rs"]
mod tests;
