# Order-type-dependent fields read as unconditional — a class, not an incident

Rounds 40-44 turned up **five** separate places on the restaurant POS that treat a
field as meaningful on every order type when it only means something for one. This
note is the class; the individual records are
`restaurant-pos-takeaway-table-claim.md` and
`restaurant-pos-card-settlement-defects.md`.

## The shared shape

The cart panel offers its identity fields — **Table**, **Customer**, **Guests
(Pax)** — for the restaurant POS on **every** order type. That is a deliberate
choice, stated in the source (CartPanel.tsx:735-743: table capture "does not depend
on a setting"). The mistake was never the field being unconditional; it is each
**reader** assuming the same.

| # | Site | What a stray value did | Commit |
|---|---|---|---|
| 1 | `PaymentModal` table claim | attached a real table to the sale | `206462b4d` |
| 2 | `PosScreen` table release | freed that table on completion | `035d1d01b` |
| 3 | `PaymentModal` open bill | wrote it into the saved tab | `795fc18d4` |
| 4 | `CartPanel` tab banner | displayed it as this order's table | `547bf031d` |
| 5 | `CartPanel` pax field | prompted for "seated guests per table" | `54767afa5` |

Sites 1-3 were damage (a table wrongly claimed, freed, or persisted). Sites 4-5
were **misinformation** — the order told the cashier something untrue about
itself.

## The rule for each field, and where it comes from

- **Table** — only a dine-in order has one. A takeaway or delivery has no table
  to claim, release, persist, or name.
- **Pax** — the product's own setting text supplies this one. products.ftl:105,
  `restaurant-setting-guest-count-desc`: *"party size and number of SEATED GUESTS
  PER TABLE"*. No table, no seated guests, no answer.
- **Customer name** — order-type INDEPENDENT. A takeaway still has a customer to
  name on the ticket, so it is deliberately left alone (asserted in
  `CartPanelPaxOrderType.test.tsx` so a future ordering pass cannot remove it by
  symmetry).

## The one that was deliberately NOT fixed

`guestCount` is written into the held-cart payloads (`PosScreen.tsx:818`,
`usePosHeldCarts.ts:199`) with no order-type check. Left alone: `grep guestCount
crates/` returns **nothing**, so the value is opaque data the backend never reads
and cannot corrupt a table, a ledger or a receipt. The VISIBLE prompt was the
defect (fixed as #5); the stored value is not.

Recorded so the asymmetry is not mistaken for an oversight, and so a later pass
does not "fix" it by symmetry with the table cases.

## How to look for the next one

An order-type-dependent field read unconditionally is the pattern. For any state
the restaurant cart exposes, ask: *does this mean anything for a takeaway?* The
cart's identity fields are the whole population today (Table, Customer, Guests);
every consumer of the first and third has now been walked and fixed.

## Not verified live

Vite has been down since round 40, and the dev server is not something to restart
unprompted. Every fix above rests on jsdom tests plus kill-tests; a browser pass
would be the stronger confirmation and is outstanding for all five.

Two of the five (#1 claim, #5 pax) were originally FOUND in the browser, so the
harness does catch this class — it is the re-verification that is missing, not the
detection.
