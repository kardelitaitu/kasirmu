# The restore request the last write wins — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 143 · status: 1 real defect
     fixed, found by applying round 142's test-file gap search · branch: 0.0.41 ·
     commit: `824f92644` -->

<!- - Scope: settings / data management, per the active goal. Opened by enumerating which
     feature screens have no test file at all — the gap that took a clobber to notice in
     round 142. -->

## Finding it

Round 142 ended by noting that `MemosScreen` had no test file and that finding it "took a
clobber". So this round started with the enumeration that should have come first: 313
non-test `.tsx` files under `ui/src/features`, 805 test files, 151 screens with no matching
test. Most are presentational leaves or `register.tsx` registries, which is fine.

One stood out: **`settings/hooks/useRestore.ts` had no test**, and it is the one hook in the
tree whose single write **replaces the database on the next boot**. Its own module doc says
so:

> `restore_prepare` requires the operator to TYPE the store name that the CANDIDATE carries
> ... So this hook must never pre-fill, suggest, or display that name.

Two rules the file documents were honoured: nothing promises an immediate restore (the copy
says "the next time kasir.mu starts"), and `confirmName` is cleared on every open and close
(`startConfirm`/`cancelConfirm`, :165-172) rather than seeded. I checked both against the code
because a comment claiming a rule is not the rule.

The third thing was not guarded. `submit` (:180) has **no re-entry check** — `submitting`
drives the button's `loading` prop, and React commits that on its next render, after the
second dispatch of a real double tap.

## Why this one is not "just a duplicate row"

Every previous instance of this class was either refused by a unique index (suppliers,
purchase orders) or stored a duplicate (customers, cash payouts, memos) or moved stock twice
(transfers). This one is structurally different:

```rust
// crates/kasirmu-bridge/src/data/restore.rs:256
std::fs::write(&request_path, bytes)...
```

The write is **unconditional and to a fixed path** (`<db>.restore-request.json`), so the
second submit does not append a second request — it **REPLACES** the first. **The last write
wins.** That pending file is what the boot path consumes before opening the database, so the
consequence is that a double submit commits a specific generation to be restored, and the
losing write is simply gone. An operator who taps Request restore twice, or who picks a
different generation while the first request is in flight, silently changes **which
generation gets restored**, and the UI shows a single pending banner either way — there is no
duplicate to notice, no error, and no record that the other choice was ever made.

That is worse than the stock-transfer case in a different dimension: the transfer moves too
much stock, which a count will eventually catch. A replaced restore request is a
**one-way door with no evidence it was taken**, executed on the next boot.

## The fix

A `submitPendingRef` guard, released on both exits (the success path and the catch). A ref,
not the state, for the reason every previous round established: only the ref is authoritative
at the moment the second submit runs.

## Evidence

- **Red -> green:** `expected 2 to be 1` before the guard; 1/1 after.
- **Kill-test:** `if (submitPendingRef.current) return;` removed -> red; restored and
  confirmed **byte-identical** against a backup.
- **No regression to the screen:** `DataManagementScreen.test.tsx` (10 cases) still passes,
  and it exercises the restore tab through the real component.
- **`git cat-file -e HEAD:ui/src/__tests__/useRestore.test.tsx` -> NOT-IN-HEAD** before
  writing. Round 142's error was overwriting a real file with `writeFile` on the strength of
  searches that returned empty for unrelated reasons. This round ran the one command that
  answers the question directly, and the commit shows `create mode`, not a rewrite.
- **Three self-caught errors during the round, all before commit:** a stray `)` in an import;
  JSX in a `.ts` file (renamed to `.tsx`); and a fixture that did not match
  `RestoreCandidate` — `npm run typecheck` caught the last one by naming the missing
  `build_schema` field, which is exactly what the gate is for.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS.
- **Full suite:** 812 passed | 2 failed files of 814; **12,924 passed** (up 1). The 2
  failures are the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Carried forward

The enumeration is now the tool, not the clobber: 151 screens lack a test file, and the
filter that made this round productive was **"which of these performs a write?"** rather than
"which is missing a test?" — a presentational leaf with no test is a non-finding, while an
untested write on a one-way path is the highest-value target in the tree.

The unexamined writes from that list, in rough order of consequence:
`settings/components/ImportSection.tsx` and `RestoreSection.tsx`'s sibling
`BackupSection` paths, `warehouse/WarehouseCountFlow.tsx` (stock), and
`staff/components/StaffDetailDrawer.tsx`. Each needs the same two questions answered before
any test is written: does the handler guard itself, and does the backend refuse or replace?

> last audited 18-10-26 by docs-auditor
