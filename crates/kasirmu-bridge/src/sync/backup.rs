//! Pre-pull backup family: naming, recognition, retention and disposal.
//!
//! Every function here takes a path rather than a context, so `sync_tests.rs`
//! can exercise the real naming and pruning rules against a temp directory
//! without standing up a session — which is why they are `pub(super)` rather
//! than private.
//!
//! Invariant: a pre-pull backup is UNFILTERED CLEARTEXT, so exactly ONE is kept
//! per store database (see `PRE_PULL_BACKUPS_KEPT`, a private const below) and
//! each is disposed of after
//! a successful pull. Recognition matches on the exact `%Y%m%d%H%M%S` width as
//! well as the affixes, so a store id that happens to contain `sync-pull-`
//! cannot widen a store family into another store.

use std::path::{Path, PathBuf};

/// Filename infix of the pre-pull backup written by [`sync_pull_scoped`].
///
/// The full shape is `<db-stem>.sync-pull-<YYYYMMDDHHMMSS>.backup.db`: the
/// database's own extension replaced by a timestamped marker. Both disposal
/// and rotation match on this infix, so changing it changes both.
const PRE_PULL_BACKUP_INFIX: &str = "sync-pull-";

/// Filename suffix of the pre-pull backup (see [`PRE_PULL_BACKUP_INFIX`]).
const PRE_PULL_BACKUP_SUFFIX: &str = ".backup.db";

/// Exact width of the timestamp slot: `%Y%m%d%H%M%S`, eight date-time
/// digits plus six seconds. Matching on the width as well as the affixes is
/// what keeps a store id that happens to contain `sync-pull-` from
/// widening a store's backup family into somebody else's.
const PRE_PULL_BACKUP_TIMESTAMP_LEN: usize = 14;

/// How many pre-pull backups survive a pull, per store database.
///
/// One, not one-per-pull: a retained copy is worth exactly as much as the
/// recovery it enables, and a second one is worth nothing — while a directory
/// full of them is worth a great deal to anyone who finds them. See
/// `dispose_pre_pull_backup` for why each one is unfiltered cleartext.
const PRE_PULL_BACKUPS_KEPT: usize = 1;

/// The path the pre-pull backup of `store_db` takes at `timestamp`.
///
/// The caller passes the `store` database, not the shell's main database,
/// because that is the file being cloned: `/data/store-7.sqlite` yields
/// `/data/store-7.sync-pull-<ts>.backup.db`. [`Path::set_extension`]
/// replaces everything after the last dot, so the result is always a sibling of
/// the database it was taken from — store DBs live in the same directory as the
/// main one, which is why the pile has not moved.
pub(super) fn pre_pull_backup_path(store_db: &Path, timestamp: &str) -> PathBuf {
    let mut path = store_db.to_path_buf();
    path.set_extension(format!(
        "{PRE_PULL_BACKUP_INFIX}{timestamp}{PRE_PULL_BACKUP_SUFFIX}"
    ));
    path
}

/// Whether `name` is exactly `<stem>.sync-pull-<14 digits>.backup.db`.
pub(super) fn matches_pre_pull_backup_name(stem: &str, name: &str) -> bool {
    let prefix = format!("{}.{PRE_PULL_BACKUP_INFIX}", stem);
    let Some(rest) = name.strip_prefix(&prefix) else {
        return false;
    };
    let Some(timestamp) = rest.strip_suffix(PRE_PULL_BACKUP_SUFFIX) else {
        return false;
    };
    timestamp.len() == PRE_PULL_BACKUP_TIMESTAMP_LEN
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
}

/// Whether `candidate` is a pre-pull backup taken from the database at
/// `scope_db` — and not one taken from some other database sharing the
/// directory, nor that other database's live file.
///
/// The scope is the file STEM, which is the whole point of naming a backup
/// after the database it clones: a sweep for `store-a.sqlite` cannot see
/// `store-b.sqlite`'s retained recovery point.
pub(super) fn is_pre_pull_backup(scope_db: &Path, candidate: &Path) -> bool {
    match (scope_db.file_stem(), candidate.file_name()) {
        (Some(stem), Some(name)) => {
            matches_pre_pull_backup_name(&stem.to_string_lossy(), &name.to_string_lossy())
        }
        _ => false,
    }
}

/// Rotate the pre-pull backups in `scope_db`'s family down to the
/// `keep` newest, returning the paths actually removed.
///
/// `protect` — the backup this pull just wrote, when it is being retained
/// — is never removed and consumes one slot of the budget, so a retained
/// recovery copy can never be rotated out by a later-timestamped sibling from a
/// skewed clock.
///
/// Selection is by file name, not mtime: the timestamp is fixed-width
/// `%Y%m%d%H%M%S` UTC, so lexicographic order `*is*` chronological
/// order, and a copy SQLite wrote and never reopened has no mtime worth
/// trusting. A missing or unreadable parent directory is not an error — there
/// is nothing to rotate.
pub(super) fn prune_pre_pull_backups(
    scope_db: &Path,
    keep: usize,
    protect: Option<&Path>,
) -> Vec<PathBuf> {
    let Some(parent) = scope_db.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_pre_pull_backup(scope_db, path))
        .collect();
    // Newest first: descending file name == descending timestamp.
    found.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    // Only count the protected file if it is actually on disk — otherwise a
    // copy we just deleted would reserve the budget and starve the survivor.
    let protected_present = protect.is_some_and(|p| found.iter().any(|f| f == p));
    let mut kept = usize::from(protected_present);
    let mut removed = Vec::new();
    for path in found {
        if protect == Some(path.as_path()) {
            continue;
        }
        if kept < keep {
            kept += 1;
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => removed.push(path),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                // Never fatal: a stuck stale copy is a disk-space nuisance,
                // not a reason to fail a pull that already succeeded.
                tracing::warn!(backup = %path.display(), error = %e, "pre-pull backup rotation failed");
            }
        }
    }
    removed
}

/// Decide the fate of the pre-pull backup once the pull's outcome is known.
///
/// The rule in one line: `*the snapshot survives exactly as long as the
/// damage it can undo.*`
///
/// * `applied_ok == true` — the store database is coherent, so the
///   recovery point has served no purpose and is deleted. That covers two
///   cases: the snapshot applied cleanly, and the `fetch` failed, in
///   which case Phase 4 never wrote anything locally and there is by
///   definition nothing to recover.
/// * `applied_ok == false` — the apply failed part-way, which is exactly
///   the state this file exists to undo, so it is retained and only its older
///   siblings are rotated away.
///
/// Two families are swept, because a till's data directory holds both:
///
/// 1. this store's own family, `store-<id>.sync-pull-*.backup.db`, capped
///    at [`PRE_PULL_BACKUPS_KEPT`] copies and scoped by the store's file
///    stem — so a pull for one store can never rotate away another store's
///    retained recovery point, which is why the name carries the identity;
/// 2. the LEGACY family, `<main-db-stem>.sync-pull-*.backup.db`, which
///    every build before this one wrote for `every` store under the
///    shell's main database name. Those are matched and deleted outright
///    (budget zero) rather than kept-and-capped: they carry no store identity,
///    so none of them can be the recovery point this code promises, and unlike
///    the new scheme nothing will ever overwrite or retire one — keeping the
///    newest would leave a permanent, ownerless plaintext clone. So an install
///    that has been pulling for months has its old pile swept by its next pull
///    instead of keeping it forever. The sweep is skipped when the main and
///    store stems coincide, so it can never eat a live store family.
///
/// WHY THE PILE MATTERS: `Store::backup` is the SQLite online-backup API
/// — a page-level copy of the whole database that consults no policy, so the
/// settings deny list that filters every export lane does NOT apply here. Each
/// file is a complete plaintext clone, secrets included, written beside the
/// live databases where machine backup tools, antivirus indexers and anyone
/// tidying a folder will find it. Removing it on the success path is what keeps
/// that exposure to one transient file per store instead of one per pull.
///
/// Every log line here names the PATH and never the contents — the contents are
/// precisely what must not reach a log.
pub(super) fn dispose_pre_pull_backup(
    main_db: &Path,
    store_db: &Path,
    backup_path: &Path,
    applied_ok: bool,
) {
    if applied_ok {
        match std::fs::remove_file(backup_path) {
            Ok(()) => {
                tracing::debug!(backup = %backup_path.display(), "pre-pull backup removed after successful pull");
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!(backup = %backup_path.display(), error = %e, "pre-pull backup could not be removed after a successful pull");
            }
        }
    } else {
        tracing::warn!(backup = %backup_path.display(), "pull failed; pre-pull backup retained for recovery");
    }

    // Success: our own copy is already gone, so rotation just trims orphans
    // left by earlier failed pulls of THIS store down to one. Failure:
    // `protect` makes this pull's copy the single survivor.
    let protect = if applied_ok { None } else { Some(backup_path) };
    for stale in prune_pre_pull_backups(store_db, PRE_PULL_BACKUPS_KEPT, protect) {
        tracing::debug!(backup = %stale.display(), "rotated out a stale pre-pull backup");
    }

    // The legacy family is a different family only when the stems differ; if
    // they coincide, the sweep above already covered it and sweeping again
    // would delete this store's own retained copy.
    if main_db.file_stem() != store_db.file_stem() {
        for stale in prune_pre_pull_backups(main_db, 0, None) {
            tracing::debug!(backup = %stale.display(), "swept a legacy pre-pull backup named after the main database");
        }
    }
}
