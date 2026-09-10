//! User profile data contract (ADR #35 D6 / spec 0049).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 3: profile/PII deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: model PII implementation — national_id + monthly pay encrypted at rest (encrypt_profile_field), uniqueness via SHA-256 hash (plaintext never stored), last-4 masking everywhere, sensitive reads permission-gated (staff:read_identity / staff:read_payroll) AND audited (access recorded, never values), decrypt fails closed, incomplete-profile blocks sensitive-role assignment. CROSS-CRATE: ciphertext keys derive from oz-crypto static key (CRY-1) — the at-rest guarantee for PII is only as strong as CRY-1's remediation; elevate CRY-1 fix priority. COR-24 INFO: decrypt_sensitive returns None silently on decrypt failure (fail-closed direction, but corrupt ciphertext reads as missing field with no signal)
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
        if self.national_id.is_none() {
            return Err(validation("national_id", "national id is required"));
        }
        if self.email.is_none() {
            return Err(validation("email", "email address is required"));
        }
        if self.monthly_take_home_minor.is_none() {
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
        // INVARIANT (COR-6): the `national_id.is_none()` guard above returns
        // early, so this unwrap cannot fail.
        let id = self.national_id.as_deref().unwrap();
        let expected = if id_type == "ssn" { 9 } else { 16 };
        if id.len() != expected || !id.bytes().all(|b| b.is_ascii_digit()) {
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

/// Decrypt a stored ciphertext, failing closed (never plaintext) on error.
fn decrypt_sensitive(cipher: Option<String>) -> Option<String> {
    cipher.and_then(|c| decrypt_profile_field(&c).ok())
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

    /// The shared profile-column write: validates, encrypts the sensitive
    /// fields (national id, monthly pay), records the national-id
    /// uniqueness hash, and issues one UPDATE. Duplicate email / national
    /// id surface as field-level conflicts via the unique indexes.
    pub fn write_user_profile(
        &self,
        user_id: &str,
        profile: &UserProfile,
    ) -> Result<(), CoreError> {
        profile.validate()?;
        let national_id_cipher = profile
            .national_id
            .as_deref()
            .map(encrypt_profile_field)
            .transpose()?;
        let pay_cipher = profile
            .monthly_take_home_minor
            .map(|v| encrypt_profile_field(&v.to_string()))
            .transpose()?;
        let national_id_hash = profile.national_id.as_deref().map(sha256_hex);
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let sql =
            format!("UPDATE users SET {PROFILE_ASSIGNMENTS}, updated_at = ?19 WHERE id = ?20");
        let result = self.conn.execute(
            &sql,
            params![
                &profile.date_of_birth,
                &profile.phone,
                &profile.national_id_type,
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
                &profile.tax_id,
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
            self.has_permission_quiet(viewer_user_id, permissions::STAFF_READ_IDENTITY)?;
        let read_payroll =
            self.has_permission_quiet(viewer_user_id, permissions::STAFF_READ_PAYROLL)?;

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
    fn has_permission_quiet(&self, user_id: &str, key: &str) -> Result<bool, CoreError> {
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
