# A generic truth is worse than a specific one — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 107 · status: 1 defect fixed
     (my own round-105 fix was incomplete); 1 reasoning error caught mid-round ·
     branch: 0.0.41 · commit: `16f2e6a54` -->

<!- - Scope: the round-106 rule ("two controls deciding the same question must read the
     same predicate") applied to the two KDS screens. Tree verified green at 813/813
     (12,898 passed) going in. -->

## Two screens, one operation, unequal failures

`KdsScreen` and `ExpoScreen` each advance a line item through the **same** API. Their
failure handling diverged further than it looked:

| | KdsScreen | ExpoScreen |
|---|---|---|
| catch | **bare** `catch {` | `catch (e)` |
| message | fixed `kds-error-update-failed` | `l10nErrorMessage(e, l10n, 'kds-error-update-failed')` |

`l10nErrorMessage` maps a **typed** `AppError` to its own shared copy and falls back to
the screen's key only for an unclassified error. The shared copy is strictly more useful
per kind:

```
app-error-session    = Your session has expired. Please sign in again.
app-error-permission = You don't have permission to do this.
app-error-offline    = You appear to be offline. Check your connection and try again.
```

**"try again" is actively wrong advice for the first two.** A cook whose session expired
retries forever instead of signing in; one who lacks permission retries an action that
cannot succeed. A bare `catch` cannot classify anything, which is what made this visible
from the source.

Fixed by binding the error and classifying it, exactly as the sibling does.

## My round-105 fix was incomplete, and that is the finding

Round 105 replaced a **false** string ("queued — will sync") with a **true but generic**
one, and I recorded that as correct. It was half right: the lie is gone, and the fix
stopped one step short of the sibling's pattern. **A generic truth is worse than a specific
one** — it is accurate about the outcome and silent about the cause, and the cause is what
tells the operator whether retrying can work.

## A reasoning error I caught mid-round

I first read the asymmetry as ExpoScreen being **better**, then suspected the shared copy
might be *less* actionable than the KDS string. Reading `shared.ftl` settled it — every
`app-error-*` string ends in a concrete instruction, so the sibling really is better and
KdsScreen really is the one to change. Recorded because I nearly filed a "both are fine"
conclusion on the strength of the first guess.

## The guard, extended a second time

`kdsItemStatusFailureIsReported.test.ts` now carries three claims:
1. a failure is **reported** (round 105's predecessor);
2. the report is **true** — no promise the queue cannot keep (round 105);
3. the report is **classified** — a bare `catch` or a fixed string fails (this round).

All three are source checks because the components are not otherwise reachable, and all
three strip comments first so the fix's own prose cannot satisfy them. **Kill-tested:**
restoring the bare catch fails case 3 on `bare \`catch {}\` — the error is discarded`.

## Verification

- **Full suite: 813/813 files, 12,899 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix and passes after; kill test restores the failure; restored
  byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> Replacing a false message with a true one is half the job. The other half is asking
> whether a sibling path already tells the operator something MORE USEFUL — and when it
> does, matching it is the fix. Recorded against my own round-105 commit, which stopped at
> "no longer lying" and left every failure reading the same.

> last audited 18-10-26 by autonomous-goal-round-107
