# The two Stripe selects the coverage note called done, and were not (round 288)

## The claim this round tested

Round 286's record closes its coverage section with a reading of the payments row:

> `none` is down to **3** on the payments screen: the icon, `stripe-currency-select` and
> `stripe-reader-select` — both selects writing through `updateRailParams`, whose allow-list round
> 183 pins. **Across all seven surfaces the `none` column is now 7, and every one is a glyph, a
> title, or a field whose write boundary is unit-tested.**

The count of 3 was right. **The reason given for two of them was not**, and it is the reason that
decides whether they are debt or closure.

## What is actually true about the two ids

A repo-wide search for either id returns **twelve hits, all inside the source file that declares
them**:

```
$ grep -rn "stripe-reader-select|stripe-currency-select|stripeReader|stripeCurrency" ui/
ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx:312   const [stripeReader, setStripeReader] = useState('wisepos_e');
ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx:313   const [stripeCurrency, setStripeCurrency] = useState('IDR');
... :1521-1556  the label, the id, the data-testid and the value binding of each
```

**No spec and no unit case mentions either one.** So "a field whose write boundary is unit-tested"
described a different object — see the next section — and the two ids were in fact the last truly
unasserted *interactive* controls on the screen.

The distinction matters because of what sits beside them. Every sibling control in the same Stripe
card IS asserted somewhere:

| Control | e2e | unit |
|---|---|---|
| `stripe-pub-key-input` | 1 | 1 |
| `stripe-sec-key-input` | 2 | 1 |
| `stripe-mode-live` / `-test` | 0 | 1 each |
| `stripe-verify-keys-btn` | 1 | 1 |
| **`stripe-reader-select`** | **0** | **0** |
| **`stripe-currency-select`** | **0** | **0** |

## Why the existing suites genuinely do not close it

Both surrounding suites stop one hop short, and each is a *different* hop:

- **`paymentRailsParams.test.ts`** proves the PURE sanitizer. Round 183 extracted
  `sanitizeRailParams` for exactly this and the allow-list `stripe: ['reader', 'currency']` is
  pinned there. It calls the function directly — it cannot see whether any control is attached to
  it.
- **The save-payload cases** prove `setLocalPaymentMethodsScoped` receives the drafts. They toggle
  a rail and assert `rail_code` / `is_enabled`; **none reads `parameters`**.

So a regression that disconnected either select's `onChange` from `updateRailParams` would keep
**both** suites green while the operator's choice silently stopped persisting. That is the whole
gap, and it is one hop wide — the same shape round 50 recorded for `thousands_separator`.

## The fix is a test, and it asserts the whole chain

`RestaurantPaymentsScreen.test.tsx` gains one case that drives select → rail params → save payload:

```ts
await choose(readerSelect, S700);        // click trigger, click the option in the portal
await choose(currencySelect, USD);
await user.click(screen.getByRole('button', { name: 'Save' }));
const stripeRail = payload.find((r) => r.rail_code === 'stripe');
expect(JSON.parse(stripeRail!.parameters)).toMatchObject({ reader: 'reader_s700', currency: 'USD' });
expect(stripeRail!.parameters).not.toContain('sk_');
```

Three deliberate choices in it:

1. **The assertion is on the PAYLOAD, not the DOM.** `expect(trigger).toHaveTextContent('S700')` is
   also asserted, but on its own it would pass against the bug — `setStripeReader(v)` still runs, so
   the button still updates and nothing persists. Only the payload read discriminates. This is the
   round-229/230 pairing rule and round 286's own second-assertion rule.
2. **The option labels come from the FTL bundle**, via the file's existing `productsFtlLine()`
   helper, not from typed literals. My first draft typed `'WisePOS E'` and `'S700'`; the real English
   values are `BBPOS WisePOS E (Wi-Fi)` and `Stripe Reader S700`, so it failed — correctly, and for
   the reason the file header already records (round 15's localization pass).
3. **It pins the destination as well as the value.** `reader`/`currency` belong to the MARKET
   surface; `handleSave`'s Stripe `configJson` carries only publishableKey/secretKey/mode. If
   someone "fixes" this by moving the reader into the gateway config, the value leaves the rail
   params and the case fails.

`Element.prototype.scrollIntoView = vi.fn()` is added at the top: jsdom implements no layout, so the
call `SettingsSelect.tsx:232` makes when the list opens throws. Same per-file stub
`SettingsSelect.test.tsx:13` and `SegmentedTabs.test.tsx:21` carry.

## Kill-tested

Dropping `updateRailParams('stripe', { reader: v })` from the reader select's `onChange`:

```
× persists the Stripe Card Reader and Currency choices into the rail parameters
  Expected: { "currency": "USD", "reader": "reader_s700" }
  Received: { "currency": "USD" }
```

**1 failed**, and the diagnostic names the missing key. Restored; `git diff` on the source file is
empty — byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| New case | **1 passed** |
| Kill-test | **1 failed**, then restored byte-identical |
| Payments suite | 46 passed |
| `RestaurantPaymentsScreen` + `paymentRailsParams` | **51 passed** |
| Restaurant/payment suites by filter | **671 passed, 48 files, 0 failed** |
| eslint on the edited file | 0 |
| Source changed | **none** — the fix is a test |
| Coverage `none` on payments | **3 → 1** (only `restaurant-payments-icon`) |
| Coverage `unit` on payments | **6 → 8** |
| Scan self-check | passes (`--self-test` exit 0) |

## The method note, and it is the session's recurring one

Round 286 ended "the durable version of the pairing rule is not a scan but a REVIEW habit", having
found its scan unproductive. This round found the complementary failure: **a scan counts, and a
count is right while the sentence explaining it is wrong.** `none = 3` was measured and correct;
"a field whose write boundary is unit-tested" was an inference attached to the number, and it moved
two open ids into the closed column of the prose.

The instrument that caught it is the one that has worked all session — **counting something
concrete and reading each survivor**. `restaurant-coverage.py` listed the ids; the reading of them
was wrong; one `grep` for the id settled it. The scan's own self-test passing is what licensed
trusting its *numbers*; nothing licensed the *prose* but a read, and that is the part that was
skipped.

## State of the objective

**Coverage**: the two interactive ids that no test named are now asserted end to end. The seven
`none` ids across all surfaces are now unambiguously glyphs, titles, and the two `stripe-*` selects
that this round removed — I have not re-read the other four screens this round, so that claim is
carried forward from the scan's `unit` column, not re-derived.

**Reliability**: 671 restaurant/payment cases pass together, and the new case is kill-tested, which
is the property round 287 measured for the suite as a whole.

**Not verified this round**: the e2e suite. `run-e2e.mjs` needs a Docker backend and the Docker
daemon is not running on this machine, so `npm run e2e:ui` cannot produce a verdict here — it was
started and killed rather than left to hang. Everything above is vitest-layer.

> last audited 15-10-26 by docs-auditor
