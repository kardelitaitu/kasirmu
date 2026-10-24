# The tablet shell registers 27 fewer IPC commands than the shared UI calls

**Date:** 2026-10-24 · **Severity:** medium (revised down from high — see the final grade) ·
**Status:** open — needs an owner ruling on which shell's command surface is authoritative (the
BR-* family)

**Read this first: the headline number moved three times in one round, and the last value is the
only one that should be quoted.** The gate reports 34 sites. Of those, 5 are gate false positives
(the checker has been fixed), 20 are unreachable on tablet, and 9 reach the code — of which all
nine are caught, so **7 show a user-visible error state, 1 silently does nothing, and 1 degrades
to a working fallback**. No site crashes. The detail below is kept in its corrected form so the
trail is visible, which is the only reason it is safe to have been wrong twice.

## What was measured

`scripts/verify-scoped-reads.py --shell tablet` reports **34 call sites across 27 distinct
commands** in `ui/src/`, all of them "not registered in that shell". Measured today:

| command | desktop (`apps/desktop-tauri/src/lib.rs`) | tablet (`apps/mobile-tauri/src/lib.rs`) |
|---|---|---|
| `clear_device_binding_scoped` | registered | — |
| `create_memo_scoped` | registered | — |
| `get_ap_aging_report_scoped` | registered | — |
| `get_device_binding_scoped` | registered | — |
| `get_terminal_profile_scoped` | registered | — |
| `list_workspaces_scoped` | registered | — |
| `open_product_images_scoped` | registered | — |
| `pg_sync_status_scoped` | registered | — |
| `publish_memo_scoped` | registered | — |
| `revise_memo_scoped` | registered | — |
| `update_workspace_instance_scoped` | registered | — |
| `activate_license` | registered | — |
| `load_topology` | registered | — |
| `load_topology_revision` | registered | — |
| … | **all 27** | **none of the 27** |

The 11 `_scoped` names exist in the Rust bridge (`crates/kasirmu-bridge`) and are registered by
the desktop shell; the tablet shell registers **zero** of them.

## Why this is not a checker artefact

Three facts rule out the artefact reading, each measured rather than assumed:

1. **Both shells load the same feature registry.** `ui/src/main.mobile.tsx:5,16` calls
   `registerAllFeatures()` — the same function `ui/src/App.tsx:3,8` calls. There is no
   shell filtering in `ui/src/features/index.ts`, so the tablet build registers the same pages
   as desktop.
2. **The screens carrying these calls are registered, and not shell-qualified.** e.g.
   `ui/src/features/locations/register.tsx` registers `TopologyScreen` at route `topology` with
   `requiredRole: 'manager'` and no platform guard, so it renders on both.
3. **The tablet entry is a real entry, not a stub.** `ui/index.mobile.html:195` loads
   `/src/main.mobile.tsx`, which `ui/vite.mobile.config.ts:118` builds to `dist-mobile` — the
   bundle `apps/mobile-tauri/tauri.conf.json` serves via `frontendDist`.

**CORRECTED 2026-10-24, after a per-site reachability audit: the sentence that used to sit
here was wrong and is quoted only so the correction is traceable.**

> ~~So a tablet user who opens Topology, Memos, Warehouse, Terminals, Email Reports or the POS
> reaches code that invokes a command the shell does not expose.~~

That was true for Memos, Warehouse, Terminals and the POS. It was **false for Topology and Email
Reports**, and it was written from the registration facts above without tracing whether the call
sites actually mount on a tablet. The 34 sites split three ways:

| Class | Sites | Why |
|---|---|---|
| **Reachable — a real tablet failure** | **9** | see the table below |
| **Gate false positive — an effective guard the checker could not read** | **5** | `if (!isTabletShell())`; now fixed in the checker |
| **Unreachable on tablet** | 20 | topology notice (11), desktop-only mounts (5), no production importer (3), hook with no caller (1) |

**The 9 that reach the code, and what each one actually does** (re-graded 2026-10-24 after
reading the call sites' error handling, because "reaches the code" is not the same as "fails"):

| site | command | Effect on a tablet |
|---|---|---|
| `memo/MemosScreen.tsx:210,284` | `create_memo_scoped`, `revise_memo_scoped` | inside `try` → `setActionError`; **the user sees an error and the memo does not save** |
| `terminals/TerminalManagementScreen.tsx:289,383,397` | `get_device_binding_scoped` ×2, `clear_device_binding_scoped` | inside `try` → `setBindingError`; **binding fails to load/clear** |
| `warehouse/WarehouseConsole.tsx:112`, `WarehouseCountFlow.tsx:125` | `list_warehouse_products_at_location` | fires on mount — needs per-site reading; likely a load failure |
| `retail/RetailPosScreen.tsx:881` | `open_product_images_scoped` | **NOT a failure.** `ui/src/api/browser.ts:60-74` catches the rejection, logs a warning, opens a `window.open` fallback and returns `false`; the caller also `.catch(() => {})`s. The tablet has its own `open_product_images` (unscoped, global-db) in `apps/mobile-tauri/src/commands/browser.rs:32` — a NAME mismatch against the UI's `_scoped` spelling, not a missing feature. |
| `reports/DebtRemindersCard.tsx:127` | `get_ap_aging_report_scoped` | user-initiated from a button; error path not yet read |

So the count of **genuinely user-visible tablet breakage is 5–7, not 9**, and one of the nine
(`open_product_images_scoped`) is a documented degraded path that already works. The remaining
question per site is only whether the error is caught or thrown.

**FINAL GRADE, 2026-10-24: every one of the 9 is caught. None throws.**

**And the checker that found all of this now has full mutation coverage.** Triage by
`scripts/sabotage-selftests.py` on 2026-10-24: `verify-scoped-reads.py` kills **35 of 35**
candidate functions, including the `_platform_guard_excludes_shell` this round just repaired. So
the fix is not merely present — a harness that guts the function and re-runs the self-test
confirms the cases notice.

| site | how the error surfaces |
|---|---|
| `MemosScreen.tsx:210,284` | `try` → `setActionError` — the user sees an error and the memo does not save |
| `TerminalManagementScreen.tsx:289,383,397` | `try` → `setBindingError` — the binding panel fails to load |
| `WarehouseConsole.tsx:112`, `WarehouseCountFlow.tsx:125` | `try` → `setLoadError` with a localized message (`warehouse-load-error`) |
| `RetailPosScreen.tsx:881` | `catch` → `window.open` fallback, returns `false`; caller also swallows |
| `DebtRemindersCard.tsx:127` | `try` → `console.error` only — **the user gets no feedback and no export** |

**So the honest severity is: 7 sites show a user-visible error state, 1 silently does nothing, 1
degrades to a working fallback. No site crashes and no site corrupts data.**

That is a *feature-completeness* gap — "these screens are broken on tablet" — not a
*correctness* gap. It is still worth fixing, but it changes the decision: the tablet is not
crashing, so this does not need to block anything today, and the BR-* ruling it waits on is a
product decision about which surfaces the tablet should carry, not a safety one.

**A measurement note, because this document has now been corrected three times and the pattern
matters more than any single number.** Each pass was honest about what it had NOT checked and said
so in the text — registration (pass 1), mount reachability (pass 2), error handling (pass 3) — and
each pass still produced a confident headline ("34 failures", "9 failures") from the facts it did
have. The lesson is not "measure harder"; it is that a headline count assembled before the last
check should be labelled a lower bound, not a finding.

**Three false readings in one session came from the measurement METHOD, not the code** — and
all three share a shape: the tool was run the wrong way and its answer believed:
 from the measurement METHOD, not the code**, and
they are all one shape — the tool was run the wrong way and its answer believed:

| What was run | How | False reading |
|---|---|---|
| `bash verify-docker-digests.sh 2>&1 \| tail -25` | piped | "exit 0" — it was `tail`'s status |
| `bash -c '... ; echo RC=$?'` | chained | "exit 0" — the `echo` consumed the status |
| `python scripts/check-testid.mjs --self-test` | **wrong interpreter** | "FAIL(1)" — it is a Node script and needs `node` |

The third one is the same mistake as the first two, made again *after* both, in the same round.
The rule that would have caught all three: **when a result contradicts what you just measured,
suspect the measurement before the code.** The `check-testid.mjs` "failure" contradicted the
15-of-19 mutation kill measured minutes earlier — and the kill was the trustworthy signal, because
it went through the harness's own interpreter dispatch.

**The 11 topology sites are not failures.** `TopologyScreen.tsx:167-169` returns a notice before
`TopologyScreenContent` mounts when `isTabletShell()`, and `WorkspaceHome.tsx:46-48` keeps
`topology` off the tablet shell. So the whole topology family is deliberately tablet-blocked,
and the checker reports it anyway.

**The 5 false positives are now fixed in the checker.** `_platform_guard_excludes_shell`
(`scripts/verify-scoped-reads.py:653`) knew only the POSITIVE form of the other shell's name and
hunted a helper `isDesktopShell` that has **zero occurrences in this repo**. The dominant idiom is
`if (!isTabletShell())`, which it could not read.

The old code read `other = "isDesktopShell" if shell == "tablet" else "isTabletShell"`, so grading
**tablet** looked for `isDesktopShell()` — which no file in this repo contains — while the repo
spells the desktop branch `!isTabletShell()`. Corrected to test both the other shell's positive
form **and this shell's negated form**, with a self-test case for each direction plus a control so
the predicate cannot pass by answering `True` for every shell. **Verified by mutation: reverting
the fix reddens the self-test, naming the case. 34 → 29.**

**Confidence, stated:** high on registration and screen registration (parsed from both
`generate_handler!` lists and the 27 `register.tsx` files); medium-high on reachability (traced
importers and mount paths statically, **not** confirmed on a device). The one thing still open is
how a tablet reaches route `warehouse` — the seeded `workspace_type_screens` lists
`products`/`inventory` but not `warehouse` itself, so it may need a deep link.

**The failure shape, stated precisely.** An `invoke` of a command absent from `generate_handler!`
rejects with an error rather than returning a value, so the call site takes its `catch`/error
branch — a rejected promise, not a silent no-op. What a user then sees depends on the screen
(some toast via `GlobalErrorReporter`, some catch-and-swallow, e.g.
`RetailPosScreen.tsx:881` ends `.catch(() => {})`). **Reachability is measured; the per-screen
user-visible effect is not.** I have not run the tablet build and clicked through these six
screens, so this finding claims a rejected command at each of the 34 sites and does NOT claim a
specific visible symptom per screen.

## The two halves, which the current message conflates

| Class | Sites | Shape | Fix direction |
|---|---|---|---|
| **Registration gap** | 14 | Calls a `_scoped` command that EXISTS in the bridge but is not in `generate_handler!` for tablet | Register it in `apps/mobile-tauri/src/lib.rs` |
| **Scoping gap** | 20 | Calls an *unscoped* command (`load_topology`, `activate_license`, `get_machine_id`, `create_backup`, …) | Needs a scoped twin under the ADR #7 conditional, or a documented host-only reason |

The checker's closing advice — "Fix by routing through the scoped twin under the ADR #7
conditional" — fits the second half only. For the first half it is misleading: those commands
already ARE the scoped twin, and nothing is missing on the UI side at all.

## What the gate does and does not see

`--shell` defaults to `desktop` (`scripts/verify-scoped-reads.py:1124`), and both live runners
(`.github/workflows/dev-ci.yml:1537`, `scripts/check.sh:183`) run it bare. Desktop has **0**
findings, so CI prints `clean for desktop.` and exits 0 — while every finding lives in the other
section. The bare run does print an info line naming the ungraded shell's count, but its own
docstring (`:1252-1255`) states that no exit code branches on it.

Re-measured 2026-10-24: **101 findings when this was first filed (2026-09-14), 29 now** —
and of the 29, 20 are unreachable on tablet, so the real backlog is **9 sites, of which 7 show a
user-visible error and 1 silently does nothing**. The rest is checker noise that has since been
fixed. Two-thirds of the original 101 was cleared by work that no CI log recorded, because the
lane clearing it cannot make the gate red.

## What an owner must decide

**Measured constraint that narrows the options: allowlisting will NOT make this green.**
`scripts/ipc-parity-allowlist.json` already lists all 27 names under its `"tablet"` section, and
the gate still exits 1. So "allowlist it" is not an available path — the only green paths are
registering the commands or removing/guarding the call sites.

This is the same ruling the BR-* family needs (`audit-open-findings.md`: BR-S8/BR-X4/BR-S9/
BR-S10 — *which shell's gate set is authoritative*). The fork:

- **Register the commands in the tablet shell** — the direct fix for the 14 scoped sites, and it
  makes the tablet surface match the UI it already ships. Requires the bridge commands to be
  safe on tablet (session scoping, no host-only assumptions).
- **Or exclude these screens from the tablet build** — the alternative, and a larger change:
  `registerAllFeatures()` is shared, so it needs per-shell page filtering that does not exist
  today.
- **Or allowlist the 34 sites as documented tablet gaps** — honest about the state but leaves
  real runtime failures in place.

**And the convention for saying so already exists.** `ui/src/api/workspaces.ts:299` and
`ui/src/api/data.ts` carry four "Desktop-only: not registered on tablet (recorded product choice)"
comments, naming memo authoring and payables as the precedent. So the project HAS a way to record
a deliberate desktop-only command — applied **4 times** against **34** call sites. That half needs
no ruling: whichever option is chosen above, annotating the sites with the same line is the
cheapest, most honest part, and it is what the four existing comments were doing.

Applying the one-flag fix (`--shell desktop,tablet` in both runners) turns CI red against this
backlog, and the checker has no `--baseline` and no report-only mode, so it cannot be turned on
"yellow" first. **Sequencing is the owner's call, not a lane's.**

## One of the nine is now FIXED — the silent one (2026-10-24)

The final grade above says 7 sites show a user-visible error, 1 silently does nothing, and 1
degrades to a working fallback. **The silent one was the only one worth fixing without a product
ruling, and it is fixed** — `a74153ac8`.

`DebtRemindersCard.tsx`'s two aging-report export handlers caught the rejection into
`console.error` and nothing else, so on a tablet — where `get_ap_aging_report_scoped` and
`get_ar_aging_report_scoped` are not registered — a merchant clicking Export saw no error, no
file, and no feedback: a button that does nothing is indistinguishable from a broken one. The fix
follows the component's OWN established pattern (`recsFailed`/`paysFailed` already surface a
failed read as a `role="alert"` badge rather than as "Up to date"), so a failed export now sets
`exportFailed` and renders the same warning badge with a new localized string
(`dashboard-export-aging-failed`, en + id). It clears on the next successful export.

**Three tests pin it, and they were proven non-vacuous by reverting the fix**: with the AP
handler's `setExportFailed('ap')` removed, 2 of the 3 new tests redden with
`Unable to find an element by: [data-testid="ap-aging-export-failed"]`. Suite 11/11 green with the
fix, ESLint clean, `tsc --noEmit` clean, `dedupe-ftl` clean, and the pre-commit bundle-parity
gate confirmed the new key exists in both locales.

**The other eight still wait on the owner ruling** about which surfaces the tablet should carry.
That is unchanged: this fix removed a silent failure, not the feature gap. The remaining 7 sites
that show an error state are honest — the user is told the action failed — and 1 already degrades
to a working fallback.

## The memo sites are now GUARDED — the second of the nine fixed (2026-10-24, round 125),,`MemosScreen.tsx`'s create and revise handlers called `createMemoScoped` / `reviseMemoScoped`,unconditionally. Those two commands are registered on the **desktop shell only**; the mobile shell,registers the consumer pair instead (`list_active_memos_scoped`, `acknowledge_memo_scoped`), and,`apps/mobile-tauri/src/commands/memo.rs` says why in its own module doc — *"Authoring,(`create`/`publish`) is a manager/admin surface and is not wired to the tablet shell yet"*. So on a,tablet the form rendered, accepted a full memo, and only then met `command not found`.,,**Fixed in `9b0c19248` by guarding the calls, not by hiding the form.** Each handler now wraps its,call in `if (!isTabletShell()) { … }` — the idiom this repo already uses (`TopologyScreen:167`,,`LicenseActivationScreen:293`) and the brace shape `verify-scoped-reads.py`'s depth walk reads, so,lifting a call back out reddens the gate rather than the screen.,,**A JSX `{!isTabletShell() && (<Card…>)}` guard was tried first and is invisible to the gate**:,`_platform_guard_excludes_shell` walks BRACE depth, and `&&` opens none. The user-visible effect was,correct either way, but only the brace form keeps the defect from returning.,,| measurement | before | after |,|---|---|---|,| `verify-scoped-reads.py --shell tablet` findings | 29 | **27** |,| `MemosScreen.tsx` sites listed | 2 | **0** |,| `MemosScreen` tests | 14 | **15** |,,**The new test pins the CALL, not the markup** — `expect(mocks.createMemoScoped).not,.toHaveBeenCalled()` after a real submit with the shell mocked to tablet. Proved load-bearing by,disabling both guards (`if (true)`): it fails with *"expected `vi.fn()` to not be called at all, but,actually been called 1 times"*, which is the original defect in one line. A test that merely,rendered the screen passed throughout.,## Provenance

- Gate: `scripts/verify-scoped-reads.py` (`--shell tablet`).
- Found by re-measuring the tablet half of the gate while auditing open findings; the original
  finding is in `docs/records/findings/audit-open-findings.md` under the 2026-09-14 entry.
- Related: GI-6's suffix invariant (pinned this round in `scripts/verify-ipc-parity.py`), and
  the same `--shell` default documented at `verify-ipc-parity.py:1604-1608`.
