# Documentation audit — the docs system itself — 23-09-26

Auditor: Buffy (docs-auditor methodology). Branch `0.0.39`, executed against the live
working tree on 2026-09-23. Peer sessions were active during the run — see
*Deliberately not touched*.

**Status: repaired the same session.** Every P0 and P1 finding below was fixed in this
pass except the dead refs inside one file fenced off for a concurrent editor (7 at the
close of the session, up from 2 mid-session as the peer kept writing — see *Deliberately
not touched*), plus four open items that are separate work (listed at the bottom — items 1–3
have since been closed in follow-up passes, so one remains).

## Scope and method

475 `.md` files were inventoried (252 under `docs/`, 21 at the repository root, the rest
in code directories, `.agents/`, and `website/`). Two independent passes:

1. A strict whole-tree link scan (relative hrefs + backticked paths resolved against the
   file's directory and the repo root, no exemptions) — 148 broken links outside
   `.agents/`.
2. The four house checkers, run as shipped: `check-dead-refs.py` (23 refs in 9 live
   files), `check-orphans.py`, `check-audit-stamps.py`, and
   `generate-records-index.mjs --check` (**red**: 148 generated vs 158 committed lines).

The gap between (1) and (2) is itself a finding — see *Checker blind spots*.

## What was already healthy

Functional directory taxonomy (`decisions/ records/ specs/ operations/ security/ guides/
archived/`), ADR frontmatter with a status vocabulary, audit stamps, a generated records
index with a deterministic `--check` mode, and four purpose-built checkers — most repos
have none of these. `check-orphans` and `verify-doc-uniqueness` were fully green at the
start. The house style — re-derive every number, never quote it — is genuinely practiced.

## P0 — was broken

### 1. The declared "single entry point" carried dead links, and its gate was red
`docs/records/README.md` linked seven dated records as siblings, but they live in
`docs/records/snapshots/`. Root cause, confirmed by reading the code: the generator's
records scan read only the directory's top level, so when the dated records were moved
into `snapshots/` the committed index kept rows whose hrefs no longer resolved — and a
refresh would have silently dropped the entire set from the entry point.

**Fixed**: the scan recurses (sorted at each depth, so `--check` stays byte-stable), the
index was regenerated, and `--check` now prints
`ok: … (54 ADRs, 4 research, 17 phased, 11 audits, 14 scattered, 2 observability, 13 records)`.
The escaping self-test (`scripts/test-records-index-escaping.sh`) still passes 7/7.

### 2. Freshness enforcement existed in prose only
Both `docs/records/README.md` and `docs/README.md` documented the freshness gate as
"unbuilt by decision", and the decision text promised it would land "in the same change
as the first record that trips it". This audit tripped it (148 vs 158 lines, ADR #60
missing entirely).

**Fixed — wired in the same change as the repair**, per the promise and inverted relative
to the `ci-docs-drift` precedent (blocking from day one, because the drift was fixed
before the step landed — a known-red baseline gets disabled):

| Wire | Where |
|---|---|
| `check.sh` step `records index freshness` | local pre-push |
| `dev-ci.yml#ci-docs-drift` step `Records index freshness check` | CI, blocking |
| `dev-ci.yml#ci-docs-drift` step `Docs dead references` (`continue-on-error: true`) | CI, advisory |
| gates.json `records-index` (required) + `dead-refs` (advisory, `advisory_at: step`) | manifest |

`verify-ci-docs-drift.py` reports **0 drift item(s)** after the wiring; its self-test,
`test-runner-labels.py`, and `test-ci-routing.sh` (21/21) all pass. The `dead-refs` gate
carries an explicit flip condition in its `_note`: drop `continue-on-error` and set
status `required` when the checker reports 0.

### 3. The docs homepage had five dead links
`docs/README.md` pointed at `guides/ARCHITECTURE.md`, `guides/EXTENDING.md`,
`guides/QUICKSTART.md`, `plans/northflank-p1-p7-plan.md` (twice) — all moved by the
guides reorg while the index was not repointed. Its own audit note ("all 16 linked
targets resolve", 08-09-26) had been false since that reorg.

**Fixed**: all five repointed to their post-reorg locations (the architecture link now
goes to the canonical root file), the stale enforcement bullet rewritten with the
history preserved, the quoted `ok:` counts refreshed with a re-derive instruction
instead of a line range, and a dated **Correction (23-09-26)** appended to the note
block — house style: keep what was believed, record when it stopped being true.

## P1 — structural, fixed

### 4. Two diverged architecture authorities
Root `ARCHITECTURE.md` (551 lines) and `docs/architecture/ARCHITECTURE.md` (293 lines)
differed by **841 diff lines**, both carrying audit stamps. The docs copy held four
sections the root lacked — Module Details, Build & Run, Extensibility, License &
Commercial Governance — and a stale directory tree (29 workspace members, the old
`oz-pos/` root name, locales and themes at their pre-reorg paths).

**Fixed by merging, not by decree**: the four unique sections were ported into the root
file (canonical — it is the GitHub-discovery location and what CONTRIBUTING/QUICKSTART/
EXTENDING already pointed at), with three repairs at the port: the preset citation named
a file the wizard retirement deleted (now points at the live owners: the `Preset` union
in `ui/src/api/settings.ts`, bundles in `preset_feature_keys`), the 505-command count
was replaced with a pointer to `api-reference.md` which owns the number, and
`cargo tauri dev` gained the `cd apps/desktop-tauri` prefix it needs. The stale tree was
dropped rather than merged; the root file's current-state tree (re-verified 09-18)
covers it. `docs/architecture/ARCHITECTURE.md` is now a pointer stub with a section map,
so the three files citing that path (WHITEPAPER stamp, JOURNAL:78, the manager
checklist's C30 list) still resolve. `verify-doc-uniqueness` passes.

### 5. 23 dead refs in 9 live documents
Rename/reorg fallout, swept with two different treatments:
- **Repointed** where the document speaks in the present tense: the two launch-test
  guides (11 links crossing `releases/`, `operations/`, `QUICKSTART` after the platform/
  reorg, plus two audit-stamp path claims corrected under the precision rule),
  `EXTENDING.md` (6), `QUICKSTART.md` (4), `admin-guide.md` (preset citation),
  `MODULAR_APP_PLAN.md` (capability table: six presets, live owners), `ui/README.md`,
  `BUSINESS_PLAN.md`, `ROADMAP.md`, `CHANGELOG-0.0.36.md`, the two decisions linking a
  moved ARCHITECTURE, ADR #51's snapshots path, `ops/packaging/mobile/README.md`.
- **Pragmed** (`<!-- dead-ref: ok: … -->`) where the path is deliberately wrong:
  dated audit findings naming retired paths, negations ("No crates/oz-* exists"), and
  the wizard-retirement evidence table (5 rows + 1 prose line) whose whole point is to
  record what was deleted. Seven such refs remained at session close, all inside
  `manager-codebase-review-checklist.md` — fenced, see below.

A further ~25 links the house checker misses via its whole-tree basename fallback were
repointed too (launch guides' `../operations/`, `EXTENDING`'s `../../crates/`, the
decisions' `../guides/ARCHITECTURE.md`, `CHANGELOG-0.0.36`'s backlog path, packaging
README's `../../apps/`…).

### 6. The module CHANGELOG rule was a rule nothing satisfied
Root `ARCHITECTURE.md` required every module to carry a `CHANGELOG.md`: 0 of 14 did,
and no tooling reads per-module changelogs (release history lives in the single root
`CHANGELOG.md` plus `docs/releases/CHANGELOG-0.0.XX.md`).

**Fixed the other way**: the requirement was struck from the document with the reason
recorded — a requirement nothing obeys is worse than no requirement, because it teaches
readers that the document lies.

### 7. The entry point never scanned `docs/audits/`
The generator's audit collector reads a root `audit/` folder deleted in `0689d5652` —
its own comment admits the branch has never been true in this file's history — so the
counts line said `0 audits` while eleven real reports (frontend, seo, setup, skills,
and this document) sat outside the page claiming to index "ADRs, audits, verifications,
measurement records and system analyses". Found on 2026-09-23 by the follow-up session
that asked why the count was zero.

**Fixed**: a recursive `docs/audits/` scan joined the records scan's rules (readdir
sorted at each depth for byte-stable `--check`, no front matter required, status read
from the record or the shared em-dash — never invented; area prefers the subdirectory
because it carries the real topic), a `## Audit Reports (docs/audits/)` section renders
it, and the counts line now reads `11 audits`. The legacy `audit/` branch and its
consolidation pointer were left exactly as they are — that DECISION comment says
removing it is a different decision than a typo repair, and it is right.

## Checker blind spots found in passing

- **Basename fallback**: a link to a nonexistent path passes if *any* file with that
  basename exists anywhere in the tree. That hid ~25 real broken links from
  `check-dead-refs` (its 23 vs the strict scan's 148) — including every launch-guide
  `../operations/…` link. **Closed 24-09-26**: link targets now resolve against the
  source file first, and `./`/`../` targets never reach the basename rescue (open
  item 3); path literals in prose keep it deliberately, because docs cite files by
  bare name constantly.
- ~~**HTML-comment lines are not scanned**~~ **Believed wrong 24-09-26**: a probe line
  carrying a dead path inside an HTML comment was flagged on the first try, and this
  audit's own house-checker count included two audit-stamp path claims — a scanner that
  skips comments produces neither. The stamp paths above were precision-corrected
  because they WERE scanned; the blind spot does not exist.
- **Dated records are exempted** by name, which is right for history and wrong when the
  file is a live index pointing into `snapshots/`.
- **`docs/plans/` and `website/` resolve differently**: plan docs legitimately cite
  paths their plans will create, and `website/src/content/docs/` links are site routes
  resolved by the Astro build (`../../login/`, `/en/docs/…`), not filesystem paths.
  A file-based scanner flags ~90 of them; they are not broken. The website deserves a
  site-aware link checker — recorded as open item (4).

## Deliberately not touched

- **`manager-codebase-review-checklist.md` — 7 dead refs, fenced.** Line numbers
  shifted between two runs minutes apart: a peer session was actively writing the file
  (209 → 521 lines during this audit). The first two refs sit inside its in-flight
  additions (an illustrative placeholder path, and a path the prose itself calls
  nonexistent); five more arrived with a section citing pre-rename paths
  (apps/desktop-client, crates/oz-*). <!-- dead-ref: ok: names the pre-rename paths deliberately, to describe what the peer's section cites --> Editing it would race that session; all seven
  need pragmas the moment it goes quiet. This is the *only* file
  `check-dead-refs` reports on — 422 of 423 scanned markdown files are clean — and
  the reason its CI step ships advisory with a written flip condition instead of
  blocking.
- **`docs/plans/**`** — working documents; forward paths are not drift.
- **`website/src/content/docs/**`** — site routes, see above.
- **`.agents/`, `.workbuddy-ai/`** — the agent working corpus, out of scope by house rule.
- **`](url)` literals** — three "broken links" in `seo-robots-llms-review` are a <!-- dead-ref: ok: names the scanner artifact `](url)` on purpose -->
  scanner artifact: the text `](url)` in a table describing link shapes. <!-- dead-ref: ok: this line exists to name the scanner artifact `](url)` itself -->

## Open items (bigger than a link sweep — not attempted here)

1. ~~**Five future-dated ADR files**~~ **Resolved 23-09-26 — re-dated to authored dates
   (owner's call: re-date, not bless-the-convention).** The four `2026-10-04` ADRs and
   `2026-10-11` adr60 all carried drafting-session plan dates no commit could produce;
   `git log -S`/`--follow` pinned authoring **and every recorded event in all five** to
   2026-09-21 (adr60 was born that day in the old ADR series; its 2026-09-23 change was only the
   move into `docs/decisions/`).
   Done: files renamed to `2026-09-21-adrNN-*`, status/Date/table cells and ~70 in-body
   claims corrected, three meta-notes rewritten in place (line counts preserved, so every
   cross-file line anchor still holds), citations repointed (index, hand table, setup-wizard
   audit, two UI test headers), records index regenerated. Superseded labels survive in git
   history; the per-claim attribution table is in the re-date commit.
   **Successor finding — resolved 23-09-26 by the same attribution pass.** The
   2026-09-26/27 claims in ADR #54/#55, `docs/guides/developer/api-reference.md`,
   `docs/operations/runbook.md`, `apps/license-server/DEPLOY.md`,
   `.agents/skills/deploy-northflank/SKILL.md`,
   `docs/records/snapshots/2026-09-21-license-ratelimit-collapse.md`, plus the root
   `todo-sync-endpoint-derivation.md` dated `2026-10-06` were re-dated per line to the
   commit that first asserted each claim: the Google-keys era → 2026-09-20 (adr54 ×15
   incl. the lone 09-27, adr55 ×2, api-reference, runbook ×2, DEPLOY ×2, the SKILL's
   copied measurement), the snapshot → 2026-09-21 (its own event), the Date: line →
   2026-09-22. The sweep also caught four files the finding had not named —
   `scripts/gates.json`'s wiring note, `scripts/verify-deployment.py` ×3, and three
   measurement claims inside `check-dead-refs.py` itself (all minted 09-20), plus
   `datetime.rs`'s `C6` annotation (`26-09-26` → `23-09-26`, minted 2026-09-23).
   Plans, fixtures and deadlines (backlog eligibility, the 2026-11-06 boundary
   expiries, test/JSON data, manager-checklist dates) and this file's own quotations
   of the superseded dates were left as they stand.2. ~~**ADR status-table enforcement**~~ **Resolved 24-09-26 — the comparator is built
   and gated.** `.agents/skills/docs-auditor/scripts/check-adr-status.py` reads the
   hand table in `docs/decisions/README.md` (54 rows) and each linked ADR's own
   frontmatter `status:`, applies exactly the rule that file's Conventions state —
   the status *word* must match, what follows the word may differ — and fails on
   disagreement. Frontmatter beats the header line (#53's header still opens
   `Proposed` while its frontmatter was re-audited to `Adopted`); rows resolve by
   file path, so the documented duplicate #43 checks each file against its own row;
   the Trial & Billing cross-reference table is excluded by design (its cells are
   prose like `Superseded for tier lineup…`, not status words); a row whose file
   cannot be read is a finding, because cannot-verify is not agreement, and an
   unparsable table fails rather than clearing. Chose the house-checker form over a
   `--check` flag on the generator so the auditor self-test runner's uniform
   `python3 --self-test` loop could run it — ten synthetic cases including two
   deliberately red ones (drift, and unverifiable). Wired `check.sh` step
   `adr status drift` (blocking; green from day one at 54/54) and gates.json
   `adr-status` (local-only, like `auditor-selftests`). Same pass corrected two
   stale claims this audit's own tools now catch: this file's roster note in
   gates.json said three self-tests, and decisions/README said #53 had no row.
3. ~~**The house checker itself**~~ **Resolved 24-09-26 — half shipped, half withdrawn
   on evidence.** Shipped: `check-dead-refs.py` now extracts markdown link targets and
   resolves every candidate against the source file's directory first; `./` and `../`
   targets are anchored there — no repo-root retry, no basename fallback — so a stale
   reorg link can no longer pass on the strength of a same-named survivor elsewhere
   (the ~25 hidden breaks this audit repointed by hand). `website/` stays exempt from
   link extraction: its `../../login/` forms are Astro routes until open item 4 lands.
   The HTML-comment half was **withdrawn on evidence**: a probe line carrying a dead
   path inside an HTML comment was flagged on the first try, and this audit's own
   house-checker count included two audit-stamp path claims — only a scanner that reads
   comments produces those. Ten `--self-test` cases now pin the rules (basename rescue
   blocked for `./`/`../`, extraction of the previously invisible forms, source-dir
   anchoring, pragma suppression, the website skip, no double counting), and
   `check-auditor-selftests.sh` runs them beside the other three checkers. The first
   hardened run re-exposed four genuinely dead depth-3 links — QUICKSTART and EXTENDING
   pointing at the root ARCHITECTURE one directory short, the onboarding skill likewise
   at root AGENTS — repointed, plus the three llms.txt `url`-target shape-quotes this
   document already knew about, pragma'd at their source. The live baseline held at
   7 refs in the fenced checklist.
4. **A site-aware link checker for `website/`** — routes vs filesystem paths cannot be
   told apart by a file scanner.

## Re-verification (all run in this session, all green unless noted)

```
node scripts/generate-records-index.mjs --check     # ok, 54 ADRs … 11 audits … 13 records
python3 scripts/verify-ci-docs-drift.py             # 0 drift item(s)
python3 scripts/verify-ci-docs-drift.py --self-test # all cases passed
python3 scripts/test-runner-labels.py               # enforced per-needle, fixture live
bash scripts/test-ci-routing.sh                     # 21/21
sh scripts/test-records-index-escaping.sh           # passed=7 failed=0
python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py
    # 7 refs, all in manager-codebase-review-checklist.md (fenced, see above);
    # every other scanned file is clean
python3 .agents/skills/docs-auditor/scripts/check-orphans.py        # green
python3 .agents/skills/docs-auditor/scripts/check-audit-stamps.py
    # green (exit 0). The two REAL under-reports (committed .agents/reviews
    # footers reading 14-09-26 under a 2026-09-15 stamp) were bumped to the
    # date the checker demanded, and the residual false positive was fixed at
    # the source on 2026-09-23 instead of being documented forever: the
    # checker now skips gitignored paths (one `git check-ignore --stdin` call
    # for the whole tree), because a file git ignores cannot carry a repo
    # claim, and a memory file QUOTING `30-02-26` while discussing impossible
    # dates is not a footer. Tracked and new-but-untracked files remain fully
    # checked; git being unavailable falls back to the old walk-everything
    # behaviour rather than failing open.
python3 scripts/verify-doc-uniqueness.py                          # green
```

> last audited 23-09-26 by docs-auditor
