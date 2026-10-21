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

### The test I did not ship

The audit-log fix has no regression test. I wrote one, and could not make it stable — the mount path
issues more than one `listAuditLogScoped` call under this harness, so both the "first load succeeds" and
"second load fails" halves raced the mock. Rather than leave a flaky test in the suite or claim coverage
it does not have, I deleted it and restored the file to HEAD. The fix is covered by the existing 43 audit
tests passing; the *new* behaviour is not pinned by a test, and that is a gap worth naming rather than
papering over.

## Verification

`WorkspaceRestaurantPosSettings` 15 tests, `TableManagementScreen` 79, `RestaurantPaymentsScreen` 51,
`CurrencyContext` + `PosScreenCoreFlow` 56 — all pass. `tsc --noEmit` clean in every touched file,
`eslint` 0 errors.

**The full UI suite is red (17 failures) and none of it is this work:** `0be15c118`, another lane's
`feat(purchasing)` commit, landed `ReceivePoModal.css`, `VendorBillsScreen.tsx` and
`KasbonSettlementModal.css` with hardcoded colours, undefined tokens, uncited sheets and an
unlocalised toast. `git diff 0966258bc..HEAD --name-only` shows none of those paths in this session's
commits.
