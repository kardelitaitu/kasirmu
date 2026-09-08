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
