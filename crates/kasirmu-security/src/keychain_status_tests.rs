//! Regression tests for [`status_means_item_not_found`] (SEC-1).
//!
//! These run on every host, which is the point: the macOS backend that
//! consumes this predicate is compiled only on macOS, so a test living beside
//! it would never execute on the machines doing the reviewing.

use super::*;

/// The one code that means absence.
#[test]
fn err_sec_item_not_found_means_absence() {
    assert!(status_means_item_not_found(ERR_SEC_ITEM_NOT_FOUND));
    assert_eq!(ERR_SEC_ITEM_NOT_FOUND, -25300);
}

/// SEC-1 regression. The old predicate was a debug-string `contains("-128")`,
/// and `-128` is a prefix of every code in the `-128xx` range, so each of these
/// genuine failures was reported as "item not found" — i.e. `Ok(None)` where the
/// caller should have seen an error. They must all be failures.
#[test]
fn a_code_merely_containing_the_needle_is_not_absence() {
    for code in [-12800, -12801, -12805, -12899, -1280, -128] {
        assert!(
            !status_means_item_not_found(code),
            "status {code} is a failure, not an absent item"
        );
    }
}

/// `-128` is not an errSec not-found code at all. The stamp this replaced
/// claimed `errSecUnimplemented = -128`; the dependency defines it as `-4`.
#[test]
fn unimplemented_is_not_absence_either() {
    assert!(!status_means_item_not_found(-4), "errSecUnimplemented = -4");
    assert!(!status_means_item_not_found(-128));
}

/// Neighbouring real statuses must not be confused with absence, including the
/// codes immediately around `-25300` in the published table.
#[test]
fn neighbouring_statuses_are_not_absence() {
    for code in [
        ERR_SEC_SUCCESS,
        -25299, // errSecDuplicateItem
        -25293, // errSecAuthFailed
        -25263, // errSecNoTrustSettings
        -25318, // errSecCreateChainFailed
        -25301, // one above errSecItemNotFound
        -25298, // one below errSecDuplicateItem
    ] {
        assert!(!status_means_item_not_found(code), "status {code}");
    }
}

/// The predicate is exact equality, so only the single published value passes.
#[test]
fn only_the_exact_code_matches() {
    let matches = (-25400..=-25200)
        .filter(|c| status_means_item_not_found(*c))
        .collect::<Vec<_>>();
    assert_eq!(matches, vec![-25300], "exactly one code means absence");
}
