# Admin tool routes drop back to the workspace picker — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 202 · status: REAL DEFECT found by running
     the untouched E2E suite; 6 failures traced to ONE cause — every admin tool route except
     settings clears the active workspace. Fix NOT applied: the clearing site is unlocated and
     the change is behavioural · branch: 0.0.41 · commit: none -->

<!-- Scope: run E2E batches I had not exercised, and treat failures as findings. -->

## The failure, and how it looked first

A batch of untouched specs: **7 passed, 6 failed, 5 skipped.** All six failures shared one
symptom — `.shift-mgmt` never became visible — and the reflex explanation is "stale selector".
It is not. The screen exists, is registered, and renders the class; the test never reaches it.

## The reproduction

```
loginAs(page, 'admin', '9999')
selectWorkspace(page, WORKSPACES.ADMIN)     -> #/settings, picker absent   (correct)
navigateTo(page, 'shifts')                  -> #/shifts,  PICKER VISIBLE    (wrong)
```

The hash is `#/shifts` but `AppShell` renders `WorkspaceHome`, which it only does when
`!activeWorkspace` (`AppShell.tsx:708`). So the navigation CLEARED the active workspace.

## The scope is the finding, not the one spec

I probed every admin tool route from the same starting state:

| route | hash after | picker? | resolves? |
|---|---|---|---|
| `settings` | `#/settings` | no | **yes** |
| `shifts` | `#/shifts` | **yes** | **no** |
| `audit` | `#/audit` | **yes** | **no** |
| `terminals` | `#/terminals` | **yes** | **no** |
| `memo` | `#/memo` | **yes** | **no** |

**Every admin tool route except settings is unreachable by navigation from inside the workspace.**
Settings works because it IS the admin default (`:359`), so the shell is already there.

## It is admin-specific

The same probe from the WAREHOUSE workspace keeps working:

```
warehouse + navigateTo("audit")  -> #/audit, picker: false   (correct)
admin     + navigateTo("shifts") -> #/shifts, picker: TRUE   (wrong)
```

So this is not a general routing bug. Something in the ADMIN path clears the workspace when the
hash names a page that is not the default.

## What I ruled out, each by measurement

| hypothesis | how it was killed |
|---|---|
| stale `.shift-mgmt` selector | the live file renders it and the class list confirms it |
| `selectWorkspace(ADMIN)` fails | probed directly: it reaches `#/settings` with the settings sidebar, every time |
| raw `window.location.hash =` fires no hashchange | the shared `navigateTo` helper dispatches one explicitly, and it fails identically |
| the route is unregistered | `registerShiftsFeature` is wired in `features/index.ts:92`, same as four working features |
| the permission is not granted | the dev-mock grants `shifts:view_any` (`dev-mock/handlers/system.ts:70`) |
| `AppShell` syncFromHash clears it | read in full (`:372-419`): it only calls `setCurrentRoute`, never touches the workspace |

## Why the fix is NOT in this round

The one effect that DOES deliberately clear a workspace is `AppShell.tsx:337-342`, which sets
`window.location.hash = ''` when `activeWorkspace` goes falsy. That is the right SHAPE but the
wrong direction — it reacts to the workspace clearing, it does not cause it. The actual clearing
site is not yet located, and the change would be behavioural on a shared route.

**Recording it with a reproduction is the correct output of this round.** The alternative —
guessing at WorkspaceContext and shipping an unverified change to shared navigation — is the
mistake this session has already measured twice (rounds 177, 189).

## Impact, stated concretely

- **Two specs fail at HEAD**: `shift.spec.ts` (5 cases) and `e2e-shift-reconciliation.spec.ts` (1).
- Shift management is a **cash-control** surface: open, close, and cash payout.
- If this is user-reachable, an operator cannot open Shifts, Audit, Terminals or Memo from the
  admin workspace by navigation at all.

## Verified

| check | result |
|---|---|
| E2E batch | 7 passed, **6 failed**, 5 skipped |
| both shift specs | fail, same root cause |
| route probe | 1 of 5 admin tool routes resolves |
| workspace probe | warehouse unaffected, admin affected |
| six alternative hypotheses | each measured and ruled out |
| production change | **none** — the cause is unlocated and the fix is behavioural |

## Carried forward

1. **Locate the clearing site next.** The reproduction is exact and cheap: `admin -> #/settings
   -> #/shifts` and watch `activeWorkspace`. Start at `WorkspaceContext` (`:215`, :304-316`)
   and at whatever mounts the per-route page.
2. This is the first **user-visible** defect found since round 193, and it came from running the
   suite rather than scanning it. Three rounds of static analysis returned zero; one batch of
   E2E returned a five-route regression.

> last audited 18-10-26 by docs-auditor
