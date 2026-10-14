# The POS localStorage sweep, and a currency-sensitivity gap (round 105)

## The sweep

`pos-draft-store-scoping.md` (round 104) fixed the two unscoped keys it found and closed
with a caveat: other persisted state had not been re-audited. `features/sales` writes two
further keys, both checked here.

| Key | Payload | Verdict |
|---|---|---|
| `restaurant-tender-presets` | quick-tender amounts | presentation/config, per-device by design — see below |
| `pos-cart-width` | a pixel width | a per-DEVICE layout preference; not store data |

Neither is store-specific business data, so neither needs the store-scoping round 104
applied to the draft. `restaurant-tender-presets` is also READ-ONLY here — nothing under
`ui/src` writes it, so it is provisioned externally and a store-scoping change would have
nothing to change.

## What the sweep DID find: the presets are major units, not minor

`CashTenderPanel.tsx:84-90`:

```ts
const exp = minorUnitExponent(total.currency);
const denomMinor = BigInt(amount) * 10n ** BigInt(exp);   // <- amount is MAJOR units
```

So the built-in `[5000, 10000, 20000, 50000, 100000, 200000, 500000]` means **Rp 5.000
through Rp 500.000** in IDR (exponent 0) and **$5,000 through $500,000** in USD (exponent
2). The same array, read through the session currency.

That is not a bug — the exponent is applied correctly and every rendered amount is a
legitimate value in whatever currency is active. It is a **product decision that had never
been exercised**: every case in `CashTenderPanelQuickTender.test.tsx` used IDR, where the
preset value and the major units coincide, so the two-exponent behaviour was untested.

## Added

Two cases, both USD:

1. the built-in presets render at the currency exponent (`5000` → `$ 5.000,00`, not
   `$ 50,00`), pinning that they are major units;
2. a store that supplies its own presets has them honoured unchanged — the escape hatch,
   since the key is per-device localStorage.

**The defaults are not currency-tuned.** A USD store that never provisions the key is
offered $5,000-$500,000 shortcuts. That is now pinned and visible rather than latent.

## A mistake worth recording

My first expectation used `en-US` for the formatting while the harness renders with
`locale="id-ID"`, so it read `'$ 5.000,00'` against my `'$ 5,000.00'`. The AMOUNT was
right in both; only the separator differed. These cases are about exponent handling, not
separators, so the fix was to assert with the harness's own locale.

## Verified

| Gate | Result |
|---|---|
| `CashTenderPanelQuickTender` | 12 passed (was 10; the 2 new cases failed first on my locale error) |
| Full suite | 12,662 passed, 0 failed |
| `tsc` | 0 |