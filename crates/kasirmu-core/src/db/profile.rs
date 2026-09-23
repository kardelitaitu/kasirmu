//! User profile data contract (ADR #35 D6 / spec 0049).
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 3: profile/PII deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: model PII implementation — national_id + monthly pay encrypted at rest (encrypt_profile_field), uniqueness via SHA-256 hash (plaintext never stored), last-4 masking everywhere, sensitive reads permission-gated (staff:read_identity / staff:read_payroll) AND audited (access recorded, never values), decrypt fails closed, incomplete-profile blocks sensitive-role assignment. CROSS-CRATE: ciphertext keys derive from kasirmu-crypto static key (CRY-1) — the at-rest guarantee for PII is only as strong as CRY-1's remediation; elevate CRY-1 fix priority. COR-24 INFO: decrypt_sensitive returns None silently on decrypt failure (fail-closed direction, but corrupt ciphertext reads as missing field with no signal)
next: none here; CRY-1 remediation covers the encryption gap | perf: single-row queries, indexed
*/
//!
//! The `users` table gains the profile columns in migration 130. This module
//! carries the contract: what is mandatory-at-creation, how each field is
//! validated, and the incomplete-profile derivation. Columns are nullable in
//! SQL — "mandatory" is enforced at creation with field-specific errors, and
//! legacy rows (or direct-SQL inserts) enter the incomplete-profile state
//! instead of being rejected.
//!
//! The 9 mandatory-at-creation items: username + full name (both already on
//! `users`, enforced by `create_user`) plus the 8 profile fields below. The
//! D6 not-collected fields (gender, religion, marital status, ethnicity,
//! blood type, bank account, shift/availability) never appear here.
//!
//! INVARIANT (COR-24): a stored value that no longer decrypts is UNREADABLE,
//! not empty. Reads may fail closed to `None`, but `write_user_profile` re-
//! separates the states from the stored bytes (`StoredCipher`) so a view-then-
//! save round trip can never NULL out a ciphertext a key restore would revive.
//!
//! INVARIANT (ADR #35 D6 write side): a value the caller was never permitted to
//! READ is not a value they may be asked to re-supply. A view withholds a
//! sensitive field by returning `None`, which is indistinguishable from an
//! empty column, so a write from such a caller preserves the stored bytes
//! instead of requiring the field or blanking it — see
//! [`SensitiveWritePolicy`] and [`Store::write_user_profile_with`]. Without
//! this, the only way past a required-field error was to type a value for a
//! field the caller could not see, silently replacing it.

use rusqlite::{OptionalExtension, params};

use crate::audit::AuditEntry;
use crate::crypto::{decrypt_profile_field, encrypt_profile_field};
use crate::downgrade::QuotaDimension;
use crate::error::CoreError;
use crate::{permission_registry, permissions};

use super::Store;

/// The user profile fields added by migration 130.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UserProfile {
    // ── Required at creation (nullable in SQL) ──────────────────────
    /// ISO date (`YYYY-MM-DD`), never in the future.
    pub date_of_birth: Option<String>,
    /// Phone in E.164 form (`+<country><number>`).
    pub phone: Option<String>,
    /// `"ssn"` (US) or `"nik"` (Indonesian KTP).
    pub national_id_type: Option<String>,
    /// The national id — 9 digits for `ssn`, 16 for `nik`.
    pub national_id: Option<String>,
    /// Lowercase email, unique when present.
    pub email: Option<String>,
    /// Monthly take-home pay in i64 minor units, strictly positive.
    pub monthly_take_home_minor: Option<i64>,
    /// Emergency contact's name (required at creation).
    pub emergency_contact_name: Option<String>,
    /// Emergency contact's phone (required at creation).
    pub emergency_contact_phone: Option<String>,
    // ── Optional ─────────────────────────────────────────────────────
    /// Job title (free text), stable string slot — never affects completeness.
    pub job_title: String,
    /// Free-text notes, stable string slot — never affects completeness.
    pub notes: String,
    /// Street address, optional.
    pub address: Option<String>,
    /// UI language preference, optional.
    pub language: Option<String>,
    /// Avatar reference (path/URL), optional.
    pub avatar: Option<String>,
    /// Tax identification number, optional (distinct from the national id).
    pub tax_id: Option<String>,
    /// Expiry of the national id document (`YYYY-MM-DD`), optional.
    pub national_id_expires_at: Option<String>,
    /// Relationship of the emergency contact (e.g. "spouse"), optional.
    pub emergency_contact_relationship: Option<String>,
    /// Hire date (`YYYY-MM-DD`), optional.
    pub hire_date: Option<String>,
}

impl UserProfile {
    /// Whether all 8 profile-side required fields are present (username +
    /// full name are enforced by `create_user`). A missing required field
    /// means the user is in the incomplete-profile state.
    pub fn is_complete(&self) -> bool {
        self.date_of_birth.is_some()
            && self.phone.is_some()
            && self.national_id_type.is_some()
            && self.national_id.is_some()
            && self.email.is_some()
            && self.monthly_take_home_minor.is_some()
            && self.emergency_contact_name.is_some()
            && self.emergency_contact_phone.is_some()
    }

    /// Field-specific validation for creation and profile updates: every
    /// required field present, `national_id` shaped per its type (ssn 9 /
    /// nik 16), email well-formed, phone E.164, DOB not in the future,
    /// monthly pay strictly positive.
    pub fn validate(&self) -> Result<(), CoreError> {
        self.validate_with_preserved(false, false)
    }

    /// `Self::validate` plus the write-path exemption for a field this write
    /// must not decide (`national_id_kept` / `pay_kept`). Two cases reach it,
    /// and both mean "not supplied, and not missing":
    ///
    /// * the stored ciphertext exists but cannot be decrypted — a caller that
    ///   round-tripped a failed read into `None` must not be told the field is
    ///   required, and its shape cannot be checked because no plaintext exists
    ///   to check;
    /// * the caller was never permitted to read the field, so the `None` is
    ///   the read path's withholding rather than an empty column. There is
    ///   nothing to check shape against either, and no honest value to supply.
    ///
    /// See [`Store::write_user_profile_with`]. Plain [`Self::validate`]
    /// (creation) passes `false` for both: a new account has no stored value
    /// to preserve and no withholding, so every mandatory field must be
    /// supplied outright.
    fn validate_with_preserved(
        &self,
        national_id_kept: bool,
        pay_kept: bool,
    ) -> Result<(), CoreError> {
        // 1. All 8 required fields present, reported in a fixed order.
        if self.date_of_birth.is_none() {
            return Err(validation("date_of_birth", "date of birth is required"));
        }
        if self.phone.is_none() {
            return Err(validation("phone", "phone number is required"));
        }
        if self.national_id_type.is_none() {
            return Err(validation(
                "national_id_type",
                "national id type is required",
            ));
        }
        if self.national_id.is_none() && !national_id_kept {
            return Err(validation("national_id", "national id is required"));
        }
        if self.email.is_none() {
            return Err(validation("email", "email address is required"));
        }
        if self.monthly_take_home_minor.is_none() && !pay_kept {
            return Err(validation(
                "monthly_take_home_minor",
                "monthly take-home pay is required",
            ));
        }
        if self.emergency_contact_name.is_none() {
            return Err(validation(
                "emergency_contact_name",
                "emergency contact name is required",
            ));
        }
        if self.emergency_contact_phone.is_none() {
            return Err(validation(
                "emergency_contact_phone",
                "emergency contact phone is required",
            ));
        }

        // 2. National id type: ssn (US) or nik (Indonesian KTP) only.
        // INVARIANT (COR-6): the `national_id_type.is_none()` guard above
        // returns early, so this unwrap cannot fail.
        let id_type = self.national_id_type.as_deref().unwrap();
        if id_type != "ssn" && id_type != "nik" {
            return Err(validation(
                "national_id_type",
                "national id type must be 'ssn' or 'nik'",
            ));
        }

        // 3. National id shape: exactly 9 digits (ssn) or 16 (nik).
        // Only checkable when a plaintext value is on hand: a preserved
        // (undecryptable) ciphertext has no readable value to shape-check,
        // which is why the block is gated rather than unconditional.
        // INVARIANT (COR-6): inside the `Some(id)` arm the shape is validated
        // against the unwrapped `national_id_type`, whose `is_none()` guard
        // above already returned early.
        let expected = if id_type == "ssn" { 9 } else { 16 };
        if let Some(id) = self.national_id.as_deref()
            && (id.len() != expected || !id.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(validation(
                "national_id",
                format!("national id must be {expected} digits for {id_type}"),
            ));
        }

        // 4. Email: local@domain.tld, no whitespace.
        if let Some(email) = self.email.as_deref() {
            let valid = match email.split_once('@') {
                Some((local, domain)) => {
                    !local.is_empty()
                        && domain.contains('.')
                        && !email.chars().any(char::is_whitespace)
                }
                None => false,
            };
            if !valid {
                return Err(validation("email", "email address is not well-formed"));
            }
        }

        // 5. Phone: E.164 — `+` then 7..=15 digits.
        if let Some(phone) = self.phone.as_deref() {
            let digits = phone.strip_prefix('+');
            let valid = matches!(digits, Some(d) if (7..=14).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()));
            if !valid {
                return Err(validation(
                    "phone",
                    "phone must be E.164 (+country number, max 15 digits)",
                ));
            }
        }

        // 6. Date of birth: ISO date, never in the future.
        if let Some(dob) = self.date_of_birth.as_deref() {
            let today = chrono::Utc::now().date_naive();
            match chrono::NaiveDate::parse_from_str(dob, "%Y-%m-%d") {
                Ok(parsed) if parsed <= today => {}
                _ => {
                    return Err(validation(
                        "date_of_birth",
                        "date of birth must be a valid past date (YYYY-MM-DD)",
                    ));
                }
            }
        }

        // 7. Monthly take-home pay: strictly positive minor units.
        if let Some(pay) = self.monthly_take_home_minor
            && pay <= 0
        {
            return Err(validation(
                "monthly_take_home_minor",
                "monthly take-home pay must be positive",
            ));
        }

        Ok(())
    }
}

fn validation(field: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::Validation {
        field,
        message: message.into(),
    }
}

/// The profile columns of `users`, in parameter order (SELECT list).
const PROFILE_COLUMNS: &str = "date_of_birth, phone, national_id_type, national_id, email, \
     monthly_take_home_minor, emergency_contact_name, emergency_contact_phone, job_title, notes, \
     address, language, avatar, tax_id, national_id_expires_at, emergency_contact_relationship, \
     hire_date";

/// The same columns as `col = ?N` assignments, in parameter order (UPDATE).
/// `national_id` and `monthly_take_home_minor` hold ciphertext and
/// `national_id_hash` carries the plaintext hash that preserves uniqueness.
const PROFILE_ASSIGNMENTS: &str = "date_of_birth=?1, phone=?2, national_id_type=?3, \
     national_id=?4, national_id_hash=?5, email=?6, monthly_take_home_minor=?7, \
     emergency_contact_name=?8, emergency_contact_phone=?9, job_title=?10, notes=?11, \
     address=?12, language=?13, avatar=?14, tax_id=?15, national_id_expires_at=?16, \
     emergency_contact_relationship=?17, hire_date=?18";

/// The profile of a user as seen by a specific viewer (ADR #35 D6):
/// sensitive fields are withheld or masked unless the viewer holds the
/// explicit sensitive grants, and reads are audited by
/// [`Store::get_user_profile_viewed_by`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileView {
    /// Login username (not sensitive).
    pub username: String,
    /// Display name (not sensitive).
    pub display_name: String,
    /// ISO date of birth (not sensitive).
    pub date_of_birth: Option<String>,
    /// Phone in E.164 form (not sensitive).
    pub phone: Option<String>,
    /// `"ssn"` or `"nik"` — the *type* is not sensitive.
    pub national_id_type: Option<String>,
    /// Full national id — present only when the viewer holds
    /// `staff:read_identity`.
    pub national_id: Option<String>,
    /// Last-4 masked national id — always present, never reveals more.
    pub national_id_masked: String,
    /// Lowercase email (an identifier only, per ADR #35 D6 non-goals).
    pub email: Option<String>,
    /// Monthly take-home pay in minor units — present only when the viewer
    /// holds `staff:read_payroll`.
    pub monthly_take_home_minor: Option<i64>,
    /// Emergency contact name (not sensitive).
    pub emergency_contact_name: Option<String>,
    /// Emergency contact phone (not sensitive).
    pub emergency_contact_phone: Option<String>,
    /// Job title (not sensitive).
    pub job_title: String,
    /// Free-text notes (not sensitive).
    pub notes: String,
    /// Street address (not sensitive).
    pub address: Option<String>,
    /// UI language preference (not sensitive).
    pub language: Option<String>,
    /// Avatar reference (not sensitive).
    pub avatar: Option<String>,
    /// Tax id — present only when the viewer holds `staff:read_identity`.
    pub tax_id: Option<String>,
    /// National id document expiry (not sensitive).
    pub national_id_expires_at: Option<String>,
    /// Emergency contact relationship (not sensitive).
    pub emergency_contact_relationship: Option<String>,
    /// Hire date (not sensitive).
    pub hire_date: Option<String>,
    /// Whether all 8 required profile fields are present.
    pub is_complete: bool,
    /// True when the viewer does NOT hold `staff:read_identity`, so
    /// `national_id` and `tax_id` above are absent because they were
    /// WITHHELD, not because the columns are empty.
    ///
    /// The distinction is the whole point of this field: a consumer that
    /// cannot tell the two apart either demands a value the viewer was never
    /// shown, or offers an empty box that looks like "unset" and invites a
    /// blank write over a stored document. It exists here for the same reason
    /// as `RoleHolderDto::has_assignment` — a null that means two things has
    /// to say which one it is.
    pub identity_withheld: bool,
}

/// Deterministic SHA-256 hex digest (national-id uniqueness hash).
fn sha256_hex(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Mask a value to its last 4 characters (ADR #35 D6: national_id renders
/// last-4 in every UI surface; the full value only via the explicit grant).
pub fn mask_last4(value: &str) -> String {
    let len = value.chars().count();
    if len == 0 {
        return "****".to_string();
    }
    if len <= 4 {
        return "*".repeat(len);
    }
    let last4: String = value.chars().skip(len - 4).collect();
    format!("{}{last4}", "*".repeat(len - 4))
}

/// Decrypt a stored ciphertext for **display**, failing closed (never
/// plaintext) on error.
///
/// `None` here means "nothing safe to render" and deliberately collapses three
/// different column states — absent, decrypts to an empty value, and present
/// but UNDECRYPTABLE. That is fine for a view but must never be read as "the
/// field is empty" by a writer: a round trip that feeds this `None` back into
/// [`Store::write_user_profile`] would otherwise NULL out ciphertext that a
/// later key restore could still read. The write path therefore re-derives the
/// distinction from the stored bytes themselves — see [`StoredCipher`].
fn decrypt_sensitive(cipher: Option<String>) -> Option<String> {
    cipher.and_then(|c| decrypt_profile_field(&c).ok())
}

/// What one sensitive profile column actually holds, as the **write** path must
/// see it: the three states [`decrypt_sensitive`] collapses for display are
/// kept apart here, because only one of them may be overwritten with a null.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StoredCipher {
    /// Column is NULL or the empty string — genuinely empty, nothing to keep.
    Absent,
    /// Ciphertext that decrypts to a usable value. The read path had its chance
    /// to show it, so a caller sending no value is clearing it on purpose.
    /// Carries the stored bytes so a write that must NOT clear it (a withheld
    /// field, see [`SensitiveWritePolicy`]) can re-bind them verbatim.
    Readable(String),
    /// Ciphertext present but unreadable (decrypt failed, or it decrypts to
    /// something that is not a value at all). Carries the stored bytes so the
    /// write can put them back verbatim.
    Unreadable(String),
}

impl StoredCipher {
    /// Classify a text column: readable iff it decrypts to any string.
    fn classify(raw: Option<String>) -> Self {
        Self::classify_with(raw, |_| true)
    }

    /// Classify the encrypted pay column, where "decrypts" is not enough: a
    /// clear text that is not an `i64` never reached the caller as a value
    /// either, so it counts as unreadable rather than as something the caller
    /// could have decided to clear.
    fn classify_pay(raw: Option<String>) -> Self {
        Self::classify_with(raw, |clear| {
            clear.is_empty() || clear.parse::<i64>().is_ok()
        })
    }

    fn classify_with(raw: Option<String>, usable: impl Fn(&str) -> bool) -> Self {
        let Some(stored) = raw.filter(|s| !s.is_empty()) else {
            return Self::Absent;
        };
        match decrypt_profile_field(&stored) {
            Ok(clear) if usable(&clear) => Self::Readable(stored),
            // A read failure is never evidence that a field is empty; the only
            // safe verdict for a present-but-unopenable seal.
            _ => Self::Unreadable(stored),
        }
    }

    /// The stored bytes this write must leave byte-identical because they
    /// cannot be opened, if any.
    ///
    /// Deliberately NOT the same as [`Self::raw`]: a readable value that the
    /// caller simply sent nothing for is a deliberate clear, and only the
    /// unreadable case is unambiguously not a decision anyone made.
    fn preserve(&self) -> Option<&str> {
        match self {
            Self::Unreadable(raw) => Some(raw),
            Self::Absent | Self::Readable(_) => None,
        }
    }

    /// The stored bytes, whatever state the column is in — what a write
    /// re-binds to leave the column byte-identical. Callers gate this on a
    /// policy or on unreadability; it never decides the question itself.
    fn raw(&self) -> Option<&str> {
        match self {
            Self::Absent => None,
            Self::Readable(raw) | Self::Unreadable(raw) => Some(raw),
        }
    }
}

/// What a caller-aware profile write must leave alone (ADR #35 D6).
///
/// Exists because a sensitive field can be absent from an update for a reason
/// that is not a decision: the caller was never permitted to read it, so the
/// read withheld it and they cannot honestly supply it back. Such a field has
/// to be preserved rather than required (which forces an invented value) or
/// blanked (which silently destroys the real one).
///
/// The policy is the *caller's* half of that judgement; the other half is read
/// from the stored bytes, which can independently say "unreadable, keep it".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SensitiveWritePolicy {
    /// Preserve the stored identity record — `national_id`, its uniqueness
    /// hash, and the plaintext `national_id_type` / `tax_id` that go with it —
    /// for any field the caller sent no value for. Set this when the editor
    /// does not hold `staff:read_identity`.
    pub keep_identity_record: bool,
    /// Preserve the stored `monthly_take_home_minor` when the caller sent none.
    ///
    /// Set this by any surface that does not OWN payroll: leaving it unset
    /// means an update that omits the field clears it, which is the right
    /// semantic for the payroll surface that displays the amount and can clear
    /// it deliberately, and the wrong one for a staff screen that never shows
    /// it. Note this also lifts the field's required-ness, so a surface that
    /// keeps the pay column must still collect it at creation.
    pub keep_pay: bool,
}

/// The stored sensitive columns of one user row, read by
/// [`Store::write_user_profile_with`] before it binds anything.
struct StoredColumns {
    /// `national_id` (ciphertext).
    national_id: StoredCipher,
    /// `national_id_hash` — the uniqueness proof of the value still stored, so
    /// it is preserved together with a preserved ciphertext.
    national_id_hash: Option<String>,
    /// `monthly_take_home_minor` (ciphertext).
    pay: StoredCipher,
    /// `national_id_type` (plaintext) — withheld with the national id, and
    /// preserved with it so a caller who cannot read the document cannot
    /// re-label it either.
    national_id_type: Option<String>,
    /// `tax_id` (plaintext, withheld under `staff:read_identity`). Plaintext,
    /// so it needs no cipher handling — only the same preserve-on-withheld rule.
    tax_id: Option<String>,
}

impl Store<'_> {
    /// Read the raw (still-encrypted) sensitive profile columns of `user_id`.
    ///
    /// Read-only, so it is safe inside a caller-owned transaction (no nested
    /// BEGIN). A row that does not (yet) exist classifies as all-empty, which
    /// leaves the `NotFound` verdict to the UPDATE itself rather than here.
    /// The narrow race between this read and the write fails safe: the worst
    /// case is re-binding a value that was just replaced, never erasing a seal.
    fn stored_sensitive_columns(&self, user_id: &str) -> Result<StoredColumns, CoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT national_id, national_id_hash, monthly_take_home_minor, \
                 national_id_type, tax_id \
                 FROM users WHERE id = ?1",
                params![user_id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;
        let (national_id, national_id_hash, pay, national_id_type, tax_id) =
            row.unwrap_or_default();
        Ok(StoredColumns {
            national_id: StoredCipher::classify(national_id),
            national_id_hash,
            pay: StoredCipher::classify_pay(pay),
            national_id_type,
            tax_id,
        })
    }
}

impl Store<'_> {
    /// Load a user's profile, or `None` when the user does not exist.
    ///
    /// Returns the *decrypted* sensitive values (national id, monthly pay).
    /// This is the domain accessor — callers must enforce the explicit
    /// sensitive grants before exposing these; use
    /// [`Store::get_user_profile_viewed_by`] for the enforcement-aware path.
    pub fn get_user_profile(&self, user_id: &str) -> Result<Option<UserProfile>, CoreError> {
        let sql = format!("SELECT {PROFILE_COLUMNS} FROM users WHERE id = ?1");
        let profile = self
            .conn
            .query_row(&sql, params![user_id], |row| {
                let pay_cipher: Option<String> = row.get(5)?;
                let monthly_take_home_minor =
                    decrypt_sensitive(pay_cipher).and_then(|s| s.parse::<i64>().ok());
                Ok(UserProfile {
                    date_of_birth: row.get(0)?,
                    phone: row.get(1)?,
                    national_id_type: row.get(2)?,
                    national_id: decrypt_sensitive(row.get(3)?),
                    email: row.get(4)?,
                    monthly_take_home_minor,
                    emergency_contact_name: row.get(6)?,
                    emergency_contact_phone: row.get(7)?,
                    job_title: row.get(8)?,
                    notes: row.get(9)?,
                    address: row.get(10)?,
                    language: row.get(11)?,
                    avatar: row.get(12)?,
                    tax_id: row.get(13)?,
                    national_id_expires_at: row.get(14)?,
                    emergency_contact_relationship: row.get(15)?,
                    hire_date: row.get(16)?,
                })
            })
            .optional()?;
        Ok(profile)
    }

    /// Create a user with the full profile contract: validates the 9
    /// mandatory fields, inserts the user + default global assignment, then
    /// writes the profile columns — all in one transaction so a profile
    /// conflict (duplicate email / national id) rolls the user back instead
    /// of leaving a partial row. When `assignment` is `Some`, the user's
    /// single effective assignment is set to that scope instead of the
    /// default global one, atomically with the rest (spec 0048). An armed
    /// staff-quota verdict (see `quota_gate`) is vetoed in-tx right after the
    /// user insert, mirroring [`Store::create_user`](crate::db::staff).
    pub fn create_user_with_profile(
        &self,
        username: &str,
        pin_hash: &str,
        display_name: &str,
        role_id: &str,
        profile: &UserProfile,
        assignment: Option<&crate::db::assignments::AssignmentSpec>,
    ) -> Result<crate::User, CoreError> {
        profile.validate()?;
        let tx = self.conn.unchecked_transaction()?;
        let store = Store::new(&tx);
        let user = store.create_user_in_tx(username, pin_hash, display_name, role_id)?;
        // W8-C3b: mirror of the staff veto in db/staff.rs::create_user — the
        // command-layer staff door (commands/staff.rs create_staff_scoped in
        // both clients) calls THIS fn, so the race closure of 202af4066 left
        // open only for the profile path closes here. The pre-tx
        // enforce_staff_quota armed this tier on this Store; re-check the
        // count AFTER the insert, inside this fn's existing transaction (no
        // nested BEGIN: create_user_in_tx writes on the tx connection), so
        // the verdict and the user+profile write commit or roll back
        // together. Post-insert because a pre-insert count under WAL would
        // read only its own snapshot. Literal counting predicate of
        // count_staff_users (active, owner excluded) — the veto must not
        // disagree with the gate that armed it. An un-armed Store (pre-auth
        // bootstrap) is the legacy un-gated path: take_armed_quota returns
        // None.
        let tier = self.take_armed_quota(QuotaDimension::Staff);
        if let Some(limit) = tier
            .as_ref()
            .and_then(|t| QuotaDimension::Staff.limit_for(t))
        {
            let current: i64 = tx.query_row(
                "SELECT COUNT(*) FROM users WHERE is_active = 1 AND role_id != ?1",
                params![crate::builtin_roles::OWNER],
                |r| r.get(0),
            )?;
            if current > limit {
                tx.rollback()?;
                return Err(crate::subscription::QuotaError::StaffLimit {
                    tier: tier.as_ref().map(|t| t.name().into()).unwrap_or_default(),
                    limit,
                    current: current - 1,
                }
                .into());
            }
        }
        store.write_user_profile(&user.id, profile)?;
        if let Some(spec) = assignment {
            store.write_assignment_scope(&user.id, role_id, spec)?;
        }
        tx.commit()?;
        Ok(user)
    }

    /// Update a user's profile columns (validated). Single-statement and
    /// therefore atomic on its own — safe to call inside an existing
    /// transaction (no nested BEGIN).
    pub fn update_user_profile(
        &self,
        user_id: &str,
        profile: &UserProfile,
    ) -> Result<(), CoreError> {
        self.write_user_profile(user_id, profile)
    }

    /// Point `user_id` at a content-addressed avatar image, or clear it.
    ///
    /// `hash` is the 16-hex-char content hash the image ingest pipeline
    /// produces (`kasirmu-bridge`); `None` clears the column back to "no
    /// photo". The value deliberately does NOT go through
    /// [`Store::write_user_profile`]: that path re-encrypts the sensitive
    /// columns and would need the whole profile read back first, which turns a
    /// single avatar change into a read-modify-write over fields this call has
    /// no business touching. `avatar` is not a sensitive column, so one UPDATE
    /// is sufficient and atomic on its own — safe inside an existing
    /// transaction (no nested BEGIN).
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::NotFound`] when no user has that id, and
    /// [`CoreError::Db`] on store failures.
    pub fn set_user_avatar(&self, user_id: &str, hash: Option<&str>) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let changed = self.conn.execute(
            "UPDATE users SET avatar = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![hash, now, user_id],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound {
                entity: "user",
                id: user_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Read `user_id`'s avatar hash, or `None` when no photo is set.
    ///
    /// Deliberately narrow rather than a projection of
    /// [`Store::get_user_profile`]: that read fails closed on an undecryptable
    /// sensitive column and returns `None` for the whole profile, which would
    /// silently drop a perfectly good avatar because an unrelated national-id
    /// ciphertext moved with the hardware key.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Db`] on store failures. A missing user is reported
    /// as `Ok(None)` — the caller has already established identity.
    pub fn get_user_avatar(&self, user_id: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT avatar FROM users WHERE id = ?1")?;
        let mut rows = stmt.query(rusqlite::params![user_id])?;
        match rows.next()? {
            Some(row) => Ok(row.get(0)?),
            None => Ok(None),
        }
    }

    /// The shared profile-column write, with no caller to withhold anything
    /// from: validates, encrypts the sensitive fields (national id, monthly
    /// pay), records the national-id uniqueness hash, and issues one UPDATE.
    /// Duplicate email / national id surface as field-level conflicts via the
    /// unique indexes.
    ///
    /// Use this from creation and from any path with no session — see
    /// [`Store::write_user_profile_with`] for the caller-aware form, and
    /// [`SensitiveWritePolicy`] for why a caller-aware write needs one.
    pub fn write_user_profile(
        &self,
        user_id: &str,
        profile: &UserProfile,
    ) -> Result<(), CoreError> {
        self.write_user_profile_with(SensitiveWritePolicy::default(), user_id, profile)
    }

    /// The shared profile-column write on behalf of a known caller, governed by
    /// `policy`.
    ///
    /// ## A column nobody could read is never erased, and never required
    ///
    /// Both read paths fail closed, so a sensitive column reaches an editor as
    /// `None` in TWO different situations that look identical:
    ///
    /// * the stored ciphertext no longer decrypts (the hardware-derived key
    ///   moved: a `machine_id` flip after a restore onto different hardware);
    /// * the caller does not hold the field's read grant, so the view withheld
    ///   it — see [`ProfileView::identity_withheld`].
    ///
    /// In both, the ciphertext may still be perfectly good, and a caller that
    /// round-trips the view straight back into a save must not turn that
    /// ambiguity into a write of NULL over it. The withheld case has a second
    /// failure mode that the unreadable case does not: validation *required* the
    /// field, so the only way to save at all was to type a value — replacing a
    /// document the caller was never allowed to see with one they invented. So
    /// the states are re-separated here, from the stored bytes rather than from
    /// anything the read path inferred:
    ///
    /// * caller sent a value → encrypt it (a value that failed to decrypt is
    ///   never re-wrapped — only what the caller supplied is ever encrypted);
    /// * caller sent nothing and `policy` keeps the field, or the stored bytes
    ///   are unreadable → re-bind the stored ciphertext (and its uniqueness
    ///   hash) so the column stays byte-identical, and accept the missing value
    ///   in validation — the field is collected, merely not this caller's to
    ///   supply;
    /// * caller sent nothing and `policy` does not keep the field → the field is
    ///   the caller's to decide, so validation applies: a field that is
    ///   mandatory at creation (national id, pay) is REFUSED when omitted, and
    ///   an optional one (tax id, notes) is cleared. Neither is a preserve —
    ///   which is exactly why a caller who was never shown the value needs the
    ///   policy rather than this branch. Omitting is not a way to clear a
    ///   mandatory field, and being asked to supply one is how the caller ends
    ///   up inventing a document they cannot read.
    ///
    /// The identity record moves as a unit: `national_id_type` is preserved
    /// with the national id it labels, and `tax_id` with them, so a caller who
    /// cannot read the document cannot blank or re-label it either. A caller
    /// who *does* supply a national id is writing the identity deliberately and
    /// their type is taken as sent.
    pub fn write_user_profile_with(
        &self,
        policy: SensitiveWritePolicy,
        user_id: &str,
        profile: &UserProfile,
    ) -> Result<(), CoreError> {
        let stored = self.stored_sensitive_columns(user_id)?;
        // A read failure is never evidence of an empty field, and a withheld
        // read is not evidence of one either: the unreadable case is kept
        // because nobody decided to clear it, the withheld case because the
        // caller was never shown it. Both are kept byte-for-byte.
        let keep_national_id = profile.national_id.is_none()
            && (policy.keep_identity_record || stored.national_id.preserve().is_some());
        let keep_pay = profile.monthly_take_home_minor.is_none()
            && (policy.keep_pay || stored.pay.preserve().is_some());
        profile.validate_with_preserved(keep_national_id, keep_pay)?;
        let national_id_cipher = match profile.national_id.as_deref() {
            Some(plain) => Some(encrypt_profile_field(plain)?),
            None if keep_national_id => stored.national_id.raw().map(str::to_owned),
            None => None,
        };
        let pay_cipher = match profile.monthly_take_home_minor {
            Some(pay) => Some(encrypt_profile_field(&pay.to_string())?),
            None if keep_pay => stored.pay.raw().map(str::to_owned),
            None => None,
        };
        let national_id_hash = match profile.national_id.as_deref() {
            Some(plain) => Some(sha256_hex(plain)),
            // The hash is the uniqueness proof of the value still in the
            // column, so it is preserved with it — dropping it would leave a
            // preserved or unreadable national id able to collide silently.
            None if keep_national_id => stored.national_id_hash,
            None => None,
        };
        // The id's plaintext type travels with the id. A caller writing an id is
        // writing the identity and their type is taken as sent; a caller being
        // kept out of the id keeps the type that labels it, so the pair can
        // never disagree about which document is stored.
        let national_id_type = if policy.keep_identity_record && profile.national_id.is_none() {
            stored.national_id_type
        } else {
            profile.national_id_type.clone()
        };
        let tax_id = if policy.keep_identity_record && profile.tax_id.is_none() {
            stored.tax_id
        } else {
            profile.tax_id.clone()
        };
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let sql =
            format!("UPDATE users SET {PROFILE_ASSIGNMENTS}, updated_at = ?19 WHERE id = ?20");
        let result = self.conn.execute(
            &sql,
            params![
                &profile.date_of_birth,
                &profile.phone,
                &national_id_type,
                national_id_cipher,
                national_id_hash,
                &profile.email,
                pay_cipher,
                &profile.emergency_contact_name,
                &profile.emergency_contact_phone,
                &profile.job_title,
                &profile.notes,
                &profile.address,
                &profile.language,
                &profile.avatar,
                &tax_id,
                &profile.national_id_expires_at,
                &profile.emergency_contact_relationship,
                &profile.hire_date,
                now,
                user_id
            ],
        );
        match result {
            Err(rusqlite::Error::SqliteFailure(f, msg))
                if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                let msg = msg.unwrap_or_default().to_lowercase();
                if msg.contains("users.email") {
                    return Err(CoreError::Conflict {
                        entity: "user",
                        field: "email",
                    });
                }
                // Order matters: the hash message contains "users.national_id".
                if msg.contains("users.national_id_hash") || msg.contains("users.national_id") {
                    return Err(CoreError::Conflict {
                        entity: "user",
                        field: "national_id",
                    });
                }
                Err(rusqlite::Error::SqliteFailure(f, None).into())
            }
            Err(e) => Err(e.into()),
            Ok(0) => Err(CoreError::NotFound {
                entity: "user",
                id: user_id.to_owned(),
            }),
            Ok(_) => Ok(()),
        }
    }

    /// The profile of `target_user_id` as seen by `viewer_user_id`: the
    /// sensitive fields (national id, tax id, monthly pay) are returned in
    /// full only when the viewer holds the explicit sensitive grants, and
    /// every such read produces an audit event recording access (never
    /// values). The national id always renders last-4 masked.
    pub fn get_user_profile_viewed_by(
        &self,
        viewer_user_id: &str,
        target_user_id: &str,
    ) -> Result<Option<ProfileView>, CoreError> {
        let Some(profile) = self.get_user_profile(target_user_id)? else {
            return Ok(None);
        };
        let Some(user) = self.get_user(target_user_id)? else {
            return Ok(None);
        };

        let read_identity =
            self.holds_permission(viewer_user_id, permissions::STAFF_READ_IDENTITY)?;
        let read_payroll =
            self.holds_permission(viewer_user_id, permissions::STAFF_READ_PAYROLL)?;

        if read_identity {
            self.log_audit(&AuditEntry::new(
                viewer_user_id,
                "staff.identity.read",
                Some("user"),
                Some(target_user_id),
                Some(r#"{"fields":["national_id","tax_id"]}"#),
                "success",
            ))?;
        }
        if read_payroll {
            self.log_audit(&AuditEntry::new(
                viewer_user_id,
                "staff.payroll.read",
                Some("user"),
                Some(target_user_id),
                Some(r#"{"fields":["monthly_take_home_minor"]}"#),
                "success",
            ))?;
        }

        let is_complete = profile.is_complete();
        let national_id_masked = profile
            .national_id
            .as_deref()
            .map(mask_last4)
            .unwrap_or_else(|| "****".to_string());
        Ok(Some(ProfileView {
            username: user.username,
            display_name: user.display_name,
            date_of_birth: profile.date_of_birth,
            phone: profile.phone,
            national_id_type: profile.national_id_type,
            national_id: if read_identity {
                profile.national_id.clone()
            } else {
                None
            },
            national_id_masked,
            email: profile.email,
            monthly_take_home_minor: if read_payroll {
                profile.monthly_take_home_minor
            } else {
                None
            },
            emergency_contact_name: profile.emergency_contact_name,
            emergency_contact_phone: profile.emergency_contact_phone,
            job_title: profile.job_title,
            notes: profile.notes,
            address: profile.address,
            language: profile.language,
            avatar: profile.avatar,
            tax_id: if read_identity { profile.tax_id } else { None },
            national_id_expires_at: profile.national_id_expires_at,
            emergency_contact_relationship: profile.emergency_contact_relationship,
            hire_date: profile.hire_date,
            is_complete,
            // The two fields above that read as `None` here are `None` for
            // exactly one reason each, and a writer has to be able to tell
            // which — see the field's own doc. `national_id`/`tax_id` are the
            // withheld pair; payroll is not editable from a staff screen at
            // all, so it needs no marker here.
            identity_withheld: !read_identity,
        }))
    }

    /// Pure gate for [`Store::assign_role_guarded`]: a role that grants
    /// sensitive permissions cannot be assigned to a user whose profile is
    /// incomplete (ADR #35 D6). Only fires when the role actually changes —
    /// re-saving the same role (e.g. editing a name) is not a new grant.
    /// Transaction-safe — call it before any role write inside an existing
    /// transaction.
    pub fn require_role_assignable(
        &self,
        target_user_id: &str,
        new_role_id: &str,
    ) -> Result<(), CoreError> {
        let current_role = self
            .get_user(target_user_id)?
            .map(|u| u.role_id)
            .unwrap_or_default();
        if current_role == new_role_id {
            return Ok(());
        }
        let profile =
            self.get_user_profile(target_user_id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "user",
                    id: target_user_id.to_owned(),
                })?;
        if !profile.is_complete() && self.role_grants_sensitive(new_role_id)? {
            return Err(CoreError::Validation {
                field: "profile",
                message: "incomplete profile blocks management-role assignment; complete the profile first"
                    .into(),
            });
        }
        Ok(())
    }

    /// Assign a role, but deny when the target user's profile is
    /// incomplete and the new role grants any sensitive permission (ADR #35
    /// D6: management-role assignment and sensitive grants require a
    /// complete profile). Non-sensitive roles stay assignable so legacy
    /// incomplete users can keep working at the checkout.
    pub fn assign_role_guarded(
        &self,
        target_user_id: &str,
        new_role_id: &str,
    ) -> Result<crate::User, CoreError> {
        self.require_role_assignable(target_user_id, new_role_id)?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // C18 P3: `users.role_id` and the `assignments.role_id` mirror are ONE
        // logical write — the two rows are the same fact stored twice (the
        // second is what the scope gate reads). A failure between them would
        // leave a user whose role row and whose assignment disagree, which is
        // exactly the state the assignment path exists to prevent. Own-or-join:
        // SQLite has no nested BEGIN, so a caller that already holds one keeps
        // it and owns the commit.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "UPDATE users SET role_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_role_id, now, target_user_id],
        )?;
        self.conn.execute(
            "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, updated_at)
             VALUES (?1, ?2, 'global', 'all', 'all', ?3)
             ON CONFLICT(user_id) DO UPDATE SET role_id = excluded.role_id, updated_at = excluded.updated_at",
            params![target_user_id, new_role_id, now],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        self.get_user(target_user_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "user",
                id: target_user_id.to_owned(),
            })
    }

    /// Whether a role's grant set contains any sensitive permission (or the
    /// global `*`, which the Owner seed alone may hold).
    fn role_grants_sensitive(&self, role_id: &str) -> Result<bool, CoreError> {
        let perms: Option<String> = self
            .conn
            .query_row(
                "SELECT permissions FROM roles WHERE id = ?1",
                params![role_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(perms) = perms else { return Ok(false) };
        let granted: Vec<String> = serde_json::from_str(&perms).unwrap_or_default();
        Ok(granted
            .iter()
            .any(|g| g == "*" || permission_registry::is_sensitive(g)))
    }

    /// Grant check that treats a denied verdict as `false` rather than an
    /// error (unknown viewer / missing grant both deny, fail closed).
    ///
    /// Public because a *write* needs the same answer as a read: whether this
    /// caller holds a sensitive read grant decides which columns their update
    /// must preserve — see [`SensitiveWritePolicy`]. Answering it with
    /// [`Store::require_permission`] at each call site would re-implement the
    /// fail-closed mapping and eventually disagree with this one.
    pub fn holds_permission(&self, user_id: &str, key: &str) -> Result<bool, CoreError> {
        match self.require_permission(user_id, key) {
            Ok(()) => Ok(true),
            Err(CoreError::PermissionDenied(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;
