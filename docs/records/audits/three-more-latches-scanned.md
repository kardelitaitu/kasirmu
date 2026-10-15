# Three more latches set before their reads, and what is proven about them (round 236)

## Why this round scanned instead of fixing one thing

Rounds 231-235 established one workspace card whose F4 guard could never fire, and the fix was
a one-line ordering change. **A defect that takes four rounds to characterise is worth looking
for siblings of**, so this round wrote a scanner for the signature rather than eyeballing 58
files that use a `cancelled` guard.

## The scanner, and its signature

A guard comparing a ref against a token, with that same ref assigned within four lines:

```ts
if (reloadNonce === 0 && someRef.current === sessionToken) return;
someRef.current = sessionToken;      // ← the latch, set BEFORE the read it guards
```

Five hits. One is the fixed card — correctly absent, since round 235 moved its latch into
`settle()`. The other four:

| File | Line |
|---|---|
| `nodeTopologyEditorRestoreState.ts` | 23 |
| `NodeTopologyEditor.tsx` | 1608 |
| `RestaurantMenu.tsx` | 391 |
| **`WorkspaceKdsSettings.tsx`** | **94** |
| **`WorkspaceInventorySettings.tsx`** | **72** |

The two workspace cards are the same family as the defect just fixed, and their comments are
near-identical — including *"Without it `loadFailed` is a ONE-WAY LATCH and Save never returns"*.

## What is PROVEN, and what is not

**The scanner found structural similarity. It did NOT establish that these guards are broken,**
and this round did not close that gap. Stating it precisely matters, because the temptation is
to read four hits as four defects.

What was measured for `WorkspaceKdsSettings`:

```
AFTER_F10 = [list_terminals_scoped, …, version_scoped]
SETTING_CALLS = 0        ← its five get_setting_scoped reads NEVER fire
```

So its F4 guard is unreachable too — but **for a different reason than the fixed one.** The card's
effect deps are:

```ts
WorkspaceKdsSettings    }, [originalsLoaded, sessionToken, reloadNonce]);
WorkspaceRestaurantPos  }, [settings.receipt, originalsLoaded, sessionToken, reloadNonce]);
```

The restaurant card re-runs when `settings.receipt` changes, which happens as the modal mounts;
the KDS card has no such trigger, so its effect runs once — on a mount where `sessionToken` may
still be `null` — sets the latch at `:94`, and never re-reads. That is the leading hypothesis,
**not a conclusion**: the round ended before distinguishing "the read fires and is discarded"
(the fixed card's mechanism) from "the read never fires at all".

`WorkspaceInventorySettings` was **not probed at all**. Its shape matches; nothing more is claimed.

## Why the distinction is the whole point

If the KDS read never fires, its guard is unreachable by a DIFFERENT fix — removing the latch
would not help. Treating the scanner's output as four instances of one bug would produce a fix
that repairs nothing on three of them.

This is round 226's lesson in a new place: **the scanner is the instrument, and its output is a
list of places to look, not a list of defects.**

## Verified

| Item | Result |
|---|---|
| Scanner | 5 hits; the fixed card correctly absent |
| KDS card, measured | reads never fire on modal open |
| KDS card, hypothesised | deps lack the mount-time trigger the fixed card has |
| Inventory card | not probed |
| Source changed | none |
| New tests | zero |

## The next round's first step

One instrumented run per card, the same shape round 234 used: name the calls, count the failures,
and observe the banner. For KDS that answers fired-and-discarded vs never-fired, and for Inventory
it answers everything.

> last audited 15-10-26 by docs-auditor
