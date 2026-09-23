# Skill audit — `.agents/skills/` — 22-09-26

Auditor: Budak-Korporat. Branch `0.0.39`, HEAD `e56bf8307` (style(website): align footer
copyright and socials to bottom on desktop), working tree clean at audit start.

**Scope: all 21 skills** — the 18-09-26 audit covered 14; seven have been added since
(`android-apk-build`, `android-ui-automation`, `brand-asset-pipeline`,
`css-layout-verification`, `deploy-cloudflare`, `deploy-northflank`,
`northflank-deploy-diagnosis`). Every one of the 21 now carries a dated
`2026-09-22 · Budak-Korporat` audit stamp and the footer
`> last audited 22-09-26 by Budak-Korporat`.

**Status: repaired.** 24 findings, all repaired in place except four deliberately recorded
and left (§5). Method: measurement, not inference — every number below came from a command
run against this tree, and anything not re-measured is labelled as such in the skill's own
stamp.

---

## 0. The detector's verdict, and why it is still not trustworthy on its own

`bash .agents/skills/skill-drift-guard/scripts/detect.sh` → **"No drift detected"**, exit 0,
**11m 11s**. Every finding in this report was nonetheless live at that moment.

That is the same coverage gap the 18-09-26 audit named, and it has not closed. The relevant
numbers: the taxonomy the *document* described had 11 kinds and 10 checks, while the script
actually implements **15** checks over **16** kinds (§1). So a reader auditing "against the
ten checks" was already auditing against a two-thirds model before this pass began.

Liveness was confirmed rather than assumed (the guard's own pitfall #10). A probe skill
`.agents/skills/zz-probe-drift/SKILL.md` naming `crates/zz-probe-does-not-exist/src/lib.rs`
was injected; `--check=paths` reported exactly that one finding; the probe was deleted and
the check went clean. Per-check runs after repair: `paths`, `audit-format`, `crate-prefix`,
`ci-jobs`, `workflow-claims` all report no drift.

**Two false positives this audit introduced and then removed** — worth recording because
both are traps for the next editor:

- Check 1 does not strip HTML comments, so an audit stamp that *quotes* a dead path in order
  to say "this is no longer cited" flags the file that fixed it. `ui-components` was flagged
  for `ui/src/locales` purely because its new stamp named the retired directory. Fixed by
  describing the path instead of writing it.
- Check 14 matches its target phrasings literally, so the taxonomy row written to *document*
  kind 15 was itself flagged. See §1/F3.

---

## 1. HIGH — `skill-drift-guard` documents a script that no longer exists

`grep -oE 'should_run +"?[a-z0-9-]+"?'` over the script-local `detect.sh` returns **15**
check names (`paths`, `crates`, `api`, `versions`, `golden`, `refs`, `fluent`, `audit-date`,
`audit-format`, `doc-audit`, `version-lock`, `crate-prefix`, `ci-jobs`, `workflow-claims`,
`git-policy`) and its headers run "Check 1" to "Check 15". The document said "Eleven
concrete kinds" and "The detection script implements the ten checks above". Five checks —
added by a peer on 18-09-26 — never reached the prose.

Fixed: "Eleven" → "Sixteen"; "ten checks" → "fifteen"; taxonomy rows 12–16 added with
detection and patch strategies read off the script's own header comments; the `--check=`
name list written out so a contributor can actually run one.

**F3 (found by re-running the guard after stamping):** the new taxonomy row quoted the false
phrasings as its detection targets, and Check 14 matches them literally — so the guard began
reporting drift against its own skill. A green run would have been impossible. Reworded,
with the constraint written into the row.

---

## 2. HIGH — "two active workflows" is now false; there are three

`.github/workflows/android.yml` was **restored on 2026-09-22**, the day of this audit, from
`attic/android.yml.bak`. It has one job (`android-build`), triggers on `push: tags: ['v*']`
and `workflow_dispatch`, and deliberately has **no** `pull_request` trigger.

| File | Line | Was | Now |
|---|---|---|---|
| `project-scaffold` | CI section | "There are **two active workflows**" | three-row table with each workflow's triggers |
| `project-scaffold` | checklist | "one of the **two active workflows**" | three |
| `skill-drift-guard` | CI section | "**two active workflows**" | three, with `android.yml` recorded |

This is the **second** time this claim has rotted — 18-09-26 caught "the ONE active
workflow" when `release.yml` was restored. It is exactly the class Check 14 exists to catch,
and Check 14 exists because the class keeps recurring.

---

## 3. HIGH — `android-ui-automation`: every line citation into `android-cdp.mjs` was stale

The skill was written when `scripts/android-cdp.mjs` was 289 lines; it is **427** now
(+138). Sixteen citations moved. Re-measured and corrected:

| Claim | Was | Now |
|---|---|---|
| `adb` shell-out | `:39` | `:46` |
| CRLF strip | `:39` | `:46`, `:59` |
| `WebSocket` global | `:104` | `:105` |
| "not running" error | `:65-68` | `:72-75` |
| release-socket error | `:71-77` | `:80-83` |
| `/proc/net/unix` grep | `:70-71` | `:77-78` |
| `tcp:9222` forward | `:78` | `:85` |
| targets | `:256-261` | `listTargets :90`, printed `:380-382` |
| eval | `:157-172` | `:166-172` |
| `userGesture` | `:163` | `:170` |
| screenshot | `:180-200` | `:187-205` |
| 30s surface fallback | `:192` | `:199` |
| console | `:203-229` | `collectConsole :210`, events `:213-214` |
| 5s default | `:271` | `:392-394` |
| tap | `:232-239` | `:242-243` |
| exit-1 | `:286-289` | `:426` |

Only `:190` (the `fromSurface` comment) and `android-screen.mjs:208` still held. A
re-grep warning was added at the top of the skill.

Also fixed: `apps/mobile-tauri/AGENTS.md` citations pointed at Signing/keystore
(`:198-230`) instead of the cost table (`:244-276`, rows `:250-251`); "14s incremental"
`:205`→`:251`; ABI qualification `:207-216`→`:257-261`; packaging-padding trap
`:227-230`→`:273-274`. And the footer read **`23-09-26` — a date one day in the future**
relative to this audit; its REV 1 note carries the same 2026-09-23 date. Corrected.

---

## 4. HIGH — the loopback-bind claim died on 20-09-26 and two skills still taught it

`f1a1a2cec` ("fix(ui): bind the tablet dev server to all interfaces for wireless ADB") changed
`ui/vite.mobile.config.ts:142` from `host: host || false` to `host: host || '0.0.0.0'`.

- `android-apk-build` §2 "Cause 3" cited `:107` as `host: host || false` and told the reader
  that without `TAURI_DEV_HOST` nothing is reachable from the tablet — written 19-09-26, one
  day before the fix.
- `android-ui-automation` §10 said a hand-started `npm run dev:mobile` "binds loopback
  unless you set it".

Both rewritten to state the current value and keep the pre-`f1a1a2cec` failure as a live
caveat for older branches and overriding hosts. An agent obeying the old text would add an
env var for a bug that no longer exists.

---

## 5. MEDIUM — `database`: the count trap, and six stale line numbers

Root cause: `platform/core/src/database/migrations.rs` was split into `migrations.rs`
(578 lines) plus `statements.rs` and `proofs.rs`, and the registry grew.

| # | Claim | Was | Now |
|---|---|---|---|
| F1 | `pub const ALL` / registry size | `:43`, **58** entries | `:46`, **63** entries |
| F1 | `.sql` files in `crates/kasirmu-core/migrations/` | 59 | **64** (63 non-`.pg.sql`) |
| F2 | `schema_migrations` DDL | `migrations.rs:177-181` | `:197-201` |
| F3 | tablet pragma row | `apps/mobile-tauri/src/state.rs:112-114` (a `create_cache` doc comment) | `:172-174` |
| F4 | `busy_timeout` | `migrations.rs:353` | `:404` |
| F5 | the `foreign_keys` rationale | `:360-362` (a staff-trash migration comment) | `:411-413` |
| F6 | column-type whitelist range | `:142-170` | `:142-169` (12 entries confirmed) |

F1 is the skill's own central lesson — "a doc that quotes 59 migrations is quoting a file
count, not a registry count" — and both numbers in it were stale. The trap now says to
re-count rather than quote. Also updated: the `fresh_db()` bullet (58→63) and pitfall 4
(59→64).

---

## 6. MEDIUM — `northflank-deploy-diagnosis` had no router row

`grep -c northflank-deploy-diagnosis` over `onboarding-guide` returned **0**, while every
other skill directory except the guide itself appears at least once. The router had 19 rows
for 21 skills. The skill was unreachable: an agent whose Northflank deploy failed would find
`deploy-northflank` — the happy-path skill — and never the one written for that failure.
Row added, phrased to distinguish the two.

---

## 7. LOW

- `ui-components:308` — test counts: "297 `.test.tsx`, plus 255 `.test.ts`". Re-counted:
  **321** `.test.tsx`, **598** total, so **277** non-`.tsx`. The line now says to re-count.
- `project-scaffold` — the `northflank-deploy` ref-guard `if:` cited `dev-ci.yml:722`; the
  job starts at `:742` and the `if:` is at `:793`.
- `android-apk-build` — `check_username` non-oracle cited `auth.rs:856`; the fn is at
  `:975`, doc block `:963-972`.
- `project-scaffold` and two `pr-*` files carry mojibake in their 2026-09-03 stamps
  (`Â·` for `·`, `â€"` for `—`) from a double-encoded write. Left verbatim — this repo
  preserves superseded readings — but flagged as a `chore(docs)` candidate.

---

## 8. Deliberately recorded, not fixed

1. **`scripts/android-cdp.mjs` still asserts the refuted claim in its own comments** —
   `:14-15` ("renders the page even while the tablet shows its lockscreen") and `:190-193`
   ("That is what makes this work on a locked or screen-off tablet"). `android-ui-automation`
   §6c refuted this by measurement on 2026-09-23 but the source it was derived from was never
   corrected. Anyone reading the script instead of the skill still learns the false version.
   Flagged inline as a `chore(docs)` follow-up; this audit's scope is `.agents/skills`.
2. **`android-cdp.mjs` has three undocumented commands** — `elements`, `tap-testid`,
   `wait-testid` (usage string at `:374`). Added to the skill as an explicit
   *unmeasured* note rather than as table rows, because none has been driven on a device.
3. **Check 14's own comment still encodes a one-workflow world** ("that there is exactly one
   active workflow") now that three exist. Skill prose only was in scope.
4. **`skill-drift-guard`'s "Six scenarios under `tests/`" heading is wrong** — `ls tests/`
   returns seven `.bats` files. Left so the count and the table get reconciled together.

---

## 9. Verified accurate (no action)

`brand-asset-pipeline` (0 findings) — all four tenants, the manifest fields, both Tauri
identifiers, all 10 Windows-Store tiles, exactly 18 iOS icons, all four PWA manifest entries,
and the three hardware PNGs decoded from their IHDR (384x100 1-bit, 576x150 1-bit, 512x512
grayscale-alpha). The trap-5 repair still holds: all six `desktop/*.png` are depth 8 /
colour type 6, and `icon.ico` is 18,291 B.

`codebase-memory` — all three 18-09-26 findings confirmed repaired; all nine cited paths
exist. The surviving `oz-pos` strings are the code-memory graph's project key, explicitly
documented as such.

`css-layout-verification` — all six paths exist; the inert-declaration trap is confirmed
repaired (`tablet.css:55-57` is now `column`, not the dormant `column-reverse`); the
`ZoomContext` clamp is real (`Math.max(14, Math.min(16, 16 * scale))`, 1920px base), so
14px root and `40rem` = 560px both hold.

`tauri-ipc` (~64 modules vs 66 measured non-test), `tdd` (7 pre-commit gates confirmed by
`grep -c '^# ──'`), `rust-backend` (`Money`/`Currency`/`zero`/`from_major`/`checked_add` all
present in `foundation/src/money.rs`), `hal-drivers` (6 traits; `transport/tcp.rs` confirmed
— the bluetooth finding is repaired), `docs-auditor`, `exit-animation-pattern` (all four
commit hashes resolve; the dead `frontend/themes/tokens.css` is gone), `pr-create-pull-request`
and `pr-repair` (version lock `0.0.39` throughout; 11 dev-ci jobs and 3 release jobs; the
`git add` instruction is gone), and all three deploy skills (every cited path exists; the
`oz-pos` / `oz-cloud` strings are real Northflank project ids, allow-listed).

---

## 10. Process note — concurrent agents

This repo runs many agents in parallel against one checkout. **Nine repairs were applied
once, silently vanished from the working tree, and had to be re-applied** — two in
`database`, seven in `android-ui-automation`. All were re-verified present afterwards. A
pathspec commit records the *working-tree* copy, so inspect `git status --porcelain` and the
target files immediately before committing.

---

## 11. Recommended order of follow-up

1. `chore(docs)`: correct the two stale comments in `scripts/android-cdp.mjs` (§8.1) — the
   only place where a refuted claim is still being taught.
2. Reconcile `skill-drift-guard`'s "six scenarios" heading with the seven `.bats` files.
3. Re-time the figures marked "NOT re-measured" in the individual stamps before quoting
   them: the SDK/build timings, the CDP capture measurements, and the code-memory counts.
4. Consider teaching Check 1 and Check 14 to skip HTML comments and self-documenting rows —
   both false positives in §0 are structural, and both will recur.

---

> last audited 22-09-26 by Budak-Korporat
