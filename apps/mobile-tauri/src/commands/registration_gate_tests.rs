//! Registration gate ratchet — tablet shell.
//!
//! # What this is
//!
//! A ratchet over the CLASS, not the instances. The tauri::generate_handler! macro in
//! ../lib.rs is the whole renderer-reachable surface of this shell: 318 registered
//! names as measured 12-09-26. Every registered name is parsed out of this crate's own
//! source at test time and placed in exactly one of three states:
//!
//! 1. gated — the wrapper resolves a session AND a permission is named on the path the
//!    wrapper actually takes (its own body, or the crates/kasirmu-bridge/src module it
//!    forwards to — read the next section before trusting that word);
//! 2. BY_DESIGN_UNGATED — device and health metadata with no permission on either side,
//!    so no operator action is being authorised. EMPTY today, by decision rather than by
//!    omission;
//! 3. the debt ledger — everything else, one generated entry per name with the state it
//!    was measured in, in registration_gate_debt.generated.rs.
//!
//! # Why the bridge is in the parse set, and what green does NOT mean
//!
//! A tablet command wrapper is often a SHIM. Wave A-E lifted the command bodies into
//! crates/kasirmu-bridge/src; the shell file builds a BridgeCtx, forwards, and maps the error
//! back. Measured: 20 of the 318 wrapper bodies in this crate name a permission locally; the
//! rest forward to crates/kasirmu-bridge/src or run a local body that never asks. So
//! judging "is this gated" from the shims alone reports 298 ungated commands and proves
//! nothing about authorization. The predicate therefore follows the call one crate over
//! and merges by module stem, which is the same move
//! apps/desktop-tauri/tests/gate_audit.rs:22-30 already makes for the same reason. A
//! green run here means "no ungated name appeared and the ledger still adds up". It does
//! not mean "this shell is gated", and it must not be read as that second sentence.
//!
//! (Measured 13-09-26, repair of the sync-conflict gate: the 20-of-318 above was the
//! state when this ratchet landed. Since then the tablet shell gained local permission
//! checks in most domains — 198 of the 320 wrapper bodies name one today, including the
//! two sync-conflict commands this repair gates. That number is not the claim that
//! matters; the three-way partition and the ledger are, and both still hold: those 198
//! are Gated, absent from the ledger, and move no ceiling.)
//!
//! # The floor is what catches a parser that stopped matching
//!
//! This sweep reads one file embedded at compile time and walks directories at runtime.
//! Any of them can break silently — a moved include_str path, a renamed macro, a
//! relocated commands directory — and every one of those makes the sweep find FEWER
//! names, so a sweep that finds nothing asserts nothing while passing. That is what
//! REGISTERED_FLOOR and the partition-sum leg exist for, and why gated_bridge_stems
//! refuses to continue when the bridge directory reads small. Non-recursive walking is
//! load-bearing: commands/topology/ is a directory holding ten registered commands, so a
//! one-level glob drops ten names as "source not found" and the sweep passes while
//! checking nothing.
//!
//! # The ledger is generated, not typed
//!
//! 70 entries on desktop and 126 on tablet as measured, emitted by the same predicate
//! this file runs. It is generated because a hand-typed hundred-name list is where the
//! drift lives: someone gates one command, edits one line by hand, mistypes one name,
//! and the ratchet silently stops covering it. (Re-measured 13-09-26: the desktop
//! ledger is 69 entries and this tablet ledger 125 — one desktop entry and one tablet
//! entry were shed after this header was written. The ceilings in the generated files
//! carry the live numbers; this sentence is context, not a measurement the ratchet
//! enforces.)
//!
//! Since 18-09-26 that predicate can write the file, not merely disagree with it:
//! `drift_pin_generated_ledger_is_the_sweeps_own_output` checks the ledger against the
//! measurement by default and is the generator under
//! `KASIRMU_REGENERATE_GATE_LEDGER=1`, so "regenerated rather than typed" is a code path
//! rather than an instruction. That leg's own doc comment carries the command, the scope
//! of what it rewrites (the rows and two derived counts; never a pin or its history), and
//! what it deliberately does not check.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[path = "registration_gate_debt.generated.rs"]
mod debt;

/// The registered surface of this shell, measured from `../lib.rs` as 324 names on
/// 20-09-26 (320 on 18-09-26, one more than the 319 the floor and the ledger's
/// `REGISTERED_TOTAL` had carried together since the 09-16 passes). A moved include_str
/// path must not be able to pass by finding nothing, and the ledger's total is asserted
/// EQUAL to this, so the generator bringing that total current forces this number to move
/// in the same pass.
///
/// The 20-09-26 step is named rather than counted, which is this file's convention:
/// `3f0e8c4c3` registered `desktop_link::link_device_google` and `da6a4a8d4` registered
/// `desktop_link::link_device_email_request` / `desktop_link::link_device_email_consume`,
/// three names that arrived already ungated — so they moved a ceiling and three ledger
/// rows too, and all four numbers moved together in the pass that raised this one.
/// Raising this records what landed; it does not approve it. The earlier step is kept
/// because it is the same story one order smaller: `b07e8c3ac` registered
/// `pos::set_line_course_scoped` and `pos::publish_course_fired_scoped`, and `d29a7c0f4`
/// retired `settings::set_hardware_settings`, netting one more name than the ledger's
/// total recorded.
///
/// The 20-09-20 step (324 -> 332) is the tablet file-picker pass, and it is eight rather
/// than seven for a reason worth keeping visible: `data::export_data`,
/// `data::import_preview`, `data::import_data`, `avatars::set_avatar_scoped`,
/// `avatars::clear_avatar_scoped`, `products_images::products_set_image_scoped` and
/// `products_images::products_clear_image_scoped` are ADR #49 shims over `kasirmu-bridge`
/// modules that name a permission, so `gated_bridge_stems()` reads them Gated and they
/// moved no ceiling and no ledger row. The eighth, `auth::has_users`, was authored in
/// another lane and travelled here because `lib.rs` could not be committed without it —
/// it is the single new debt row, and it is recorded in docs/records/JOURNAL.md. Raising
/// this records what landed; it does not approve it.
///
/// The 20-09-20 backup closeout step (332 -> 333) adds `data::create_backup_to`, the
/// tablet-only backup-to-destination twin (b-full Phase 3 open item, §3.3 / §9 of
/// todo-tablet-dialog-content-uri.md). It is a Gated ADR #49 shim over `kasirmu_bridge`,
/// so it moves no ceiling and no ledger row — purely a surface-count increase, exactly
/// like the seven file-picker shims. Raising this records what landed; it does not approve it.
///
/// The ADR #56 §2.1/§2.2 step (333 -> 335) is the provisioning pass, and it is TWO for a
/// reason worth keeping visible: `setup::get_first_run_state` and `setup::provision_device`
/// replace the retired `setup::get_setup_status` and `setup::dismiss_setup_wizard`. All four
/// are `no_session_resolution`, and that is the point rather than an oversight: provisioning
/// creates the FIRST owner, so it must run before any session can exist — the same property
/// `setup::complete_setup` has had since it was registered. Both new commands are therefore
/// carried on the debt ledger deliberately, not by omission. The net debt movement is +2
/// (two rows in, two rows out); the ceiling rise below records what landed and does not
/// approve it.
///
/// The ADR #56 §2.2 retirement step (335 -> 334) is the FIRST time this floor has
/// moved DOWN, and it moved for the reason the ratchet exists to make visible:
/// the ledger showed `complete_setup` and `dismiss_setup_wizard` as DEBT that
/// nothing could ever gate, because both wrote the two booleans §2.1 retires.
/// Deleting them is how the debt is PAID rather than excused, so the floor
/// shrinks by one — `get_first_run_state` and `provision_device` replaced them
/// two-for-two on the surface, and one of the three retired doors
/// (`get_setup_status`) had no successor at all.
///
/// The ADR #57 §2.1 step (334 -> 336) moves it UP by two, and the reason is the
/// honest one for a registration gate: `health::get_build_fingerprint` is a new
/// door that takes NO session, so it is carried on the ledger as
/// `no_session_resolution` rather than being gated. That is deliberate, not an
/// oversight — the command reports this installation's own APK signing
/// certificate, which is a property of the public build and needs no authority
/// to read, and the tablet's licence surface must be diagnosable BEFORE a session
/// exists (the same property `get_device_id` and `get_local_ip` beside it have).
/// The ADR #56 §2.5 pairing step (337 -> 339) adds `desktop_link::start_device_pairing`
/// and `desktop_link::poll_device_pairing` for tablet device-code pairing.
///
/// The 339 -> 344 step is the staff/role TRASH (90-day soft delete), the same five
/// gated commands the desktop shell gained: `delete_staff_scoped`,
/// `restore_staff_scoped` and `list_staff_trash_scoped` behind `staff:delete`,
/// plus `restore_role_scoped` and `list_role_trash_scoped` behind
/// `staff:manage_roles`. Nothing lands on the ledger, so this step moves the floor
/// and the ledger's measured total together and leaves every ceiling alone.
///
/// The 344 -> 345 step is **not this lane's**: `setup::get_preset_features` arrived with
/// `6ac851dd4` (the desktop half of the same commit) and lands here on the SAME pass that
/// absorbed it on the desktop — floor 345, ceiling 95, class 1 51, ledger regenerated. Its
/// reason is recorded in docs/records/JOURNAL.md with the desktop entry; this line exists so
/// the two shells' floors cannot drift apart on a command both of them register.
///
/// The 345 -> 342 step is C17 (2026-09-22), the first floor move for a RETIREMENT since the
/// ADR #56 §2.2 step: the three unscoped branding setters left `lib.rs` because the UI had
/// already stopped naming them (`ui/src/api/branding.ts` calls only the `_scoped` twins), so
/// the shell kept the doors that derive identity from the session and dropped the ones that
/// took it on faith — the same move T11 made for `settings::set_hardware_settings`. Their
/// three ledger rows left with them and the ceiling and class-1 count fell by three.
///
/// The 342 -> 339 step is C17 slice 2 (2026-09-23), the same move one slice later: the
/// tablet's three ungated settings READS — `settings::get_receipt_settings`,
/// `get_store_settings` and `get_credit_settings` — left `lib.rs` because no shipped
/// UI file named them (`ui/src/api/settings.ts` calls only the `_scoped` twins, and
/// the IPC parity gate printed all three under `tablet-unrequested` as "named by
/// neither side"). Their three ledger rows left with them, so the floor, `DEBT_CEILING`
/// and the class-1 count all fell by three.
///
/// `settings::get_hardware_settings` was the FOURTH name in the inventory's slice and
/// is deliberately NOT retired here. `ui/src/hooks/useTerminalHardware.ts:240` still
/// calls it on the no-session branch (`sessionToken ? … : await getHardwareSettings()`),
/// and the hook coerces a null token to `''` at `:221`, so the arm is reachable and
/// deleting the door would break a live renderer path. It is carried as its own item
/// (C17b): retire that fallback arm first, then delete the command and its row in a
/// slice whose acceptance proves hardware settings still resolve WITH a session.
const REGISTERED_FLOOR: usize = 339;
/// How far the parsed count may rise without regenerating: names are added by ordinary
/// feature work, so the floor is a lower bound plus slack and never an equality.
/// Crossing the slack is the signal that the ledger needs regenerating in the same pass.
const REGISTERED_SLACK: usize = 24;

/// This shell's own registration list, embedded at compile time.
const LIB_RS: &str = include_str!("../lib.rs");

/// One registered name's measured state.
#[derive(PartialEq, Eq, Debug, Clone, Copy)]
enum State {
    /// Resolves a session and names a permission on the path it takes.
    Gated,
    /// The wrapper never resolves a session at all.
    NoSessionResolution,
    /// Resolves a session and never asks whether the caller may:
    /// authenticate-then-assume. The class the design pass found.
    ResolvesSessionNamesNoPermission,
}

impl State {
    /// The spelling the generated ledger uses, so the two compare as strings rather
    /// than through a mapping that can itself drift.
    fn key(self) -> &'static str {
        match self {
            State::Gated => "gated",
            State::NoSessionResolution => "no_session_resolution",
            State::ResolvesSessionNamesNoPermission => "resolves_session_names_no_permission",
        }
    }
}

struct Sweep {
    states: Vec<((String, String), State)>,
    ungated: Vec<(String, State)>,
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        panic!(
            "the registration-gate sweep cannot read {}: the directory moved, so the \
             sweep would find no wrapper bodies and pass while asserting nothing",
            dir.display()
        )
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().and_then(|s| s.to_str()) == Some("rs") {
            out.push(p);
        }
    }
}

/// The generate_handler![...] list, bracket-balanced and comment-stripped so a
/// commented-out entry inside the macro is not counted as registered.
fn registered_names(src: &str) -> Vec<(String, String)> {
    const KEY: &str = "tauri::generate_handler![";
    let Some(at) = src.find(KEY) else {
        panic!(
            "no {KEY} in this crate's lib.rs: the macro was renamed or moved, so this \
             sweep is reading a file that no longer holds the registration list"
        )
    };
    let chars: Vec<char> = src[at + KEY.len()..].chars().collect();
    let mut depth = 1usize;
    let mut body = String::new();
    for c in chars {
        match c {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => body.push(c),
        }
    }
    let mut out = Vec::new();
    for line in body.lines() {
        let line = line.split("//").next().unwrap_or("");
        for seg in line.split(',') {
            let seg = seg.trim();
            if seg.is_empty() {
                continue;
            }
            let parts: Vec<&str> = seg.split("::").collect();
            let (module, function) = match parts.len() {
                3 if parts[0] == "commands" => (parts[1], parts[2]),
                2 => (parts[0], parts[1]),
                _ => continue,
            };
            if function.is_empty()
                || !function
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                continue;
            }
            out.push((module.to_string(), function.to_string()));
        }
    }
    out
}

/// From the open paren of a parameter list, return (signature, body).
fn grab(chars: &[char], paren_at: usize) -> Option<(String, String)> {
    let close = scan(chars, paren_at, '(', ')')?;
    let mut k = close + 1;
    while k < chars.len() && chars[k] != '{' {
        k += 1;
    }
    if k >= chars.len() {
        return None;
    }
    let end = scan(chars, k, '{', '}')?;
    Some((
        chars[paren_at + 1..close].iter().collect(),
        chars[k..=end].iter().collect(),
    ))
}

fn scan(chars: &[char], start: usize, open: char, close: char) -> Option<usize> {
    let mut depth = 0usize;
    for (i, c) in chars.iter().enumerate().skip(start) {
        if *c == open {
            depth += 1;
        } else if *c == close {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

/// Is this index inside a line comment? Checked by walking back to the line
/// start and looking for the double slash, rather than by stripping comments
/// first: stripping would also eat the two slashes inside a URL string literal
/// and unbalance the braces the body scan depends on.
fn in_comment(chars: &[char], at: usize) -> bool {
    let start = chars[..at]
        .iter()
        .rposition(|c| *c == '\n')
        .map_or(0, |i| i + 1);
    let head: String = chars[start..at].iter().collect();
    head.trim_start().starts_with("//")
}

/// Signature+body of every fn named in want under dir. A name found more than once
/// keeps every hit and the gate leg accepts ANY gated one, which makes the verdict
/// order-independent — so this sweep and the generator that wrote the ledger cannot
/// disagree over walk order.
fn fn_sources(dir: &Path, want: &BTreeSet<String>) -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for file in rust_files(dir) {
        let chars: Vec<char> = read(&file).chars().collect();
        let mut i = 0usize;
        while i + 2 < chars.len() {
            if chars[i] != 'f'
                || chars[i + 1] != 'n'
                || (chars[i + 2] != ' ' && chars[i + 2] != '(')
            {
                i += 1;
                continue;
            }
            // A real definition only: not offset / final, and not a doc or line
            // comment naming a fn. Without this guard a comment that says "the fn
            // get_setting below" can hand back a span reaching into the NEXT
            // function, which reads as gated when the wrapper named is not - the
            // one direction of error this sweep must never allow.
            if i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_') {
                i += 1;
                continue;
            }
            if in_comment(&chars, i) {
                i += 1;
                continue;
            }
            let mut j = i + 2;
            while j < chars.len() && chars[j] != '(' && chars[j] != '<' {
                j += 1;
            }
            if j >= chars.len() || chars[j] != '(' {
                i += 1;
                continue;
            }
            let name: String = chars[i + 2..j].iter().collect();
            let name = name.trim().to_string();
            if want.contains(&name)
                && let Some((sig, body)) = grab(&chars, j)
            {
                map.entry(name.clone()).or_default().push(sig + &body);
            }
            i = j + 1;
        }
    }
    map
}

fn resolves_session(text: &str) -> bool {
    [
        "session_token",
        "SessionToken",
        "resolve_session",
        "require_session",
        "current_user_id",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

/// Spellings that mean "this body checked a permission".
///
/// Mirrors `apps/desktop-tauri/src/commands/registration_gate_tests.rs:317`, which has
/// carried the bespoke half of this list since its own census; this shell's copy had only
/// the first four, and that was not cosmetic. `inventory_counts.rs` and
/// `stock_transfers.rs` route all twenty of their scoped commands through a domain helper
/// (`require_inventory_count_permission(&state, &session.user_id)`, defined at
/// `commands/inventory_counts.rs:178-186` as a real
/// `require_permission_for_user(…, permissions::INVENTORY_COUNT)`), and no such call site
/// contains the substring `require_permission`. So the sweep classed all twenty as
/// `resolves_session_names_no_permission`, the generated ledger carried the same twenty
/// rows, and the two instruments agreed with each other -- while
/// `.agents/measure_gate_gap.mjs`, which derives `gated = registered && !debt` (`:29`) and
/// therefore inherits every miss here, printed the difference from the desktop as
/// `differentlyClassified=85`. Measured 2026-09-16 while chasing what looked like ten
/// ungated stock-count commands and turned out to be ten gated ones; the same helper shape
/// occurs 12 / 12 / 11 / 11 / 8 / 4 times across loyalty, tax, inventory, inventory_counts,
/// customers and categories. `drift_pin_guard_marker_vocabulary_is_closed` is what stops
/// this list rotting the way the desktop's already cannot.
const GUARD_MARKERS: &[&str] = &[
    "require_permission",
    "permissions::",
    "has_permission",
    "authorize_with",
    "require_session_permission",
    "require_inventory_permission",
    "require_inventory_count_permission",
    "require_loyalty_permission",
    "require_tax_permission",
    "require_customer_permission",
    "require_category_permission",
];

/// Does this text name a permission?
fn names_permission(text: &str) -> bool {
    for marker in GUARD_MARKERS {
        if text.contains(marker) {
            return true;
        }
    }
    // Or inline, as a "domain:action" literal — scanned as quoted runs rather than by
    // regex, so this file needs no dependency and no pattern a future edit can widen by
    // accident.
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != DOUBLE_QUOTE {
            i += 1;
            continue;
        }
        let Some(end) = (i + 1..chars.len()).find(|&k| chars[k] == DOUBLE_QUOTE) else {
            break;
        };
        let lit: String = chars[i + 1..end].iter().collect();
        if let Some(colon) = lit.find(':') {
            let (head, tail) = (&lit[..colon], &lit[colon + 1..]);
            let shape = |s: &str| {
                !s.is_empty()
                    && s.chars()
                        .all(|c| c.is_ascii_lowercase() || c == '_' || c == ':')
            };
            if shape(head) && shape(tail) {
                return true;
            }
        }
        i = end + 1;
    }
    false
}

const DOUBLE_QUOTE: char = 34 as char;
const SINGLE_QUOTE: char = 39 as char;

/// Module stems whose kasirmu-bridge module names a permission — the merge that makes a shim
/// judgeable at all.
fn gated_bridge_stems() -> BTreeSet<String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/kasirmu-bridge/src");
    let files = rust_files(&dir);
    assert!(
        files.len() >= 40,
        "the bridge parse set read only {} files out of {}: the path moved, so every \
         shim in this shell would read as ungated and the red would be a bug in the \
         sweep rather than a hole in the shell",
        files.len(),
        dir.display()
    );
    files
        .iter()
        .filter(|f| names_permission(&read(f)))
        .map(|f| {
            f.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        })
        .collect()
}

fn run_sweep() -> Sweep {
    let pairs = registered_names(LIB_RS);
    let want: BTreeSet<String> = pairs.iter().map(|(_, f)| f.clone()).collect();
    let sources = fn_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands"),
        &want,
    );
    let stems = gated_bridge_stems();
    let mut states = Vec::with_capacity(pairs.len());
    let mut ungated = Vec::new();
    for (module, function) in pairs {
        let hits = sources.get(&function).cloned().unwrap_or_default();
        assert!(
            !hits.is_empty(),
            "registered command {module}::{function} has no fn {function} anywhere under \
             src/commands: the sweep lost its own source, which is the failure mode the \
             floor assertion exists to catch"
        );
        let gated = hits.iter().any(|text| {
            resolves_session(text)
                && (names_permission(text)
                    || (text.contains("kasirmu_bridge::") && stems.contains(&module)))
        });
        let state = if gated {
            State::Gated
        } else if !hits.iter().any(|text| resolves_session(text)) {
            State::NoSessionResolution
        } else {
            State::ResolvesSessionNamesNoPermission
        };
        if state != State::Gated {
            ungated.push((format!("{module}::{function}"), state));
        }
        states.push(((module, function), state));
    }
    Sweep { states, ungated }
}

// ── The ledger's generator, and the check that replaces hand-editing ──

/// Opt-in switch for the generator leg: set it to `1` and that leg REWRITES the ledger
/// from the measurement instead of checking it. Unset — the default, and what a normal
/// `cargo test` run does — is the check.
const REGENERATE_ENV: &str = "KASIRMU_REGENERATE_GATE_LEDGER";

/// The generated ledger this ratchet compiles in.
fn ledger_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/registration_gate_debt.generated.rs")
}

/// The rows this sweep measures — name and class, in registration order.
///
/// `ungated` is filled in the same loop as `states`, so this is the ledger's content in
/// the one order the measurement has. Nothing here sorts: a sort would be a second
/// opinion about a set that already has an owner, and it would hide a row that moved
/// position in `lib.rs` rather than merely one whose class changed.
fn measured_ledger() -> Vec<(String, String)> {
    run_sweep()
        .ungated
        .iter()
        .map(|(name, state)| (name.clone(), state.key().to_string()))
        .collect()
}

/// The (name, class) rows the ledger file declares, in file order.
///
/// Read by scanning the `DEBT_LEDGER` region for quoted literals in pairs rather than by
/// parsing Rust: the file is generated data, so a reader that understands the shape the
/// generator writes is exactly as strong as the generator — and this one panics when the
/// shape is not there instead of returning an empty list, which is the failure mode every
/// panel in this file refuses (an empty measurement asserts nothing).
fn parse_ledger_rows(src: &str) -> Vec<(String, String)> {
    let at = src.find("pub const DEBT_LEDGER").unwrap_or_else(|| {
        panic!(
            "the ledger declares no `DEBT_LEDGER`: this leg would be comparing against an \
             empty list and passing"
        )
    });
    let tail = &src[at..];
    let end = tail.find("];").unwrap_or_else(|| {
        panic!("`DEBT_LEDGER` is not terminated by `];`: the generator's own output shape changed")
    });
    let mut literals = Vec::new();
    let mut rest = &tail[..end];
    while let Some(open) = rest.find('"') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('"') else {
            break;
        };
        literals.push(after[..close].to_string());
        rest = &after[close + 1..];
    }
    assert!(
        literals.len() % 2 == 0,
        "the ledger declares {} quoted literals, an odd number: every row is a (name, class) \
         pair, so one of them lost a half",
        literals.len()
    );
    literals
        .chunks(2)
        .map(|pair| (pair[0].clone(), pair[1].clone()))
        .collect()
}

/// How the ledger and the measurement disagree, as four named lists — or `None` when they
/// agree.
///
/// Named lists rather than a `Vec` equality assert: the ledger is ~100 rows, and
/// `left: [...], right: [...]` in a panic message is a wall nobody reads. The sentence
/// worth printing is which rows are new, which are paid, which changed class, and where
/// the order first diverges — each of those is a different repair.
fn ledger_diff(measured: &[(String, String)], declared: &[(String, String)]) -> Option<String> {
    let measured_names: BTreeSet<&str> = measured.iter().map(|(n, _)| n.as_str()).collect();
    let declared_names: BTreeSet<&str> = declared.iter().map(|(n, _)| n.as_str()).collect();
    let new_debt: Vec<&str> = measured_names
        .difference(&declared_names)
        .copied()
        .collect();
    let paid: Vec<&str> = declared_names
        .difference(&measured_names)
        .copied()
        .collect();
    let mut mislabelled = Vec::new();
    for (name, class) in measured {
        if let Some((_, old)) = declared.iter().find(|(n, _)| n == name)
            && old != class
        {
            mislabelled.push(format!("{name}: ledger says {old}, sweep measures {class}"));
        }
    }
    let out_of_order: Option<String> = measured
        .iter()
        .zip(declared.iter())
        .enumerate()
        .find(|(_, (m, d))| m.0 != d.0)
        .map(|(i, (m, d))| format!("row {i}: measured {} , ledger {}", m.0, d.0));
    if new_debt.is_empty() && paid.is_empty() && mislabelled.is_empty() && out_of_order.is_none() {
        return None;
    }
    Some(format!(
        "new debt (measured, absent from the ledger): {new_debt:?}\n\
         paid debt (on the ledger, no longer measured): {paid:?}\n\
         class moved under a stale row: {mislabelled:?}\n\
         first row out of order: {out_of_order:?}"
    ))
}

/// rustfmt's own budget for one row of this array, measured rather than guessed: in both
/// generated ledgers every row of 67 characters or fewer is written on one line and every
/// row of 68 or more is broken over four. (`license::get_hardware_fingerprint`'s row is
/// the longest inline one at 67; `health::ping_scoped`'s is the shortest wrapped one at
/// 68.) The generator cannot ask rustfmt what it thinks — a leg that shelled out to it
/// would fail wherever rustfmt is absent — so it carries the number, and a disagreement
/// costs nothing that matters: `cargo fmt` re-wraps the row, and this leg compares ROWS
/// rather than bytes, so it keeps passing.
const RUSTFMT_ROW_BUDGET: usize = 67;

/// `DEBT_LEDGER` rendered from measured rows — the declaration, one row per entry, and the
/// terminator. A row is written on one line while that fits [`RUSTFMT_ROW_BUDGET`] and
/// wrapped when it does not, so a regenerated ledger is a formatted file rather than one
/// the next `cargo fmt` would rewrite. The terminator carries no trailing newline: the
/// splicer leaves whatever followed `];` in the file alone, so adding one here would grow a
/// blank line at every regeneration.
fn render_ledger(rows: &[(String, String)]) -> String {
    let mut out = String::from("pub const DEBT_LEDGER: &[(&str, &str)] = &[\n");
    for (name, class) in rows {
        let inline = format!("    (\"{name}\", \"{class}\"),");
        if inline.chars().count() <= RUSTFMT_ROW_BUDGET {
            out.push_str(&inline);
            out.push('\n');
        } else {
            out.push_str(&format!(
                "    (\n        \"{name}\",\n        \"{class}\",\n    ),\n"
            ));
        }
    }
    out.push_str("];");
    out
}

/// The file with its DERIVED regions replaced: the ledger rows, the measured total, and
/// `UNSOURCED`.
///
/// Deliberately surgical. The rest of that file is authored and stays authored: the
/// header, and the pins with the decision history written above them (`DEBT_CEILING`, the
/// two class counts). A pin is a decision — "debt may only shrink" is not something a
/// sweep can measure — so a generator that recomputed one would be inventing policy, and a
/// generator that reformatted the history above it would be destroying the record of why
/// the number moved. Only what the tree can be asked about replaces what the file says.
fn rendered_ledger_file(current: &str, rows: &[(String, String)], total: usize) -> String {
    let at = current.find("pub const DEBT_LEDGER").unwrap_or_else(|| {
        panic!(
            "the ledger declares no `DEBT_LEDGER`: there is nothing for the generator to replace"
        )
    });
    let tail = &current[at..];
    let end = tail.find("];").unwrap_or_else(|| {
        panic!("`DEBT_LEDGER` is not terminated by `];`: refusing to guess where it ends")
    }) + "];".len();
    let mut out = String::with_capacity(current.len());
    out.push_str(&current[..at]);
    out.push_str(&render_ledger(rows));
    out.push_str(&current[at + end..]);
    // `UNSOURCED` is 0 by construction: `run_sweep` panics on a registered name whose
    // body it cannot find, so the sweep and the generator cannot disagree about it. It is
    // still written rather than assumed, because a hand-edit to that line would otherwise
    // be the one number in this file no leg reads.
    replace_usize(
        &replace_usize(&out, "REGISTERED_TOTAL", total),
        "UNSOURCED",
        0,
    )
}

/// `pub const NAME: usize = N;` with N replaced, or a panic naming the declaration.
///
/// A pin the generator cannot find is a pin the generator would silently leave stale, so
/// this refuses rather than skips.
fn replace_usize(src: &str, name: &str, value: usize) -> String {
    let needle = format!("pub const {name}: usize = ");
    let Some(at) = src.find(&needle) else {
        panic!("the ledger declares no `{name}`: the generator's own output shape changed")
    };
    let digits_at = at + needle.len();
    let tail = &src[digits_at..];
    let digits = tail
        .find(';')
        .unwrap_or_else(|| panic!("`{name}` is not terminated by `;`"));
    assert!(
        tail[..digits].chars().all(|c| c.is_ascii_digit()),
        "`{name}` is not a decimal literal, so the generator will not rewrite it"
    );
    format!(
        "{}{}{}",
        &src[..digits_at],
        value,
        &src[digits_at + digits..]
    )
}

/// A by-design exemption: four measured fields, and prose may be appended to an entry
/// but may never be its only content.
///
/// # ACTIVATION — how a name gets here, and how it leaves
///
/// A name may be added ONLY as an entry that fills all four fields from source, and
/// by_design_entries_carry_four_measured_fields refuses it otherwise:
///
/// * args — "none" or "session_token", asserted against the real Rust signature.
///   Anything else makes the name INELIGIBLE with no exception path, because a
///   caller-controlled argument is the caller choosing what the door does. This leg
///   rejected one of the reviewer's own nineteen seed names the night it was written:
///   sync::test_sync_connection takes url: Option<String>, so the rule outvoted the
///   list.
/// * projects — the key or DTO fields it can hand back, asserted to sit outside
///   SECRET_KEY_DENY_LIST and NON_EXPORTABLE_DEVICE_KEYS, read from platform-core
///   rather than restated here.
/// * effect — "read_only", or "app_write".
/// * twin and callers — the gated twin and the permission it names, plus the explicit
///   file:line call sites in ui/src, failing on any caller outside the set. That last
///   field is the anti-rot mechanism: wiring an ungated name to a new button becomes a
///   failing diff instead of a new opinion.
///
/// The day a name is repointed or deregistered it is DELETED from these lists and never
/// moved sideways into by-design to make a test pass — that migration is exactly how
/// this exercise gets quietly undone, and the disjointness and partition-sum legs are
/// what catch it.
///
/// # The honest limit
///
/// This list states intent; it does not prove safety. resolve_session cannot tell an
/// honest caller from a forged one, so only the argument and projection criteria
/// actually hold, and the caller census is a static claim about a codebase — a renderer
/// that wants to be malicious is outside it by construction. Green here means "nobody
/// has measured a name that deserves an exemption", which is not the sentence "this
/// surface is safe" and must never be reported as one.
// Constructed nowhere while the list below is empty: the fields are read by the
// validator, which is the point of the type. The allow is narrow and reasoned,
// not a blanket - the day an entry is added it is constructed for real.
#[allow(
    dead_code,
    reason = "zero-size by-design list on night one; see ACTIVATION"
)]
pub struct ByDesignEntry {
    /// Registered name, spelled as generate_handler! spells it.
    pub name: &'static str,
    /// "none" or "session_token". Nothing else is eligible.
    pub args: &'static str,
    /// The key or DTO fields the command can return.
    pub projects: &'static [&'static str],
    /// "read_only" or "app_write".
    pub effect: &'static str,
    /// The gated twin.
    pub twin: &'static str,
    /// The permission that twin names.
    pub permission: &'static str,
    /// file:line call sites in ui/src. Any caller outside this set fails.
    pub callers: &'static [&'static str],
}

/// Empty by decision, not by omission — see the ACTIVATION block above. An empty list
/// with a gate on growth is stronger than a seeded list nobody can defend: it is not a
/// judgement that no name deserves an exemption, it is a record that nobody has measured
/// one yet.
pub const BY_DESIGN_UNGATED: &[ByDesignEntry] = &[];

/// Leg 1 — the floor. A glob that stopped matching must not pass by finding nothing.
#[test]
fn drift_pin_registration_floor_is_met() {
    let pairs = registered_names(LIB_RS);
    assert!(
        pairs.len() >= REGISTERED_FLOOR,
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: the sweep parsed only {} registered \
         commands out of lib.rs, below the measured floor of {REGISTERED_FLOOR}. A moved \
         include_str path, a renamed macro or a relocated commands directory each look \
         exactly like this, and every other leg in this file silently checks nothing when \
         it happens. Fix the sweep before reading anything else here.",
        pairs.len()
    );
    assert_eq!(
        REGISTERED_FLOOR,
        debt::REGISTERED_TOTAL,
        "this file's hand-written floor of {REGISTERED_FLOOR} disagrees with the ledger's \
         measured total of {}: the ledger was regenerated without the floor, so the floor \
         is now guarding a number nobody measured",
        debt::REGISTERED_TOTAL,
    );
    assert!(
        pairs.len() <= REGISTERED_FLOOR + REGISTERED_SLACK,
        "the sweep parsed {} registered commands, more than {REGISTERED_SLACK} above the \
         measured floor of {REGISTERED_FLOOR}: names were registered, and the ledger, the \
         ceilings and this floor all need regenerating together in one deliberate pass.",
        pairs.len()
    );
}

/// Leg 2 — the partition is complete and adds up. This is the leg that makes the ledger
/// un-abandonable: dropping a name from the debt list stops being a deletion and becomes
/// an arithmetic failure.
#[test]
fn drift_pin_three_way_partition_is_complete_and_sums() {
    let s = run_sweep();
    let by_design: BTreeSet<String> = BY_DESIGN_UNGATED
        .iter()
        .map(|e| e.name.to_string())
        .collect();

    let mut gated = 0usize;
    let mut exempt = 0usize;
    let mut measured_debt: BTreeSet<String> = BTreeSet::new();
    for ((module, function), state) in &s.states {
        let name = format!("{module}::{function}");
        match state {
            State::Gated => {
                gated += 1;
                assert!(
                    !by_design.contains(&name),
                    "{name} is gated by the predicate AND listed in BY_DESIGN_UNGATED: an \
                     exemption for a command that is already gated hides that the gate \
                     landed, so delete the entry"
                );
            }
            _ => {
                if by_design.contains(&name) {
                    exempt += 1;
                } else {
                    measured_debt.insert(name);
                }
            }
        }
    }

    assert_eq!(
        gated + exempt + measured_debt.len(),
        s.states.len(),
        "the three states do not add up to the parsed registration count: {gated} gated + \
         {exempt} by-design + {} debt != {} registered. A registered name fell out of the \
         partition, which is what deleting a line from the ledger looks like when nobody \
         regenerates it.",
        measured_debt.len(),
        s.states.len(),
    );

    let declared: BTreeSet<String> = debt::DEBT_LEDGER
        .iter()
        .map(|(n, _)| n.to_string())
        .collect();
    let new_holes: Vec<&String> = measured_debt
        .iter()
        .filter(|n| !declared.contains(*n))
        .collect();
    let paid_stale: Vec<&String> = declared
        .iter()
        .filter(|n| !measured_debt.contains(*n))
        .collect();
    assert!(
        new_holes.is_empty() && paid_stale.is_empty(),
        "the generated ledger disagrees with the sweep. Ungated now and NOT on the ledger \
         ({} names, first few {:?}); on the ledger but no longer ungated ({} names, first \
         few {:?}). The first set is new debt and needs its reason in \
         docs/records/JOURNAL.md; the second is debt paid and left behind. Regenerate the \
         file either way rather than hand-editing it.",
        new_holes.len(),
        new_holes.iter().take(6).collect::<Vec<_>>(),
        paid_stale.len(),
        paid_stale.iter().take(6).collect::<Vec<_>>(),
    );
}

/// Leg 3 — the three lists are pairwise disjoint, so nothing migrates sideways.
#[test]
fn drift_pin_the_three_lists_are_pairwise_disjoint() {
    let s = run_sweep();
    let by_design: BTreeSet<String> = BY_DESIGN_UNGATED
        .iter()
        .map(|e| e.name.to_string())
        .collect();
    let ledger: BTreeSet<String> = debt::DEBT_LEDGER
        .iter()
        .map(|(n, _)| n.to_string())
        .collect();

    let twice: Vec<&String> = by_design.iter().filter(|n| ledger.contains(*n)).collect();
    assert!(
        twice.is_empty(),
        "{twice:?} is on BY_DESIGN_UNGATED and on the debt ledger at once: a name holding \
         two statuses means each leg reports the other as fine, which is how a migration \
         from debt to by-design survives review"
    );

    let registered: BTreeSet<String> = s
        .states
        .iter()
        .map(|((m, f), _)| format!("{m}::{f}"))
        .collect();
    for name in &by_design {
        assert!(
            registered.contains(name),
            "BY_DESIGN_UNGATED carries {name}, which this shell does not register: an \
             exemption for a name that is not on the IPC surface protects nothing and \
             outlives the command it was written for"
        );
    }
    for name in &ledger {
        assert!(
            registered.contains(name),
            "the debt ledger carries {name}, which this shell does not register: \
             deregistering a command deletes its ledger entry, it does not leave it behind \
             as a permanent excuse"
        );
    }
}

/// Leg 4 — debt may only shrink, in total and per state.
#[test]
fn drift_pin_debt_ceilings_only_shrink() {
    let s = run_sweep();
    let ungated = s.ungated.len();
    assert!(
        ungated <= debt::DEBT_CEILING,
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {} ungated registered commands \
         against a ceiling of {}. Debt leaves this list and never joins it, so a rise \
         means a newly registered command shipped ungated: record the reason in \
         docs/records/JOURNAL.md before the number moves.",
        ungated,
        debt::DEBT_CEILING,
    );

    let no_session = s
        .ungated
        .iter()
        .filter(|(_, st)| *st == State::NoSessionResolution)
        .count();
    let assume = ungated - no_session;
    // Name the movers, in the same shape as the desktop file's copy of this leg so the two can be
    // read against each other. This half matters MORE here: the tablet ledger sits exactly at its
    // ceilings, so the first crossing fires immediately and this message has never once been
    // displayed -- an arm nobody has seen fire is an arm nobody can trust. It was therefore proved
    // by planting: one ledger row relabelled to a class its own sweep disagrees with, the leg run,
    // the name read out of the output, and the file restored byte-identical.
    let label_of = |n: &str| {
        debt::DEBT_LEDGER
            .iter()
            .find(|(k, _)| *k == n)
            .map(|(_, v)| *v)
    };
    let want = "resolves_session_names_no_permission";
    let (mut homeless, mut migrated) = (Vec::new(), Vec::new());
    for (name, st) in &s.ungated {
        if *st != State::ResolvesSessionNamesNoPermission {
            continue;
        }
        match label_of(name) {
            None => homeless.push(name.clone()),
            Some(old) if old != want => migrated.push(format!("{name} (ledger says {old})")),
            Some(_) => {}
        }
    }
    assert!(
        no_session <= debt::NO_SESSION_RESOLUTION
            && assume <= debt::RESOLVES_SESSION_NAMES_NO_PERMISSION,
        "a per-state ceiling was crossed: measured {no_session} no_session_resolution \
         (ceiling {}) and {assume} resolves_session_names_no_permission (ceiling {}). The \
         second class is authenticate-then-assume and is the largest here; it moved \
         without a decision. Migrants into that class: {}. Names in it with no ledger row \
         at all: {}. A migrant means a command whose measured state changed under a row \
         that still describes the old one -- usually a session parameter that arrived \
         without a permission check, which is a class-1 door becoming a class-2 door and \
         empties one ceiling while filling the other. Either gate it, or move its ledger \
         row to the true class AND raise that ceiling deliberately, naming the decision in \
         docs/records/JOURNAL.md.",
        debt::NO_SESSION_RESOLUTION,
        debt::RESOLVES_SESSION_NAMES_NO_PERMISSION,
        if migrated.is_empty() {
            "none".to_string()
        } else {
            migrated.join(", ")
        },
        if homeless.is_empty() {
            "none".to_string()
        } else {
            homeless.join(", ")
        },
    );
}

/// The generator, and the reason the ledger can no longer be hand-maintained.
///
/// The rows in `registration_gate_debt.generated.rs` are a pure function of the tree:
/// `run_sweep()` — the same predicate every other leg in this file runs — measures them,
/// and this leg either CHECKS the file against that measurement (the default) or REWRITES
/// it (when `KASIRMU_REGENERATE_GATE_LEDGER=1`). One predicate, one code path, so "the
/// ledger is what the sweep measures" is structural rather than a promise two separate
/// implementations keep to each other. A second implementation is the fork this file has
/// kept a single copy of `resolves_session` to avoid.
///
/// Regenerate with:
///
/// ```text
/// KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-mobile --lib \
///     drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture
/// ```
///
/// The check compares the ROWS — order, names, classes — and not the bytes: rustfmt may
/// wrap a row this generator wrote inline, and re-wrapping is not the fact this leg is
/// about. What it does catch is the drift the file exists to prevent: a gate that landed
/// under a row nobody deleted, a row whose class stopped being true while its counts
/// stayed inside their ceilings (the one thing the ceilings leg cannot see, because it
/// compares class COUNTS and only names migrants when a ceiling is crossed), and a name
/// typed from memory.
///
/// The measured TOTAL is written by the generator but deliberately NOT checked here:
/// `REGISTERED_SLACK` allows the ledger to lag the tree between regenerations, and
/// `drift_pin_registration_floor_is_met` is what pins this number to a value somebody had
/// to choose.
#[test]
fn drift_pin_generated_ledger_is_the_sweeps_own_output() {
    let rows = measured_ledger();
    let path = ledger_path();
    let current = read(&path);
    let total = registered_names(LIB_RS).len();

    if std::env::var(REGENERATE_ENV).as_deref() == Ok("1") {
        let rendered = rendered_ledger_file(&current, &rows, total);
        if rendered != current {
            fs::write(&path, &rendered)
                .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
        }
        // A generator that cannot pass its own check is a generator that would let the
        // next default run red on its own output, so the write is read back and checked
        // here rather than trusted.
        let written = read(&path);
        assert_eq!(
            ledger_diff(&rows, &parse_ledger_rows(&written)),
            None,
            "the regenerated ledger does not read back as the measurement it was written from"
        );
        assert!(
            written.contains(&format!("pub const REGISTERED_TOTAL: usize = {total};")),
            "the regenerated ledger did not take the measured registered total of {total}"
        );
        println!(
            "regenerated {}: {} debt row(s), registered total {total}",
            path.display(),
            rows.len()
        );
        return;
    }

    if let Some(diff) = ledger_diff(&rows, &parse_ledger_rows(&current)) {
        panic!(
            "registration_gate_debt.generated.rs disagrees with this sweep. Regenerate it \
             rather than editing it:\n  {REGENERATE_ENV}=1 cargo test -p kasirmu-mobile --lib \
             drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture\n\
             New debt needs its reason in docs/records/JOURNAL.md and a ceiling that still \
             covers it; paid debt needs its row deleted in the same pass that lowers the \
             ceiling. The disagreement:\n{diff}"
        );
    }
}

/// The four-field gate on the by-design side. Vacuous while the list is empty, and it
/// becomes the thing that refuses the first careless entry rather than a comment that
/// hopes.
#[test]
fn by_design_entries_carry_four_measured_fields() {
    let s = run_sweep();
    let registered: BTreeSet<String> = s
        .states
        .iter()
        .map(|((m, f), _)| format!("{m}::{f}"))
        .collect();
    let denied = denied_setting_names();

    for e in BY_DESIGN_UNGATED {
        let function = e.name.rsplit("::").next().unwrap_or("").to_string();
        let want: BTreeSet<String> = [function.clone()].into_iter().collect();
        let sources = fn_sources(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands"),
            &want,
        );
        let hits = sources.get(&function).cloned().unwrap_or_default();
        assert!(
            !hits.is_empty(),
            "{} is exempted by name but the sweep cannot find its body",
            e.name
        );

        match e.args {
            "none" | "session_token" => {}
            other => panic!(
                "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {} declares args={other:?}; the \
                 only eligible values are none and session_token, and a caller-controlled \
                 argument makes the name INELIGIBLE rather than excepted",
                e.name,
            ),
        }
        let args_hold = hits.iter().any(|text| {
            let signature = text.split('{').next().unwrap_or(text);
            match e.args {
                "none" => !signature.contains("session_token"),
                _ => signature.contains("session_token"),
            }
        });
        assert!(
            args_hold,
            "{} declares args={} but its real Rust signature says otherwise. Fix the call \
             site or leave the name on the ledger.",
            e.name, e.args,
        );

        for field in e.projects {
            assert!(
                !denied.contains(*field),
                "{} projects {field}, which is on platform-core's credential or \
                 device-identity deny list: an exempted door may not read a denied key",
                e.name,
            );
            assert!(
                !field.contains("secret")
                    && !field.contains("api_key")
                    && !field.contains("password"),
                "{} projects {field}, which is credential-shaped; the hostname excuse is \
                 what moved REDIS_URL onto the deny list",
                e.name,
            );
        }

        assert!(
            matches!(e.effect, "read_only" | "app_write"),
            "{} declares effect={:?}, which is neither read_only nor app_write",
            e.name,
            e.effect,
        );
        assert!(
            !e.twin.is_empty() && !e.permission.is_empty(),
            "{} is exempted with no gated twin named: the exemption claims a gated form \
             exists elsewhere, and with no twin that claim cannot be falsified",
            e.name,
        );
        assert!(
            registered.contains(e.twin),
            "{} names twin {}, which is not registered in this shell",
            e.name,
            e.twin,
        );
        assert!(
            !e.callers.is_empty(),
            "{} carries an empty caller census. An exemption argued from nothing-calls-this \
             is a claim about a file that goes stale the first time a screen wires it up, \
             so state the call sites or leave the name in debt",
            e.name,
        );
    }
}

/// SECRET_KEY_DENY_LIST and NON_EXPORTABLE_DEVICE_KEYS, read from platform-core so this
/// file holds no copy of a list it only checks.
fn denied_setting_names() -> BTreeSet<String> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../platform/core/src/settings/keys.rs");
    let src = read(&path);
    let mut out = BTreeSet::new();
    for list in ["SECRET_KEY_DENY_LIST", "NON_EXPORTABLE_DEVICE_KEYS"] {
        // Anchored on the DECLARATION, not the name: the name appears first in a
        // prose doc comment above each list, and matching there reads a bracket out
        // of a sentence, resolves zero keys, and leaves this leg checking against
        // nothing. That is the shape of a silent pass.
        let Some(at) = src.find(&format!("pub const {list}")) else {
            panic!(
                "keys.rs declares no {list}: the credential lists moved, so the projection \
                 leg is checking against nothing"
            )
        };
        // The declaration region, cut at its own terminator. Take the LAST "&[" in
        // it: the first is the TYPE ("&[&str]"), and reading the list from there
        // resolves zero keys and leaves this leg comparing against nothing. One list
        // is written "= &[" and the other an indented "&[", so neither a fixed offset
        // nor a single find survives contact with the real file.
        let decl = &src[at..];
        let Some(tail) = decl.find("];") else {
            continue;
        };
        let region = &decl[..tail + 1];
        let Some(open) = region.rfind("&[") else {
            continue;
        };
        let inner = &region[open + 2..region.len() - 1];
        for item in inner.split(',') {
            let item = item.split("//").next().unwrap_or("").trim().to_string();
            if item.is_empty() {
                continue;
            }
            if let Some(value) = keys_literal_value(&src, &item) {
                out.insert(value);
            }
        }
    }
    assert!(
        out.len() >= 15,
        "the sweep resolved only {} names out of the two deny lists: keys.rs changed \
         shape, so the projection leg is comparing against a short list",
        out.len()
    );
    out
}

/// Resolve a pub const NAME: &str = "value" declared in keys.rs, so the check follows
/// the constants the lists are built from rather than their identifiers.
fn keys_literal_value(keys_src: &str, ident: &str) -> Option<String> {
    let needle = format!("{ident}:");
    for line in keys_src.lines() {
        let line = line.trim();
        if !line.starts_with("pub const") || !line.contains(&needle) {
            continue;
        }
        let rest = line.rsplit('=').next()?;
        let first = rest.find(DOUBLE_QUOTE)?;
        let last = rest.rfind(DOUBLE_QUOTE)?;
        if last <= first {
            return None;
        }
        return Some(rest[first + 1..last].to_string());
    }
    None
}

/// No computed command names. A static allowlist is a fiction the moment a caller can
/// build the name at runtime, so this bans invoke(variable) outright. It reads as a text
/// sweep because that is the only mechanism available across a crate boundary.
#[test]
fn drift_pin_no_computed_command_names_in_ui() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/src");
    assert!(
        root.exists(),
        "ui/src is not reachable from this crate, so the ban on computed command names \
         cannot run: a ban that reads nothing is a ban that permits everything"
    );
    let mut files = Vec::new();
    collect_ts(&root, &mut files);
    assert!(
        files.len() >= 200,
        "the ui sweep found only {} TypeScript files, which means it is reading the wrong \
         directory rather than a clean tree",
        files.len()
    );

    // The three known non-literal sites, all dev-mock or test scaffolding, measured
    // 12-09-26: a mock forwarding a variable it was handed, and one test doing the same.
    // Neither is a screen calling a command.
    let allowed = [
        "dev-mock/tauri-api.ts",
        // MIRROR REPAIR 13-09-26: ce8666604 extracted the dev-mock core and left
        // desktop's allowlist with a sixth entry that this tablet copy never got,
        // so the tablet ratchet went red on a desktop-extracted file the moment it
        // landed. The dispatcher declares `async invoke(cmd, ...)` and forwards the
        // parameter it was handed, so it composes no command name — a FORWARDER,
        // same ruling as the desktop entry (see the sibling comment in
        // apps/desktop-tauri/src/commands/registration_gate_tests.rs). Tolerating
        // it does not bless the handlers registry beside it: a name built there is
        // still a computed name and still lands in the offender list.
        "dev-mock/core/mockDispatcher.ts",
        "__tests__/dev-mock-scoped-aliases.test.ts",
        // FOUND TONIGHT, NOT PRE-AUTHORISED - FLAGGED FOR A RULING. A production
        // wrapper that takes the command name as a parameter and forwards it, so the
        // name is a literal at every call site but invisible to this sweep. Its two
        // sibling entries below are test scaffolding doing the same thing. If
        // logged-invoke is meant to be the only funnel, this ban should be rewritten
        // to run over its callers instead of over invoke( sites.
        "utils/logged-invoke.ts",
        "__tests__/useSessionKeepalive.test.ts",
    ];

    let mut offenders = Vec::new();
    let mut literal = 0usize;
    let mut total = 0usize;
    for f in &files {
        let rel = f
            .display()
            .to_string()
            .replace(std::path::MAIN_SEPARATOR, "/");
        let inside_allowed = allowed.iter().any(|a| rel.ends_with(a));
        for (i, line) in read(f).lines().enumerate() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") || trimmed.starts_with('*') || trimmed.starts_with("/*") {
                continue;
            }
            let mut rest = line;
            while let Some(hit) = rest.find("invoke(") {
                total += 1;
                let after = rest[hit + 7..].trim_start();
                let first = after.chars().next().unwrap_or('x');
                if first == DOUBLE_QUOTE || first == SINGLE_QUOTE {
                    literal += 1;
                } else if !inside_allowed {
                    offenders.push(format!("{}:{}", rel, i + 1));
                }
                rest = &rest[hit + 7..];
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {literal} of {total} invoke() sites in \
         ui/src name the command as a literal and these {} build it at runtime: \
         {offenders:?}. A computed name defeats every allowlist in this file, because the \
         name being checked is no longer the name being called.",
        offenders.len(),
    );
}

/// Report only — prints and exits zero, by design.
///
/// ui/src/__tests__/api-security-contract.test.ts and
/// ui/src/__tests__/api-data-contract.test.ts pin unscoped command literals
/// deliberately, as a record of a reachable bypass, and the ADR-7 conditional scoping in
/// ui/src/features/settings/DataManagementScreen.tsx is a UI-side artefact with a
/// different fix owner from a line in lib.rs. A gate that goes red on an intentional
/// record is a gate somebody deletes, so this leg informs and never blocks. Nothing
/// below it asserts.
#[test]
fn report_ui_census_informs_and_does_not_block() {
    let s = run_sweep();
    println!(
        "REGISTRATION GATE CENSUS (report only, asserts nothing): {} registered, {} gated, \
         {} ungated against a ceiling of {}, {} registered names the generator could not \
         resolve a body for.",
        s.states.len(),
        s.states.len() - s.ungated.len(),
        s.ungated.len(),
        debt::DEBT_CEILING,
        debt::UNSOURCED,
    );
    for (name, state) in &s.ungated {
        println!("  UNGATED {name}: {}", state.key());
    }
}

fn collect_ts(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_ts(&p, out);
        } else if matches!(
            p.extension().and_then(|s| s.to_str()),
            Some("ts") | Some("tsx")
        ) {
            out.push(p);
        }
    }
}

/// The classifier's own eyes, tested. `names_permission` grew a marker for gates
/// reached through a DOMAIN helper (`require_inventory_permission(…)`), after 20
/// commands in `inventory_counts` and `stock_transfers` had sat in the ledger as
/// `resolves_session_names_no_permission` while every one of them called a real
/// check. Both directions are pinned on purpose: the helper call must read as a
/// gate, and the same text with the call deleted must read as debt again. A
/// marker that cannot notice its own absence is not a marker.
#[test]
fn classifier_reads_a_domain_permission_helper_as_a_gate_and_its_absence_as_debt() {
    let gated = "pub async fn create_stock_count_scoped(\n    session_token: String,\n    state: State<'_, AppState>,\n) -> Result<(), AppError> {\n    let (session, conn) = state.resolve_scope(&session_token)?;\n    require_inventory_count_permission(&state, &session.user_id).await?;\n    Ok(())\n}\n";
    assert!(
        resolves_session(gated),
        "the fixture must resolve a session, or it proves nothing"
    );
    assert!(
        names_permission(gated),
        "a gate reached through a domain helper must read as a permission check"
    );

    let hole = gated.replace(
        "    require_inventory_count_permission(&state, &session.user_id).await?;\n",
        "",
    );
    assert_ne!(hole, gated, "the planted removal must find its target");
    assert!(
        !names_permission(&hole),
        "with the call removed this is a bare authenticate-then-assume body; the marker \
         must not be matching something else in it"
    );
    assert!(
        resolves_session(&hole),
        "and it must still resolve a session, which is exactly what makes it debt"
    );
}

/// Guard-shaped identifiers named anywhere in a line: `require_…` / `authorize_…`.
/// Comment lines are skipped, because a doc comment that mentions a helper is not a
/// call to it -- the same per-line comment rule that bit the `generate_handler!`
/// parser earlier in this programme's history.
fn guard_identifiers(line: &str) -> Vec<String> {
    if line.trim_start().starts_with("//") {
        return Vec::new();
    }
    let mut out = Vec::new();
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let is_ident_start = chars[i].is_ascii_alphabetic() || chars[i] == '_';
        if !is_ident_start {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
            i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        if word.starts_with("require_") || word.starts_with("authorize_") {
            out.push(word);
        }
    }
    out
}

/// The vocabulary of accepted guards is CLOSED, not open-ended.
///
/// `names_permission` answers with `contains`, so any future domain helper
/// (`require_audit_permission`, say) would silently classify every command that
/// calls it as gated -- the exact failure this file spent 2026-09-16 discovering,
/// where twenty stock-count and transfer commands sat in the ledger as debt because
/// their real gate was spelled a name the list did not know. Refusing to be
/// surprised again is cheap: walk the bodies the sweep already reads, pull every
/// `require_…` / `authorize_…` identifier out of them, and require each one to be
/// covered by a marker. A new spelling fails here and forces a deliberate entry --
/// or a deliberate exemption, which is what the list below is for.
#[test]
fn drift_pin_guard_marker_vocabulary_is_closed() {
    // Names that look like guards but are NOT per-user permission checks, each with the
    // reason it is exempt. Treating either as a marker would re-open this file's failure
    // in the opposite direction: a command would read as RBAC-gated because it calls
    // something that says "require".
    let exemptions: BTreeMap<&str, &str> = BTreeMap::from([
        // commands/audit.rs:103. Returns AppError::PermissionDenied, but it inspects
        // build_entitlements(...).tier -- the SUBSCRIPTION plan, not the caller's role.
        // A Premium-plan user holding no audit:read passes it, so it cannot stand as
        // evidence that the seven audit commands check permissions.
        (
            "require_audit_tier",
            "plan-tier availability gate, not a per-user permission check",
        ),
        // commands/staff.rs:475 -> Store::require_role_assignable (crates/kasirmu-core):
        // validates that the role being assigned exists and may be assigned. Data
        // integrity around an authorization change, not the authorization itself.
        (
            "require_role_assignable",
            "role-assignment validity check in the store layer",
        ),
    ]);

    let sweep = run_sweep();
    let mut want = BTreeSet::new();
    for ((_module, function), _state) in &sweep.states {
        want.insert(function.clone());
    }
    let sources = fn_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands"),
        &want,
    );

    let mut vocabulary: BTreeSet<String> = BTreeSet::new();
    for hits in sources.values() {
        for text in hits {
            for line in text.lines() {
                for word in guard_identifiers(line) {
                    vocabulary.insert(word);
                }
            }
        }
    }

    let unknown: Vec<&str> = vocabulary
        .iter()
        .filter(|id| !GUARD_MARKERS.iter().any(|marker| id.contains(marker)))
        .filter(|id: &&String| !exemptions.contains_key(id.as_str()))
        .map(String::as_str)
        .collect();
    assert!(
        unknown.is_empty(),
        "command bodies call guard-shaped names this file has never heard of: {unknown:?}. \
         Add each to GUARD_MARKERS (it is a gate, and every command calling it was being \
         miscounted as debt until you did) or to the exemption list with a reason (it is \
         not a gate). Vocabulary of guard names found: {}.",
        vocabulary.len(),
    );
}
