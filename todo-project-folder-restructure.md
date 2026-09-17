# todo-project-folder-restructure.md — Repository layout cleanup

<!-- Status: PROPOSED — nothing in this file has been executed.
     Every count below was measured 2026-09-17 against this checkout on branch `0.0.39`, and the
     command that re-derives it sits beside the number. Counts in this tree move continuously
     (parallel sessions land tests and crates hourly), so re-run before trusting.
     NOTE: a `git grep` pattern that STARTS with `@/` silently returns 0 matches here
     (`git grep -lF '@/components'` -> 0, while `git grep -lF "from '@/components"` -> 170 on the
     same tree). Always measure UI import counts with the `from '@` prefix, or as a bare substring.
     Naming: the `todo-` token in this filename is what exempts the page from
     `.agents/skills/docs-auditor/scripts/check-dead-refs.py` — do not "tidy" it away.
     Version is locked at 0.0.39; this plan moves files and never bumps a version. -->

## Legend
- `[ ]` not started
- `[/]` in progress
- `[x]` done

---

## 1. Overview

The five-tier Rust workspace (`foundation/` → `platform/` → `modules/` → `crates/` → `apps/`) is
sound and deliberately structured; `Cargo.toml` documents the glob-vs-explicit member split and it
should be left alone. What is *not* sound is everything around it: the UI has two competing shared
component libraries, `ui/src/frontend/` is a half-built scaffold whose name describes nothing, the
repo root has accumulated files that belong in directories, and both architecture documents describe
a tree that no longer exists.

**Goal.** One directory per tier, each containing only that tier's kind of thing, with no duplicates.

**Principles.**
1. A directory names its tier and holds only that tier's kind of thing.
2. No empty scaffolding — a directory created for planned structure that was never populated is what
   produced the current `ui/src/frontend/` ghost.
3. A move must earn itself by (a) killing a duplicate, (b) making a tier uniform, or (c) removing a
   statement that is false. Otherwise it is declined (§4).

4. **The Rust core must stay usable by a UI toolkit that does not exist yet.** Planned: Tauri v2 for
   Windows/macOS/Linux/Android/iOS today, Slint for Raspberry Pi next year, Slint for all OS as the
   endgame. This is why the plan is designed so that **either** endgame works (React+Tauri coexisting
   with Slint, or Slint replacing React) — see P9–P11.

**Scope.** Files and directories only. No crate renames, no version changes, no branch changes.

---

## 2. Target tree

Legend: `←` marks where a directory's contents come from. `(Pnn)` names the phase that performs the
move. Directory names shown are the **target** names, i.e. after the phase that renames them.
Everything unmarked stays exactly where it is.

```
kasir.mu/
├─ apps/                     # deployable PROCESSES + UI shells
│   ├─ desktop-tauri/        # ← desktop-client/  — Tauri v2, pkg `kasirmu-app`      (P11)
│   │   ├─ src/              #     thin #[tauri::command] shims → kasirmu-bridge
│   │   ├─ capabilities/     #     default.json
│   │   ├─ icons/            #     .ico + .icns + png ladder        ← per-OS asset
│   │   ├─ gen/schemas/      #     committed Tauri schema (no CLI needed to build)
│   │   └─ tauri.conf.json   #     bundle.targets="all" → MSI/NSIS + .deb/.AppImage + .dmg/.app
│   ├─ mobile-tauri/         # ← tablet-client/   — Tauri v2, pkg `kasirmu-tablet`  (P11)
│   │   ├─ src/              #     thin shims → kasirmu-bridge
│   │   ├─ capabilities/     #     default.json + mobile.json (split into android.json +
│   │   │                    #       ios.json when iOS lands, per P11)
│   │   ├─ gen/android/      #     42 tracked files — THE per-OS directory: manifest,
│   │   │                    #       MainActivity.kt, build.gradle.kts, keystore block
│   │   └─ tauri.conf.json   #     android.minSdkVersion 26
│   ├─ cloud-server/         #   axum HTTP API — pkg `kasirmu-cloud`
│   ├─ license-server/       #   Go (go.mod, no Cargo.toml) — stays, release.yml builds it
│   └─ unified/              #   container glue: Caddyfile, supervisord.conf — no Cargo.toml
│
│   # A Slint shell will get its own directory here — for the TOOLKIT, not for the Raspberry Pi.
│   # Do not create it empty: that is how ui/src/frontend/ became a ghost (principle 2).
│   #
│   # Where per-OS difference actually lives — never a shell-named directory (see P11):
│   #   #[cfg(target_os)]  → kasirmu-logging/{lib,eventlog}.rs · kasirmu-security/lib.rs   (3 files)
│   #   target deps        → [target.'cfg(…)'.dependencies] in security / logging / core manifests
│   #   tauri.conf.json    → bundle.targets · bundle.windows.nsis.installMode · android.minSdkVersion
│   #   delivery           → gen/android · ops/packaging/linux/deb/ · ops/install/win/ · ops/docker/
│
├─ foundation/               # unchanged — 1 crate, flat src/
├─ platform/                 # unchanged — core, kernel, startup, sync
├─ modules/                  # unchanged — the 14 verticals
├─ crates/                   # unchanged — the 17 libraries
│
├─ shared-ui/                # NEW — assets no UI toolkit owns (P9)
│   ├─ locales/              # ← ui/src/locales/  (56 .ftl, ~9,841 message definitions, en+id)
│   └─ tokens/               # ← token VALUES lifted out of tokens.css (deferred half of P9)
│                            #   (NOT created empty — see P9 staging and principle 2)
│
├─ ui/                       # the React + Vite binding (one toolkit's frontend)
│   ├─ index.html            # unchanged — <script src="/src/main.tsx">  (so main.tsx stays put)
│   ├─ index.tablet.html     # unchanged — <script src="/src/main.tablet.tsx">
│   └─ src/
│       ├─ app/              # ← frontend/shell/        (11 files + 1 subdir)
│       ├─ components/       # ← components/ (55, survives) MERGED WITH frontend/shared/ (22)
│       ├─ theme/            # ← frontend/themes/       (CSS binding only — values lift in P9)
│       ├─ registries/       # ← platform/ui/           (4 files: page/menu/widget registry + icon)
│       ├─ api/              # unchanged (51 files)
│       ├─ features/         # unchanged (35 dirs + index.ts barrel)
│       ├─ hooks/ utils/ contexts/ types/ i18n/ test-utils/ dev-mock/ __tests__/
│       ├─ App.tsx           # unchanged
│       ├─ main.tsx          # unchanged — Vite entry, referenced by index.html
│       └─ main.tablet.tsx   # unchanged — referenced by index.tablet.html
│       #   DELETED: frontend/ · platform/   (both emptied by the moves above)
│       #   MOVED OUT: locales/ → shared-ui/locales/ (P9a) — the .ftl corpus serves any toolkit.
│       #   i18n/ STAYS: it is the @fluent/react binding, which is React-specific.
│
├─ ops/                      # NEW tier — everything that builds, ships or installs; never code
│   ├─ docker/               # ← Dockerfile.server, Dockerfile.unified,
│   │                        #   docker-compose{,.prod,.pg,.e2e,.override}.yml
│   ├─ install/              # ← install/          (install.sh, uninstall.sh, README.md, win/)
│   ├─ packaging/            # ← packaging/        (debian maintainer scripts + .desktop entry)
│   └─ gateway/              # ← gateway/          (Caddyfile.example)
│
├─ prototypes/               # ← dev/              (KDS PWA prototype: kds-pwa/, app.js, sw.js…)
│
├─ docs/                     # unchanged 15 subdirs, PLUS:
│   └─ plans/                #   NO CHANGE — the root .md files are the owner's working files
│                            #   and stay at the root (P5 withdrawn). Includes this file and
│                            #   DSH.md, which is also a root-name tool contract
│
├─ website/                  # unchanged (separate Cloudflare deploy, 208 tracked files)
├─ scripts/                  # unchanged (165 tracked files)
├─ assets/  fuzz/            # unchanged — fuzz/ stays workspace-excluded on purpose
│
├─ .github/workflows/        # 2 live: dev-ci.yml, release.yml
│   └─ attic/                # ← the 13 inert *.yml.bak files
│
└─ <root files>              # see §5 — only what a tool looks up BY NAME at the project root,
                             # plus the four human entry points
```

---

## 3. Work items

### [x] P1 — Merge the two shared component libraries

**Commit:** `refactor(ui): merge frontend/shared into components`
**Pathspec:** `ui/src/components ui/src/frontend/shared` + the rewritten importers

This is the only true duplicate in the repository, and it is the highest-value item here.

- `ui/src/components/` — 55 files, imported by **170** files (`git grep -lF "from '@/components"`).
- `ui/src/frontend/shared/` — 22 files, imported by **205** files (`git grep -lF "from '@/frontend/shared"`).
- **11 basenames collide and not one is byte-identical**: `Badge.tsx`, `Card.tsx`, `EmptyState.tsx`,
  `ErrorState.tsx`, `Input.tsx`, `Localized.tsx`, `Modal.tsx`, `PermissionDenied.tsx`, `Skeleton.tsx`,
  `Spinner.tsx` and `PermissionDenied.css`. Divergence size, from `diff` line counts: `Modal` 91,
  `EmptyState` 82, `ErrorState` 74, `Skeleton` 55, `Spinner` 55, `PermissionDenied.tsx` 46, `Card` 34,
  `Localized` 16, `Badge` 11, `Input` 2, `PermissionDenied.css` 14 (65 vs 77 lines).
- The **11** files unique to `frontend/shared/` — `ContextMenu.{tsx,css}`, `LoadingStatus.{tsx,css}`,
  `SettingsPopup.{tsx,css}`, `Toast.tsx`, `index.ts`, `requiredLocalized.ts`, `useContextMenu.ts`,
  `useSound.ts` — fold in unchanged. (`useSound.ts` is consumed by the KDS screen, so this directory
  is live, not vestigial.)

**Decision:** `components/` survives as the name and location. This is the low-churn direction —
the 170 `@/components` importers do not move at all, only the 205 `@/frontend/shared` importers get
rewritten. (`ARCHITECTURE.md` currently declares `frontend/shared/` the target; that line becomes
wrong under this plan and is corrected in P7.)
**Acceptance:** `git grep -lF "from '@/frontend/shared"` → 0 · `test ! -d ui/src/frontend/shared` ·
`cd ui && npm run typecheck && npm run test`

### [x] P2 — Fold `frontend/` and `platform/` out of `ui/src`

**Commit:** `refactor(ui): replace frontend/ and platform/ with app/, theme/, registries/`

- `frontend/shell/` (11 files) → `app/` — **43** files import `@/frontend/shell`.
- `frontend/themes/` (5 files) → `theme/` — **44** files reference the path, but **0** via the TS
  alias, because they reach it on the filesystem and from CSS: 4 test files resolve
  `../frontend/themes/tokens.css` / `components.css` by `resolve(__dirname, …)`, so those constants
  move too, plus any CSS `@import` chain.
  **This phase moves the CSS binding only.** The token *values* are a cross-toolkit asset and lift
  out of `ui/` under P9 — do not settle them deeper inside React than they already are.
- `platform/ui/` (4 files) → `registries/` — **55** files import `@/platform/ui/…`.

`frontend/` inside a frontend names nothing, and `platform/` is a 4-file directory that shadows the
Rust `platform/` tier. `ARCHITECTURE.md` also places these registries a level away from where they
actually are (`ui/src/platform/` vs the real `ui/src/platform/ui/`).
**Acceptance:** `test ! -d ui/src/frontend && test ! -d ui/src/platform` ·
`cd ui && npm run typecheck && npm run lint && npm run test`

### [x] P3 — Consolidate the build/ship surface into `ops/`

**Commit:** `refactor(ops): move docker, install, packaging and gateway under ops/`

7 docker files at the repo root (`Dockerfile.server`, `Dockerfile.unified`, and five
`docker-compose*.yml`) plus three singleton directories (`install/` 6 tracked files, `packaging/` 5,
`gateway/` 1).

**Measured cost.** Compose-file referrers: `scripts/dev-up.sh` (4 hits), `scripts/run-e2e.mjs` (8),
`ui/e2e/playwright.config.ts` (1). Dockerfile referrers: `scripts/check.sh`, `scripts/gates.json`,
`scripts/bump-version.ps1`, `scripts/verify-docker-*.sh` (3), `scripts/verify-dockerfile-workspace.py`,
`.github/workflows/dev-ci.yml`, `.github/workflows/release.yml`, `docs/operations/docker-deployment.md`.
`install/` is additionally built by the LIVE `.github/workflows/release.yml`; `gateway/Caddyfile.example`
is referenced by `apps/unified/Caddyfile`.
**Acceptance:** `test ! -f docker-compose.yml && test ! -f Dockerfile.server` ·
`bash scripts/verify-docker-all.sh` · `python scripts/verify-dockerfile-workspace.py` · `npm run e2e`

### [x] P4 — Move the inert workflows to `attic/`

**Commit:** `chore(ci): move retired workflow backups into attic/`

`.github/workflows/` holds **2 live** files (`dev-ci.yml`, `release.yml`) and **13 `*.yml.bak`**
files (`android`, `ci`, `deploy`, `docker-digest-drift`, `docker-persistence`, `e2e-pr`, `ios`,
`nightly`, `release`, `security`, `website`…). 87% of the directory is retired, which makes any
audit of "what does CI run" start with a wrong answer.
**Acceptance:** `ls .github/workflows/*.yml | wc -l` → 2 · `ls .github/workflows/attic/*.bak | wc -l` → 11 (as measured at line 509 — two of the 13 names this phase originally listed never existed on disk)

### [x] P5 — WITHDRAWN: the root `.md` files stay where they are

**Decided 2026-09-17 by the repository owner.** The root markdown files are the owner's own working
files, so this plan neither moves nor renames nor deletes them. The phase number is kept rather than
reused so P6–P13 do not shift.

What this drops: an earlier draft relocated `done-todo-rebrand.md`, `todo-rebrand-2.md`,
`todo-open-debt-program.md` and `todo-review-type.md` into `docs/plans/`, on the reasoning that root
should hold only tool contracts. **The reasoning was wrong about the objective** — these are live
working documents that the owner opens constantly, and a plan doc's value is that it is at hand, not
that the root is tidy. `todo-rebrand-2.md` (a live Tier-3 checklist) and
`todo-open-debt-program.md` (unresolved debt) are in active use.

The one durable constraint if they are ever moved later: the `todo-`/`plan-`/`prd-` token must stay **in
the filename**, because that substring is what `check-dead-refs.py` exempts. Renaming these files breaks
that exemption even in place.
**Acceptance:** nothing to run — the deliverable is that the files did not move.

### [x] P6 — `dev/` → `prototypes/`

**Commit:** `chore(repo): rename dev/ to prototypes/`

`dev/` is not a dev-tooling directory; it is a KDS PWA prototype (`kds-pwa/`, `app.js`, `sw.js`,
`kds-prototype-server.bat`) — 10 tracked files. The name promises tooling it does not contain.

**Note the real smell this exposes:** 4 product files in `ui/src/features/kds/`
(`KdsCompletedView.tsx`, `KdsLayoutMasonry.tsx`, `KdsScreen.css`, `components/KdsTicketCard.tsx`) plus
`ui/src/__tests__/themeTokenCompliance.test.ts` reference the prototype. Product code should not
point into a prototype directory — those references should become a documentation link.
**Acceptance:** `test ! -d dev` · `cd ui && npm run typecheck && npm run test`

### [ ] P7 — Rewrite the two architecture docs against the final tree

**Commit:** `docs(agents): reconcile README and ARCHITECTURE with the current tree`

Both live pages describe a repository that no longer exists, and both should be rewritten **once**,
after P1–P6 land, rather than patched twice.

- `README.md` Repository Structure lists 16 stale crate names (`oz-api`, `oz-bridge`, `oz-core`, …)
  while every directory under `crates/` is `kasirmu-*`; `git grep -l "use oz_" -- "*.rs"` → **0**.
- `ARCHITECTURE.md` titles itself "OZ-POS Architecture", roots its tree at `oz-pos/`, and states
  "35 members / 13 crates" where `cargo metadata --no-deps` reports **39 packages** and
  `ls -d crates/*/` reports **17**.
- Rebrand prose tail, for whoever owns Tier 3 (`todo-rebrand-2.md`): **245** files still mention
  `oz-pos` and **243** mention `OZ-POS` (`git grep -l -F`), the README badges point at
  `kardelitaitu/oz-pos`, and `Cargo.toml` carries `# TODO: update after repo rename`.
**Acceptance:** `git grep -nF "35 members" ARCHITECTURE.md` → nothing · every crate named in the
README Repository Structure exists on disk

### [x] P8 — Clear the invisible junk pile and add a root gate

**Commit:** `chore(repo): clear root scratch artifacts and gate the repo root`

See §5 Pile C. All of it is already gitignored, which is precisely why it survives: `git status`
stays clean, so nothing ever prompts a look. On a branch where several agents commit in parallel,
clean status output is a coordination primitive — `.gitignore` says so in its own comments.

Then add the gate, so the root cannot regrow: a script that fails when the root gains a file outside
an allowlist (§5 Pile A + the four entry points), plus the empty-directory sweep — because
**`find` is the only detector for that class** (see §5).
**Acceptance:** `node_modules` gone · `git status --porcelain --ignored=matching | grep -c '^!![^/]*$'` lower than 9 ·
the new gate exits 0 on a clean root and non-zero when a stray file is added

### [ ] P9 — Lift the toolkit-neutral assets out of `ui/`

**Commit:** `refactor(ui): move the Fluent corpus out of ui/ into shared-ui/locales`

Everything in this phase is already treated as a repo-level asset; the directory just says otherwise.
Staged, because the two halves have very different costs — do not build the second half before a
second toolkit exists (principle 2).

**P9a — the Fluent corpus (do this now).** `ui/src/locales/` holds **56** `.ftl` files (27 en +
27 id) with ~9,841 message definitions, and **12+ repo-level files already read that path** —
`.githooks/pre-commit`, `.githooks/pre-push`, `.github/workflows/dev-ci.yml`, `scripts/lint-i18n.sh`,
`dedupe-ftl.py`, `scan-fluent-hardcoded.py`, `scan-locale-crossings.py`, `check.sh`,
`convert-safe-attr-ftl.py`, `test-ci-routing.sh`, `test-ui-changed.sh`, `bump-version.ps1`. `.ftl` is
plain data (Fluent ships Rust bindings too), so a Slint frontend can consume the identical corpus —
the translation work is the most expensive thing in the UI and it is already toolkit-neutral. The move
is a `git mv` plus path edits in those ~12 files.

**P9b — token values (DEFERRED, until a second toolkit needs them).** `tokens.css` is CSS with
custom properties; lifting the *values* into a generated source is real work, because it touches the
five CSS walker suites (`docs/frontend/css-verification.md`), `scripts/scan-css-tokens.py`,
`fix-non-existent-tokens.py`, `check-font-bundle.mjs`, and the a11y contrast tests. Recorded here so
the intent is not lost; not scheduled.
**Acceptance (P9a):** `test ! -d ui/src/locales` · `bash scripts/lint-i18n.sh` exits 0 ·
`python scripts/verify-ftl-orphans.py` exits 0 · `cd ui && npm run typecheck && npm run test`

### [/] P10 — Make the platform tier reusable by a non-Tauri shell

**Commit:** `refactor(platform): remove the tauri dependency from platform-startup`

**P10a — two call sites (small, high leverage).** `platform/startup/Cargo.toml:45` declares
`tauri = { workspace = true }` unconditionally, and it is used in exactly two places —
`platform/startup/src/lib.rs:264` and `:268`, both `tauri::async_runtime::spawn`. That crate owns
module registration and event wiring, so **today a Slint shell cannot reuse it at all** without
dragging in Tauri, GTK and WebKit. Two spawns are the entire barrier. This is the cheapest
high-value change in the plan.

**P10b — converge the two `AppState` copies (large; blocks a third shell).**
`crates/kasirmu-bridge` is toolkit-free by documented contract — *"no tauri, gtk or webkit type may
ever be added here"* — and `BridgeCtx` even defines its own object-safe stand-in for `tauri::Emitter`
plus explicit `None` paths *"in headless/tests without an AppHandle"*. But the context it borrows is
shell-owned: `apps/desktop-client/src/state.rs` is **894** lines and `apps/tablet-client/src/state.rs`
is **570**, **909 diff lines apart**. The extraction frontier is therefore `AppState`, not the command
bodies — **67 of 70** files under `apps/desktop-client/src/commands/` already reference
`kasirmu_bridge`. Adding a third shell today means adding a third divergent copy.
**Acceptance (P10a):** `grep -c tauri platform/startup/Cargo.toml` → 0 ·
`grep -rn tauri platform/startup/src/*.rs` → nothing ·
`cargo check -p platform-startup` · `cargo check --workspace --all-targets --all-features`

**P10a completed 2026-09-17** (commits `74856ee78` + `49a65a440`). Every acceptance line re-measured:
`grep -c tauri platform/startup/Cargo.toml` → **0**; `grep -rn tauri platform/startup/src/*.rs` → **no
match**; `cargo check -p platform-startup` → exit 0; `cargo check --workspace --all-targets
--all-features` → exit 0; `cargo test -p platform-startup --lib` → **79 passed / 0 failed**.
`Cargo.lock` lost exactly one line (`"tauri",` from `platform-startup`'s dependency list).

**How the two spawns were replaced.** The crate now owns the runtime it needs: a lazily built
multi-thread Tokio runtime (`daemon_runtime()`), used only when there is no ambient runtime. A new
private `spawn_detached` prefers `tokio::runtime::Handle::try_current()` and falls back to that
runtime. That preserves the property the old comment recorded — the call stays safe from a synchronous
`setup` hook, where a bare `tokio::spawn` would panic — and keeps the watchdog on the same runtime as
the daemon it watches, because by then an ambient handle exists. The returned `JoinHandle` is dropped
deliberately: nothing joins a daemon. The 22 daemon spawn sites are unchanged; what moves is the
runtime they land on.

**The gate half is closed too, and that is the load-bearing part.** §4 records that
`bridge-toolkit-purity` inspected only `crates/kasirmu-bridge` while `platform/startup` sat outside it,
so the one real renderer coupling in the platform tier was invisible to the rule that declares it must
not exist. `49a65a440` widens the rule to the four renderer-agnostic roots, reusing the
`UI_VOCABULARY_ROOTS` population `ui_vocabulary_findings` already walks. It lands **green**:
`python scripts/verify-architecture-boundaries.py` → exit 0, 8 tracked / 0 new blocking, with the
scanned population up from **136 to 938** files. That `platform/startup` was the *only* offender across
all four roots was measured **before** widening — every other manifest under `crates/`, `modules/`,
`platform/` and `foundation/` is already toolkit-free — which is why the widening needed no baseline
entry and therefore no expiry debt. Two tests were added
(`scripts/__tests__/verify-architecture-boundaries.test.mjs`, now **27 passed / 0 failed**): one plants
the offence in `modules/tax`, so the widening is provably not a no-op (the pre-existing case only ever
planted in `crates/kasirmu-bridge`), and one asserts the clean direction for the two roots newly
covered.

**P10b remains unscheduled** (§6), which is why this phase is marked in progress rather than complete.

### [x] P11 — Name the shells by form factor + toolkit, and put per-OS config one level down

**Commit:** `refactor(apps): rename shells by form factor and toolkit`

Two device-named directories collide with the roadmap: once a Slint desktop build exists, neither
`desktop-client` nor `tablet-client` identifies a shell, because the differentiator is *toolkit ×
form factor*, not *OS*.

| Today | Rename to | Why |
|---|---|---|
| `apps/desktop-client/` | `apps/desktop-tauri/` | keeps the form factor, names the toolkit — and the name carries its own retirement date under the Slint endgame |
| `apps/tablet-client/` | `apps/mobile-tauri/` | **`android` would be wrong**: the docs describe this shell as Android + iPad, and it already carries `capabilities/mobile.json` (OS-neutral) plus a retired `ios.yml` workflow |

**Each OS will not get its own app directory, and does not need one.** Per-OS divergence already has
four homes, none of them the shell directory:

1. `[target.'cfg(… )'.dependencies]` in crate manifests — `kasirmu-security` (windows / macos /
   linux), `kasirmu-logging` (linux / windows), `kasirmu-core` (wasm32 negation).
2. `#[cfg(target_os = …)]` in crate source — `kasirmu-security/src/lib.rs`,
   `kasirmu-logging/src/{lib.rs,eventlog.rs}`. Notably **zero** occurrences in either app shell:
   the shells contain no OS-conditional Rust today.
3. `tauri.conf.json` fields — `bundle.targets`, `bundle.windows.nsis.installMode`,
   `android.minSdkVersion`, per-shell `icons/` and `capabilities/`.
4. The delivery layer — `gen/android` (committed scaffold), `packaging/` (Debian maintainer scripts),
   `install/win/`, `install/install.sh` — all of which P3 relocates under `ops/`.

So OS naming belongs one level *below* the shell, where Tauri already puts it: today's
`capabilities/mobile.json` becomes `capabilities/android.json` + `capabilities/ios.json` when iOS
lands. Note the existing Windows-specific gate `scripts/verify-windows-config.py`, which already
enforces NSIS `installMode: currentUser` and a numeric RT_MANIFEST — evidence that the per-OS config
surface is gate-checked in place, not structured by directory.

### Why there is no directory per OS

A directory earns its existence when the **source** differs, not when the **output** differs — and an
OS is a compile target, not a source location. This tree already proves both halves:

**Per-OS directories already exist, one level down**, where hand-authoring actually happens:
`apps/tablet-client/gen/android/` is **42 tracked files** — `AndroidManifest.xml`, `MainActivity.kt`,
`app/build.gradle.kts`, `proguard-rules.pro`, launcher resources, the keystore signing block;
`packaging/linux/deb/{postinst,prerm}` and `packaging/linux/oz-pos.desktop`; `install/win/{install,uninstall}.ps1`;
`apps/*/capabilities/{default,mobile}.json`; `apps/*/icons/` (`.ico`/`.icns`/png). None of that can be
derived from a single source, so it gets its own directory. The 47k lines of Rust can be.

**Per-OS Rust is three files.** `git grep -c "cfg(target_os" -- '*.rs'` matches exactly three —
`kasirmu-logging/src/eventlog.rs` (2), `kasirmu-logging/src/lib.rs` (2), `kasirmu-security/src/lib.rs`
(6) — and **zero** occurrences in either app shell. There is nothing meaningful left to place in an
`apps/android/`.

**One source already yields three desktop OSes.** `apps/desktop-client/tauri.conf.json` sets
`bundle.targets: "all"`; `release.yml` is desktop-only and emits the MSI/NSIS, `.deb`/`.AppImage` and
`.dmg`/`.app` sets from that one directory. `cargo build --target aarch64-linux-android` compiles the
same `kasirmu-core` for Android. The OS is a build parameter, and the toolchain's axis is the target
triple — Cargo has `[target.'cfg(…)'.dependencies]`, Tauri has `bundle.windows.*` /
`android.minSdkVersion`. Directory-per-OS fights that instead of using it.

**And the duplication bill is already on the ledger with only two shells:**

| Duplication today | Measurement |
|---|---|
| Filenames present in *both* `commands/` dirs | **52** (desktop has 71 files, tablet 98) |
| Command-layer size across the two shells | **14,571 + 32,954 = 47,525 lines** |
| `AppState` divergence | 894 vs 570 lines, **909 diff lines** |
| Registered IPC handlers | 455 desktop / 320 tablet — only **301** shared |

`crates/kasirmu-bridge` ("refactor campaign Phase 2") exists to *undo* exactly that. Five OS
directories would re-create it five times.

**The axes that do deserve their own directories** are the ones where source genuinely forks:
**toolkit** (Tauri vs Slint — different windowing, different UI language, different `main`) and
**form factor** (desktop vs tablet — 455 vs 320 registered handlers, different layouts). Hence
`desktop-tauri/` and `mobile-tauri/`. Note the Slint shell gets its directory for the *toolkit*, not
for the Raspberry Pi: the Pi is merely its first deployment target, and Slint will cross-compile to
the OSes the Tauri shell already covers.

**Acceptance:** the rename is applied consistently across `Cargo.toml` members, `tauri.conf.json`,
`AGENTS.md`, `.gitignore`, `.github/workflows/release.yml`, `scripts/*` ·
`python scripts/verify-ipc-parity.py` exits 0 · `cargo check --workspace --all-targets`

**Completed 2026-09-18** (commit `37dfce036`, 364 files: 329 renames + 35 modified). The commit was
landed by the repository owner while the change was still in the working tree, under a message that
names P11; its non-rename file set is exactly the functional list below, with nothing foreign swept in.

**Scope was deliberately bounded to the functional surface — an owner decision, not a shortcut.** The
raw reference count is **367 files**, but roughly 85% are prose citations (`//! apps/desktop-client/src/
commands/audit.rs` in bridge module docs, module READMEs, test comments). Re-pointing only paths that
*resolve* keeps the commit reviewable and avoids falsifying provenance statements — e.g.
`crates/kasirmu-bridge/src/branding_tests.rs:2` reads *"relocation: moved out of
`apps/desktop-client/src/commands/branding_tests.rs`"*, a claim about the past that a substitution would
corrupt. Re-pointed: `Cargo.toml` members, `.dockerignore`, `.gitignore`, `.githooks/pre-push`,
`dev-ci.yml` (two filters), `release.yml`, both `ops/docker` Dockerfiles, `ops/packaging/mobile/README.md`,
21 `scripts/*`, three `ui/src/__tests__` files that read the shells, and the shells' own files (which
self-cite the directory they live in). **Deferred and measured: 342 files / 1738 occurrences** of the old
names remain, every one prose — for P7 (docs rewrite) and P13 (the `tablet` vocabulary sweep).

**Two traps, both the same class as P12's `plugins/` finding.**

1. **The alternation form is invisible to a literal path grep.** `.githooks/pre-push:76` and
   `dev-ci.yml:93` reference the shells as `^apps/(cloud-server|desktop-client|tablet-client)/`, which
   contains neither `apps/desktop-client` nor `apps/tablet-client`. A grep for the path misses the two
   most load-bearing references in the tree — the push gate and the CI router. Search the **bare token**
   as well as the path.
2. **`include_str!` is a compile-time path dependency that a comment-oriented review misses.**
   `crates/kasirmu-bridge/src/settings_tests.rs:1744` held
   `include_str!("../../../apps/tablet-client/src/commands/settings.rs")`. The whole `crates/` bucket
   (118 files) was classified as prose from a 12-line sample, and this was in it. It surfaced only as a
   build failure (`could not compile kasirmu-bridge (lib test)`), which is the lesson: a bucket is not a
   classification, and `cargo check --workspace --all-targets` must be run **after** the move, not only
   before. `CARGO_MANIFEST_DIR`-relative paths, by contrast, are unaffected by a rename — all 24 of them
   stayed correct untouched.

**Gates.** `verify-ipc-parity.py` → `IPC parity: OK` · `verify-invoke-parity.py` → 473 invokes across 2
shells, 0 violations · `verify-dockerfile-workspace.py` → all 42 members present in both Dockerfiles ·
`verify-windows-config.py` → 0 violations · `verify-architecture-boundaries.py` → exit 0 ·
`verify-ci-docs-drift.py` → 0 drift · `cargo check --workspace --all-targets` → exit 0 ·
`cargo test -p kasirmu-bridge -p kasirmu-app -p kasirmu-tablet --lib` → **155 + 1322 + 669 passed, 0
failed** · the three re-pointed UI test files → 64 passed.

`scripts/test-ci-routing.sh` **cannot run in this sandbox**: it is killed at process start with zero
output and emits no trace even under `bash -x`, so it never reaches the lines this phase changed. Its
subject was verified directly instead — the Rust router now matches `apps/desktop-tauri/` and
`apps/mobile-tauri/` and matches neither old name, and the release filter matches
`apps/desktop-tauri/tauri.conf.json` only.

### [x] P12 — Root directory budget: 28 entries down to 23

**Commit:** `refactor(repo): consolidate root satellites into ops/ and tools/`

**This phase exists because P3 and P8 do not solve the motivating problem.** They remove three root
directories; the census in §5 shows seven satellites plus one stray. Three moves close the gap:

1. **`fuzz/` → `tools/fuzz/`** (with `fuzz/hfuzz/` alongside). `fuzz/` is a *standalone* workspace —
   its own `[workspace]` table, its own `Cargo.lock` and `target/`, nightly-toolchain pinned — which is
   exactly why it cannot live under `crates/` (`members = ["crates/*"]` would try to absorb a second
   workspace root and `cargo metadata` fails). A `tools/` directory is the honest home, and it lets both
   deliberately excluded workspaces sit together: rewrite root `Cargo.toml`'s
   `exclude = ["fuzz", "fuzz/hfuzz", "scripts/updater-compat-check"]` accordingly (optionally moving
   `scripts/updater-compat-check` too, so **every** out-of-workspace crate is in one place).
2. **`plugins/example-discount/` → `scripts/examples/`**, which already holds seven Lua business-rule
   examples (`buy_x_get_y.lua`, `happy_hour.lua`, `min_order.lua`, …). A root directory for one example
   is the ambiguity this plan is trying to remove. **6** live files reference `plugins/`.
3. **Delete the stray `node_modules/`** (see below).

Path edits: root `Cargo.toml` `exclude`, `.gitignore` (`/fuzz/target/`, `/fuzz/Cargo.lock`,
`/fuzz/hfuzz/`), `.cbmignore`, `.githooks/pre-push`, `.github/workflows/dev-ci.yml`, and the docs and
`.agents/skills/**` files that cite `fuzz/` — **19** live files reference it.

**Result: 22 → 19 tracked root directories** (28 → 24 counting ignored build/tool dirs), with exactly
two new ones (`ops/`, `tools/`) replacing six satellites, and every surviving entry classifiable as a
tool contract, a source tier, or a deployable. Arithmetic: 22 − `fuzz` − `gateway` − `install` −
`packaging` − `plugins` + `ops` + `tools` = 19. `dev/` is decided by P6 (3-grep dead check first): if it
turns out live it becomes `prototypes/`, and if dead the count drops one further, to **18**.

> **Count tracked directories, not `ls -d */`.** A bare `ls -d */` also counts `target/`,
> `target-release/` and the tool-owned dotdirs, so it reports 19 today and ~14 after this phase, not 12.
> The stable measure is `git ls-files --directory | grep '/' | cut -d/ -f1 | sort -u | wc -l`.

**Acceptance:** `git ls-files --directory | grep '/' | cut -d/ -f1 | sort -u | wc -l` → **19** ·
`cargo metadata --no-deps --format-version 1` still lists **39** packages ·
`cargo check --workspace --all-targets` · `python scripts/verify-architecture-boundaries.py` exits 0 ·
`test ! -d fuzz && test ! -d plugins && test ! -d install && test ! -d packaging && test ! -d gateway`

**Completed 2026-09-17** (commit `920b1762f`, 27 files, 40 insertions / 40 deletions, 11 renames).
Root tracked directories measured **20 → 19**; `cargo metadata --no-deps` still **39** packages;
`verify-dockerfile-workspace.py`, `verify-architecture-boundaries.py` and `verify-ci-docs-drift.py`
all exit 0; `cargo check --workspace --all-targets` exits 0; `cargo test -p kasirmu-plugin --lib`
reports **180 passed / 0 failed**.

`git mv fuzz tools/fuzz` carried the ignored `tools/fuzz/target/` (551 MB) and `Cargo.lock` with it.
`git mv plugins/example-discount scripts/examples/example-discount` then `rmdir plugins` — git tracks
no empty directories, so the emptied `plugins/` had to be removed explicitly or it would have survived
as an invisible ghost of exactly the §5 class.

**Three corrections found by re-deriving this phase's own numbers:**

1. **"19 live files reference `fuzz/`" undercounts.** 49 tracked files contain the token and 21 contain
   a *path* reference. Re-pointed: root `Cargo.toml` `exclude`, `.gitignore`, `.cbmignore`,
   `.githooks/pre-push`, `.github/workflows/dev-ci.yml`, `scripts/gates.json`,
   `scripts/verify-dockerfile-workspace.py`, the three hfuzz/campaign scripts,
   `scripts/updater-compat-check/Cargo.toml`, `docs/operations/ci-pipeline.md` and
   `.agents/skills/project-scaffold/SKILL.md`. Deliberately left stale, because they are records rather
   than statements about the current tree: `ci.yml.bak` (retired — P4's to attic), `CHANGELOG.md`,
   `docs/archived/**`, `docs/records/JOURNAL.md` and `todo-rebrand-2.md`.
2. **"6 live files reference `plugins/`" missed the two that actually execute — and they would not have
   failed.** `plugins/` names two different directories: the repo one, and the *runtime* one the app
   reads from `app_data_dir().join("plugins")` (`apps/desktop-client/src/state.rs:326`). Most of the
   ~20 prose references are the runtime one and correctly did **not** move. But two tests load the repo
   directory by hardcoded relative path — `crates/kasirmu-plugin/src/manager_tests.rs:294,308`:
   `PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins")`. They are invisible to a
   `git grep 'plugins/'` sweep because the string carries **no trailing slash**.
   `load_plugins` returns `Ok(empty registry)` when the directory does not exist
   (`crates/kasirmu-plugin/src/loader.rs:115-117`), and both tests assert only that nothing panics — so
   a missed rename would have left them **silently vacuous under a green build**, which is worse than a
   red test. They now resolve `../../scripts/examples`, which `load_plugins` accepts as a plugins root
   because it `continue`s on non-directory entries (`:122-124`) and `example-discount/` is its only
   subdirectory. **Still open:** neither test asserts the registry is non-empty, so the vacuity hazard
   survives any *future* path error. Closing it needs a public accessor on `PluginManager` (it has none
   — `manager.rs` exposes behaviour only), then `assert_eq!(count, 1)`. Outside this phase's fence.
3. **Two numbers in this plan are stale, and one item is deferred.** The
   `.github/workflows/*.yml.bak` count is **11, not 13** (P4). `fuzz/hfuzz/` **does not exist on disk**,
   so its `exclude` / `.gitignore` entries are pre-emptive; both were still re-pointed so the rule keeps
   working if that crate is ever created. And the optional second half of item 1 — moving
   `scripts/updater-compat-check` — was **declined**: it has **16** referrers, including both
   `ops/docker` Dockerfiles, three sites in `dev-ci.yml` (one a `rust-cache` `workspaces:` value) and
   `scripts/check-updater-compat.mjs`. That is disproportionate for an explicitly optional move that
   kills no duplicate, so it fails principle 3.

### [x] P13 — Execute the `tablet` → `mobile` rename

**Commit:** `refactor(mobile): rename the tablet shell to mobile`
**Measured scope: 3,117 occurrences of `tablet` (case-insensitive) across 498 tracked files**
(`git grep -ci tablet | awk -F: '{s+=$NF} END {print s}'`; `git grep -li tablet | wc -l`).

**Why the rename is right:** the tablet shell becomes **one mobile application where the user selects
phone or tablet mode**. **Why a blanket find-and-replace would be wrong:** "tablet" also survives as a
*form factor*. The word splits into three buckets, and only the first one changes.

**Bucket 1 — RENAME (shell identity).**

- Directory and Rust targets: `apps/tablet-client/` → `mobile-tauri/`, package `kasirmu-tablet` →
  `kasirmu-mobile`, lib `kasirmu_tablet_lib` → `kasirmu_mobile_lib`, `[[bin]] kasirmu-tablet`.
- Build entry points, `ui/`: `index.tablet.html` → `index.mobile.html`, `src/main.tablet.tsx` →
  `src/main.mobile.tsx`, `vite.tablet.config.ts` → `vite.mobile.config.ts`.
- `ui/package.json` scripts: `dev:tablet`, `build:tablet`, `bundle:check:tablet`.
- Build output and gates: `ui/dist-tablet/`, the gate name **"Bundle budget (tablet)"**,
  `scripts/gates.json` runners, and the `check-ui.mjs` leg.
- ⚠ **`.github/workflows/dev-ci.yml:93` path filter is a functional trap, not a cosmetic one:**
  `^apps/(cloud-server|desktop-client|tablet-client)/`. Miss it and the mobile shell's changes stop
  triggering the Rust CI job — silently, with a green build.
- Cross-shell references from the desktop shell: **16** files under `apps/desktop-client` mention it,
  including `tests/capability_parity.rs`, `tests/gate_audit.rs`, `tests/wiring_audit.rs` and
  `src/{lib,main,state}.rs`.
- Path strings embedded inside test assertions: `ui/src/__tests__/themeTokenCompliance.test.ts:1109`
  builds a path to `apps/tablet-client/tauri.conf.json` and `:2249` asserts the CSP key names
  `tablet-client.csp` / `tablet-client.devCsp`; `crates/kasirmu-core/tests/credential_storage_form.rs:714`
  cites `apps/tablet-client/src/commands/settings.rs` in its failure message.

**Bucket 2 — KEEP (form factor).** The **84** `ui/src` files that mean *layout/device*, not identity:
`TabletAppLayout.test.tsx`, the `#tablet-main-content` element, tablet breakpoints and tokens, and the
**28** `crates/kasirmu-api` references to "tablet terminals" (prose about the KDS display client).
`capabilities/mobile.json` is already the right word. **Renaming these would delete the phone/tablet
mode distinction the shell is being built to provide.**

**Bucket 3 — IDENTITY (irreversible once distributed).**

| Item | Current value | Consequence of changing it |
|---|---|---|
| Tauri `identifier` | `mu.kasir.tablet` (`apps/tablet-client/tauri.conf.json:5`) | App data dir, updater channel and single-instance identity all key off it. Note desktop uses `mu.kasir.app`, so the pair is inconsistent already |
| Android `namespace` + `applicationId` | `mu.kasir.tablet` (`gen/android/app/build.gradle.kts:31,34`) | The `applicationId` **is the install identity**. Change it after users install and it becomes a different app: no upgrade path, no carried data |
| Kotlin package directory | `gen/android/app/src/main/java/mu/kasir/tablet/MainActivity.kt` | Moves with the namespace |

**This is free today, and that is measured, not assumed.** `.github/workflows/release.yml:24` says in
its own words: *"Mobile (android.yml.bak / ios.yml.bak). Never part of this file."* — and `release.yml`
builds exactly three targets (`desktop-linux`, `desktop-windows`, `desktop-macos`), all from
`apps/desktop-client/`. Both mobile workflows are retired `.bak` files. **No mobile release has ever
shipped, so all three identity rows can be renamed.** The single condition that flips this: if an APK
has ever been handed to a customer, `applicationId` must stay `mu.kasir.tablet` — or that install is
orphaned and needs a documented migration path.

**Acceptance:** `grep -n 'tablet-client' .github/workflows/dev-ci.yml` → nothing ·
`git grep -li 'tablet' -- 'apps/mobile-tauri/**' 'ui/index.mobile.html' 'ui/vite.mobile.config.ts'`
returns only form-factor hits · `python scripts/verify-ipc-parity.py` exits 0 ·
`cd ui && npm run typecheck && npm run test` · `cargo check --workspace --all-targets`

**Completed 2026-09-18** (commit `bb1e72eb3`, 96 files, 317 insertions / 307 deletions, 4 renames).
Renamed: `kasirmu-tablet` → `kasirmu-mobile` (package, lib, `[[bin]]`), `kasirmu_tablet` →
`kasirmu_mobile`, `ui/index.tablet.html` → `index.mobile.html`, `ui/src/main.tablet.tsx` →
`main.mobile.tsx`, `ui/vite.tablet.config.ts` → `vite.mobile.config.ts`, `dist-tablet` → `dist-mobile`,
`dev:tablet` / `build:tablet` / `bundle:check:tablet` → `:mobile`, the gate name `Bundle budget (tablet)`
→ `(mobile)`, `mu.kasir.tablet` → `mu.kasir.mobile`, and the prose P11 deferred — `tablet-client` →
`mobile-tauri`, 536 occurrences across 125 files. The Kotlin package directory moved with the namespace.

**The rename is token-scoped, not word-scoped, and that is the whole design.** `tablet` survives as a
form factor, so only shell-identity tokens were substituted. Measured survivors, all intentional:
`TabletAppLayout` (19 files), `#tablet-main-content` (4), the tablet breakpoints and tokens, and the
Playwright project `name: 'tablet'` — which is `devices['iPad Pro 11']` emulation, a viewport profile, not
a shell. Renaming those would have deleted the phone/tablet mode distinction this shell exists to provide.
Census **3066 → 2862**; every remaining identity token sits in a dated record (`docs/archived/`,
`docs/decisions/`, `docs/plans/`, `docs/records/`, `docs/specs/_active/`, `.agents/*.md`) or in this plan,
and **no live file names a renamed path**.

**The irreversibility premise was re-verified before touching the identity, not assumed.**
`.github/workflows/release.yml:24` still reads verbatim *"Mobile (android.yml.bak / ios.yml.bak). Never
part of this file."*; the release matrix builds desktop targets only; both mobile workflows are `.bak`;
and `release.yml` publishes no `apk`/`aab`/`ipa`. No mobile release has ever shipped, so `applicationId`
could be renamed. The one condition that would flip this is an APK having reached a customer.

**Two traps worth carrying forward.**

1. **`scripts/check-bundle.mjs:61` derived the output directory from the config's filename** —
   `config?.includes('tablet') ? 'dist-tablet' : 'dist'`. Renaming the config to `vite.mobile.config.ts`
   without also fixing that predicate would have written the mobile bundle into `dist`, colliding with the
   desktop artifact, **and the budget would still have passed**. Confirmed fixed by the build's own
   report: entry file `index.mobile-*.js`, outDir `ui/dist-mobile`.
2. **Renaming an ignore rule can un-ignore a stale artifact.** `ui/.gitignore`'s `dist-tablet` rule became
   `dist-mobile`, leaving the previous build output at `ui/dist-tablet/` untracked and visible in
   `git status`. Deleted rather than committed — the artifact name moved, so the old directory is dead
   output.

**Measured exclusions, recorded so they are not re-litigated.**
- **The gate-internal shell-key vocabulary** — `"desktop"` / `"tablet"` as keys in the `SHELLS` maps and
  allowlist sections of `verify-ipc-parity.py`, `verify-invoke-parity.py`, `verify-scoped-reads.py`,
  `allowlist-schema.py`, `retire-legacy-commands.py` and `ipc-parity-allowlist.json`. A separate
  vocabulary naming shells by form factor inside gate data; P13's buckets do not name it, and renaming it
  would mean rewriting large allowlist payloads.
- **`apps/mobile-tauri/gen/android/buildSrc/src/main/java/com/ozpos/tablet/`** — old-brand debris the
  rebrand campaign missed. Its two Kotlin files carry **no `package` declaration at all**, so the
  directory is a path shell with no binding. A rebrand follow-up, not a P13 identity item.

**Gates.** `verify-ipc-parity.py` → `IPC parity: OK` · `verify-invoke-parity.py` → 473 invokes, 0
violations · `verify-ci-docs-drift.py` → **0 drift**, so the gate-name rename landed consistently across
`gates.json`, `dev-ci.yml` and `ci-pipeline.md` · `verify-architecture-boundaries.py` → exit 0 ·
`verify-dockerfile-workspace.py` → 42/42 · `verify-windows-config.py` → 0 violations ·
`cargo metadata --no-deps` → still **39** packages, now `kasirmu-mobile` ·
`cargo check --workspace --all-targets` → exit 0 · `npm run typecheck` → exit 0 ·
`npm run test` → **584 files / 10059 passed, 0 failed** · `npm run bundle:check:mobile` → all budgets
satisfied.

---

## 4. Explicitly declined

Recorded so the same ground is not re-litigated.

| Declined | Why |
|---|---|
| Adopting `ARCHITECTURE.md`'s `integrations/`, `tooling/`, `config/`, top-level `frontend/`, `tests/` | That target is how the current `ui/src/frontend/` ghost got built: scaffolding dirs for planned structure, then half-populated. A top-level `tests/` also fights the repo's strongest convention — the `foo.rs` + `foo_tests.rs` + `#[path]` sibling pair, applied across **448** `*_tests.rs` files (`git ls-files \| grep -cE '_tests\.rs$'`) alongside **594** files under `ui/src/__tests__` |
| Splitting `crates/` into role tiers | 4 of the 17 are pure adapters, so it is tempting. But a crate move here is directory-only — `kasirmu-hal = { path = "crates/kasirmu-hal" }` at exactly **one** site (root `Cargo.toml`, workspace deps) — so the payoff is cosmetic while non-Rust references to crate directories number **127 files** (30 `scripts/*`, 26 `ui/*`, 14 `docs/guides`, 11 `.agents/skills`, 10 `modules/*`, 5 `apps/license-server`, 3 `docs/operations`, 3 `crates/kasirmu-core`, 2 `website/src`, 3 compose files, 2 Dockerfiles, plus `.gitignore`, `.dockerignore`, `.cargo/audit.toml`, `.githooks/pre-commit`, `Cargo.toml`, `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `.agents/AGENTS.md` and 2 root plan docs — re-derive with `git grep -l -E "crates/kasirmu-\|crates/qris-core" -- ':!*.rs' \| cut -d/ -f1-2 \| sort \| uniq -c \| sort -rn`). No duplicate dies, so it fails principle 3 |
| Renaming `modules-*` / `platform-*` packages | The directory already names the tier; the cost is `use modules_crm::` churn across the tree; and the crates/ dir↔package mismatch (`modules/crm` → `modules-crm`) is navigational noise, not a correctness problem |
| Deleting `fuzz/` or folding it into `crates/` | It is deliberately workspace-excluded (own `[workspace]` table, own lockfile) so it cannot perturb the workspace `Cargo.lock`. That is correct as-is |

### Other whole-tree designs, and the constraints that decide them

Five alternative layouts were weighed against this one. Three are not preferences — they are blocked by
measurable constraints, which is the point of listing them.

| Design | Shape | Why not |
|---|---|---|
| **B — Flat crates** | collapse `foundation/`, `platform/`, `modules/` into `crates/` | **Blocked.** `scripts/verify-architecture-boundaries.py:113` hard-codes `UI_VOCABULARY_ROOTS = ("crates", "modules", "platform", "foundation")`, and the root `Cargo.toml` documents the glob design as intentional. The tier names are load-bearing, not cosmetic |
| **C — Vertical slice** | `domains/sales/{rust, ui, locales, migrations}` | **Blocked by three global constraints.** (1) Migrations are one ordered sequence — 59 files plus the canonical registry `crates/kasirmu-core/src/migrations.rs` — and `20260813_init.pg.sql` is *generated* from the ordered whole (`AGENTS.md`: "registry order is canonical"), so splitting per module breaks the generated PG schema. (2) One `ui/` tree builds **two** artifacts (`vite.config.ts` + `vite.tablet.config.ts`) under two enforced gzip budgets (`scripts/gates.json` → `bundle-budget`, declaring "bundle budget" + "bundle budget (tablet)"), fed by 27 lazily-registered `features/*/register.tsx`; 14 packages would need that gate redesigned. (3) the tier names above |
| **D — Frontends-first** | `frontends/react-tauri/`, `frontends/slint/`, `shared-ui/` | Defensible once a second toolkit actually exists; premature while the endgame is undecided, and it separates `ui/` from `apps/*-client`, which ship as one artifact today |
| **E — services/ vs clients/** | split `apps/` | A real refinement — a cloud server and a POS shell are different kinds of thing, and `apps/` does conflate them. Cheap, and layers onto P11 later without conflict; not worth its own phase now |
| **F — Do nothing** | — | Rejected: the two shared component libraries keep diverging, the root keeps growing, and both architecture docs are already false |

### The replaceable-UI question is already decided — twice, on 2026-09-11

Multi-renderer support is not a future requirement to design for; it is codified policy with a live gate:

- **ADR #49** — `docs/decisions/2026-09-11-adr49-headless-command-bridge.md`, enforced as rule
  `bridge-toolkit-purity` at severity **P1** in `scripts/verify-architecture-boundaries.py:98`:
  *"Keep crates/kasirmu-bridge toolkit-free (ADR #49): a tauri/gtk/webkit dependency or reference
  removes the headless seam a second renderer binds to."*
- **ADR #53** — rule `ui_vocabulary_findings` in the same script: *"`crates/`, `modules/`,
  `platform/` and `foundation/` are renderer-agnostic by design: the stated goal is that the UI is
  replaceable, and a doc comment that says 'the React component renders this' binds the layer's
  reasoning to one renderer."*

**But the enforcement has a hole, and it is the most valuable single finding in this plan.**
`ui_vocabulary_findings` scans **comments** in `.rs` files through `mask_code_preserving_comments`, so it
cannot see a Cargo dependency; `bridge-toolkit-purity` inspects only `crates/kasirmu-bridge`. Meanwhile
`platform/startup/Cargo.toml:45` declares `tauri = { workspace = true }` and is **absent from
`scripts/architecture-boundaries-baseline.json`**. The one real renderer coupling inside the platform
tier is invisible to the rule that declares it must not exist. That is why P10a is worth more than any
folder move in this plan — and the fix is two-fold: remove the dependency (P10a) *and* widen
`bridge-toolkit-purity` to cover the four renderer-agnostic roots, or the coupling returns unnoticed.

---

## 5. Root file policy

> **Root holds only files a tool discovers by name at the project root, plus the four human entry points (README, CHANGELOG, CONTRIBUTING, LICENSE). Everything else lives in a directory.**

There are **35 tracked root-level files** (`git ls-files --directory | grep -v '/' | wc -l`), and they
are four different piles needing opposite treatment.

**Pile A — load-bearing, do not move.** Cargo, gitleaks, Trivy, cargo-deny, the MCP client and git
all do a *root lookup by filename*: `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `deny.toml`
(3 refs), `.gitignore`, `.dockerignore`, `.gitleaks.toml` (1 ref), `.trivyignore` (6 refs),
`.cbmignore` (4 refs), `.mcp.json`, `.tarpaulin.toml`, `.gitattributes`, `.editorconfig`, plus
`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `AGENTS.md` and `.env.example`.
"Clutter" in this pile is load-bearing; moving `.trivyignore` or `deny.toml` breaks those tools silently.

**Pile B — at root by accident; move.** The 7 docker files (→ P3).

The root **`.md` files are the owner's working files and stay at the root** — not moved, not renamed,
not deleted. That covers `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CHANGELOG.md`,
`CONTRIBUTING.md`, `DSH.md`, `done-todo-rebrand.md`, `todo-rebrand-2.md`,
`todo-open-debt-program.md`, `todo-review-type.md` and this file. P5 is withdrawn accordingly.

> ⚠ **`DSH.md` was in this pile until 2026-09-17 and must not move.** Its content is
> "# TOOL CALL & RUN_CODE (Code Mode)" — agent-harness instructions, the same class as `.mcp.json` and
> `AGENTS.md`: read **by name at the repo root**, which is exactly why `git grep -lF 'DSH.md'` returns 0.
> A zero-reference count is the *expected* signature of a name-resolved contract, not evidence of death.
> The same reasoning that keeps `.mcp.json` keeps this.

**Pile C — should not exist; delete.** All gitignored, so git never reports them:

- `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709` — see below.
- six `.dsh-*.log` files (covered by `*.log`).
- `pr_body.md`, `skill-drift-report.md` (both explicitly ignored).
- `scripts/__pycache__/`, `.agents/__pycache__/`.

**Pile D — rename, do not move.** `oz-pos-updater.key.pub` is a **tracked** Tauri updater public key
still carrying the old brand. It also slips past `.gitignore`'s `*.key` rule because it ends `.pub`.

**What it actually is (verified 2026-09-17):** the 152-byte file holds the *base64* of the minisign
key, and that same base64 string is **inlined verbatim** as `pubkey` in
`apps/desktop-client/tauri.conf.json:72`. So the running updater does **not** read this file — deleting
it would not break signature verification. It is the human-readable record of which key signs releases,
which is worth keeping and worth renaming; it is not load-bearing.

### Two corrections to this document's own earlier claims

Both were wrong, both were caught by measurement rather than review, and both are recorded because the
plan's own rule is that every claim carries a command.

1. **`DSH.md` is not a movable plan doc** — see the Pile B warning above.
2. **`stats.json` is not a duplicate of `scripts/stats.json`.** `cmp` reports they **differ**, and
   `git grep -ln 'stats\.json'` shows `scripts/stats.ps1` and `scripts/check.ps1` read that name. This is
   not a dedupe; it is a "which copy is stale?" investigation, and deleting either one silently changes
   what those two scripts report. Do not touch it as part of a tidy-up.

### One likely-dead config worth confirming with its owner

`.lighthouserc.json` has **no live consumer**. Every reference to it is a historical commit-subject
example, not a reader: `.githooks/commit-msg:8` cites a commit titled
`deleted: lighthouse-report.json`, and `scripts/verify-commit-subjects.py:332` lists that same subject
among `bad_subjects`. `website/package.json` declares no Lighthouse script, and
`.github/workflows/website.yml.bak` is retired. Lighthouse CI also runs ad-hoc via `npx lhci autorun`,
which is why this of all things should be deleted by its owner rather than by a tidy-up pass.

### Root directories: 22 tracked (28 on disk) → 19, and why only 7 are clutter

The root holds **28 directories** — 16 tracked visible, 6 tracked hidden, 6 ignored
(`ls -d */` → 19 non-hidden; `git ls-files --directory | grep '/' | cut -d/ -f1 | sort -u` → 22 tracked).
P3 and P8 together remove only **three** of them, which is why P12 exists: "too much on the root" was
the motivating complaint and the earlier phases barely touched it. The count is less alarming than it
looks, though, because most entries are immutable:

| Class | Count | Entries | Treatment |
|---|---|---|---|
| **Tool discovery contracts** — looked up *by name at the repo root* | 6 | `.github/`, `.githooks/`, `.cargo/` (`config.toml`, `audit.toml`), `.config/` (`nextest.toml`), `.vscode/`, `.agents/` | **Keep.** Cargo, cargo-nextest, git, GitHub and VS Code each resolve these by location; moving one breaks the tool silently |
| Tool-owned and gitignored | 3 | `.commandcode/`, `.freebuff/`, `.workbuddy-ai/` | Not ours to move |
| Build output, gitignored | 2 | `target/`, `target-release/` | Not structure |
| **Source tiers** | 5 | `apps/`, `crates/`, `foundation/`, `modules/`, `platform/` | **Keep** — collapsing them is blocked by `UI_VOCABULARY_ROOTS` (§4, design B) |
| Deployables | 2 | `ui/`, `website/` | Keep |
| Support | 3 | `docs/`, `scripts/`, `assets/` | Keep — `assets/` is a legitimate class: 76 files of shared branding with 17 live referrers |
| **Satellites — the actual clutter** | **7** | `dev/`, `fuzz/`, `gateway/`, `install/`, `packaging/`, `plugins/`, plus the stray `node_modules/` | **This is the target** |

The right metric is not the count anyway — it is **classifiability**. `apps/` and `assets/` are fine
at root; `dev/` is not, because its name promises tooling and it contains a KDS PWA prototype, and
`plugins/` is not, because it is a single Lua example while `scripts/examples/` already holds seven of
them. Ambiguity is the failure mode, not abundance.

**One optional extra, costed and not scheduled:** `website/` → `apps/website/` would drop one more root
entry and make `apps/` mean "everything deployable", but it touches **55** live referrers, which is not
worth it for one entry.

### The root `node_modules` is not a package root

There is **no root `package.json`** — the root holds `Cargo.lock` and nothing npm-related. The
directory's only leaf is `node_modules/.vite/vitest/<sha1>`, a Vite dep-optimizer cache bucket (52K),
which means the UI test suite was once run **from the repo root** instead of from `ui/`. The two real
npm roots are `ui/` (`"dev": "vite"`) and `website/` (`"dev": "astro dev"`). It is already invisible
to git via `.gitignore`'s deliberately *unanchored* `node_modules/` rule.

**It is deleted, not moved** — moving it would relocate a cache that should never have existed.

### Empty directories are invisible to git

An empty directory named `-p` sat at the repo root of this checkout. It never appeared in
`git status` — not even as `??` — because **git neither tracks nor reports empty directories**, so a
file that is untracked *and* unignored still leaves no trace. It could only ever be seen in an `ls` or
an IDE tree. This is the one junk class no git-based check can find:

```bash
find . -type d -empty \
  -not -path './.git/*' -not -path './node_modules/*' -not -path '*/target/*'
```

---

## 6. Order, prerequisites and gates

**Prerequisite.** The tree is mid-rebrand in the working copy right now (`ozpkg.rs` → `kasirpkg.rs`
renames in flight, README modified). Land that first; do not interleave with P1–P8.

**Order.** P1 → P2 → P3 → P4 → P6 → P8 → P9a → P10a → P11 → P13 → P7. (P5 is withdrawn — see §3.) Rationale for the four
decisions that are not obvious: `ui/` goes first because it is self-contained with zero cargo impact
and the largest win; **P10a runs before P11** so the shell names are settled only after the platform
tier stops leaking Tauri; the docs are rewritten **last** (P7) because `README.md` and
`ARCHITECTURE.md` must be rewritten once against the final tree rather than patched twice; and
**P9b and P10b are unscheduled** — both are real work with no payoff until a second toolkit exists,
so they are recorded, not scheduled (principle 2).

**Constraints.**
- Version stays `0.0.39`. No version bumps, no branch creation or switching.
- One pathspec commit per phase. This file is itself a new file, so committing it uses the one
  sanctioned new-file chain: `git add -- todo-project-folder-restructure.md && git commit -m "..." -- todo-project-folder-restructure.md`.
- No `git add -A`, no `--amend`, no `git stash` — several agents share this checkout and the index.

**Gates to run after each phase.** `cargo check --workspace --all-targets --all-features` for any
Rust-touching phase; `cd ui && npm run typecheck && npm run lint && npm run test` for P1/P2/P6;
`bash scripts/verify-docker-all.sh` and `python scripts/verify-dockerfile-workspace.py` for P3;
`python scripts/verify-ipc-parity.py` and `python scripts/verify-architecture-boundaries.py` before
finishing, since both walk the paths this plan moves.

---

## 7. Fact log

Every number in this file, with its reproducing command. Re-measure before relying on any of them.

| Fact | Command | Value (2026-09-17) |
|---|---|---|
| Workspace members | `cargo metadata --no-deps --format-version 1` (count `packages`) | 39 |
| Crate directories | `ls -d crates/*/ \| wc -l` | 17 |
| Module / platform dirs | `ls -d modules/*/ \| wc -l` · `ls -d platform/*/ \| wc -l` | 14 · 4 |
| Root tracked files | `git ls-files --directory \| grep -v '/' \| wc -l` | 35 |
| Ignored root entries | `git status --porcelain --ignored=matching \| grep -c '^!![^/]*$'` | 9 |
| `@/frontend/shared` importers | `git grep -lF "from '@/frontend/shared"` | 205 |
| `@/components` importers | `git grep -lF "from '@/components"` | 170 |
| `@/frontend/shell` importers | `git grep -lF "from '@/frontend/shell"` | 43 |
| `@/platform/ui` importers | `git grep -lF "from '@/platform/ui"` | 55 |
| `frontend/themes` referrers | `git grep -lF 'frontend/themes'` | 44 (0 via TS alias) |
| Colliding component basenames | `comm -12 <(ls ui/src/frontend/shared \| sort) <(ls ui/src/components \| sort)`, then `diff` per pair | 11, all divergent |
| Unique to `frontend/shared/` | `comm -23 <(…)` over the same two listings | 11 |
| Non-Rust refs to crate dirs | `git grep -l -E "crates/kasirmu-\|crates/qris-core" -- ':!*.rs' \| wc -l` | 127 |
| Path-dep sites per crate | `git grep -n 'path = "crates/kasirmu-hal"'` | 1 (root `Cargo.toml`) |
| Live vs inert workflows | `ls .github/workflows/*.yml \| wc -l` vs `ls .github/workflows/*.bak \| wc -l` | 2 vs 13 |
| Migrations | `ls crates/kasirmu-core/migrations/*.sql \| wc -l` | 59 |
| Old-brand `use` statements | `git grep -l "use oz_" -- "*.rs" \| wc -l` | 0 |
| Old-brand prose | `git grep -l -F "oz-pos" \| wc -l` · `-F "OZ-POS"` | 245 · 243 |
| Sibling test files | `git ls-files \| grep -cE '_tests\.rs$'` | 448 |
| UI test files | `find ui/src/__tests__ -type f \| wc -l` | 594 |
| Fluent corpus | `ls ui/src/locales/*.ftl \| wc -l` | 56 (27 en + 27 id) |
| Files reading the locale path | `git grep -l "locales\|\.ftl" -- scripts .github .githooks \| wc -l` | 12+ |
| `tauri` in platform/startup | `grep -c tauri platform/startup/Cargo.toml` · `grep -rn tauri platform/startup/src/*.rs` | 1 dep · 2 call sites (`lib.rs:264,268`) |
| `AppState` duplication | `wc -l apps/*/src/state.rs` · `diff` between them | 894 vs 570 lines, 909 diff lines |
| Shell OS-conditional Rust | `git grep -c "cfg(target_os" -- apps/desktop-client apps/tablet-client` | 0 |
| Bridge-resident desktop commands | `git grep -rl 'kasirmu_bridge' apps/desktop-client/src/commands \| wc -l` of `ls apps/desktop-client/src/commands/*.rs \| wc -l` | 67 of 70 |
| Committed mobile scaffold | `ls -d apps/*/gen/*` | `tablet-client/gen/android`, both `/gen/schemas` |
| Android scaffold files | `git ls-files apps/tablet-client/gen/android \| wc -l` | 42 |
| Shared `commands/` filenames | `comm -12 <(ls $D \| sort) <(ls $T \| sort) \| wc -l` | 52 of 71 / 98 |
| Command-layer lines per shell | `cat apps/*/src/commands/*.rs \| wc -l` | 14,571 · 32,954 |
| Per-OS Rust in the whole tree | `git grep -c "cfg(target_os" -- '*.rs'` | 3 files, 10 occurrences |
| `tablet` occurrences | `git grep -ci tablet \| awk -F: '{s+=$NF} END {print s}'` | 3,117 across 498 files |
| `tablet` as form factor (KEEP) | `git grep -li tablet -- 'ui/src/**' \| wc -l` | 84 |
| Mobile release path | `.github/workflows/release.yml:24` | *"Mobile (android.yml.bak / ios.yml.bak). Never part of this file."* |
| Root tracked directories | `git ls-files --directory \| grep '/' \| cut -d/ -f1 \| sort -u \| wc -l` | 22 now → 19 after P12 |
| Rust `#[test]` fns | `git grep -o '#\[test\]' -- '*.rs' \| wc -l` | 8,354 |
