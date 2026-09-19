//! Unit tests for server_origin (super).

use super::*;

#[test]
fn env_override_wins_over_pinned_and_main() {
    let resolved = resolve_origin(
        Some("https://staging.example.com".to_string()),
        Some(FALLBACK_SERVER_ORIGIN.to_string()),
    );
    assert_eq!(resolved.url, "https://staging.example.com");
    assert_eq!(resolved.source, OriginSource::EnvOverride);
}

#[test]
fn pinned_wins_over_main() {
    let resolved = resolve_origin(None, Some(FALLBACK_SERVER_ORIGIN.to_string()));
    assert_eq!(resolved.url, FALLBACK_SERVER_ORIGIN);
    assert_eq!(resolved.source, OriginSource::Pinned);
}

#[test]
fn compiled_default_is_main() {
    let resolved = resolve_origin(None, None);
    assert_eq!(resolved.url, MAIN_SERVER_ORIGIN);
    assert_eq!(resolved.source, OriginSource::Main);
}

#[test]
fn blank_values_are_unconfigured_not_empty_base_urls() {
    // The documented invariant: "OZ_LICENSE_SERVER_URL=" (as shipped in
    // .env.example) must not blank out the base URL.
    let resolved = resolve_origin(Some(String::new()), Some("   ".to_string()));
    assert_eq!(resolved.url, MAIN_SERVER_ORIGIN);
    assert_eq!(resolved.source, OriginSource::Main);
}

#[test]
fn non_http_schemes_are_rejected() {
    assert_eq!(normalize_origin("ftp://example.com"), None);
    assert_eq!(normalize_origin("license.kasir.mu"), None);
    assert_eq!(normalize_origin("javascript:alert(1)"), None);
}

#[test]
fn trailing_slashes_are_trimmed_and_ports_preserved() {
    assert_eq!(
        normalize_origin("https://license.kasir.mu/").as_deref(),
        Some("https://license.kasir.mu")
    );
    assert_eq!(
        normalize_origin("http://localhost:8080///").as_deref(),
        Some("http://localhost:8080")
    );
}

#[test]
fn malformed_override_falls_through_to_the_next_tier() {
    let resolved = resolve_origin(
        Some("not a url".to_string()),
        Some(FALLBACK_SERVER_ORIGIN.to_string()),
    );
    assert_eq!(resolved.url, FALLBACK_SERVER_ORIGIN);
    assert_eq!(resolved.source, OriginSource::Pinned);
}

#[test]
fn release_ladder_is_main_then_fallback() {
    assert_eq!(release_ladder(), [MAIN_SERVER_ORIGIN, FALLBACK_SERVER_ORIGIN]);
}

#[test]
fn ladder_entries_are_https_and_not_loopback() {
    let ladder = release_ladder();
    assert_ne!(ladder[0], ladder[1]);
    for origin in ladder {
        assert!(origin.starts_with("https://"), "must be https: {origin}");
        assert!(!origin.contains("localhost"), "must not be loopback: {origin}");
        assert!(!origin.contains("127.0.0.1"), "must not be loopback: {origin}");
    }
}

#[test]
fn resolve_origin_never_returns_a_loopback_origin() {
    // Release-safety invariant: the resolver has no localhost tier. Loopback is
    // reachable only through the debug constants, which do not exist in a release
    // build at all.
    for tier in [
        resolve_origin(None, None),
        resolve_origin(None, Some(FALLBACK_SERVER_ORIGIN.to_string())),
    ] {
        assert!(!tier.url.contains("localhost"));
    }
}

#[cfg(debug_assertions)]
#[test]
fn debug_origins_are_the_split_dev_stack_ports() {
    assert_eq!(DEBUG_AUTH_ORIGIN, "http://localhost:8080");
    assert_eq!(DEBUG_SYNC_ORIGIN, "http://localhost:3099");
}

#[test]
fn origin_source_labels_are_stable() {
    assert_eq!(OriginSource::EnvOverride.as_str(), "env-override");
    assert_eq!(OriginSource::Pinned.as_str(), "pinned");
    assert_eq!(OriginSource::Main.as_str(), "main");
    assert_eq!(OriginSource::Fallback.as_str(), "fallback");
    assert_eq!(OriginSource::DebugLocal.as_str(), "debug-local");
}
