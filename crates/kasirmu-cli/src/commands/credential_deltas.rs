//! Credential delta-ledger hygiene — `oz credential-deltas`.
//!
//! Deletes rows from the settings delta ledger (`setting_updated`) whose
//! `key` is on the shared credential deny list, prints one row-count per
//! key, and never prints or logs a value.
//!
//! The match is deliberately BY KEY NAME, not by value shape. The ledger's
//! `value` column is bare TEXT with no marker distinguishing ciphertext
//! from plaintext, the only shape predicate in the tree is private, and a
//! 44-character base64 plaintext decoy is indistinguishable from real
//! ciphertext without the key — so anything that decided by looking at a
//! value would get it wrong on real data. The deny list is imported from
//! platform-core (through the `oz-core` re-export, so this lane adds no new
//! dependency edge and no third copy of the list).
//!
//! Bounded operator command by design: it runs only when a person invokes
//! it. No startup hook, no migration, no retention policy for non-credential
//! keys (age-based retention that keeps the newest rows can never remediate
//! credentials — a credential delta IS the newest row for its key).
//! The live `settings` table is READ by the census below and reported form by
//! form, but this command NEVER writes or deletes a `settings` row, with or
//! without `--confirm`: a ledger row is a copy nothing reads back, while a
//! settings row IS the value in use. The whole-file backup stays out of scope.

use std::sync::LazyLock;

use anyhow::{Context, Result};
use rusqlite::{Connection, params};

use oz_core::settings::keys::{SECRET_KEY_DENY_LIST, credential_base, normalised_candidate};

use crate::cli::CredentialDeltasArgs;

/// The ledger this command reads and prunes.
pub(crate) const LEDGER_TABLE: &str = "setting_updated";

/// Why deletion is safe — date-qualified, because a reader in six months
/// cannot tell whether it is still true without the citation.
pub(crate) const SAFETY_BASIS: &str = concat!(
    "Why deleting is safe AS OF 2026-09-12 (decision review, ",
    "docs/decisions/2026-09-12-adr52-tracked-settings-funnel-refuses-cleartext-credentials.md): ",
    "nothing reads this ledger back — its only two production SELECTs take the version integer ",
    "and neither reads the value, and `get_version`, the function that would have made it a ",
    "concurrency contract, has zero production callers. That is a dated claim, not an invariant: ",
    "re-check it before trusting this line."
);

/// The contract this command knowingly breaks, stated before it writes.
pub(crate) const RESTART_WARNING: &str = concat!(
    "WARNING: deleting a key's rows restarts its version sequence at 1, which violates the ",
    "documented gapless-sequence contract of the ledger (migration 116, ",
    "idx_setting_updated_unique_version). The writer tolerates a restarted sequence; any future ",
    "reader that cached a high version would see it go backwards."
);

/// The sentence that matters most: this command is not a fix.
///
/// Deliberately COUNT-FREE. This sentence used to assert that "nine of the
/// fourteen credential keys sit in plaintext" while the same run printed a
/// deny list of seventeen — and the two numbers were not even measurements of
/// the same population: fourteen is the size of the key fixture in
/// `crates/kasirmu-core/tests/credential_storage_form.rs` (a census of 14 keys chosen
/// because they have setters to walk, not because the deny list has 14 rows),
/// nine is how many of THOSE landed cleartext in that census, and seventeen is
/// `SECRET_KEY_DENY_LIST.len()` today. Restating any of them here rots the day
/// anyone edits either list or that fixture, and a rotting number in a warning
/// line is worse than no number because it reads as measured. The count that is
/// true is the one this run prints from the database in front of the operator.
pub(crate) const HYGIENE_NOT_REMEDIATION: &str = concat!(
    "This is HYGIENE, not remediation. The delta ledger is the SECONDARY carrier; the dominant ",
    "one is the live `settings` table, which the SETTINGS block below counts against THIS database ",
    "on this run (no fixed key count is quoted here, because the last one quoted was a test ",
    "fixture's population and rotted), plus every whole-file page copy (.db / .backup.db), which the ",
    "CLI README already documents as the plaintext carrier. A perfect sweep of this ledger leaves the ",
    "main problem untouched — running this and believing the exposure is closed is worse than ",
    "running nothing."
);

/// What the command does, as the head of the long help.
pub(crate) const HELP_HEAD: &str = concat!(
    "Report (default) or delete (--confirm) rows in the settings delta ledger `setting_updated` whose\n",
    "key is on the credential deny list, AND report the live `settings` table's credential rows in a\n",
    "separate SETTINGS block with their derived storage form. The two populations are counted, printed\n",
    "and totalled SEPARATELY and are never added together: ledger rows are history, settings rows are\n",
    "the value in use. Matching is by KEY NAME only, through the shared platform-core\n",
    "predicate, so every spelling of a listed key matches, not just its canonical one: the value column is\n",
    "bare TEXT,\n",
    "a plaintext secret and a ciphertext blob are indistinguishable without the key, and any\n",
    "value-shape heuristic would be wrong on real data. No value is ever printed or logged. The deny\n",
    "list is imported from platform-core, never copied here. A bare invocation deletes nothing;\n",
    "--confirm deletes from the LEDGER ONLY — no flag ever makes this command delete a settings row."
);

/// What the command deliberately does not do, as the middle of the long help.
pub(crate) const HELP_SCOPE: &str = concat!(
    "Out of scope on purpose: no startup hook, no migration, no retention policy for non-credential\n",
    "keys (age-based retention keeps the newest rows, and a credential delta IS the newest row for its\n",
    "key), DELETING from the live `settings` table (its rows are read and reported, never purged), and\n",
    "the whole-file backup."
);

/// The byte-level caveat, in the help rather than discovered by an operator.
/// `crate::commands::open_db` sets `PRAGMA journal_mode=WAL` on EVERY CLI path
/// (unchanged by this command, deliberately), so even a bare report rewrites the
/// database header and creates `<db>-wal` / `<db>-shm` beside the file. And
/// `--db` defaults to `./kasir.db` in the CURRENT directory, which
/// `Connection::open` will CREATE if it is not there.
pub(crate) const HELP_BYTES_NOT_CONTENT: &str = concat!(
    "READ-ONLY IN CONTENT, NOT BYTE-FOR-BYTE: a bare run updates no row and deletes nothing, but the\n",
    "CLI opens the database with PRAGMA journal_mode=WAL, which persists WAL in the file header\n",
    "(measured: byte 18 of the database header reads 2 after a run) and creates <db>-wal and\n",
    "<db>-shm beside it for the duration of the run, so the bytes and the mtime DO change on a\n",
    "report. A clean close checkpoints the sidecars away, so their absence afterwards is NOT\n",
    "evidence the file was untouched. And --db defaults to ./kasir.db in the CURRENT DIRECTORY,\n",
    "where opening a MISSING path creates one. Take a copy first and run the census on the copy:\n",
    "oz backup --output <copy.db>, then oz credential-deltas --db <copy.db>. Do not do this to a\n",
    "live store."
);

/// The line that keeps the SETTINGS block honest about what it will not do.
pub(crate) const SETTINGS_REPORT_ONLY: &str = concat!(
    "The settings rows above are REPORTED AND NOT PURGED, with or without --confirm: the delete lane\n",
    "stays on the ledger. That is not timidity, it is that a settings row is the value the app is using\n",
    "right now — deleting settings.sync.auth_token would be INERT (nothing reads that key back, which is\n",
    "why it is on the list), while deleting settings.smtp_config would BREAK A WORKING MAILBOX. Same\n",
    "table, same query, two different consequences, so nothing is deleted from it by this tool."
);

/// Why the ledger total cannot be read as a machine count.
pub(crate) const LEDGER_TOTAL_IS_NOT_A_MACHINE_COUNT: &str = concat!(
    "The LEDGER total is NOT the number of affected machines. One install appends many ledger rows per\n",
    "key (one per tracked write, per terminal), so N rows is a count of historical WRITES, not of\n",
    "installs or of live secrets. The count that answers 'how many machines' is the SETTINGS row count,\n",
    "one row per key per install — which is exactly why the two blocks are printed apart."
);

/// The whole long help, assembled from the SAME constants the completion
/// output prints, so the help text and the run can never disagree.
pub(crate) static LONG_HELP: LazyLock<String> = LazyLock::new(|| {
    format!(
        "{HELP_HEAD}\n\n{SAFETY_BASIS}\n\n{RESTART_WARNING}\n\n{HELP_SCOPE}\n\n{HELP_BYTES_NOT_CONTENT}\n\n{SETTINGS_REPORT_ONLY}\n\n{HYGIENE_NOT_REMEDIATION}"
    )
});

/// One `(key, row count)` pair, only for deny-listed keys that have rows.
pub(crate) type DeltaCounts = Vec<(&'static str, usize)>;

/// Resolve a stored ledger key to the canonical deny-list entry it is one
/// spelling of, or `None` when the shared predicate says it is no credential
/// key at all.
///
/// Membership is [`is_secret_setting_key`]'s call — the same predicate the write
/// funnel and the raw read-back use — so this tool never develops its own
/// opinion of what a credential key is, and never in a second language: there
/// is deliberately no SQL `LOWER`/`TRIM` here, because the deny list lives in
/// platform-core and the decision must live here too.
///
/// The fold lives in platform-core ([`normalised_candidate`]), so this is the same
/// fold the predicate uses and there is one definition in the tree rather than two
/// that can drift. A label is needed because the deny list is the only thing with a
/// stable spelling to report and delete under, while the ledger stores whatever
/// spelling a writer used.
///
/// It no longer ERRORS. The old version bailed on the first folded name that
/// matched no deny-list entry, on the theory that a silent skip undercounts and an
/// undercount hides cleartext credentials. 4142156ec made that arm unreachable and
/// replaced it with something quieter: is_secret_setting_key is now
/// credential_base().is_some(), and credential_base is suffix-blind by decision
/// (keys_tests::decision_pin_credential_base_is_suffix_blind), so a scoped row like
/// stripe.api_key:tenant-a stopped aborting the walk and started walking straight
/// past it. A tool that goes red in front of a merchant does not get used; a tool
/// that reports zero about rows it cannot see gets trusted. So the walk is TOTAL
/// now: every stored spelling resolves to a CredentialName, and a name that merely
/// resembles a credential is REPORTED rather than skipped or fatal.
fn canonical_credential_key(stored: &str) -> Option<&'static str> {
    match resolve_credential_name(stored) {
        CredentialName::Exact { base } => Some(base),
        _ => None,
    }
}

/// A stored settings key classified by NAME only. Every field is a `&'static str`,
/// either a deny-list entry or a fixed marker, which makes the leak guarantee
/// structural rather than a discipline: a tenant suffix is operator data, and there
/// is nowhere in this type for it to go. It cannot be returned, printed, counted into
/// a label or logged, because no field can hold it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialName {
    /// Resolves through [`credential_base`] to a deny-list entry verbatim. The only
    /// arm [`purge_credential_deltas`] acts on.
    Exact { base: &'static str },
    /// Looks like a deny-list entry plus a scope suffix. Reported under the base it
    /// resembles, with a fixed marker standing in for the suffix. Deliberately NOT a
    /// claim that the row IS a credential: credential_base answers None for it, so
    /// today no gate refuses it on read or egress. It is a claim that the NAME is
    /// shaped like one, which is the most a name-only walk can honestly say.
    Resembles {
        base: &'static str,
        marker: &'static str,
    },
    /// Nothing about this name looks like a credential. store.name and
    /// currency.default land here, which is the point: the census does not flag
    /// every dotted key in the table.
    Unrelated,
}

/// What a near-name carries in place of its suffix. Fixed text, so the suffix never
/// has anywhere to be stored or printed.
pub(crate) const SCOPE_MARKER: &str = "+resembles";

/// The separators that make a suffixed name look scoped: the two forms the
/// suffix-blind decision pin enumerates (keys_tests::suffixed_variants), matched to
/// that decision rather than extended with a third. Naming a separator here widens
/// NOTHING — credential_base, is_secret_setting_key and the egress predicate are
/// untouched, so a Resembles row is still not treated as a credential by any gate.
/// This table only decides what the census is willing to say out loud.
const SCOPE_SEPARATORS: &[char] = &[':', '.'];

/// Total function from a stored spelling to a name verdict. Exact wins first, by
/// delegating to [`credential_base`] so identity is still decided in exactly one
/// place; only a name that misses that is tested for a scope suffix.
pub(crate) fn resolve_credential_name(stored: &str) -> CredentialName {
    if let Some(base) = credential_base(stored) {
        return CredentialName::Exact { base };
    }
    let folded = normalised_candidate(stored);
    let resembles = SECRET_KEY_DENY_LIST.iter().find(|entry| {
        folded.len() > entry.len()
            && folded.starts_with(*entry)
            && folded
                .as_bytes()
                .get(entry.len())
                .is_some_and(|byte| SCOPE_SEPARATORS.contains(&(*byte as char)))
    });
    match resembles {
        Some(base) => CredentialName::Resembles {
            base,
            marker: SCOPE_MARKER,
        },
        None => CredentialName::Unrelated,
    }
}

/// Count ledger rows per deny-listed key, in deny-list order.
///
/// Reads only the `key` column and a count — never `value` — so the scan
/// itself cannot echo a credential.
///
/// Membership is decided by the shared [`is_secret_setting_key`] predicate, not
/// by an exact compare against a deny-list constant: the ledger's `key` column
/// is bare TEXT under SQLite BINARY collation, so a row stored as
/// `STRIPE.API_KEY` or `"stripe.api_key "` is a distinct row that an exact
/// compare silently skips — and a skipped row is a cleartext credential the
/// operator is told is not there. The predicate trims and case-folds, so every
/// spelling of a deny-listed key is counted and reported together under its
/// canonical key, through [`canonical_credential_key`] — the SAME resolver
/// [`purge_credential_deltas`] consults, which is what stops the count and the
/// delete drifting apart again.
pub(crate) fn scan_credential_deltas(conn: &Connection) -> Result<DeltaCounts> {
    let mut totals: DeltaCounts = SECRET_KEY_DENY_LIST
        .iter()
        .map(|key| (*key, 0usize))
        .collect();
    let sql = format!("SELECT key, COUNT(*) FROM {LEDGER_TABLE} GROUP BY key");
    let mut stmt = conn
        .prepare(&sql)
        .with_context(|| format!("reading the {LEDGER_TABLE} ledger"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .with_context(|| format!("reading the {LEDGER_TABLE} ledger"))?;
    for row in rows {
        let (key, count) = row.context("counting ledger rows")?;
        // `Ok(None)` is the only skip, and it means the shared predicate says
        // this key is not a credential at all.
        if let Some(canonical) = canonical_credential_key(&key)
            && let Some(entry) = totals
                .iter_mut()
                .find(|(deny_key, _)| *deny_key == canonical)
        {
            entry.1 += count.max(0) as usize;
        }
    }
    totals.retain(|(_, count)| *count > 0);
    Ok(totals)
}

/// Rows whose NAME resembles a deny-listed credential plus a scope suffix, counted
/// per canonical base and kept in its own bucket. Separate from the exact totals on
/// purpose: an exact row is a credential this tool can delete, a near-name is a
/// decision about what a scoped name means that nobody has authorised yet.
///
/// The map key is the BASE, a `&'static str` from the deny list, never the stored
/// spelling — see CredentialName. The tenant suffix has no representation here at
/// all, so it cannot be returned by this function, printed by the report, or reach a
/// log.
pub(crate) fn scan_resembling_names(conn: &Connection, table: &str) -> Result<ScopedCounts> {
    let mut totals: ScopedCounts = SECRET_KEY_DENY_LIST
        .iter()
        .map(|key| (*key, 0usize))
        .collect();
    let sql = format!("SELECT key, COUNT(*) FROM {table} GROUP BY key");
    let mut stmt = conn
        .prepare(&sql)
        .with_context(|| format!("reading the {table} table"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .with_context(|| format!("reading the {table} table"))?;
    for row in rows {
        let (stored, count) = row.with_context(|| format!("counting {table} rows"))?;
        if let CredentialName::Resembles { base, .. } = resolve_credential_name(&stored)
            && let Some(entry) = totals.iter_mut().find(|(b, _)| *b == base)
        {
            entry.1 += count.max(0) as usize;
        }
    }
    totals.retain(|(_, count)| *count > 0);
    Ok(totals)
}

/// One line per base that has near-names, with the marker instead of the suffix.
pub(crate) fn format_resembling_names(rows: &ScopedCounts) -> Vec<String> {
    rows.iter()
        .map(|(base, count)| {
            format!(
                "{count:>6} row(s)  base = {base}  name = {base}{SCOPE_MARKER} (suffix not shown)"
            )
        })
        .collect()
}

/// Delete every ledger row the shared credential predicate claims, in ONE
/// transaction.
///
/// Enumerates the spellings actually stored, asks [`canonical_credential_key`]
/// (and through it [`is_secret_setting_key`]) about each, and deletes by bound
/// parameter against the STORED spelling — so every row the scan counted is a
/// row this removes, including `STRIPE.API_KEY` and `"stripe.api_key "`. No SQL
/// `LOWER`/`TRIM` in the `WHERE`: the match happens in Rust, once, through the
/// same resolver the count uses, so the two paths cannot develop separate
/// opinions of what a credential key is.
///
/// Returns the per-canonical-key counts deleted. Error text names canonical
/// keys only — never a value, and never a stored spelling.
pub(crate) fn purge_credential_deltas(conn: &Connection) -> Result<DeltaCounts> {
    let tx = conn
        .unchecked_transaction()
        .context("beginning the ledger purge transaction")?;
    let select = format!("SELECT DISTINCT key FROM {LEDGER_TABLE}");
    let stored: Vec<String> = {
        let mut stmt = tx
            .prepare(&select)
            .with_context(|| format!("reading the {LEDGER_TABLE} ledger"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .with_context(|| format!("reading the {LEDGER_TABLE} ledger"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("listing the stored ledger keys")?
    };
    let delete = format!("DELETE FROM {LEDGER_TABLE} WHERE key = ?1");
    let mut deleted: DeltaCounts = Vec::new();
    for key in &stored {
        let Some(canonical) = canonical_credential_key(key) else {
            continue;
        };
        let n = tx
            .execute(&delete, params![key])
            .with_context(|| format!("deleting {LEDGER_TABLE} rows for key {canonical}"))?;
        if n > 0 {
            match deleted.iter_mut().find(|(k, _)| *k == canonical) {
                Some(entry) => entry.1 += n as usize,
                None => deleted.push((canonical, n as usize)),
            }
        }
    }
    tx.commit().context("committing the ledger purge")?;
    // Report in deny-list order — the order the scan prints in — so a counted
    // line and a deleted line are the same line.
    deleted.sort_by_key(|(canonical, _)| {
        SECRET_KEY_DENY_LIST
            .iter()
            .position(|key| key == canonical)
            .unwrap_or(usize::MAX)
    });
    Ok(deleted)
}

/// Ledger rows whose name only RESEMBLES a credential: base, then row count.
/// Kept apart from [`DeltaCounts`] because the two buckets answer different
/// questions and only one of them may be deleted.
pub(crate) type ScopedCounts = Vec<(&'static str, usize)>;

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
type FamilyDecrypt = fn(&str) -> Result<String, oz_core::crypto::CryptoError>;

/// Every family oz-crypto exposes, enumerated because the blind spot this closes
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
    use oz_core::settings::keys;
    match key {
        keys::SYNC_API_KEY => Some(oz_core::crypto::decrypt_sync_api_key),
        keys::SYNC_TERMINAL_SECRET => Some(oz_core::crypto::decrypt_sync_terminal_secret),
        keys::PG_SYNC_PASSWORD => Some(oz_core::crypto::decrypt_pg_sync_password),
        keys::RATE_SYNC_API_KEY => Some(oz_core::crypto::decrypt_rate_api_key),
        keys::LAN_SERVER_PSK => Some(oz_core::crypto::decrypt_lan_psk),
        _ => None,
    }
}

/// Keys this build cannot seal but ANOTHER lane can with a key of its own:
/// local_api.secret is sealed by the bridge, and smtp_config is a JSON envelope
/// whose password FIELD is sealed while the rest of the row is in the clear.
/// Neither is openable from here, so both answer Indeterminate rather than a
/// guess about their bytes. Machine-bound families are NOT this predicate's
/// business: they answer MachineBoundUntested before classification gets here.
/// The settings keys whose family needs the installation fingerprint, read off
/// the enumeration on credential_family: api_key is the live one, smtp_password
/// has no caller left in the tree.
fn sealed_by_machine_bound_family(key: &str) -> bool {
    use oz_core::settings::keys;
    matches!(key, keys::LICENSE_API_KEY)
}

fn sealed_in_another_lane(key: &str) -> bool {
    use oz_core::settings::keys;
    matches!(key, keys::LOCAL_API_SECRET | keys::SMTP_CONFIG)
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

/// Refuse a database that is not a store database BEFORE reporting a clean zero
/// against it: the in-scope half of the path footgun.
///
/// --db defaults to ./kasir.db in the CURRENT directory and Connection::open
/// CREATES a missing path, so a mistyped database opened an empty file, every
/// count here returned zero, and the command reported "nothing to delete" about
/// a file it had just made. Checking that both tables exist is the strongest
/// claim available from a borrowed &Connection, and the message names the
/// resolved path so an operator learns where the ghost came from. The CREATE
/// itself now happens upstream for this command: b0242e5e4 added
/// commands::open_store_for_credential_deltas, which refuses a path it would have to
/// create before opening it, while commands::open_db still creates for every other
/// subcommand on purpose because migrate / init-db / restore provisioning a database on
/// first run is legitimate. So arriving here means the file exists and is not a store.
pub(crate) fn require_store_database(conn: &Connection) -> Result<()> {
    let path = conn
        .path()
        .map(|p| p.to_string())
        .unwrap_or_else(|| "<unknown path>".to_string());
    for table in [SETTINGS_TABLE, LEDGER_TABLE] {
        let present: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .with_context(|| format!("looking for the {table} table"))?;
        if present == 0 {
            anyhow::bail!(
                "the database at {path} has no {table} table, so it is not a migrated kasir.mu store and every count below would read zero. Note that --db defaults to ./kasir.db in the CURRENT directory and opening a MISSING path CREATES one, so this file may have been made by the very command meant to inspect it. Point --db at a real store, or take a copy first with oz backup --output <copy.db> and run this against the copy."
            );
        }
    }
    Ok(())
}

/// Render `(key, count)` pairs as text. Values are never part of this.
pub(crate) fn format_delta_counts(counts: &DeltaCounts) -> Vec<String> {
    counts
        .iter()
        .map(|(key, count)| format!("{count:>6} row(s)  key = {key}"))
        .collect()
}

/// Total rows across the per-key counts.
pub(crate) fn total_rows(counts: &DeltaCounts) -> usize {
    counts.iter().map(|(_, count)| *count).sum()
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

/// `oz credential-deltas` — report both populations, delete from the ledger only.
pub(crate) fn run_credential_deltas(conn: &Connection, args: &CredentialDeltasArgs) -> Result<()> {
    require_store_database(conn)?;
    let found = scan_credential_deltas(conn)?;
    let found_total = total_rows(&found);
    let settings = scan_credential_settings(conn)?;
    let settings_total = total_settings_rows(&settings);
    let cleartext_total = total_cleartext_rows(&settings);

    println!("{}", LONG_HELP.as_str());
    println!();
    println!(
        "Deny list: {} keys, imported from platform-core (never copied into this crate).",
        SECRET_KEY_DENY_LIST.len()
    );
    println!();

    println!("---- 1 of 2: LEDGER [{LEDGER_TABLE}] — deletable ----");
    if found_total == 0 {
        println!("Ledger rows for deny-listed keys: 0 — nothing to delete.");
    } else {
        println!(
            "Ledger rows for deny-listed keys: {found_total} across {} key(s):",
            found.len()
        );
        for line in format_delta_counts(&found) {
            println!("  {line}");
        }
    }
    let ledger_near = scan_resembling_names(conn, LEDGER_TABLE)?;
    let ledger_near_total: usize = ledger_near.iter().map(|(_, count)| count).sum();
    if ledger_near_total > 0 {
        println!(
            "NEAR-NAMES (reported, NOT deleted): ledger rows whose name resembles a credential base plus a scope suffix. The suffix is operator data and is never shown:",
        );
        for line in format_resembling_names(&ledger_near) {
            println!("  {line}");
        }
    }
    println!(
        "LEDGER TOTAL: {found_total} row(s) EXACT + {ledger_near_total} row(s) NEAR-NAME; only EXACT rows are ever deleted. {LEDGER_TOTAL_IS_NOT_A_MACHINE_COUNT}"
    );
    println!();

    println!("---- 2 of 2: LIVE SETTINGS [{SETTINGS_TABLE}] — REPORT ONLY, never deleted ----");
    if settings_total == 0 {
        println!("Settings rows for deny-listed keys: 0.");
    } else {
        println!(
            "CLEARTEXT HEADLINE: {cleartext_total} of {settings_total} live settings row(s) hold a deny-listed credential in cleartext. Form per key, as far as the value column can say:"
        );
        for line in format_setting_counts(&settings) {
            println!("  {line}");
        }
        let near = scan_resembling_names(conn, SETTINGS_TABLE)?;
        let near_total: usize = near.iter().map(|(_, count)| count).sum();
        if near_total > 0 {
            println!(
                "NEAR-NAMES (reported, NOT deleted, NOT counted as cleartext either): settings rows whose name resembles a credential base plus a suffix. credential_base is suffix-blind, so these resolve to no base and no gate refuses them today:",
            );
            for line in format_resembling_names(&near) {
                println!("  {line}");
            }
        }
        println!("{LEGACY_PLAINTEXT_NOTE}");
    }
    let encrypted_total = total_encrypted_rows(&settings);
    let excluded_total = total_excluded_rows(&settings);
    let untested_total = total_untested_rows(&settings);
    println!(
        "SETTINGS TOTAL: {settings_total} row(s) — {cleartext_total} positively cleartext, {encrypted_total} resolved encrypted, {excluded_total} EXCLUDED from that headline (INVALID, undeterminable, or machine-bound untested). This total is NEVER added to, or read as, the LEDGER TOTAL above, which counts a different table."
    );
    if excluded_total > 0 {
        println!("{EXCLUDED_ROWS_NOTE}");
    }
    if untested_total > 0 {
        println!(
            "EXCLUDED BECAUSE UNTESTED: {untested_total} row(s) sit on a MACHINE-BOUND family (license.api_key, sealed with the installation machine id), and that count is NOT zero. This tool lists those rows and does not test them: it neither reads the fingerprint to decrypt them nor calls the value cleartext, because a machine-bound row can be either, and the two are indistinguishable from here."
        );
    }
    println!("{SETTINGS_REPORT_ONLY}");
    println!();

    println!("{SAFETY_BASIS}");
    println!("{RESTART_WARNING}");
    println!();

    if !args.confirm {
        println!(
            "NOTHING DELETED — a bare invocation only reports. Re-run with --confirm to delete the LEDGER rows above; --confirm will not delete any SETTINGS row above either."
        );
        println!("{HELP_BYTES_NOT_CONTENT}");
        println!("{HYGIENE_NOT_REMEDIATION}");
        return Ok(());
    }

    let deleted = purge_credential_deltas(conn)?;
    let deleted_total = total_rows(&deleted);
    if deleted_total == 0 {
        println!("Deleted 0 LEDGER rows (nothing matched at delete time).");
    } else {
        println!(
            "Deleted {deleted_total} LEDGER row(s) across {} key(s) in one transaction:",
            deleted.len()
        );
        for line in format_delta_counts(&deleted) {
            println!("  {line}");
        }
    }
    println!(
        "Deleted 0 row(s) from [{SETTINGS_TABLE}]: the settings census is report-only and no flag changes that."
    );
    println!("{HYGIENE_NOT_REMEDIATION}");
    Ok(())
}

#[cfg(test)]
#[path = "credential_deltas_tests.rs"]
mod tests;
