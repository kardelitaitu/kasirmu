# UI Wiring & Element Audit Plan — kasir.mu Desktop App

- **Audit ID:** 2026-07-23-ui-wiring-audit
- **Status:** Planning — report delivered (see §8)
- **Scope:** `ui/src/features/settings/` and related Settings UI in the React/TypeScript front-end used by `apps/desktop-client/` (Tauri Windows app)
- **Out of scope:** Rust/Tauri command layer, database, API contracts, styling-only issues, tablet client, other feature areas
- **Goal:** Identify every interactive element in Settings screens and verify whether it is correctly wired to its handler, state, and side-effect. Produce a Markdown findings report first; no code fixes until the report is reviewed.

---

## 1. Current baseline (quick scan)

| Metric | Count | Notes |
|--------|-------|-------|
| Settings screens | TBD | `ui/src/features/settings/` + `SettingsPopup`, `SettingsNavTree`, etc. |
| `<Button>` usages | TBD | To be counted per Settings screen |
| Raw `<button>` usages | TBD | To be counted per Settings screen |
| `onClick=` handlers | TBD | To be counted per Settings screen |
| Inputs / toggles | TBD | To be counted per Settings screen |

**Scope clarification:** This audit focuses only on the Settings area. Other feature areas (sales, inventory, reports, etc.) are out of scope.

---

## 2. Audit categories

### 2.1 Button wiring consistency

Verify for every interactive button in the app:

| Check | Pass criteria |
|-------|---------------|
| **Component choice** | Prefer `<Button>` over raw `<button>` unless there is a documented reason (e.g., shell UI, icon-only, custom animations). |
| **Type attribute** | Every button inside or near a `<form>` has explicit `type="button"` or `type="submit"` as intended. |
| **Disabled state** | `disabled` is wired to loading/error states; destructive actions disable while in-flight. |
| **Loading state** | Async actions use `loading` / `state="processing"` to show spinner and prevent double-submission. |
| **Click handler** | `onClick` is defined and not an inline `() => undefined` or stale closure. |
| **Keyboard accessibility** | Buttons are reachable by keyboard; icon-only buttons have `aria-label`. |
| **Double-submit prevention** | Forms and modals disable submit while the mutation is pending. |

### 2.2 Form wiring

| Check | Pass criteria |
|-------|---------------|
| **Submit wiring** | `<form onSubmit={handleSubmit}>` is used instead of relying solely on `onClick`. |
| **Validation feedback** | Required fields disable submit until valid; inline errors appear on blur/submit. |
| **Reset / cancel** | Cancel buttons have `type="button"` and close/clean state without submitting. |
| **Enter key behavior** | Pressing Enter in a single-field form triggers submit as expected. |

### 2.3 Modal & dialog wiring

| Check | Pass criteria |
|-------|---------------|
| **ConfirmDialog** | Destructive actions use `ConfirmDialog`; native `confirm()` should be gone. |
| **Close wiring** | Close button, backdrop click, and Escape key all route through the same cancel/cleanup logic. |
| **Focus trap** | Focus remains inside the modal while open. |
| **Action disable** | Confirm button is disabled while the async action runs. |

### 2.4 Navigation & route wiring

| Check | Pass criteria |
|-------|---------------|
| **Nav items** | Shell navigation buttons route to the correct route and update active state. |
| **Workspace switching** | `WorkspaceHome` cards correctly call `setActiveWorkspace` and handle loading/error states. |
| **Back / cancel** | Back buttons restore the previous view or close the current overlay. |

### 2.5 Toast & error wiring

| Check | Pass criteria |
|-------|---------------|
| **Success feedback** | User-triggered mutations show a success toast. |
| **Error feedback** | Failed actions surface user-readable errors via `ErrorState`, toast, or inline message. |
| **Remaining `alert()`** | Remove or migrate the remaining native `alert()` calls (noted in UI state audit). |

### 2.6 Test coverage for wiring

| Check | Pass criteria |
|-------|---------------|
| **Handler invocation** | Tests fire clicks and assert the correct handler is called with expected args. |
| **Disabled behavior** | Tests verify submit button is disabled when invalid/loading. |
| **Loading state** | Tests verify spinner/aria-busy appears during async operations. |
| **Mock fidelity** | Test mocks use the real `<Button>` component where possible rather than a fake `<button>`. |

---

## 3. Methodology

### 3.1 Automated inventory

Run mechanical searches to produce a baseline spreadsheet:

```bash
cd ui

# Count Button vs raw button
npx grep-tool "<Button" src --ext tsx
npx grep-tool "<button" src --ext tsx

# Find raw buttons missing explicit type inside forms
npx grep-tool "<button" src --ext tsx -A 2 -B 1 | grep -v 'type="button"\|type="submit"'

# Find onClick handlers on non-button elements
npx grep-tool "onClick=" src --ext tsx | grep -v "<Button\|<button"

# Find loading vs state="processing" usage
npx grep-tool "loading" src --ext tsx
npx grep-tool 'state="processing"' src --ext tsx
```

> *Use the existing `code_searcher` results as the seed; transform them into a tracked artifact in this folder.*

### 3.2 Manual review matrix

For each major feature under `ui/src/features/`, fill out a matrix row:

| Feature | Primary buttons | Forms | Modals | A11y issues | Wiring bugs | Tests cover wiring? |
|---------|-----------------|-------|--------|-------------|-------------|---------------------|
| sales/CartScreen | ... | ... | ... | ... | ... | ... |
| sales/PaymentModal | ... | ... | ... | ... | ... | ... |
| inventory/StockCountForm | ... | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... |

### 3.3 Static code audit (no test runs)

Audit the code directly without executing tests:

- Read each Settings screen file.
- Map every interactive element to its handler.
- Verify `type` attributes on raw `<button>` elements.
- Verify `onClick` / `onSubmit` / `onChange` wiring.
- Verify `disabled` and `loading` state wiring.
- Note any `ConfirmDialog`, `alert()`, or native `confirm()` usage.

### 3.4 Accessibility spot-check (static)

While reading the code, check:
- Icon-only buttons have `aria-label`.
- Disabled buttons are communicated via `disabled` or `aria-disabled`.
- Form inputs have associated labels or `aria-label`.

---

## 4. Deliverables

1. **Markdown findings report** — every Settings interactive element, its intended action, wiring status, and any gap.
2. **Element wiring table** — per-screen inventory with file/line references.
3. **Prioritized gap list** — elements that need wiring or fixes, grouped by severity.
4. **(Future) Fix PRs** — only after the report is approved.

---

## 5. Suggested phases

| Phase | Duration | Activities |
|-------|----------|------------|
| **Phase 1 — Inventory** | 1 session | List every Settings screen and every interactive element (button, input, select, toggle, dialog). |
| **Phase 2 — Per-element wiring audit** | 2–3 sessions | For each element, verify its handler, type, disabled/loading state, and side-effect. |
| **Phase 3 — Findings report** | 1 session | Produce a Markdown report with all elements, their wiring status, and any gaps. |
| **Phase 4 — Fix backlog (future)** | TBD | After report review, schedule fixes. Not part of this audit pass. |

---

## 6. Definition of done

- Every interactive button in scope has been classified and its wiring verified against the checklist.
- All payment, login, and destructive-action flows have explicit test coverage or documented gaps.
- No raw `<button>` remains inside a `<form>` without an explicit `type`.
- `ConfirmDialog` is used for all destructive confirmations; native `confirm()` / `alert()` are removed.
- Report is approved and converted into actionable GitHub/Jira issues.

---

## 8. Related documents

- `docs/specs/_active/2026-07-23-ui-wiring-audit-report.md` — findings report for this audit

- `docs/ui-state-audit-2026-07-20.md` — loading, empty, and error state coverage
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` — desktop app security/integrity audit
- `ui/src/components/Button.tsx` — design-system button
- `ui/src/__tests__/Button.test.tsx` — button component tests

---

*End of plan.*
