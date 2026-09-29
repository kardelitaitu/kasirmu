//! The LIVE-`settings` half of `oz credential-deltas` — read only, never a write.
//!
//! Split out of `credential_deltas.rs` at the seam the command's own report
//! already draws: `---- 1 of 2: LEDGER ----` is DELETABLE history, `---- 2 of 2:
//! LIVE SETTINGS ----` is the value the app is using right now. The two halves
//! answer different questions, are counted separately and are never added
//! together, so they do not belong in one file — and while they shared one, the
//! guarantee that "no flag deletes a settings row" could only be checked by
//! reading the whole file to be sure no DELETE had crept in. Here every
//! statement that mentions `settings` is one of the two SELECTs below; there is
//! no DELETE, UPDATE or INSERT against it in this module at all.
//!
//! Nothing in this module writes. The ledger half (scan, purge, the shared name
//! resolver, the operator-facing help) stays in the sibling `credential_deltas`,
//! and `require_store_database` — which guards both halves — stays there too.

use anyhow::{Context, Result};
use rusqlite::Connection;

use kasirmu_core::settings::keys::SECRET_KEY_DENY_LIST;

use super::credential_deltas::canonical_credential_key;

/// The live table the settings census READS and never writes. Named here so the
/// only settings statement this command builds is visible in one place: there is
/// no DELETE against it at all, under any flag.
pub(crate) const SETTINGS_TABLE: &str = "settings";

/// The derived form of one stored credential value, as far as a tool that does
/// not hold the plaintext can honestly say.
///
/// Indeterminate is PRINTED rather than resolved into a reassuring default: the
/// value column is bare TEXT with no discriminator of any kind (see the module
/// header, and the census in crates/kasirmu-core/tests/credential_storage_form.rs
/// which measures exactly that), so a report that guessed would be the lie this
/// command exists to avoid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StoredForm {
    /// A crypto family owns the key and AUTHENTICATED the value.
    Encrypted,
    /// A family owns the key and this value is not its ciphertext: a LEGACY row,
    /// written before the family sealed that key (e105109f6, 2026-08-29, whose
    /// setters pass legacy plaintext through on purpose) and never re-saved.
    LegacyPlaintext,
    /// A family owns the key, the shape says ciphertext, authentication failed.
    Invalid,
    /// No crypto family owns the key, so nothing at all can be asked of the value.
    Indeterminate,
    /// Sealed by a MACHINE-BOUND family: the key material is the installation
    /// fingerprint, which this tool will not read. The row is UNTESTED, neither
    /// cleartext nor safe. license.api_key is the live case, and it is the
    /// credential a real install is most likely to hold,
    MachineBoundUntested,
    /// No family in this build can seal this key, so the value is cleartext by
    /// construction rather than by inspection. Kept separate from Indeterminate
    /// because the two say different things: this one is a measured claim about
    /// the table, that one is an admission about the tool.
    UnsealableCleartext,
}

impl StoredForm {
    fn label(self) -> &'static str {
        match self {
            StoredForm::Encrypted => "encrypted",
            StoredForm::LegacyPlaintext => "LEGACY-PLAINTEXT",
            StoredForm::Invalid => "INVALID-CIPHERTEXT",
            StoredForm::Indeterminate => "undeterminable(cannot be opened here)",
            StoredForm::UnsealableCleartext => "CLEARTEXT(no family can seal this key)",
            StoredForm::MachineBoundUntested => "UNTESTED-BY-THIS-TOOL(machine-bound family)",
        }
    }

    /// The forms that positively state the value sits in cleartext. INVALID,
    /// INDETERMINATE and MACHINE-BOUND-UNTESTED are all excluded: none of the three
    /// is a claim about the bytes, and folding any of them in would inflate the
    /// headline with rows this tool has not actually read.
    pub(crate) fn is_cleartext(self) -> bool {
        matches!(
            self,
            StoredForm::LegacyPlaintext | StoredForm::UnsealableCleartext
        )
    }
}

/// The decrypt half of a crypto family: the only question answerable about a
/// value without knowing its plaintext.
type FamilyDecrypt = fn(&str) -> Result<String, kasirmu_core::crypto::CryptoError>;

/// Every family kasirmu-crypto exposes, enumerated because the blind spot this closes
/// is a mislabelled family: license.api_key used to read CLEARTEXT, no family can
/// seal this key, while crates/kasirmu-bridge/src/license.rs:151 encrypts it with the
/// installation machine id. A label that is not evidence is the same defect as a
/// check that stays silent.
///
///   PORTABLE, derivable in this process with no local state, so ASKED here:
///     sync_api_key          encrypt_sync_api_key          -> SYNC_API_KEY
///     sync_terminal_secret  encrypt_sync_terminal_secret  -> SYNC_TERMINAL_SECRET
///     pg_sync.password      encrypt_pg_sync_password      -> PG_SYNC_PASSWORD
///     rate_sync.api_key     encrypt_rate_api_key          -> RATE_SYNC_API_KEY
///     local_api.secret      encrypt_local_api_secret      -> LOCAL_API_SECRET
///
///   PORTABLE, asked here as of this commit (see why below):
///     lan_server.psk        encrypt_lan_psk               -> LAN_SERVER_PSK
///
///   PORTABLE but not a whole-row secret, so NOT asked here:
///     smtp_at_rest    one FIELD of a JSON blob     encrypt_smtp_at_rest
///     profile_field   not a settings key at all    encrypt_profile_field
///
///   MACHINE-BOUND, needs the installation fingerprint, never derived here:
///     api_key         encrypt_api_key(v, machine_id) -> LICENSE_API_KEY, untested
///     smtp_password   encrypt_smtp_password(v, machine_id) -> no caller left in the
///       tree: that machine-bound family is dead, and smtp_config is written by the
///       portable at-rest family inside its JSON blob, so it is not listed here.
///
/// lan_server.psk is ASKED as of this commit, and the note that used to sit here
/// was wrong twice over, so it is recorded rather than quietly deleted. It claimed
/// the key "answers Indeterminate, which under-claims": it does not. With no family
/// and no other-lane claim it fell through to UnsealableCleartext, so the shipped
/// report asserted "CLEARTEXT(no family can seal this key)" about a row that
/// platform/core/src/settings/typed.rs:645 seals with the portable lan-psk family,
/// and COUNTED that row in the cleartext headline. Measured end to end before this
/// commit on a throwaway store holding a real encrypt_lan_psk ciphertext: the
/// headline read "1 of 2" and the 1 was this row. An over-count on a credential that
/// is actually encrypted is the same defect the machine-bound fix below addresses: a
/// label that is not evidence. Asking is correct HERE because the tool genuinely can
/// tell, which is precisely what it cannot do for a machine-bound row — the reason
/// the two cases get different forms, not the same one.
///
/// local_api.secret is ASKED as of C14(a), and it too used to be listed elsewhere for
/// a reason that was wrong, so the move is recorded rather than quietly made. It sat in
/// `sealed_in_another_lane`, described as "sealed by the bridge". Neither half held: the
/// bridge never sealed it (kasirmu-local-api wrote it with a bare `Settings::set`, so it
/// sat in cleartext), and the Indeterminate answer that produced was a FALSE NEGATIVE —
/// a real cleartext credential that never reached the cleartext headline, because
/// Indeterminate is not cleartext by construction. C14(a) then gave the key a PORTABLE
/// family of its own (`encrypt_local_api_secret`, static-derived, no machine binding),
/// which this process CAN open, so it belongs here. Its legacy form needs one extra
/// guard the other families do not: see `legacy_plaintext_shape`.
///
/// SEPARATED BY KEY, NOT BY BYTES, which is load-bearing for how the form column is
/// read: every portable family uses the SAME envelope, base64url(nonce || ciphertext
/// || tag) with no prefix, no version and no key id (crates/kasirmu-crypto/src/lib.rs:13,
/// 353, 389), so two families sealing the same plaintext emit strings of the SAME
/// LENGTH. Measured in portable_envelopes_agree_so_only_the_key_column_separates: a
/// sync_api_key envelope and a lan_psk envelope of one plaintext are both 56 chars
/// and neither opens with the other's decryptor. The census asks the family that the
/// KEY NAME owns, so a row whose value was sealed by a different portable family
/// reads INVALID-CIPHERTEXT and never "this was written by another key". Nothing in
/// the form column is a statement about which family wrote the bytes.
fn credential_family(key: &str) -> Option<FamilyDecrypt> {
    use kasirmu_core::settings::keys;
    match key {
        keys::SYNC_API_KEY => Some(kasirmu_core::crypto::decrypt_sync_api_key),
        keys::SYNC_TERMINAL_SECRET => Some(kasirmu_core::crypto::decrypt_sync_terminal_secret),
        keys::PG_SYNC_PASSWORD => Some(kasirmu_core::crypto::decrypt_pg_sync_password),
        keys::RATE_SYNC_API_KEY => Some(kasirmu_core::crypto::decrypt_rate_api_key),
        keys::LAN_SERVER_PSK => Some(kasirmu_core::crypto::decrypt_lan_psk),
        keys::LOCAL_API_SECRET => Some(kasirmu_core::crypto::decrypt_local_api_secret),
        _ => None,
    }
}

/// Keys whose family needs the installation fingerprint, read off the
/// MACHINE-BOUND block of the enumeration on `credential_family`: `api_key` is
/// the live one, `smtp_password` has no caller left in the tree. The value is
/// never looked at — the key alone decides, because this tool must not read the
/// fingerprint in order to open tenant credentials.
fn sealed_by_machine_bound_family(key: &str) -> bool {
    use kasirmu_core::settings::keys;
    matches!(key, keys::LICENSE_API_KEY)
}

/// Keys this build cannot open as a whole row even though a family seals PART of
/// them: smtp_config is a JSON envelope whose password FIELD is sealed while the
/// rest of the row is in the clear, so neither "encrypted" nor "cleartext"
/// describes the row and it answers Indeterminate rather than a guess.
///
/// `local_api.secret` used to be listed here too, described as "sealed by the
/// bridge". That claim was wrong twice over and is recorded rather than quietly
/// deleted: the bridge never sealed it (so it sat in cleartext), and the
/// Indeterminate answer it produced hid that cleartext from the headline — a false
/// negative on a live credential. C14(a) gave the key a portable family this
/// process can open, so it moved to `credential_family`, where it is actually asked.
fn sealed_in_another_lane(key: &str) -> bool {
    use kasirmu_core::settings::keys;
    matches!(key, keys::SMTP_CONFIG)
}

/// A local restatement of the PRIVATE kasirmu_crypto::looks_like_ciphertext, copied
/// for the same reason the census copies it: there is no public discriminator to
/// call, which is itself the finding. Used ONLY to split a FAILED decrypt into
/// INVALID (it tried to be ciphertext) versus LEGACY-PLAINTEXT (it never was).
/// It never decides alone that a value is encrypted, because a 44-character
/// base64 plaintext decoy passes it.
fn looks_like_ciphertext_shape(value: &str) -> bool {
    const ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
    // A 12-byte nonce plus a 16-byte tag is 38 base64 characters at minimum.
    value.len() >= 38 && value.chars().all(|c| ALPHABET.contains(c))
}

/// The ONE family whose LEGACY plaintext is itself base64-shaped, so the shape test
/// above would label it INVALID-CIPHERTEXT and drop it out of the cleartext headline —
/// a false negative on a real credential, the exact defect this census exists to
/// prevent. `local_api.secret` is generated as 32 random bytes hex-encoded
/// (kasirmu-local-api/src/lib.rs `new_secret`), so its pre-C14(a) plaintext is exactly
/// 64 lowercase hex characters: length >= 38 and every character inside the base64
/// alphabet, which passes `looks_like_ciphertext_shape`. A real ciphertext for this
/// family is base64url of nonce(12)||payload||tag(16) — for a 64-char plaintext that is
/// 124 chars and NOT all-hex — so the two forms are disjoint on BOTH length and
/// alphabet. This positive test is what keeps a legacy row counted; the family's own
/// decrypt deliberately does not pass legacy plaintext through (kasirmu-crypto/src/lib.rs
/// `decrypt_local_api_secret`), because the crate's shared shape test cannot tell the
/// two apart either.
fn legacy_plaintext_shape(key: &str, value: &str) -> bool {
    use kasirmu_core::settings::keys;
    key == keys::LOCAL_API_SECRET
        && value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Classify one stored value. It reads the value and returns only a form:
/// nothing derived from the value escapes this function.
fn classify_stored_value(key: &str, value: &str) -> StoredForm {
    if sealed_by_machine_bound_family(key) {
        // Decided by KEY, before the value is looked at at all. This tool cannot
        // derive the machine id, and it must not try: a census that reads the
        // installation fingerprint in order to decrypt tenant credentials is a
        // worse instrument than one that under-claims. A plaintext-looking value
        // here is therefore NOT evidence either way, because license.api_key may
        // legitimately be legacy plaintext on an install predating the sealing
        // (license.rs:121 treats a failed decrypt as legacy plaintext, not as an
        // error), and the tool cannot tell those two rows apart. So both are
        // listed and neither is counted.
        return StoredForm::MachineBoundUntested;
    }
    let Some(decrypt) = credential_family(key) else {
        if sealed_in_another_lane(key) {
            return StoredForm::Indeterminate;
        }
        // No family here and none claimed elsewhere: nothing in this build could
        // have sealed the value, which is a statement about the key, not about
        // the bytes. That is why it is not Indeterminate.
        return StoredForm::UnsealableCleartext;
    };
    if value.trim_start().starts_with('{') {
        // A JSON envelope (smtp_config): only the password FIELD inside it is
        // sealed, so neither encrypted nor cleartext describes the row.
        return StoredForm::Indeterminate;
    }
    match decrypt(value) {
        Ok(_) => StoredForm::Encrypted,
        // Before the shape test, because for this one family the legacy plaintext
        // IS base64-shaped and would otherwise be misfiled as INVALID.
        Err(_) if legacy_plaintext_shape(key, value) => StoredForm::LegacyPlaintext,
        Err(_) if looks_like_ciphertext_shape(value) => StoredForm::Invalid,
        Err(_) => StoredForm::LegacyPlaintext,
    }
}

/// One deny-listed key's live settings rows: how many, and in which forms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SettingFormRow {
    pub key: &'static str,
    pub rows: usize,
    pub forms: Vec<(StoredForm, usize)>,
}

/// The whole settings census.
pub(crate) type SettingCounts = Vec<SettingFormRow>;

impl SettingFormRow {
    /// Form labels for the printed line. More than one appears when a key has
    /// several stored spellings in the same table (BINARY collation makes
    /// stripe.api_key and STRIPE.API_KEY two distinct rows), and the disagreement
    /// is shown rather than collapsed away.
    fn form_summary(&self) -> String {
        self.forms
            .iter()
            .map(|(form, count)| {
                if *count == 1 {
                    form.label().to_string()
                } else {
                    format!("{} x{count}", form.label())
                }
            })
            .collect::<Vec<_>>()
            .join(" + ")
    }

    /// Rows of this key that this tool resolved as ENCRYPTED.
    pub(crate) fn encrypted_rows(&self) -> usize {
        self.forms
            .iter()
            .filter(|(form, _)| matches!(form, StoredForm::Encrypted))
            .map(|(_, count)| *count)
            .sum()
    }

    /// Rows of this key that are positively cleartext.
    pub(crate) fn cleartext_rows(&self) -> usize {
        self.forms
            .iter()
            .filter(|(form, _)| form.is_cleartext())
            .map(|(_, count)| *count)
            .sum()
    }
}

/// Census the LIVE settings table for credential rows. READ ONLY.
///
/// It reads key and value, because the value is what a crypto family is asked
/// about, and prints neither: what leaves this function is a canonical key name,
/// a count and a form label. Membership comes through
/// [`canonical_credential_key`] and so through [`is_secret_setting_key`], the
/// SAME shared predicate the ledger count, the write funnel and the read-back
/// use, so this tool holds exactly one fold and no second opinion about what a
/// credential key is. A key the predicate claims but the fold cannot label is an
/// ERROR here too, never a silent skip.
pub(crate) fn scan_credential_settings(conn: &Connection) -> Result<SettingCounts> {
    let mut rows: SettingCounts = Vec::new();
    let sql = format!("SELECT key, value FROM {SETTINGS_TABLE}");
    let mut stmt = conn
        .prepare(&sql)
        .with_context(|| format!("reading the {SETTINGS_TABLE} table"))?;
    let found = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .with_context(|| format!("reading the {SETTINGS_TABLE} table"))?;
    for row in found {
        let (stored, value) = row.context("reading settings rows")?;
        let Some(canonical) = canonical_credential_key(&stored) else {
            continue;
        };
        let form = classify_stored_value(canonical, &value);
        if !rows.iter().any(|r| r.key == canonical) {
            rows.push(SettingFormRow {
                key: canonical,
                rows: 0,
                forms: Vec::new(),
            });
        }
        // INVARIANT: the `any`/`push` pair above guarantees a row whose `key` equals
        // `canonical` exists before this lookup runs. `canonical` is a Copy
        // `&'static str` and both comparisons are the same predicate on the same value,
        // `rows` is a local `Vec`, and nothing between the push and this `find` removes,
        // re-keys or re-sorts a row (the sort is after the loop). So the `Option` cannot
        // be `None`; reaching the panic would mean the two predicates had drifted apart,
        // a programming error inside these ten lines rather than a runtime state (ADR #33).
        let entry = rows
            .iter_mut()
            .find(|r| r.key == canonical)
            .expect("row pushed immediately above");
        entry.rows += 1;
        match entry.forms.iter_mut().find(|(known, _)| *known == form) {
            Some((_, count)) => *count += 1,
            None => entry.forms.push((form, 1)),
        }
    }
    // Deny-list order, so the two blocks list the same keys in the same order.
    rows.sort_by_key(|row| {
        SECRET_KEY_DENY_LIST
            .iter()
            .position(|key| *key == row.key)
            .unwrap_or(usize::MAX)
    });
    Ok(rows)
}

/// Total live rows across the census.
pub(crate) fn total_settings_rows(rows: &SettingCounts) -> usize {
    rows.iter().map(|row| row.rows).sum()
}

/// Rows positively resolved as ENCRYPTED: the family named by the key column
/// opened the value. Only ever true for a portable family, which is why asking
/// lan_server.psk moved a row into this bucket instead of leaving it asserted.
pub(crate) fn total_encrypted_rows(rows: &SettingCounts) -> usize {
    rows.iter()
        .map(|row| {
            row.forms
                .iter()
                .filter(|(form, _)| matches!(form, StoredForm::Encrypted))
                .map(|(_, count)| *count)
                .sum::<usize>()
        })
        .sum()
}

/// Rows EXCLUDED from the cleartext headline: neither claimed cleartext nor
/// resolved encrypted, i.e. INVALID, Indeterminate or MachineBoundUntested.
/// Deliberately NOT "everything that is not cleartext": asking lan_server.psk made
/// the first encrypted row exist, and subtracting cleartext from the total would
/// have filed a row this tool PROVED as encrypted under "unresolved", which is the
/// same confidence-in-the-wrong-direction this file keeps being about.
pub(crate) fn total_excluded_rows(rows: &SettingCounts) -> usize {
    rows.iter()
        .map(|row| row.rows - row.cleartext_rows() - row.encrypted_rows())
        .sum()
}

/// Rows listed but explicitly NOT tested, because a machine-bound family holds
/// the only key that would answer the question.
pub(crate) fn total_untested_rows(rows: &SettingCounts) -> usize {
    rows.iter()
        .map(|row| {
            row.forms
                .iter()
                .filter(|(form, _)| matches!(form, StoredForm::MachineBoundUntested))
                .map(|(_, count)| *count)
                .sum::<usize>()
        })
        .sum()
}

/// The headline of the settings block: live rows that are POSITIVELY cleartext.
/// Undeterminable rows are not folded into it; they are printed beside it, so
/// the size of the unknown is visible instead of implied.
pub(crate) fn total_cleartext_rows(rows: &SettingCounts) -> usize {
    rows.iter().map(SettingFormRow::cleartext_rows).sum()
}

/// Render the settings census in the SAME line shape as the ledger block,
/// right-aligned count then the key, with a form column appended, so an operator
/// comparing the halves is reading one format twice. No value appears.
pub(crate) fn format_setting_counts(rows: &SettingCounts) -> Vec<String> {
    rows.iter()
        .map(|row| {
            format!(
                "{:>6} row(s)  key = {}  form = {}",
                row.rows,
                row.key,
                row.form_summary()
            )
        })
        .collect()
}

/// What EXCLUDED means, printed whenever the excluded count is not zero.
pub(crate) const EXCLUDED_ROWS_NOTE: &str = concat!(
    "An EXCLUDED row is listed and NOT asserted. Three forms are excluded, each for ",
    "its own reason: INVALID (ciphertext-shaped, but it would not authenticate, so either ",
    "tampering or a plaintext that merely looks like base64), undeterminable (sealed by a ",
    "lane this build cannot open), and UNTESTED-BY-THIS-TOOL (a machine-bound family holds ",
    "the key, and this tool will not read the installation fingerprint to get it). A ",
    "NON-ZERO excluded count is the normal case, not a clean bill of health: an excluded ",
    "row may well be cleartext, and the tool is saying it cannot tell, which is NOT the ",
    "same as saying it is sealed."
);

/// Why a LEGACY-PLAINTEXT verdict on one of the four sealed keys is not an
/// incident: the at-rest encryption arrived on 2026-08-29 (e105109f6) and the
/// setters pass a legacy plaintext value straight through, so a row written
/// before that date and never re-saved is still cleartext at rest today,
/// indefinitely. Only the FORM separates that from a live bug, which is the
/// reason the census prints the form instead of a single yes/no.
pub(crate) const LEGACY_PLAINTEXT_NOTE: &str = concat!(
    "A LEGACY-PLAINTEXT form on a key that HAS a crypto family (sync_api_key, ",
    "sync_terminal_secret, pg_sync.password, rate_sync.api_key, lan_server.psk) is a ",
    "row written before ",
    "2026-08-29 and never re-saved, not a current bug: the encrypting setters pass legacy ",
    "plaintext through on purpose. A cleartext form on any OTHER listed key means nothing in ",
    "this build can seal it at all. The two read alike and mean different things — one is an ",
    "incident, the other is hygiene — and only the form tells you which you are looking at."
);
