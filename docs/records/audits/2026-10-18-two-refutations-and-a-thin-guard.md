# Two refuted suspicions, and a guard that nothing would have noticed losing — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 138 · status: 0 production
     defects. Two suspicions refuted by measurement; one undocumented guard pinned.
     branch: 0.0.41 · commit: `4521f7aa9` -->

<!- - Scope: restaurant POS / promotions UI, per the active goal. Opened from round
     137's own carried-forward list: `CategoryManagement`, `CustomerManagement` and
     `ThresholdConfigScreen`. -->

## Suspicion 1 — SettingsPopup leaves Save clickable while saving (REFUTED)

`SettingsPopup.tsx` is the shared save surface for eleven screens, so a gap there would
be high-leverage. It renders:

```tsx
<Button variant="primary" {...(saving ? { loading: true } : {})}
        disabled={saveDisabled} onClick={onSave} />
```

`disabled` is wired to `saveDisabled` and **not** to `saving`, while the sibling Cancel
button *is* disabled by `saving`. Ten of the eleven call sites pass only a validity
check (`saveDisabled={!form.name.trim()}`); exactly one (`RoleAuthoringPanel:617`) passes
`saving || ...`. That reads as a defect.

It is not. `components/Button.tsx:72`:

```ts
const isProcessing = state === 'processing' || loading === true;
const isDisabled = disabled || isProcessing || isSuccess;
```

`loading` is folded into `isDisabled`, so the `{...(saving ? { loading: true } : {})}`
spread already disables Save. Four existing tests assert this
(`SettingsPopup.test.tsx:257` `expect(saveBtn).toBeDisabled()`). **The suspicion was a
finding about my reading, not about the code** — the same shape as rounds 125 and 128.

## Suspicion 2 — a double Save creates two promotions (REFUTED, then PINNED)

`PromotionManagementScreen.handleSave` has **no in-flight guard**: `setSaving(true)` then
`await createPromotion(...)`, no `if (saving) return`. And unlike the ShiftBar pair
(rounds 136-137), the server here is genuinely defenceless:

- bridge `create_promotion_scoped` mints a **fresh `uuid::Uuid::now_v7()` on every call**
  (`crates/kasirmu-bridge/src/promotions.rs:128`);
- core `create_promotion` `INSERT`s unconditionally
  (`crates/kasirmu-core/src/db/promotions.rs:133`);
- there is **no unique constraint on `name`** (`20260813_init.sql:468`).

So two calls would store two live promotions, both applied at the till. The handler does
not prevent it — but the **button** does: `loading={saving}` at
`PromotionManagementScreen.tsx:430` folds into `isDisabled` by the mechanism above.

Measured before concluding: after the first `fireEvent.click`,
`disabled=true aria-disabled=true` and the second click produced no call. Then killed:
removing `loading={saving}` makes the case **red** with `expected 2 to be 1`. The guard is
real and it is one attribute deep.

**So there is no defect here either — but the guard existed with nothing that would notice
its loss.** No test named it; no comment explained what it was protecting. That is the
part worth shipping: the case now exists, documents WHY the server cannot be relied on,
asserts the button is `toBeDisabled()` between the two clicks so the mechanism is pinned
rather than incidentally satisfied, and records the kill-test.

## What this round is worth, honestly

**Zero production defects.** Two suspicions, both refuted by measurement rather than by
argument — round 125 and 128's lesson applied twice in one round. The useful output is one
characterization test protecting a real one-attribute guard on a path with no server-side
backstop, and a record that says plainly which is which.

It is worth stating that a refutation is not a wasted round here: the alternative to
measuring was either to "fix" a non-defect (round 125's mistake, adding a guard that broke
two tests pinning the documented contract) or to report a duplicate-promotion bug that does
not exist. Both are worse than a quiet round.

## Evidence

- `SettingsPopup.test.tsx`: 38/38 pass, including the `:257` assertion that refutes
  suspicion 1.
- `PromotionManagementScreen.test.tsx`: 19/19 pass with the new case.
- **Kill-test:** `loading={saving}` removed -> `expected 2 to be 1`; restored and confirmed
  **byte-identical** against a backup copy.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — the baseline),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,917 passed** (up 1). The 2 failures are
  the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Carried forward

The three files round 137 named are now read: `ThresholdConfigScreen` guards its delete
with `deleteConfirmId` and a modal; `CustomerManagementScreen.confirmDelete` uses
`deleting` as both guard and per-row disable; `CategoryManagementScreen` routes through
`SettingsPopup` and inherits the `loading` mechanism above. None showed a defect.

Still unexamined, and the better target for a next round: the ~28 other screens that pass
`loading={saving}` or `saving={saving}` on a **non-idempotent create** — a pattern that is
correct everywhere it appears so far, but only by this one attribute, and unpinned in all
but one place.

> last audited 18-10-26 by docs-auditor
