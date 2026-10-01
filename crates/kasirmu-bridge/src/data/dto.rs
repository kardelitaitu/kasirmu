//! Data-management IPC wire types: backup, export, import and the C8 restore
//! surface request/response DTOs.
//!
//! Split out of `data.rs` on 2026-09-27 because the 17 declarations alone were
//! 206 of its lines while carrying no logic - the command bodies that consume
//! them import from here.
//!
//! NOTE FOR ANYONE MOVING CODE OUT OF `data.rs`: `data_tests.rs` holds TWO
//! source scans over `data.rs` - `the_ungated_twin_has_no_import_counterpart`
//! (counts `pub async fn ` with a floor of 2, and asserts the ungated export
//! twin exists while no ungated IMPORT does) and
//! `import_data_propagates_every_row_write` (whitespace-normalised, floor of 9).
//! Both name `data.rs` by `include_str!`, so a move that relocates the
//! functions they name must widen those scans in the same change.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
/// Backupstatus.
pub struct BackupStatus {
    /// Last Backup.
    pub last_backup: Option<String>,
    /// Last Backup Size.
    pub last_backup_size: Option<String>,
    // Db Path intentionally omitted — leaks the filesystem path to
    // any IPC caller (M-7: never expose db_path in unauth'd DTOs).
}

#[derive(Debug, Serialize)]
/// Backupresult.
pub struct BackupResult {
    /// Path.
    pub path: String,
    /// Size Bytes.
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
/// Exportdataargs.
pub struct ExportDataArgs {
    /// Types.
    pub types: Vec<String>,
    /// Password.
    pub password: String,
    /// Output Path.
    pub output_path: String,
    /// Date From.
    pub date_from: Option<String>,
    /// Date To.
    pub date_to: Option<String>,
}

#[derive(Debug, Serialize)]
/// Exportdataresult.
pub struct ExportDataResult {
    /// Path.
    pub path: String,
    /// Size Bytes.
    pub size_bytes: u64,
    /// Types.
    pub types: Vec<String>,
}

#[derive(Debug, Deserialize)]
/// Importpreviewargs.
pub struct ImportPreviewArgs {
    /// File Path.
    pub file_path: String,
    /// Password.
    pub password: String,
}

#[derive(Debug, Serialize)]
/// Importpreviewresult.
pub struct ImportPreviewResult {
    /// Store Name.
    pub store_name: String,
    /// App Version.
    pub app_version: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Types.
    pub types: Vec<String>,
    /// Product Count.
    pub product_count: usize,
    /// Category Count.
    pub category_count: usize,
    /// Sale Count.
    pub sale_count: Option<usize>,
    /// Customer Count.
    pub customer_count: Option<usize>,
    /// User Count.
    pub user_count: Option<usize>,
    /// Setting Count.
    pub setting_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
/// Importdataargs.
pub struct ImportDataArgs {
    /// File Path.
    pub file_path: String,
    /// Password.
    pub password: String,
}

// ── C8 restore surface (slice S3) ─────────────────────────────────

/// One backup generation beside the live database, judged as a restore source.
///
/// `verdict` is the core's typed `CandidateVerdict` rendered as its stable
/// wire name (see `verdict_name`), never a bool: an operator has to be told
/// *why* a generation is unusable, and `reason` carries the core's own
/// sentence for exactly that. A generation that exists but fails validation is
/// LISTED as `Corrupt` — omitting it would hide the evidence that a backup is
/// unusable, which is the one thing the list exists to show.
#[derive(Debug, Serialize)]
/// Restorecandidate.
pub struct RestoreCandidate {
    /// Generation number: 0 is `<db>.backup.db`, 1 is `<db>.backup.1.db`, 2 is `<db>.backup.2.db`.
    pub generation: usize,
    /// Absolute path of the generation file.
    pub path: String,
    /// File size in bytes (0 when the file could not be stat'd).
    pub size_bytes: u64,
    /// Last modification time, `YYYY-MM-DD HH:MM:SS` local, when available.
    pub modified: Option<String>,
    /// Stable wire name of the validation verdict.
    pub verdict: String,
    /// Whether `verdict` permits this generation to replace the live database.
    pub restorable: bool,
    /// The validator's human-readable explanation.
    pub reason: String,
    /// Newest date-shaped migration id the candidate carries.
    pub candidate_schema: Option<String>,
    /// Newest date-shaped migration id this build's registry carries.
    pub build_schema: Option<String>,
}

#[derive(Debug, Serialize)]
/// Listrestorecandidatesresult.
pub struct ListRestoreCandidatesResult {
    /// One entry per generation that exists on disk, newest generation first.
    pub candidates: Vec<RestoreCandidate>,
    /// How many generations were examined (generation 0 included).
    pub generations_examined: usize,
}

#[derive(Debug, Deserialize)]
/// Restoreprepareargs.
pub struct RestorePrepareArgs {
    /// Path of the chosen candidate — one of `list_restore_candidates`' paths.
    pub candidate_path: String,
    /// The store name READ FROM THE CANDIDATE database, typed by the operator.
    ///
    /// This is the confirmation of WHICH database is about to replace the live
    /// one. It is checked against the candidate's own `store.name`, never
    /// against the live database's, because the live database is the one being
    /// replaced.
    pub confirm_store_name: String,
}

#[derive(Debug, Serialize)]
/// Restoreprepareresult.
pub struct RestorePrepareResult {
    /// Path of the candidate the request names.
    pub candidate_path: String,
    /// Path of the request file that was written.
    pub request_path: String,
    /// ISO-8601 timestamp the request was written at.
    pub requested_at: String,
    /// Stable wire name of the candidate's validation verdict.
    pub verdict: String,
    /// Newest date-shaped migration id the candidate carries.
    pub candidate_schema: Option<String>,
}

#[derive(Debug, Serialize)]
/// Restorestatus.
pub struct RestoreStatus {
    /// Whether a request file exists beside the live database.
    pub pending: bool,
    /// Path of the candidate the pending request names.
    pub candidate_path: Option<String>,
    /// ISO-8601 timestamp the pending request was written at.
    pub requested_at: Option<String>,
    /// Verdict the pending request was prepared under.
    pub verdict: Option<String>,
    /// Why the request file could not be read, when it could not.
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
/// The on-disk restore request the boot path consumes (S4).
pub(super) struct RestoreRequest {
    /// Path of the chosen candidate.
    pub(super) candidate_path: String,
    /// ISO-8601 timestamp the request was written at.
    pub(super) requested_at: String,
    /// Stable wire name of the candidate's validation verdict.
    pub(super) verdict: String,
    /// Newest date-shaped migration id the candidate carries.
    pub(super) candidate_schema: Option<String>,
    /// The store name the operator confirmed, read from the candidate.
    pub(super) confirmed_store_name: String,
}

#[derive(Debug, Serialize)]
/// Importdataresult.
pub struct ImportDataResult {
    /// Products Imported.
    pub products_imported: usize,
    /// Categories Imported.
    pub categories_imported: usize,
    /// Sales Imported.
    pub sales_imported: usize,
    /// Customers Imported.
    pub customers_imported: usize,
    /// Users Imported.
    pub users_imported: usize,
    /// Settings Imported.
    pub settings_imported: usize,
}
