//! `permission_registry` unit tests — registry inventory, grant
//! validation, and drift-prevention hardening, extracted from the
//! production file (F-018) per the AGENTS test-file rule.

use super::*;
use crate::rbac::{ALL_ENFORCED, permissions};

/// The sensitive keys per ADR #35 D2: voids, refunds, settlement,
/// role management, and bulk export are never wildcard-eligible.
fn is_expected_sensitive(key: &str) -> bool {
    matches!(
        key,
        permissions::SALES_VOID
                | permissions::SALES_REFUND
                | permissions::PAYMENTS_REFUND
                | permissions::PAYMENTS_SETTLE
                | permissions::STAFF_MANAGE_ROLES
                | permissions::STAFF_DELETE
                | permissions::STAFF_READ_IDENTITY
                | permissions::STAFF_READ_PAYROLL
                | permissions::STAFF_EDIT_NOTES
                | permissions::REPORTS_EXPORT
                | permissions::AUDIT_EXPORT
                // Review F-017 additions: money creation and crypto/bulk
                // export join the explicit sensitive set.
                | permissions::GIFTCARDS_ISSUE
                | permissions::SECURITY_MANAGE
                | permissions::DATA_EXPORT
                // AP write-off forgives a vendor debt (money destruction),
                // so it is never wildcard-eligible — mirrors giftcards:issue.
                | permissions::PAYABLES_WRITEOFF
    )
}

#[test]
fn every_permission_constant_is_registered() {
    for &p in ALL_ENFORCED {
        assert!(is_registered(p), "unregistered enforced key: {p}");
    }
}

#[test]
fn every_registry_key_is_a_known_constant() {
    for e in REGISTRY {
        assert!(
            ALL_ENFORCED.contains(&e.key),
            "registry key not in the constant inventory: {}",
            e.key
        );
    }
}

#[test]
fn sensitive_classification_is_explicit() {
    for &p in ALL_ENFORCED {
        let entry = lookup(p).expect("every enforced key must be registered");
        assert_eq!(
            entry.sensitive,
            is_expected_sensitive(p),
            "sensitive flag mismatch for {p}"
        );
    }
}

/// ADR #35 D6 / spec 0049: the profile sensitive keys are registered,
/// classified sensitive (never wildcard-eligible), granted to every
/// management preset, and deliberately withheld from Auditor.
#[test]
fn profile_sensitive_keys_are_registered_and_granted() {
    for key in [
        permissions::STAFF_READ_IDENTITY,
        permissions::STAFF_READ_PAYROLL,
        permissions::STAFF_EDIT_NOTES,
    ] {
        assert!(is_registered(key), "{key} must be registered");
        assert!(ALL_ENFORCED.contains(&key), "{key} must be in ALL_ENFORCED");
        let entry = lookup(key).expect("registered");
        assert!(entry.sensitive, "{key} must be classified sensitive");
        // Sensitive keys can never ride a family wildcard.
        assert!(
            validate_grant("staff:*", false).is_err(),
            "staff:* must reject {key}"
        );
    }

    // Management presets grant them; Staff (checkout-only) and Auditor
    // (read-only) are excluded.
    for preset in crate::rbac::ROLE_PRESETS {
        let grants = preset.permissions;
        match preset.id {
            crate::rbac::builtin_roles::MANAGER | crate::rbac::builtin_roles::ADMIN => {
                for key in [
                    permissions::STAFF_READ_IDENTITY,
                    permissions::STAFF_READ_PAYROLL,
                    permissions::STAFF_EDIT_NOTES,
                ] {
                    assert!(
                        grants.contains(&key),
                        "{} preset must grant {key}",
                        preset.id
                    );
                }
            }
            crate::rbac::builtin_roles::STAFF => {
                for key in [
                    permissions::STAFF_READ_IDENTITY,
                    permissions::STAFF_READ_PAYROLL,
                    permissions::STAFF_EDIT_NOTES,
                ] {
                    assert!(!grants.contains(&key), "Staff must NOT grant {key}");
                }
            }
            crate::rbac::builtin_roles::AUDITOR => {
                for key in [
                    permissions::STAFF_READ_IDENTITY,
                    permissions::STAFF_READ_PAYROLL,
                    permissions::STAFF_EDIT_NOTES,
                ] {
                    assert!(!grants.contains(&key), "Auditor must NOT grant {key}");
                }
            }
            _ => {}
        }
    }
}

/// Every family present in the registry, sorted for stable output.
fn families() -> Vec<&'static str> {
    let mut families: Vec<&'static str> = REGISTRY.iter().map(|e| e.family).collect();
    families.sort_unstable();
    families.dedup();
    families
}

#[test]
fn wildcard_is_rejected_for_every_family_with_a_sensitive_key() {
    for family in families() {
        let wildcard = format!("{family}:*");
        let has_sensitive = REGISTRY.iter().any(|e| e.family == family && e.sensitive);
        if has_sensitive {
            assert!(
                validate_grant(&wildcard, false).is_err(),
                "wildcard {wildcard} must be rejected: the family contains sensitive keys"
            );
        }
    }
}

#[test]
fn wildcard_is_accepted_for_every_family_without_sensitive_keys() {
    for family in families() {
        let wildcard = format!("{family}:*");
        let has_sensitive = REGISTRY.iter().any(|e| e.family == family && e.sensitive);
        if !has_sensitive {
            assert!(
                validate_grant(&wildcard, false).is_ok(),
                "operational wildcard {wildcard} must be allowed"
            );
        }
    }
}

#[test]
fn unknown_key_is_rejected() {
    assert_eq!(
        validate_grant("sales:typo", false),
        Err(RegistryError::UnknownKey("sales:typo".into()))
    );
    assert_eq!(
        validate_grant("unknown:*", false),
        Err(RegistryError::UnknownKey("unknown:*".into()))
    );
}

#[test]
fn exact_sensitive_key_is_allowed() {
    // Explicit grants are the sanctioned way to carry sensitive keys.
    assert!(validate_grant(permissions::SALES_VOID, false).is_ok());
    assert!(validate_grant(permissions::SALES_REFUND, false).is_ok());
    assert!(validate_grant(permissions::STAFF_MANAGE_ROLES, false).is_ok());
}

#[test]
fn global_wildcard_denied_unless_explicit() {
    assert_eq!(
        validate_grant("*", false),
        Err(RegistryError::GlobalWildcardDenied)
    );
    assert!(validate_grant("*", true).is_ok());
}

#[test]
fn registry_has_no_duplicate_keys() {
    let mut seen = std::collections::HashSet::new();
    for e in REGISTRY {
        assert!(seen.insert(e.key), "duplicate registry key: {}", e.key);
    }
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────

// ── lookup / is_registered / is_sensitive direct coverage ─────────

#[test]
fn lookup_returns_entry_for_registered_key() {
    let entry = lookup(permissions::SALES_VOID).expect("sales:void must be registered");
    assert_eq!(entry.key, "sales:void");
    assert_eq!(entry.family, "sales");
    assert!(entry.sensitive);
}

#[test]
fn lookup_returns_none_for_unknown_key() {
    assert!(lookup("sales:typo").is_none());
    assert!(lookup("unknown:key").is_none());
    assert!(lookup("").is_none());
}

#[test]
fn is_registered_true_for_known_keys() {
    assert!(is_registered(permissions::SALES_PROCESS));
    assert!(is_registered(permissions::SETTINGS_EDIT));
    assert!(is_registered(permissions::DATA_EXPORT));
}

#[test]
fn is_registered_false_for_unknown_keys() {
    assert!(!is_registered("sales:typo"));
    assert!(!is_registered("*"));
    assert!(!is_registered(""));
}

#[test]
fn is_sensitive_true_for_sensitive_keys() {
    assert!(is_sensitive(permissions::SALES_VOID));
    assert!(is_sensitive(permissions::STAFF_DELETE));
    assert!(is_sensitive(permissions::PAYMENTS_SETTLE));
    assert!(is_sensitive(permissions::GIFTCARDS_ISSUE));
    assert!(is_sensitive(permissions::SECURITY_MANAGE));
    assert!(is_sensitive(permissions::DATA_EXPORT));
}

#[test]
fn is_sensitive_false_for_operational_keys() {
    assert!(!is_sensitive(permissions::SALES_PROCESS));
    assert!(!is_sensitive(permissions::PRODUCTS_READ));
    assert!(!is_sensitive(permissions::SETTINGS_READ));
}

#[test]
fn is_sensitive_false_for_unknown_keys() {
    assert!(!is_sensitive("sales:typo"));
    assert!(!is_sensitive(""));
}

// ── validate_grants (multi-error collector) ───────────────────────

#[test]
fn validate_grants_ok_for_valid_set() {
    let grants = vec![
        permissions::SALES_PROCESS.to_string(),
        permissions::PRODUCTS_READ.to_string(),
        permissions::SETTINGS_EDIT.to_string(),
    ];
    assert!(validate_grants(&grants, false).is_ok());
}

#[test]
fn validate_grants_err_for_unknown_key() {
    let grants = vec![
        permissions::SALES_PROCESS.to_string(),
        "sales:typo".to_string(),
    ];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 1);
    assert!(matches!(&errs[0], RegistryError::UnknownKey(k) if k == "sales:typo"));
}

#[test]
fn validate_grants_collects_multiple_errors() {
    let grants = vec![
        "sales:typo".to_string(),
        "unknown:*".to_string(),
        "not:registered".to_string(),
    ];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 3);
}

#[test]
fn validate_grants_rejects_global_wildcard_when_not_allowed() {
    let grants = vec!["*".to_string()];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 1);
    assert!(matches!(&errs[0], RegistryError::GlobalWildcardDenied));
}

#[test]
fn validate_grants_allows_global_wildcard_when_permitted() {
    let grants = vec!["*".to_string()];
    assert!(validate_grants(&grants, true).is_ok());
}

#[test]
fn validate_grants_rejects_sensitive_wildcard() {
    let grants = vec!["sales:*".to_string()];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 1);
    assert!(matches!(&errs[0], RegistryError::SensitiveUnderWildcard(w, _) if w == "sales:*"));
}

#[test]
fn validate_grants_empty_set_is_ok() {
    let grants: Vec<String> = vec![];
    assert!(validate_grants(&grants, false).is_ok());
}

#[test]
fn validate_grants_mix_of_valid_and_invalid() {
    let grants = vec![
        permissions::SALES_PROCESS.to_string(),
        "sales:typo".to_string(),
        permissions::PRODUCTS_READ.to_string(),
    ];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 1);
    assert!(matches!(&errs[0], RegistryError::UnknownKey(k) if k == "sales:typo"));
}

// ── RegistryError Display ─────────────────────────────────────────

#[test]
fn registry_error_unknown_key_display() {
    let err = RegistryError::UnknownKey("sales:typo".into());
    let msg = err.to_string();
    assert!(msg.contains("sales:typo"));
    assert!(msg.contains("unregistered"));
}

#[test]
fn registry_error_sensitive_wildcard_display() {
    let err =
        RegistryError::SensitiveUnderWildcard("sales:*".into(), "sales:void, sales:refund".into());
    let msg = err.to_string();
    assert!(msg.contains("sales:*"));
    assert!(msg.contains("sensitive"));
    assert!(msg.contains("sales:void"));
}

#[test]
fn registry_error_global_wildcard_display() {
    let err = RegistryError::GlobalWildcardDenied;
    let msg = err.to_string();
    assert!(msg.contains("global wildcard"));
    assert!(msg.contains("Owner"));
}

// ── RegistryError Debug ───────────────────────────────────────────

#[test]
fn registry_error_debug() {
    let err = RegistryError::UnknownKey("test".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("UnknownKey"));
}

// ── RegistryError Clone/Eq ────────────────────────────────────────

#[test]
fn registry_error_clone() {
    let err = RegistryError::UnknownKey("test".into());
    let cloned = err.clone();
    assert_eq!(err, cloned);
}

#[test]
fn registry_error_eq() {
    let a = RegistryError::UnknownKey("test".into());
    let b = RegistryError::UnknownKey("test".into());
    assert_eq!(a, b);

    let c = RegistryError::UnknownKey("other".into());
    assert_ne!(a, c);
}

// ── PermissionEntry integrity ─────────────────────────────────────

#[test]
fn every_entry_has_non_empty_description() {
    for e in REGISTRY {
        assert!(
            !e.description.is_empty(),
            "entry {} has empty description",
            e.key
        );
    }
}

#[test]
fn every_entry_key_matches_domain_action_format() {
    for e in REGISTRY {
        assert!(
            e.key.contains(':'),
            "entry key {} is missing ':' separator",
            e.key
        );
        let parts: Vec<&str> = e.key.splitn(2, ':').collect();
        assert_eq!(
            parts.len(),
            2,
            "entry key {} must have domain:action",
            e.key
        );
        assert!(!parts[0].is_empty(), "entry {} has empty domain", e.key);
        assert!(!parts[1].is_empty(), "entry {} has empty action", e.key);
    }
}

#[test]
fn family_matches_domain_from_key() {
    for e in REGISTRY {
        let domain = e.key.split(':').next().unwrap();
        assert_eq!(
            e.family, domain,
            "entry {} has family '{}' but key domain is '{}'",
            e.key, e.family, domain
        );
    }
}

#[test]
fn registry_size_matches_enforced_count() {
    // The registry must have at least as many entries as ALL_ENFORCED.
    // It can have more (future keys not yet enforced), but never fewer.
    assert!(
        REGISTRY.len() >= ALL_ENFORCED.len(),
        "registry ({} entries) is smaller than ALL_ENFORCED ({} entries)",
        REGISTRY.len(),
        ALL_ENFORCED.len()
    );
}

// ── Sensitive key inventory ───────────────────────────────────────

#[test]
fn all_expected_sensitive_keys_are_flagged() {
    // Every key that should be sensitive per ADR #35 D2 must be flagged.
    for key in [
        permissions::SALES_VOID,
        permissions::SALES_REFUND,
        permissions::PAYMENTS_REFUND,
        permissions::PAYMENTS_SETTLE,
        permissions::STAFF_MANAGE_ROLES,
        permissions::STAFF_DELETE,
        permissions::STAFF_READ_IDENTITY,
        permissions::STAFF_READ_PAYROLL,
        permissions::STAFF_EDIT_NOTES,
        permissions::REPORTS_EXPORT,
        permissions::AUDIT_EXPORT,
        permissions::GIFTCARDS_ISSUE,
        permissions::SECURITY_MANAGE,
        permissions::DATA_EXPORT,
    ] {
        assert!(is_sensitive(key), "{} must be classified sensitive", key);
    }
}

#[test]
fn operational_keys_are_not_sensitive() {
    // Core operational keys must never be sensitive — they are
    // grantable through family wildcards.
    for key in [
        permissions::SALES_PROCESS,
        permissions::SALES_VIEW,
        permissions::SALES_DISCOUNT,
        permissions::SALES_SPLIT,
        permissions::PRODUCTS_CREATE,
        permissions::PRODUCTS_READ,
        permissions::PRODUCTS_UPDATE,
        permissions::INVENTORY_VIEW,
        permissions::INVENTORY_ADJUST,
        permissions::STAFF_CREATE,
        permissions::STAFF_READ,
        permissions::SETTINGS_READ,
        permissions::SETTINGS_EDIT,
        permissions::PAYMENTS_CASH,
        permissions::PAYMENTS_CARD,
        permissions::CUSTOMERS_CREATE,
        permissions::CUSTOMERS_VIEW,
        permissions::KDS_VIEW,
        permissions::KDS_UPDATE,
    ] {
        assert!(!is_sensitive(key), "{} must NOT be sensitive", key);
    }
}

// ── Deeper edge cases ──────────────────────────────────────────

#[test]
fn validate_grant_empty_string_rejected() {
    assert!(validate_grant("", false).is_err());
}

#[test]
fn validate_grant_whitespace_rejected() {
    assert!(validate_grant(" sales:void ", false).is_err());
    assert!(validate_grant(" *", false).is_err());
    assert!(validate_grant("* ", false).is_err());
}

#[test]
fn validate_grant_unknown_domain_wildcard_rejected() {
    assert!(validate_grant("unknown:*", false).is_err());
}

#[test]
fn validate_grant_space_before_asterisk_rejected() {
    // "sales: *" is NOT a valid domain wildcard — space before asterisk.
    assert!(validate_grant("sales: *", false).is_err());
}

#[test]
fn validate_grant_exact_sensitive_key_allowed() {
    // Explicit grants of sensitive keys are the sanctioned way.
    assert!(validate_grant(permissions::STAFF_DELETE, false).is_ok());
    assert!(validate_grant(permissions::GIFTCARDS_ISSUE, false).is_ok());
    assert!(validate_grant(permissions::SECURITY_MANAGE, false).is_ok());
    assert!(validate_grant(permissions::DATA_EXPORT, false).is_ok());
}

#[test]
fn validate_grants_with_duplicates_all_pass() {
    // Duplicate valid grants should all pass validation.
    let grants = vec![
        permissions::SALES_PROCESS.to_string(),
        permissions::SALES_PROCESS.to_string(),
        permissions::SALES_PROCESS.to_string(),
    ];
    assert!(validate_grants(&grants, false).is_ok());
}

#[test]
fn validate_grants_all_invalid_returns_all_errors() {
    let grants = vec!["bad:one".into(), "bad:two".into(), "bad:three".into()];
    let errs = validate_grants(&grants, false).unwrap_err();
    assert_eq!(errs.len(), 3);
}

#[test]
fn lookup_empty_string_returns_none() {
    assert!(lookup("").is_none());
}

#[test]
fn lookup_global_wildcard_returns_none() {
    // "*" is not a registered key — it's a special token.
    assert!(lookup("*").is_none());
}

#[test]
fn is_registered_global_wildcard_false() {
    assert!(!is_registered("*"));
}

#[test]
fn is_registered_empty_string_false() {
    assert!(!is_registered(""));
}

#[test]
fn registry_error_unknown_key_debug() {
    let err = RegistryError::UnknownKey("test".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("UnknownKey"));
    assert!(debug.contains("test"));
}

#[test]
fn registry_error_sensitive_wildcard_debug() {
    let err = RegistryError::SensitiveUnderWildcard("sales:*".into(), "sales:void".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("SensitiveUnderWildcard"));
}

#[test]
fn registry_error_global_wildcard_debug() {
    let err = RegistryError::GlobalWildcardDenied;
    let debug = format!("{err:?}");
    assert!(debug.contains("GlobalWildcardDenied"));
}

#[test]
fn every_family_has_at_least_one_key() {
    // Every family present in the registry must have at least one key.
    for family in families() {
        let count = REGISTRY.iter().filter(|e| e.family == family).count();
        assert!(count > 0, "family '{}' has no keys", family);
    }
}

#[test]
fn family_count_matches_unique_families() {
    let families = families();
    // Should have at least 15 distinct families.
    assert!(
        families.len() >= 15,
        "expected >= 15 families, got {}",
        families.len()
    );
}

#[test]
fn validate_grant_exact_non_sensitive_key_allowed() {
    // Non-sensitive exact keys are always allowed.
    assert!(validate_grant(permissions::SALES_PROCESS, false).is_ok());
    assert!(validate_grant(permissions::PRODUCTS_READ, false).is_ok());
    assert!(validate_grant(permissions::KDS_VIEW, false).is_ok());
}

#[test]
fn validate_grant_operational_family_wildcard_allowed() {
    // Families with no sensitive keys should allow wildcards.
    for family in ["products", "tables", "kds", "promotions", "discounts"] {
        let wildcard = format!("{family}:*");
        assert!(
            validate_grant(&wildcard, false).is_ok(),
            "operational wildcard {wildcard} should be allowed"
        );
    }
}

#[test]
fn sensitive_family_wildcard_rejected() {
    // Families with sensitive keys must reject wildcards.
    for family in [
        "sales",
        "staff",
        "payments",
        "reports",
        "audit",
        "giftcards",
        "security",
        "data",
    ] {
        let wildcard = format!("{family}:*");
        assert!(
            validate_grant(&wildcard, false).is_err(),
            "sensitive family wildcard {wildcard} must be rejected"
        );
    }
}

#[test]
fn registry_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PermissionEntry>();
}

#[test]
fn registry_error_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<RegistryError>();
}

// ── Drift-prevention hardening tests ─────────────────────────────

/// Every permission granted by every built-in preset must be registered
/// in the registry AND listed in ALL_ENFORCED. This catches:
/// - Migration drift: new constant added but not registered
/// - Preset drift: preset grants a key that doesn't exist
///
/// Skips `"*"` (global wildcard — not a registered permission key).
#[test]
fn every_preset_permission_is_registered_and_enforced() {
    for preset in crate::rbac::ROLE_PRESETS {
        for &perm in preset.permissions {
            if perm == "*" {
                continue; // global wildcard — special token, not a registered key
            }
            assert!(
                is_registered(perm),
                "preset '{}' grants '{}' which is not registered — add it to REGISTRY",
                preset.id,
                perm
            );
            assert!(
                ALL_ENFORCED.contains(&perm),
                "preset '{}' grants '{}' which is not in ALL_ENFORCED",
                preset.id,
                perm
            );
        }
    }
}

/// Every ALL_ENFORCED constant must be granted by at least one built-in
/// preset, OR be a known owner-only exception. This catches orphaned
/// constants that exist in code but no role actually uses them.
#[test]
fn every_enforced_key_is_granted_by_at_least_one_preset() {
    // Known owner-only exceptions: irreversible org actions deliberately
    // kept out of all presets (ADR #35 D4).
    // Keys deliberately not granted by any preset: owner-only irreversible
    // actions (ADR #35 D4) or features not yet assigned to a role.
    let unpreseted_exceptions: &[&str] = &[
        permissions::STAFF_DELETE,
        permissions::TERMINALS_READ,
        permissions::PURCHASING_VIEW,
        permissions::PURCHASING_MANAGE,
        permissions::GIFTCARDS_ISSUE,
        permissions::GIFTCARDS_REDEEM,
        permissions::GIFTCARDS_MANAGE,
        permissions::SECURITY_MANAGE,
        permissions::SYNC_MANAGE,
        permissions::REFERENCE_READ,
        permissions::PLAN_READ,
        permissions::CATEGORIES_READ,
        permissions::DATA_EXPORT,
        // AP write keys are Owner-only (payment-methods-plan §2c), mirroring
        // purchasing's reality; owners hand them out via Custom roles.
        permissions::PAYABLES_CREATE,
        permissions::PAYABLES_SETTLE,
        permissions::PAYABLES_WRITEOFF,
    ];

    // Collect all permissions granted by any preset.
    let mut all_preset_perms = std::collections::HashSet::new();
    for preset in crate::rbac::ROLE_PRESETS {
        for &perm in preset.permissions {
            all_preset_perms.insert(perm);
        }
    }
    for &key in ALL_ENFORCED {
        if unpreseted_exceptions.contains(&key) {
            continue;
        }
        assert!(
            all_preset_perms.contains(key),
            "ALL_ENFORCED key '{key}' is not granted by any preset — \
                 either add it to a preset, mark it owner-only, or remove it from ALL_ENFORCED"
        );
    }
}

/// Every registry entry's family must have at least one non-sensitive key,
/// OR be a known all-sensitive family. A family with ONLY sensitive keys
/// means the family wildcard is always rejected — which is correct for
/// security-sensitive domains like data export.
#[test]
fn every_family_has_operational_key() {
    // Known all-sensitive families: every key in these families is
    // sensitive by design (ADR #35 D2). Family wildcards are rejected.
    let all_sensitive_families: &[&str] = &["data", "security"];

    for family in families() {
        if all_sensitive_families.contains(&family) {
            continue;
        }
        let has_operational = REGISTRY.iter().any(|e| e.family == family && !e.sensitive);
        assert!(
            has_operational,
            "family '{}' has NO operational (non-sensitive) keys — \
                 family wildcards will always be rejected",
            family
        );
    }
}

/// Registry size must exactly match ALL_ENFORCED count.
/// Previously we tested >= but exact match prevents silent additions
/// to one list without the other.
#[test]
fn registry_and_enforced_counts_match_exactly() {
    assert_eq!(
        REGISTRY.len(),
        ALL_ENFORCED.len(),
        "REGISTRY has {} entries but ALL_ENFORCED has {} — they must stay in sync",
        REGISTRY.len(),
        ALL_ENFORCED.len()
    );
}
