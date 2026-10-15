# F10 opens a modal that throws: the fourth F4 guard was unreachable, and why (round 231)

## What the round set out to do

Rounds 223, 227 and 230 covered the restaurant feature's three F4 load-failure guards, and round
230's record closed with: *"whatever the next restaurant screen is, its F4 guard should be the
first thing to look for."* A sweep for `loadFailed` found a fourth — `WorkspaceRestaurantPosSettings`,
the same restaurant-POS setting surface reached through the workspace settings modal, whose own
comment names the cross-reference (`:48-52`) and describes the identical defect:

> without it the catch below seeded `courseFiring: false` into `originalsRef`, so a failed read
> looked clean and the next Save wrote that false over the merchant's real setting.

## What reaching for it found instead

F10 opens the modal (`AppShell.tsx:435-459`) and it **always throws**:

```
Workspace Settings | Admin Settings | Something went wrong
useSettings must be used within a <SettingsProvider>
Try Again
```

**Measured with no injection of any kind**, so it is not an artefact of the failure seam:

```
AppShell.tsx renders <WorkspaceSettingsModal> for F10 (:435-459)
SettingsProvider is rendered ONLY inside SettingsPage.tsx:108
WorkspaceRestaurantPosSettings.tsx:34 calls useSettings()
```

So the modal works when opened **from the settings page** and throws from **every workspace** —
including the restaurant POS, where F10 is documented as the way in for all workspaces.

## Why the unit tests did not catch it

`WorkspaceSettingsModal.test.tsx:210` and `…role-swap.test.tsx:134` each wrap the component in a
`SettingsProvider` **themselves**. The tree under test therefore has a provider the real shell does
not, so the suite is green on a component that cannot render where it is mounted.

This is round 205's `onAssignCourse` shape in a new form: a component with a **satisfied**
dependency in tests and an **unsatisfied** one in the app. The difference is that here the failure
is loud rather than silent — which is the only reason it was found.

## What the spec pins

**4 passed, both projects** — and deliberately, the reachable behaviour rather than the intended one:

| Case | Asserts |
|---|---|
| the crash | the modal's text is the `useSettings` error, and the F4 card is ABSENT |
| the way out | the error boundary offers `Try Again`, so a thrown render does not strand the operator |

The header states plainly that these assertions are the ones to change when the crash is fixed —
in one place, deliberately.

## What was NOT done, and why

The crash was **not fixed**. The fix is either a provider at the shell or a scoped one around the
modal, and both change where 33 `SettingsProvider` references and the app shell's provider tree
sit. That is a change to application composition, not a screen — and this round's budget went into
establishing that the defect is real, unconditional and reachable, which is the part that had to
be certain before anyone moves a provider.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Probes | run with AND without injection; the crash is unconditional |
| Source changed | none |
| eslint | 0 |
| Full UI suite | 12,713 passed |

## The F4 set, and its actual state

| Screen | Round | Reachable |
|---|---|---|
| receipts | 223 | yes |
| payments | 227 | yes |
| settings | 230 | yes |
| **workspace card** | **231** | **no — the modal throws first** |

**Three of four are tested; the fourth cannot be until the modal renders.** Recording that
distinction is the point: a coverage table saying "4 covered" would be false.

> last audited 15-10-26 by docs-auditor
