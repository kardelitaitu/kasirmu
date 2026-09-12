# ADR #7 Conditional Scoping — the Fallback Class

<!-- 2026-09-12 · DSH · measurement record, not a plan, not a fix list · branch 0.0.37 -->
<!-- 2026-09-13 · DSH · §5 corrected after a false negative: the structured warning DOES exist, in
     crates/oz-bridge/src/data.rs (c617739e7). §1 and §6 coordinates for the backup pair re-pointed for
     the +13-line shift cf1147423 introduced. Every file:line pair below was read from HEAD. -->
<!-- Companion to docs/operations/runbook.md §8.8 (legacy cleartext credential rows) and to
     ui/src/__tests__/api-data-contract.test.ts, whose two ungated cases at :47 and :53 are a
     DELIBERATE record of this class, not an oversight. Read them together: the contract test pins
     the bypass so it cannot be forgotten; this page records why it cannot simply be deleted. -->

<!-- PROVENANCE OF THE COUNTS. The sweep reported its inventory at HEAD `c7ab7a55c`, which does **not
     resolve** as an object in this repository (`git cat-file -t c7ab7a55c` → fatal). The nearest real
     commit, and almost certainly the intended one, is `c7ab7155c` — docs(ui): correct setSetting scope
     comment to the global identity database. Every file:line pair in §1, §2 and §3 was therefore
     re-read from disk against the working tree on 2026-09-12 and holds, with the drift noted in
     §1's false-positive entry. Treat the coordinates as verified-2026-09-12, not as pinned to a SHA
     that cannot be checked out. -->

**This repo closes a permission gap by adding a scoped twin and leaving the original call as the else
branch of a ternary** — `sessionToken ? thingScoped(sessionToken) : thing()`. The comment that stood
at `ui/src/features/settings/DataManagementScreen.tsx:226`–`:228` up to `cf1147423^` named that pattern
*ADR #7 conditional scoping* (`git show cf1147423^:ui/src/features/settings/DataManagementScreen.tsx`,
those three lines). `cf1147423` rewrote it in place, so the same coordinates at HEAD hold the correction
— it now opens "NOT a designed gradation" — which is why this page quotes the name rather than pointing
at it. The consequence is that an audit item recorded **complete** is still **open** through its own
fallback: the scoped command enforces a permission nobody without a token can satisfy, and the ungated
command next to it enforces nothing.

> ### PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT
> A ternary fallback in this inventory is a *recorded bypass with a reason*, not approved
> design. Nothing in this document licenses adding a new fallback, and the harness pattern in §5 is
> offered only for sites that must keep working with no cloud session at all.

The sentence this document exists to carry is the second one, not the first:

**The sweep proved the fallback is not dead code.** The workspace token is genuinely absent in normal
states:

- An authenticated owner with no resolvable workspace instance never gets one —
  `ui/src/contexts/WorkspaceContext.tsx:469`–`:473` returns (`if (!tokenInstance) return;`) **before**
  minting, and `:463` (`if (!session?.user_id) return;`) returns without a user id.
- Four sites null an existing token while the shell stays mounted — `WorkspaceContext.tsx:215`, `:274`,
  `:319`, `:507` (`setSessionToken(null)`).
- **There is no component-level auth guard to rule those states out.** `RequireAuth`, `AuthGuard` and a
  login redirect return **nothing** over `ui/src`: `git grep -n -e RequireAuth -e AuthGuard HEAD --
  ui/src` → no hits (exit 1). Scope of that zero: `ui/src` only. It does not exclude a gate living
  elsewhere — the shell's own gates, named two bullets down, are exactly such a thing.

  Narrow that, because the grep's *reason* is shakier than its *conclusion*: `ui/README.md` describes
  `App.tsx` as "setup guard → auth guard → AppLayout", and at this HEAD `ui/src/App.tsx` contains **no**
  guard of any kind — 38 lines (`grep -c '' ui/src/App.tsx`), and
  `grep -n -e Auth -e Setup -e guard ui/src/App.tsx` → no hits: `AppProviders` → `AutofillBlocker` →
  `AppShell`, plus a `DEV_TOOLBAR_ENABLED` conditional. The gates live one level
  down, in `ui/src/frontend/shell/AppShell.tsx`, which the README itself calls the place that "handles
  setup wizard flow, auth gates" and which does hold them — setup-complete, has-any-users, active-license
  (`:74`–`:80`). So guards exist; what does not exist is a guard on **the cloud session token**. The
  conclusion above stands, but for the right reason: every gate in the shell keys on local state (a
  completed wizard, a PIN, a license file), and none of them is a thing a *workspace* session can be
  required to have.

So no screen in the list below can be proven to require a session, and therefore — verbatim from the
measurement — **zero sites are confidently deletable, four are constrained by which shell registers the
command, and fifteen are gated behind a decision about what a workspace-less session means.** That is a
design gap, not a defect list.

## 1. The inventory — 19 sites, 13 wrapper names, 12 files

| file:line | wrapper | R/W | class | note |
|---|---|---|---|---|
| `ui/src/contexts/CurrencyContext.tsx:71` | `getDefaultCurrency` | READ | structural | root provider; optional token argument |
| `ui/src/features/sales/EodReportScreen.tsx:402` | `exportEodReport` | READ | structural | shell gap — desktop registers no such command, so the ambient call rejected on every visit |
| `ui/src/features/sales/hooks/usePosCartActions.ts:103` | `getCartDeductionLocation` | READ | structural | shell gap — tablet only |
| `ui/src/hooks/useTerminalHardware.ts:239` | `getHardwareSettings` | READ | structural | shell gap, **inverted** — the unscoped call is the one that fails on desktop, so the bug is the fallback being *chosen*, not existing |
| `ui/src/features/settings/DataManagementScreen.tsx:244` | `getBackupStatus` | READ | design | the pair that started this; see §5 |
| `ui/src/features/settings/DataManagementScreen.tsx:276` | `createBackup` | WRITE | design | disk copy, no permission check |
| `ui/src/features/settings/LicenseSettings.tsx:249` | `pauseSubscription` | WRITE | design | unscoped variant reads the stored API key and calls the billing server unchecked |
| `ui/src/features/settings/LicenseSettings.tsx:272` | `resumeSubscription` | WRITE | design | same; recovered by the depth-aware pass (§4) |
| `ui/src/features/settings/AppearanceSettings.tsx:162` | `pickLogoFile` | SIDE-EFFECT | design | native file dialog, no permission check |
| `ui/src/features/settings/EmailReportSettings.tsx:120` | `getReportSchedule` | READ | design | |
| `ui/src/features/settings/FeatureToggleScreen.tsx:172` | `listAllFeatures` | READ | design | |
| `ui/src/features/sales/PaymentModal.tsx:748` | `getSale` | READ | design | three copies of one fix; comment at `:743`–`:745` says an ambient read showed a customer a total from a different store |
| `ui/src/features/sales/PaymentModal.tsx:1021` | `getSale` | READ | design | missed by a single-line regex (§4) |
| `ui/src/features/sales/PaymentModal.tsx:1258` | `getSale` | READ | design | missed by a single-line regex (§4) |
| `ui/src/features/sales/SalesHistoryScreen.tsx:234` | `listSales` | READ | design | |
| `ui/src/features/sales/SalesHistoryScreen.tsx:401` | `getSale` | READ | design | comment at `:398`–`:400` documents three different scoping treatments inside one `Promise.all` |
| `ui/src/features/sales/VoidOrdersScreen.tsx:113` | `listSales` | READ | design | |
| `ui/src/features/sales/VoidOrdersScreen.tsx:139` | `getSale` | READ | design | |
| `ui/src/features/sales/VoidOrdersScreen.tsx:208` | `getSale` | READ | design | |

Tally: **READ 15 · WRITE 3 · SIDE-EFFECT 1**.

Reconciliation, flagged as the writer's arithmetic rather than the sweep's: the measurement groups these
as *four shell-constrained* and *fifteen decision-gated*. Three rows carry an explicit shell-registration
note above (`EodReportScreen:402`, `usePosCartActions:103`, `useTerminalHardware:239`); the fourth is the
root provider at `CurrencyContext.tsx:71`, which is constrained the same way — a provider cannot know at
render time which shell hosts it, so it cannot choose a scoped call either.

The one **false positive** the detector produced is `ui/src/features/sales/VoidOrdersScreen.tsx:223`,
whose colon belongs to a `voidReason` ternary — `const reason = voidReason === 'other' ? … : voidReason`
(at `:188` at this HEAD; `:223` is now a comment line that also contains a colon). A method that produces
no false positives is a method nobody should trust.

## 2. The second set — six ungated calls with NO branch at all

These have no ternary, so **no fallback regex can ever see them**. They are not ADR #7 sites; they are
the same gap without the fig leaf.

| file:line | wrapper | note |
|---|---|---|
| `ui/src/features/settings/sections/SyncSection.tsx:426` | `testSyncConnection` | side-effecting — it dials a server |
| `ui/src/hooks/useSyncConnection.ts:105` | `testSyncConnection` | same call from the hook |
| `ui/src/frontend/shell/UpdateBanner.tsx:140` | `getVersion` | |
| `ui/src/frontend/shell/UpdateBanner.tsx:144` | `getSetting('updater.previous_version')` | |
| `ui/src/hooks/useGatewayStatus.ts:23` | `getSetting('stripe.api_key')` | **can only ever return null** — see below |
| `ui/src/contexts/BrandContext.tsx:54` | `getBrandSettings` | root provider |

The gateway row is worth stating for the record: `run_get_setting` short-circuits `is_secret_key` **before
touching a connection**, on both lanes — `apps/tablet-client/src/commands/settings.rs:471`–`:476` (its own
copy) and, for the desktop shell, `crates/oz-bridge/src/settings.rs:442`, reached from `get_setting` through
`run_get_setting` at `:922`–`:925`; the predicate itself is the shared `is_secret_key` at
`crates/oz-bridge/src/settings.rs:67`. So the read cannot return the key on either shell. **The badge it
feeds is not stale, it is dead.** And `useGatewayStatus.ts:26` sets `online: configured` — a restatement of
the value it just derived, with no probe behind it.

## 3. What the scoped lane actually rejects (measured, because the claim needed narrowing)

The intuition behind *gating by session is unimplementable for an install that never completes the cloud
chain* is right, but the mechanism is narrower than "the wrappers reject":

- Exactly **3** wrappers in the whole API layer reject with a plain `Error` before any IPC — all three in
  `ui/src/api/settings.ts` (`:244`, `:260`, `:279`), e.g. `Promise.reject(new Error('No session token'))`.
- **410** wrappers declare `sessionToken: string` as non-null (`ui/src/api/sales.ts:507`
  `getSaleScoped` forwards it straight to `loggedInvoke`), so they never see a missing token — the
  ternary at the *call site* decides first, and the fallback is what runs.

That is the class, precisely: the gate lives in a React ternary at 19 call sites, not in the API layer
and not on the Rust side. An install that never completes the cloud chain cannot pass a token check it
has no source of tokens for, which is why §5 says the real closure is server-side enforcement derived
from a local identity — a thing the product does not currently have.

## 4. Method — why 19 is believable

1. **Pair set from the API layer:** 509 exported names across 62 files, giving 248 `Scoped` names and
   **75 pairs where the ungated twin is also exported** — a fallback is only reachable if the unscoped
   name exists to call.
2. **Walk:** 523 production files, tests and dev-mock excluded.
3. **Detection:** a paren- and brace-depth-aware **BACKWARD** scan from each unscoped call to the
   enclosing ternary colon and its matching question mark. This is what catches multi-line ternaries and
   argument-bearing calls that a single-line regex misses.
4. **The single-line pass found 17** and missed three: `PaymentModal.tsx:1021`, `PaymentModal.tsx:1258`,
   `LicenseSettings.tsx:272`. 17 raw − 1 false positive (`VoidOrdersScreen.tsx:223`) + 3 recovered = 19.

**The earlier lower bound was 2 short.** Stated plainly because a document that hides a superseded number
is how the next person repeats the mistake: 17 was reported before the depth-aware pass existed, 19 is
the corrected count, and the delta is the reason the method changed.

## 5. What is and is not decided

- A mitigation landed on the backup pair while this record was being written, and it is **two commits,
  not one**. `cf1147423` (test(ui): pin the tokenless backup bypass and stop calling it a design) touched
  `DataManagementScreen.tsx` +16/−3 and `ui/src/__tests__/DataManagementBackup.test.tsx` +72/−1 — from
  `git show --numstat cf1147423`, not `--stat`, whose diff table is printed after the message. It changes
  no security property: **the bypass stays reachable**. What it did change is the comment at
  `DataManagementScreen.tsx:226`–`:228`, which had been certifying the pattern; those lines now certify
  the hole instead.
- The Rust half is `c617739e7` (feat(bridge): log every ungated backup call as
  `backup_ungated_no_session`; one file, `crates/oz-bridge/src/data.rs`, +53/−4 by the same query). The
  warning exists at HEAD, twice: `crates/oz-bridge/src/data.rs:291`–`:295` for `get_backup_status` and
  `:337`–`:342` for `create_backup`, each carrying `operation` and
  `skipped_permission = permissions::DATA_EXPORT`, and the sentence "served backup status with no session identity presented" /
  "ran a full database backup with no session identity presented". Nothing else is carried, by design:
  "The event carries the operation name and nothing else: no value, no backup path, no token"
  (`:288`–`:289`).
- **Why it is not in a shell file.** The command bodies moved out of the shells into the shared bridge
  under ADR #49 (`docs/decisions/2026-09-11-adr49-headless-command-bridge.md`), so a shell is a delegate:
  `apps/desktop-client/src/commands/data.rs:35` and `:45` call `oz_bridge::data::get_backup_status` and
  `create_backup`, registered at `apps/desktop-client/src/lib.rs:843`–`:846`. One emit in the bridge
  covers every caller of those bodies instead of needing a copy per shell. Scope the sentence before you
  repeat it, because the un-scoped version is this record's error one size up: today the only caller is
  the desktop shell — `git grep -in backup HEAD -- apps/tablet-client` → 3 hits, every one of them
  `gen/android/` XML, and `apps/tablet-client/src/commands/mod.rs` declares no `data` module where
  `apps/desktop-client/src/commands/mod.rs:29` declares it. On tablet the tokenless call has no
  registered command to reach at all — the same shape as §1's three `shell gap` rows. That is a note
  against this pair's `design` class in §1, found while correcting §5 and deliberately not resolved here:
  changing it would move the four/fifteen split §1's reconciliation reports, and that arithmetic belongs
  to the sweep, not to this correction.
- The property that makes the event worth reading is structural, not decorative:
  `backup_status_direct` (`:306`) and `create_backup_direct` (`:349`) are private; the ungated
  `get_backup_status` / `create_backup` emit and then call them; and `get_backup_status_scoped` (`:786`)
  / `create_backup_scoped` (`:801`) call the helper, not the public wrapper — `:795`–`:796`, "a call that
  DID present a session must not emit backup_ungated_no_session". A call that presented a session and
  enforced the permission therefore **cannot** emit the event, and "Nothing outside this file can reach
  the un-warned path" (`:305`). **That is what makes `backup_ungated_no_session` a count of ungated calls
  rather than a sample of them** — the property a reader needs before treating a log line as evidence.
- **How this record got it wrong, kept in because the method matters more than the fact:** it searched
  two paths, `apps/desktop-client/src/commands/data.rs` and `apps/tablet-client/src/commands/data.rs`,
  saw nothing, and printed a tree-wide absence from a two-path query. The second path does not exist, so
  half of that "nothing" was a missing-file error on stderr and an empty stdout — indistinguishable from
  a clean negative unless the exit status is read. The query that establishes the truth is
  `git grep -n backup_ungated_no_session HEAD` → `crates/oz-bridge/src/data.rs:292`, `:304`, `:338`,
  `:796`, plus the two cross-references that make it load-bearing:
  `ui/src/features/settings/DataManagementScreen.tsx:240` ("LOUD — event `backup_ungated_no_session` in
  `crates/oz-bridge/src/data.rs`") and `ui/src/__tests__/DataManagementBackup.test.tsx:281`. A zero is
  only worth what its scope covers, and a path that will not open returns a zero for the wrong reason.
- A known-hazard pin renders the tokenless state for that one pair — the `cf1147423` half of the
  mitigation; `c617739e7` added no test. Before it, no test had rendered **this screen** without a token:
  `git show cf1147423^:ui/src/__tests__/DataManagementBackup.test.tsx | grep -c 'sessionToken: null'` →
  **0**, and `ui/src/test-setup.ts:161` seeds `sessionToken: HARNESS_SESSION_TOKEN` for every render, so
  a component that falls back to the ungated command in production never does so under Vitest. Scope that
  zero to the pair: six other files under `ui/src/__tests__` do pass `sessionToken: null`
  (`git grep -c 'sessionToken: null' HEAD -- ui/src/__tests__`), none of them this one. *That pin is
  the pattern for a WRITE or side-effecting site ONLY, and only where the feature must keep working offline.* It is **not** a
  template for the 15 READ sites, and it is not extended to them by this document.
  (Coordinate correction, so nobody greps for a file that does not exist: the record as handed over cited
  `ui/src/__tests__/test-setup.ts:113`. `git ls-files ui/src/__tests__/test-setup.ts` → no output; the
  real file is `ui/src/test-setup.ts`, where the seed is at `:161` and `:113` is the brand-settings mock.)
- **The real closure is server-side enforcement derived from a local identity, which the product does not
  have** (§3). Until an identity source exists, every scoped wrapper is gating on a bearer string the UI
  itself decides whether to pass.

## 6. The open decision, for the owner

**What does a workspace-less session mean?** Three of these sites perform a disk copy
(`DataManagementScreen.tsx:276`), a billing-server call (`LicenseSettings.tsx:249`/`:272`) and a native
file dialog with no permission check (`AppearanceSettings.tsx:162`). **That cannot be answered by hiding
a control** — the command stays registered and callable regardless of what the screen renders, which is
exactly what the §2 set shows.

The four shell-constrained sites in §1 need **per-shell analysis before any edit**: their verdict depends
on which shell registers the command, not on the token.

## 7. Not reached, named honestly

- **Route reachability before workspace selection is unmeasured.** `ui/src/App.tsx` gates nothing —
  38 lines, and `grep -n -e Auth -e Setup -e guard ui/src/App.tsx` → no hits; the gates live in
  `ui/src/frontend/shell/AppShell.tsx`, which calls `useWorkspace()` at `:82` (imported at `:6`) and holds
  the setup / has-any-users / active-license state at `:75`–`:77`. Whether every screen above is
  renderable with `sessionToken === null` was **not** established — no query in this record walks the
  router, and the only negative it rests on is the `RequireAuth`/`AuthGuard` grep, which is scoped to
  named components and not to behaviour.
- **Four wrapper bodies were not read** — of the 13 named in §1. Which four is not recoverable from this
  record, so the sentence is a limit on coverage, not a finding about those four: treat their class as
  unverified rather than as a fourth shell gap waiting to be confirmed.
- **This record was unreachable from the index. The generator half is fixed; the assertion half is
  not, and the miss was never just this page.** Two negatives were written here, each with its query.
  *Nothing regenerates the index on a schedule* — still true:
  `grep -rn 'generate-records-index' .githooks/ .github/workflows/*.yml scripts/check.sh` → no hits, run
  from the repo root, so the empty answer covers hooks, both live workflows and the local gate. *The
  generator never scanned `docs/records/`* — no longer true: `e3e5fcf54` (fix(docs-index): scan
  docs/records so the index lists its own directory) made `docs/records/` an enumerated root rather than
  only an output path, and HEAD's `docs/records/README.md` lists this page
  (`git show HEAD:docs/records/README.md | grep -c 'adr7-conditional-scoping-fallback-class'` → **1**, at
  `:98`). The headline is this directory, not this file: **six records were invisible, not one.**
  `git show --numstat e3e5fcf54` → `docs/records/README.md` +16/−1, and the index is 124 lines at
  `e3e5fcf54^` against 139 at `e3e5fcf54` (`git show <sha>:docs/records/README.md | grep -c ''`); the six
  added rows are `docs/records/README.md:97`–`:102` — the journal, this page, `audit-open-findings.md`,
  the fluent page audit, `sqlite-pg-roles.md` and `statutory-rounding-and-estimate-stamps.md`. Tested
  both directions: the same command run against the old generator returned the file byte-identical, so
  the emptiness was the generator not seeing the directory, not the directory being empty. An empty diff
  from a generator is a scope statement.
  **So what is left is freshness, not coverage.** A record added to `docs/records/` from here on is
  listed the moment anyone runs the script — the earlier sentence on this bullet said the opposite, and
  that was the version this line replaces. The script can now answer the question itself:
  `node scripts/generate-records-index.mjs --check` renders twice, fails if the two renders differ,
  compares against the committed index, exits 1 on drift naming the differing lines and 0 when fresh,
  and writes nothing — the contract copied from `scripts/generate-pg-migration.py --check`, which sits in
  pre-commit step 7 and `dev-ci.yml#static-gates`. This one sits in neither, and that was decided rather
  than overlooked: three of these records were dirty in concurrent working trees at the time
  (`git status --porcelain -- docs/records` → `JOURNAL.md`, `audit-open-findings.md` and this file), and a
  freshness gate that fires on content someone is mid-way through writing is an event that cries wolf.
  The gate belongs in the same change as the first record that trips it, in a quiet tree. Both halves are
  the class this record documents: a control no scheduled run asserts is a commitment, and a scan that
  omits a directory reports that directory as absent.
- **A green UI typecheck does not clear this class.** `cf1147423`'s own body records two pre-existing
  `tsc` errors in `ui/src/features/workspaces/WorkspaceHome.tsx` (`TS6133` unused import, `TS2440`
  import/local conflict) belonging to another session. A failure naming that file is not this finding.
- `PromotionManagementScreen.tsx:143`, `:145`, `:161`, `:172` and `VariantManagementScreen.tsx:156` pass
  `sessionToken` as the **first** argument to an ungated-named function. This may be a pair illusion
  (a wrapper whose name has no `Scoped` twin) and **was not opened**.

## 8. What a fix must satisfy

- **Name the identity source.** Server-side enforcement needs an identity an offline install actually
  possesses; without one, "gated" means "a ternary the renderer controls".
- **Answer the shell-gap question per command**, not per screen — four sites in §1 change class depending
  on which shell registers their scoped twin.
- **The caller allowlist has landed for one shell.** `405fb1a36` (test(desktop-client): land the desktop
  registration-gate ratchet) put `registration_gate_tests.rs` (922 lines) and its generated
  `registration_gate_debt.generated.rs` (177 lines) under `apps/desktop-client/src/commands/`, wired by
  `commands/mod.rs` (+3), so **the control now exists for the desktop registration gate** —
  `git ls-files | grep registration_gate` returns those two paths where an hour ago it returned nothing.
  It covers **desktop only**: the tablet counterparts are still untracked in the shared tree
  (`git status --porcelain` → `??` on both `apps/tablet-client` files), and what it enumerates is
  **registered command names** (its own header: "448 registered names as measured 12-09-26"), not
  permissions. The **widget and page-command permission ratchet the thinker scoped is still a proposal**
  — no such file is tracked (`git ls-files` over `widget_gate` / `page_command` / `permission_ratchet` →
  nothing) — so §1's nineteen sites are still policed only by the React ternary at each call site.
- **Do not delete a fallback without proving the tokenless state unreachable.** Deleting one converts a
  *recorded* bypass into a broken feature, which is the worse outcome of the two.
