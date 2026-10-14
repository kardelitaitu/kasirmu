---
num: 43
area: ui
title: ADR #43 – React‑only UI decision
status: Accepted (2026-07-24)
---
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor, 1 structural) · Fresh full audit; the 2026-09-29 body is merged below as original evidence. · MINOR (the record cites the wrong ADR number for itself): the §Decision bullet read "Document the decision in this ADR (number 30)". The front matter is `num: 43`, and #30 in this directory is "Domain Module Extraction" — a different decision — so a reader following the citation lands on the wrong record. Corrected to #43 in place, with the reason. · STRUCTURAL (stranded footer — the class documented 2026-10-11): the `> last audited` footer sat at line 30 with TWO stale blockquote lines below it (`> audit: Phase 1 Core Architecture & API Docs Audit` and `> status: ACCURATE (0 findings) · … cargo check passed …`). Content after the footer is invisible to `detect.sh` Check 9/10 and to `check-audit-stamps.py`. Those three lines are merged into this stamp; the footer is now the last non-empty line. · VERIFIED AND LEFT ALONE, re-measured: the ADR's core action ("Remove the SolidJS migration footnote from ARCHITECTURE.md") is DONE — `ARCHITECTURE.md` contains no `Solid` reference and does name React; and `ui/package.json` has zero `solid-js` dependency with React + react-dom + @fluent/react + qrcode.react + react-window present, so the React-only decision holds in the tree. · NOT re-measured: the "approximately 200 UI tests" context figure (a point-in-time count) and the framework-suitability reasoning (a judgment an audit cannot settle). · Prior stamp retained verbatim below. -->
<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — the superseded 2026-09-29 body and the two stale trailing lines are kept here as blockquote text (not nested in an HTML comment — nesting closes the outer comment early):

> Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. At a few dozen lines it is among the shortest documents audited in this campaign, and its size is the point rather than a gap: it is a narrow decision written narrowly, which is the right register for a choice that forecloses the alternatives. · WHAT AN AUDIT CAN ESTABLISH HERE is limited and worth stating plainly, because a short decision record leaves little room for the kind of verification a long one supports. The claim is a front-end framework decision, and the question a repository can answer is whether the tree reflects it — whether the user interface is built with the chosen framework, whether the rejected alternative appears anywhere it should not, and whether the build and test tooling named actually exists. Those are mechanical checks. Whether the decision was CORRECT is a question about maintainability, ecosystem and the team's capacity, and it is not one a documentation audit has any standing to answer. · WHY A SHORT DECISION IS OFTEN THE STRONG ONE, and the reason connects to something this campaign has repeatedly found. The decision records in this directory that run to a thousand lines are frequently proposals whose status lines are vague; the ones that are short are usually settled, and settled is easier to verify because there is less to be wrong about. A reader who wants to know what the front end is built with should be able to answer in one sentence, and the purpose of a decision record is to make that possible. · The related documentation this campaign has audited supplies the corroboration: the user-interface build commands in the quickstart, the component and localisation conventions the root guide states, and the several audits that establish which tooling the front end does and does not run. Those were verified in this campaign and are consistent with a single-framework front end. · NOT re-measured: any claim about the framework's suitability, performance, or ecosystem, and any version-specific statement, which is the kind of fact that ages fastest of anything in a technology decision. · No stamp existed; this is the first.
>
> audit: Phase 1 Core Architecture & API Docs Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
-->
# ADR #43 – React‑only UI decision

**Date:** 2026‑07‑24

## Context
- The project originally planned a migration from React to SolidJS (see `ARCHITECTURE.md`).
- Approximately 200 UI tests, a full component library, and many integrations already exist for React 18.
- No SolidJS code has been written yet; the migration is only a *planned* footnote.

## Decision
- Stay with **React** as the UI framework for the foreseeable future.
- Remove the SolidJS migration footnote from `ARCHITECTURE.md`.
- Document the decision in this ADR (**#43** — the body originally said "number 30", which is the *other* ADR in this directory, "Domain Module Extraction"; the front matter `num: 43` is correct and this is the React-only decision) and treat it as the authoritative record.

## Consequences
- **Positive:** No disruption to the current development flow; we can continue delivering the beta on schedule.
- **Negative:** The long‑term architectural goal of a framework‑agnostic UI is postponed. Future migration to SolidJS would require a separate effort later.
- **Action items:**
  1. Update `ARCHITECTURE.md` to show `React` only in the frontend table.
  2. Add this ADR to `docs/decisions/`.
  3. Ensure CI and documentation reference the updated architecture.

> last audited 11-10-26 by docs-auditor
