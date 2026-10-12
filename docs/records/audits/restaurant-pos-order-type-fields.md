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
| 7 | `PosScreen` send-to-kitchen open bill | ran the whole block + named the tab | (this round) |
| 8 | `usePosHeldCarts` saved tab | the path that actually saves a tab | (this round) |
| 9 | `CartActionBar` print-bill gate + `handlePrintBill` payload | printed a check naming the wrong table | (this round) |
| 10 | `RestaurantFloatingCartBar` table pill | advertised a table on the always-visible bar | (this round) |
| 11 | `RestaurantCartSheet` table chip | same, on the sheet holding the sale | (this round) |

### Sites 10 and 11 — the PORTRAIT path, which is the tablet

Found 2026-10-12 by walking the portrait render block instead of the desktop one.
`PosScreen` renders both under `isPortraitRestaurant`, and **neither received
`orderType` at all** — the prop did not exist on either component. Both derived their
table chrome from `tableNumber` alone.

The consequence is worse here than on the desktop because of *dwell*: the floating bar
is pinned at the bottom of the screen for the whole service, and the sheet holds the
entire sale. A takeaway with a stray number in the Table field advertised
"Table 99" continuously, on the form factor a restaurant actually runs.

Fixed by adding the optional `orderType` prop (dine-in default, so retail and every
existing render are unchanged) to both components and gating the pill/chip.

**Why the sweep in round 5 did not catch these:** it covered the files that build a
PERSISTED payload. These two only RENDER — nothing is written to disk — so a sweep
looking for `cart_data` could not see them. The class is "every consumer of table
identity", which includes pure display, and the guard now asserts it on both.

### Site 9 — the one that reaches PAPER

Found by sweeping every *derivation* rather than the payloads alone, which is what the
previous round's note suggested. Two halves, both unguarded, and the consequence is the
first one a CUSTOMER sees:

- `CartActionBar.tsx` gated the Print Bill button on
  `Boolean(tableNumber?.trim()) || Boolean(activeOpenBillId)` — the **same condition**
  that let site 7's whole open-bill block run. The table field renders on restaurant POS
  unconditionally (`CartPanel.tsx:864`), so a takeaway with a stray number was offered
  an interim check.
- `handlePrintBill` then passed that number into the printed args, and
  `completedSale.ts:232` renders it while `:212` **derives the receipt number from
  it** — so the check handed over named a table the order did not have.

Fixed by threading `orderType` into `CartActionBar` (new optional prop, dine-in
default so retail and existing tests are untouched), guarding the gate, and deriving a
`billTable` in the handler for the number, the payload and the toast.

**Sweep result, stated for the record:** after this fix the exhaustive sweep finds
**three** guarded derivations in `PosScreen` plus one in `usePosHeldCarts` plus the
gate in `CartActionBar`, and **no bare derivation that is persisted or printed**. The
remaining bare hits are display-only (`bareTableNumber(tableNumber)` inside a
`<Localized>` label, `matchesTableBill`, an input value) and are correct: they render
what the cashier typed, which is the field's job.

### Sites 7 and 8, and why the class guard was blind to them

Found 2026-10-12 by asking which OTHER payloads build a `cart_data`. Two more did, and
both were unguarded:

- **`handleSendToKitchen`** derives `trimmedTable` unconditionally and then uses it
  twice. On a takeaway with a stray number in the Table field, `if (activeOpenBillId ||
  trimmedTable)` is **true**, so the entire open-bill block runs: the kitchen dispatch
  is persisted into a tab, that tab's `cart_data` carries `tableNumber` **and**
  `orderType` (contradicting itself), and its `customer_name` is overwritten with
  `"Table N"`.
- **`usePosHeldCarts`** is the hook that actually saves a tab, and it had the same
  unconditional derivation beside the same `orderType` write.

**The guard did not catch either, and the reason is worth recording.** It asserted the
rule appears **exactly once**:

```ts
expect(guards.length, ...).toBe(1);
```

so it pinned the *count* rather than the *rule*. Sites 7 and 8 were added by the same
feature that produced site 6 (`276d6ce04`), and the count assertion stayed green the
whole time. It now asserts **at least 2** in PosScreen **plus** a named check on the
hook, because a count cannot express "wherever this field is derived".

That is the same lesson the file already carries for a different guard: a check keyed
to the shape of the bug reports a fix as a failure, and a check keyed to a number
cannot see a new instance of the thing it is counting.

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

## A consequence of the round-44 fix, found by following it (4806dc854)

Fixing a defect can leave a second one behind it, and this one was mine.

`795fc18d4` stopped a non-dine-in open bill PERSISTING a table number. But
`canComplete` for the open_bill tender still read:

```ts
return customerName.trim().length > 0
    || (tableNumber != null && tableNumber.trim().length > 0);
```

so on a TAKEAWAY with a stray table number and **no name**, Complete stayed
ENABLED — while the payload (correctly) dropped the table. The tab that resulted
had neither a name nor a table, and `heldCartLabel` fell back to
**"Open Bill #<timestamp>"**. The cashier returning to /open bills could not tell
whose bill it was.

Before the fix the tab at least named the table — **wrongly**. After it, the record
was honest and the path was anonymous. That is a real cost, and the right response
is to tighten the gate, not to put the wrong table back.

Now: a name identifies the tab on any order type; a table identifies it only on a
dine-in order.

### The same stale-closure trap, third time

Adding `orderType` to `canComplete` tripped `react-hooks/exhaustive-deps` — the
identical warning seen on the claim guard (round 40) and the release guard
(round 41). Without the dependency the gate evaluates a stale order type, so a
cashier switching Dine-In → Takeaway after mount would still pass. Fixed by adding
the dep, never by suppressing the warning.

Three occurrences in one area is the argument for the class sweep asserting the
rule positively: relying on each author to remember the dep array is clearly not
working.

## Not verified live

Vite has been down since round 40, and the dev server is not something to restart
unprompted. Every fix above rests on jsdom tests plus kill-tests; a browser pass
would be the stronger confirmation and is outstanding for all five.

Two of the five (#1 claim, #5 pax) were originally FOUND in the browser, so the
harness does catch this class — it is the re-verification that is missing, not the
detection.
