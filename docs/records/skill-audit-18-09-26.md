# Skill audit — `.agents/skills/` — 18-09-26

Auditor: Budak-Korporat. Branch `0.0.39`, HEAD clean at audit start.

## Status — repaired later the same session

Every HIGH and MEDIUM item below was **repaired** on 18-09-26 and **committed as
`c0b6a5599`** (13 files, +63/−62) once the concurrent peer edits cleared. 13 of 14 footers
were bumped to `18-09-26`; `database` kept its own 15-09-26 stamp as it needed no change.
Verified by re-grepping each target string, not by trusting the edit — the replacement
values were confirmed present, not merely the old ones absent. `detect.sh --check=paths`
and `--check=crates` both report **no drift** against the repaired tree.

One further item was found *during* repair and is not listed below:
`skill-drift-guard`'s Check 2 teaching snippet still grepped `oz-[a-z-]+` and
`ls crates | grep '^oz-'`, while the real `detect.sh:294-296` uses `kasirmu-` — the doc
taught the pre-rebrand pattern. Fixed, and its footer bumped, in the same commit.

Two items in the original pass were **wrong and are withdrawn**:

- §4 `@/locales/sales.ftl?raw` — **not drift.** `ui/vite.config.ts:53` aliases `@/locales/`
  to `../shared-ui/locales/`, so 165 `?raw` imports across the suite still resolve.
- §7 `skill-drift-guard` "ten checks" vs 11 taxonomy kinds — **not drift.** Check 2 covers
  taxonomy kinds 2 and 3 together, so 10 checks over 11 kinds is correct.

Left in place deliberately: `.agents/skills/__drift_probe__/` is another agent's live
`dead-check-regression.bats` fixture, not drift.

Method: ran the repo's own drift detector, then read all 14 `SKILL.md` files and
verified their load-bearing claims against the tree. Claims below were **measured**,
not inferred from another document.

## 0. The detector's verdict, and why it is not trustworthy on its own

`bash .agents/skills/skill-drift-guard/scripts/detect.sh` → **"No drift detected"**,
exit 0, 5m00s. Every finding in this report was nonetheless still live.

That is not a broken script, it is a **coverage gap**. The taxonomy (11 kinds) checks
paths, crate membership, the `Money` API, dependency versions, golden-rule phrasing,
cross-references, Fluent ids and audit dates. It has no check for: crate-name-prefix
conventions, version-lock numbers, CI job counts, workflow trigger truth, prose module
counts, moved locale directories, or repo-policy text. All the high-severity drift below
falls into those unpoliced classes.

Liveness was confirmed rather than assumed (the guard's own pitfall #10): Check 1 fired
correctly on an injected nonexistent crate path in a throwaway probe skill, and the full
`bats` suite passed **16/16, EXIT=0** — including the five `dead-check-regression` cases
that each inject drift and assert a formerly-dead check fires, and the structural case
that fails `detect.sh` if any `FINDINGS`-accumulating loop is ever pipeline-fed again.

> **Correction.** An earlier revision of this paragraph claimed the suite "did not
> complete within the session (1 of 16 tests)". That was wrong: I sampled the output file
> while the run was still in flight and mistook a partial read for a reaped process. The
> run finished green. Stated here because a reaped-suite claim would understate how much
> liveness evidence exists — and because an audit that reports its own tooling as
> unverified when it is verified is its own kind of drift.

Two structural blind spots worth fixing:

- **Check 2 compares the union** of `kasirmu-*` tokens across *all* skills against the
  workspace members, so a crate absent from *one* skill's inventory is invisible.
- Anything spelled `oz-*` is now invisible to Check 2, which only greps `kasirmu-*`.
  The rebrand made the crate check blind to exactly the drift the rebrand created.

Also: the repo-root `skill-drift-report.md` is a **gitignored generated artifact**, not
source. The copy on disk named Fluent id `zz-probe-absent-key`, which exists in no
skill — a leftover from someone's probe run, not real drift.

## 1. HIGH — the `oz-*` → `kasirmu-*` rebrand never reached the skills

All 17 workspace crates are `kasirmu-*` (plus `qris-core`). No `crates/oz-*` exists.
An agent that obeys these lines creates wrongly-named crates or hunts for files that
were renamed years of releases ago.

| Skill | Line(s) | Claim |
|---|---|---|
| `project-scaffold` | 120–129, 174, 32, 360 | `cargo new --lib oz-<name>`, `name = "oz-<name>"`, `use oz_<name>::Type`, "One crate per `oz-*` responsibility", "follow the `oz-<name>` naming" — **instructs creating a bad crate** |
| `tauri-ipc` | 40, 129 | `oz_pos_lib::run()` — actual is `kasirmu_app_lib::run()` (`apps/desktop-tauri/src/main.rs:11`) |
| `onboarding-guide` | 53 | router row: "any `oz-*` crate" |
| `rust-backend` | 3, 15 | frontmatter **description** and "When to use" |
| `tdd` | 3, 46, 231 | description, Phase 1, per-layer table |
| `docs-auditor` | 260 | cross-skill protocol |
| `pr-create-pull-request` | 86 | "the `oz-*` crates under `crates/`" |
| `codebase-memory` | 616 | "every `oz-*` token must resolve to a workspace crate" |

Note on `pr-create-pull-request`: its own audit stamp records that rev 3 "respells that
phrase so the skill-drift scanner's crate-name grep no longer reads it as a missing
crate". The drift was disguised to pass the scanner rather than fixed.

## 2. HIGH — version lock quoted as `0.0.37`; branch and lock are `0.0.39`

- `pr-create-pull-request:31` golden rule "Version is locked at `0.0.37`"; title
  examples at :26, :99–:101 all `0.0.37 …`; stamp still says "corrected 0.0.31 → 0.0.35".
  A PR opened from this skill gets the wrong branch prefix.
- `pr-repair:31` — same golden rule, same stale number.
- `tdd:152` — "As of 0.0.37 there are seven" gates (`project-scaffold` says 0.0.39).

## 3. HIGH — `project-scaffold` is wrong about the CI workflow

- :30 "`dev-ci.yml`'s **ten** jobs" — actual **11** (`release-bridge-test` added).
- :111 / :235 / :350 "the ONE active workflow", "every other workflow file … is a
  dormant `*.yml.bak`" — **`release.yml` is live** (3 jobs: `release-validate`,
  `release-build`, `release-publish`) and the `.bak` files are in
  `.github/workflows/attic/`, not at `.github/workflows/*.yml.bak`.
- :259 "the workflow has no push trigger, so that half is dead code the file's own
  comment at L647 admits to" — **false**. `on.push.branches: [main]` is at :6–7, and
  `dev-ci.yml`'s comment now reads *"What used to be claimed here is false"*. This tells
  an agent that push-to-main cannot trigger a deploy when it can.
- :259 northflank "excludes `ci-docs-drift` and `release-readiness`" — also excludes
  `release-bridge-test` (three, not two).
- :259 "the `if:` at `dev-ci.yml:653`" — the block is at ~:714–722.

Verified unchanged: `needs` really is 7 jobs; Node really is pinned to 24;
`OZ_TEST_PG_URL` is still `OZ_`-prefixed.

## 4. MEDIUM — UI paths invalidated by the P9a `.ftl` move

54 `.ftl` files now live in `shared-ui/locales/`. `ui/src/locales/` **does not exist**.

- `ui-components:369` folder diagram still shows `ui/src/locales/`.
- ~~`ui-components:319` `import salesFtl from '@/locales/sales.ftl?raw'`~~ — **withdrawn**,
  the `@/locales/` alias resolves it; see Status above.
- `ui-components:317` `@/locales/test-utils` — actual is `ui/src/i18n/test-utils.tsx`
  (no `shared-ui/locales/test-utils` exists, and the alias would send it there).
- `ui-components:245` vs `:373` **contradict each other** on `tokens.css`: line 245 is
  right (`ui/src/theme/tokens.css`), line 373 says `frontend/themes/`.
- `exit-animation-pattern:252` repeats the same dead `frontend/themes/tokens.css` path.
- `ui-components:308` "417+ files" in `ui/src/__tests__` — actual **297** `.test.tsx`
  (552 including `.test.ts`).

## 5. MEDIUM — counts and inventories

- `tauri-ipc:48` "~47 modules" under `commands/` — actual **64** non-test modules
  (70 `.rs` incl. 6 `*_tests.rs`).
- `project-scaffold:77–85` crate inventory omits `kasirmu-bridge`, `kasirmu-lan`,
  `kasirmu-local-api`, `qris-core`. Invisible to Check 2 (see §0).
- `hal-drivers:56` layout diagram says `transport/bluetooth.rs`; actual is
  **`transport/tcp.rs`**, and no `bluetooth.rs` exists. The skill's own audit stamp says
  `tcp` — stamp right, diagram wrong.
- `codebase-memory:103` root path `C:/dev/ozpos/0.0.35/oz-pos` — **does not exist**
  (root is `C:/dev/ozpos`). `:104` "Indexed branch `0.0.37`" — branch is `0.0.39`.
- `pr-repair:35` golden rule 9 "38+ jobs taking 15–25 minutes" is contradicted by
  `:80` in the same file (11 jobs, no OS matrix); `:80` also says "`release.yml` adds 5
  more" — it adds 3.
- `onboarding-guide:145` "ask Buffy (the AI agent)" — the agent is Budak Korporat.

## 6. MEDIUM — `pr-repair` violates repo policy and contradicts its own stamp

- `:245` instructs `git add <repaired_files>`. `AGENTS.md` forbids `git add`; the
  sanctioned form is a pathspec commit.
- Its stamp claims `poll-pr-checks.ps1` was corrected to the `.sh` because "no .ps1
  exists" — **`scripts/poll-pr-checks.ps1` exists now**.

## 7. LOW / cosmetic

- `database:152` cites `schema_migrations` DDL at `platform/core/src/database/migrations.rs:174-178`;
  actual `CREATE TABLE` spans :177–181.
- `database` stamp says whitelist at `:109-170`, body says `:142-170`. Body is right.
- ~~`skill-drift-guard` says "ten checks" while its taxonomy has 11 kinds~~ — **withdrawn**,
  Check 2 covers kinds 2 and 3, so 10 checks is right.
- `docs-auditor`'s stamp closes with `)>` rather than `-->`; documented in-file as
  intentional and benign.

## 8. Verified accurate (no action)

- `database` — every count and line number spot-checked holds: 58 registry entries,
  59 `.sql` files / 58 non-`.pg.sql`, `pub const ALL` at `:43`, PRAGMA block :352–362,
  `resolve_db_path` at :757, whitelist 12 entries at :142, generator DST `:66` and
  `--check` at `:611`.
- `rust-backend` — `Money`/`Currency(pub [u8;3])`, `zero`/`from_major`/`checked_add`
  all `#[must_use]` and `Option`-returning as documented; `formatMoney` present; all
  four cited paths exist.
- `hal-drivers` — all 6 traits, 14 drivers, `bootstrap/registry/error/types.rs`, and
  all 9 `HalError` variants including `Timeout(u32)` and `Unsupported(String)`.
- `exit-animation` — all 4 commits resolve, all cited CSS classes exist,
  `ui/src/utils/animation.ts` present.
- `tdd` — `[profile.tdd]` present in root `Cargo.toml`; all 7 scripts and
  `docs/records/JOURNAL.md` exist.
- All 14 footers are correctly formatted (`> last audited DD-MM-YY by X`) and none is
  older than 30 days (oldest 03-09-26).

## 9. Recommended order of repair

1. `project-scaffold` §3 (CI) — the deploy-trigger claim is the only one that can cause
   a production mistake.
2. `project-scaffold` + `pr-*` + `tdd` + `rust-backend` naming — 8 files, mechanical.
3. `ui-components` / `exit-animation-pattern` locale + token paths.
4. Add drift checks for the unpoliced classes in §0 before trusting a green run again.

---

> last audited 18-09-26 by Budak-Korporat
