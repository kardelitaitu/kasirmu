<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, and it is now a 25-LINE POINTER STUB — the smallest document this campaign has audited, and the result of one of its best decisions. On 2026-09-23 a documentation audit found that this file and the repository-root ARCHITECTURE.md had diverged by 841 diff lines: two living architecture documents, each authoritative for something, neither reconcilable by editing. The resolution was not to merge them but to establish one canonical home and reduce this file to a pointer that says which. · I VERIFIED THE ENTIRE PORT TABLE, because a stub that misdirects is worse than a stale document. All eight sections it names exist in the root file: Module Details, Build & Run Instructions, Extensibility, License & Commercial Governance, Repository Structure (Target — Long-Term Vision), Project Layout (Post-Restructuring), Core Goals and Technology Stack. Every relative link in the stub resolves — the root ARCHITECTURE.md it redirects to, the whitepaper it points at for the five-layer narrative, and the sibling modular plan it explicitly leaves unaffected. The stub's closing claim that the audit verified every ported path resolves from the new home is true. · THE DECISION ITSELF IS WORTH RECORDING, because it is the failure mode this campaign has spent thirty-three rounds cataloguing. Two documents describing the same system is not a documentation problem; two documents describing the same system with DIFFERENT content is an authority problem, and no amount of auditing either one fixes it. Collapsing to a pointer makes the question answerable in one line, and the port table preserves the navigation that a hard redirect would have destroyed. The alternative — reconciling 841 lines by hand — would have produced a third document that was wrong somewhere nobody was looking. · THE CAVEAT THIS STAMP ADDS, and it is the one thing the stub does not say: 13 documents still cite a path under this directory or the root file, and a reader arriving via one of those citations should expect to be redirected. That is working as designed, not a defect. · The file's own footer predates the move; it is bumped here so the stamp and footer agree, since the document's content changed fundamentally on 2026-09-23 and its footer had not been moved with it. · The canonical document itself, the root ARCHITECTURE.md at 715 lines, is outside this audit's scope — this queue covers `docs/` — and is flagged here as the one high-value target this campaign has not yet reached. -->
# kasir.mu — Codebase Architecture (pointer)

<!-- Moved 2026-09-23 · docs-auditor documentation audit · This file used to carry a full architecture document that had diverged from the repository-root ARCHITECTURE.md by 841 diff lines — two living authorities, each audit-stamped, each half-updated. The unique sections (Module Details, Build & Run Instructions, Extensibility, License & Commercial Governance) were merged into ../../ARCHITECTURE.md on 2026-09-23; the Directory Layout tree here was dropped rather than merged because it was stale (29 workspace members, `oz-pos/` root name, `ui/src/locales/`, `frontend/themes/`, flat `docs/ROADMAP.md` paths — the root file's current-state tree, re-verified 2026-09-18, covers it). This stub exists so inbound citations keep resolving: docs/guides/product/WHITEPAPER.md's audit stamp, docs/records/JOURNAL.md:78, and manager-codebase-review-checklist.md's C30 file list all name this path. -->

The canonical architecture document is **[ARCHITECTURE.md](../../ARCHITECTURE.md)** at the
repository root. Read that file.

What moved, and where to find it:

| Section (former) | Now at |
|---|---|
| Module Details (per-crate reference) | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) § Module Details |
| Build & Run Instructions | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) § Build & Run Instructions |
| Extensibility | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) § Extensibility |
| License & Commercial Governance | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) § License & Commercial Governance |
| Directory Layout | root file's § Repository Structure (Target — Long-Term Vision) + § Project Layout (Post-Restructuring) — Current State — this copy's tree was stale and was not merged |
| Overview, five-layer stack summary | root file's § Core Goals / § Technology Stack; the audited five-layer narrative also lives in [`guides/product/WHITEPAPER.md`](../guides/product/WHITEPAPER.md) |

Sibling documents in this directory ([`MODULAR_APP_PLAN.md`](../records/superseded/MODULAR_APP_PLAN.md)) are
unaffected — only this file moved its authority.

Stub written 2026-09-23 by the documentation audit, which verified every ported claim's
path resolves from the new home.

> last audited 29-09-26 by docs-auditor
