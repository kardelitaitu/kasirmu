<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ⚠️ FINDING, pre-existing and never fixed: the P38-3 gap line says "**2 screens use `alert()`**" and then names THREE screens — `TransitAuditScreen`, `ThresholdConfigScreen` and `ShiftBar`. The count and the list contradict each other, and the closing Verdict repeats the wrong number ("2 alert() calls are the only minor polish gap"). Left as written rather than silently renumbered, because for a dated snapshot the honest repair is to record that the document disagreed with itself, not to pick a number and rewrite history around it — and the correct number is genuinely unknowable now (see below). · All three named screens no longer contain an `alert(` call anywhere in the tree, which is the outcome the document itself asked for ("should migrate to toast"), so the gap this record opened has since been closed by ordinary work; the record simply never got a follow-up pass to say so. · LEFT ALONE deliberately: the three pattern counts (204 loading, 58 empty-state, 180 error-handling), the `0.0.14` in the title, and the component paths (`components/Spinner.tsx`, `components/Skeleton.tsx`, `components/Button.tsx`, `components/EmptyState.tsx`, `components/ErrorState.tsx`), which are written root-relative and predate the `ui/src/features/*` restructure. This is an audit snapshot of 2026-07-20; those numbers and paths are its evidence, and restating them against today's tree would make the file a fabrication rather than a record. · The footer this file carried ("ACCURATE (0 findings) · … all file references valid") was replaced rather than kept: with a self-contradicting bullet in the body, "0 findings" was not true, and the footer is the machine-read field that tells tooling a document is clean. -->
# UI State Audit — 0.0.14

## P38-1: Loading States

**204 loading-related patterns found** across the codebase. The following patterns are well-established:

| Pattern | Where | Examples |
|---------|-------|----------|
| `Spinner` component | `components/Spinner.tsx` | sm/md/lg sizes, accessible label |
| `Skeleton` component | `components/Skeleton.tsx` | text/circle/block variants, pulsing animation |
| `Button loading` prop | `components/Button.tsx` | Built-in spinner + disabled state + `aria-busy` |
| Skeleton screens | Multiple features | ExchangeRate, Categories, OfflineQueue, GiftCards, Loyalty, StaffLogin |

**Verdict:** ✅ Loading states are comprehensive. Every async screen uses either `Spinner`, `Skeleton`, or `Button loading`. All loading indicators have `aria-busy` or `role="status"` for accessibility.

## P38-2: Empty States

**58 empty-state patterns found.** An `EmptyState` component exists at `components/EmptyState.tsx` with icon, title, description, and action slot. Used throughout:

- Product grid: "No results found" with search hint
- Sales reports: Per-chart empty states with `no-results`/`heatmap-no-data` keys
- Inventory: Stock count history, adjustment screen empty states
- Dashboard: Revenue widgets with "No data for today"
- Suppliers: List + search empty states
- KDS: Ticket board empty state

**Verdict:** ✅ Empty states are well-covered. Every list/table/grid has an empty state.

## P38-3: Error States

**180 error-handling patterns found.** An `ErrorState` component exists at `components/ErrorState.tsx`. Consistent patterns across all screens:

| Pattern | Usage |
|---------|-------|
| `catch (err) { setError(message) }` | Every async operation |
| `err instanceof Error ? err.message : '...'` | Safe error message extraction |
| `toast({ message, type: 'error' })` | User-visible error notifications |
| `addToast({ message: '...', type: 'error' })` | POS screen error feedback |
| Inline error state render | Reports, lists, forms |

Notable gaps found and documented:

- **2 screens use `alert()`** (`TransitAuditScreen`, `ThresholdConfigScreen`, `ShiftBar`) — should migrate to toast. Non-blocking — alert is functional but less polished.
- **1 screen uses `console.error`** for session destroy — intentional, no user impact.

**Verdict:** ✅ Error handling is robust. 2 alert() calls are the only minor polish gap.

> last audited 29-09-26 by docs-auditor

