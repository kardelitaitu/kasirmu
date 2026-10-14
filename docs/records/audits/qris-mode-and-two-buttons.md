# The QRIS `mode` setting and the two buttons beside it (round 124)

## The question

Round 123 recorded that `mode: 'static' | 'dynamic'` is read back for form state and nothing
else, and called that *"the operator picks dynamic and it does nothing"*. This round checked
what the till does instead — and the answer changes what the finding IS.

## The dynamic path is real, complete, and NOT gated by `mode`

| Layer | State |
|---|---|
| UI hook | `payment/useAutoQr.ts` — state and handlers |
| UI API | `api/qris-auto.ts` — `qrisAutoChargeScoped`, `qrisAutoStatusScoped` |
| Desktop backend | `apps/desktop-tauri/src/commands/qris_auto.rs`, registered `lib.rs:1890-1891` |
| Mobile backend | `apps/mobile-tauri/src/commands/qris_auto.rs`, registered `lib.rs:1416-1417` |

`qrisMode` appears **zero times** in `features/sales`. The till selects the path per SALE, not
per store: `QrisTenderPanel.tsx:77-98` renders **both** buttons unconditionally.

```
[ Pay with QR ]          -> onQrPay          -> manualQrString (static, from the rail)
[ Pay with dynamic QR ]  -> onDynamicQrPay   -> useAutoQr    (live Midtrans charge)
```

Both are first-class localised commands (`sales.ftl:94-95`, `sales.id.ftl:634-635`), both
rendered on the live pass in rounds 118-119, and both `disabled={processing || autoQrPending}`
— the same guard, so neither is a fallback for the other.

## So what IS the `mode` setting?

Not a missing feature and not a broken one. It is a **third control over a decision the
operator makes at the till**, and it is the only one of the three that does nothing:

| Control | Where | Effect |
|---|---|---|
| the two buttons | tender panel, per sale | choose the path |
| QRIS static payload | Settings -> Business Defaults | supplies the static QR content |
| **`mode`** | **Settings -> Payments** | **none** |

The consequence is the one round 123 named, stated precisely: **a store that sets
`mode: dynamic` is not configured for dynamic QR.** Its cashiers still see both buttons and
still pick per sale. The setting is not an override that silently fails; it is a control whose
subject is decided elsewhere.

That distinction matters for the repair, and round 123 did not draw it. "Wire `mode` into the
till" and "delete `mode`" are different products:

* wiring it means the mode decides which button the cashier sees, or preselects one — a
  change to how the till behaves under a cashier's hand;
* deleting it means the tender panel's two buttons are the only interface, which is what the
  code already does.

Neither is a reliability repair. The second is a one-line removal plus its i18n keys and a
settings-section edit; the first needs a decision about whether a store-level default should
be able to remove a cashier's choice.

## What is NOT in doubt

`nmid` and `surcharge` sit beside `mode` on the same rail and have no consumer either, and
those have no per-sale counterpart:

* **`nmid`** is the merchant identity a QRIS payload carries. The static payload is supplied
  by hand through `writeStaticQrPayload`, so a store that enters an NMID and no payload gets
  no merchant identity anywhere. On the live pass it held `ID1020030040050`.
* **`surcharge`** is an MDR fee percentage (live value `0.7`). Nothing prices with it.

Those two are closer to round 120/122's shape than `mode` is: a value the operator set that
no code reads, with no alternative path carrying the same information.

## Verified

| Item | Result |
|---|---|
| `qrisMode` in `features/sales` | 0 occurrences |
| Both QR buttons rendered unconditionally | `QrisTenderPanel.tsx:77-98` |
| `qris_auto` commands registered | desktop `lib.rs:1890-1891`, mobile `:1416-1417` |
| Tree | no source changed this round |