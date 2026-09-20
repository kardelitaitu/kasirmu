# Agent Lanes — parallel work without collisions

> The operating manual for running several lanes (human or agent) against this repo at
> once. Rules live in root `AGENTS.md`; this is how they are applied per lane.

## 1. What actually collides

Splitting by product area is the right first cut, but it is not sufficient. Measured on this
repo, 2026-09-20, in one afternoon:

| Class | What happened | Cost |
|---|---|---|
| **Chokepoint** | one lane added an IPC command; its registration, capability, census pin and allowlist entry were not in the same commit | static-gates red in 3 separate rounds, ~4 CI cycles |
| **Gate** | a command added by one lane failed a *global* gate, so it blocked every lane's merge | 8+ min per cycle, nobody could land |
| **Resource** | another session held `target/debug/kasirmu-app.exe`, so a test could not relink | a test that could not be run at all |
| **Environment** | a guard passed locally and failed in CI because only the local tree has `ui/dist` and `ui/node_modules` | one wasted CI cycle |

File collisions are the *least* common failure here. Chokepoints and gates are the expensive ones.

## 2. The lane map

| Lane | Owns exclusively | Shares (needs a lease) | Its own gate command |
|---|---|---|---|
| **Website** | `website/**` (incl. `public/admin`) | `ui/src/api/` only via a frozen contract | `cd website && npm run precheck` |
| **License server** | `apps/license-server/**` | env vars on the Northflank service | `go -C apps/license-server test -short ./...` |
| **Desktop shell** | `apps/desktop-tauri/**`, `crates/kasirmu-bridge/**` | the chokepoints in section 3 | `cargo check -p kasirmu-app` + the census test |
| **Tablet** | `apps/mobile-tauri/**` | the chokepoints in section 3 | `cargo check -p kasirmu-mobile` + the census test |
| **Core + schema** | `crates/kasirmu-core/**`, `migrations/**` | `init.pg.sql` is single-writer | `python scripts/verify-migration-column-types.py` |
| **Shared UI kit** | `ui/src/{components,features,theme,hooks,contexts}` | FTL bundles, both shells' registration | `cd ui && npm run check:all` |
| **Integrator** | `.github/**`, `scripts/**`, `.agents/skills/**`, `gates.json` | — | `bash scripts/check.sh` |

**Website and License server are the two genuinely independent lanes** — different build, different
deploy, no shared compile. Parallelise there first. The shells share one image and one command
registry, so they contend by construction.

## 3. The chokepoints

These files belong to everyone and therefore to no one. They are append-mostly, and a change to
one usually belongs with a change to another:

1. `apps/*-tauri/src/lib.rs` — `generate_handler!` registration
2. `apps/*/capabilities/*.json` — Tauri v2 permissions
3. `apps/desktop-tauri/tests/gate_audit.rs` — the pinned gate census
4. `scripts/ipc-parity-allowlist.json` — per-shell registration gaps, with reasons
5. `crates/kasirmu-core/migrations/20260813_init.pg.sql` — generated, never hand-edited
6. `.agents/skills/**` — read by the drift guard, so every path named is a claim

**Rule: a chokepoint change travels with its companions in ONE commit.** Check before you
commit:

```bash
git --no-optional-locks status --porcelain     # what is mine, what is someone else's
python scripts/check-chokepoints.py            # which chokepoints this diff touches, and what they need
python scripts/check-chokepoints.py --strict   # same, exit 1 on a missing companion
```

The checker runs the authoritative gate for each surface it recognises (`verify-ipc-parity.py`,
`generate-pg-migration.py --check`, `verify-bundle-parity.py`, the drift guard, the mirror
checker). It never re-implements their parsing, and it reports by default so it cannot block a
lane before it has earned trust.

## 4. Quick start

### A lane, from zero to a merged PR

```bash
# 1. isolate: your own worktree, your own target dir, so nobody's build locks yours
#    (DSH: create_worktree / checkout_worktree)
export CARGO_TARGET_DIR=<worktree>/.target

# 2. claim the files you are about to touch (claim = a snapshot; drift is then detectable)
bash scripts/wtree-guard.sh own apps/mobile-tauri/src/commands/data.rs

# 3. agree the contract BEFORE coding: command name + args, route + response fields,
#    FTL keys, tier names. Write it in the issue/PR description, not in your head.

# 4. code, then run YOUR lane's gate from section 2 -- not the whole matrix
npm run precheck            # (website)  |  cargo check -p kasirmu-mobile  (tablet)

# 5. prove nothing drifted under you, then commit ONE line with an explicit pathspec
bash scripts/wtree-guard.sh check
python scripts/check-chokepoints.py --strict
git commit -m "feat(mobile): add the backup destination picker" -- path/one path/two
```

### The manager's loop

1. **Assign lanes, not task fragments.** One lane owns a path prefix and one contract.
2. **Freeze the contract** before fan-out; a contract discovered mid-flight is the single
   biggest source of cross-lane churn on this repo.
3. **Lease the chokepoints.** One lane at a time may edit `lib.rs`, the censuses, the
   allowlists, `gates.json`, or `scripts/**`. Everything else runs in parallel.
4. **Triage every red gate first.** A red gate blocks all lanes, so it outranks any lane's
   feature work — and it is often not the diff that looks guilty (`agent-gates.md` section
   "check ownership before you believe it").
5. **Merge in dependency order**, one PR per lane, never lane-merges-lane.

### Worked example: adding an IPC command (the four-file rule)

Touch these together, or expect four CI cycles to tell you one at a time:

```
apps/<shell>-tauri/src/commands/<module>.rs   the command + its gate( call
apps/<shell>-tauri/src/lib.rs                 generate_handler! entry
apps/<shell>/capabilities/<shell>.json        the permission the UI needs
ui/src/api/<domain>.ts                         the wrapper the UI calls
apps/desktop-tauri/tests/gate_audit.rs         the census pin (count/keys per module)
scripts/ipc-parity-allowlist.json              only if the OTHER shell does not register it
ui/src/dev-mock/**                             the invoke target for local dev
```

## 5. Deliberately not automated (yet)

- **Registering the checker in `scripts/gates.json`.** `scripts/check-ui.mjs` requires every
  manifest gate to exist in `check:all`, so a registry entry is a three-file change, not one.
- **A new pre-commit step.** `.githooks/pre-commit` has seven sections and
  `scripts/verify-agents-mirrors.py` polices that count, its names, and the job list in the
  workflows. Promoting this checker means editing the hook, `gates.json`, `check:all`, the
  workflows and the two docs together — a deliberate change, not a side effect.
- **Lane-scoped CI.** Today one push runs `dev-ci.yml`'s eleven jobs including the full 9,922-test suite. That
  is the real ceiling on how many lanes can land per hour, and splitting it is the highest
  value follow-up on this page.

## 6. When a rule has to bend

- **Companion genuinely not needed**: accept it explicitly and say why in the commit message:
  `python scripts/check-chokepoints.py --ack census-pin`.
- **A red suite you cannot connect to your diff**: run the failing file alone before believing
  it; check `git status --porcelain` for another lane's live edit.
- **Two lanes want the same file**: the lease decides. Do not both edit; a pathspec commit
  records the whole working-tree file, including the other lane's in-flight hunks.
