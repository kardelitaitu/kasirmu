//! Registration gate ratchet — desktop shell.
//!
//! # What this is
//!
//! A ratchet over the CLASS, not the instances. The tauri::generate_handler! macro in
//! ../lib.rs is the whole renderer-reachable surface of this shell: 447 registered
//! names as measured 13-09-26, one fewer than yesterday because
//! `security::rotate_encryption_key` was deregistered rather than scoped. Every registered name is parsed out of this crate's own
//! source at test time and placed in exactly one of three states:
//!
//! 1. gated — the wrapper resolves a session AND a permission is named on the path the
//!    wrapper actually takes (its own body, or the crates/oz-bridge/src module it
//!    forwards to — read the next section before trusting that word);
//! 2. BY_DESIGN_UNGATED — device and health metadata with no permission on either side,
//!    so no operator action is being authorised. EMPTY today, by decision rather than by
//!    omission;
//! 3. the debt ledger — everything else, one generated entry per name with the state it
//!    was measured in, in registration_gate_debt.generated.rs.
//!
//! # Why the bridge is in the parse set, and what green does NOT mean
//!
//! A desktop command wrapper is a SHIM. Wave A-E lifted the command bodies into
//! crates/oz-bridge/src; the shell file builds a BridgeCtx, forwards, and maps the error
//! back. Measured: ZERO of the 447 wrapper bodies in this crate name a permission. So
//! judging "is this gated" from the shims alone reports 447 ungated commands and proves
//! nothing about authorization. The predicate therefore follows the call one crate over
//! and merges by module stem, which is the same move
//! apps/desktop-client/tests/gate_audit.rs:22-30 already makes for the same reason. A
//! green run here means "no ungated name appeared and the ledger still adds up". It does
//! not mean "this shell is gated", and it must not be read as that second sentence.
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
//! 69 entries on desktop and 126 on tablet as measured, emitted by the same predicate
//! this file runs. It is generated because a hand-typed hundred-name list is where the
//! drift lives: someone gates one command, edits one line by hand, mistypes one name,
//! and the ratchet silently stops covering it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[path = "registration_gate_debt.generated.rs"]
mod debt;

/// The registered surface of this shell, measured 12-09-26. A moved include_str path
/// must not be able to pass by finding nothing.
const REGISTERED_FLOOR: usize = 447;
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
            if want.contains(&name) {
                if let Some((sig, body)) = grab(&chars, j) {
                    map.entry(name.clone()).or_default().push(sig + &body);
                }
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

/// Does this text name a permission?
/// The guard spellings this file recognises as a permission check. Substring-matched, so
/// `require_permission` also covers `require_permission_for_user`, `..._for_session` and
/// `..._scoped`. The four original tokens saw 8 of the 18 guard-shaped call spellings in
/// the repo and 280 of 657 of their call sites; the additions below are the ten the
/// 05:45 census found missing, led by `require_session_permission` (220 sites, 47 files).
/// `drift_pin_guard_marker_vocabulary_is_closed` is what stops this list rotting again.
const GUARD_MARKERS: &[&str] = &[
    "require_permission",
    "permissions::",
    "has_permission",
    "authorize_with",
    // Bespoke guards, per-domain helpers named after the permission they check. Each of
    // these contains "permission" but NOT the substring "require_permission", which is why
    // the original list missed every one of them.
    "require_session_permission",
    "require_session_resource_permission",
    "require_user_permission_scoped",
    "require_inventory_permission",
    "require_inventory_count_permission",
    "require_loyalty_permission",
    "require_tax_permission",
    "require_customer_permission",
    "require_audit_permission",
    "require_category_permission",
    "authorize_topology_write",
];

/// Guard-shaped call sites deliberately NOT treated as a permission check, with the reason.
/// Empty today: all 18 spellings the sweep finds are markers. It exists so an exemption is
/// a decision recorded in source rather than a silent miss, and
/// `drift_pin_guard_marker_vocabulary_is_closed` fails on an entry the sweep can no longer
/// find, so a stale exemption goes red too.
const GUARD_VOCAB_EXCEPTIONS: &[(&str, &str)] = &[];

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

/// Module stems whose oz-bridge module names a permission — the merge that makes a shim
/// judgeable at all.
fn gated_bridge_stems() -> BTreeSet<String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/oz-bridge/src");
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
                    || (text.contains("oz_bridge::") && stems.contains(&module)))
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
    assert!(
        no_session <= debt::NO_SESSION_RESOLUTION
            && assume <= debt::RESOLVES_SESSION_NAMES_NO_PERMISSION,
        "a per-state ceiling was crossed: measured {no_session} no_session_resolution \
         (ceiling {}) and {assume} resolves_session_names_no_permission (ceiling {}). The \
         second class is authenticate-then-assume and is the largest here; it moved \
         without a decision.",
        debt::NO_SESSION_RESOLUTION,
        debt::RESOLVES_SESSION_NAMES_NO_PERMISSION,
    );
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
        // is written "= &[", the other "=" then an indented "&[", so neither a fixed
        // offset nor a single find survives contact with the real file.
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
        // FOUND TONIGHT, NOT PRE-AUTHORISED - FLAGGED FOR A RULING. The dispatcher that
        // ce8666604 extracted declares `async invoke(cmd, ...)` at :98 and forwards the
        // parameter it was handed to the Tauri internals at :108, so it composes no
        // command name. This entry tolerates a FORWARDER and does not bless the handlers
        // registry at :116, which resolves a caller-supplied name at runtime: a name
        // built there is still a computed name and still belongs in the offender list.
        // One exact path, deliberately no `dev-mock/` prefix - a glob would swallow the
        // parked unscoped mock rows for free, which is the cover-up this list exists to
        // refuse.
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

/// Guard-shaped identifiers used as a call site — an identifier followed by `(` — in one
/// file, each with the 1-based line it appeared on. Text scan, not an AST: the question is
/// vocabulary, not reachability, and this file spends no dependency on parsing.
fn guard_call_sites(text: &str) -> Vec<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        if !(chars[i].is_ascii_lowercase() || chars[i] == '_') {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len()
            && (chars[i].is_ascii_lowercase() || chars[i] == '_' || chars[i].is_ascii_digit())
        {
            i += 1;
        }
        let id: String = chars[start..i].iter().collect();
        let mut k = i;
        while k < chars.len() && chars[k].is_whitespace() {
            k += 1;
        }
        if k >= chars.len() || chars[k] != '(' || !is_guard_shape(&id) {
            continue;
        }
        out.push((
            id,
            chars[..start].iter().filter(|c| **c == '\n').count() + 1,
        ));
    }
    out
}

/// The census shape: `require` then `permission`, a trailing `_with_permission`, `authorize`
/// then `permission`, or `has` then `permission`. Deliberately WIDER than GUARD_MARKERS, so a
/// new spelling of a shape this repo clearly likes surfaces as drift instead of passing.
fn is_guard_shape(id: &str) -> bool {
    let names_perm = id.contains("permission");
    (id.starts_with("require_") && names_perm)
        || id.contains("_with_permission")
        || (id.starts_with("authorize_") && names_perm)
        || (id.starts_with("has_") && names_perm)
}

/// Leg 8 — the marker vocabulary pinned against the repository, not against itself.
///
/// Query: every identifier of the shapes above followed by `(`, over
/// `apps/desktop-client/src`, `apps/tablet-client/src`, `platform` and
/// `crates/oz-bridge/src`, excluding `*_tests.rs` (helper and assertion names in a test file
/// are not gates). Measured 05:45 on e046e2f26: 242 production files, 18 distinct spellings,
/// 657 call sites — and the original four tokens recognised 8 spellings and 280 sites, blind
/// to require_session_permission (220 sites in 47 files) and every per-domain
/// require-domain-permission helper. Widening the list fixes today; this leg is what keeps it
/// true the day someone writes a bespoke guard, which the census shows is the norm here.
#[test]
fn drift_pin_guard_marker_vocabulary_is_closed() {
    // The two floors are anti-vacuity, not the finding. A sweep that read nothing would
    // satisfy both assertions below exactly as happily as three event-string matches satisfied
    // the debt ceiling on tablet, so: 14 under the 18 spellings measured, 200 under 242 files.
    const SPELLING_FLOOR: usize = 14;
    const FILE_FLOOR: usize = 200;

    // Self-check, before anything is read from disk: the sweep must be able to see a guard
    // spelling it has never seen. Run over a scratch source STRING rather than the tree, so
    // it cannot be satisfied by the repository and costs nothing. This is the leg that makes
    // the rest of the pin meaningful — the floors below bound how much the sweep finds, and
    // this one bounds whether it can find anything at all. (That the sweep once PANICKED on a
    // U+2500 in a box-drawing comment is evidence it reads real files; the byte-offset slice
    // that caused it is gone, and traversal is by char from here.)
    let probe_src = "fn probe(ctx: &BridgeCtx) -> Result<(), AppError> {\n    require_zzz_unseen_permission(ctx)?;\n    Ok(())\n}\n";
    let probe = guard_call_sites(probe_src);
    assert!(
        probe
            .iter()
            .any(|(id, line)| id == "require_zzz_unseen_permission" && *line == 2),
        "the guard-shape sweep cannot see a guard spelled require_zzz_unseen_permission in a \
         four-line string it was handed: {probe:?}. Nothing it reports about the \
         repository is trustworthy if it cannot report this."
    );
    assert!(
        !names_permission("require_zzz_unseen_permission")
            && GUARD_VOCAB_EXCEPTIONS
                .iter()
                .all(|(n, _)| *n != "require_zzz_unseen_permission"),
        "the probe spelling is now a marker or an exception, which means the leg above is \
         checking something that no longer surprises: pick a spelling no one would write."
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dirs = [
        root.join("src"),
        root.join("../tablet-client/src"),
        root.join("../../platform"),
        root.join("../../crates/oz-bridge/src"),
    ];
    for dir in &dirs {
        assert!(
            dir.exists(),
            "the guard-vocabulary sweep cannot read {}: a moved directory turns this pin into a check that inspects nothing, which is the one outcome worse than red.",
            dir.display()
        );
    }
    let mut files = 0usize;
    let mut sites = 0usize;
    let mut seen: BTreeMap<String, (usize, String)> = BTreeMap::new();
    for dir in &dirs {
        for f in rust_files(dir) {
            if f.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .ends_with("_tests")
            {
                continue;
            }
            files += 1;
            let text = read(&f);
            let name = f
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("?")
                .to_string();
            for (id, line) in guard_call_sites(&text) {
                sites += 1;
                seen.entry(id)
                    .and_modify(|(n, _)| *n += 1)
                    .or_insert((1, format!("{name}:{line}")));
            }
        }
    }
    assert!(
        files >= FILE_FLOOR,
        "the guard-vocabulary sweep read only {files} production files across {} roots: the paths moved, so it is about to certify a vocabulary it cannot see.",
        dirs.len()
    );
    assert!(
        seen.len() >= SPELLING_FLOOR,
        "the guard-vocabulary sweep found only {} distinct spellings in {files} files (floor {SPELLING_FLOOR}) across {} roots: 18 spellings over 657 call sites is the measured shape, and a scan that finds little is a scan matching nothing.",
        seen.len(),
        dirs.len()
    );
    let unknown: Vec<String> = seen
        .iter()
        .filter(|(id, _)| {
            !names_permission(id) && !GUARD_VOCAB_EXCEPTIONS.iter().any(|(n, _)| n == id)
        })
        .map(|(id, (n, at))| format!("{id} ({n} call sites, first at {at})"))
        .collect();
    assert!(
        unknown.is_empty(),
        "GUARD-VOCABULARY DRIFT: {} guard-shaped spelling(s) are called in production source but sit in neither GUARD_MARKERS nor GUARD_VOCAB_EXCEPTIONS: {}. A bespoke guard is not a permission check until someone decides it is — add the spelling to GUARD_MARKERS, or to GUARD_VOCAB_EXCEPTIONS with the reason it is not a gate. Until then a command that resolves a session and checks something can still be swept as ungated. (Sweep: {files} files, {sites} call sites, {} distinct spellings, {} markers, {} exceptions.)",
        unknown.len(),
        unknown.join("; "),
        seen.len(),
        GUARD_MARKERS.len(),
        GUARD_VOCAB_EXCEPTIONS.len()
    );
    let stale: Vec<&str> = GUARD_VOCAB_EXCEPTIONS
        .iter()
        .filter(|(n, _)| !seen.contains_key(*n))
        .map(|(n, _)| *n)
        .collect();
    assert!(
        stale.is_empty(),
        "GUARD-VOCABULARY DRIFT: {stale:?} are excepted but the sweep found no such call site in {files} files — the guard was renamed or deleted, so the exemption now covers nothing. Delete the entry rather than keep a list that no longer matches the tree."
    );
}
