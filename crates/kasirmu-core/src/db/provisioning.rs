//! First-run provisioning — the per-terminal record whose presence IS the
//! "this device is set up" fact (ADR #56 §2.1).
//!
//! Replaces three independently-read booleans (`setup.completed`, the wizard's
//! `show_setup_wizard` dismissal key, and the owner-existing check). A failed
//! read of a boolean can FORGE a verdict — which is why the shells carried a
//! boot-retry workaround for a lost IPC response. A row cannot be forged the
//! same way: an unreadable DB yields no row, and no row means unprovisioned, so
//! a retry becomes an ordinary idempotent re-read.
//!
//! Key invariants:
//! - One row per **terminal**, so the gate is an indexed local lookup and never
//!   a network call (§2.1, §5 Q4).
//! - `home_region` is RESIDENCY, never the market anchor; the market is
//!   `legal_entities.country_code` (§2.1, mirroring ADR #59 §2.2).
//! - The row is written LAST inside one transaction (§2.2), so its presence
//!   proves the licence, location and owner were all written.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

use super::Store;

/// Which onboarding tier produced this terminal (ADR #56 §2.4).
///
/// `local` is the DEFAULT, not a fallback: the target deployment includes
/// merchants with unreliable connectivity, and a first run that demands the
/// network fails the merchant who most needs the product. `linked` adds the
/// identity step and is the only route to server-side enforcement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProvisioningMode {
    /// No network: a working OS and a sellable terminal.
    Local,
    /// Identity-linked: adds `tenant_id`, sync and topology.
    Linked,
}

impl ProvisioningMode {
    /// The stored keyword, matching the column CHECK constraint.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Linked => "linked",
        }
    }

    /// Parse a stored keyword; anything else is a validation error rather than
    /// a silently-unknown mode.
    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        match raw {
            "local" => Ok(Self::Local),
            "linked" => Ok(Self::Linked),
            other => Err(CoreError::Validation {
                field: "mode",
                message: format!("provisioning mode must be local or linked; got {other:?}"),
            }),
        }
    }
}

/// What kind of business trades at this location (ADR #56 §2.3 step 3).
///
/// Drives which default workspace types provisioning creates, because a
/// restaurant needs a kitchen display and a shop does not. Two variants rather
/// than the UI's six presets: the presets differ in *features* (which the
/// wizard owns) while only these two differ in *workspace topology*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocationKind {
    /// A shop: store POS, warehouse, admin.
    Retail,
    /// A restaurant or cafe: adds the kitchen display.
    Restaurant,
}

impl LocationKind {
    /// The workspace `type_key`s this kind creates, in creation order.
    ///
    /// Mirrors the `default-*` rows the migration used to seed
    /// (`20260813_init.sql:1505-1510`), minus the kinds a given location does
    /// not need: a store with no merchant should have no workspaces, and one
    /// with a merchant gets only the ones its trade requires.
    #[must_use]
    pub fn workspace_types(self) -> &'static [&'static str] {
        match self {
            Self::Retail => &["store-pos", "warehouse", "admin"],
            Self::Restaurant => &["restaurant-pos", "warehouse", "admin", "kds"],
        }
    }

    /// The stored keyword.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Retail => "retail",
            Self::Restaurant => "restaurant",
        }
    }

    /// Parse a stored keyword; anything else is a validation error.
    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        match raw {
            "retail" => Ok(Self::Retail),
            "restaurant" => Ok(Self::Restaurant),
            other => Err(CoreError::Validation {
                field: "location_kind",
                message: format!("location kind must be retail or restaurant; got {other:?}"),
            }),
        }
    }
}

/// One terminal's provisioning record (ADR #56 §2.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisioningRecord {
    /// Matches `terminals.device_id`, not the `terminals.id` surrogate: a
    /// replaced tablet keeps its id but changes its device.
    pub terminal_id: String,
    /// The licence server's tenant id. `None` for a `local` install — and
    /// deliberately NOT the local literal `'default'`, a different namespace.
    pub tenant_id: Option<String>,
    /// The `locations` row this terminal belongs to.
    pub location_id: Option<String>,
    /// The bootstrapped owner.
    pub owner_user_id: Option<String>,
    /// The credential this device authenticates to sync with.
    pub device_id: Option<String>,
    /// Which tier of §2.4 was used.
    pub mode: ProvisioningMode,
    /// RESIDENCY mirror — which deployment holds this tenant's data. Never a
    /// market anchor and never a country code; see the module docs.
    pub home_region: String,
    /// Audit timestamp.
    pub provisioned_at: String,
}

/// The derived first-run state (ADR #56 §2.1).
///
/// One value replaces the three booleans. Note what is NOT representable:
/// "setup completed but nothing provisioned" was reachable via the wizard's
/// Skip button and is now unrepresentable rather than merely guarded, because
/// the row cannot exist unless the whole transaction committed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FirstRunState {
    /// No `provisioning` row for this terminal — render the provisioning flow.
    Unprovisioned,
    /// A row exists; the session decides which screen renders.
    Provisioned(ProvisioningRecord),
}
impl Store<'_> {
    /// Read one terminal's provisioning record, or `None` when it has none.
    pub fn get_provisioning(
        &self,
        terminal_id: &str,
    ) -> Result<Option<ProvisioningRecord>, CoreError> {
        // One line on purpose: a Rust line-continuation inside a Rust string
        // literal is emitted verbatim, so a wrapped query reaches SQLite with
        // the backslashes in it and fails to parse.
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, tenant_id, location_id, owner_user_id, device_id, mode, home_region, provisioned_at FROM provisioning WHERE terminal_id = ?1",
        )?;
        // `.optional()` already turns the no-rows error into `None`, so the
        // mapper's own `Result` is what remains — no transpose needed.
        let row = stmt
            .query_row(params![terminal_id], Self::row_to_provisioning)
            .optional()?;
        Ok(row)
    }

    /// The single derived first-run state for a terminal (ADR #56 §2.1).
    ///
    /// This is the gate: `Unprovisioned` for any terminal without a row, so an
    /// unreadable or empty database can never report a provisioned device.
    pub fn first_run_state(&self, terminal_id: &str) -> Result<FirstRunState, CoreError> {
        Ok(match self.get_provisioning(terminal_id)? {
            Some(rec) => FirstRunState::Provisioned(rec),
            None => FirstRunState::Unprovisioned,
        })
    }

    /// Whether this terminal has been provisioned.
    ///
    /// Its own method because it is the question the boot ladder asks, and
    /// because a boolean derived FROM a row read is safe where a stored boolean
    /// was not: the only way to get `true` is a row that exists.
    pub fn is_provisioned(&self, terminal_id: &str) -> Result<bool, CoreError> {
        Ok(self.get_provisioning(terminal_id)?.is_some())
    }

    /// Insert a provisioning record, or return the existing one unchanged.
    ///
    /// The idempotency guard of ADR #56 §2.2 step 1, and the reason a retry
    /// after a crash, a lost Android IPC response, or a re-polled pairing claim
    /// is safe: the same device can never mint two terminals. Returns
    /// `(record, created)` so a caller can distinguish a fresh provision from a
    /// replay without a second read.
    pub fn provision_terminal(
        &self,
        rec: &ProvisioningRecord,
    ) -> Result<(ProvisioningRecord, bool), CoreError> {
        if let Some(existing) = self.get_provisioning(&rec.terminal_id)? {
            return Ok((existing, false));
        }
        self.conn.execute(
            "INSERT INTO provisioning (terminal_id, tenant_id, location_id, owner_user_id, device_id, mode, home_region) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rec.terminal_id,
                rec.tenant_id,
                rec.location_id,
                rec.owner_user_id,
                rec.device_id,
                rec.mode.as_str(),
                rec.home_region,
            ],
        )?;
        // Re-read rather than trusting the in-memory copy: `provisioned_at` is a
        // column default, so the stored value is the authority.
        let stored = self
            .get_provisioning(&rec.terminal_id)?
            .ok_or_else(|| CoreError::Internal("provisioning row vanished after insert".into()))?;
        Ok((stored, true))
    }
    /// Promote a `local` provisioning record to `linked` (ADR #56 §2.4).
    ///
    /// This is the in-app upgrade that makes ADR #54's optional Account step
    /// unnecessary: the same action moves from "step 8 of setup" to "an action
    /// on a working terminal", and stops being skippable because it is no longer
    /// part of a linear gate.
    ///
    /// Refuses to overwrite an already-linked tenant with a different one — that
    /// would reassign a device between merchants.
    pub fn link_provisioning(
        &self,
        terminal_id: &str,
        tenant_id: &str,
        device_id: &str,
    ) -> Result<ProvisioningRecord, CoreError> {
        let existing =
            self.get_provisioning(terminal_id)?
                .ok_or_else(|| CoreError::Validation {
                    field: "terminal_id",
                    message: format!("cannot link an unprovisioned terminal: {terminal_id:?}"),
                })?;
        if let Some(current) = &existing.tenant_id {
            if current != tenant_id {
                return Err(CoreError::Validation {
                    field: "tenant_id",
                    message: format!(
                        "terminal {terminal_id:?} already belongs to tenant {current:?}; refusing to reassign it to {tenant_id:?}"
                    ),
                });
            }
        }
        self.conn.execute(
            "UPDATE provisioning SET tenant_id = ?1, device_id = ?2, mode = 'linked' WHERE terminal_id = ?3",
            params![tenant_id, device_id, terminal_id],
        )?;
        self.get_provisioning(terminal_id)?
            .ok_or_else(|| CoreError::Internal("provisioning row vanished after link".into()))
    }

    /// Replace the cached residency mirror (ADR #56 §2.1).
    ///
    /// The licence server's `tenants.region` is authoritative (ADR #59 §Q5) and
    /// this column is a local copy written only from a server response — the same
    /// relationship the subscription row has. There is deliberately no local
    /// writer that invents a region.
    pub fn set_provisioning_home_region(
        &self,
        terminal_id: &str,
        home_region: &str,
    ) -> Result<(), CoreError> {
        let changed = self.conn.execute(
            "UPDATE provisioning SET home_region = ?1 WHERE terminal_id = ?2",
            params![home_region, terminal_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "terminal_id",
                message: format!("no provisioning row for terminal {terminal_id:?}"),
            });
        }
        Ok(())
    }

    /// Row mapper for a provisioning record.
    fn row_to_provisioning(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProvisioningRecord> {
        let mode: String = row.get(5)?;
        Ok(ProvisioningRecord {
            terminal_id: row.get(0)?,
            tenant_id: row.get(1)?,
            location_id: row.get(2)?,
            owner_user_id: row.get(3)?,
            device_id: row.get(4)?,
            // A mode outside the CHECK constraint cannot be stored, so this maps
            // rather than failing: an unreadable mode must not turn a
            // provisioned terminal into an error at boot.
            mode: ProvisioningMode::parse(&mode).unwrap_or(ProvisioningMode::Local),
            home_region: row.get(6)?,
            provisioned_at: row.get(7)?,
        })
    }
}

// ── The one transaction (ADR #56 §2.2) ───────────────────────────

/// Everything `provision_device` needs, all of it required.
///
/// Every field is needed because the row it feeds cannot be written from a
/// partial input: a terminal with a location but no owner is not a working
/// terminal, and §2.3 requires onboarding to END at a working terminal.
#[derive(Debug, Clone)]
pub struct ProvisionDeviceArgs {
    /// `terminals.device_id` — this device, not this terminal row.
    pub terminal_id: String,
    /// The display name the merchant chose for their location.
    pub location_name: String,
    /// The location's ISO-4217 currency; also becomes the default currency.
    pub currency: String,
    /// The location's IANA timezone.
    pub timezone: String,
    /// Owner login name (lowercased on write).
    pub owner_username: String,
    /// Owner display name (as typed).
    pub owner_display_name: String,
    /// Owner PIN, at least 4 characters. Hashed before it reaches a column.
    pub owner_pin: String,
    /// The store-type preset (`simple-retail`, `restaurant`, ...).
    ///
    /// PASSED IN rather than derived here. §2.3 says a provisioned terminal's
    /// feature set is derived from the store type the merchant chose — the
    /// `PRESET_FEATURES` map is *evaluated instead of interrogated*. That
    /// derivation lives with the wizard that asks the question; re-deriving it
    /// in core would give the same fact two owners and let them drift.
    pub preset: String,
    /// Enabled feature keys for the chosen preset (kebab-case).
    pub features: Vec<String>,
    /// Whether the store trades as a restaurant/cafe or a shop. Drives which
    /// workspace types step 3 creates.
    pub location_kind: LocationKind,
    /// Which tier of §2.4 this install is using.
    pub mode: ProvisioningMode,
    /// The licence server's tenant id. Required for `linked`, ignored for
    /// `local` — the schema CHECK enforces the same rule.
    pub tenant_id: Option<String>,
    /// The credential id from `TerminalCredential`. Required for `linked`.
    pub device_credential_id: Option<String>,
}

/// What provisioning produced, including the ids the caller needs next.
#[derive(Debug, Clone)]
pub struct ProvisionDeviceResult {
    /// The record, as stored (so `provisioned_at` is the column's value).
    pub record: ProvisioningRecord,
    /// The location created for this terminal.
    pub location_id: String,
    /// The owner user id.
    pub owner_user_id: String,
    /// True when this call provisioned, false when it replayed an existing
    /// row (§2.2 step 1). A caller that needs to know whether to show
    /// 'welcome' or 'already set up' reads this rather than comparing rows.
    pub created: bool,
}
/// Provision one terminal in a single idempotent transaction (ADR #56 §2.2).
///
/// The order below is the decision, not an implementation detail: the
/// `provisioning` row is written LAST so its presence IS the commit marker —
/// a terminal is set up exactly when that row exists, and it cannot exist
/// unless every step before it committed.
///
/// Steps 2, 4 and 5 call existing code (`seed_default_roles`, the owner
/// bootstrap's store calls, `write_setup`'s statement list); the new work is
/// the guard, the location row and the marker. Every write goes through
/// `conn` directly rather than the `Store` methods that wrap their OWN
/// transaction — a nested BEGIN inside this one would fail with "cannot start
/// a transaction within a transaction", the same class the CLI-1 and
/// `import_data` fixes recorded.
///
/// # Errors
///
/// [`CoreError::Validation`] for an empty location name, an empty owner
/// username/display name, a PIN shorter than 4 characters, or a `linked`
/// mode missing its tenant or credential id. [`CoreError::Internal`] when a
/// write succeeds but its row cannot be read back.
pub fn provision_device(
    conn: &Connection,
    args: &ProvisionDeviceArgs,
) -> Result<ProvisionDeviceResult, CoreError> {
    let store = Store::new(conn);

    // ── Step 1: the idempotency guard ────────────────────────────
    // Before any write, so a retry is free. This is what makes a crash,
    // a lost Android IPC response, or a re-polled pairing claim safe.
    if let Some(existing) = store.get_provisioning(&args.terminal_id)? {
        let location_id = existing.location_id.clone().unwrap_or_default();
        let owner_user_id = existing.owner_user_id.clone().unwrap_or_default();
        return Ok(ProvisionDeviceResult {
            record: existing,
            location_id,
            owner_user_id,
            created: false,
        });
    }

    // ── Validate before opening the transaction ──────────────────
    // Fail on bad input before taking the write lock: a rejected call must
    // not have held the DB against a concurrent reader.
    validate_provision_args(args)?;

    let tx = conn.unchecked_transaction()?;
    let result = provision_device_inner(&tx, args);
    match result {
        Ok(done) => {
            tx.commit()?;
            Ok(done)
        }
        Err(e) => {
            // Explicit rollback so a half-written terminal cannot survive a
            // failure at step 3 or later: the five workspaces and the owner
            // are all-or-nothing with the marker.
            tx.rollback()?;
            Err(e)
        }
    }
}

/// The transactional body, split out so the commit/rollback pairing above
/// stays in one place and every early return here rolls back.
fn provision_device_inner(
    tx: &Connection,
    args: &ProvisionDeviceArgs,
) -> Result<ProvisionDeviceResult, CoreError> {
    let store = Store::new(tx);

    // ── Step 2: roles before the owner who references them ───────
    // Was implicit in `run_bootstrap_owner`; called here so the ordering is
    // visible and matches the bridge's own sequence.
    store.seed_default_roles()?;

    // ── Step 3: the location row, and the workspaces that point at it ─
    // §2.6 decided the seeded 'Default Store' placeholder and the five
    // default workspaces are REMOVED and created here instead, so this is a
    // genuine first insert on a fresh install rather than a promotion of rows
    // the migration shipped.
    //
    // The two are one step, not two, because §2.6 is explicit that the
    // coupling is the honest cost of the decision: the workspaces reference
    // `locations(id)` with ON DELETE RESTRICT, so a location without them
    // would leave the merchant with a store and nothing to open.
    // `is_primary` is set only when this is the install's FIRST location.
    //
    // The invariant is exactly one primary row (`idx_locations_primary`, a
    // partial UNIQUE on `is_primary = 1` from 20260906:22-23), so writing 1
    // unconditionally would make provisioning a SECOND terminal fail with a
    // constraint violation. A second terminal shares its Location-owning
    // merchant's primary rather than promoting itself.
    let location_id = new_id();
    let has_primary: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM locations WHERE is_primary = 1)",
        [],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO locations (id, name, currency, timezone, is_primary) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            location_id,
            args.location_name.trim(),
            args.currency,
            args.timezone,
            i32::from(!has_primary),
        ],
    )?;
    create_workspaces_in_tx(tx, &location_id, args.location_kind)?;

    // ── Step 4: the owner, in this transaction ───────────────────
    // Reuses the bridge bootstrap's validation + hashing so an owner created
    // here is indistinguishable from one created by the standalone command.
    let owner_user_id = create_owner_in_tx(tx, args)?;

    // ── Step 5: features, preset and default currency ────────────
    // The effective content of today's write_setup, unchanged in meaning.
    // Written directly rather than through Settings::set_batch, which opens
    // its own transaction (see the doc comment above).
    write_provisioning_settings(tx, args)?;

    // ── Step 6: the marker, LAST ─────────────────────────────────
    let (record, _) = store.provision_terminal(&ProvisioningRecord {
        terminal_id: args.terminal_id.clone(),
        tenant_id: args.tenant_id.clone(),
        location_id: Some(location_id.clone()),
        owner_user_id: Some(owner_user_id.clone()),
        device_id: args.device_credential_id.clone(),
        mode: args.mode,
        home_region: crate::regional::DEFAULT_REGION.to_string(),
        provisioned_at: String::new(),
    })?;

    Ok(ProvisionDeviceResult {
        record,
        location_id,
        owner_user_id,
        created: true,
    })
}
/// Validate everything `provision_device` will write, before it writes it.
///
/// A `linked` install must name its tenant and credential: the schema CHECK
/// enforces the same rule, and failing here turns what would be a constraint
/// violation into a field-named validation error.
fn validate_provision_args(args: &ProvisionDeviceArgs) -> Result<(), CoreError> {
    if args.location_name.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "location_name",
            message: "location name is required".into(),
        });
    }
    if args.owner_username.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "owner_username",
            message: "owner username is required".into(),
        });
    }
    if args.owner_display_name.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "owner_display_name",
            message: "owner display name is required".into(),
        });
    }
    if args.owner_pin.chars().count() < 4 {
        return Err(CoreError::Validation {
            field: "owner_pin",
            message: "owner PIN must be at least 4 characters".into(),
        });
    }
    if args.terminal_id.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "terminal_id",
            message: "terminal id is required".into(),
        });
    }
    if args.mode == ProvisioningMode::Linked {
        if args.tenant_id.as_deref().unwrap_or("").trim().is_empty() {
            return Err(CoreError::Validation {
                field: "tenant_id",
                message: "a linked install must name its licence-server tenant".into(),
            });
        }
        if args
            .device_credential_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            return Err(CoreError::Validation {
                field: "device_credential_id",
                message: "a linked install must name its device credential".into(),
            });
        }
    }
    Ok(())
}

/// Create the owner user inside the caller's transaction.
///
/// Calls `create_user_in_tx`, NOT `create_user`: the latter opens its own
/// transaction and would be a nested BEGIN here ("cannot start a transaction
/// within a transaction"). That is the same defect `create_user_in_tx`
/// documents having caused for staff-with-profile creation on 2026-08-31 — it
/// is reused rather than re-derived, so the row shape is identical to every
/// other owner in the system.
///
/// Deliberately does NOT call the bridge's `run_bootstrap_owner`: that guard
/// refuses when any user exists, which is right for first-run and wrong for a
/// replay that the step-1 guard has already answered.
fn create_owner_in_tx(conn: &Connection, args: &ProvisionDeviceArgs) -> Result<String, CoreError> {
    let store = Store::new(conn);
    let pin_hash = crate::auth::hash_pin(&args.owner_pin)
        .map_err(|e| CoreError::Internal(format!("hashing owner PIN: {e}")))?;
    let user = store.create_user_in_tx(
        &args.owner_username,
        &pin_hash,
        args.owner_display_name.trim(),
        crate::builtin_roles::OWNER,
    )?;
    Ok(user.id)
}

/// Persist the settings a provisioned terminal needs to be usable.
///
/// The effective content of `write_setup` (§2.2 step 5), unchanged in meaning.
/// It does NOT write `SETUP_COMPLETE` or `SHOW_SETUP_WIZARD`: those two keys
/// are precisely the booleans §2.1 retires, and the provisioning row now
/// answers the question they were asked.
fn write_provisioning_settings(
    conn: &Connection,
    args: &ProvisionDeviceArgs,
) -> Result<(), CoreError> {
    // Feature rows. Written directly rather than through `Settings::set_batch`,
    // which opens its OWN transaction and would be a nested BEGIN here.
    let mut registry = crate::FeatureRegistry::new();
    for key in &args.features {
        if let Some(feat) = crate::features::feature_from_key(key) {
            registry.enable(feat);
        }
        // An unknown key is skipped, not fatal: the wizard may offer a feature
        // a given build does not ship, and refusing to provision over that
        // would strand the merchant at the first-run screen.
    }
    for (key, value) in registry.to_settings_rows() {
        crate::Settings::set(conn, &key, &value)?;
    }
    crate::Settings::prune_stale_features(conn, &registry)?;

    crate::Settings::set_default_currency(conn, &args.currency)?;
    crate::Settings::set(
        conn,
        platform_core::settings::keys::STORE_PRESET,
        &args.preset,
    )?;
    Ok(())
}

/// Generate a collision-resistant id for a row this transaction creates.
///
/// Clock plus a per-process counter rather than sequential: a location id leaks
/// nothing about how many locations exist, and two devices provisioning against
/// one store DB cannot collide.
fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("loc-{nanos:032x}{seq:04x}")
}
/// Create the workspace instances this location trades with (ADR #56 §2.6).
///
/// These replace the five `default-*` rows the migration used to seed. A store
/// with no merchant should have no workspaces, so they are created here — in
/// the same transaction as the location they reference — rather than shipped by
/// the baseline for a merchant who does not exist.
///
/// `name` and `description` mirror the seeded rows' wording so a provisioned
/// install looks exactly like one the old baseline produced, minus the fiction.
fn create_workspaces_in_tx(
    conn: &Connection,
    location_id: &str,
    kind: LocationKind,
) -> Result<(), CoreError> {
    for type_key in kind.workspace_types() {
        let (name, description) = workspace_label(type_key);
        conn.execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name, description, status) VALUES (?1, ?2, ?3, ?4, ?5, 'active')",
            params![new_id(), type_key, location_id, name, description],
        )?;
    }
    Ok(())
}

/// Display name and description for one workspace type.
///
/// Wording copied from the seeded rows (`20260813_init.sql:1505-1510`) so the
/// upgrade is invisible in the UI; an unrecognised key falls back to a
/// humanised form rather than failing, because a new workspace type must not
/// be able to block first-run.
fn workspace_label(type_key: &str) -> (&'static str, String) {
    match type_key {
        "store-pos" => ("Store POS", "Cashier terminal for retail".to_owned()),
        "restaurant-pos" => (
            "Restaurant POS",
            "Cashier terminal for restaurant ordering".to_owned(),
        ),
        "warehouse" => ("Warehouse", "Product and stock management".to_owned()),
        "admin" => ("Admin", "System administration".to_owned()),
        "kds" => ("Kitchen Display", "Kitchen order queue display".to_owned()),
        other => ("Workspace", other.to_owned()),
    }
}
#[cfg(test)]
#[path = "provisioning_tests.rs"]
mod tests;
