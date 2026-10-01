//! The settings CORE: ungated business logic over a plain `&Connection`.
//!
//! Every function here takes a connection instead of a [`crate::ctx::BridgeCtx`],
//! which is what lets the test suite exercise the production path without
//! standing up a session. The `async` command layer in [`super`] is a thin
//! wrapper: it locks the DB and calls one of these.
//!
//! Main entry points: [`run_get_setting`], [`run_set_setting`],
//! [`run_set_settings_batch`], [`enqueue_settings_updates`],
//! [`run_get_receipt_settings`], [`run_get_store_settings`].
//!
//! Invariant: the sync-egress policy is enforced at ENQUEUE time
//! (`remote_sync_admits`), not at write time - a refused key is warned about and
//! the batch continues, so one un-syncable setting cannot fail a whole save.

use std::collections::HashMap;

use kasirmu_core::export::email_report::SMTP_CONFIG_SETTINGS_KEY;
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};
use kasirmu_core::{Settings, Store};
use platform_core::settings::Settings as TrackedSettings;

use crate::error::BridgeError;

use super::dto::{CreditSaleDto, ReceiptSettingsDto, StoreSettingsDto};
use super::{is_secret_key, managed_key_owner};

/// Business logic for get_receipt_settings (extracted for testing).
pub fn run_get_receipt_settings(
    conn: &rusqlite::Connection,
) -> Result<ReceiptSettingsDto, BridgeError> {
    Ok(ReceiptSettingsDto {
        show_currency: Settings::get_receipt_show_currency(conn)?,
        decimal_separator: Settings::get_receipt_decimal_separator(conn)?,
        show_tax: Settings::get_receipt_show_tax(conn)?,
        footer: Settings::get_receipt_footer(conn)?,
        paper_width: Settings::get_receipt_paper_width(conn)?,
        show_table_number: Settings::get_receipt_show_table_number(conn)?,
        margin_top: Settings::get_receipt_margin_top(conn)?,
        margin_bottom: Settings::get_receipt_margin_bottom(conn)?,
        margin_left: Settings::get_receipt_margin_left(conn)?,
        margin_right: Settings::get_receipt_margin_right(conn)?,
        tax_rounding_mode: Some(
            Settings::get_tax_rounding_mode(conn)?
                .wire_name()
                .to_string(),
        ),
    })
}

/// Business logic for get_store_settings (extracted for testing).
pub fn run_get_store_settings(
    conn: &rusqlite::Connection,
) -> Result<StoreSettingsDto, BridgeError> {
    Ok(StoreSettingsDto {
        name: Settings::get_store_name(conn)?.unwrap_or_default(),
        address: Settings::get_store_address(conn)?.unwrap_or_default(),
        tax_id: Settings::get_store_tax_id(conn)?.unwrap_or_default(),
        currency: Settings::get_default_currency(conn)?.unwrap_or_else(|| "IDR".into()),
        branch: Settings::get_store_branch(conn)?.unwrap_or_default(),
        logo: Settings::get_store_logo(conn)?.unwrap_or_default(),
    })
}

/// Business logic for listing credit sales (extracted for testing).
pub fn run_list_credit_sales(
    conn: &rusqlite::Connection,
) -> Result<Vec<CreditSaleDto>, BridgeError> {
    // ⚠️ MEASURED MISMATCH, deliberately not repaired here. Index 1 of this
    // projection is `p.gateway_reference`, and it lands in `customer_name`; the
    // retail credit list renders that field in a column headed Customer
    // (the retail credit-list modal), so an operator
    // currently reads the payment gateway's own reference where the buyer's name
    // belongs. `customers.name` exists and this projection does not join it.
    //
    // Not fixed in place because which column a customer name should come from is
    // a product ruling, not a repair, and this wire was already repaired once
    // under this name (2026-09-15). The record is docs/records/JOURNAL.md
    // (2026-10-04) and commit a3c871787; the behaviour is pinned by
    // `the_credit_sale_projection_maps_gateway_reference_into_the_customer_column`
    // in settings_tests.rs, and the tree-wide check is
    // scripts/check-mapper-alignment.py, which reports this one entry on every run
    // as acknowledged. Change the SELECT and both go red, which is the point.
    let mut stmt = conn.prepare(
        "SELECT s.id, p.gateway_reference, s.total_minor, s.currency, s.created_at,
                p.settled_at, COALESCE(u.display_name, '')
         FROM sales s
         JOIN payments p ON p.sale_id = s.id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.status = 'completed'
           AND p.method = 'credit'
         ORDER BY s.created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CreditSaleDto {
            sale_id: row.get(0)?,
            customer_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            total_minor: row.get(2)?,
            currency: row.get(3)?,
            created_at: row.get(4)?,
            settled_at: row.get(5)?,
            cashier_name: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Business logic for get_setting (extracted for testing).
///
/// C-2: Secret keys are denied - never return plaintext credentials,
/// API keys, passwords, or PSKs to the IPC surface.
pub fn run_get_setting(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<Option<String>, BridgeError> {
    if is_secret_key(key) {
        return Ok(None);
    }
    Ok(Settings::get(conn, key)?)
}

/// Business logic for set_setting (extracted for testing).
/// Uses set_tracked so every settings change writes a delta record (ADR #22).
///
/// `smtp_config` is the one key that cannot be written verbatim. It is on the
/// credential deny list, so [`run_get_setting`] refuses it and the email-report
/// card can never load the stored password back; its save posts a whole blob
/// whose `password` is null, and a raw write of that blob destroyed the secret
/// on every save. The key's owner, `kasirmu_core::export::email_report`, answers
/// "what should actually land" and the answer is written through the SAME
/// tracked path, so the ADR #22 delta still records the change.
///
/// Returns the value AS WRITTEN — the merged blob for `smtp_config`, the
/// input verbatim for every other key. The command enqueues exactly this for
/// replication (SYNC-10): a row that is not what we would have written is
/// never offered to the network, so the enqueue does not depend on
/// `remote_sync_admits` (private to this module) refusing `smtp_config` to
/// keep a passwordless
/// re-post of the stored secret from shipping.
///
/// The credential refusal is asked HERE, of platform-core, before the tracked
/// write — the same question and wording [`run_set_settings_batch`]
/// pre-flights with. Left to the funnel alone, platform-core refuses with
/// `PlatformError::Internal`, which crosses as `BridgeError::Core { sub_kind:
/// Internal }` while the batch door raises the identical words as
/// `BridgeError::Invalid` — one key, one sentence, two error classes
/// depending on which door was pressed. A refused credential is a caller
/// error, not an internal fault, so this door raises `Invalid` too; the
/// message stays platform-core's (one owner of the text) and names the key,
/// never the value.
pub fn run_set_setting(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
    terminal_id: &str,
) -> Result<String, BridgeError> {
    // The manager door, ASKED of platform-core: the rule and the wording are
    // the producer there (`manager_owned_key_refusal`); this lane supplies only
    // the manager NAME it can look up and chooses the variant. Restating the
    // sentence here is what
    // `both_shell_lanes_take_the_manager_refusal_from_its_one_producer` fails on.
    if let Some(refusal) = TrackedSettings::manager_owned_key_refusal(key, managed_key_owner(key)) {
        return Err(BridgeError::Invalid(refusal));
    }
    // The credential door, ASKED of platform-core before the tracked write —
    // the same pre-flight the batch loop runs, so the refusal crosses as
    // `BridgeError::Invalid` on both doors with platform-core's one wording.
    // `set_tracked` below still refuses per row; that is the floor under this
    // ask, not a substitute for the variant it would have produced.
    if let Some(refusal) = TrackedSettings::cleartext_credential_refusal(key) {
        return Err(BridgeError::Invalid(refusal));
    }
    let merged;
    let value = if key == SMTP_CONFIG_SETTINGS_KEY {
        merged = Store::new(conn).merged_smtp_password_json(value)?;
        &merged
    } else {
        value
    };
    Settings::set_tracked(conn, key, value, terminal_id)?;
    Ok(value.to_string())
}

/// Business logic for the `set_settings_scoped` batch write (extracted for
/// testing). The command owns the transaction; this is the loop that runs
/// inside it — which is WHY it takes `&rusqlite::Transaction` and not
/// `&Connection`: the same shape as `Store::log_audit_in_tx` and
/// `Settings::set_batch_with_policy`, so a lane that already holds a
/// transaction cannot open a nested one by calling this.
///
/// It is the SECOND door into the settings table. `run_set_setting` guards
/// manager-owned keys and merges `smtp_config`, but this loop used to call
/// `Settings::set_tracked` directly, so a batch write reached the row with
/// neither guard — and `smtp_config` is deny-listed against
/// [`run_get_setting`], so the email-report card can never read the stored
/// password back and posts a blob whose `password` is null. Both halves of
/// the funnel therefore live here: the same manager-key refusal, and the
/// same `merged_smtp_password_json` seam the single write asks.
///
/// It does NOT call `Settings::set_tracked` — the bare-connection door — and
/// must not: that wrapper opens its own `unchecked_transaction` (BEGIN
/// DEFERRED), and a second BEGIN inside the caller's transaction fails with
/// "cannot start a transaction within a transaction" — the class documented at
/// `crates/kasirmu-bridge/src/setup.rs:100-106`. Confirmed at runtime by
/// `batch_funnel_runs_inside_the_commands_own_outer_transaction`. What it calls
/// instead is the in-transaction form of the very same body,
/// `platform_core::settings::Settings::set_tracked_in_tx`, which takes the
/// caller's `&rusqlite::Transaction` rather than opening one — the
/// `log_audit_in_tx` / `Settings::set_batch_with_policy` shape. So the refusal,
/// the value write and the delta write (non-fatal, exactly as in
/// `set_tracked`) are performed by platform-core, inside this transaction.
///
/// That is the whole reason the in-tx form exists. c80b7f7dd got the batch
/// working by doing the two write halves by hand AND restating the credential
/// rule — `is_secret_setting_key(k) && *k != SMTP_CONFIG_SETTINGS_KEY` —
/// because the refusal it was duplicating is private in platform-core. One
/// policy, two definitions, and the drift is silent: the day the exception
/// changes, one lane keeps refusing and the other starts accepting. Both
/// copies are gone now: this lane asks platform-core the question
/// (`TrackedSettings::cleartext_credential_refusal`, which returns the refusal
/// message or `None`) and hands every row to `set_tracked_in_tx`. The
/// exception constant is no longer named in this crate at all.
///
/// Both refusals are batch-wide and happen BEFORE any write — the manager-key
/// check always was, and the cleartext-credential check stays batch-wide even
/// though `set_tracked_in_tx` also refuses per row, because a per-row refusal
/// writes the earlier rows first. Batch-wide pre-flight is what the command's
/// documented all-or-nothing semantics require: one bad key aborts the batch,
/// it does not quietly drop that one entry, and it cannot leave rows already
/// written behind. `batch_write_refuses_a_deny_listed_credential_key` pins it.
///
/// Returns the values AS WRITTEN, keyed by key — the map the command hands to
/// [`enqueue_settings_updates`], so the replication payload carries the merged
/// `smtp_config` blob rather than the passwordless one the client posted. A
/// row that is not what we would have written is not offered.
pub fn run_set_settings_batch(
    tx: &rusqlite::Transaction<'_>,
    entries: &HashMap<String, String>,
    terminal_id: &str,
) -> Result<HashMap<String, String>, BridgeError> {
    // Batch-wide and BEFORE any write, like the credential pre-flight under it.
    // One offender aborts the batch. The wording comes from the producer in
    // platform-core, the label from the lookup this lane owns, and the variant
    // is chosen here.
    for key in entries.keys() {
        if let Some(refusal) =
            TrackedSettings::manager_owned_key_refusal(key, managed_key_owner(key))
        {
            return Err(BridgeError::Invalid(refusal));
        }
    }
    // The credential door, ASKED of platform-core rather than restated here.
    // Batch-wide and BEFORE any write, as the command's all-or-nothing promise
    // requires; the wording is platform-core's own, so a refusal says the same
    // thing whichever door raised it, and it names the key and never the
    // value. `set_tracked_in_tx` below refuses per row too — that is the floor
    // under this pre-flight, not a substitute for it.
    for key in entries.keys() {
        if let Some(refusal) = TrackedSettings::cleartext_credential_refusal(key) {
            return Err(BridgeError::Invalid(refusal));
        }
    }
    let store = Store::new(tx);
    let mut written = HashMap::with_capacity(entries.len());
    for (key, value) in entries {
        let merged;
        let value = if key == SMTP_CONFIG_SETTINGS_KEY {
            merged = store.merged_smtp_password_json(value)?;
            &merged
        } else {
            value
        };
        // The tracked write, done IN the caller's transaction by the door that
        // owns it: no BEGIN here, and no restated predicate here. Mapped
        // through `CoreError` so a write failure keeps the exact error shape
        // this loop had when it called `Settings::set` itself.
        TrackedSettings::set_tracked_in_tx(tx, key, value, terminal_id)
            .map_err(kasirmu_core::CoreError::from)?;
        written.insert(key.clone(), value.to_string());
    }
    Ok(written)
}

/// Enqueue one settings.update sync item per changed key (SYNC-10).
///
/// Delegates to Store::enqueue_settings_update_superseding (kasirmu-core), which owns the
/// settings.update wire contract: payload shape, Low priority, and
/// supersede-any-pending-same-key semantics. Callers enqueue on the GLOBAL db (the
/// sync daemon only watches the global queue), never the store db the value was written to.
///
/// Egress gate: a key that the ingest side would refuse is not offered to the
/// network either. Both directions ask the SAME sealed
/// [`IngestPolicy::RemoteSync`] through `remote_sync_admits` (private to this
/// module), so a locally
/// written credential (the write-side check at [ `run_set_setting` guards only
/// the manager prefixes, and the read side at [`run_get_setting`] guards the
/// deny list) can no longer replicate in cleartext to every peer in the tenant.
/// A refused key is warned about and skipped — never an error, because the
/// caller treats a failed enqueue as non-fatal already, and the warn names the
/// key and the policy, never the value.
///
/// Callers must pass the values AS WRITTEN (what [`run_set_setting`] and
/// [`run_set_settings_batch`] return), not the request as posted: a row that
/// is not what we would have written is not offered to the network.
///
/// This is the one settings leg that had no guard at all: reads refused the deny
/// list, writes refused the manager prefixes, and the enqueue carried anything.
pub fn enqueue_settings_updates(
    store: &Store,
    entries: &HashMap<String, String>,
    terminal_id: &str,
    tenant_id: &str,
) -> Result<(), BridgeError> {
    for (key, value) in entries {
        if !remote_sync_admits(key) {
            warn_refused_settings_key(key);
            continue;
        }
        store.enqueue_settings_update_superseding(key, value, terminal_id, tenant_id)?;
    }
    Ok(())
}

/// The ONE remote-replication gate for this lane.
///
/// Delegates to the sealed [`IngestPolicy::RemoteSync`] owned by platform-core
/// (re-exported through `kasirmu_core::settings`, so no new dependency edge). Used by
/// [`enqueue_settings_updates`], the single egress funnel for all three
/// settings-write commands in this module.
///
/// Symmetric with the ingest gate in `platform_sync::queue`: a key that cannot
/// be APPLIED from the network must not be OFFERED to the network either, or the
/// two halves would disagree exactly the way the two shell deny lists did.
pub(in crate::settings) fn remote_sync_admits(key: &str) -> bool {
    IngestPolicy::RemoteSync.admits(key)
}

/// Warn for one key refused on the replication egress. Key and policy only.
pub(in crate::settings) fn warn_refused_settings_key(key: &str) {
    tracing::warn!(
        key = %key,
        policy = IngestPolicy::RemoteSync.label(),
        "settings key refused by sync egress policy (not enqueued, batch continues)"
    );
}
