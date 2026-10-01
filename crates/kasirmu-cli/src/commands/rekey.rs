//! Per-install at-rest key rotation — `oz rekey` (C1 slice S2c).
//!
//! Every settings and profile credential in this build is sealed under a key
//! derived from the **per-install at-rest key** held in the OS keychain
//! (`oz-pos/at-rest-key.v1`). Rotating that key is therefore not a keychain-only
//! operation: the moment the old key is gone, every row still sealed under it is
//! unreadable. `oz rekey` is the command that re-encrypts those rows.
//!
//! # The ordering, and why it is the whole design
//!
//! `kasirmu_crypto::set_install_key` is a first-call-wins `OnceLock` holding ONE
//! key per process, and the read order is `[install, previous, legacy, master]`.
//! Re-encrypting to a key the keychain does not yet hold means an interruption
//! leaves rows under a key no boot can install — the install is bricked. So the
//! rotation **parks the OLD key and promotes the NEW one**, and from that instant
//! the keychain holds both:
//!
//! 1. `begin_install_key_rotation` parks the current key at
//!    `oz-pos/at-rest-key.v1-prev` and promotes a fresh one;
//! 2. this process installs **both** (`set_install_key` + `set_previous_install_key`)
//!    before it touches a single row;
//! 3. the sweep re-encrypts every in-scope row under the current key, in one
//!    transaction;
//! 4. the sweep is verified **inside that transaction**, so a failure rolls back
//!    to "all rows under the old key, both keys present" rather than leaving the
//!    store half-converted;
//! 5. only then is the parked key retired — the last step, and the only
//!    destructive one.
//!
//! An interruption anywhere before step 5 leaves **both** keys durably present,
//! so any boot reads every row whether it is still under the old key or already
//! re-encrypted. Re-running `oz rekey --confirm` resumes rather than restarting.
//!
//! # The sweep is TOTAL, over three row SHAPES
//!
//! A row left under the old key is unreadable the moment the parked key is
//! retired, and a partial sweep does not fail loudly — it strands rows. So the
//! sweep covers every family that derives from the install key, read off the
//! `portable_key` / `candidate_keys` call sites, and those eight families live in
//! three different shapes:
//!
//! 1. **six plain `settings` rows**, whose whole `value` is the ciphertext —
//!    `sync_api_key`, `sync_terminal_secret`, `pg_sync.password`,
//!    `rate_sync.api_key`, `lan_server.psk`, `local_api.secret`;
//! 2. **one FIELD inside a JSON blob** — the `password` member of
//!    `settings.smtp_config`, whose sibling members are in the clear;
//! 3. **two `users` COLUMNS** — `national_id` and `monthly_take_home_minor`.
//!
//! (2) and (3) are why a "settings table only" sweep is not sufficient, and why
//! this module walks one table after the other instead of one statement.
//!
//! Two further families are **machine-bound** — their key material is the
//! installation fingerprint, not the install key — so a rotation must NOT touch
//! them: their ciphertext does not change meaning when the install key rotates.
//! They are listed as out of scope rather than silently skipped.
//!
//! # What this module reads, and what it will not say
//!
//! The walk reads the `value` column because that is what a rewrite must write
//! back. Nothing derived from a value leaves this module: the report prints key
//! names, column names and counts, and no value is ever printed, logged, or put
//! into an error message.

use std::borrow::Cow;
use std::sync::LazyLock;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, params};

use kasirmu_core::crypto::{AtRestFamily, opens_under_current_key_only, rewrap};
use kasirmu_core::settings::keys;
use kasirmu_security::install_key::{
    INSTALL_KEY_PREV_ENTRY, begin_install_key_rotation, resume_install_key_rotation,
    retire_previous_install_key,
};

use crate::cli::RekeyArgs;

/// The table holding the six whole-row families and the SMTP blob.
pub(crate) const SETTINGS_TABLE: &str = "settings";

/// The table holding the two profile columns.
pub(crate) const USERS_TABLE: &str = "users";

/// The two `users` columns sealed by the profile at-rest family.
///
/// `national_id_hash` is deliberately absent: it is a SHA-256 uniqueness proof,
/// not a sealed value, and re-encrypting it would destroy the uniqueness check.
/// `national_id_type` and `tax_id` are in the clear by design.
pub(crate) const PROFILE_COLUMNS: [&str; 2] = ["national_id", "monthly_take_home_minor"];

/// The head of the long help: what the command does, in the order it does it.
pub(crate) const HELP_HEAD: &str = concat!(
    "Rotate the per-install at-rest key and re-encrypt every row that derives from it.\n",
    "\n",
    "The rotation PARKS the outgoing key (oz-pos/at-rest-key.v1-prev) and PROMOTES a fresh one\n",
    "BEFORE anything is re-encrypted, so the keychain holds both keys for the whole operation and\n",
    "an interruption at any point leaves every row readable. The parked key is retired LAST, and\n",
    "only after the sweep has been verified inside its own transaction. Re-running with --confirm\n",
    "after an interruption RESUMES the rotation rather than starting a new one.\n",
    "\n",
    "The sweep is TOTAL over the three shapes the install-key-derived families live in: the six\n",
    "whole-row settings keys, the password FIELD inside settings.smtp_config's JSON blob, and the\n",
    "users.national_id / users.monthly_take_home_minor columns. A settings-table-only sweep would\n",
    "strand rows, and a stranded row does not fail loudly — it becomes unreadable the moment the\n",
    "outgoing key is retired."
);

/// What the command deliberately does not touch.
pub(crate) const OUT_OF_SCOPE_NOTE: &str = concat!(
    "NOT in scope, and deliberately so: the two MACHINE-BOUND families (license.api_key, and the\n",
    "smtp_password family, which has no caller left in the tree). Their key material is the\n",
    "installation fingerprint, not the install key, so their ciphertext does not change meaning\n",
    "when the install key rotates and a rotation must not touch them. Also out of scope:\n",
    "users.national_id_hash (a uniqueness proof, not a sealed value), and every whole-file page\n",
    "copy (.db / .backup.db), which keeps whatever keys sealed it when it was written."
);

/// The byte-level caveat, matching the sibling commands.
pub(crate) const BYTES_NOT_CONTENT: &str = concat!(
    "READ-ONLY IN CONTENT ON A BARE RUN, NOT BYTE-FOR-BYTE: a bare run writes no row and rotates\n",
    "no key, but the CLI opens the database with PRAGMA journal_mode=WAL, which persists WAL in\n",
    "the file header and creates <db>-wal and <db>-shm beside it for the duration of the run. And\n",
    "--db defaults to ./kasir.db in the CURRENT DIRECTORY, where opening a MISSING path creates\n",
    "one — which is why this command refuses a path it would have to create. Take a copy first:\n",
    "kasir backup --output <copy.db>, then oz rekey --db <copy.db>."
);

/// Why a rotation is refused on a non-durable keychain, stated before it is.
pub(crate) const NON_DURABLE_REFUSAL: &str = concat!(
    "REFUSED: the OS keychain on this host is not durable, so it does not survive a restart. A\n",
    "rotation here would re-encrypt every credential under a key that is gone at the next boot,\n",
    "and two of the six families (rate_sync.api_key, lan_server.psk) have no production setter at\n",
    "all — the rows could never be re-entered. Nothing was rotated and nothing was written."
);

/// The whole long help, assembled from the SAME constants the run prints, so the
/// help text and the report can never disagree about what is in scope.
pub(crate) static LONG_HELP: LazyLock<String> =
    LazyLock::new(|| format!("{HELP_HEAD}\n\n{OUT_OF_SCOPE_NOTE}\n\n{BYTES_NOT_CONTENT}"));

/// Which at-rest family owns a `settings` key, or `None` when none does.
///
/// The key is canonicalised through [`keys::credential_base`] first, so the
/// case and whitespace variants the settings table tolerates
/// (`SYNC_API_KEY`, `" sync_api_key "`) resolve to the family that owns them
/// rather than being walked past — a skip here would strand the row, which is
/// exactly the failure this module exists to prevent.
///
/// `smtp_config` is deliberately NOT mapped here: its value is a JSON blob whose
/// other members are in the clear, so it is a different shape with a different
/// rewrite. See [`SweepTarget`].
pub(crate) fn settings_family(key: &str) -> Option<AtRestFamily> {
    match keys::credential_base(key)? {
        keys::SYNC_API_KEY => Some(AtRestFamily::SyncApiKey),
        keys::SYNC_TERMINAL_SECRET => Some(AtRestFamily::SyncTerminalSecret),
        keys::PG_SYNC_PASSWORD => Some(AtRestFamily::PgSyncPassword),
        keys::RATE_SYNC_API_KEY => Some(AtRestFamily::RateApiKey),
        keys::LAN_SERVER_PSK => Some(AtRestFamily::LanPsk),
        keys::LOCAL_API_SECRET => Some(AtRestFamily::LocalApiSecret),
        _ => None,
    }
}

/// Whether a `settings` key names the SMTP blob whose `password` field is sealed.
pub(crate) fn is_smtp_config_key(key: &str) -> bool {
    keys::credential_base(key) == Some(keys::SMTP_CONFIG)
}

/// One in-scope row, addressed by enough to rewrite it and nothing more.
///
/// Every variant carries a key name or a user id — never a value. That is what
/// makes "no secret escapes this module" structural rather than a discipline:
/// there is nowhere in this type for a value to be stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SweepTarget {
    /// A `settings` row whose whole `value` is the family's ciphertext.
    SettingsValue {
        /// The STORED key, used verbatim in the `WHERE` clause.
        key: String,
        /// The family that owns it.
        family: AtRestFamily,
    },
    /// The `password` FIELD inside `settings.smtp_config`'s JSON blob.
    SmtpPasswordField {
        /// The STORED key, used verbatim in the `WHERE` clause.
        key: String,
    },
    /// One sealed column of one `users` row.
    ProfileColumn {
        /// The `users.id` of the row.
        user_id: String,
        /// The column name, from [`PROFILE_COLUMNS`].
        column: &'static str,
    },
}

impl SweepTarget {
    /// The family whose key seals this row's value.
    pub(crate) fn family(&self) -> AtRestFamily {
        match self {
            Self::SettingsValue { family, .. } => *family,
            Self::SmtpPasswordField { .. } => AtRestFamily::SmtpAtRest,
            Self::ProfileColumn { .. } => AtRestFamily::ProfileAtRest,
        }
    }

    /// The sealed value INSIDE this row's stored form, or `None` when the row
    /// carries nothing sealed.
    ///
    /// The distinction matters for the SMTP blob: the row exists and its
    /// `password` field may be absent or empty, in which case there is nothing
    /// for a rotation to re-encrypt and nothing that can depend on the outgoing
    /// key. Both the sweep and the verification go through this one function, so
    /// their notion of "a row with nothing sealed" cannot drift apart — which is
    /// what makes the two counts comparable in [`rotate_at_rest_rows`].
    pub(crate) fn sealed_value<'a>(&self, stored: &'a str) -> Option<Cow<'a, str>> {
        match self {
            Self::SettingsValue { .. } | Self::ProfileColumn { .. } => Some(Cow::Borrowed(stored)),
            Self::SmtpPasswordField { .. } => smtp_password_field(stored).map(Cow::Owned),
        }
    }
}

/// The `password` member of an SMTP config blob, if it is a non-empty string.
///
/// `None` covers every case in which there is nothing to rotate: not JSON, not
/// an object, no `password` member, a non-string member, or an empty string
/// (which is how the writer records a cleared password).
pub(crate) fn smtp_password_field(blob: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(blob).ok()?;
    let password = parsed.get("password")?.as_str()?;
    if password.is_empty() {
        return None;
    }
    Some(password.to_owned())
}

/// Replace the `password` member of an SMTP config blob, leaving every other
/// member byte-identical.
///
/// The blob is re-serialised by `serde_json`, so its whitespace and member order
/// may differ from the input; the parsed value does not. That is safe because the
/// only reader parses it (`SmtpConfig` in `kasirmu-core`), and it is stated
/// rather than left to be discovered.
pub(crate) fn rebuild_smtp_blob(blob: &str, new_password: &str) -> Result<String> {
    let mut parsed: serde_json::Value = serde_json::from_str(blob)
        .context("re-reading the SMTP config blob that was just parsed")?;
    let Some(object) = parsed.as_object_mut() else {
        bail!("the SMTP config blob is not a JSON object");
    };
    object.insert(
        "password".to_owned(),
        serde_json::Value::String(new_password.to_owned()),
    );
    serde_json::to_string(&parsed).context("re-serialising the SMTP config blob")
}

/// What the walk should do with one in-scope row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VisitOutcome {
    /// Leave the row exactly as it is.
    Skip,
    /// The row's sealed value could not be read under ANY candidate key, so a
    /// rotation leaves it alone rather than destroying it. Pre-existing damage,
    /// not something this run caused.
    Unreadable,
    /// Write this value back over the row.
    Write(String),
    /// Verification only: the row does not open under the current key ALONE.
    NotUnderCurrentKey,
}

/// What a walk saw and did. Counts only — no key, no value, no id.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SweepTally {
    /// `settings` rows whose whole value is sealed.
    pub settings_rows: usize,
    /// `settings.smtp_config` rows carrying a sealed `password` field.
    pub smtp_rows: usize,
    /// `users` columns carrying a sealed value.
    pub profile_rows: usize,
    /// Rows actually rewritten (always 0 in a report walk).
    pub rewritten: usize,
    /// Rows the rewrite could not read under any candidate key.
    pub unreadable: usize,
    /// Rows that do not open under the current key alone (verification only).
    pub not_under_current: usize,
}

impl SweepTally {
    /// Every in-scope row, across all three shapes.
    pub(crate) fn total_rows(&self) -> usize {
        self.settings_rows + self.smtp_rows + self.profile_rows
    }

    /// Count one in-scope row, hand it to `visit`, and record the outcome.
    ///
    /// A row with nothing sealed is NOT in scope and is not counted: it cannot
    /// depend on the outgoing key, so retiring that key cannot affect it. Only the
    /// SMTP shape can be in that state — its `password` member may be absent, null,
    /// or empty — but the check is written against
    /// [`SweepTarget::sealed_value`] rather than against the shape, so the report
    /// and the sweep cannot disagree about which rows are in scope.
    fn record(
        &mut self,
        conn: &Connection,
        target: &SweepTarget,
        stored: &str,
        visit: &mut impl FnMut(&SweepTarget, &str) -> Result<VisitOutcome>,
    ) -> Result<()> {
        if target.sealed_value(stored).is_none() {
            return Ok(());
        }
        match target {
            SweepTarget::SettingsValue { .. } => self.settings_rows += 1,
            SweepTarget::SmtpPasswordField { .. } => self.smtp_rows += 1,
            SweepTarget::ProfileColumn { .. } => self.profile_rows += 1,
        }
        apply_outcome(conn, target, visit(target, stored)?, self)
    }
}

/// Walk every install-key-derived row in the store, across the three shapes,
/// calling `visit` with each row's CURRENT stored form.
///
/// The `settings` and `users` rows are read into memory before any write, because
/// a `SELECT` being iterated on a connection cannot safely have `UPDATE`s
/// interleaved with it. The values held there are ciphertext, which the
/// application holds anyway.
///
/// Returns what was seen and done. Nothing derived from a value is returned or
/// logged.
pub(crate) fn walk_at_rest_rows(
    conn: &Connection,
    mut visit: impl FnMut(&SweepTarget, &str) -> Result<VisitOutcome>,
) -> Result<SweepTally> {
    let mut tally = SweepTally::default();

    // Shapes (i) and (ii): the `settings` table, whole-row families first.
    let settings: Vec<(String, String)> = {
        let sql = format!("SELECT key, value FROM {SETTINGS_TABLE}");
        let mut stmt = conn
            .prepare(&sql)
            .with_context(|| format!("reading the {SETTINGS_TABLE} table"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .with_context(|| format!("reading the {SETTINGS_TABLE} table"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .with_context(|| format!("reading the {SETTINGS_TABLE} table"))?
    };
    for (key, stored) in &settings {
        let target = if let Some(family) = settings_family(key) {
            SweepTarget::SettingsValue {
                key: key.clone(),
                family,
            }
        } else if is_smtp_config_key(key) {
            SweepTarget::SmtpPasswordField { key: key.clone() }
        } else {
            continue;
        };
        tally.record(conn, &target, stored, &mut visit)?;
    }

    // Shape (iii): the sealed `users` columns.
    let users: Vec<(String, Option<String>, Option<String>)> = {
        let sql = format!("SELECT id, national_id, monthly_take_home_minor FROM {USERS_TABLE}");
        let mut stmt = conn
            .prepare(&sql)
            .with_context(|| format!("reading the {USERS_TABLE} table"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .with_context(|| format!("reading the {USERS_TABLE} table"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .with_context(|| format!("reading the {USERS_TABLE} table"))?
    };
    for (user_id, national_id, pay) in &users {
        for (column, raw) in [(PROFILE_COLUMNS[0], national_id), (PROFILE_COLUMNS[1], pay)] {
            // An absent or empty column carries nothing sealed: NULL means the
            // field was never set, and the empty string is how a cleared one is
            // stored. Neither can depend on the outgoing key.
            let Some(stored) = raw.as_deref().filter(|value| !value.is_empty()) else {
                continue;
            };
            let target = SweepTarget::ProfileColumn {
                user_id: user_id.clone(),
                column,
            };
            tally.record(conn, &target, stored, &mut visit)?;
        }
    }

    Ok(tally)
}

/// Carry out one row's [`VisitOutcome`]: write when told to, count what happened.
fn apply_outcome(
    conn: &Connection,
    target: &SweepTarget,
    outcome: VisitOutcome,
    tally: &mut SweepTally,
) -> Result<()> {
    match outcome {
        VisitOutcome::Skip => {}
        VisitOutcome::Unreadable => tally.unreadable += 1,
        VisitOutcome::NotUnderCurrentKey => tally.not_under_current += 1,
        VisitOutcome::Write(new_value) => {
            if write_target(conn, target, &new_value)? {
                tally.rewritten += 1;
            }
        }
    }
    Ok(())
}

/// Write `new_value` over the row `target` names. Returns whether a row matched.
fn write_target(conn: &Connection, target: &SweepTarget, new_value: &str) -> Result<bool> {
    let changed = match target {
        SweepTarget::SettingsValue { key, .. } | SweepTarget::SmtpPasswordField { key } => conn
            .execute(
                &format!("UPDATE {SETTINGS_TABLE} SET value = ?1 WHERE key = ?2"),
                params![new_value, key],
            )
            .with_context(|| format!("rewriting the {SETTINGS_TABLE} row for {key}"))?,
        SweepTarget::ProfileColumn { user_id, column } => conn
            .execute(
                // `column` comes from PROFILE_COLUMNS, a fixed `&'static str`
                // array, so it can never carry caller input into the statement.
                &format!("UPDATE {USERS_TABLE} SET {column} = ?1 WHERE id = ?2"),
                params![new_value, user_id],
            )
            .with_context(|| format!("rewriting {USERS_TABLE}.{column} for a user row"))?,
    };
    Ok(changed > 0)
}

/// The re-encrypt visitor: rewrap each row's sealed value under the current key.
pub(crate) fn rewrap_visitor(target: &SweepTarget, stored: &str) -> Result<VisitOutcome> {
    let Some(sealed) = target.sealed_value(stored) else {
        return Ok(VisitOutcome::Skip);
    };
    match rewrap(target.family(), &sealed) {
        Ok(Some(new_sealed)) => {
            let row_value = match target {
                SweepTarget::SmtpPasswordField { .. } => rebuild_smtp_blob(stored, &new_sealed)?,
                _ => new_sealed,
            };
            Ok(VisitOutcome::Write(row_value))
        }
        // Unreadable under every candidate key: pre-existing damage. Left alone,
        // counted, and never treated as a reason to destroy the row.
        Ok(None) => Ok(VisitOutcome::Unreadable),
        Err(e) => Err(anyhow::Error::new(e).context("re-encrypting an at-rest value")),
    }
}

/// The verification visitor: does this row open under the CURRENT key alone?
pub(crate) fn verify_visitor(target: &SweepTarget, stored: &str) -> Result<VisitOutcome> {
    let Some(sealed) = target.sealed_value(stored) else {
        return Ok(VisitOutcome::Skip);
    };
    Ok(if opens_under_current_key_only(target.family(), &sealed) {
        VisitOutcome::Skip
    } else {
        VisitOutcome::NotUnderCurrentKey
    })
}

/// What one completed rotation did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RotationOutcome {
    /// The sweep's own tally.
    pub swept: SweepTally,
    /// The verification's tally, run inside the same transaction.
    pub verified: SweepTally,
}

/// Re-encrypt every in-scope row under the current key, in ONE transaction, and
/// verify it before committing.
///
/// # Why the verification is inside the transaction
///
/// A commit before the check would leave a store half-converted on a failure,
/// with the two counts disagreeing and no way to tell which rows were done. Doing
/// both inside one transaction makes the unit "all rows converted and verified,
/// or none of them" — and a rollback is harmless, because the keychain still holds
/// both keys and every row therefore still reads.
///
/// # The one failure that is allowed to commit nothing
///
/// A row that no candidate key can open was already damaged before this ran; the
/// sweep counts it as `unreadable` and leaves it. Verification sees the same row
/// through the same [`SweepTarget::sealed_value`] gate and counts it as
/// `not_under_current`, so a clean run has the two numbers EQUAL. Any other
/// relation means the two instruments disagree about the store, which is a reason
/// to keep the outgoing key rather than to trust the sweep.
///
/// # Errors
///
/// A read/write failure, an encrypt failure, or the disagreement above — in every
/// case the transaction rolls back and the caller must not retire the outgoing
/// key.
pub(crate) fn rotate_at_rest_rows(conn: &Connection) -> Result<RotationOutcome> {
    let tx = conn
        .unchecked_transaction()
        .context("beginning the rekey transaction")?;
    let swept = walk_at_rest_rows(&tx, rewrap_visitor)?;
    let verified = walk_at_rest_rows(&tx, verify_visitor)?;
    if verified.not_under_current != swept.unreadable {
        bail!(
            "the sweep rewrote {} row(s), but {} row(s) still do not open under the new key \
             while the sweep found {} unreadable before it ran. The two counts disagree, so \
             the transaction is rolled back and the outgoing key is NOT retired. Nothing is \
             lost: both keys are still in the keychain, so every row still reads.",
            swept.rewritten,
            verified.not_under_current,
            swept.unreadable
        );
    }
    tx.commit().context("committing the rekey sweep")?;
    Ok(RotationOutcome { swept, verified })
}

/// Refuse a database that is not a store BEFORE rotating anything.
///
/// The same footgun the sibling report commands guard: `--db` defaults to
/// `./kasir.db` in the CURRENT directory and `Connection::open` CREATES a missing
/// path. For a rotation that is worse than a misleading report — the operator
/// would be told a rotation succeeded against a file the command had just made.
/// `commands::open_store_for_rekey` refuses the missing path upstream; this is the
/// second line of defence, about the CONTENTS.
pub(crate) fn require_rekey_database(conn: &Connection) -> Result<()> {
    let path = conn
        .path()
        .map(|p| p.to_string())
        .unwrap_or_else(|| "<unknown path>".to_string());
    for table in [SETTINGS_TABLE, USERS_TABLE] {
        let present: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .with_context(|| format!("looking for the {table} table"))?;
        if present == 0 {
            bail!(
                "the database at {path} has no {table} table, so it is not a migrated kasir.mu \
                 store and a rotation against it would re-encrypt nothing while reporting \
                 success. Note that --db defaults to ./kasir.db in the CURRENT directory and \
                 opening a MISSING path CREATES one, so this file may have been made by the \
                 very command meant to rotate it. Point --db at a real store, or take a copy \
                 first with kasir backup --output <copy.db> and run this against the copy."
            );
        }
    }
    Ok(())
}

/// `oz rekey` — report what is in scope, or rotate it with `--confirm`.
pub(crate) fn run_rekey(conn: &Connection, args: &RekeyArgs) -> Result<()> {
    require_rekey_database(conn)?;

    let keyring = kasirmu_security::default_keyring()
        .context("opening the OS keychain that holds the per-install at-rest key")?;
    let durable = keyring.is_durable();
    let parked = keyring
        .get_secret(INSTALL_KEY_PREV_ENTRY)
        .context("reading the parked-key entry")?;

    // The report walk never rewraps, so it needs no key installed and writes
    // nothing: it answers "what is in scope", which is a question about the store.
    let scope = walk_at_rest_rows(conn, |_, _| Ok(VisitOutcome::Skip))?;

    println!("{}", LONG_HELP.as_str());
    println!();
    println!(
        "Keychain: {}",
        if durable {
            "durable — a rotation can be performed here"
        } else {
            "NOT DURABLE — a rotation is refused here"
        }
    );
    println!(
        "Rotation in flight: {}",
        if parked.is_some() {
            format!(
                "YES — a key is parked at {INSTALL_KEY_PREV_ENTRY}. --confirm will RESUME that \
                 rotation (re-sweep and retire the parked key), not start a new one."
            )
        } else {
            "no".to_string()
        }
    );
    println!();
    println!("In scope in this store — every row that derives from the install key:");
    println!(
        "{:>6}  settings row(s), whole value sealed (sync_api_key, sync_terminal_secret, \
         pg_sync.password, rate_sync.api_key, lan_server.psk, local_api.secret)",
        scope.settings_rows
    );
    println!(
        "{:>6}  settings.smtp_config row(s) carrying a sealed password field",
        scope.smtp_rows
    );
    println!(
        "{:>6}  users column(s) sealed by the profile family ({})",
        scope.profile_rows,
        PROFILE_COLUMNS.join(", ")
    );
    println!("{:>6}  TOTAL", scope.total_rows());
    println!();
    println!("{OUT_OF_SCOPE_NOTE}");
    println!();

    if !args.confirm {
        println!(
            "NOTHING ROTATED — a bare invocation only reports. Re-run with --confirm to rotate."
        );
        println!("{BYTES_NOT_CONTENT}");
        return Ok(());
    }

    // Checked before ANY keychain write: a rotation into a non-durable store is
    // the hazard the whole per-install key exists to avoid.
    if !durable {
        bail!("{NON_DURABLE_REFUSAL}");
    }

    // Resume an interrupted rotation rather than refusing: `begin_install_key_rotation`
    // is right to refuse a silent restart, but the operator would otherwise be
    // stuck with two keys on disk and no way to finish the sweep.
    let rotation = if parked.is_some() {
        resume_install_key_rotation(keyring.as_ref())
            .context("resuming the interrupted rotation")?
    } else {
        begin_install_key_rotation(keyring.as_ref()).context("beginning the rotation")?
    };

    // CRITICAL ORDERING: `set_install_key` is first-call-wins for the whole
    // process, so both keys must be installed before ANY other crypto call. The
    // parked key is installed as a READ candidate only; `portable_key` never
    // consults it, so no write can land under the outgoing key.
    if !kasirmu_core::crypto::set_install_key(rotation.new_secret) {
        bail!(
            "an install key was already installed in this process before the rotation began, so \
             a sweep would re-encrypt under the wrong key. This is a programming error, not a \
             store problem. Nothing was swept; both keys are in the keychain and every row still \
             reads. Run `oz rekey --confirm` as its own command."
        );
    }
    if let Some(outgoing) = rotation.outgoing
        && !kasirmu_core::crypto::set_previous_install_key(outgoing)
    {
        bail!(
            "the outgoing key could not be installed as a read candidate, so rows still under it \
             would read as unreadable and the sweep would leave them behind. Nothing was swept; \
             both keys are in the keychain and every row still reads."
        );
    }

    let outcome = rotate_at_rest_rows(conn)?;
    let retired = retire_previous_install_key(keyring.as_ref())
        .context("retiring the outgoing key after a verified sweep")?;

    println!("ROTATED. The per-install at-rest key has been replaced.");
    println!(
        "  re-encrypted {} of {} in-scope row(s) ({} settings whole-value, {} smtp password \
         field, {} profile column).",
        outcome.swept.rewritten,
        outcome.swept.total_rows(),
        outcome.swept.settings_rows,
        outcome.swept.smtp_rows,
        outcome.swept.profile_rows
    );
    if outcome.swept.unreadable > 0 {
        println!(
            "  {} row(s) were already unreadable under EVERY candidate key before this ran and \
             were left byte-identical. Retiring the outgoing key does not make them worse — they \
             were already unopenable — but they are still unopenable now. Use `oz \
             credential-deltas` to see them by key name.",
            outcome.swept.unreadable
        );
    }
    println!(
        "  verification: {} row(s) do not open under the new key alone, matching the {} found \
         unreadable before the sweep.",
        outcome.verified.not_under_current, outcome.swept.unreadable
    );
    if retired {
        println!("  the parked outgoing key has been retired; the rotation is complete.");
    } else {
        println!(
            "  NOTE: no parked key was found to retire, which means this rotation promoted a \
             first key for an install that had none."
        );
    }
    println!();
    println!(
        "Whole-file copies (.db / .backup.db) taken before now keep their old ciphertext and are \
         NOT re-encrypted by this command; they were already readable only with the key that \
         sealed them."
    );
    Ok(())
}

#[cfg(test)]
#[path = "rekey_tests.rs"]
mod tests;
