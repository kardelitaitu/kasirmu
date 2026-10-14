# Two grouping settings that were never connected (2026-10-13)

## Why this note exists

Round 39 set out to verify a PINNED plan item. The item said:

> The receipt preview cannot express `currency.thousands_separator` — the printer
> honours it, `formatMoney` groups by locale only, so an operator who sets `comma` on
> an IDR store prints `Rp 15,000` beside a preview reading `Rp 15.000`.

The premise **checks out**. But verifying it turned up something the item does not say,
and a stale sibling test that asserts the opposite of what the code now does.

## Finding 1 — a test that asserts a defect which was fixed

`ui/src/__tests__/receiptPreviewPrintAgreement.test.ts:61` is titled:

```
never groups thousands: the printer has no grouping at all
```

and hardcodes `const printed = 'Rp 1500'` as the printer's behaviour. Both claims are
superseded by D6:

| Claim in the test | Reality |
|---|---|
| `ReceiptConfig` has no grouping field | `receipt.rs:193` — `pub grouping: ThousandSeparator` |
| no formatter reads it | `receipt.rs:355` — `config.grouping.separator()` is applied |

It **passes**, because it asserts the printer's imagined behaviour rather than measuring
it. A green test claiming the printer cannot group would stop anyone from wiring grouping
to it — the same "a comment claiming two surfaces agree, contradicted by the code" shape
the plan file records at F16.

## Finding 2 — there are TWO grouping settings, and neither reaches the other

| Setting | Stored as | Read by | Drives |
|---|---|---|---|
| `currency.thousands_separator` | backend typed setting | `kasirmu-bridge/src/hardware.rs:429` | the PAPER |
| `resto_rcpt_thousands_sep` | key/value setting **plus** localStorage | **no Rust at all** | the PREVIEW |

So the receipt screen's thousands-separator toggle is the mirror image of the plan item's
description: the plan says the *preview* cannot express the printer's setting, while what
the operator actually experiences is that the *toggle* they can see changes the preview
and not the paper.

**Measured:** `grep -rl "resto_rcpt_" --include=*.rs crates/ apps/` returns **0 files**.
Every `resto_rcpt_*` value is a UI-only preference, which is why a crude "is it read by
Rust?" check cannot distinguish a genuinely unwired control from a deliberately
client-side one — twelve receipt keys share that property.

## What was left for an owner — and the owner chose, 2026-10-13

Wiring the toggle meant deciding **which of the two keys is the real one**. Two candidates
were named; **candidate 1 was chosen and implemented**, in three commits:

1. **`e84ccdc62`** put `thousandsSeparator` on `StoreSettingsDto`.
2. **`e0ffa8213`** resolved the separator through the same localStorage bridge
   `decimalSeparator` already used — `utils/storage.ts` gained `getThousandsSep` /
   `setThousandsSep` / `thousandsSepFor`, and `SettingsContext` writes through from the
   DTO on **both** store-load paths (`443349a60` added the second).
3. **`formatMoney`** now takes a `thousandsSep` argument and groups the integer part
   itself, with `useGrouping: false` so `Intl` cannot also group
   (`ui/src/types/domain.ts:497`).

**So the two settings are now connected in the direction this note identified.** The
restaurant toggle (`resto_rcpt_thousands_sep`) still exists and is still UI-only — that
is candidate 2's territory and was deliberately not taken: the note's own measurement
showed every `resto_rcpt_*` value is a client-side preference, so folding it into the
store setting would change what prints for a key the printer never read.

The pin that recorded the divergence was retired by `e295a13f0`, and the guard's ledger
is now empty — see `ui/src/__tests__/ReceiptPreviewGroupingParity.test.ts`, which asserts
that emptiness rather than a count.

## Why there is no guard here

A guard was attempted and **withdrawn**. The first version asserted the toggle was read by
Rust — wrong, because every receipt key is client-side. The second tried to catch a
*second* unwired toggle and could not separate "unwired" from "client-side by design"
without a per-key expectation table, which would be the same maintenance burden as the
bug. Recorded here instead of pinned by a test that would have proved nothing.

> last audited 14-10-26 by docs-auditor
