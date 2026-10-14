# A switch with no aria-checked, found by a probe that could not read it (round 179)

## Why this surface

Round 177's testid sweep, re-run after rounds 177-178 covered tables and the receipt
previews, put `RestaurantPaymentsScreen` at the top: **31 testids, no e2e reference** — on the
screen where two real defects were found by hand (round 156's rails losing every save, round
164's token guard).

Most of the 31 are gateway credential inputs (Midtrans, Stripe, QRIS), which need care. The
cash-drawer-kick toggle was the operator-facing one, and it sits at the end of the chain round
142 had warned about: `updateRailParams` is LOCAL STATE only, so the question is whether
anything ever carries a rail parameter to the backend.

## The defect, found because the probe could not read the control

`input[role="switch"]` at `:1080` had **no `aria-checked`** — only the native `checked`
property. Every other `role="switch"` in the file sets it (`:201`, the rail toggles).

The probe found it the way an operator's screen reader would: `getAttribute('aria-checked')`
returned `null` where the sibling switches return `"true"`/`"false"`. A `role="switch"`
without `aria-checked` is an incomplete ARIA role — the control is announced as a switch with
no on/off state at all.

Fixed with one attribute, and the comment records the measurement so the next reader does not
have to reproduce the probe.

## Three instrument errors on the way, all mine

| Symptom | Cause |
|---|---|
| `toBeVisible` failed with `hidden` | the rail `input` is styled out; the visible control is an aria-hidden sibling slider — rounds 148 and 170's pattern, third occurrence |
| `toMatch` failed on `null` | read `aria-checked` once before hydration; round 157's trap |
| the rail held `null` after a correct save | `Object.values(slice)[0]` is the `legal_entity` scope; `cash` lives under `location:store-1` |

The third is the one worth keeping: the probe DUMPED the slice and showed
`"location:store-1":[{...,"parameters":"{\"autoKick\":false}"}]` — the value had persisted
correctly all along, and my reader was looking in the wrong scope.

A fourth, subtler one: the desktop project failed while tablet passed, because `toBeDisabled` on
Save clears **before** the store write lands (`handleSave` awaits `Promise.all(tasks)`). Polling
the stored value rather than reading it once fixed it. **A race between two projects is not a
difference between them.**

## What the spec pins

`ui/e2e/mock-cash-drawer-kick.spec.ts` — **2 passed** (desktop + tablet):

| Step | Asserts |
|---|---|
| on arrival | the switch reports a state, and Save is disabled |
| toggle | the switch flips and **Save arms** — round 142's warning made this the real claim |
| save | Save disarms, and the mock's `location:store-1` cash rail carries `autoKick` |

**Kill-tested**: removing the `aria-checked` fails both projects on the state assertion.

## The persistence chain, confirmed

The round's original question — does a rail parameter ever reach the backend? — is answered:
**yes, via `handleSave`.** Its payload maps every draft's `parameters` through (`:779-784`),
with `cash` in the default branch, and `dirty` derives from `drafts` vs `originalsRef`
(`:551-562`) so a toggle arms Save. The value lands under the LOCATION scope. Round 156 fixed
the store; this round proves the screen's route into it.

## Verified

| Item | Result |
|---|---|
| New spec | **2 passed** |
| Kill-test | **2 failed** |
| `aria-checked` count in the file | 2 of 2 switches, was 1 of 2 |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,693 passed |