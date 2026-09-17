# Registration-gate audit findings — tablet and desktop harnesses

Anchor: HEAD **`c85bae9ef`** (branch `0.0.37`). Tablet sections were measured earlier on
`48540aee0` / `cba6bf138`; the tablet harness blob is md5-stable across those
(`9d8fbdd778d528eeebac43418e1feeca`). Every desktop number below is from `c85bae9ef`,
re-anchored at the end of the run.

**Method, and the fact that licenses everything below:** every count is a reimplementation
of the harness own predicate over a `git archive HEAD` extract of
`apps/{desktop,tablet}-client/src/commands`, `lib.rs` and `crates/oz-bridge/src` — not a
restatement of what the harness prints. It is validated by reproducing the harness own
figures independently: desktop **447 registered / 69 debt rows / 43 no-session + 26
resolves-but-no-permission**, tablet **318 registered / 193 gated / 125 debt / 0
bodyless**. Had the reimplementation disagreed on those, the splits below would be
meaningless. [Fact]

## 1. Tablet ratchet — SOUND

- `cargo test -p kasirmu-tablet registration` -> exit 0, `running 7 tests`, 7 passed. [Fact]
- `cargo test -p kasirmu-tablet` **unfiltered** -> exit 0, `running 640 tests`,
  `640 passed; 0 failed; 0 ignored`, 87.16s, all seven ratchet names `... ok` inside the
  full run. The filter is how it is invoked locally; the full run is how `dev-ci.yml:253`
  (`cargo nextest run --workspace --all-features`) invokes it. No name collision, no
  fixture interference, no ordering dependence. [Fact]
- `cargo check -p kasirmu-tablet --tests` -> exit 0, zero warning lines. [Fact]
- Classification: of 193 gated, **190** rest on a hard permission marker
  (`require_permission`, `permissions::`, `has_permission`, `authorize_with`) inside the
  entry function own brace-matched body in the file whose stem equals the registered
  module; **0** of the 191 marker bodies have all occurrences inside comments; **0** are
  credited from a foreign same-named fn; **0** needed the bridge-stem merge. [Fact]
- Ceiling honesty: `DEBT_CEILING` moved 126 -> **125** and equals the row count exactly
  (44 single-line + 81 rustfmt-wrapped rows = 125; 125 unique `mod::fn` tokens; buckets
  47 + 78 = 125; `UNSOURCED = 0`). With `BY_DESIGN_UNGATED` empty, `ungated <= 125`
  passes at exactly the measurement, zero slack. But the ceiling is `<=`, so it cannot
  catch a shrink. What catches a shrink is `paid_stale` in
  `drift_pin_three_way_partition_is_complete_and_sums`: a name still on the ledger that
  the sweep no longer calls ungated fails the run, forcing regeneration, which rewrites
  the ceiling. **The number named after the ratchet is not the part that ratchets.** [Fact]
- Corroboration: `3a15dafe8` put `permissions::REPORTS_EXPORT` at `history.rs:380/404/428`,
  and the ledger carries only the five *unscoped* history commands (`:167-171`);
  `grep -c export_daily_summary_scoped` -> 0 in ledger and harness alike. Had it still
  listed them, `paid_stale` would be red now. It is green, so the ledger postdates the
  commit. [Fact]

## 2. Two ways left to lie to it

1. **`assert_eq!(REGISTERED_FLOOR, debt::REGISTERED_TOTAL)`** at tablet
   `registration_gate_tests.rs:474-477` — hand-kept constant against generated constant,
   satisfied whichever way the tree parses, so it catches nothing alone. The file does
   **not** flag this anywhere. [Fact]
2. **`by_design_entries_carry_four_measured_fields`** (`:645`) — all eight asserts
   (`:662, 684, 692, 698, 708, 714, 720, 726`) sit inside
   `for e in BY_DESIGN_UNGATED {` (`:654`, closes `:734`) and
   `BY_DESIGN_UNGATED: &[ByDesignEntry] = &[]` (`:459`). It passes by iterating nothing.
   Two differences from (1): the file **declares** it at `:641-643` ("Vacuous while the
   list is empty, and it becomes the thing that refuses the first careless entry"), and
   the test is not wholly inert — `denied_setting_names()` runs at `:653` before the loop
   and carries its own non-vacuous `assert!(out.len() >= 15)` against
   `platform/core/src/settings/keys.rs`. A gap you name is a decision; a gap you do not
   is a liability. [Fact]

## 3. Three false gates on tablet, one mechanism

`hardware.rs`, all three classified Gated, none carrying a permission check in its body:

| name | declared | what the rule matched |
|---|---|---|
| `print_receipt_scoped` | `hardware.rs:407` | `app.emit("receipt:printed", ...)` at `:423` |
| `print_sales_receipt_scoped` | `:431` | same `receipt:printed` literal |
| `start_scanner_scoped` | `:573` | `"barcode:error"` label near `:578` |

All three also satisfy `resolves_session` (`resolve_session` / `resolve_scope` at `:412`,
`:445`, `:578`), so the `&&` completes on an **event or error string**. The culprit is
`names_permission` fallback leg: a quoted literal with a colon between two runs of
`[a-z_:]` counts as a `domain:action` permission. In a file that emits events, that
matches the event names. [Fact]

Direction: all three are absent from the tablet debt ledger (`grep -c <name>` -> 0 each)
and absent from `BY_DESIGN_UNGATED` (empty). They are not dangling entries — **they sit in
the gated bucket for a false reason**, which is why debt reads 125 where the
classification arbiter implies a floor of 128. Whether their home is debt or by-design is
a policy call about device metadata, not readable off source. [Fact] for the bucket,
[Inference] that 128 is where they would land.

## 4. Desktop — the bridge-stem population, quantified

At `c85bae9ef`: `REGISTERED_FLOOR 447`, `REGISTERED_TOTAL 447`, `DEBT_CEILING 69`,
`NO_SESSION_RESOLUTION 43`, `RESOLVES_SESSION_NAMES_NO_PERMISSION 26`, `UNSOURCED 0`,
69 ledger rows. My parse: 447 registered, 447 unique, 0 bodyless; ungated split
**43 / 26**, matching the harness exactly. Gated = 378. [Fact]

| the gate credit rests on | count | share of 378 |
|---|---|---|
| hard marker in the entry own body | **9** | 2.4% |
| foreign same-named body | 0 | — |
| `domain:action` literal | 0 | — |
| hard marker AND stem merge | 0 | — |
| **bridge-stem merge only** | **369** | **97.6%** |

**Exposed population: 369 of 378.** On desktop the file-level stem merge is not
hypothetical, it is the rule. 68 of 118 bridge files qualify as naming a permission,
and qualification is `names_permission(read(whole file))` — any token anywhere in the
file, in any function, including a doc comment. [Fact: `gated_bridge_stems()`]

Splitting the 369 by whether the *specific* forwarded `oz_bridge::mod::fn` carries a
marker in its own body (depth-1 only): **301 do, 68 do not**. Ten of the 68 sampled from
the biggest stems, hand-read at HEAD:

- **7 of 10 have no permission token anywhere in the forwarded bridge function**:
  `auth::destroy_session` (`bridge auth.rs:953`), `auth::session_keepalive` (`:999`),
  `auth::verify_pin` (`:679`, calls `resolve_session` + `record_login_attempt_scoped`),
  `auth::refresh_picker_ticket` (`:739`), `auth::switch_organization` (`:1061`, 135 lines,
  calls `check_tenant_integrity`), `edc::edc_terminal_status_scoped` (`edc.rs:188`, 7
  lines), `features::list_all_features_scoped` (`features.rs:625`, calls `resolve_scope`).
  The `auth` stem qualifies on **exactly one line in the whole file** — `auth.rs:1234`,
  `ctx.require_session_permission(&operator, oz_core::permissions::OPERATOR_IMPERSONATE)`
  — inside one impersonation command. That is the failing example: one unrelated check at
  `auth.rs:1234` credits every `auth::*` command whose body mentions `oz_bridge::`. [Fact, depth-1]
- **3 of 10 are genuinely checked but invisible to the marker vocabulary**:
  `inventory_counts::create_stock_count_scoped` (`inventory_counts.rs:324`),
  `get_count_lines_scoped` (`:385`), `add_count_line_scoped` (`:412`) each call
  `require_inventory_count_permission` on their own path. The stem merge is *right* about
  them and *cannot see why*: `require_inventory_count_permission` matches none of
  `require_permission` / `permissions::` / `has_permission` / `authorize_with`. [Fact]

The working example, by contrast: `inventory_counts` as a stem is honest for every command
sampled, because the module routes all of them through one bespoke guard — the rule just
does not know the guard name. [Fact] that the guard is called in all three; [Inference]
that it holds for the whole stem.

**Named mechanism with the worst ratio, not averaged:** the bridge-stem merge
(`text.contains("oz_bridge::") && stems.contains(&module)`), which decides 369 of 378
desktop gates on a whole-file token match. Its counterpart on tablet decides **0 of 193**.
The cleanest reading of the pair is that the real defect sits upstream of the merge: the
four-token marker vocabulary is too narrow to see bespoke `require_*_permission` helpers,
so nearly every desktop command falls through to a rule coarser than the check it is
supposed to replace. Sampled 10 of 68 suspects: 7 with no marker at depth 1, 3 honest for
an unrecognised reason. **No false gate is claimed at population scale** — 68 is a suspect
bucket, not a verdict, and depth-2 callees were not traced. [Inference] for the upstream
diagnosis; [Fact] for every count.

## Off-by-one settled

There is **no regex gap and no tree defect**. `a32b13aaa 05:08
refactor(desktop-tauri): drop the ungated rotate_encryption_key command` removed one
entry from `lib.rs` and set both `REGISTERED_FLOOR` and `REGISTERED_TOTAL` to **447**. My
earlier `448` was a blob read from before 05:08. Parse says 447, the constant says 447,
`sort -u` says 447 unique, `uniq -d` says zero duplicates. The discrepancy was mine and my
briefer, not the tree — the two-hour citation problem biting the measurement that
documented it. Debt likewise moved 70 -> 69 in that commit; the chat report earlier in this
session said 70 and 447-with-70-debt. **The file wins.**

## What this file is

Not a commit. `git add` was not run on it, and nothing under `apps/`, `crates/` or `ui/`
was touched by this audit. The hardware trio, the `REGISTERED_TOTAL` equality leg, the
empty-`BY_DESIGN` loop and the desktop stem merge are **reports to the owner, not fixes**.
Scratch lives only outside the repo: `%TEMP%/tabverif`, `%TEMP%/dsk3` (`git archive HEAD`
extracts plus classifier scripts), and one unfiltered `cargo test -p kasirmu-tablet` run
whose only repo-visible effect is `target/` artifacts on a directory five sessions share.
