//! Desktop-lane settings command tests — the READ door.
//!
//! Every command in `settings.rs` is a shim over `oz_bridge::settings`, so the
//! desktop lane performs no read of its own: `get_setting` reaches
//! `oz_bridge::settings::get_setting`, which calls `run_get_setting`
//! (`crates/kasirmu-bridge/src/settings.rs`). These tests pin that door for the one
//! key a renderer actually asks for, and pin that the shim adds no bypass.
//!
//! Why the row is seeded through `Settings::set` and never through the write
//! funnel: since `0f26a4b29` `Settings::set_tracked` refuses a deny-listed
//! credential stored in cleartext, so a funnel seed leaves the row ABSENT and
//! turns every refusal asserted on it into a vacuous pass. The row-exists
//! assertion under each refusal is what keeps the pin honest.

// No `use super::*` on purpose: this shell's `settings.rs` holds only
// `#[tauri::command]` shims and re-exported wire DTOs, and every item asserted
// here is named by its owner instead — `oz_core::Settings`,
// `platform_core::settings::keys`, `oz_bridge::settings`.
use oz_core::Settings;
use oz_core::migrations;
use rusqlite::Connection;

/// The exact spelling the caller in `ui/src/hooks/useGatewayStatus.ts:23`
/// sends, and the exact spelling of the `keys::STRIPE_API_KEY` constant.
const STRIPE_API_KEY: &str = "stripe.api_key";

/// A sentinel value, not a credential. Shaped like a Stripe test key so a
/// reader recognises the field, and carrying a word no real key contains, so
/// nothing can mistake it for live material or try to rotate it.
const SENTINEL: &str = "sk_test_SENTINEL_NOT_A_REAL_KEY_deadbeef";

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

/// Extract one function's body, through its closing brace, from a source
/// string, so a test can name the door a command actually reaches.
fn fn_body(src: &str, signature: &str) -> String {
    let start = src
        .find(signature)
        .unwrap_or_else(|| panic!("signature `{signature}` no longer exists in this source"));
    let rest = &src[start..];
    let open = rest.find('{').expect("function body opens with a brace");
    let mut depth = 0usize;
    let mut body = String::new();
    for ch in rest[open..].chars() {
        body.push(ch);
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
    }
    body
}

/// DECISION PIN — the read door refuses `stripe.api_key`.
///
/// What this measures, for the record, against the claim that
/// `ui/src/hooks/useGatewayStatus.ts:23` leaks a deny-listed credential
/// through the ungated `get_setting` command because the credential refusal
/// sits on the WRITE path (`set_tracked`) and on the egress and ingest
/// policies: it does not. The refusal is ALSO on the read path.
/// `oz_bridge::settings::run_get_setting` asks `is_secret_key(key)` before it
/// reads anything and answers `Ok(None)` for a deny-listed name, and this
/// shell's `get_setting` command is a shim over exactly that function. The
/// predicate chain is `is_secret_setting_key` -> `credential_base` ->
/// whole-key equality against `SECRET_KEY_DENY_LIST`; the bare spelling above
/// is inside that domain, unlike `smtp_config:tenant-a`, which the
/// suffix-blind projection misses and `keys_tests.rs` pins separately.
///
/// Two facts are pinned together on purpose:
///  * the DOOR refuses, so the renderer gets `null`; and
///  * the ROW is still there and is handed over verbatim one level down
///    (`Settings::get` is a plain SELECT — no decrypt step, no crypto), so the
///    name test is the only thing between a stored credential and the IPC
///    surface. Deleting the refusal does not tighten a ratchet row; it opens
///    the leak this pin exists to keep shut.
#[test]
fn decision_pin_get_setting_refuses_stripe_api_key_at_the_read_door() {
    let conn = fresh_conn();
    // Premise, measured rather than assumed: the caller's bare spelling
    // resolves to a deny-listed credential base.
    assert_eq!(
        platform_core::settings::keys::credential_base(STRIPE_API_KEY),
        Some(STRIPE_API_KEY),
        "`{STRIPE_API_KEY}` must resolve to its own deny-list entry, or this pin          is asserting a refusal over a key nothing owns"
    );
    assert!(
        platform_core::settings::keys::is_secret_setting_key(STRIPE_API_KEY),
        "the shared read predicate no longer denies `{STRIPE_API_KEY}`"
    );

    // Seed door: the untracked `Settings::set`. See the module header.
    Settings::set(&conn, STRIPE_API_KEY, SENTINEL).unwrap();

    // The row exists, in cleartext, and the read path one level below the door
    // returns it byte for byte: nothing decrypts, nothing re-encodes. That is
    // the answer to "does the read half hand it over" — it hands over whatever
    // is stored, which is why the refusal above is load-bearing.
    assert_eq!(
        Settings::get(&conn, STRIPE_API_KEY).unwrap().as_deref(),
        Some(SENTINEL),
        "the row must exist for the refusal below to mean anything"
    );

    // The door the hook actually calls: Ok(None), not the value and not an
    // error — the renderer sees "never written".
    assert_eq!(
        oz_bridge::settings::run_get_setting(&conn, STRIPE_API_KEY).unwrap(),
        None,
        "`{STRIPE_API_KEY}` is deny-listed and must never reach the renderer          through `get_setting` — this is a refusal, not a value"
    );
    // The fold belongs to the door: the settings key is TEXT under BINARY
    // collation, so a case- or whitespace-exact match would admit a near-miss
    // spelling as its own readable row.
    assert_eq!(
        oz_bridge::settings::run_get_setting(&conn, " Stripe.API_KEY ").unwrap(),
        None,
        "the fold in `credential_base` must cover the caller's sloppiest spelling"
    );
    // A control: the same door still answers an ordinary key, so the refusal
    // above is the name test and not a broken read.
    Settings::set(&conn, "store.name", "Counter Store").unwrap();
    assert_eq!(
        oz_bridge::settings::run_get_setting(&conn, "store.name")
            .unwrap()
            .as_deref(),
        Some("Counter Store"),
        "an ordinary key must still read back"
    );
}

/// DECISION PIN — neither desktop shim holds a read of its own.
///
/// The unscoped and the scoped command must reach the SAME refused function. A
/// scoped twin that re-read the table directly would put the credential back on
/// the wire behind a `settings:read` check, which is a permission, not a
/// credential rule. This fails if either shim grows its own `Settings::get` or
/// drops the delegation — how a bypass would actually arrive here.
#[test]
fn decision_pin_desktop_shims_reach_the_one_refused_door() {
    let src = include_str!("settings.rs");
    for signature in [
        "pub async fn get_setting(",
        "pub async fn get_setting_scoped(",
    ] {
        let body = fn_body(src, signature);
        assert!(
            body.contains("oz_bridge::settings::get_setting"),
            "`{signature}` must delegate to the bridge door, found: {body}"
        );
        assert!(
            !body.contains("Settings::get"),
            "`{signature}` grew its own read of the settings table — the              credential refusal lives in `run_get_setting`, so a local read              bypasses it"
        );
    }
}
