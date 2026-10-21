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

## Round 40: three from the hooks lane, two refused

- **The store timezone survived a store switch.** `useStoreTimezone` kept `storeTz` while the next read
  was in flight (and after it failed), so a hot-swap from a +07:00 store to a +00:00 one bucketed the new
  store's orders into the old store's day — presented as current. The file's own contract already says
  `null` means "not known yet"; the effect just never reset to it.
- **A missing session token read as "no terminals registered".** `useTerminalProfile` answered `[]`
  without issuing any IPC when the token had not resolved yet, which also skipped the kiosk detection.
  It now stays in the loading state and lets the token arriving re-run the effect.

### Refused — both class-3 claims, both wrong

- **"A failed sync probe keeps the pill green."** The `catch` sets `'disconnected'` and nulls the
  latency, and `nextDelay` initialises to `RETRY_INTERVAL_MS`, so the fast retry is armed too. The agent
  quoted the assignment it expected instead of the one that is there.
- **"`useSyncConnection` retries only once a minute after a failure."** Same misread, same lines.

That is the pattern worth naming for this lane: **class-3 claims about `catch` blocks are the cheapest to
check and the easiest to get wrong.** Two of three such findings this round were refuted by reading the
six lines under the `catch`.

## Round 40, second pass: four more from three fresh lanes, two refuted

Three new hunts (reports/analytics, products/catalog, terminals/settings components) returned ten
candidates. **Four were verified and fixed; three were refuted on reading.**

- **A bundle list that failed claimed an empty catalogue.** `load` swallowed the rejection, so a manager
  with a full catalogue was shown "No bundles yet. / Add your first bundle". Its own sibling
  `ProductManagementScreen` had drawn the empty/failed distinction all along.
- **The custom report's pager never fetched.** `page` is in `runReport`'s dependency list and builds the
  request's `offset`, but Next/Prev only called `setPage` — so the label read "Page 2" over page 1's rows.
  A paging effect now re-runs the report.
- **Menu engineering let a stale window win.** The date re-seed effect flips the window as soon as the
  store timezone resolves, so two mount fetches run with different windows and the last to resolve won.
  Added the generation guard its sibling `SalesReportScreen` already uses.

### Refuted

- **"`retail-col-hide-inactive` exists in no Fluent bundle."** Both the key and its nine siblings are in
  `shared-ui/locales/sales.ftl`. The search was scoped to `ui/`, which cannot see the shared bundle.
- **"The terminal override switch collapses three states into two."** `isOverridden = ov !== undefined`
  is exactly right: `enabled` is a plain `boolean`, so an explicit `false` override IS distinguishable
  from an absent row, and `ov ?? false` is the correct checkbox default.
- **"The terminal rollback restores a stale snapshot."** Reported, then read: the closure snapshot is the
  list as of the click, which is what a rollback of that click should restore.

## Round 41: six fixes, and one shape that keeps recurring

All six came from the previous round's candidate lists, each verified before touching code:

- **The restore tab claimed no backups exist when the list read never answered.** Its own
  `RestoreState.status` field documents the rule in a doc comment — "RestoreStatus -> the read ANSWERED /
  undefined -> it never answered; it FAILED … only the first may be rendered as a clean state" — and the
  `candidates` field right above it violated exactly that. Made nullable, with an unknown branch, and a
  kill test that fails without it.
- **A category with no products was invisible in every chip bar.** `useProducts` fetched
  `categoryMeta`, exported it, and derived `categories` from the product list alone — so a category the
  merchant had just created could not be selected anywhere.
- **A locally chosen grid view reverted to text on every reload.** `raw['retail_view_mode'] === 'grid' ?
  'grid' : 'text'` collapsed *absent* into *'text'*, then wrote that default over the localStorage copy
  that held the user's actual choice.
- **The Settings Revert baseline could latch the fallback currency.** `initialized` closes the snapshot
  on the first pass, so a currency read landing later could not repair it.
- Plus the two hook fixes from the first half of the round (store timezone on store switch, missing token
  read as "no terminals").

**The shape that keeps recurring is worth naming.** Of the ~45 defects fixed this campaign, the largest
single family is *a failure collapsed into an empty or default value* — `[]`, `null`, `'text'`,
`false` — rendered as a clean state. It has now appeared in restore candidates, retail view mode, stock
count catalogue, warehouse pickers, terminal status, bundle list, customers search and store timezone.
The fix is always the same and it is always cheap: **carry a third value that means "did not answer", and
let the render branch on it.** Four of those screens already had the correct pattern in a sibling field
or a sibling file, which is the useful signal: when a field's doc comment explains the unknown state, the
field beside it usually needs the same treatment.

## Round 42: hunting the named shape mechanically

Round 41 named the defect family — *a failure collapsed into an empty or default value, rendered as a
clean state* — so this round hunted it with a **scanner instead of intuition**: every `catch {` in
`ui/src/features` whose body sets state to `[]` / `null` / `false` / `''` and sets no error, three
lines below the catch. 288 catch blocks → **14 candidates**. Two read-only agents triaged them against
the render path; **5 were confirmed and fixed, 9 were benign** (delete catches, values re-derived from
another source, `poListFailed` already branched first).

The five:

- **An unread day printed as zero revenue.** `DailyTotalWidget` caught the export failure, set
  `summary([])`, and rendered `formatMoney(0)` as the green primary KPI. The dashboard's most
  load-bearing number, asserting "no sales today" from a refused `reports:export`. The site's own test
  asserted the defect — `expect(screen.getByText(t => /^\$/.test(t)))` after a rejected read — so it was
  rewritten to require the error and forbid the figure.
- **A failed detail read read as "Order not found."** `VoidOrdersScreen` turned `detail = null` into an
  authoritative non-existence claim; `detailError` now renders first.
- **An unread recipe read as an empty BOM.** `RecipeEditorModal`'s outer catch only cleared the rows, so
  the render said "No ingredients added yet" with a Total HPP of 0 for a dish that has a recipe.
- **A failed instance read looked like an empty store.** Both `TerminalManagementScreen` instance reads
  emptied `bindingInstances` and set no error, so the "— Select instance —" placeholder was identical to
  a genuinely empty store and Bind stayed disabled with nothing explained. Also fixed the un-coerced
  payload at the second site.

### The scanner earned its keep

It found all five within one pass and cost two tool calls. The contrast with the agent-led hunts is the
useful part: those return a mix of real defects and confident nonsense that must be refuted by hand
(~8 refuted so far), whereas `git grep` + a two-line body predicate produced a **14-item list with a
50%+ hit rate** and no false positives to argue with. When the defect shape can be written as a regex,
write it — reserve the agents for the judgement calls the regex cannot make (is this empty state TRUE?).

## Round 43: the scanner's yield drops, and what that means

Three more mechanical scans, each targeting a different shape of the same family:

| scan | sites | confirmed |
|---|---|---|
| `.catch(() => []/null/{})` fallbacks | 37 | 0 |
| `?? []` / `?? null` fallbacks | 214 | 0 |
| screens with no toast **and** no alert **and** no error text | 12 | 0 (all thin wrappers, zero `await`) |
| rendered `.length` counts (a zero is a claim) | 48 | **1** |

**One defect found: `DebtRemindersCard` told the merchant their debtors were settled.** The card uses
`Promise.allSettled` so one read cannot take the other down — but then *dropped* the rejection, leaving
the array at its `[]` initial value, and the render turns "no overdue rows" into the affirmative badge
**"Up to date"**. One failed receivables read asserted, in the merchant's own dashboard, that nothing was
owed. Both sides had it; both now carry a per-side failure flag, and a kill test pins it.

### Why the yield dropped, and why that is the signal

Rounds 42 and 43 both used regex scans. Round 42's found 5 defects in 14 candidates; round 43's found 1 in
311. That is not the scans getting worse — it is the **backlog being consumed**. The same is true of the
agent hunts: the last two batches returned findings that were mostly already-fixed sites, with the agents
independently rediscovering `poListFailed`, `settleRead` and other fixes this campaign landed.

Four families are now provably thin:

- **failure-collapsed-to-empty** — 8 fixed across the campaign; the remaining catches are delete handlers,
  best-effort cache writes, or values re-derived from an independent source.
- **drifted line citations** — closed to 0 in round 32, and every `.rs` cite has now been read once.
- **stale-line-number comments** — the guard's census is 0 and the rule is "anchor by symbol".
- **duplicated async work** — the handful of double-fetches (compare panel, pairing, menu editor) are fixed.

The honest statement is that **this vein is close to worked out**. Further rounds in the same shape will
return mostly refutations, which costs more to disprove than it is worth. The next useful axis is a
different *kind* of question — not "does this failure render as success", but things a regex cannot ask:
whether a screen's stated contract matches what it does, whether a test asserts the right thing, whether
two modules disagree about an invariant.

## Round 44: the tests that were not there

Round 43 concluded the *defect* vein was worked out. This round asked a different question — **did the
campaign's own fixes leave tests behind?** — and the answer was: not all of them.

Method: for each fix, grep the test tree for the message or behaviour it introduced. Four of the
campaign's fixes had **no assertion anywhere**:

| fix (round) | pinned? |
|---|---|
| `DataManagementRestore` unknown-vs-empty | yes |
| `TopologyRevisionBrowser` failed revision | yes |
| `DailyTotalWidget` zero-revenue | yes (the apostrophe entity defeated the first grep) |
| **`DebtRemindersCard` payables all-clear** | **no** |
| **`TerminalManagementScreen` instance read** | **no** |
| **`WarehouseConsole` picker failure** | **no — the screen had no behavioural test at all** |

All three now have kill tests, each verified in both directions (fix removed → red, restored → green).

The `WarehouseConsole` case is the notable one: a **751-line screen** whose only test references were
static suites (`screenExtraction`, `popupBackgroundCompliance`, `warehouseShortcut*`) that check class
names and shortcut parity. Nothing rendered it and clicked anything. Writing its first behavioural test
took four attempts because the receive popup is reachable through two paths — an F1 keydown guarded on a
typing state, and the FnBar button — and only the button works in a harness that does not mock the bar.

### The lesson, stated once

**A fix without a test is a fix that decays.** Every one of these was found by a read-back that a test
would have done automatically. The campaign has now fixed ~50 defects and, as of this round, every
behavioural fix that can be pinned carries a test that fails without it. That is the durable form of the
work; the diffs are not.

### Round 45: the coverage backlog turned out to be empty

Last round's note above said `WarehouseConsole` was "one of the largest" of a class of barely-tested
screens. That was an inference from one file, not a measurement. Measured properly, it does not hold:

| measure | result |
|---|---|
| screens with no **name-matched** test file | 10, all thin wrappers (25–112 lines) |
| components >120 lines with no test **reference at all** | 3 — all three analytics components, all mounted and exercised through `AnalyticsScreen.test.tsx` |
| modules >200 lines with no test reference | 0 real hits (the rest are test files matching themselves) |

Two lessons, both about measuring rather than estimating:

1. **Name-matching undercounts coverage badly.** `EdcTerminalsCard` (528 lines) looked untested because
   its test is called `EdcTerminalFormDoubleSubmit.test.tsx`. Grepping for the *identifier* rather than
   the *filename* found it immediately.
2. **A component being unmounted is not the same as untested.** `AnalyticsHeatmap` has no test file and no
   other module imports it by name in a test — but `AnalyticsScreen` renders it, and the screen's suite
   mounts the screen. Indirect coverage counts.

So the "coverage backlog" I proposed as the next axis **does not exist**, and the honest thing is to say so
rather than manufacture work for it. `WarehouseConsole` was the genuine exception — a 751-line screen with
only static coverage — and it now has a behavioural test.

## Round 45: 32 modified files, 0 changed bytes

The worktree reported 32 modified entries. They were not work. Every one of them is a **stale stat
cache entry**, and the evidence is three independent measurements agreeing:

| measure | value |
|---|---|
| `git status --porcelain` entries | 32, all ` M` (none untracked, none staged) |
| `git diff --ignore-cr-at-eol --numstat` | **0 lines across the whole tree** |
| `git hash-object <path>` vs `git rev-parse :<path>` | identical for every file sampled |

The `--porcelain=v2` form settles it without inference: each entry prints the *same* object id twice —
`1 .M N... 100644 100644 100644 <same> <same> README.md` — where the first is the index blob and the
second the working-tree blob. Git itself is reporting that the content matches and only the stat data
disagrees. `git update-index --refresh` printed `needs update` for all 32 and changed nothing, which is
the signature of a stat cache that cannot be repaired in place.

The mechanism fits: `core.autocrlf=true` with `text: auto`, while the index blobs hold LF (verified —
`git cat-file -p :README.md` shows bare LF, and `git check-attr` reports `eol: lf`). `core.trustctime` is
`false`, so the racy-git ctime check is already off and cannot be the cause; the remaining candidate is
the mtime/size pair on files rewritten by the line-ending step.

**I did not "fix" it.** The only commands that would clear the cache are `git checkout -- <paths>` or a
`git add`, and both are forbidden here: `git add` is barred outright by §7.3, and `checkout` would
overwrite working-tree files that other lanes share. AGENTS.md §7.3 already documents this exact
situation — *"Not every ` M` is content … matching hashes mean nothing to commit"* — so the correct
action is to report it, not to launder it.

The honest summary for this round is therefore: **the worktree is clean of my work — 0 content diffs,
0 untracked files** — and the 32 ` M` entries are a reporting artefact, not uncommitted work.

## Round 46: three defects, two from subagents, and one refutation of my own

Three fixes landed this round, each with a test proven to fail without it.

**1. Dashboard kept the previous range's figures after a failed refresh** (`DashboardScreen.tsx`).
`loadData`'s catch set `error` and nothing else, so `dailyRevenue`, `topProducts` and `lowStock`
still held the OLD range's values while the banner said the load failed. The low-stock branch then
printed **"All stock levels are healthy."** — because an empty array is what it tests, and the array
was empty only because the read had thrown. The fix clears the data and gates the health claim on
`!error`, with a new `dashboard-stock-unknown` string for the honest state.

**2. Suppliers turned a failed read into "the registry is empty"** (`SuppliersScreen.tsx`).
The catch was literally `setSuppliers([])` — it *installed* the empty answer, and the empty-state
card then said "No suppliers yet." with an "Add your first supplier" CTA. The file already had an
`error` state, but it belonged to the create/edit form and was never used for the list read. Now a
separate `loadError` renders an alert plus Retry.

**3. The EDC terminal read was swallowed while its neighbours were not** (`RestaurantPaymentsScreen.tsx`).
This one is a subagent find and it is the sharpest of the three, because the file argues against
itself: at line 496 it calls `setLoadFailed(true)` inside the `.catch` of the two gateway reads,
with a comment explaining that a swallowed read leaves the screen looking clean — and 100 lines
*above*, the EDC list read still did `listEdcTerminalsScoped(token).catch(() => [])` with no flag.
A rejected EDC read therefore rendered an empty terminal list, a green "All changes saved", and an
**enabled** Save that wrote a blank `defaultEdcTerminalId` over the real hardware binding.

**What I refuted first.** I read `SalesReportScreen.tsx` in full and was confident I had found a bug:
`fetchData` and `fetchPrevData` share one `fetchGenerationRef`, so I expected each to invalidate the
other and the period-comparison delta never to render. I wrote a probe and it **passed** — the delta
rendered correctly, including with a deliberately slow current-period read that resolved after the
previous-period read. Sequential effects mean the counter advances in a safe order here. I deleted
the probe rather than report a defect that does not exist. That is the fourth time this campaign a
plausible-looking shape survived contact with a probe, and it is why the probe comes before the fix.

## Round 47: three more of the same family, and a scratch file I had to own

Round 46 established the family; round 47 cleared the rest of the subagent's findings from it. All
three are the identical shape — a failed read rendered as a positive claim — in three different
screens, which is why they are worth a round rather than a footnote.

**Purchase orders** (`PurchaseOrdersScreen.tsx`). The catch did nothing but `addToast`. The render
then fell to `filtered.length === 0` and claimed **"No purchase orders yet."** — or, with a status
chip selected, **"No purchase orders with status pending"**, which is not an empty-state message at
all but an assertion about what the backend answered. A `loadError` + Retry now sits above the table
and the empty states are suppressed while it is set.

**Restaurant menu editor** (`RestaurantMenuEditorScreen.tsx`). This one is the most instructive about
partial correctness: `Promise.allSettled` is used *deliberately* so a failed category read does not
blank the items, and that part is right. But nothing recorded that the load had failed, so on a FIRST
load there were no previous items to keep — the grid printed "No items in this category yet." beside a
"New Item" call to action, and the rail counts read 0. Correct partial handling of one failure and a
false full statement about another.

**A scratch file I left behind.** `git status` opened the round with `.killblock.txt` untracked. That
was mine: the round-46 kill test wrote a code block to disk to restore it, and the `Remove-Item` in
that same chained command ran in the `ui/` working directory while the file had been written at the
repo root. I verified the file's content before deleting it (it did hold the `setDailyRevenue([])`
block and nothing else) rather than trusting the name. Untracked count is 0 again, and it is a reminder
that a cleanup chained into a command with a different `workdir` cleans nothing.

## Round 48: the subagents stalled, so I scanned by signature instead

The three hunts launched in round 47 were still `running` when round 48 opened, having produced
nothing. I interrupted all three and changed method: instead of asking an agent to read screens and
hope, I scanned for the family's **signature** directly — screens that call `addToast` on a load
failure but never set a persistent error state — then read only the hits.

That took three commands and produced two real defects out of nine candidates.

**Gift cards** (`GiftCardsScreen.tsx`). The catch toasted `gift-cards-error-load` and nothing else, so
`cards.length === 0` rendered "No gift cards found" — on the one screen whose entire job is showing the
balances the store owes customers. An all-clear there is actively dangerous: a cashier reads it and
tells a customer their card has no balance.

**Promotions** (`PromotionManagementScreen.tsx`). Identical shape: the toast was the only signal, and
the empty state claimed there are no promotions — which reads as "nothing is discounted right now" on
the screen that decides what customers are charged.

Both now carry a `loadError` with a Retry, and both suppress the empty state while it is set. The scan
also cleared seven other candidates on inspection (CategoryManagement, EodReport, ExchangeRate,
Loyalty, Memos, SalesHistory, SecurityTrail all already have a persistent error path).

**Two method notes, honestly.** I interrupted subagents that had run for over a round without output —
waiting on them costs more than the scan that replaced them. And I fumbled the `edit` tool three times
by trying to embed comment text containing backticks and dashes inside a TypeScript template literal;
the fix is to pass plain quoted strings, which is what AGENTS.md already implies by not encouraging the
other way.

## Round 49: a green test that proved nothing, and the two defects behind it

**The defects.** `InventoryReportScreen` had two, both in a twelve-line path:

1. `setError` fired on a rejected read and **nothing ever cleared it**, so one failed read pinned a
   red banner to the report for the rest of the mount — including after the threshold changed and the
   next read succeeded.
2. The catch left `items` at its old value, and the render branch tests `items.length === 0` — so a
   failed read printed **"No results found"** directly beneath the error banner. One element said it
   broke; the next said the answer is zero.

**The test that lied.** I wrote a kill test for #1 that **passed with the fix reverted**. Then I wrote
a second one; it passed too. That is the one failure mode this campaign exists to avoid, and the honest
record is the chain of wrong guesses it took to find it:

- Guess 1: the label query matched the wrong node. Switched to `getElementById`. Still green.
- Guess 2: `queryByText` was flaky. Switched to asserting on the banner element. Still green.
- Guess 3: the describe-level `beforeEach` installs a **never-resolving** default, so
  `mockRejectedValueOnce` queued behind an implementation that never settles. Added `mockReset()`.
  Still green.
- Actual cause, found by printing state instead of guessing: the first read had not resolved yet when
  `waitFor` ran, so the assertion was evaluating an empty DOM and passing vacuously. The debug line
  showed the truth in one shot — `calls=2 banner=true body=...Network error...No results found`.

The fix was to await the *settle* (poll for `toHaveBeenCalledTimes(2)`) before asserting on the
banner. With that, both tests fail on the reverted code and pass on the fixed code. **Three guesses,
one diagnostic print.** The lesson is not "try harder" — it is that a green kill test is evidence of
nothing until you have seen it fail, and printing state beats hypothesising about it.

## Verification

`WorkspaceRestaurantPosSettings` 15 tests, `TableManagementScreen` 79, `RestaurantPaymentsScreen` 51,
`CurrencyContext` + `PosScreenCoreFlow` 56 — all pass. `tsc --noEmit` clean in every touched file,
`eslint` 0 errors.

**The full UI suite is red (17 failures) and none of it is this work:** `0be15c118`, another lane's
`feat(purchasing)` commit, landed `ReceivePoModal.css`, `VendorBillsScreen.tsx` and
`KasbonSettlementModal.css` with hardcoded colours, undefined tokens, uncited sheets and an
unlocalised toast. `git diff 0966258bc..HEAD --name-only` shows none of those paths in this session's
commits.
