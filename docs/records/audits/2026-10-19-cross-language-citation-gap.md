# 155 UI comments cite a Rust line number, and no gate checks them (2026-10-19)

## The gap

`ui/src/__tests__/featureCommentPaths.test.ts` polices line citations **inside
`ui/src/features/**`**. It resolves both same-file (`:NNN`) and cross-file
(`name.tsx:NNN`) references, but only between TypeScript files.

A separate form exists and is unchecked: a UI comment citing a **Rust** line, e.g.

    // requires `sales:process` (kasirmu-bridge/src/history.rs:309)

`name.rs:NNN` does not match the guard's extension set, so it is skipped entirely. Measured
2026-10-19: **155 such references** across the UI tree, led by
`features/sales/SalesHistoryScreen.tsx` (11), `dev-mock/handlers/system.ts` (8) and
`api/sales.ts` (7).

## How much of it is wrong

Spot-checked four cites against the file each one names:

| UI cite | Rust target | Verdict |
|---|---|---|
| SalesHistoryScreen 252 | `kasirmu-bridge/src/staff.rs:349` | **correct** — the `require_permission_for_user(… STAFF_READ)` line |
| SalesHistoryScreen 293 | `kasirmu-bridge/src/void.rs:56` | **correct** — `require_session_permission(… SALES_VOID)` |
| SalesHistoryScreen 308 | `kasirmu-reporting/src/margin.rs:93` | **correct** — `COALESCE(sl.cost_minor, p.cost_minor, 0)` |
| SalesHistoryScreen 287 | `kasirmu-bridge/src/history.rs:309` | **WRONG** — that line is `resolve_store`; the permission gate is two lines above |

So three of four are sound and the class is not broadly rotten. But the one miss is
instructive: the wrong line was still *inside the right function*, which is exactly the shape a
reader trusts without checking. It was replaced with the
`require_session_permission(…, permissions::SALES_PROCESS)` expression.

## Why this is a record and not a fix

Closing the gap properly means teaching a checker to parse Rust for an identifier, which is a
real piece of work and was not attempted here. The honest state is: **155 unchecked references,
sampled once, 1 of 4 sampled drifted and was corrected.**

The actionable advice is narrower than "audit them all": when a UI comment must point into Rust,
name the **function or expression** rather than the line, because nothing on the UI side will
ever notice the line moving.

> status: OPEN — the citation was fixed; the gate gap is recorded, not closed

> last audited 19-10-26 by docs-auditor
