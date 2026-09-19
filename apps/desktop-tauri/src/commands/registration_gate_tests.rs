//! Registration gate ratchet — desktop shell.
//!
//! # What this is
//!
//! A ratchet over the CLASS, not the instances. The tauri::generate_handler! macro in
//! ../lib.rs is the whole renderer-reachable surface of this shell: 455 registered
//! names as measured 16-09-26, two more than the 453 this floor was last written
//! against, because `b07e8c3ac` registered `pos::set_line_course_scoped` and
//! `pos::publish_course_fired_scoped`, both arriving already gated through `kasirmu_bridge::pos`.
//! Every registered name is parsed out of this crate's own
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
//! A desktop command wrapper is a SHIM. Wave A-E lifted the command bodies into
//! crates/kasirmu-bridge/src; the shell file builds a BridgeCtx, forwards, and maps the error
//! back. Measured: ZERO of the 449 wrapper bodies in this crate name a permission. So
//! judging "is this gated" from the shims alone reports 449 ungated commands and proves
//! nothing about authorization. The predicate therefore follows the call one crate over
//! and merges by module stem, which is the same move
//! apps/desktop-tauri/tests/gate_audit.rs:22-30 already makes for the same reason. A
//! green run here means "no ungated name appeared and the ledger still adds up". It does
//! not mean "this shell is gated", and it must not be read as that second sentence.
//!
//! (Measured 13-09-26, repair of the sync-conflict gate: the ZERO above was the state
//! when this header was written. Since then local bodies have named permissions in
//! growing numbers — branding::pick_logo_file_scoped, the six local_api commands, the
//! pg_sync pair, and now both sync-conflict commands — 11 of 449 today. The ZERO was
//! never the claim that matters; the three-way partition and the ledger are, and both
//! still hold: those 11 are Gated, absent from the ledger, and move no ceiling.)
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
//! The same leg is also the ONLY one that sees a GROWN surface. The partition-sum leg and
//! the ceilings leg both fire on names that arrive UNGATED; a command that arrives
//! already guarded moves neither, so the cheapest way to widen the IPC surface quietly
//! was to write the permission check first. REGISTERED_FLOOR used to be checked against
//! the generated ledger's total — one hand-kept constant compared with another — which is
//! the same measurement restated and so could not fail. It is now an equality against
//! `registered_names(LIB_RS)`, i.e. against the tree, so every registered name has to be
//! written down here by the person who registers it.
//!
//! # The ledger is generated, not typed
//!
//! 69 entries on desktop and 126 on tablet as measured, emitted by the same predicate
//! this file runs. It is generated because a hand-typed hundred-name list is where the
//! drift lives: someone gates one command, edits one line by hand, mistypes one name,
//! and the ratchet silently stops covering it. (Re-measured 13-09-26: the tablet
//! ledger has since shed one entry and stands at 125; desktop is still 69. The ceilings
//! in the generated files carry the live numbers — this sentence is context, not a
//! measurement the ratchet enforces.)
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

/// The registered surface of this shell, measured from `../lib.rs` as 455 names on
/// 16-09-26 (453 on 13-09-26). This is an EQUALITY and the leg below checks it against the tree, so a
/// moved include_str path cannot pass by finding nothing and a registered name cannot
/// pass by being gated. Raising this number records what landed; it does not approve it.
const REGISTERED_FLOOR: usize = 455;
/// How far the GENERATED ledger's total may lag the tree before the ledger is overdue a
/// regeneration. It is not slack on this floor — the floor is measured, not padded — and
/// the hard pin on the ledger's own rows is
/// `drift_pin_three_way_partition_is_complete_and_sums`.
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

/// Leg 1 — the floor, measured from the TREE. Two hazards, and the second is why this leg
/// stopped reading the ledger: a glob or include_str path that stopped matching must not
/// pass by finding nothing, and a surface that GREW must not pass by staying inside a
/// padding allowance. The count is `registered_names(LIB_RS)` — the same
/// generate_handler! inventory `run_sweep` walks for the partition leg — deliberately not
/// a fresh regex over the bracket (a nested bracket makes the two disagree by a name or
/// two) and no longer the generated ledger's total (one hand-kept constant compared with
/// another is the same measurement restated, so it cannot fail).
#[test]
fn drift_pin_registration_floor_is_met() {
    // The harness's own parse: bracket-balanced, comment-stripped, counted the way leg 2
    // counts it.
    let measured = registered_names(LIB_RS).len();
    assert!(
        measured >= REGISTERED_FLOOR,
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: the sweep parsed only {measured} \
         registered commands out of lib.rs, below the measured floor of {REGISTERED_FLOOR}. \
         A moved include_str path, a renamed macro or a relocated commands directory each \
         look exactly like this, and every other leg in this file silently checks nothing \
         when it happens. Fix the sweep before reading anything else here."
    );
    assert_eq!(
        REGISTERED_FLOOR, measured,
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: lib.rs registers {measured} commands \
         and this floor says {REGISTERED_FLOOR}. The floor reads the tree on purpose, so the \
         only way to be red here is that names were registered — and a command that arrives \
         ALREADY GATED moves no ceiling and no ledger row, which makes this leg the only \
         thing in the file able to see it. Raise the floor to {measured} in the same \
         deliberate pass that names each addition in docs/records/JOURNAL.md; raising it \
         records what landed, it does not approve it.",
    );
    assert!(
        measured.abs_diff(debt::REGISTERED_TOTAL) <= REGISTERED_SLACK,
        "the generated ledger counts {} registered names while the tree counts {measured} — \
         more than {REGISTERED_SLACK} apart, so the ledger and this file are guarding \
         separate measurements. The ledger, the ceilings and this floor all need \
         regenerating together in one deliberate pass.",
        debt::REGISTERED_TOTAL,
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
    // Name the movers. This leg used to print two counts and no identity, which meant a crossing
    // could only be diagnosed by reimplementing the sweep somewhere else -- and the first attempt
    // at that (a Python mirror, 2026-09-16) reported 17 where this leg reported 27, because its
    // author wrote `pub async fn` where commands may be synchronous, then a non-recursive
    // `glob` where the sweep walks subdirectories. Two bugs, one right name, and no way to know
    // which of the three numbers to trust. The label-vs-state diff below is the same question the
    // ledger can answer about itself, answered in the language that already owns the predicate.
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
/// KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-app --lib \
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
/// The measured TOTAL is written by the generator and deliberately NOT re-checked here:
/// this shell's floor leg already pins it to the tree (`REGISTERED_FLOOR` is an equality
/// against `registered_names(LIB_RS)`, not a floor plus slack), and stating the same
/// coupling twice would give the next reader two instruments to keep in step.
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
             rather than editing it:\n  {REGENERATE_ENV}=1 cargo test -p kasirmu-app --lib \
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

/// The call surface the computed-name ban reads: every invoke-shaped call in a file,
/// matched regardless of the case of the leading i and regardless of whether a generic
/// argument list stands between the name and its paren, so `loggedInvoke(`,
/// `loggedInvoke<Customer[]>(` and `mockInvoke(` are in it. A wrapper that puts letters of
/// its own between the word and the paren (`loggedInvokeGeneric(`) is NOT, and never was
/// -- see `invoke_open_paren` for the anchor and the open gap recorded with it.
///
/// Returns (sites, sites naming the command as a string literal, 1-based line numbers of
/// the rest). `inside_allowed` suppresses the offender list only, never the counts: the
/// toleration answers "may this file forward a name", not "what does the surface measure".
///
/// The needle was a case-sensitive `find("invoke(")` until 2026-09-13, which is why this
/// pin reported 103 sites while the tree held 196: the 37 `loggedInvoke` sites at
/// `ui/src/utils/logged-invoke.ts:14` and its callers under `ui/src/api` were invisible to
/// it. The ban exists to catch a command name built at runtime, and the wrapper is how the
/// UI makes most of its calls, so that case distinction was the difference between reading
/// the surface and reading a slice of it. `scripts/verify-ipc-parity.py` handled the
/// wrapper from the start - the comment above its regex names `loggedInvoke` with a generic
/// parameter - and this twin next to it had not caught up.
///
/// Catching up exposed a second hole of the same kind, found the night the first one was
/// closed: the needle also required the paren hard against the word, so a call spelled with
/// a type argument -- `loggedInvoke<Customer[]>("sync_pull")` -- was invisible in both
/// directions, counted as no site and flagged as no offender. 479 sites in this sweep were
/// written that way, 462 of them in production source, none of them in the 196 the pin
/// reported. The eye reads 675 now.
/// One invoke-shaped call site: the 1-based line, the identifier actually called, whether
/// the command name arrived as a string literal, and that first argument as written. The
/// token travels with the site so a report can name what it saw instead of asking the
/// reader to open the file and re-derive a verdict.
///
/// The needle is case-insensitive over the word and accepts one balanced `<...>` list in
/// front of the paren, so `loggedInvoke(`, `loggedInvoke<Customer[]>(`, `mockInvoke(` and
/// any future wrapper whose name ends where the call opens are in the surface. The breadth
/// is deliberate - a new wrapper is covered on day one rather than after the next audit -
/// and its cost is that a local helper named `myInvoke` stays in the denominator forever.
/// The cost it does not pay is an alias with a suffix of its own: `loggedInvokeGeneric(`
/// still scores zero sites, because the anchor is the word invoke as it meets the bracket
/// list or the paren. That gap is open, not covered, and the `pin_counts_a_generic_spelled_`
/// `wrapper_call` case below says which shapes it closes and which it leaves. That is why the
/// pin reports the shape of what it counted and not only a number.
fn scan_invoke_sites(text: &str) -> Vec<(usize, String, bool, String)> {
    let mut out = Vec::new();
    // The whole file, not just the current line: an argument can sit below its own paren.
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let line = *line;
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with('*') || trimmed.starts_with("/*") {
            continue;
        }
        // ASCII-only folding, so every byte offset stays valid against the original line
        // and a non-ASCII argument cannot move the window.
        let lower = line.to_ascii_lowercase();
        let bytes = line.as_bytes();
        let ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
        let mut from = 0usize;
        while let Some(hit) = lower[from..].find("invoke") {
            let start = from + hit;
            let word_end = start + "invoke".len();
            // The paren may be held back by one generic argument list: loggedInvoke<T>( is
            // the same call as loggedInvoke(. None means this is not a call site.
            let open = match invoke_open_paren(&lower, word_end) {
                Some(o) => o,
                None => {
                    // "invoke" has no border, so no occurrence of it can start inside the
                    // six bytes skipped here: advancing past a non-call cannot lose a site
                    // the old needle saw.
                    from = word_end;
                    continue;
                }
            };
            let after = open + 1;
            let mut word = start;
            while word > 0 && ident(bytes[word - 1]) {
                word -= 1;
            }
            let callee = line[word..start + "invoke".len()].to_string();
            let (first, token) = first_arg(&lines, i, after);
            out.push((
                i + 1,
                callee,
                first == DOUBLE_QUOTE || first == SINGLE_QUOTE,
                token,
            ));
            from = after;
        }
    }
    out
}

/// Where the `(` of an invoke-shaped call opens, given the byte just past the letters
/// `invoke`: either that byte, or the first byte after one balanced `<...>` list. Angle
/// brackets nest, so `List<Map<K, V>>` closes on its second bracket and not its first, and
/// `=>` is an arrow rather than a close, so a function-type argument such as
/// `<(c: number) => void>` cannot cut the scan short.
///
/// `None` means "not a call site": the list never closes on this line, a `;` turns up
/// before it closes, or what follows the word is neither a bracket list nor a paren.
/// Whitespace is tolerated only after a bracket list, never between the word and its own
/// paren, so the only calls this adds to the surface are generic-spelled ones. The needle
/// before 2026-09-13 could not see `loggedInvoke<Customer[]>(` at all, which is how a ban on
/// computed command names came to be reading a third of the surface it names.
fn invoke_open_paren(lower: &str, at: usize) -> Option<usize> {
    let bytes = lower.as_bytes();
    let mut i = at;
    if i < bytes.len() && bytes[i] == b'<' {
        let mut depth = 0usize;
        while i < bytes.len() {
            match bytes[i] {
                b'<' => depth += 1,
                // `=>` is an arrow inside a function-type argument, not the close.
                b'>' if i > at && bytes[i - 1] == b'=' => {}
                b'>' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                b';' => return None,
                _ => {}
            }
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        i += 1;
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
            i += 1;
        }
    }
    if i < bytes.len() && bytes[i] == b'(' {
        Some(i)
    } else {
        None
    }
}

/// The first thing an invoke-shaped call is handed: the character that decides literal or
/// not, and the token as written. Read across line breaks on purpose --
/// `loggedInvoke(\n  "sync_pull", args)` passes its name on the next line, and a scan that
/// stops at the end of its own line scores that as a name built at runtime. That blindness
/// predates the generic widening; the widening folded in 462 more production sites and two
/// of them happened to be written this way, which is what made it visible.
///
/// Only the ARGUMENT may arrive late. The paren is still matched on its own line by
/// `invoke_open_paren`, which is what keeps a prose mention such as "loggedInvoke (no
/// direct invoke)" out of the surface: no bracket list, no paren on the word, no call.
/// Returns `('x', "")` when nothing survives the look-ahead, the same sentinel the scan used
/// before, so an argument-less call is still read as computed rather than as no verdict at all.
///
/// # Prose is not an argument. The bound is unchanged.
///
/// The first version of this look-ahead skipped only BLANK lines, so the first non-blank line
/// below the paren won whether or not it was code. A comment written between the paren and the
/// name therefore BECAME the argument: the token read was `//`, a slash is not a quote, and a
/// literal command name was scored as one assembled at runtime. Measured out of tree against
/// the committed code (verbatim copy of these three functions, 13-09-26 11:31): one comment
/// line above a string literal classified as 1 site, 0 literal, computed at the call line --
/// the identical verdict a genuinely computed name produces. Two comment lines, a `/* ... */`
/// that opens and closes on the call's own line, and a `/** ... */` block all did the same.
/// The direction is worth naming for whoever reads the next red: a misread literal can only ADD
/// an offender, never hide one, so this defect was a false positive, not a silent pass.
///
/// Comment lines -- a `//` to end of line, a `/* ... */` block, and a `*` continuation with its
/// closer -- are now stepped over, so prose can neither become the argument nor push a real one
/// out of sight. The window itself is untouched: the call's own line plus three lines below it.
/// That is deliberate and it is the part of this fix most likely to be "improved" away later.
/// Widening it to chase a deeper comment would let the scan read across an intervening
/// statement and call that data, which is the same guess the bound exists to refuse. So a name
/// that only appears on the fourth line below the call is still scored computed, and
/// `pin_a_comment_between_the_
/// paren_and_the_argument_is_not_the_argument` asserts all three -- crossed at one and two
/// comment lines, refused at three, and refused for the right reason (an empty token, never
/// the prose) -- so the wall cannot quietly become a tunnel in either direction.
///
/// Zero instances of the shape exist in ui/src today (measured 13-09-26: the four listed
/// computed sites report the tokens `cmd`, `cmd:`, `cmd`, `cmd:`, none reports a comment), so
/// this wall is built before the fall, and the printed surface counts are the evidence that it
/// moved no verdict on the tree as it stands.
fn first_arg(lines: &[&str], line_at: usize, col: usize) -> (char, String) {
    // Bounded look-ahead: three lines below the call is an argument, thirty lines below is
    // somebody else's code, and a token read from there would be a guess dressed as data.
    let window_end = (line_at + 4).min(lines.len());
    // `get()` rather than a slice index: an out-of-range `line_at` must yield an
    // empty window (what the old open-ended range did), not a panic.
    let window = lines.get(line_at..window_end).unwrap_or(&[]);
    for (ahead, &text) in window.iter().enumerate() {
        let raw = if ahead == 0 {
            text.get(col..).unwrap_or("")
        } else {
            text
        };
        let mut trimmed = raw.trim_start();
        // Step over the prose. A block comment may open and close inside one line, run to the
        // edge of the window, or continue across lines; none of it may be read as the argument,
        // and none of it may hide an argument that follows it on the same line.
        loop {
            if trimmed.starts_with("/*") {
                trimmed = trimmed[2..].trim_start();
                match trimmed.find("*/") {
                    Some(end) => {
                        trimmed = trimmed[end + 2..].trim_start();
                    }
                    None => {
                        trimmed = "";
                        break;
                    }
                }
                continue;
            }
            if trimmed.starts_with("//") {
                trimmed = ""; // a line comment runs to the end of the line
                break;
            }
            if trimmed.starts_with('*') {
                // A continuation of a block opened above, or its closer.
                match trimmed.find("*/") {
                    Some(end) => {
                        trimmed = trimmed[end + 2..].trim_start();
                        continue;
                    }
                    None => {
                        trimmed = "";
                        break;
                    }
                }
            }
            break;
        }
        if trimmed.is_empty() {
            continue;
        }
        let mut token = String::new();
        for ch in trimmed.chars() {
            if ch.is_whitespace() || ch == ',' || ch == ';' {
                break;
            }
            if token.chars().count() >= 40 {
                token.push('~');
                break;
            }
            token.push(ch);
        }
        return (trimmed.chars().next().unwrap_or('x'), token);
    }
    ('x', String::new())
}

/// Is this file test scaffolding rather than production source? Mirrors
/// `scripts/verify-ipc-parity.py:91`, which drops any path with a `__tests__` component
/// before it extracts UI command strings (measured 2026-09-13: its `UI_SCAN_DIRS` at :50
/// is seven production roots and its walk at :88 skips `__tests__` at :91). The two
/// gates must agree on what production source means, or this ban protects a surface the
/// extractor never reads and the agreement is fiction.
fn counts_as_test_scaffold(rel: &str) -> bool {
    rel.split('/').any(|part| part == "__tests__")
}

/// Does a computed-name site in this file make it an offender? Production source only,
/// and never a file already on the toleration list.
///
/// WHY THE TWO HALVES DIFFER, for whoever is tempted to collapse them: this ban exists
/// because the parity extractor and every allowlist here match command names as SOURCE
/// TEXT, and a name assembled at runtime is the one thing they cannot see. That hazard
/// lives in production source - and the extractor reads production source only:
/// `scripts/verify-ipc-parity.py:50` names seven production roots and its walk drops any
/// `__tests__` path at :91, so a test file cannot skew parity either way. A `vi.mock`
/// factory written as `loggedInvoke: (cmd, args) => mockInvoke(cmd, args)` is not a UI
/// building a command name; it is a test handing one through, which is the entire point
/// of a mock. Failing on all of them would train the next reader to delete the pin; the
/// live count is the one this sweep prints (60 on 2026-09-13), not a number parked in a
/// comment, because a prose count cannot be refreshed by the code it describes.
///
/// The counts are still taken on both halves, so this routes findings - it never deletes
/// numbers. A scope that silently dropped 60 sites would be an allowlist with the
/// reasons left out.
/// Files whose computed names this ban tolerates, as trailing path components. Each entry
/// is a decision about ONE FILE, never a directory and never a substring: the sweep is
/// whole-tree, so an entry that reads like a folder hands out an exemption to everything in
/// it. The two `FOUND TONIGHT` rulings below are flagged as un-pre-authorised on purpose
/// -- they tolerate a forwarder, not a name resolver.
///
/// Measured 12-09-26: five entries, two of them carrying the four surviving production
/// computed sites (`ui/src/utils/logged-invoke.ts` at :14 and :18, `dev-mock/core/mockDispatcher.ts`
/// at :98 and :108). `utils/logged-invoke.ts` is the wrapper's own file, so this table is the
/// only thing standing between those two sites and an offender list.
const TOLERATED_FORWARDS: &[&str] = &[
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

/// Does `rel` fall under one of the `TOLERATED_FORWARDS` entries? An entry matches when its components
/// are the trailing components of the swept path -- component-by-component, at any depth,
/// and never as a substring of a component.
///
/// The rule used to be `rel.ends_with(entry)` on an ABSOLUTE path, i.e. a bare character
/// suffix. That inherits an exemption for anything whose name merely ends with the same
/// letters: `ui/src/mynested-dev-mock/tauri-api.ts` was tolerated by `dev-mock/tauri-api.ts`,
/// because "mynested-dev-mock" ends with "dev-mock" and the rule never looked at where the
/// component boundary was. A tolerated file is not a tolerated directory and a tolerated
/// name is not a tolerated prefix of one.
fn toleration_applies(rel: &str) -> bool {
    let rel_parts: Vec<&str> = rel.split('/').filter(|c| !c.is_empty()).collect();
    TOLERATED_FORWARDS.iter().any(|entry| {
        let want: Vec<&str> = entry.split('/').filter(|c| !c.is_empty()).collect();
        // Whole trailing components, and never the whole path: a swept path always has the
        // sweep root above it, so an entry that could consume the entire path would be a
        // glob in disguise -- exactly what the mockDispatcher entry refuses to be.
        want.len() < rel_parts.len() && rel_parts[rel_parts.len() - want.len()..] == want[..]
    })
}

/// The root this sweep owns: `ui/src` of THIS checkout, spelled exactly the way the pin at
/// the top of `drift_pin_no_computed_command_names_in_ui` spells it. Derived from
/// `CARGO_MANIFEST_DIR` inside the predicate rather than passed in, because the whole point of
/// the wall is that a caller cannot supply it.
fn ui_sweep_root_string() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui/src")
        .display()
        .to_string()
}

/// Whole components of a path, forward-slashed the way the sweep normalises to. Owned
/// strings, so the caller cannot be left holding a reference into a temporary.
fn path_components(path: &str) -> Vec<String> {
    path.replace(std::path::MAIN_SEPARATOR, "/")
        .split('/')
        .filter(|c| !c.is_empty())
        .map(|c| c.to_string())
        .collect()
}

/// Does this path arrive absolute? A drive prefix or a leading separator. Kept crude and
/// lexical on purpose: an absolute path claims a filesystem, and only the sweep root may say
/// which one; a relative path is read as relative to the repo, which is the shape the
/// in-memory fixtures use (`ui/src/features/...`) and nothing looser.
fn looks_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/') || path.starts_with("\\") || (bytes.len() > 1 && bytes[1] == b':')
}

/// Is this path inside THIS checkout's `ui/src`, as whole leading components?
///
/// Until now the predicate below never asked. It decided "is this an offending UI call site"
/// from two things, neither of which is a location: whether the caller said the file was
/// tolerated, and whether the path contains a `__tests__` component. That is a shape test
/// wearing a verdict, and this layout is multi-root -- a bare `main`, one directory per
/// release, registered worktrees beside each other -- so the shape is not unique to a
/// checkout and one checkout's gate can read another's files.
///
/// Measured, not inferred (out of tree against the predicate exactly as it stood at HEAD,
/// 13-09-26 11:41, using the sibling checkouts that exist on this disk: `git worktree list`
/// reports `C:/dev/ozpos/kds-m2-scratch`, and `C:/dev/ozpos/main` plus
/// `C:/dev/ozpos/0.0.34` both hold a real `ui/src`):
///
/// * `C:/dev/ozpos/main/ui/src/features/sales/SalesScreen.tsx` --> offender = TRUE
/// * `C:/dev/ozpos/0.0.34/ui/src/features/sales/SalesScreen.tsx` --> offender = TRUE
/// * `C:/dev/ozpos/kds-m2-scratch/ui/src/features/sales/SalesScreen.tsx` --> offender = TRUE
/// * `C:/dev/ozpos/main/crates/kasirmu-core/src/sales.rs`, a Rust file, not a UI file at all
///   --> offender = TRUE
///
/// So the bug is not a theoretical root confusion. A gate running in `0.0.35` was
/// adjudicating the bare `main` checkout, a sibling release and a live worktree, and it was
/// doing it in both directions: the same `ui/src`-shaped rule also excused
/// `main/ui/src/utils/logged-invoke.ts` and `0.0.34/ui/src/dev-mock/tauri-api.ts`, files this
/// sweep never touched and has no standing to forgive. Every one of those verdicts was wrong
/// without looking wrong, which is the reason for the wall.
///
/// Deliberately LEXICAL, not canonical: `fs::canonicalize` would make the answer depend on
/// what happens to exist on disk, and the fixtures below pass paths that do not. It also
/// keeps the `..` segments as written rather than resolving them -- a swept path and this
/// root are built by the same expression, so the two agree component for component with no
/// help from the filesystem.
fn under_ui_sweep_root(rel: &str) -> bool {
    let here = path_components(rel);
    let root = path_components(&ui_sweep_root_string());
    if here.len() >= root.len() && here[..root.len()] == root[..] {
        return true;
    }
    if looks_absolute(rel) {
        return false;
    }
    let tail = &root[root.len() - 2..];
    here.len() > 2 && &here[..2] == tail
}

/// Does a computed-name site in this file make it a UI offender? It must be a UI file at all
/// first; then production source, and never a file already on the toleration list.
///
/// The root check comes FIRST and short-circuits, so a path outside this checkout gets no
/// verdict in either direction -- not "offends", and not the quieter harm of "excused".
/// `toleration_applies` keeps its any-depth trailing-component rule untouched, because that
/// is what c5292bae8 pinned it to be: a way of naming a FILE by the components that identify
/// it, inside the root. It was never a statement about which checkout the file lives in, and
/// the pairing is now explicit -- the list decides which UI file is forgiven, this predicate
/// decides whether the file is UI at all.
///
/// Behaviour on the real tree is unchanged by construction: every path the sweep hands over
/// is built from the same manifest expression this function re-derives, so all 675 sites keep
/// the verdict they had. That is what makes it a wall and not a policy change.
fn computed_name_is_an_offender(rel: &str, inside_allowed: bool) -> bool {
    under_ui_sweep_root(rel) && !inside_allowed && !counts_as_test_scaffold(rel)
}

/// The three counts for one file, with the offender list suppressed when the file is on
/// the toleration list. Delegates to `scan_invoke_sites` so the counts and the callee
/// breakdown reported beside them cannot drift apart.
fn classify_invoke_surface(text: &str, inside_allowed: bool) -> (usize, usize, Vec<usize>) {
    let sites = scan_invoke_sites(text);
    let literal = sites.iter().filter(|(_, _, is_lit, _)| *is_lit).count();
    let computed = if inside_allowed {
        Vec::new()
    } else {
        sites
            .iter()
            .filter(|(_, _, is_lit, _)| !*is_lit)
            .map(|(line, _, _, _)| *line)
            .collect()
    };
    (sites.len(), literal, computed)
}
/// No computed command names. A static allowlist is a fiction the moment a caller can
/// build the name at runtime, so this bans invoke(variable) outright. It reads as a text
/// sweep because that is the only mechanism available across a crate boundary.
///
/// The surface swept is every call where the word `invoke` meets the paren, a generic
/// argument list allowed in between, wrapper included: see `classify_invoke_surface` below.
/// The wrapper is where the UI actually sends traffic. A suffixed alias is still outside
/// that surface, and the open gap is named where the needle lives.
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

    // The tolerated files moved to TOLERATED_FORWARDS, next to the rule that reads them, so
    // the path shape can be tested as a case that can fail instead of living where only the
    // sweep can reach it. Nothing about the entries themselves changed in the move.

    // Three counts, both halves, printed whether or not the leg is red. The production
    // computed count is not tallied on its own any more: every such site is rendered into
    // the prod_sites list as it is found, and the number printed beside it is that list's
    // length, so a headline cannot disagree with the evidence under it. This file shipped a
    // line reading "6 computed, these offend" over a two-entry offender list while the prose
    // beside it said five -- three numbers, two of them about different things, none of them
    // checkable against another.
    let mut offenders = Vec::new();
    let mut prod_sites: Vec<String> = Vec::new();
    let mut total = 0usize;
    let mut prod_total = 0usize;
    let mut test_total = 0usize;
    let mut test_computed = 0usize;
    let mut test_callees: Vec<String> = Vec::new();
    for f in &files {
        let rel = f
            .display()
            .to_string()
            .replace(std::path::MAIN_SEPARATOR, "/");
        let inside_allowed = toleration_applies(&rel);
        let offend = computed_name_is_an_offender(&rel, inside_allowed);
        let scaffold = counts_as_test_scaffold(&rel);
        for (at, callee, is_lit, token) in scan_invoke_sites(&read(f)) {
            total += 1;
            if scaffold {
                test_total += 1;
                if !is_lit {
                    test_computed += 1;
                    test_callees.push(callee);
                }
            } else {
                prod_total += 1;
                if !is_lit {
                    prod_sites.push(format!(
                        "{}:{}  callee `{}(`  first argument as seen: {}  {}",
                        rel,
                        at,
                        callee,
                        if token.is_empty() {
                            "(nothing follows the paren on this line or the next three)".to_string()
                        } else {
                            token
                        },
                        if offend {
                            "OFFENDS"
                        } else {
                            "tolerated by rule: a forwarder"
                        }
                    ));
                    if offend {
                        offenders.push(format!("{}:{}", rel, at));
                    }
                }
            }
        }
    }
    prod_sites.sort();
    offenders.sort();
    // The count IS the list. Nothing below re-derives it.
    let prod_computed = prod_sites.len();
    let offenders_len = offenders.len();
    let prod_literal = prod_total - prod_computed;
    let test_literal = test_total - test_computed;
    test_callees.sort();
    let mut breakdown = String::new();
    let mut i = 0usize;
    while i < test_callees.len() {
        let mut n = 1usize;
        while i + n < test_callees.len() && test_callees[i + n] == test_callees[i] {
            n += 1;
        }
        breakdown.push_str(&format!(
            "  EXCLUDED, TEST-SIDE COMPUTED SITE {n} x `{}(` - a forwarder in a test, not a UI building a name\n",
            test_callees[i]
        ));
        i += n;
    }
    println!(
        "INVOKE SURFACE, BOTH HALVES: {total} invoke-shaped call sites in ui/src = \
         {prod_total} production non-test ({prod_literal} literal / {prod_computed} \
         computed, each one listed below) + {test_total} test scaffolding ({test_literal} \
         literal / {test_computed} computed, these are reported, not failed).",
    );
    println!(
        "PRODUCTION COMPUTED SITES: {prod_computed} listed, {offenders_len} offend, {} sit in \
         a tolerated file. Count and list are the same value; if they ever disagree, the \
         list is right.",
        prod_computed - offenders_len
    );
    for site in &prod_sites {
        println!("  {site}");
    }
    print!("{breakdown}");
    assert!(
        offenders.is_empty(),
        "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {total} invoke-shaped call sites in \
         ui/src, counting every call where the word invoke meets the paren, one balanced \
         generic argument list allowed in between - so `invoke(`, `loggedInvoke(` and \
         `loggedInvoke<Customer[]>(` are all in the denominator, while `loggedInvokeGeneric(` \
         is not and never was (an alias with a suffix of its own still escapes the anchor). \
         PRODUCTION non-test source: {prod_total} sites, {prod_literal} literal, \
         {prod_computed} built at runtime, and these offend: {offenders:?}. \
         TEST SCAFFOLDING: {test_total} sites, {test_literal} literal, {test_computed} \
         built at runtime - reported by callee above and deliberately NOT failed, because \
         a forwarder inside a test cannot reach the extractor this ban protects \
         (`scripts/verify-ipc-parity.py:91` skips these paths); see \
         `computed_name_is_an_offender`. A computed name in production source defeats \
         every allowlist in this file, because the name being checked is no longer the \
         name being called.",
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
///
/// Where the other half prints, since it does not print here: the invoke-surface census
/// (`INVOKE SURFACE, BOTH HALVES` / `PRODUCTION COMPUTED SITES`) is emitted by
/// `drift_pin_no_computed_command_names_in_ui`, not by this fn, and cargo captures a PASSING
/// test's stdout unless the run is `-- --nocapture` -- so a plain `cargo test ... registration_gate`
/// shows this census line and nothing else, which is exactly how a green printout came to be read
/// as an absent one on 2026-09-13.
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
/// `apps/desktop-tauri/src`, `apps/mobile-tauri/src`, `platform` and
/// `crates/kasirmu-bridge/src`, excluding `*_tests.rs` (helper and assertion names in a test file
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
        root.join("../mobile-tauri/src"),
        root.join("../../platform"),
        root.join("../../crates/kasirmu-bridge/src"),
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

/// The repaired eye can fail, and this is the case that proves it: a command name
/// assembled at runtime and handed to the wrapper must land in the offender list rather
/// than slip past because the call is spelled `loggedInvoke(`. Before the needle stopped
/// caring about the case of the leading i, this same fixture scored zero sites at all —
/// the pin did not see the call, so it could not have flagged it.
#[test]
fn pin_classifies_a_computed_name_built_behind_the_wrapper() {
    // The wrapper is real (`ui/src/utils/logged-invoke.ts:14`); the composing line is the
    // shape the ban exists for, fed in memory instead of added to ui/src.
    let computed =
        "export function load(kind: string) {\n  return loggedInvoke(`get_${kind}_scoped`);\n}\n";
    let (sites, literal, offenders) = classify_invoke_surface(computed, false);
    assert_eq!(sites, 1, "a wrapper call is one invoke-shaped site");
    assert_eq!(
        literal, 0,
        "a name assembled from a template is not a literal"
    );
    assert_eq!(
        offenders,
        vec![2],
        "and the composing line belongs in the list"
    );

    // Same call shape, literal name: counted and not flagged. This is what 35 of the
    // newly visible sites under `ui/src/api` look like today.
    let (sites, literal, offenders) =
        classify_invoke_surface("  return loggedInvoke('list_customers', args);\n", false);
    assert_eq!(
        (sites, literal),
        (1, 1),
        "the wrapper counts toward the surface"
    );
    assert!(
        offenders.is_empty(),
        "a literal name through the wrapper is not debt"
    );

    // Toleration semantics are unchanged: a tolerated file still yields the count and
    // suppresses only the offender.
    let (sites, _, offenders) = classify_invoke_surface(computed, true);
    assert_eq!(sites, 1, "toleration must not shrink the denominator");
    assert!(offenders.is_empty());

    // Toleration is a claim about a PATH, so it is tested as one. The four surviving
    // production computed sites live in two real files, and a fix that stopped tolerating
    // those is not a fix; the lookalike below is the case that shows the rule reads
    // components and not characters. Against the bare-suffix rule
    // ("mynested-dev-mock" ends with "dev-mock") the third assertion below fails and the
    // lookalike walks free with an exemption it was never given.
    for real in [
        "C:/checkout/apps/desktop-tauri/../../ui/src/utils/logged-invoke.ts",
        "C:/checkout/apps/desktop-tauri/../../ui/src/dev-mock/core/mockDispatcher.ts",
        "C:/checkout/apps/desktop-tauri/../../ui/src/dev-mock/tauri-api.ts",
        "C:/checkout/ui/src/__tests__/useSessionKeepalive.test.ts",
    ] {
        assert!(
            toleration_applies(real),
            "a file the list names must stay tolerated: {real}"
        );
    }
    assert!(
        !toleration_applies("C:/checkout/ui/src/mynested-dev-mock/tauri-api.ts"),
        "a directory whose name merely ENDS WITH a tolerated directory is not that directory"
    );
    assert!(
        !toleration_applies("C:/checkout/ui/src/features/not-logged-invoke.ts"),
        "and a file whose name merely ENDS WITH a tolerated file is not that file"
    );
    // Any depth, deliberately. Every swept path is under the sweep's own root, so depth
    // carries no information here; what must be unambiguous is the directory name and the
    // file name. This is a choice the assertion pins rather than an accident of ends_with.
    assert!(
        toleration_applies("C:/checkout/anywhere/at/all/utils/logged-invoke.ts"),
        "the entries name a file's trailing components, not its location: any depth is          tolerated, and that is the reading the code has to prove"
    );

    // Part four, the scoping rule as a case that can fail. The same computed name in a
    // production-shaped path offends; the same computed name under `__tests__` does not.
    let prod_path = "ui/src/features/sales/SalesScreen.tsx";
    let test_path = "ui/src/__tests__/api-customers-contract.test.ts";
    assert!(
        computed_name_is_an_offender(prod_path, false),
        "a computed name in production source must fail the pin"
    );
    assert!(
        !computed_name_is_an_offender(test_path, false),
        "the same site in test scaffolding must not fail the pin"
    );
    // And it must still be COUNTED, or the scoping rule is an allowlist with the reasons
    // left out: the identical fixture scores one site, zero literals, one computed line
    // whichever half it is filed under.
    let (t_sites, t_literal, t_computed) = classify_invoke_surface(computed, false);
    assert_eq!(
        (t_sites, t_literal, t_computed.as_slice()),
        (1, 0, &[2][..])
    );
    assert!(!computed_name_is_an_offender(test_path, false));
    // The callee is what the excluded population is reported by, so the reader sees the
    // shape: `loggedInvoke` for a production funnel, `mockInvoke` for a test double.
    let (_, callee, _, _) = &scan_invoke_sites(computed)[0];
    assert_eq!(callee, "loggedInvoke");

    // The bare form still scores, so this is a widening and not a replacement.
    let (sites, literal, _) = classify_invoke_surface("  return invoke('list_roles');\n", false);
    assert_eq!((sites, literal), (1, 1));
}

/// The second hole in the same eye: a type argument between the wrapper's name and its
/// paren. The needle used to require "(" hard against the letters invoke, so a generic
/// spelling -- which is how most of ui/src writes the wrapper -- was invisible to the ban
/// in both directions, neither counted as a site nor flagged as an offender. Same
/// technique as the test above: the shapes are fed in memory, not added to ui/src.
///
/// What this does NOT close, for the next reader rather than for comfort: an alias whose
/// extra letters sit between the word and the paren (a wrapper named loggedInvokeGeneric)
/// is still outside the surface, because the scan still anchors on the word immediately
/// before the bracket list or the paren. That is a separate widening, and the sentences
/// that used to claim it was covered now say what is covered.
#[test]
fn pin_counts_a_generic_spelled_wrapper_call() {
    // Part one, the case that must offend: a name built at runtime, handed to the wrapper
    // through a type argument. Against the old needle this scored zero sites, which is the
    // whole defect -- a ban that does not see the call cannot flag it.
    let computed = "export function load(kind: string) {\n  return loggedInvoke<Customer[]>(buildName(kind));\n}\n";
    let (sites, literal, offenders) = classify_invoke_surface(computed, false);
    assert_eq!(
        sites, 1,
        "a generic-spelled wrapper call is one invoke-shaped site"
    );
    assert_eq!(
        literal, 0,
        "a name assembled at runtime is still not a literal behind a type argument"
    );
    assert_eq!(
        offenders,
        vec![2],
        "and the composing line belongs in the offender list"
    );

    // Part two, the shape thousands of ordinary calls already have: a literal name behind
    // a type argument. Counted toward the surface, never flagged. The widening is allowed
    // to add numbers, not to turn existing traffic into debt.
    let (sites, literal, offenders) = classify_invoke_surface(
        "  return loggedInvoke<Customer[]>(\"sync_pull\", args);\n",
        false,
    );
    assert_eq!(
        (sites, literal),
        (1, 1),
        "the generic form counts toward the denominator"
    );
    assert!(
        offenders.is_empty(),
        "a literal name through a generic wrapper is not debt"
    );

    // Part three, the two shapes that make a naive bracket scan wrong. Angle brackets
    // nest, so List<Map<K, V>> closes on its second bracket; and "=>" is an arrow, not a
    // close, so a function-type argument must not cut the scan short.
    let (nested, nested_lit, nested_off) = classify_invoke_surface(
        "  return loggedInvoke<List<Map<string, number>>>(names);\n",
        false,
    );
    assert_eq!(
        (nested, nested_lit, nested_off.as_slice()),
        (1, 0, &[1][..]),
        "a nested bracket list is still one computed site, and still one offender"
    );
    let (arrow, arrow_lit, _) =
        classify_invoke_surface("  return loggedInvoke<(c: number) => void>(cb);\n", false);
    assert_eq!(
        (arrow, arrow_lit),
        (1, 0),
        "an arrow inside the type argument is not the end of the list"
    );

    // Part four, the cost side of the widening: the bare word must not become a call site,
    // or the denominator turns into a keyword count. An unmatched bracket list and a word
    // that merely starts with the letters invoke both stay out.
    let (unclosed, _, _) =
        classify_invoke_surface("  const broken = loggedInvoke<Customer[];\n", false);
    assert_eq!(
        unclosed, 0,
        "a bracket list that never closes is not a call"
    );
    let (bare, _, _) = classify_invoke_surface("  const invokeCount = 3;\n", false);
    assert_eq!(
        bare, 0,
        "the letters invoke inside a plain identifier are not a call"
    );

    // Part five, the shape that folding in the generic calls turned up, and the reason the
    // pin went red: a call whose first argument sits on the NEXT line. The scan reads a
    // line at a time, so the byte after the open paren is the end of the line, "no byte"
    // fell through to not-a-quote, and a literal name was scored as one built at runtime.
    // A wrapped literal is a literal.
    let (wrapped, wrapped_lit, wrapped_off) = classify_invoke_surface(
        "  return loggedInvoke<Customer[]>(\n    \"sync_pull\",\n    args,\n  );\n",
        false,
    );
    assert_eq!(
        (wrapped, wrapped_lit, wrapped_off.as_slice()),
        (1, 1, &[][..]),
        "a command name written on the line after the paren is still a literal"
    );

    // Part six, the tolerance part five reaches across, held shut. ui/src/api/staff.ts:3 is
    // a header comment whose prose says "every call through loggedInvoke (no direct
    // invoke)": a space where a bracket list would be, so it is not a call, and looking
    // past a newline for an argument must not make it one either. Guarded rather than
    // trusted, because the comment skip never sees that line (it starts with "findings:",
    // not "*"), so the only thing keeping it out of the surface is the needle.
    let (prose, prose_lit, prose_off) = classify_invoke_surface(
        "/*\nfindings: clean IPC contract -- every call through loggedInvoke (no direct invoke)\n*/\n",
        false,
    );
    assert_eq!(
        (prose, prose_lit, prose_off.len()),
        (0, 0, 0),
        "a call mentioned in prose is not a call site"
    );

    // And the previously caught forms still score, so this is additive in the same
    // direction as the case-insensitivity widening, not a replacement for it.
    let (before_plain, before_lit, _) =
        classify_invoke_surface("  return loggedInvoke('list_customers', args);\n", false);
    assert_eq!(
        (before_plain, before_lit),
        (1, 1),
        "the unbracketed form still scores"
    );
    let (bare_call, bare_lit, _) =
        classify_invoke_surface("  return invoke('list_roles');\n", false);
    assert_eq!(
        (bare_call, bare_lit),
        (1, 1),
        "the raw tauri form still scores"
    );
    let (_, callee, _, _) = &scan_invoke_sites(computed)[0];
    assert_eq!(
        callee, "loggedInvoke",
        "the callee is still the identifier actually called"
    );
}

/// Risk one, the comment that swallows the argument. `first_arg` may read below its own
/// paren on purpose (a wrapped literal is a literal, part five of the case above), but the
/// look-ahead skips only BLANK lines -- so the first non-blank line wins whether or not it
/// is code. A comment between the paren and the argument therefore BECOMES the argument:
/// the token read is `//`, `//` is not a quote, and a literal command name is scored as one
/// built at runtime. The direction matters for whoever reads the red: a misread literal can
/// only add an offender, never hide one, so this fails LOUD as a false positive rather than
/// quietly passing a real violation -- which is also why it can be fixed without changing a
/// verdict on today's tree (measured 2026-09-13 11:12: zero such shape exists in ui/src, and
/// all four listed computed sites name a real token: `cmd`, `cmd:`, `cmd`, `cmd:`).
#[test]
fn pin_a_comment_between_the_paren_and_the_argument_is_not_the_argument() {
    // The exact shape from the brief: open paren, a comment line, then the string literal.
    let (sites, literal, offenders) = classify_invoke_surface(
        "  return loggedInvoke(\n    // the name the parity extractor reads\n    \"sync_pull\",\n    args,\n  );\n",
        false,
    );
    assert_eq!(sites, 1, "one invoke-shaped call site");
    assert_eq!(
        literal, 1,
        "a comment line is not an argument: the literal two lines down is the first thing          this call is handed, so the site is a literal and NOT debt"
    );
    assert!(
        offenders.is_empty(),
        "and it must not reach the offender list -- this is the false positive the          three-line bound used to manufacture"
    );

    // The brief named a two-line comment block; two lines is the last shape the bound can
    // still reach, so it is pinned first -- and it is a literal, which is the repair.
    let (t2, t2lit, t2off) = classify_invoke_surface(
        "  return loggedInvoke(\n    // one\n    // two\n    \"sync_pull\",\n  );\n",
        false,
    );
    assert_eq!(
        (t2, t2lit, t2off.len()),
        (1, 1, 0),
        "two comment lines are crossed: the literal on the third line below the call is still the argument"
    );

    // A three-line JSDoc block puts the name on the FOURTH line below the call, which is
    // outside the look-ahead the brief told me to keep as a backstop. So the honest verdict
    // is computed -- and the reason matters. It is NOT the comment being read as the
    // argument (the hazard); the scan finds nothing inside its window and falls back to the
    // sentinel. Asserting the token distinguishes those two, and only the first is a bug.
    let wide = scan_invoke_sites(
        "  return loggedInvoke(\n    /**\n     * documented elsewhere\n     */\n    \"sync_pull\",\n  );\n",
    );
    assert_eq!(wide.len(), 1, "one invoke-shaped call site");
    assert!(
        !wide[0].2,
        "past the bound the site is scored computed, which is the bound doing its job"
    );
    assert_eq!(
        wide[0].3, "",
        "the argument token must be EMPTY (nothing reached), not the comment text -- a \"*\" or
         \"/*\" here would mean the prose was read as the name, which is the defect this fix
         removes and the shape that must never come back"
    );

    // A block comment that opens and closes on the call's own line is pure prose inline
    // before the argument, and the window was never the obstacle: same line, literal read.

    let (ssites, sliterals, soffenders) = classify_invoke_surface(
        "  return loggedInvoke(/* note */ \"sync_pull\", args);\n",
        false,
    );
    assert_eq!(
        (ssites, sliterals, soffenders.len()),
        (1, 1, 0),
        "a comment closing on the call's own line must not become the argument"
    );

    // The bound is a backstop, not a target: an argument parked past the look-ahead stays
    // computed, so a comment skip cannot turn the scan into an unbounded read into somebody
    // else's function. And a genuinely computed name is still computed.
    let (fsites, fliterals, foffenders) = classify_invoke_surface(
        "  return loggedInvoke(\n    // one\n    // two\n    // three\n    // four\n    \"sync_pull\",\n  );\n",
        false,
    );
    assert_eq!(
        (fsites, fliterals, foffenders.len()),
        (1, 0, 1),
        "past the look-ahead the argument is nobody's business and stays computed"
    );
    let (_, cliteral, coffenders) =
        classify_invoke_surface("  return loggedInvoke(cmdName);\n", false);
    assert_eq!(
        (cliteral, coffenders.as_slice()),
        (0, &[1][..]),
        "a real computed name is still caught by the ban"
    );
}

/// Risk two, the predicate that did not know where it was. `computed_name_is_an_offender`
/// decided "is this a UI offender" from the path's trailing shape alone and never asked
/// whether the path was inside the sweep root at all; the only thing holding that invariant
/// was the single caller's fixed root at the top of the pin. That is fine until a second
/// sweep appears over a different directory, at which point the same function starts
/// rendering UI verdicts about non-UI files, and the failure is invisible because the
/// verdict looks plausible.
///
/// The wall is the ROOT, not the depth: `toleration_applies` keeps its any-depth
/// trailing-component rule (c5292bae8, and pinned at the case above), because inside
/// `ui/src` depth carries no information. What must stop being root-blind is the offender
/// decision, so the root is re-derived INSIDE the predicate from `CARGO_MANIFEST_DIR` and
/// cannot be talked into believing a caller.
#[test]
fn pin_the_offender_predicate_refuses_a_path_outside_the_sweep_root() {
    // A dev-mock lookalike under a DIFFERENT root. It has no __tests__ component, so the
    // old predicate read it as production UI and called it an offender -- a UI verdict
    // about a file no UI sweep ever touched.
    let foreign_lookalike = "/tmp/not-this-checkout/ui/src/dev-mock/tauri-api.ts";
    assert!(
        !computed_name_is_an_offender(foreign_lookalike, false),
        "a path outside the sweep root is not UI source, so it cannot be a UI offender: {foreign_lookalike}"
    );
    // Same shape for a path that is not even trying to look like UI code.
    assert!(
        !computed_name_is_an_offender("/tmp/some/rust/crate/src/commands/sync.rs", false),
        "a Rust file must never produce a UI verdict"
    );
    // The wall must not become "always false": a production path inside the root still
    // offends, as both an absolute path from the real sweep and as the root-relative form
    // the sibling case above already uses.
    let inside = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui/src/features/customers/CustomerScreen.tsx")
        .display()
        .to_string()
        .replace(std::path::MAIN_SEPARATOR, "/");
    assert!(
        computed_name_is_an_offender(&inside, false),
        "a computed name under the real sweep root must still offend: {inside}"
    );
    assert!(
        computed_name_is_an_offender("ui/src/features/sales/SalesScreen.tsx", false),
        "and the root-relative spelling still offends"
    );
    assert!(
        !computed_name_is_an_offender("ui/src/__tests__/api-customers-contract.test.ts", false),
        "test scaffolding inside the root is still scaffolded, not offending"
    );
}

/// Phase 3.2 closed on a recorded decision — Option A — that keeps the
/// `tauri::generate_handler!` table in `lib.rs`, because this ratchet, the parity
/// checker and the scoped-coverage gate all parse that macro verbatim. What that
/// ruling did NOT come with was a gate for the other half of "thin shell": that
/// the file names handlers and never defines one. The claim held at close by
/// inspection alone, and `todo-refactor-oz-pos-app-agents-3.md`'s
/// "Headline metric restated" section measured in passing that no tool in the
/// repo checks it — which is how a shell quietly becomes the thing the
/// relocation campaign spent five waves emptying.
///
/// Both assertions are anchored to the start of a line, deliberately: the
/// unanchored pattern matches three prose occurrences in `lib.rs`'s own module
/// doc (`:10`, `:15`, `:25`), and a lint whose first output is "the
/// documentation is a defect" gets an `#[allow]` within a week and then checks
/// nothing.
#[test]
fn drift_pin_the_shell_router_registers_commands_and_defines_none() {
    let defined: Vec<&str> = LIB_RS
        .lines()
        .map(str::trim_start)
        .filter(|line| line.starts_with("#[tauri::command]") || line.starts_with("#[command]"))
        .collect();
    assert!(
        defined.is_empty(),
        "apps/desktop-tauri/src/lib.rs defines {} command(s) of its own: {defined:?} — after Wave E every handler body lives in kasirmu-bridge and the shell only lists paths; a command defined here is invisible to the parity checker's handler-list parse and to the bridge tests alike",
        defined.len()
    );

    // The file's remaining executable content is the builder. One function is
    // the measured truth at this HEAD; a second one is the shape a slow
    // re-thickening takes, so the assertion names what it found rather than
    // counting.
    let fns: Vec<String> = LIB_RS
        .lines()
        .filter(|line| {
            let t = line.trim_start();
            t.starts_with("fn ")
                || t.starts_with("pub fn ")
                || t.starts_with("async fn ")
                || t.starts_with("pub async fn ")
                || t.starts_with("pub(crate) fn ")
        })
        .map(|line| line.trim()[..line.trim().find('(').unwrap_or(line.trim().len())].to_string())
        .collect();
    assert_eq!(
        fns,
        vec!["pub fn run".to_string()],
        "lib.rs is a router: its only function must be the Tauri builder `run`, found {fns:?}"
    );

    // Positive control, so the empty count above is a measurement and not a
    // filter that matches nothing anywhere: the same anchored scan over the
    // shell's own command directory finds a large population. The floor sits
    // with headroom below the 23 sites measured at 2026-09-15, so a command
    // module losing a few handlers does not fire this, while a predicate that
    // stopped matching — an attribute spelled on one line differently, the
    // `use tauri::command` alias dropped — does.
    let defined_elsewhere: usize = include_str!("../commands/settings.rs")
        .lines()
        .map(str::trim_start)
        .filter(|line| line.starts_with("#[tauri::command]") || line.starts_with("#[command]"))
        .count();
    assert!(
        defined_elsewhere > 10,
        "the positive control found only {defined_elsewhere} command definitions in commands/settings.rs, so this test's filter has stopped matching anything and its verdict about lib.rs proves nothing"
    );
}
