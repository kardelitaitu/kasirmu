# Two cards never read their settings, and one missing prop explains it (round 237)

## The answer round 236 asked for

Round 236's scanner found four more latches-set-before-reads and warned, correctly, that a
structural match is not a defect. It named the experiment: name the calls, count the failures,
observe the banner. It also asked which of two mechanisms applied — *fired-and-discarded* or
**never-fired**.

The answer is the second:

```
BEFORE_MODAL = []      AFTER_MODAL = []      BANNER = 0
```

**The KDS card issued ZERO `get_setting_scoped` calls.** Not a discarded read — no read.

## The cause, and it is one missing prop

```tsx
// WorkspaceSettingsModal.tsx:54 (before)
const cardProps = { variant: 'modal' as const, terminalId: terminalId ?? '' };
```

`sessionToken` was never passed. Every card's once-per-session guard compares a ref seeded to
`undefined` against that token:

```ts
// WorkspaceKdsSettings.tsx:93  (WorkspaceInventorySettings.tsx:71 is the same shape)
if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
```

With the prop `undefined`, `undefined === undefined` is **true on the very first run**, so the
effect returned before reading. The guard was not too strict; it was correct and starved of input.

**The fix threads the token through**, spread conditionally because `exactOptionalPropertyTypes`
forbids assigning `undefined` to an optional prop.

## The two defects were stacked

| Card | Mechanism | Round |
|---|---|---|
| `WorkspaceRestaurantPosSettings` | read fired, result discarded by the StrictMode cleanup | 234-235 |
| `WorkspaceKdsSettings` | read **never fired** — the token was missing | **237** |

The restaurant card escaped the never-firing half only because its deps include `settings.receipt`,
which changes as the modal mounts and forced a later run. **That later run is exactly the one the
cleanup discarded.** So the same missing prop was masked on one card by a second defect, which is
why it took two rounds to find: each bug hid the other's symptom.

## What the scanner got right, and what it could not

Round 236 flagged both cards as *structural matches* and refused to call them defects. That was the
right call, and it is now vindicated in an unexpected way: they ARE both broken, but **by different
mechanisms than the one the scanner matched.** The scanner found the latch; the cause was upstream
of it. A rule that had been applied as "these look like the known bug" would have fixed the latch
and changed nothing.

## Verified

| Item | Result |
|---|---|
| KDS before the fix | 0 reads, 0 banners |
| KDS after the fix | 5 reads, 5 failures, 1 banner |
| Inventory card | same spec, passes |
| New spec | 4 passed (2 cards x desktop/tablet) |
| Kill-test (prop not forwarded) | **2 failed** |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,713 passed |

## The fourth candidate, and the two outside this family

Round 236 listed five scanner hits. Two are now fixed and covered. The remaining three were not
probed this round:

| File | Line | State |
|---|---|---|
| `nodeTopologyEditorRestoreState.ts` | 23 | unprobed |
| `NodeTopologyEditor.tsx` | 1608 | unprobed |
| `RestaurantMenu.tsx` | 391 | unprobed |

`WorkspaceInventorySettings` was in the unprobed set last round and is now covered by the same
spec — passing, so its read fires with the token forwarded. Whether it needed the token or merely
benefited from it is not distinguished here, and the spec pins the behaviour either way.

> last audited 15-10-26 by docs-auditor
