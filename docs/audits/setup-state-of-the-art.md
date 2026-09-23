
---

## Round 27b — closed the contract-test blind spot with a DTO conformance guard

Round 27 identified the seam: the ~50 `api-*-contract` suites assert the IPC **command name**, never
the **payload shape**, so a mock DTO that disagrees with its declared interface passes every test.
Two real defects shipped through that hole (`qr_url`, `deviceRevoked`). This round closes it.

### The guard

`ui/src/__tests__/dev-mock-dto-conformance.test.ts` pairs each command with a fixture **typed as
its DTO**:

```ts
const SERVER_LICENSE: ServerLicenseStatus = {
  tenantId: '', status: '', tier: '', active: false, deviceRevoked: false,
  expiresAt: null, graceUntil: null, maxLocations: 0,
};
```

Typing the fixture is what makes it work in both directions:
- **`tsc` keeps the fixture honest** — add a field to the interface and this file stops compiling,
  so the expected key set can never go stale.
- **The runtime compares it to what the mock returns**, reported field-by-field rather than as one
  opaque diff.

Covering `get_license_status`, `check_license_status`, `has_users`, `provision_device`,
`link_device_google`, `link_device_email_consume` and `get_preset_features`, plus two bespoke cases:
`start_device_pairing` (the shape that actually shipped wrong) and `poll_device_pairing`, whose DTO is
**partial by design** — `tenant_id`/`email`/`terminal` are optional, so key equality would be the wrong
assertion; it checks the one required field, `status`.

### Independent verification that it works

Reintroducing **both historical defects at once** makes it fail and name them:

```
check_license_status must match ServerLicenseStatus:
  expected [...] to deeply equal [...] - "deviceRevoked",
start_device_pairing: - "qr_url",
```

That is the guard catching, by name, the exact two fields whose absence caused rounds 26 and 27 — not
a tautology.

### ⚠️ The full suite is not reliably green, and this round proved it

Mid-round, a full run reported **6 failed files / 8 failed tests** — more than the one-or-two flake I
had been seeing. Rather than assume, I measured: moved the new file aside and ran the suite on the
otherwise pristine tree. **The pristine tree failed worse — 5 files / 23 tests**, with an entirely
different set (`PosScreenDeductionLocation`, `SessionLockScreen`, `i18nBundle`, `RetailPosScreenCheckout`).
Two subsequent runs were **fully green: 607 files / 10,363 tests**.

So: the flakiness is pre-existing, load-dependent, and not attributable to any change in this audit.
Recorded because I reported earlier rounds as "green" on single runs where that was partly luck — the
honest statement is that this suite is green **most** of the time under parallel load, and a red run
needs an isolated re-run before it means anything.

### Verification

**607 files / 10,363 tests pass** on two consecutive full runs · `tsc` clean · lint **0 errors** ·
parity **0 missing** · the guard is 9/9.

**Commit:** `e2e4921f7`.