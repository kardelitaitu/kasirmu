<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with a prior marker re-verified rather than replaced. It audits the documentation folder itself, and it belongs to a family this campaign has now audited three members of — the same sweep on an earlier date, the crawler-directives review, and the front-end style verification page. That family is the repository auditing its own documentation as a first-class subject rather than tidying it opportunistically, and it is the reason this campaign could work from a queue at all. · WHAT THESE SELF-AUDITS BUY, stated plainly because it is not obvious. A tree of several hundred documents cannot be kept accurate by reading it; it needs a map. The audits in this family establish where the structural problems are — unresolvable links, files a generator no longer scans, sections describing a state the code has left — and this campaign has then been able to walk the oldest-first queue, verify each claim against the tree, and stamp it. The map is not the territory, but without it a tree this size degrades silently rather than visibly. · THE SCOPE IS DELIBERATELY FOLDER-WIDE RATHER THAN FILE-WIDE, and the distinction is the same one this campaign has applied throughout: a structural audit catches links, orphans, stale status lines and duplicated stamps, which are the failures that SPREAD. A claim inside a document can only be checked by reading the document, and a folder audit does not pretend otherwise. · WHERE THIS SITS RELATIVE TO THE EARLIER SWEEP, because the two are the same instrument pointed at the same tree days apart and the comparison is informative. The earlier sweep recorded a whole-tree link scan finding far more broken references than the shipped checker did, filing the difference as a checker coverage gap. This later one runs against a tree this campaign has been repairing file by file for weeks. Together they show the map improving, which is a more useful signal than either alone. · NOT re-measured: the findings themselves — a point-in-time inventory of a tree that is actively changing, including by this campaign. · Prior marker retained; footer re-dated to match the new stamp. -->
# docs/ Folder Audit — 2026-09-28

<!-- Superseded audit marker (2026-09-28, body kept verbatim) · docs-auditor · status: CORE SURFACE PASS · 2 footer drifts fixed (Phase 1, 54e197ffa); 2 undocumented license-server env vars documented (Phase 2, 3ad81c4b4); api-reference.md deep-audited separately (Phase 3, 1abb0f0c5). Only outstanding item is the api-reference.md remediation, queued as a follow-up. -->

**Scope:** the `docs/` tree plus the doc-relevant checkers from `.agents/skills/docs-auditor/scripts/`.
**Result:** PASS on the core documentation surface. One known-red area (`api-reference.md`) characterized and tracked separately.

---

## 1. Checker results (final snapshot)

| Checker | Scope | Result | Note |
|---|---|---|---|
| `check-dead-refs.py` | all live docs (126 dated records skipped) | **0 unresolved** in 0 live docs | clean |
| `check-orphans.py` | all tracked `*.md` | **0 findings** (A/B/C) | clean |
| `check-adr-status.py` | `docs/decisions` index | **0 drift** / 54 hand-table rows | clean |
| `check-ci-claims.py` | live docs | **0 findings inside `docs/`** | 3 findings exist but live in `.agents/planning/` and `.agents/skills/` — out of `docs/` scope |
| `check-audit-stamps.py` | all `*.md` | **0 OLDER** | 2 drifts fixed in this audit (Phase 1); 62 newer / 49 footer-no-stamp / 28 stamp-no-footer are informational, not failures; 0 impossible dates |
| `check-env-docs.py` | license-server vars | **0 undocumented (34/34)** | 2 fixed in this audit (Phase 2) |
| `check-api-surface.py` | `api-reference.md` | **163 discrepancies** | red against it by design; deep-audited separately (Phase 3) |

The `docs/` folder is in good shape: no dead references, no orphans, no ADR-status drift, and no CI-claim lies inside `docs/`.

## 2. Actions taken this audit (phased, each committed separately)

### Phase 1 — footer drift (commit `54e197ffa`)
Two stale footers at the repo root were bumped to their newest stamp date:
- `done-todo-review-type.md` — footer `15-09-26` → `24-09-26` (real footer at line 30).
- `done-todo-owner-rulings.md` — had **no** real footer; the checker's `08-09-26` flag was a false positive on prose quoting AGENTS.md. Appended a genuine footer `> last audited 24-09-26 by docs-auditor` at the file end.

Verified after: `check-audit-stamps.py` reports `footer OLDER than newest stamp: 0`.

### Phase 2 — undocumented license-server env vars (commit `3ad81c4b4`)
`LICENSE_CLIENTIP_MODE` and `LICENSE_TRUSTED_HOPS` (read in `apps/license-server/helpers.go:188` and `:206`) were named in no document. Added a "Read from `apps/license-server/helpers.go`" table to `apps/license-server/DEPLOY.md` §7.7 with exact defaults and fail-safe behaviour, and corrected the now-stale "0 undocumented" baseline note.

Verified after: `check-env-docs.py` reports `all 34 code-read variables are named in a doc`.

### Phase 3 — `api-reference.md` deep audit (commit `1abb0f0c5`)
Full anchor-by-anchor enumeration, validation against client source, and a remediation plan are in the companion file **`docs/audits/2026-09-28-api-reference-audit.md`**. Summary of the 163 discrepancies:
- **101** `listed_not_defined` — documented commands absent from both clients (traced via `git log -S` to historical removal/rename, not doc invention).
- **49** `registered_not_listed` — live registered commands missing from the page.
- **10** `marker_wrong` — availability marker `[D]` should be `[D+T]`.
- **3** `listed_not_registered` — defined as `#[command]` but absent from `generate_handler!`.

## 3. Outstanding / informational

- **api-reference.md remediation** is a separate scoped task. It needs (a) a decision on whether the page is the generated truth or a curated subset, (b) per-name tracing of the 101 phantom entries, and (c) wiring `check-api-surface.py` into `check.sh`/`gates.json` behind a new baseline. Not performed here.
- The `49` stamped-but-no-footer and `28` footer-but-no-stamp counts from `check-audit-stamps.py` are informational classes (a doc can legitimately carry a stamp without a footer, or vice-versa); they do not affect the exit code and were left as-is.

## 4. Conclusion

The core `docs/` surface is accurate and traceable. Every actionable finding surfaced by this audit has been resolved and verified by its own checker, with one exception: `api-reference.md`, which is now characterized and queued for a dedicated remediation pass rather than a blanket edit.

> last audited 29-09-26 by docs-auditor
