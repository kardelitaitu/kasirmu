# The comment guarding a credentials overwrite cited the wrong line, twice

Date: 2026-10-18 (round 133). Commit: `55bb04abb` — *docs(sales): re-point eleven
citations in the F4/F40 credential notes*.

## The block

`RestaurantPaymentsScreen.tsx` carries two comments protecting the operator from writing
blank gateway credentials over real ones. Both make a claim about ORDERING, and both
cited `:377` as the evidence:

```ts
* F4: a gateway read failed, so the Midtrans/Stripe fields show EMPTY rather than
* the stored config. The drafts baseline is seeded before those reads (`:377`), so
* without this flag the screen looks clean and saving writes the blanks over real
* credentials.
```

and

```ts
// and the baseline seeded at `:377` before this point, a failure left the
// screen looking CLEAN while showing empty fields
```

MEASURED: `:377` is `listEdcTerminalsScoped(sessionToken).catch(...)` — one arm of a
`Promise.all` reading EDC terminals. It seeds nothing. The baseline is seeded in two
places and neither is on that line:

* `:408` — `originalsRef.current.drafts = fullDrafts.map(...)`, success path;
* `:543` — `originalsRef.current.drafts = draftsRef.current.map(...)`, in the load
  effect's `finally`, covering every other outcome.

## Does the safety actually hold?

Yes, and that is what makes this the round-126 shape rather than a bug. Traced:

* success path — `setDrafts` + baseline at `:407-408`, BEFORE the gateway reads at
  `:476-485`;
* `getLocalPaymentMethodsScoped` (`:388`) throws — the gateway reads are INSIDE
  `if (primary)` below it, so they are never reached, and the `finally` at `:543`
  seeds the baseline from the drafts the screen is rendering;
* `getPaymentGatewayConfigScoped` (`:476`) fails — `setLoadFailed(true)`, and Save is
  gated on that flag.

So no sequence writes blanks over credentials. **The claim is true and its evidence is
wrong** — which is exactly what round 126 recorded: a pointer that reads as verified
because the file it names still opens, on a paragraph whose whole purpose is to make
the reader trust it without re-deriving the order.

## Eleven citations, not two

Reading the surrounding code found the same drift in the F40 note nine lines below:

| Comment says | Cited | Actually |
|---|---|---|
| baseline seeded before the reads | `:377` | `:408` (success) / `:543` (finally) |
| `originalsRef` starts as `{ drafts: [] }` | `:326` | `:320` |
| only filled inside `if (primary)` | `:377` | `:390`, filled at `:408` |
| rail read throws before reaching | `:395` | correct (unchanged) |
| `drafts` from the useState initializer | `:248` | `:251` |
| the `dirty` memo returns false at | `:534` | `:560` |

Plus a seventh in `RetailPosScreen.tsx:912`: the stock-guard note cited `:858` for
`current.qty`, which is at `:905` — `:858` is a toast in a different handler.

## Verification

* Every re-pointed citation was read at its target. The two that shifted as this edit
  added lines were RE-verified afterwards and corrected a second time (`:404`→`:408`,
  `:537`→`:543`) — the drift this round is about, caught happening to me mid-edit.
* `featureCommentPaths.test.ts` GREEN: 200 citations extracted, 0 dangling.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `811 passed | 2 failed (813)` files, `12908 passed | 2 failed` tests —
  unchanged from round 132's end state. The two are `nativeDialogCompliance` and
  `noiseDitherCompliance`, both belonging to commit `4347b36d2` (another lane).
* Both files changed are comment-only, verified mechanically line by line.

## Why this matters more than its size

Nothing was broken. But the block a reader is most likely to TRUST without checking —
the one explaining why credentials are safe — was the one whose evidence did not
resolve. A citation that points at `listEdcTerminalsScoped` when it claims to point at
a baseline seed does not merely fail to help; it teaches the reader that the ordering
was verified when nobody verified it.

That is the third instance of this class in four rounds (126 a false claim, 131 sixteen
drifted pointers, 132 a report that never ran), and all three were found by reading
the cited line instead of trusting the citation. The guard now enforces the subset
where a citation cannot possibly be right; the rest still needs a person to look.

> last audited 18-10-26 by docs-auditor
