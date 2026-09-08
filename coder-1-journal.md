# Coder-1 Journal

## 2026-09-08 — supervisor round 1: scoped-coverage gate repair + two stale checkbox resyncs

Branch `0.0.37` (no branch created/switched, no push). Repo root resolved via
`git rev-parse --show-toplevel` → `C:/dev/ozpos/0.0.35/oz-pos`.

### TASK 1 — repaired the red scoped-coverage gate · commit `7a9a0cda`

`fix(ci): allowlist get_over_quota_report as genuinely-global quota assessment`
— pathspec `scripts/verify-scoped-coverage.sh` only (1 file, +10/-1).

Gate before the change (Git bash, per the platform rule — bare `bash` is WSL and hangs):

    === Scoped Coverage Check ===
    VIOLATION: commands::subscription::get_over_quota_report has no _scoped variant
    FAIL: 1 command(s) without _scoped variant or allowlist entry        [exit 1]

Gate after the change, re-run at HEAD:

    === Scoped Coverage Check ===
    PASS: all registered commands covered                                 [exit 0]

**Verified the allowlist claim myself before writing it** (did not take it on faith):

- `apps/desktop-client/src/commands/subscription.rs:379` — takes `session_token`,
  calls `state.resolve_session(&session_token)?`, then
  `require_permission_for_session(&state, &session, permissions::SETTINGS_READ)`.
  Both things a `_scoped` variant buys (auth + an inline permission check) are
  already present.
- It then locks `state.db` and calls `load_over_quota_report(&db)` →
  `Store::assess_downgrade(&ent.tier)`. **No store connection is ever resolved.**
- `crates/oz-core/src/db/downgrade.rs:28` — the counted dimensions are
  `count_locations`, `count_terminals`, `count_warehouse_locations`,
  `count_staff_users`, `count_products`. A quota is a per-tenant ceiling, so these
  are organization-global by construction. A `_scoped` variant would resolve a
  store and then ignore it — empty ceremony.
- Category 2 precedent confirmed in the same list: `get_subscription_capabilities`
  (I placed the new entry directly after it and said so in the comment).

Change is comment + one regex alternative. **No Rust touched, no dev-mock touched,
no command renamed.** The tablet client also registers this command
(`apps/tablet-client/src/lib.rs:439`) but the gate only scans the desktop client,
so no second entry was needed.

Pre-commit safety note: step 1 of the hook is `cargo fmt --all`, which auto-fixes
and **re-stages** — on a shared tree that can sweep another agent's Rust WIP into
my commit. Ran `cargo fmt --all --check` first: clean workspace-wide, so the step
was a genuine no-op. Committed with an explicit pathspec; `git show --stat` confirms
1 file, and the 13 hot-file WIP edits were still unstaged and untouched afterwards.

### TASK 2 — resynced two stale checkboxes · commit `52802d6b`

`docs(saas): resync two stale checkboxes with landed evidence`
— pathspec `todo-global-saas-1.md todo-global-saas-2.md` only (2 files, +22/-2).
Both flips were verified before being made; targeted literal `edit` calls only,
never a whole-file write.

**(a) `todo-global-saas-1.md:509` — "Remaining UI work (re-measured 2026-09-06)" → `[x]`**

Evidence checked:
- The box body already declares "**1e is now closed.**" (line 541 pre-edit) and
  every table row is struck through — the header simply lagged its own content.
- `ui/src/features/stores/` **does not exist**; `ui/src/features/locations/` does.
- `ui/src/locales/` has `multi-location.ftl` + `multi-location.id.ftl`; no
  `multi-store.ftl`.
- All five cited commits exist with matching subjects: `a965f481` (dir rename),
  `b83785b6` (drop stale deletion entries), `88a14c91` (FTL rename),
  `f5e191aa` (drop stale FTL deletion entries), `07c7b0f0` (retire legacy store
  command aliases — deleted the shim and its contract test together).
- Orphan deletion confirmed by content: zero `^topology-(shortcuts|sim|palette)`
  messages remain in the renamed bundle.
- Surviving `store`-worded strings (`multi-store-dashboard-*`, `store-pos`,
  `restaurant-pos`) are intentional per the Terminology table, not debt.

**(b) `todo-global-saas-2.md:330` — "Version and publish topology changes" → `[x]`**

Evidence checked:
- `af09ff15` (2026-09-08) `feat(topology): land restore-to-draft and the
  pruned-snapshot messaging (ADR #46 Phase 2)` — 8 UI files incl.
  `TopologyRevisionBrowser.tsx`, `TopologyScreen.tsx`, `NodeTopologyEditor.tsx`.
- `baecb7d8` (2026-09-08) `docs(topology): record the Phase 2 completion and Rule 5
  accounting in ADR #46`.
- **Amendment 7 exists** at `todo-global-saas-3.md:32` and states outright:
  "The 'Version and publish topology changes' box is now fully checked."
- Restore-to-draft browser UI present on disk; revision IPC registered
  (`list_topology_revisions`, `load_topology_revision`, `pin_topology_revision`).
- Validation / optimistic concurrency / Apply-publish boundary **pre-date** Phase 2:
  CAS in Apply is pinned by `topology_stress_tests.rs` ("CAS admits exactly one").
- **Recorded in the annotation so it is not dropped:** the re-Apply rollback is
  still Phase 3 future work behind its own ADR —
  `docs/decisions/2026-09-07-adr46-topology-revision-history-and-restore.md:419`
  takes it up "only on evidence that Phase 2 is insufficient".

### Open questions / observations for the next round

1. **`multi-location.ftl` key count has drifted from the doc.** The box I closed
   records "333 keys remain in the renamed bundle, all referenced"; a naive
   `^key =` count now gives **375**. Almost certainly keys added since 2026-09-07,
   but nobody has re-run `verify-ftl-orphans.py --census` against it. Worth one
   command to confirm "all referenced" still holds rather than letting the 333
   figure age.
2. **The gate's own NOTE is now slightly stale.** It says the allowlist is "a
   single regex alternation with **no per-entry justification**" — yet category 2
   carries prose justifications for the topology group and now for my entry.
   Harmless, but it could be reworded to point at the category blocks. Left alone
   deliberately: out of scope for this task.
3. **Journal is untracked** (`?? coder-1-journal.md`), like coder-2/3/4's. Not
   committed because the deliverable specified only the two commits above and no
   journal pathspec. Flag if journals should be versioned.
4. **Hot files respected throughout** — never edited, staged, or committed:
   `.gitignore`, `license.rs`, both `staff_tests.rs`, `service_health.rs`,
   `useAuthConnection.ts`, `useSyncConnection.ts`, `connectionHealth.ts`,
   `StatusBar.tsx`, `dev-mock/tauri-api.ts`, `shared.ftl`, `shared.id.ftl`,
   and the three new connection test/hook files. All 13 are still dirty as theirs.

---

## 2026-09-08 — supervisor round 2: entitlements consolidation Phase C (trial state, client-visible)

SUPERVISOR GO granted. Branch `0.0.37`, no branch created/switched, no push.

> Note on the round-1 flag: the supervisor reported `coder-1-journal.md` as empty
> (0 lines). It was not — 115 lines / 6,662 bytes, written 10:07 and re-verified at
> the start of this round before appending. The read was stale, not the file.

### Commits

| sha | subject | files |
|---|---|---|
| `8a13dece` | `feat(licensing): publish trial state in the signed payload` | 3 (+176/-0) |
| `2eb37045` | `feat(core): surface trial state in the entitlements read model` | 6 (+358/-1) |

### What landed

**Go (`main.go`, `activate.go`, `handler_test.go`)** — `SubscriptionPayload` gains
`IsTrial bool` + `TrialEndsAt string`, both `omitempty`, appended after `IssuedAt`.
No existing field renamed or removed; the commit is +176/-0, which is the proof.
Set on the activation trial branch only, where both `isTrialKey` and the segmented
`expiresAt` are already in scope — so `trial_ends_at` is the trial's own deadline,
not a billing period.

**Rust** — `SignedSubscriptionPayload` parses both with `#[serde(default)]`, so a
pre-Phase-C payload decodes as not-a-trial. `TenantSubscription` gains `is_trial()`
and `trial_ends_at()` reading the **`signed_payload` column the table already has**
— no migration, matching the design's "JSON — no schema migration", and the
payload is signature-covered so a tampered row cannot invent a trial. `Entitlements`
carries both as fields, projected in `from_subscription`, forced `false`/`None` in
`fail_closed`.

**Tier resolution untouched**, as required: `from_db("trial") => Free` still answers
the quota question. `trial_state_does_not_change_the_tier_or_quota_answer` and
`trial_state_leaves_the_quota_answer_untouched` pin that adding the fields moves no
tier, no effective tier, and no cap.

### Design decisions worth keeping

1. **Accessors, not struct fields, on `TenantSubscription`.** 30 literal
   constructions exist (28 in test files, several in files other agents own) —
   fields would have meant a 30-site churn commit for no behavioural gain.
   `addons()`/`has_addon()` in the same impl block already establish
   "derive from the signed payload" as this type's pattern. `Entitlements` got
   real fields instead: it has exactly one literal construction, so it was cheap.
2. **Fail closed on an unparseable `trial_ends_at`** (drop to `None`) rather than
   surfacing garbage. A trial whose deadline cannot be parsed is not a trial the
   client can count days against. Covered for 5 malformed shapes plus wrong types.
3. **`omitempty` on both fields** so a paid payload is byte-identical to a
   pre-Phase-C payload. "Absent" and "not a trial" become one client code path,
   which is what makes the no-dual-read claim true.

### Scope boundary I held (and why)

Only `license_keys` has an `is_trial` column — verified against `pb_schema.json`:
`subscriptions` does **not**. So the webhook / renew / resume / admin re-sign paths
cannot know trial-ness without a schema migration, which Phase C explicitly excludes.
They emit neither field, which is also the semantically correct answer: a period
produced by a paid re-sign is not a trial. Consequence recorded rather than hidden:
a trial that later enters a webhook-driven `grace_period` re-sign loses its trial
fields. Judged acceptable (that tenant is expired and the UI says so), but it is a
real behaviour, not an oversight — if trial-specific grace messaging is ever wanted,
the fix is a `subscriptions.is_trial` column, i.e. Phase C part 2.

### Caps DTO: skipped, OWED WORK

`get_subscription_capabilities` is served by `ui/src/dev-mock/tauri-api.ts:2089`, a
HOT file. Per the task's own condition the caps-DTO projection is therefore **not
done**: trial state is on `Entitlements` and reachable from the client commands, but
it is not yet in the caps payload or the UI. To close it when dev-mock frees up:
add the two fields to the caps DTO, project from `entitlements.is_trial` /
`trial_ends_at` in both clients' `load_capabilities`, and mirror them in the
dev-mock handler so the parity gate stays honest.

### Verification

- `cargo test -p oz-core subscription` → **128 passed, 0 failed** (10 new)
- `cargo test -p oz-core entitlements` → **13 passed, 0 failed** (4 new)
- `go vet ./...` clean; `gofmt -l` clean; `go test -short .` → **ok 130.1s** (full
  package suite, no regression in the existing trial segmentation tests)
- `cargo check --workspace --all-targets` → clean, **zero warnings**
- `cargo fmt --all --check` → clean before and after both commits

### One pre-existing warning fixed, one left deliberately

- FIXED: `entitlements_tests.rs:154` unused `mut`. Proven pre-existing by diffing
  the function against `HEAD` (byte-identical, 20/20 lines). Removed because the
  file is in my commit and `dev-ci.yml` sets `RUSTFLAGS: -D warnings` with
  `cargo check --workspace --all-targets`, so leaving it would keep CI red on my
  account. Attributed in the commit body rather than passed off as my cleanup.
- LEFT: `apps/tablet-client/src/commands/subscription.rs:276` — the same unused-
  `mut` class, also pre-existing (file verified clean at HEAD). Not fixed: it is
  outside my scope, in the tablet caps owner's area (the comment above it names a
  "pre-existing gap owned by that command"), and editing it risks colliding with
  them. **This one still fails `dev-ci.yml#cargo-check` on `-D warnings`.**
  Someone who owns tablet caps should remove the `mut`.

### Git friction observed

The Rust commit hit `.git/index.lock` — a concurrent agent was mid-commit. Waited
for the lock to clear rather than deleting it (deleting a live lock can corrupt
their commit); it cleared immediately and the retry succeeded. That agent landed
`3f709237` (docs(ci): require a category justification for new scoped-coverage
allowlist entries) on top of my round-1 gate work, and `1cec6306` resynced the
multi-location key-count figure I flagged in round 1 — both open items from last
round are now closed by someone.

### Standing rules learned this round (read me before committing)

- **Journals are versioned** (supervisor ruling 2026-09-08, `f9a22948`): append the
  task entry to `coder-1-journal.md` and put it in the **same pathspec as the
  landing commit**. Do not leave it to a follow-up commit — that is what happened
  here only because the landing commits were already made and amending is forbidden
  on this shared branch. Getting it right the first time costs nothing.
- Two pre-existing `-D warnings` violations were found on this branch; one was
  fixed because it was inside a file already in my commit (`entitlements_tests.rs`),
  one was left for its owner (`apps/tablet-client/src/commands/subscription.rs:276`).
  Check `cargo check --workspace --all-targets` before blaming a red CI on new work.

### Open questions

1. Caps DTO + dev-mock still owed (above).
2. Should `subscriptions` carry `is_trial` so re-sign paths preserve trial state?
   That is a schema migration and therefore out of Phase C as designed.
3. The tablet `-D warnings` violation above — who owns tablet caps?

> Closed by someone else mid-round 3: `8244df55 fix(tablet): silence the
> pre-existing warning cargo-check fails on` took the tablet unused-`mut`.

---

## 2026-09-08 — finisher-C round 3: Entitlements Phase D1 LANDED (server-issued per-feature grants)

Branch `0.0.37` — no branch created/switched, no push. **This round landed
coder-1's uncommitted Phase D1 working-tree diff; that session died before it
could commit.** Every hunk below is coder-1's text committed faithfully —
nothing was rewritten, extended, or "improved" at landing time.

### Commits

| sha | subject | files |
|---|---|---|
| `1eb5b753` | `feat(licensing): accept per-feature grants in the signed payload` | 1 — `main.go` (+14/-0) |
| `abda8574` | `feat(core): parse per-feature grants from the signed payload` | 2 — `license_verification.rs` (+14/-0), `subscription.rs` (+69/-1) |
| *(this commit)* | `feat(licensing): honor per-feature grants in feature verdicts` | 3 — both clients' `commands/subscription.rs` (+17/-5 each) + this journal |

### What landed — the wire and the honour, not the authoring

- **Go** — `SubscriptionPayload.Features map[string]bool`, `json:"features,omitempty"`.
  `omitempty` is what keeps the change additive: a grant-free payload marshals
  byte-identically to a pre-D1 payload.
- **Rust parse** — `SignedSubscriptionPayload.features: HashMap<String, bool>` with
  `#[serde(default)]`; `TenantSubscription::payload_features()` /
  `payload_feature_grant()` read the block off the **signed payload column** —
  the `addons()` / `parsed_trial()` pattern: signature-covered, no migration.
  Unparseable payload / absent block / wrongly-typed value ⇒ NO override, so an
  unreadable block neither grants a feature nobody signed nor withholds one.
- **Both clients** — `server_grant_for` gained a second producer, checked FIRST:
  `sub.payload_feature_grant(feature.as_str())`. An explicit instruction
  outranks the inferred `allows_workspace_type` answer; when the payload is
  silent, producer 2 runs exactly as before, so every pre-D1 payload resolves
  identically. The resolver's `Some(false)`/`Some(true)` semantics already
  covered both directions — **no verdict DTO change, no dev-mock change, no
  new wire surface on the client side.**

Semantics per `todo-global-saas-2.md` §"Entitlement enforcement consolidation —
design", **Phase D**: absent key = the tier's own answer, `false` = withhold even
where the tier allows, `true` = grant beyond tier. One deliberate deviation from
the doc's prose: keys are the canonical `AvailabilityFeature::as_str()` wire names
(`"supports_analytics"`), not the doc's illustrative `"analytics"` — that example
is shorthand, the enum stays the single source of the key vocabulary, and an
unknown key is inert by construction.

### Gates — all green, all run BEFORE the commits

| gate | result |
|---|---|
| `gofmt -l .` (apps/license-server) | clean |
| `go vet ./...` | exit 0 |
| `go test -short -count=1 .` | **ok 111.041s** |
| `cargo test -p oz-core --lib subscription` | **130 passed / 0 failed** |
| `cargo test -p oz-core --lib entitlements` | **13 passed / 0 failed** |
| `cargo test -p oz-core --lib availability` | **13 passed / 0 failed** |
| `cargo test -p oz-pos-app --lib subscription` | **26 passed / 0 failed** |
| `cargo test -p oz-pos-tablet --lib subscription` | **6 passed / 0 failed** |
| `cargo fmt --all --check` | clean before and after both Rust commits |

### Two coordination calls worth keeping

1. **`crates/oz-core/src/subscription.rs` was a MIXED file** — coder-1's D1 block
   (+41) and coder-3's `SubscriptionTier::audit_retention_days` (+26) in one file.
   Git commits whole files, so exactly one commit had to carry the other's hunk.
   Ruling: the D1 commit takes the file, and its body carries an **attribution
   mirror** naming coder-3's hunk and its line range. The alternative — coder-3
   committing the file — would have filed 41 lines of entitlements work under an
   audit message, the R36-13 swept-commit failure mode.
2. **Ordering was inverted to keep the range compiling, not to accept a wart.**
   The audit slice hard-depends on that method (`entitlements.rs:164`,
   `db/audit.rs:167`), so an audit commit landing BEFORE this one would not have
   compiled at all. Landing D1 first means every commit in the range passes
   `cargo check` — the previously-accepted red-intermediate bisect wart is gone
   rather than papered over.
3. **`activate.go` carries no D1 diff** — verified clean, so it stayed out of the
   Go pathspec. `main.go` is the whole Go side of D1.

### OWED WORK — do not read this entry as "Phase D done"

- **The entitlements item's box in `todo-global-saas-2.md` stays open and this
  round did not touch that file at all.** D1 is the wire plus the honour; the
  phase is not complete.
- **No D1 tests exist anywhere.** coder-1 wrote none, and inventing them at
  landing time would have put words in a dead agent's mouth and collided with
  coder-3's `subscription_tests.rs` (whose diff is 100% audit content). The
  gates above are *regression* evidence, not *coverage* evidence: nothing
  asserts that `{"supports_analytics": false}` withholds analytics, that `true`
  grants beyond tier, or that an unreadable block fails silent. **Owed:** the
  fail-silent shapes in `crates/oz-core/src/subscription_tests.rs`, plus a
  client-verdict test in BOTH `apps/*/src/commands/subscription_tests.rs`
  proving producer 1 outranks producer 2.
- **D2 — server-side grant authoring.** No build site sets `Features` today:
  neither `license_keys` nor `subscriptions` has a field to flow it from, so no
  payload the live server emits carries the block. Enterprise custom contracts
  become payload authoring rather than tier proliferation only once D2 lands
  that source.
- **Caps DTO + dev-mock projection of trial/feature state** — still owed from
  Phase C, unchanged: `ui/src/dev-mock/tauri-api.ts` was HOT all round, so
  `get_subscription_capabilities` carries neither trial state nor any grant
  projection.

### Hot files respected (never edited, staged, or committed)

`.gitignore` · `crates/oz-core/src/service_health.rs` ·
`apps/desktop-client/src/commands/license.rs` (external connection-health WIP —
NOT to be confused with `subscription.rs`) · both clients' `staff_tests.rs` ·
both clients' `lib.rs` (coder-3's sweep daemons) ·
`crates/oz-core/src/lib.rs` + `db/mod.rs` (finisher-A's regional registration) ·
`entitlements.rs` · `subscription_tests.rs` · `db/audit*.rs` ·
`platform/core/src/settings/keys.rs` · `scripts/generate-pg-migration.py` ·
`ui/src/locales/shared.ftl` / `shared.id.ftl` · `ui/src/dev-mock/tauri-api.ts` ·
`ui/src/components/StatusBar.tsx` · `ui/src/hooks/{useAuthConnection,useSyncConnection,connectionHealth}.ts` ·
`ui/src/api/license.ts` · `ui/src/__tests__/*` · `coder-4-journal.md` ·
**`todo-global-saas-2.md`**.
