# F10's modal renders again, and one F4 guard stays out of reach (round 232)

## The fix

Round 231 established the defect: `AppShell.tsx:435-459` renders `WorkspaceSettingsModal` for F10
as a **sibling** of the workspace screens, while `SettingsProvider` was rendered only inside
`SettingsPage.tsx:108`. The modal's cards call `useSettings()`, so opening it from any workspace
threw and the error boundary replaced the panel.

The fix wraps the **portal's content** in `<SettingsProvider>`:

```tsx
return createPortal(
  <SettingsProvider>
    …the whole panel…
  </SettingsProvider>,
  document.body,
);
```

**Why there and not in `AppShell`**: `createPortal` puts the tree on `document.body`, outside the
caller's React tree, so a provider on the caller would not reach it either. The portal is the one
place that covers every caller.

**Kill-tested**: swapping the provider for a bare fragment reproduces the crash and fails both
cases. Restored.

## Verified after the fix

| Item | Result |
|---|---|
| The modal's text | `Table Management`, `Course Firing`, `Printer` — the real cards, not an error |
| `CRASHED` | `false` (measured, no injection) |
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 2 failed |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,713 passed — **0 failed** |

## The crash spec was retired, not left passing

`restaurant-workspace-settings-crash.spec.ts` asserted the crash **as the reachable behaviour**.
Once the fix landed it failed four ways — correctly. It is deleted in its own commit, with the new
spec's header recording what it used to say and why its premise is gone.

**A spec that pins a defect must be retired by the commit that fixes it**, or the suite carries an
assertion that the bug still exists.

## What did NOT land, and the reason is a real gate

The round set out to cover the fourth F4 guard in `WorkspaceRestaurantPosSettings`. It could not be
made to reach its banner, and the cause is in the card:

```ts
if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;   // :98
```

The read happens **once per session**, before F10 opens the modal. Arming `__MOCK_FAIL` afterwards
changes nothing because nothing re-reads — measured: the injection is armed and the banner stays
absent while the card renders normally.

The spec now records that in a comment with the next step: arm the failure against the SESSION
rather than the modal, or enter through `reloadNonce` after a healthy load. **Coverage is still
three of four F4 guards, and the file says so rather than implying otherwise.**

## The sequence this round completes

| Round | What it did |
|---|---|
| 231 | found the crash, proved it unconditional and reachable, pinned it, did NOT fix it |
| **232** | **fixed it, kill-tested the fix, retired the pinning spec** |

Round 231's decision not to fix was the right one to make on the evidence it had — the fix moves a
provider and 33 references are in play. Establishing the defect was the part that had to be
certain first, and this round could then make the change in one commit with a kill-test.