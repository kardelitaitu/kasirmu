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
//! It does not touch the live `settings` table or the whole-file backup.

use std::sync::LazyLock;

use anyhow::{Context, Result};
use rusqlite::{Connection, params};

use oz_core::settings::keys::{SECRET_KEY_DENY_LIST, is_secret_setting_key, normalised_candidate};

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
pub(crate) const HYGIENE_NOT_REMEDIATION: &str = concat!(
    "This is HYGIENE, not remediation. The delta ledger is the SECONDARY carrier; the dominant ",
    "one is the live `settings` table, where nine of the fourteen credential keys sit in ",
    "plaintext, plus every whole-file page copy (.db / .backup.db), which the CLI README already ",
    "documents as the plaintext carrier. A perfect sweep of this table leaves the main problem ",
    "untouched — running this and believing the exposure is closed is worse than running nothing."
);

/// What the command does, as the head of the long help.
pub(crate) const HELP_HEAD: &str = concat!(
    "Report (default) or delete (--confirm) rows in the settings delta ledger `setting_updated` whose\n",
    "key is on the credential deny list. Matching is by KEY NAME only, through the shared platform-core\n",
    "predicate, so every spelling of a listed key matches, not just its canonical one: the value column is\n",
    "bare TEXT,\n",
    "a plaintext secret and a ciphertext blob are indistinguishable without the key, and any\n",
    "value-shape heuristic would be wrong on real data. No value is ever printed or logged. The deny\n",
    "list is imported from platform-core, never copied here. A bare invocation deletes nothing; the\n",
    "delete requires --confirm and runs as one rusqlite transaction, printing a per-key row count."
);

/// What the command deliberately does not do, as the middle of the long help.
pub(crate) const HELP_SCOPE: &str = concat!(
    "Out of scope on purpose: no startup hook, no migration, no retention policy for non-credential\n",
    "keys (age-based retention keeps the newest rows, and a credential delta IS the newest row for its\n",
    "key), the live `settings` table, and the whole-file backup."
);

/// The whole long help, assembled from the SAME constants the completion
/// output prints, so the help text and the run can never disagree.
pub(crate) static LONG_HELP: LazyLock<String> = LazyLock::new(|| {
    format!(
        "{HELP_HEAD}\n\n{SAFETY_BASIS}\n\n{RESTART_WARNING}\n\n{HELP_SCOPE}\n\n{HYGIENE_NOT_REMEDIATION}"
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
/// The fold below picks only the canonical LABEL to count and delete under; it
/// is not a second membership test. It calls platform-core's own
/// [`normalised_candidate`] — the same function the predicate folds with — so
/// there is exactly one fold in the tree rather than two that can drift. A
/// label is needed at all because the deny list is the only thing that has a
/// stable spelling to report and delete under, and the ledger stores whatever
/// spelling a writer used. If a fold ever does disagree, the lookup misses for
/// a key the predicate accepted, and that is an ERROR, not a silent skip — an
/// undercount on this path is exactly what hides cleartext credentials.
fn canonical_credential_key(stored: &str) -> Result<Option<&'static str>> {
    if !is_secret_setting_key(stored) {
        return Ok(None);
    }
    let folded = normalised_candidate(stored);
    match SECRET_KEY_DENY_LIST
        .iter()
        .find(|&&deny_key| deny_key == folded.as_str())
        .copied()
    {
        Some(entry) => Ok(Some(entry)),
        None => anyhow::bail!(concat!(
            "{stored:?} satisfies the shared credential predicate but matches no deny-list ",
            "entry; refusing to count or delete it on a guess"
        )),
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
        if let Some(canonical) = canonical_credential_key(&key)? {
            if let Some(entry) = totals
                .iter_mut()
                .find(|(deny_key, _)| *deny_key == canonical)
            {
                entry.1 += count.max(0) as usize;
            }
        }
    }
    totals.retain(|(_, count)| *count > 0);
    Ok(totals)
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
        let Some(canonical) = canonical_credential_key(key)? else {
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

/// `oz credential-deltas` — report, or delete with `--confirm`.
pub(crate) fn run_credential_deltas(conn: &Connection, args: &CredentialDeltasArgs) -> Result<()> {
    let found = scan_credential_deltas(conn)?;
    let found_total = total_rows(&found);

    println!("{}", LONG_HELP.as_str());
    println!();
    println!(
        "Deny list: {} keys, imported from platform-core (never copied into this crate).",
        SECRET_KEY_DENY_LIST.len()
    );
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
    println!();
    println!("{SAFETY_BASIS}");
    println!("{RESTART_WARNING}");
    println!();

    if !args.confirm {
        println!(
            "NOTHING DELETED — a bare invocation only reports. Re-run with --confirm to delete."
        );
        println!("{HYGIENE_NOT_REMEDIATION}");
        return Ok(());
    }

    let deleted = purge_credential_deltas(conn)?;
    let deleted_total = total_rows(&deleted);
    if deleted_total == 0 {
        println!("Deleted 0 rows (nothing matched at delete time).");
    } else {
        println!(
            "Deleted {deleted_total} row(s) across {} key(s) in one transaction:",
            deleted.len()
        );
        for line in format_delta_counts(&deleted) {
            println!("  {line}");
        }
    }
    println!("{HYGIENE_NOT_REMEDIATION}");
    Ok(())
}

#[cfg(test)]
#[path = "credential_deltas_tests.rs"]
mod tests;
