# ADR #7 Conditional Scoping — the Fallback Class

<!-- 2026-09-12 · DSH · measurement record, not a plan, not a fix list · branch 0.0.37 -->
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
branch of a ternary** — `sessionToken ? thingScoped(sessionToken) : thing()`. The comment at
`ui/src/features/settings/DataManagementScreen.tsx:226`–`:228` names that pattern *ADR #7 conditional
scoping*. The consequence is that an audit item recorded **complete** is still **open** through its own
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
  login redirect return **nothing** over `ui/src`.

  Narrow that, because the grep's *reason* is shakier than its *conclusion*: `ui/README.md` describes
  `App.tsx` as "setup guard → auth guard → AppLayout", and at this HEAD `ui/src/App.tsx` contains **no**
  guard of any kind (37 lines: `AppProviders` → `AutofillBlocker` → `AppShell`). The gates live one level
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
| `ui/src/features/settings/DataManagementScreen.tsx:231` | `getBackupStatus` | READ | design | the pair that started this; see §5 |
| `ui/src/features/settings/DataManagementScreen.tsx:263` | `createBackup` | WRITE | design | disk copy, no permission check |
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

- A **mitigation landed on the backup pair while this record was being written** — `cf1147423`
  (test(ui): pin the tokenless backup bypass), touching `DataManagementScreen.tsx` (+19) and
  `ui/src/__tests__/DataManagementBackup.test.tsx` (+73). It changes no security property:
  **the bypass stays reachable**, and the misleading ADR comment at `DataManagementScreen.tsx:226`–`:228`
  is corrected rather than left to certify the pattern.
- **Still pending from that same plan, and NOT in `cf1147423`:** the structured warning on the Rust
  ungated entry, naming the operation and stating that no session identity was presented. That commit's
  diff contains **no `.rs` file at all** — `git show --name-only --format='' cf1147423 | grep -c '\.rs$'`
  → **0** (do not use `--stat` for this: it prints the commit message too, and one message line matching
  `.rs` yields a false 1, measured the hard way). Grep for such a warning in either shell's
  `commands/data.rs` returns nothing. So as of this writing the operator-visible half of the mitigation
  does not exist on either side of the IPC boundary.
- A **known-hazard pin now renders the tokenless state for that one pair** (same commit). Before it,
  **no test exercised the hole at all**, because the harness seeds a token globally —
  `ui/src/test-setup.ts:161`, `sessionToken: HARNESS_SESSION_TOKEN` — so a component that falls back to
  the ungated command in production never does so under Vitest. *That pin is the pattern for a WRITE or
  side-effecting site ONLY, and only where the feature must keep working offline.* It is **not** a
  template for the 15 READ sites, and it is not extended to them by this document.
  (Coordinate correction, so nobody greps for a file that does not exist: the record as handed over cited
  `ui/src/__tests__/test-setup.ts:113`. That path does not exist; the real file is `ui/src/test-setup.ts`
  and the seed is at `:161`. `:113` there is the brand-settings mock.)
- **The real closure is server-side enforcement derived from a local identity, which the product does not
  have** (§3). Until an identity source exists, every scoped wrapper is gating on a bearer string the UI
  itself decides whether to pass.

## 6. The open decision, for the owner

**What does a workspace-less session mean?** Three of these sites perform a disk copy
(`DataManagementScreen.tsx:263`), a billing-server call (`LicenseSettings.tsx:249`/`:272`) and a native
file dialog with no permission check (`AppearanceSettings.tsx:162`). **That cannot be answered by hiding
a control** — the command stays registered and callable regardless of what the screen renders, which is
exactly what the §2 set shows.

The four shell-constrained sites in §1 need **per-shell analysis before any edit**: their verdict depends
on which shell registers the command, not on the token.

## 7. Not reached, named honestly

- **Route reachability before workspace selection is unmeasured.** `ui/src/App.tsx` gates nothing (no
  auth or setup conditional at all); the gates live in `ui/src/frontend/shell/AppShell.tsx`, which
  imports `useWorkspace()` at `:82` and holds the setup/license/auth-gate flow. Whether every screen
  above is renderable with `sessionToken === null` was **not** established — only that no named
  `RequireAuth`/`AuthGuard` component stands in the way.
- **Four wrapper bodies were not read.**
- **This record is not in the index, by design.** `docs/records/README.md` is generated by
  `scripts/generate-records-index.mjs` and nothing regenerates it automatically (no hook, no CI step —
  `docs/README.md` records this at length), so this file is invisible to anyone who trusts the index.
  Regenerating it is a second file and was out of scope here; run the script and commit its diff.
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
- **Land the caller allowlist** — the ratchet is `registration_gate_tests` in `apps/desktop-client` and
  `apps/tablet-client`. Neither file exists on disk yet at this HEAD, so the allowlist is a commitment,
  not a control.
- **Do not delete a fallback without proving the tokenless state unreachable.** Deleting one converts a
  *recorded* bypass into a broken feature, which is the worse outcome of the two.
