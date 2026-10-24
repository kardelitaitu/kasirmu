# Dead surface: two settings components with 50 test cases and no mount

**Measured 2026-10-25 (round 151) at HEAD `16812dfdb`.** Found while auditing the
`verify-scoped-reads.py --shell tablet` findings by whether they can execute.

```
$ grep -rn '<EmailReportSettings\|<MachineIdStatus' ui/src | grep -v __tests__
(nothing)

$ grep -rn '<EmailReportSettings\|<MachineIdStatus' ui/src/__tests__ | wc -l
51   # MATCHING LINES, not cases -- see the correction below
$ grep -c "it(" ui/src/__tests__/EmailReportSettings.test.tsx
39
$ grep -c "it(" ui/src/__tests__/MachineIdStatus.test.tsx
11
```

A CORRECTION, recorded because the first version of this file got it wrong and the
error is instructive: the opening count said 63, which was the number of LINES matching
<EmailReportSettings|<MachineIdStatus across the two test files, not the number of cases.
A count of matching lines is not a count of tests. Re-measured with
`Select-String -Pattern '\bit\('`: 39 + 11 = 50 cases.

Both components are rendered by **no file outside their own tests**. Their test suites
pass, and they have for as long as the suites have existed, because a test renders the
component directly and never asks whether the app does.

## What each one is

- `ui/src/features/settings/EmailReportSettings.tsx` — SMTP credential form plus the
  scheduled-report and send-test-report actions. `SecurityAccountScreen.tsx:33` already
  records that it is "the orphaned `EmailReportSettings` (SMTP credentials, zero props)",
  which is a note that it was orphaned and never a note that it was removed.
- `ui/src/components/MachineIdStatus.tsx` — the machine-id read used by licence
  activation diagnostics.

Every other reference to either name is prose: `SettingsContext.tsx:230` is a pinned-commit
comment, `SalesHistoryScreen.tsx:153` is a cross-reference, `useKdsPreferences.ts:95` names
it in a comment, and `SecurityAccountScreen.tsx:33` is the orphan note above. A file-level
grep finds all four and reads them as consumers; reading each one is what shows they are
comments.

## Why this matters beyond tidiness

Three of the tablet findings live in this code — `save_report_schedule`,
`send_test_report` (both EmailReportSettings) and `get_machine_id` (MachineIdStatus). They
are not tablet defects and they are not desktop defects: the invokes are unreachable on
**both** shells because nothing renders the components. Reporting them as shell-parity
gaps is true and useless, and it buries the three that are real.

The tests are the trap. 50 passing cases (39 for EmailReportSettings, 11 for MachineIdStatus) assert behaviour of two screens a user cannot
open, and a green suite is the strongest possible evidence that the code is fine. This is
the `useKeyRotationReminder` lesson (round 147) in its second form: that hook had no
mount and no test could see it; these have a mount and 50 tests, and still no consumer.

## The options

1. **Delete both** and their tests. Honest if the features were abandoned.
2. **Mount `MachineIdStatus`** where licence diagnostics live, if the read is wanted.
3. **Leave them** and record the dead surface, as was done here.

Deleting is not this lane's call: `EmailReportSettings` is a shipped settings surface
whose removal is a product decision, and the SecurityAccountScreen note says it was
orphaned deliberately when the security page was rebuilt. So this file records the
measurement and leaves the ruling. **The one thing that should not happen is a future
lane reading the tablet findings as three live defects.**

## Filed by

The round-151 lane. No production file edited for this item.
