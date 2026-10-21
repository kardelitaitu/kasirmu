# Four real defects found by reading, three fixed — 2026-10-19

**Scope:** three read-only subagent passes hunting *behavioural* defects (not citations) across
`sales/`, `settings/` + `contexts/` and `tables/` + `restaurant/`. Each was told to prove a finding from
the source and to return nothing it could not prove.

**Found: 17 candidate rows. Verified and fixed: 3. One more confirmed and fixed in a provider.**
The ratio matters: roughly a quarter of the returned rows survived my own read-back, and that is the
honest yield of this technique.

## The three fixed defects

### 1. A toast that never appears — `CurrencyProvider` republished on every render

`ui/src/contexts/CurrencyContext.tsx` returned `value={{ currency, setCurrency, refresh, loading }}`
with no `useMemo`, so every render of the provider handed consumers a new object. `PosScreen` has an
effect whose dependency is deliberately the **context itself**:

    if (currencyCtx && !currencyCtx.loading) { setStoreCurrency(currencyCtx.currency); return; }
    ...
    }, [sessionToken, currencyCtx]);

The comment above it argues correctly that naming the two fields would let the authority go stale. But
because the provider was unmemoised, that correct choice made the effect re-run on every render — and
each run past the guard files a `getStoreSettingsScoped` IPC round-trip. During boot, while
`currencyCtx.loading` is still true, that is one store-settings call per render.

Fixed at the provider, not the consumer: the four members are a string, a boolean and two
`useCallback` identities, so memoising changes nothing else and fixes every consumer at once.

### 2. An untouched screen reporting "unsaved changes" — the payment baseline

`ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx` mirrors `drafts` into `draftsRef`
**during render**, because the load effect's `finally` cannot see the `drafts` closure. On the first
load that mirror still holds the `useState` initializer — the default rails, not the server's. The
`finally` then seeds `originalsRef` from it when the real baseline is still empty, so the screen opens
looking dirty: Back pops the unsaved-changes dialog, and Discard can throw away work against a baseline
that never existed.

The success path already computes the loaded list; it now publishes it to `loadedDraftsRef` so the
`finally` seeds from what the load actually received.

### 3. A section rename persisting the wrong list — `sectionsResultRef`

`ui/src/features/tables/TableManagementScreen.tsx` carries the post-update array out of a
`setSections` updater through a ref, because the awaited `setSettingScoped` needs the value and a local
`let` would persist an empty array if React deferred the updater. The existing comment explains that
well. What it missed is the **reuse** case: the ref is only ever assigned by an updater that actually
ran, and `sectionsResultRef.current ?? []` does not catch a *stale* value, because a stale array is not
null. A deferred delete would persist whatever the previous rename wrote.

Fixed by clearing the ref immediately before each `setSections`, so a deferred updater yields `[]`
(the documented fallback) rather than the previous call's array.

## What I rejected, and why it matters

Two agent findings were wrong on inspection and were discarded:

- A "stale-closure" claim on the payment screen that would only bite when `drafts` is non-empty at
  first render — but the baseline guard is `drafts.length === 0`, so the first load cannot be non-empty.
  The real defect was adjacent and narrower than reported.
- A `PaymentModal` duplicate-write claim the agent itself retracted in its closing message after
  checking the two call sites belonged to different functions.

A third claim — that `enterNestedModal`/`exitNestedModal` have zero production callers — was reported as
a note rather than a defect, which was the right call: it is a real observation but not one of the six
defect classes, and I did not touch it.

## Round 35: the same hunt, sharper, and one false positive refused

A second pass with a stricter brief (proof standard: quote the lines, name the reachable trigger, say what
it should do instead) returned 12 candidates across six areas. **Two were fixed, one was refused after
reading the file.**

### Fixed: the KDS per-item double-tap guard never fired

`KdsTicketLineItem.tsx` built its cooldown wrapper *inside* the onClick:

    createCooldownWrapper(() => onAdvanceItem(item), 200)();

`createCooldownWrapper` closes over its own `lastFired = 0` **per instance**, so minting a new one per
tap made the guard evaluate `now - 0 >= 200` — always true. The 200 ms protection this row is documented
to have had never once fired. The proof that it was accidental: `KdsTicketCard`'s own card-level advance,
written first, memoises its wrapper correctly (`useMemo(() => createCooldownWrapper(...), [editing, order,
onAdvance])`). The row was extracted later and lost that part.

### Fixed: audit rows survived a failed reload

`AuditLogScreen`'s error card and empty state are both gated on `entries.length === 0`, and the catch
never cleared the list. So: load succeeds, operator types a search, the second IPC fails — the OLD rows
render under the NEW filter with **no error anywhere**, reading as "filter applied, these N entries
match". A read that never answered presented as a successful, filtered one. The catch now clears the page
on a reset load before reporting.

### Refused: "the receipts screen swallows a hardware failure"

The brief's own highest-confidence finding was wrong. I changed `setLoadFailed(false)` to a comment
arguing it should never run; `RestaurantReceiptsScreen.test.tsx` failed immediately, because its Retry
test asserts the banner **clears** on a successful re-read. The existing code was correct — success clears,
failure sets, Retry re-runs. I reverted the file to HEAD in full.

That is the second time this class of finding has collapsed on contact with a test. The rule I am taking
from it: **a "this clear is wrong" claim must be checked against what the callback's counterpart does**,
not read in isolation.

### Fixed: the warehouse picker claimed "none" on a failed read

`WarehouseConsole`'s two picker dialogs (receive-from-transfer, receive-from-PO) both swallowed the
list-read failure and rendered their **empty** state — "No in-transit transfers", "No approved purchase
orders". That is an authoritative claim made on the strength of a read that never answered, and it is the
worst kind for this screen: the operator's next move is to go looking for stock that the read could not
see. Both loaders now set a `…Failed` flag on catch and the dialogs render
`warehouse-receive-load-failed` with `role="alert"` instead. The key is in both bundles.

### The test I did not ship, and then did

The audit-log fix shipped without a regression test. I wrote one, could not make it stable, deleted it and
said so rather than claim coverage I did not have.

The next round found the test. Two mistakes were behind the failure, both mine:

1. I drove the reload through the **search box**, whose 250 ms debounce never settles under this harness
   ("the current testing environment is not configured to support act(...)"). The reload was simply not
   firing, and I read that as the fix not working.
2. I asserted on `sale-1234`, the fixture's `target_id` — but the table renders
   `entry.target_id.slice(0, 8)`, i.e. `sale-123`. The row was there the whole time.

Driving the reload through **Refresh** instead (which calls `load({ reset: true })` directly, no debounce)
made it work first time. And the test earns its place — I checked:

    with the fix     → 44/44 pass
    fix removed      → the test FAILS (no error card, stale rows still rendered)
    fix restored     → 44/44 pass

That is a real kill test. The lesson is the one this record keeps relearning: **"the test will not pass"
is a hypothesis about the harness, not a finding about the code** — and the cheapest way to settle it is
to look at what the DOM actually contains.

## Round 36: two more in stock transfers, and a kill test earned

- **The previous transfer stayed on screen when the next read failed.** `openDetail` sets `detailId`
  before the await but never cleared `detail`, and the overlay renders `detail` — so the body stayed
  A's number, A's lines and A's Receive button under a heading opened for B. Because
  `openReceiveModal` pre-fills quantities from `detail.lines`, the operator could receive A's lines
  believing they were on B. The file's own comment already named this hazard for the *slow* case; the
  *failed* case was the one nothing handled. `setDetail(null)` now runs before every read.
- **The "unknown" notices were unreachable after the first success.** `if (prodRead.ok) setProducts(...)`
  wrote only on success, so a later failure left the old array and the `=== null` guard could never fire
  again — a failed reload silently kept offering a stale catalogue. Both now write `null` on `!ok`.

## Round 37: the last two verified candidates

- **Shifts stacked a stale drawer card under the failure card.** `load()` applies the active-shift
  read, and the `else` branch set `activeShiftUnknown` without clearing `activeShift`. The two cards are
  gated independently (`activeShift &&` and `activeShiftUnknown &&`), so a failed read left the previous
  shift's opening balance, sales and cash on screen *above* "Failed to load shifts" — the numbers reading
  as current at exactly the moment the screen admits it cannot read them. The list branch two lines up
  already cleared its own value for the same reason.
- **Stock count reported "no products match" from a catalogue that never loaded.** The read was
  toast-only (auto-dismissing) and left `products` empty, so every search answered from an empty list.
  Now `products` is `ProductDto[] | null` — `null` = unknown, `[]` = the answer that there are none —
  with a durable `role="alert"` in the add-line card, and the read is cancelled on teardown. This is
  precisely the distinction its warehouse sibling `WarehouseCountFlow` documents at length; the stock
  count screen had the toast and nothing else.

Both landed with kill tests verified in both directions (fix removed → red, restored → green).

## Round 37, second pass: four more from fresh areas

The verified candidates were exhausted, so three new hunts went into areas not yet covered (sales payment
+ cart, restaurant screens, locations + setup). Twelve candidates came back; **four were verified and
fixed**, and two were rejected on reading.

- **A receipts Retry that could not clear its own guard.** The banner's comment says "its guard has to be
  cleared too" — and the line was simply missing: `hw.reload()` re-read the profile, but the seeding
  effect still returned early on the one-shot ref, so `hw.loadFailed` cleared while the printer fields
  kept failure-era values and Save stayed disabled **for the rest of the session**. The clearest case yet
  of a comment describing an intent the code never carried out.
- **A stale online count printed over an error.** `TerminalStatusPanel` gates its *list* on `error` but
  not its *header*, so a failed 30 s poll printed "N / M online" from the last good read directly above
  the line saying the read failed.
- **Every Compare click ran the comparison twice.** `openCompare` fetched, and the re-derive effect
  watching the same two pieces of state fetched again.
- Verified and fixed earlier in the round: the shifts stacked-card and the stock-count catalogue alert.

### Rejected on reading

- **"A 100% discount can settle a zero-amount sale."** The guard really is object-truthiness
  (`if (!total)`), which a zero `Money` object never fails — but the claim needs the cart to reach total
  0, and a cart cannot: the discount input's Apply button is disabled above 100 *and* below 1, and
  `discounted` returns `subtotal` unchanged when `discountPercent <= 0`. With at least one line the
  total is always ≥ 1. Nothing to fix.
- **The "Pay Later over-limit warning can never fire"** chain required a zero-total cart for the same
  reason, plus an unproven double-charge path through the open-bill modal.

## Round 38: four more, and one more refused

- **A revision read that failed showed "Loading revision…" forever.** `select` had no try/catch and no
  sequence guard: a rejection was an unhandled promise, and the detail pane keys on `!graph`, which
  cannot tell a failure from a read in flight. Added a `loadError` field, a rendered error, and a
  revision sequence token so a late answer cannot arm "Restore to editor" on the wrong revision.
- **A restaurant bulk-save failure could show nothing at all.** The failure toast was queued *after* an
  `await` inside the same `catch`, so a second rejection (the resync read) escaped unhandled — and the
  optimistic "86 all" stayed on screen as if saved. Report first, then resync under its own try.
- **The KDS retry dismissed the only error with nothing to retry.** `clearError()` ran before a
  `fetchOrders()` that returns immediately without a session.
- **The terminal panel + compare double-fetch** (recorded in the round-37 pass).

### Refused

- **"Sync All does not refresh the pending count."** `handleSyncAll` awaits `load()`, and `load` reads
  the item list, the pending count, the status summary **and** the sync plan. The claim was written from
  the handler in isolation; one read of the callback it awaits refutes it.

That is now the fourth finding of this shape — *"X does not refresh/clear Y"* — that dissolves when you
read what X actually calls. The rule I keep re-deriving: **read the callee before believing a claim about
what a call does not do.**

## Round 39: four more, one refused — and two `useState`/`useRef` twins

- **A login/logout reset that skipped its own documented path.** The note on
  `handleSetActiveInstance` says the reset effect "routes through handleSetActiveInstance and clears
  it". It did not — the reset called the raw `setActiveInstance`, so `lastWorkspace` survived a logout and
  the picker highlighted the previous account's card. **Two comments in this campaign have now described
  clearing that the code never performed** (this one and the receipts `hwInitializedRef`). A comment
  asserting a clear is worth checking exactly like a comment asserting a fetch.
- **The branch-location inspector could re-send a saved payload.** `persist` cleared the *state*
  (`setDraft(null)`) but not the **render-mirrored ref** (`draftRef.current`), and `onChange` is the only
  thing that rebuilds the draft — so the next blur re-entered the loop with the just-saved snapshot and
  repeated the whole mutation. `queuedRef` is now reset with it.
- **The activation form forgot a network failure.** `success === false` set a persistent `errorMsg`; a
  *thrown* activation only raised a toast (auto-dismissing), so an unreachable licence server left the
  form looking like a submit that merely re-enabled its button. Both now persist.
- **Device pairing started twice per tap.** The button's onClick fetched while `pairingLoading` was still
  `false` (the state update had not rendered), so the effect that owns the fetch fired again. Worse on
  failure: the click-time copy set `pairingError` and the effect's copy cleared it, hiding the error and
  minting a second live pairing code.
- **The customers search claimed a negative it never learned.** `runSearch`'s catch emptied the rows but
  not `searchTotal`, so a failed search rendered "No customers match your search." and could print
  "Showing 0 of 120 customers" from a total the failed read never touched.

### Refused

- **"The PIN lockout ref is never reset."** It is reset to 0 on both lockout paths — the immediate branch
  and the timer callback. The agent looked at the assignment inside the error handler and did not read
  the unlock effect 13 lines below.

## Verification

`WorkspaceRestaurantPosSettings` 15 tests, `TableManagementScreen` 79, `RestaurantPaymentsScreen` 51,
`CurrencyContext` + `PosScreenCoreFlow` 56 — all pass. `tsc --noEmit` clean in every touched file,
`eslint` 0 errors.

**The full UI suite is red (17 failures) and none of it is this work:** `0be15c118`, another lane's
`feat(purchasing)` commit, landed `ReceivePoModal.css`, `VendorBillsScreen.tsx` and
`KasbonSettlementModal.css` with hardcoded colours, undefined tokens, uncited sheets and an
unlocalised toast. `git diff 0966258bc..HEAD --name-only` shows none of those paths in this session's
commits.
