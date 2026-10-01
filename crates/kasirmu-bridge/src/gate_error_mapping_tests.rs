//! The `map_gate_error` copies must stay one rule.
//!
//! Eleven copies of this function exist: `ctx.rs` (canonical), `apps/desktop-tauri`'s
//! `commands/authz.rs`, and nine `kasirmu-bridge` modules that each carry a private
//! mirror — `staff`, `loyalty`, `customers`, `categories`, `inventory_counts`,
//! `inventory`, `regional`, `stock_transfers`, `tax`.
//!
//! The copies are load-bearing, not cosmetic. `impl From<CoreError> for BridgeError`
//! maps `CoreError::PermissionDenied` to `BridgeError::Core { sub_kind: PermissionDenied }`
//! — a generic core error — while the UI branches on `BridgeError::PermissionDenied`
//! itself. Every gate therefore needs this correction, and a copy that drifts would
//! silently hand the front end the wrong wire shape for a denial.
//!
//! The duplication is deliberate and already ruled on: the port journal records that
//! each module keeps its own mirror because `ctx`'s helper is private, with the
//! dedupe deferred. What was never pinned is that the copies still AGREE — nothing
//! fails when one of them changes. These tests read the real sources, so the claim is
//! checked against the tree rather than restated here.
//!
//! Scope note: this pins agreement, not correctness of the canonical mapping. If the
//! rule itself should change, change `ctx.rs` and this file's expectation together.

/// The canonical mapper's match body, verbatim from `ctx.rs`.
///
/// Kept as a literal rather than derived from `ctx.rs` at test time: deriving it
/// would make the test pass whenever all copies agree with each OTHER, including
/// when every one of them drifted together — which is the failure this catches.
const CANONICAL_ARMS: &str = "match e {\n        kasirmu_core::CoreError::PermissionDenied(message) => {\n            BridgeError::PermissionDenied(message)\n        }\n        other => BridgeError::from(other),\n    }";

/// Every bridge-local copy of the mapper, as `(module, source)`.
const BRIDGE_MODULES: [(&str, &str); 10] = [
    ("ctx", include_str!("ctx.rs")),
    ("staff", include_str!("staff.rs")),
    ("loyalty", include_str!("loyalty.rs")),
    ("customers", include_str!("customers.rs")),
    ("categories", include_str!("categories.rs")),
    ("inventory_counts", include_str!("inventory_counts.rs")),
    ("inventory", include_str!("inventory.rs")),
    ("regional", include_str!("regional.rs")),
    ("stock_transfers", include_str!("stock_transfers.rs")),
    ("tax", include_str!("tax.rs")),
];

/// Pull the match body out of a module's `map_gate_error` definition.
///
/// Returns `None` for a module with no such function, so a copy being DELETED (the
/// dedupe this file's header describes) is reported rather than silently passing as
/// "no drift".
fn mapper_body(src: &str) -> Option<String> {
    let start = src.find("fn map_gate_error(")?;
    let body = &src[start..];
    let end = body.find("\n}")?;
    let body = &body[..end];
    // Only the match expression: doc comments and the signature legitimately vary
    // per module and are not the rule.
    let arms = body.find("match e {")?;
    Some(body[arms..].trim_end().to_owned())
}

#[test]
fn every_map_gate_error_copy_carries_the_canonical_arms() {
    let canon = mapper_body(BRIDGE_MODULES[0].1).expect("ctx.rs defines the canonical mapper");
    assert_eq!(
        canon, CANONICAL_ARMS,
        "the canonical mapper in ctx.rs changed; update CANONICAL_ARMS and review every copy"
    );

    for (module, src) in BRIDGE_MODULES {
        let body = mapper_body(src).unwrap_or_else(|| {
            panic!(
                "{module}.rs has no map_gate_error. If the dedupe finally landed, delete this \
                 module from BRIDGE_MODULES — do not delete the assertion for the others."
            )
        });
        assert_eq!(
            body, canon,
            "{module}.rs's map_gate_error has DRIFTED from the canonical rule in ctx.rs. \
             The two now translate a gate denial differently, and the UI branches on which \
             BridgeError variant it receives."
        );
    }
}

#[test]
fn the_desktop_copy_translates_the_same_denial() {
    // The shell's copy targets `AppError`, not `BridgeError`, so it cannot be
    // compared textually with the bridge copies — but its ARM is the same rule, and a
    // shell that stopped special-casing PermissionDenied would break the UI the same way.
    let src = include_str!("../../../apps/desktop-tauri/src/commands/authz.rs");
    let start = src
        .find("fn map_gate_error(")
        .expect("apps/desktop-tauri/src/commands/authz.rs defines map_gate_error");
    let body = &src[start..];
    let end = body.find("\n}").expect("the mapping body is well-formed");
    let body = &body[..end];
    assert!(
        body.contains(
            "CoreError::PermissionDenied(message) => AppError::PermissionDenied(message)"
        ),
        "the desktop mapper must translate a denial to AppError::PermissionDenied, not route it \
         through AppError::from; otherwise the front end sees a core error instead of the \
         permissionDenied kind it branches on. Body was:\n{body}"
    );
    assert!(
        body.contains("other => AppError::from(other)"),
        "every non-denial must keep its own sub-kind"
    );
}
