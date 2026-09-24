# Inbreng Valuation — Software as Paid-In Capital

> How the Rust/Tauri codebase is valued and contributed as non-cash capital.
> **This is the weakest document in the directory.** Read the caveats first.

## The position taken

- Asset: *Proprietary Cloud-Native POS Engine (Rust/Tauri Architecture)*, ±700.000 LOC
- Valuer: the founder, as creator and owner
- Value: **$200,000 USD ≈ Rp3.100.000.000,-** `[DECIDED]`
- Method: **Historical Development Cost Approach** `[UNVERIFIED]`

## Cost basis breakdown `[UNVERIFIED]`

| Component | Amount |
|-----------|--------|
| Expert technical hours (Rust, opportunity cost), 4.927 h | $246,000 |
| AI R&D CapEx | $7,000 |
| R&D hardware assets | $15,000 |
| Uptime & bandwidth utilities | $3,000 |
| **Subtotal** | **$271,000** |
| UMK efficiency discount | −$53,000 |
| **Declared value** | **$200,000** |

## What a reviewer will attack

1. **"Opportunity cost" is not a cost incurred.** $246,000 is 4.927 h at roughly $50/h.
   Opportunity cost measures what the founder *could have earned elsewhere*; historical
   development cost is meant to capture what was actually *spent*. Only the other three
   lines ($25,000) are out-of-pocket. `[UNVERIFIED]` — the entire gap between $25,000
   of real spend and a $200,000 declaration rests on this one word.
2. **No external appraisal.** A self-assessed value by the same person who transfers and
   receives the asset is the weakest possible evidence of value.
3. **The discount reads as arbitrary.** There is no stated basis for choosing $53,000
   against a $271,000 subtotal.
4. **±700.000 LOC is neither verified nor relevant.** Line count is not a valuation input
   under any standard method, and it is not measured anywhere in this repo.
5. **The asset may already be encumbered or pre-existing.** `[UNVERIFIED]` — nothing here
   records whether any part of the codebase was written before the PT existed, under
   contract, or with third-party IP in it. That materially affects whether it can be
   contributed at all.

## Downstream consequences to keep consistent

- `[UNVERIFIED]` Balance sheet: the amount is to be booked to *Akumulasi Modal Saham /
  Ekuitas* at inception.
- `[UNVERIFIED]` Tax: amortization is claimed as *Amortisasi Fiskal* under prevailing
  Indonesian tax law. This is the line item DJP would examine first, and it was never
  checked against DJP rules on intangible amortization lives and methods.
- The declared value is fixed at **Rp3.100.000.000,-** across
  [`entity-setup.md`](./entity-setup.md) and the
  [declaration template](./templates/inbreng-declaration.md). Changing it in one place
  means changing it in all three.

## Recommended next step `[PENDING]`

Get an independent appraisal, or reduce the declared value to the substantiated
out-of-pocket basis (~$25,000) — the latter is unglamorous but defensible. A valuation
that cannot survive a question is worse than a small one that can.
