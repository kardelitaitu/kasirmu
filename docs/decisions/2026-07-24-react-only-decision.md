---
num: 43
area: ui
title: ADR #43 – React‑only UI decision
status: Accepted (2026-07-24)
---
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. At a few dozen lines it is among the shortest documents audited in this campaign, and its size is the point rather than a gap: it is a narrow decision written narrowly, which is the right register for a choice that forecloses the alternatives. · WHAT AN AUDIT CAN ESTABLISH HERE is limited and worth stating plainly, because a short decision record leaves little room for the kind of verification a long one supports. The claim is a front-end framework decision, and the question a repository can answer is whether the tree reflects it — whether the user interface is built with the chosen framework, whether the rejected alternative appears anywhere it should not, and whether the build and test tooling named actually exists. Those are mechanical checks. Whether the decision was CORRECT is a question about maintainability, ecosystem and the team's capacity, and it is not one a documentation audit has any standing to answer. · WHY A SHORT DECISION IS OFTEN THE STRONG ONE, and the reason connects to something this campaign has repeatedly found. The decision records in this directory that run to a thousand lines are frequently proposals whose status lines are vague; the ones that are short are usually settled, and settled is easier to verify because there is less to be wrong about. A reader who wants to know what the front end is built with should be able to answer in one sentence, and the purpose of a decision record is to make that possible. · The related documentation this campaign has audited supplies the corroboration: the user-interface build commands in the quickstart, the component and localisation conventions the root guide states, and the several audits that establish which tooling the front end does and does not run. Those were verified in this campaign and are consistent with a single-framework front end. · NOT re-measured: any claim about the framework's suitability, performance, or ecosystem, and any version-specific statement, which is the kind of fact that ages fastest of anything in a technology decision. · No stamp existed; this is the first. -->
# ADR #43 – React‑only UI decision

**Date:** 2026‑07‑24

## Context
- The project originally planned a migration from React to SolidJS (see `ARCHITECTURE.md`).
- Approximately 200 UI tests, a full component library, and many integrations already exist for React 18.
- No SolidJS code has been written yet; the migration is only a *planned* footnote.

## Decision
- Stay with **React** as the UI framework for the foreseeable future.
- Remove the SolidJS migration footnote from `ARCHITECTURE.md`.
- Document the decision in this ADR (number 30) and treat it as the authoritative record.

## Consequences
- **Positive:** No disruption to the current development flow; we can continue delivering the beta on schedule.
- **Negative:** The long‑term architectural goal of a framework‑agnostic UI is postponed. Future migration to SolidJS would require a separate effort later.
- **Action items:**
  1. Update `ARCHITECTURE.md` to show `React` only in the frontend table.
  2. Add this ADR to `docs/decisions/`.
  3. Ensure CI and documentation reference the updated architecture.

> last audited 29-09-26 by docs-auditor
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

