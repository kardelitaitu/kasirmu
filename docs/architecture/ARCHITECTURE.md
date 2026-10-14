<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor) · Re-audit of the pointer stub; the 2026-09-29 stamp is merged at the bottom as original evidence. · THE STUB'S ONE JOB IS TO MISDIRECT NOBODY, and it still does that job — all eight portal targets resolve in the root file, and every relative link here lands. Both repairs are counts, which is the stock-in-trade of a page whose body is a table of destinations. · MINOR 1: the 2026-09-29 stamp called this "a 25-LINE POINTER STUB"; it is 27 lines today. A line count in a stamp is a reading, not a property of the file — corrected with the date it was read. · MINOR 2: that stamp noted "13 documents still cite a path under this directory or the root file". That was a 2026-09-29 reading; by 2026-10-11 the directory holds FIVE other documents (`UX_GUIDELINES.md`, `CRITICAL_PATH_INVARIANTS.md`, `module-boot-sequence.md`, `module-namespace-firewall.md`, `module-namespace-governance.md`) and the tree cites this directory from 47 files. The count mattered because the stub's whole justification is that inbound citations keep resolving, so what a reader needs is the DIRECTION of the number, not its value. · LEFT AS WRITTEN, and this is the point of a stub: the portal table, the explanation of why the directory-layout tree was dropped rather than merged, and the note that sibling documents are unaffected. · ALSO LEFT AS WRITTEN: the body's "Stub written 2026-09-23 … verified every ported claim's path resolves from the new home" — that was true when written and re-verified true today. · NOT re-measured: the root ARCHITECTURE.md's own content (730 lines at HEAD, against the 715 this stub's stamp cited) — that file is the canonical document and carries its own audit separately. · Prior 2026-09-29 stamp retained as original evidence. -->
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

> last audited 11-10-26 by docs-auditor
