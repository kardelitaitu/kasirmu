//! Basic security events — the auth-path half of the audit baseline
//! (todo-global-saas-2.md P1 "audit baseline and retention schedule").
//!
//! `db/audit.rs` owns the append-only `audit_log` store and the tier
//! retention sweep. This file owns the one event class that schedule was
//! adopted to protect and that nothing was emitting: authentication
//! outcomes. `Store::record_security_event` writes through the SAME
//! `log_audit` INSERT path, so the immutability triggers from
//! 20260813_init.sql apply unchanged and no trigger carve-out is needed —
//! the 20260920 exemption exists only for DELETE.
//!
//! Key type: [`SecurityEvent`]. Key constants: `SECURITY_ACTION_*`,
//! `SECURITY_REASON_*`, `SYSTEM_ACTOR`.
//!
//! Invariants:
//! - A credential never reaches this table. The recorder accepts no PIN or
//!   hash at all, and `log_audit` redacts the AUD-06 key list as a second
//!   line of defence.
//! - The action strings are the ones `ui/src/features/audit/auditCatalog.ts`
//!   already maps to Fluent labels (`login`, `login.failed`); `logout` has
//!   no label yet and renders through the catalog's fallback.
//! - Free records nothing, because Free has no retention entitlement — the
//!   sweep would purge the rows on the next tick anyway.

use crate::AuditEntry;
use crate::error::CoreError;

use super::Store;

/// Action recorded for a successful staff login. Matches the entry
/// `auditCatalog.ts` already maps to `audit-action-login`.
pub const SECURITY_ACTION_LOGIN: &str = "login";

/// Action recorded for a rejected login attempt. Maps to
/// `audit-action-login-failed` and is in the catalog's `CRITICAL_ACTIONS`
/// set, so the audit screen renders it with critical emphasis.
pub const SECURITY_ACTION_LOGIN_FAILED: &str = "login.failed";

/// Action recorded when a session is destroyed (logout / store switch).
///
/// This one has NO Fluent label yet — see the module notes and
/// `coder-3-journal.md`: it renders through the audit catalog's
/// unknown-action fallback until the locale window opens.
pub const SECURITY_ACTION_LOGOUT: &str = "logout";

/// Action recorded when an admin creates a staff account. Already in
/// `auditCatalog.ts`, and already in its `CRITICAL_ACTIONS` set, so the
/// audit screen gives it critical emphasis with no front-end change.
pub const SECURITY_ACTION_USER_CREATE: &str = "user.create";

/// Action recorded when an admin changes a staff account — role, display
/// name, active flag, or PIN. Also already catalogued and critical.
///
/// A PIN rotation deliberately reuses this action rather than inventing
/// `user.pin_change`: the catalog has no such key, and adding one would
/// strand a label. The rotation is still separable — it is the only
/// `user.update` row carrying `reason = "pin_rotated"`.
pub const SECURITY_ACTION_USER_UPDATE: &str = "user.update";

/// The security-event action set, and the allow-list
/// [`Store::list_security_events`] filters the audit table by.
///
/// A new security action must be added HERE as well as getting a
/// constructor, or its rows are written and then never readable.
pub const SECURITY_ACTIONS: &[&'static str] = &[
    SECURITY_ACTION_LOGIN,
    SECURITY_ACTION_LOGIN_FAILED,
    SECURITY_ACTION_LOGOUT,
    SECURITY_ACTION_USER_CREATE,
    SECURITY_ACTION_USER_UPDATE,
];

/// `audit_log.user_id` for an event with no resolved account — the unknown
/// username case, where there is no `users` row to point at.
pub const SYSTEM_ACTOR: &str = "system";

/// Failure classifier: no account matched the submitted username.
pub const SECURITY_REASON_UNKNOWN_USER: &str = "unknown_user";
/// Failure classifier: the account exists but is deactivated.
pub const SECURITY_REASON_INACTIVE: &str = "account_inactive";
/// Failure classifier: the account is active and the PIN did not verify.
pub const SECURITY_REASON_BAD_PIN: &str = "wrong_pin";
/// Failure classifier: the attempt was refused by the STAFF-07 limiter
/// before any credential was checked.
pub const SECURITY_REASON_RATE_LIMITED: &str = "rate_limited";
/// Administrative classifier: the account was created.
pub const SECURITY_REASON_ACCOUNT_CREATED: &str = "account_created";
/// Administrative classifier: role, display name or active flag changed.
pub const SECURITY_REASON_PROFILE_CHANGED: &str = "profile_changed";
/// Administrative classifier: the PIN was rotated, which also dropped every
/// other session for the account (STAFF-03).
pub const SECURITY_REASON_PIN_ROTATED: &str = "pin_rotated";

/// One authentication outcome to persist.
///
/// Construct through [`SecurityEvent::login_success`],
/// [`SecurityEvent::login_failed`] or [`SecurityEvent::logout`] rather than
/// the struct literal: the constructors fix the action/outcome pair to the
/// vocabulary the audit catalog renders, so a call site cannot invent an
/// action the screen would show as "Unknown Action".
#[derive(Debug, Clone)]
pub struct SecurityEvent {
    /// `users.id`, or [`SYSTEM_ACTOR`] when no account resolved.
    pub user_id: String,
    /// The submitted or resolved username — the only identity available for
    /// an unknown-account attempt, and the field an investigator filters on.
    pub username: String,
    /// One of `SECURITY_ACTION_*`.
    pub action: &'static str,
    /// `"success"` or `"failure"` — the two values
    /// `OUTCOME_FLUENT_IDS` maps.
    pub outcome: &'static str,
    /// Failure classifier, `None` on success. Never a secret.
    pub reason: Option<&'static str>,
    /// Terminal the attempt came from (the STAFF-07 device id), when known.
    pub device_id: Option<String>,
    /// The account the event is ABOUT when it is NOT the actor: an admin
    /// changing someone else's staff record. `None` means the subject is the
    /// actor, which is every authentication event — a login is self-caused.
    /// Lands in `target_id` when set.
    pub subject_id: Option<String>,
}

impl SecurityEvent {
    /// An accepted PIN check.
    #[must_use]
    pub fn login_success(
        user_id: impl Into<String>,
        username: impl Into<String>,
        device_id: Option<impl Into<String>>,
    ) -> Self {
        Self {
            user_id: user_id.into(),
            username: username.into(),
            action: SECURITY_ACTION_LOGIN,
            outcome: "success",
            reason: None,
            device_id: device_id.map(Into::into),
            subject_id: None,
        }
    }

    /// A refused login attempt. `user_id` is `None` for the unknown-account
    /// case, where there is no row to reference.
    #[must_use]
    pub fn login_failed(
        username: impl Into<String>,
        reason: &'static str,
        user_id: Option<&str>,
        device_id: Option<impl Into<String>>,
    ) -> Self {
        Self {
            user_id: user_id
                .map(str::to_string)
                .unwrap_or_else(|| SYSTEM_ACTOR.into()),
            username: username.into(),
            action: SECURITY_ACTION_LOGIN_FAILED,
            outcome: "failure",
            reason: Some(reason),
            device_id: device_id.map(Into::into),
            subject_id: None,
        }
    }

    /// A destroyed session. Always carries a resolved user, since a session
    /// exists only for one.
    #[must_use]
    pub fn logout(
        user_id: impl Into<String>,
        username: impl Into<String>,
        device_id: Option<impl Into<String>>,
    ) -> Self {
        Self {
            user_id: user_id.into(),
            username: username.into(),
            action: SECURITY_ACTION_LOGOUT,
            outcome: "success",
            reason: None,
            device_id: device_id.map(Into::into),
            subject_id: None,
        }
    }

    /// An administrative change to ANOTHER staff account.
    ///
    /// `actor_id` is who made the change and lands in `audit_log.user_id`,
    /// matching the house convention already used by `staff.identity.read`
    /// (which records the viewer, not the viewed). `subject_id` is the account
    /// changed and lands in `target_id`. `action` must be one of
    /// [`SECURITY_ACTION_USER_CREATE`] / [`SECURITY_ACTION_USER_UPDATE`] and
    /// `reason` one of the administrative `SECURITY_REASON_*` classifiers; both
    /// are static string slices, so a call site cannot invent an uncatalogued
    /// action at runtime.
    #[must_use]
    pub fn staff_change(
        actor_id: impl Into<String>,
        subject_id: impl Into<String>,
        subject_username: impl Into<String>,
        action: &'static str,
        reason: &'static str,
    ) -> Self {
        Self {
            user_id: actor_id.into(),
            username: subject_username.into(),
            action,
            outcome: "success",
            reason: Some(reason),
            device_id: None,
            subject_id: Some(subject_id.into()),
        }
    }

    /// Row identity the event points at: the subject of an administrative
    /// change, else the actor's own account, else — for an unresolved login
    /// attempt — the attempted username, so a brute-force pattern against a
    /// non-existent account is still groupable in `target_id`.
    #[must_use]
    fn target_ref(&self) -> &str {
        if let Some(subject) = &self.subject_id {
            return subject;
        }
        if self.user_id == SYSTEM_ACTOR {
            &self.username
        } else {
            &self.user_id
        }
    }

    /// The `details` JSON: username, classifier and terminal only.
    fn details_json(&self) -> String {
        let mut map = serde_json::Map::new();
        map.insert(
            "username".into(),
            serde_json::Value::String(self.username.clone()),
        );
        if let Some(reason) = self.reason {
            map.insert("reason".into(), serde_json::Value::String(reason.into()));
        }
        if let Some(device) = &self.device_id {
            map.insert(
                "device_id".into(),
                serde_json::Value::String(device.clone()),
            );
        }
        serde_json::Value::Object(map).to_string()
    }
}

impl Store<'_> {
    /// Persist one basic security event, honouring the tier rule the adopted
    /// schedule states: **Free keeps no tenant-facing audit records, paid
    /// tiers keep them**.
    ///
    /// Returns whether a row was written (`false` = skipped by the tier
    /// gate). Never returns an error for a skipped event, so a caller cannot
    /// mistake "not recorded" for "recording is broken".
    ///
    /// The gate is expressed through
    /// [`SubscriptionTier::audit_retention_days`](crate::subscription::SubscriptionTier::audit_retention_days)
    /// rather than a second tier match: no retention entitlement means the
    /// sweep would purge the row on its next tick anyway, so writing it would
    /// be pointless as well as against the rule.
    ///
    /// # Fail-open on an unreadable subscription row
    ///
    /// This is the deliberate OPPOSITE of the retention sweep's fail-closed
    /// rule, and the asymmetry is the point. `build_entitlements` projects
    /// Free when the row is missing, tampered or unreadable — honouring that
    /// projection here would mean an attacker who corrupts one row turns off
    /// the security audit trail and then acts un-audited. The sweep skips on
    /// the same input because a purge is irreversible; a stray audit row costs
    /// nothing, while a missing security event costs the evidence. So the
    /// skip requires a CONFIRMED Free row (`loaded == true`), never the
    /// fail-closed guess of one.
    ///
    /// `debug_upgrade` is the caller's per-client policy, passed through
    /// unchanged: desktop's dev Free→Premium promotion records in a debug
    /// build and stays out of a release one (`apply_debug_upgrade` is
    /// `cfg!(debug_assertions)`-gated), and tablet passes `false` so it never
    /// mirrors the desktop divergence.
    ///
    /// Written through [`Store::log_audit`], so AUD-06 redaction and the
    /// append-only triggers apply. A caller that must not let an audit
    /// failure break authentication should log the `Err` and continue —
    /// both clients do.
    pub fn record_security_event(
        &self,
        event: &SecurityEvent,
        debug_upgrade: bool,
    ) -> Result<bool, CoreError> {
        let ent = crate::entitlements::build_entitlements(
            self,
            crate::availability::UsageCounts::default(),
            debug_upgrade,
        );
        if ent.loaded && ent.tier.audit_retention_days().is_none() {
            return Ok(false);
        }

        let entry = AuditEntry::new(
            event.user_id.clone(),
            event.action,
            Some("user".to_string()),
            Some(event.target_ref().to_string()),
            Some(event.details_json()),
            event.outcome,
        );
        self.log_audit(&entry)?;
        Ok(true)
    }

    /// Read the security-event slice of the audit trail.
    ///
    /// Identical page contract to [`Store::list_audit_entries_filtered`]:
    /// pages clamped to `[1, 200]`, a `(created_at, id)` keyset cursor, and a
    /// total counted before the cursor — but restricted to [`SECURITY_ACTIONS`],
    /// so an ordinary business-audit row can never appear here and a security
    /// row cannot be hidden by a business-events view. Both share one SQL
    /// builder, so the LIKE-escaping and cursor semantics cannot drift.
    ///
    /// This reads WHICHEVER database the caller opened, and that is the point.
    /// Identity is a global record in this design (ADR #4 / ADR #7: the
    /// store-scoped files contain no `users` rows), so the whole auth trail
    /// lives in the global DB while the ordinary audit screen reads a per-store
    /// file. A caller that wants both opens both connections — which is what
    /// the `_scoped` commands do.
    pub fn list_security_events(
        &self,
        outcome: Option<&str>,
        query: Option<&str>,
        before_created_at: Option<&str>,
        before_id: Option<&str>,
        limit: u64,
    ) -> Result<(Vec<AuditEntry>, u64, bool), CoreError> {
        self.list_audit_entries_page(
            outcome,
            query,
            before_created_at,
            before_id,
            limit,
            Some(SECURITY_ACTIONS),
        )
    }
}

#[cfg(test)]
#[path = "audit_security_tests.rs"]
mod tests;
