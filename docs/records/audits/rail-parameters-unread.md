# 14 of 15 rail parameters the operator can edit have no reader (round 121)

## What round 120 started, and this round finished

Round 120 found the Cash Suggestion Presets chips write to `parameters.presets` and nothing
reads it. The obvious next question is whether that is one control or a pattern. It is a
pattern.

`RestaurantPaymentsScreen.tsx` has **19 `updateRailParams` call sites across five rails**.
Enumerating every parameter they write and searching for a reader:

| Parameter | Writer | Reader |
|---|---|---|
| `autoKick` | `:1088` | `PaymentModal.tsx:1392` |
| `presets` | `:1114` | **none** |
| `mode` | `:1154`, `:1165` | **none** |
| `nmid` | `:1207` | **none** |
| `surcharge` | `:1228` | **none** |
| `defaultTerminalId` | `:1266` | **none** |
| `env` | `:1317`, `:1328` | **none** |
| `merchantId` | `:1351` | **none** |
| `clientKey` | `:1372` | **none** |
| `serverKey` | `:1393` | **none** |
| `channels` | `:1421` | **none** |
| `publishableKey` | `:1521` | **none** |
| `secretKey` | `:1542` | **none** |
| `reader` | `:1561` | **none** |
| `currency` | `:1583` | **none** |

**`railParam` has exactly ONE call site in the entire codebase**
(`PaymentModal.tsx:1392`), and it reads `autoKick`. Every other parameter is write-only.

Checked two ways so the answer is not a regex artefact: through `railParam(...)` and through
any quoted occurrence of the key outside the writer. `presets`, `nmid`, `surcharge`,
`defaultTerminalId`, `env`, `merchantId`, `clientKey`, `serverKey`, `channels`,
`publishableKey`, `secretKey` and `reader` have **no production reference at all**. Rust has
two hits, both inside a `payment_gateways_tests.rs` fixture for a different table.

## These are not hidden — they are fully operable

A live pass (Vite + Playwright, `owner` / PIN 1234, restaurant sidebar -> Payments) with
Midtrans switched on renders:

```
Merchant ID           placeholder G123456789
Client Key            placeholder SB-Mid-client-XXXXX
Server Key            placeholder SB-Mid-server-XXXXX      (type=password)
QRIS NMID             value ID1020030040050
QRIS MDR Fee (%)      value 0.7
Midtrans channels     placeholder "e.g. ovo, shopeepay, voucher"
```

So an operator can enter a Midtrans merchant id, client key and **server secret**, pick
sandbox or production, choose channels, set a QRIS MDR fee, name a default EDC terminal and
configure Stripe — the screen reports *"All changes saved"*, and **none of it reaches any
consumer**. The values persist into the rail row and stop there.

This is round 112's `LocalApiSection` shape at larger scale: not one unreachable screen,
but fourteen unreachable settings inside a screen that otherwise works.

## A second, smaller finding

Those credential inputs carry **no `aria-label`** — only a `placeholder` (`""` for the aria,
`SB-Mid-client-XXXXX` for the placeholder). A placeholder is not an accessible name, so a
screen reader announces the field as unlabelled. `AGENTS.md` §6.3 requires ARIA labels and
`eslint-plugin-jsx-a11y` passes because a placeholder technically satisfies the rule it can
see. This is a genuine a11y gap, not a lint failure.

## Why I did not fix it

The repair is not wiring. Two things have to be decided first:

1. **Are these settings authoritative at all?** `autoKick` is read from the rail because the
   cash drawer kick is a behaviour. `merchantId`/`clientKey`/`serverKey`/`publishableKey`
   /`secretKey` are CREDENTIALS, and `local-payment.ts:17-18` says *"no gateway credential can
   appear in `parameters` (the backend write path rejects credential-shaped keys)"* — so the
   screen writes them to a field the backend is documented to REJECT. That is not merely an
   unused setting: either the documented rejection does not exist, or the write fails and the
   *"All changes saved"* toast is a lie. Which of those is true needs a real backend, which is
   unavailable this session. Recorded as a contradiction between a comment and the code that
   writes the same field.
2. **Are Midtrans and Stripe rails even live?** Both switches default OFF and nothing reads
   their parameters, which is consistent with a payment integration that was built in the UI
   before its consumer. Enabling them for real is a money-path decision.

Deleting the controls is equally a product decision — they may be a deliberate
configuration-ahead surface. Recording the exact inventory is what this round can honestly
settle.

## Verified

| Item | Result |
|---|---|
| railParam call sites | 1, reading `autoKick` |
| parameters with no production reference | 12 |
| parameters with a writer but no `railParam` reader | 14 of 15 |
| Credential fields render live | yes, including a password field |
| Full suite | 12,657 passed, 0 failed (no source changed) |