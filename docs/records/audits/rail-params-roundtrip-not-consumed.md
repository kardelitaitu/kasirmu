# Correcting round 121: the parameters ARE read back — but nothing acts on them (round 123)

## What round 121 got wrong, and how

Round 121 concluded *"14 of 15 rail parameters have no reader"* from a search for `railParam(`
and for quoted key occurrences. Round 122 already corrected one miss (`readStaticQrPayload`).
This round corrects the rest, by asking the sharper question.

**Every parameter IS read back — for form state, in the writing screen.**
`RestaurantPaymentsScreen.tsx:418-455` hydrates each rail's saved parameters on load:

```ts
if (p.mode === 'static' || p.mode === 'dynamic') setQrisMode(p.mode);   // :423
if (p.nmid) setQrisNmid(p.nmid);                                       // :424
if (p.surcharge) setQrisSurcharge(p.surcharge);                        // :425
if (p.env === 'sandbox' || ...) setMidtransEnv(p.env);                 // :441
if (p.merchantId) setMidtransMerchantId(p.merchantId);                 // :442
... clientKey :443, serverKey :444, channels :445 ...  // stripe :455
```

So the settings screen round-trips correctly. Round 121's *"no reader"* meant the truth but
read as the wrong defect: not a lost round-trip, but **no behavioural consumer**.

## The corrected census

Searching for consumers OUTSIDE the writing screen (form state excluded):

| Parameter | Behavioural consumer |
|---|---|
| `presets` | **wired in round 122** — `PosScreen` -> `CashTenderPanel` |
| `mode` | one hit, in `ProvisioningFlow.tsx` — a provisioning wizard, not the till |
| `currency` | hits are all OTHER `currency` fields (analytics, reports, settings) |
| `nmid` | **none** |
| `surcharge` | **none** |
| `defaultTerminalId` | **none** |
| `env`, `merchantId`, `clientKey`, `serverKey`, `channels` | **none** |
| `publishableKey`, `secretKey`, `reader` | **none** |

So the honest count is **13 parameters with no behavioural consumer**, and the round-121
phrase *"none of it reaches any consumer"* is still TRUE — for a different reason than that
record gave. The save works; the consumer was never built.

## The QRIS rail is the proof of what "missing consumer" looks like

The qris rail has THREE editable fields and one consumer:

* `mode: 'static' | 'dynamic'` -> read back for form state, nothing else
* `nmid: string` -> read back for form state, nothing else
* `surcharge: string` -> read back for form state, nothing else

while the STATIC-QR payload written by the other surface (`writeStaticQrPayload`, from
Settings -> Business Defaults) IS consumed at `useLocalPaymentRails.ts:225` and passed to the
QR panel (`PaymentModal.tsx:1719`). One rail, two editing surfaces, one of which reaches the
till.

Two consequences worth naming:

* **the operator picks `mode: dynamic` and it does nothing** — whatever renders still comes
  from the static payload path. That is a silent default, the failure direction that matters;
* **`nmid` is the merchant identity a QRIS payment must carry**, so its absence is not
  cosmetic. On the live pass it held `ID1020030040050`.

## The Midtrans and Stripe rails are configuration without an integration

`features/sales` mentions `midtrans` twice — both in doc comments — and `stripe` zero times.
`ui/src/api/webhooks.ts` carries a typed Stripe webhook client (`POST /api/webhooks/stripe`)
with **no caller anywhere in `ui/src`**.

So the Payments screen offers full credential forms for two gateways whose client code does
not exist, and whose stored credentials `local-payment.ts:17-18` says the backend REJECTS in
`parameters`. That is a feature built UI-first with no consumer, which matches the record's
own framing of these as parked decisions rather than broken code.

## Verified

| Item | Result |
|---|---|
| Hydration block | `:418-455`, every rail reads its own parameters back |
| Parameters with a behavioural consumer | 1 (`presets`, round 122) |
| Parameters with none | 13 |
| Stripe webhook client callers | 0 |
| Tree | no source changed this round |