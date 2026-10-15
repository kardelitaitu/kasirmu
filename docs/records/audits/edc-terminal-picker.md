# The EDC terminal picker, which round 224 called unreachable (round 225)

## Round 224's conclusion was wrong, and this is why

It probed the EDC block twice with `sel.locator('option')`, got `[]` both times, checked the
fixture and the DTO (both correct), and recorded the block as unreachable with an unresolved
cause. The cause was the probe.

```tsx
/** A single option for the SettingsSelect dropdown. */
export interface SettingsSelectOption { value: string; label: string; }
```

**`SettingsSelect` is a CUSTOM dropdown, not a native `<select>`**
(`features/settings/SettingsSelect.tsx:31-39`). It renders a trigger button plus a **portal**
containing `role="option"` elements, and only while `open` (`:296`, `:307`). There are no
`<option>` elements at any time, so the empty reading measured the probe rather than the screen.

Confirmed reachable by calling the app's own API from the page:

```
listEdcTerminalsScoped('mock-session-token')  ->  2 rows, both isActive
```

**The instrument error is round 224's own, one round later.** That round was about a scan that
could not see templated testids; this one was a locator that could not see a portal. Both are
*a probe returning empty being read as evidence about the subject* when it was evidence about the
probe.

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the picker | the control is a BUTTON; clicking it opens a portal with `role="option"` entries, one of which names the seeded terminal |
| the choice | picking a terminal arms Save, AND saving writes it into the card rail's parameters |

## The kill-test that corrected the assertion

The first version stopped at "arms Save", and **removing the rail update SURVIVED it** —
`computeRailsDirty` returns true on the terminal ID alone (`paymentRailsLogic.ts:104`), so the arm
proves only that React state changed, not that the choice is saveable.

The assertion now continues through Save and reads the mock's rail slice for
`defaultTerminalId`. **The same mutation then fails.**

Worth recording as the round's second instrument lesson: **an assertion that passes for a
reason other than the one it names survives exactly the mutation it was written to catch.**

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed after the assertion was strengthened |
| `RestaurantPaymentsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## Payments coverage

| Surface | Round |
|---|---|
| credential allow-list | 183 |
| custom rail authoring | 190 |
| QRIS mode | 191 |
| **EDC terminal picker** | **225** |

Still there: the Midtrans and Stripe credential forms. Those are credential fields, they write
through `setPaymentGatewayConfigScoped` (encrypted, per round 183's boundary), and they are the
one group on this screen where a test's value is lower than the care it would need to write.

> last audited 15-10-26 by docs-auditor
