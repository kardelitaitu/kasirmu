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
| 6 | `PosScreen` split-bill remaining tab | wrote it into the new tab | `e3fa0d176` |

Site 6 arrived LATER, in new code — the split-bill feature (`276d6ce04`) added after
this series began. Its handler built the remaining tab's `cart_data`, label AND
`customer_name` from `tableNumber` with no order-type check, while writing
`orderType` into the same record — so a takeaway could persist the identical
self-contradicting payload fixed on the PaymentModal path in `795fc18d4`
(`{"tableNumber":"T99","orderType":"takeaway"}`).

That is the point of the class guard rather than six separate tests: **the rule
has to be applied by whoever writes the next reader.** The sweep failed the moment
site 6 existed (asserted 1, found 0), before any live run.

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

## The class now has ONE guard instead of five (`9cee8e8a9`)

Five behavioural tests prove each site works. `RestaurantOrderTypeFieldConsumers.test.ts`
additionally asserts, in one place, that the rule is applied at EVERY consumer —
because the failure mode of this class is **partial** application, which is exactly
how the series went (#1 fixed while #2 was live, #2 while #3 was, and so on).

It checks: both claim paths (2, not 1), the release, the open-bill payload, the
display predicate, the pax render condition, that no consumer uses the negative
form `!== 'dine_in'` (which would wrongly admit delivery), and that the
customer-name field is NOT restricted. A sixth consumer, or a dropped guard,
fails it immediately instead of waiting for someone to think of looking.

Verified by mutation on COPIES of the sources (never the live files): dropping any
one guard moves exactly the field that asserts it, and restricting the customer
field moves `customer` 1 -> 0.

## A harness mistake worth recording

The first attempt at those kill-tests mutated the LIVE files — and because another
agent was concurrently editing `PosScreen.tsx`, the restore write failed and
**left the release guard removed in a production file**. It was caught by
re-reading the guard (not by trusting the script) and restored, then confirmed by
the sweep and the 135-case PosScreen suite.

The lesson is narrow and worth keeping: **mutate a copy, not the working tree.**
A kill-test's whole purpose is to put a file into a broken state, and on a tree
that several agents edit concurrently that is a dangerous thing to do to the real
file — a failed restore is a silent production regression, not a failed
experiment. The re-run above mutates in-memory copies only and asserts at the end
that the live files are byte-identical to what they were.

## Not verified live

Vite has been down since round 40, and the dev server is not something to restart
unprompted. Every fix above rests on jsdom tests plus kill-tests; a browser pass
would be the stronger confirmation and is outstanding for all five.

Two of the five (#1 claim, #5 pax) were originally FOUND in the browser, so the
harness does catch this class — it is the re-verification that is missing, not the
detection.
