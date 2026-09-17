# tablet registration gate — the one red row is not theirs, and the fix is ten lines

Handed over 2026-09-13 ~06:15 by a delegated auditor who was told to finish the desktop half
and revert the tablet half. Nothing here is committed and nothing here was committed: no git
command was run after 06:0x on your crate, so every anchor below is a file hash, not a sha,
and every claim carries the command that produced it. Reproduce any of them before acting.

## 1. what to insert, and where

Anchor: the existing `dev-mock/tauri-api.ts` entry in the `allowed` array of
`apps/mobile-tauri/src/commands/registration_gate_tests.rs`, at **:831**, inside
`let allowed = [` opened at `:830`. Insert these ten lines immediately after it, so the new
path sits in the dev-mock cluster and the `__tests__/dev-mock-scoped-aliases.test.ts` entry
stays where it is. One row per array, named exactly. No directory glob — see §4.

```
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
```

These are the lines I had inserted and then removed by reversal of my own block, not a
proposal written after the fact: `grep -c "dev-mock/core/mockDispatcher.ts"
apps/mobile-tauri/src/commands/registration_gate_tests.rs` returned 1 while patched and
returns 0 now.

## 2. the measurement that makes them safe

`cargo test -p oz-pos-tablet registration` on your current bytes prints, verbatim:

> PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: 100 of 103 invoke() sites in ui/src name the
> command as a literal and these 1 build it at runtime:
> [.../ui/src/dev-mock/core/mockDispatcher.ts:108]

one offender out of 103, not fifty. And it is a forwarder of its own parameter, read at
HEAD-independent disk state, `sed -n "94,121p" ui/src/dev-mock/core/mockDispatcher.ts`:

- `:98`  `export async function invoke<T>(`
- `:99`  `cmd: string,`
- `:108` `}).__TAURI_INTERNALS__.invoke(cmd, args ?? {}, options);`
- `:116` `const handler = handlers[cmd];`

it composes no name, which is the class your own harness already tolerates in words at
`:827-:831` — "a mock forwarding a variable it was handed ... Neither is a screen calling a
command" — and already tolerates in `dev-mock/tauri-api.ts` one line above the insertion
point. so this entry adds a case to a class the file defines, it does not weaken the ban.

## 3. two measurements to run yourself, not to trust from me

- `cargo test -p oz-pos-tablet registration` — on your current bytes this is **exit 101,
  `6 passed; 1 failed`**, the failure being
  `drift_pin_no_computed_command_names_in_ui` (query: run it, then
  `grep "test result" <log>`). I measured that at ~06:12 on the restored file, so the red is
  yours to see and predates anything I did. **After** the ten lines I expect `7 passed;
  0 failed` — labelled as a prediction, not a measurement: the identical change moved the
  same pin from red to green on desktop, where it was measured
  (`cargo test -p kasirmu-app registration` → `running 8 tests`, `8 passed; 0 failed`, exit 0),
  but I never ran your crate while patched, because I reverted to your bytes first.
- `cargo check -p oz-pos-tablet --tests` — must be exit 0 with **zero warnings**, because
  `.github/workflows/dev-ci.yml:10` sets `RUSTFLAGS: -D warnings` and the `cargo-check` job
  at `:200` runs `--all-targets`, so a doc warning in a comment you add is a red build
  rather than a cosmetic thing. `grep -c "^warning" <log>` → 0.
- ordering note from my own runs tonight: cargo skips a rebuild when a restore preserves the
  source mtime, so `Copy-Item` back can silently re-test a stale binary. Count the
  `Compiling oz-pos-tablet` line in the log before believing any pass or fail.

## 4. provenance, the three things that keep this honest

1. **i did not touch your file after reverting.**
   `wc -l -c apps/mobile-tauri/src/commands/registration_gate_tests.rs` → 923 lines,
   36,640 bytes; `md5sum` → `9d8fbdd778d528eeebac43418e1feeca`, the same hash it carried
   before i touched it, and `grep -c "dev-mock/core/mockDispatcher.ts"` → 0. the revert was
   done by writing bytes (reversal of my own inserted block), never by `git checkout` or
   `git show`, because a broken compile is shared instantly and three sessions were left with
   mutated files that way tonight.
2. **your pins are calibrated against `3a15dafe8`**, the scoped-history-twins fix, and i have
   no brief history for that crate — i read its ledger and its harness as a stranger and
   verified 318 registered / 193 gated / 125 debt, 190 of 193 gated on a hard in-module
   marker, 7 of 7 passing inside a 640 of 640 unfiltered run. so treat §2 as evidence about
   one offender and not as authority over your thresholds.
3. **the entry tolerates a forwarder and does not bless `handlers[cmd]` at `:116`.** a name
   resolved out of a registry is still a computed name; if the pin ever points at `:116`
   itself, that row belongs in the offender list and this entry does not cover it. and the
   glob was rejected on purpose: `dev-mock/` as a prefix, or any looser suffix, would
   silently swallow the roughly fifty parked unscoped mock rows that are your backlog, which
   is the cover-up shape the surrounding comments already refuse. one row, exact path,
   named thing.

## 5. what this file is

untracked, written by the auditor who finished the desktop half
(`apps/desktop-tauri/src/commands/registration_gate_tests.rs`, 1,129 lines, 46,966 bytes,
`md5sum` → `8232cb0e8674bb5dcab95042c17e9bf2`, desktop filter green at 8 of 8 with this same
allowed-path change applied there) and reverted this one. no commit was made anywhere by me in
your crate, and no source file under apps, crates, platform or ui was edited by me for this
handoff beyond the two named above.

One addendum from the clippy sweep on 2026-09-13: the `clippy::collapsible_if` row at
`apps/desktop-tauri/src/commands/registration_gate_tests.rs:264` was cleared in the desktop copy by
`143497c916` (`style(desktop-tauri)`), and `apps/mobile-tauri/src/commands/registration_gate_tests.rs`
carries the identical lint at the identical line and column — `:264`, the same nested
`if want.contains(&name) { if let Some((sig, body)) = grab(&chars, j) {` — because this harness was
copied across the two shells, so one line would clean both files at once; it was **not** touched, the
tablet copy is not this lane's fence.

## 6. the measurement that turned the reading into a fact (2026-09-13, 09:13 +07)

appended 09:16 +07. nothing above is retracted; §2 and §3 are now reproduced rather than predicted.
- `cargo test -p oz-pos-tablet registration_gate` → exit 101, `running 7 tests`, `6 passed; 1
  failed`, `finished in 0.16s` on a warm target (cargo printed `Finished ... in 0.74s`, the whole
  invocation 1.4s wall, 09:13:04 +07; the earlier 09:07 +07 run read 1.04s warm — same verdict).
- the failure is `drift_pin_no_computed_command_names_in_ui`, panicking at
  `apps/mobile-tauri/src/commands/registration_gate_tests.rs:871`: `PIN OF A KNOWN HAZARD, NOT AN
  ENDORSEMENT: 100 of 103 invoke() sites in ui/src name the command as a literal and these 1 build
  it at runtime`, and the named site is `ui/src/dev-mock/core/mockDispatcher.ts:108`. one offender,
  exactly the one §2 describes; §3's `7 passed; 0 failed` after the row stays a prediction.
- the desktop control, same minute: `cargo test -p kasirmu-app registration_gate` → exit 101, 8
  tests, 6 passed; 2 failed — and its `drift_pin_no_computed_command_names_in_ui` is `ok`. it
  passes that leg because its allowlist at `:883-904` carries a `dev-mock/core/mockDispatcher.ts`
  row at `:894` while the tablet list at `:830-841` carries none (both arrays read 09:14 +07).
- authorship: `ce8666604` at 05:46:39 landed the dispatcher (6 files). the desktop twin was amended
  for it in `2355932310` at 06:15:34, subject "pin the guard vocabulary, allow mock forwarder". the
  tablet twin was last touched at `3c793f8e34` 04:54:07 — 52 minutes before the thing it would need
  to tolerate existed.
- the desktop's two remaining failures are a different cause and belong to another lane:
  `drift_pin_debt_ceilings_only_shrink` panicking at `:666` with 70 against a ceiling of 69, and
  `drift_pin_three_way_partition_is_complete_and_sums` at `:603` naming
  `sync::list_sync_conflicts_scoped` as new debt absent from the ledger. both trace to `028056eaa`
  at 06:43:58, written up in `.agents/naked-read-sync-conflicts.md`.
