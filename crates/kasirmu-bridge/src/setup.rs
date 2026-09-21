//! Setup bridge module (Wave E).
//!
//! Bodies extracted verbatim from
//! apps/desktop-tauri/src/commands/setup.rs (Wave E slice E8). The only
//! rewrites are mechanical: `state.*` → `ctx.*` and `AppError::` →
//! `BridgeError::`. Settings keys, transaction boundaries, gate order and
//! log lines are byte-identical to the original command bodies.

use kasirmu_core::db::provisioning::{LocationKind, ProvisioningMode, ProvisioningRecord};
use kasirmu_core::{FeatureRegistry, Settings, Store, features};
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Completesetupargs.
pub struct CompleteSetupArgs {
    /// Store preset name (e.g. `"simple-retail"`, `"restaurant"`).
    pub preset: String,
    /// Enabled feature keys (kebab-case, e.g. `"cash-payment"`).
    pub features: Vec<String>,
    /// ISO-4217 default currency code (e.g. `"IDR"`, `"USD"`).
    #[serde(default = "default_currency")]
    pub default_currency: String,
}

fn default_currency() -> String {
    "IDR".to_string()
}

// ── Response types ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
/// Setupstatus.
pub struct SetupStatus {
    /// Whether the setup wizard has been completed.
    pub completed: bool,
    /// The store preset name, if set.
    pub preset: Option<String>,
}

// ── Provisioning (ADR #56 §2.1/§2.2) ────────────────────────────────

/// The first-run state of one terminal, as the shell reads it.
///
/// A tagged enum rather than a boolean pair: the two states are mutually
/// exclusive at the type level, so a shell cannot render "provisioned" and
/// "unprovisioned" at once, and there is no third value a partial read could
/// invent. `state` is the tag; the payload carries what a provisioned terminal
/// needs to route (its location, owner and region).
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum FirstRunStateDto {
    /// No provisioning row for this terminal — run the provisioning flow.
    Unprovisioned,
    /// A row exists; the session decides which screen renders.
    Provisioned {
        /// The location this terminal belongs to.
        location_id: Option<String>,
        /// The bootstrapped owner.
        owner_user_id: Option<String>,
        /// `local` or `linked` (ADR #56 §2.4).
        mode: String,
        /// Residency mirror — which deployment holds this tenant's data.
        home_region: String,
        /// The licence server's tenant id; `null` on a `local` install.
        tenant_id: Option<String>,
    },
}

impl FirstRunStateDto {
    /// The unprovisioned state, for a terminal with no row.
    #[must_use]
    pub fn unprovisioned() -> Self {
        Self::Unprovisioned
    }

    /// Project a stored record into the wire shape.
    #[must_use]
    pub fn provisioned(rec: &ProvisioningRecord) -> Self {
        Self::Provisioned {
            location_id: rec.location_id.clone(),
            owner_user_id: rec.owner_user_id.clone(),
            mode: rec.mode.as_str().to_owned(),
            home_region: rec.home_region.clone(),
            tenant_id: rec.tenant_id.clone(),
        }
    }
}

/// What `provision_device` created, for the shell to route with.
#[derive(Debug, Serialize)]
pub struct ProvisionDeviceResultDto {
    /// The terminal this record belongs to.
    pub terminal_id: String,
    /// The location provisioning created.
    pub location_id: String,
    /// The owner provisioning created.
    pub owner_user_id: String,
    /// True on a fresh provision, false when an existing row was replayed.
    ///
    /// The shell distinguishes "welcome" from "already set up" on this rather
    /// than by comparing rows, so a retry is visibly a retry.
    pub created: bool,
    /// `local` or `linked`.
    pub mode: String,
    /// Residency mirror.
    pub home_region: String,
}

impl From<&kasirmu_core::db::provisioning::ProvisionDeviceResult> for ProvisionDeviceResultDto {
    fn from(r: &kasirmu_core::db::provisioning::ProvisionDeviceResult) -> Self {
        Self {
            terminal_id: r.record.terminal_id.clone(),
            location_id: r.location_id.clone(),
            owner_user_id: r.owner_user_id.clone(),
            created: r.created,
            mode: r.record.mode.as_str().to_owned(),
            home_region: r.record.home_region.clone(),
        }
    }
}

impl From<ProvisionDeviceArgs> for kasirmu_core::db::provisioning::ProvisionDeviceArgs {
    fn from(a: ProvisionDeviceArgs) -> Self {
        Self {
            terminal_id: a.terminal_id,
            location_name: a.location_name,
            currency: a.currency,
            timezone: a.timezone,
            owner_username: a.owner_username,
            owner_display_name: a.owner_display_name,
            owner_pin: a.owner_pin,
            preset: a.preset,
            features: a.features,
            location_kind: a.location_kind,
            mode: a.mode,
            tenant_id: a.tenant_id,
            device_credential_id: a.device_credential_id,
        }
    }
}

/// The wire shape for `provision_device` (ADR #56 §2.1/§2.2).
///
/// Deserialized from the shell, then converted into the core args. Kept as its
/// own type so the IPC contract can stay `serde`-friendly (a `local` install
/// sends no `tenant_id`) while the core type keeps every field explicit.
#[derive(Debug, Deserialize)]
pub struct ProvisionDeviceArgs {
    /// `terminals.device_id` — this device.
    pub terminal_id: String,
    /// The location's display name.
    pub location_name: String,
    /// ISO-4217 currency.
    pub currency: String,
    /// IANA timezone.
    pub timezone: String,
    /// Owner login name.
    pub owner_username: String,
    /// Owner display name.
    pub owner_display_name: String,
    /// Owner PIN (>= 4 characters).
    pub owner_pin: String,
    /// Store-type preset (`simple-retail`, `restaurant`, ...).
    pub preset: String,
    /// Enabled feature keys for that preset.
    #[serde(default)]
    pub features: Vec<String>,
    /// `retail` or `restaurant` — selects the workspace topology.
    pub location_kind: LocationKind,
    /// `local` or `linked`.
    pub mode: ProvisioningMode,
    /// The licence server's tenant id; required for `linked`.
    #[serde(default)]
    pub tenant_id: Option<String>,
    /// The device credential; required for `linked`.
    #[serde(default)]
    pub device_credential_id: Option<String>,
}

// ── Response types ───────────────────────────────────────────────────

/// The enabled feature keys returned by `get_enabled_features`.
#[derive(Debug, Serialize)]
pub struct EnabledFeaturesResult {
    /// Kebab-case feature keys (e.g. `"cash-payment"`, `"barcode-scanning"`).
    pub features: Vec<String>,
}

// ── Operations ───────────────────────────────────────────────────────

/// Return the list of currently-enabled feature keys.
///
/// The front-end calls this once on mount to decide which nav items
/// and UI elements to show/hide.
pub async fn get_enabled_features(
    ctx: &BridgeCtx<'_>,
) -> Result<EnabledFeaturesResult, BridgeError> {
    let conn = ctx.lock_global().await;
    let registry = Settings::load_features(&conn)?;

    let features: Vec<String> = registry
        .enabled_features()
        .map(|f| kasirmu_core::features::feature_key(f).to_string())
        .collect();

    Ok(EnabledFeaturesResult { features })
}

/// Persist the chosen preset and features, then mark setup as complete.
///
/// Called by the front-end when the user clicks "Complete Setup" on
/// the last step of the wizard.
pub async fn complete_setup(
    ctx: &BridgeCtx<'_>,
    args: CompleteSetupArgs,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;

    // Convert feature key strings → Feature enum variants.
    let mut registry = FeatureRegistry::new();
    for key in &args.features {
        if let Some(feat) = features::feature_from_key(key) {
            registry.enable(feat);
        } else {
            tracing::warn!(feature = %key, "unknown feature key in setup, skipping");
        }
    }

    // Save features + preset + completed flag in a single transaction.
    let tx = db.unchecked_transaction()?;
    {
        let store = Store::new(&tx);

        // 1. Seed built-in roles (idempotent — skips existing).
        store.seed_default_roles()?;

        // 2. Persist features.
        // RUST-08: write feature rows directly into the outer transaction.
        // `store.save_features` -> Settings::set_batch opens its OWN
        // unchecked_transaction, which would be a nested BEGIN inside the
        // tx above ("cannot start a transaction within a transaction") —
        // same class as the CLI-1 / import_data fixes.
        for (key, value) in registry.to_settings_rows() {
            Settings::set(&tx, &key, &value)?;
        }

        // 3. Prune stale feature rows that are no longer enabled.
        Settings::prune_stale_features(&tx, &registry)?;

        // 4. Save the preset name.
        Settings::set(
            &tx,
            kasirmu_core::settings::keys::STORE_PRESET,
            &args.preset,
        )?;

        // 5. Mark setup as complete.
        Settings::set(&tx, kasirmu_core::settings::keys::SETUP_COMPLETE, "1")?;

        // 6. Set default currency.
        Settings::set_default_currency(&tx, &args.default_currency)?;

        // 7. Dismiss the wizard so it doesn't show on next launch.
        Settings::set(
            &tx,
            kasirmu_core::settings::keys::SHOW_SETUP_WIZARD,
            "false",
        )?;
    }
    tx.commit()?;

    tracing::info!(
        preset = %args.preset,
        feature_count = %args.features.len(),
        "setup wizard completed"
    );

    Ok(())
}

/// The first-run state for one terminal (ADR #56 §2.1).
///
/// Replaces `get_setup_status`. The old read reported a BOOLEAN derived from
/// the `show_setup_wizard` dismissal key, which a failed read could forge in
/// either direction — that is why the shells carried a boot-retry workaround
/// for a lost IPC response. This returns the provisioning row instead: an
/// unreadable database yields no row, and no row means unprovisioned, so a
/// retry is an ordinary idempotent re-read rather than a guess.
///
/// The shell renders from this: `unprovisioned` runs the provisioning flow,
/// `provisioned` routes to a session (or the login screen when there is none).
pub async fn get_first_run_state(
    ctx: &BridgeCtx<'_>,
    terminal_id: &str,
) -> Result<FirstRunStateDto, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    Ok(match store.get_provisioning(terminal_id)? {
        None => FirstRunStateDto::unprovisioned(),
        Some(rec) => FirstRunStateDto::provisioned(&rec),
    })
}

/// Provision one terminal in a single idempotent transaction (ADR #56 §2.2).
///
/// The one command that replaces the wizard's completion path. It creates the
/// location, the workspaces that point at it, the owner, the feature rows and
/// the provisioning marker together, or none of them: the marker is written
/// last, so "setup completed but nothing provisioned" — the state the wizard's
/// Skip button reaches today — becomes unrepresentable rather than guarded.
///
/// Idempotent by construction. A retry after a crash, a lost Android IPC
/// response or a re-polled pairing claim returns the existing row and creates
/// nothing, so the same device can never mint two terminals or two owners.
pub async fn provision_device(
    ctx: &BridgeCtx<'_>,
    args: ProvisionDeviceArgs,
) -> Result<ProvisionDeviceResultDto, BridgeError> {
    let db = ctx.lock_global().await;
    let result = kasirmu_core::db::provisioning::provision_device(&db, &args.into())?;

    tracing::info!(
        terminal_id = %result.record.terminal_id,
        created = result.created,
        mode = %result.record.mode.as_str(),
        "terminal provisioned"
    );

    Ok(ProvisionDeviceResultDto::from(&result))
}

/// Requires the `staff:manage_roles` permission.
pub async fn seed_default_roles_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<usize, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // Authorize against the GLOBAL identity DB: users + roles live there,
    // never in the store DB (which this command is about to seed).
    ctx.require_session_permission(&session, kasirmu_core::permissions::STAFF_MANAGE_ROLES)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let count = store.seed_default_roles()?;
    drop(db);
    tracing::info!(count, "default roles seeded (scoped)");
    Ok(count)
}

// ── Retired by ADR #56 §2.2 ──────────────────────────────────────────
//
// `dismiss_setup_wizard` and `get_setup_status` were REMOVED here — see the
// provisioning surface above for what replaced them. Both served the three
// booleans §2.1 retires: the Skip escape hatch that marked setup complete
// while provisioning nothing (§1.5: a trapdoor, not an exit), and the
// `completed` read derived from the same key, which a failed read could forge
// in either direction (§1.4).

#[cfg(test)]
#[path = "setup_tests.rs"]
mod setup_tests;
