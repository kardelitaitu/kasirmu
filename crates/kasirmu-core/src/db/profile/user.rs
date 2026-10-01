//! User-profile read/write and the role guards that gate the sensitive fields.
//!
//! Split out of `db/profile.rs` on 2026-09-28. These are the `Store` methods that
//! load, write and view a user profile, plus the two role guards
//! (`require_role_assignable`, `assign_role_guarded`) and `holds_permission` that
//! decide whether a caller may see or set the encrypted columns.
//!
//! Invariant: a withheld sensitive field is PRESERVED, never blanked - the write
//! path re-reads the stored cipher and carries it forward, so a caller without
//! `staff:read_identity` cannot erase a value by writing without it.

use rusqlite::{OptionalExtension, params};

use crate::db::Store;
use crate::error::CoreError;

use crate::audit::AuditEntry;
use crate::crypto::encrypt_profile_field;
use crate::db::profile::mask_last4;
use crate::downgrade::QuotaDimension;
use crate::{permission_registry, permissions};

use super::{
    PROFILE_ASSIGNMENTS, PROFILE_COLUMNS, ProfileView, SensitiveWritePolicy, StoredCipher,
    UserProfile, decrypt_sensitive, sha256_hex,
};

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

    /// Whether either sensitive seal (`national_id`, `monthly_take_home_minor`)
    /// is present but does NOT decrypt under the current key set.
    ///
    /// COR-24: the display read ([`Self::get_user_profile`]) deliberately fails
    /// closed to `None`, which is indistinguishable from an empty column and from
    /// a value withheld by permission. That is the right answer for a renderer and
    /// the wrong one for an operator checking whether a key rotation or a storage
    /// fault has stranded PII ciphertext: this accessor is the distinction, read
    /// from the stored bytes with `StoredCipher`, with no plaintext ever
    /// escaping. It is a diagnostic, not a gate — it does not itself deny any
    /// read.
    pub fn user_profile_has_unreadable_seal(&self, user_id: &str) -> Result<bool, CoreError> {
        let columns = self.stored_sensitive_columns(user_id)?;
        Ok(matches!(columns.national_id, StoredCipher::Unreadable(_))
            || matches!(columns.pay, StoredCipher::Unreadable(_)))
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
            .map_or_else(|| "****".to_string(), mask_last4);
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
