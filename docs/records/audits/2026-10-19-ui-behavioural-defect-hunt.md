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

## Round 50: a tri-state the type system already knew about

**The defect.** `RetailPosScreen` read the active shift with
`getActiveShiftScoped(...).then(...).catch(() => setActiveShift(null))`. The catch collapsed a FAILED
read into the same value a successful "no shift open" read produces. Two consequences:

1. `RetailHeader` printed **"No shift"** — an assertion of absence made from a read that never answered.
2. `handlePay` guards on `!activeShift` and told the cashier **"open a shift first"** — for the same
   non-answer. On a till, that is the moment the queue stops.

The fix adds `shiftLoadFailed` as a separate boolean and lets the header say "Shift unknown".

**What made this one worth the round: the tests were lying in the other direction.** Adding the flag
broke a passing test named *"displays "No shift" badge when no active shift"*, whose mock was:

```ts
getActiveShiftScoped: vi.fn(() => Promise.reject(new Error('no shift')))
```

That mock had been teaching every test in the suite the wrong contract. I checked the real one instead
of adjusting my code to the mock:

- `crates/kasirmu-bridge/src/shifts.rs:346` — `Result<Option<ShiftDto>, BridgeError>`, answering
  `Ok(None)` when nothing is open.
- `ui/src/api/shifts.ts:48` — `Promise<ShiftDto | null>`.

So a rejection was never "no shift"; it was a failure, and the suite had been pinning the defect in
place. A second suite (`RetailPosScreenInteractions`) carried the same mock, and its own comment
recorded the damage: an F1 reachability test was abandoned because `handlePay` early-returned on the
open-shift guard (line 894-896). Both mocks now resolve `null`, and that explanation no longer applies.

**The honest lesson**: a test that fails when you fix a bug is not always a regression — sometimes it is
the bug's alibi. Read the contract at both ends before deciding which side is wrong.

## Round 51: the fifth sweep, and a dimension that is genuinely empty

This round hunted the same family across a dimension the earlier rounds had not walked — **swallowed
`catch` blocks in hooks and event wiring** — and found nothing worth fixing. Recording that honestly is
the point, because the yield is now the finding.

What the sweep examined, and why each was cleared:

| target | verdict |
|---|---|
| `StockCountsScreen` | correct — `error` branch tested BEFORE the empty branch (:127 vs :134) |
| `features/offline/OfflineQueueScreen` | correct, and unusually so: a comment at :182 explains why `.catch(() => [])` was replaced, and :205-215 argues `null` = UNKNOWN for the quarantine list |
| `useBackupStatus` | correct at the strongest level: `undefined` (never answered) is kept distinct from `null` (answered "never backed up"), with the reasoning at :100-124 |
| `RestaurantMenu` (3 catches) | correct — the :328 comment explains that a failed read must leave the persistence gate SHUT or the next edit writes `[]` over the server's 86'd list |
| `TableManagementScreen` (3 catches) | correct — Tauri `listen()` registration; swallowing is the right call |
| `useEdcTenderPhase` | degraded by design — a failed terminal-list read falls back to the default alias, and a failed pre-flight already exits with `terminalFailed` |
| `RetailPosScreen` track-serial batch | correct — the catch releases the pending guard so a later cart change re-fetches |

That is four consecutive files where the author had already reasoned to the same conclusion this
campaign keeps reaching, often with the exact distinction I would have drawn (`undefined` vs `null`,
answered-empty vs never-answered). **The family is exhausted in `ui/src`.** Five rounds of it produced
24 fixes; a sixth would be manufacturing work, and round 44 already established that manufacturing work
for a nonexistent backlog is worse than saying the backlog is empty.

## Round 52: a money-precision claim I made, measured, and withdrew

Round 51 closed the failure-visibility family, so this round changed axis to **money precision** — a
genuinely different risk. It produced no fix, and the reason is worth recording in detail because the
mistake was mine and it was subtle.

**What I thought I had found.** `KasbonSettlementModal` converted the typed repayment amount with
`Math.round(parseFloat(s) * 10 ** exp)`. I probed it and got:

```
1.005   raw=100.49999999999998579   rounded=100
```

That looked like a one-unit loss for a cashier who typed `1.005`. I wrote a string-splitting parser,
wired it in, and added a kill test at IDR's exponent 0 where `100.5` would round DOWN to 100.

**Why it was wrong.** My probe compared `parseFloat(s) * 100` against `Math.round(Number(s) * 100)` —
and that "expected" side performs the *same* float multiplication, so it could not detect the very
drift I was testing for. Once the kill test ran against the real component, the float path produced
**101**, not 100: `100.5` at exponent 0 has no fraction to lose. And at exponent 2 the cases I had
listed (`1.005`, `2.675`, `8.615`, `1.015`) all agree with exact arithmetic, because `Math.round`
absorbs the sub-midpoint error by design. `1.005` rounding to 100 is *correct* rounding of the value
that was actually typed into a double — not a bug to fix.

I reverted both the parser and the test with `git checkout --`, confirmed `git diff --stat` empty and
the suite back to 4/4. Nothing was committed.

**The transferable rule**: when probing float behaviour, the reference implementation must not use the
same float operation as the code under test, or the probe agrees with the bug. Use exact integer or
string arithmetic for the expected side.

## Round 53: two more axes measured clean, with numbers rather than impressions

Round 52 withdrew a claim; this round measured two fresh axes and found both clean. I am recording the
measurements because "I looked and found nothing" is only useful if the looking is auditable.

**Axis 1 — localization coverage.** I wrote a key-set diff over `shared-ui/locales/*.ftl` and a
reference scan over `ui/src`:

| measure | result |
|---|---|
| English keys | 5,757 |
| Indonesian keys | 5,812 |
| English ids referenced from `ui/src` | 4,588 |
| referenced ids missing from BOTH bundles | **7 — all in test files or test utils** |
| keys present only in the Indonesian bundle | 55, **none referenced by production code** |

The 55 orphans (`customers-title`, `pos-hold`, `orders-void`, …) are stale duplicates, not live keys.
The one that *looked* live was a near-miss worth naming: `InventoryReportScreen.tsx:151` references
`inv-report-title`, and the Indonesian bundle also carries an unreferenced `inventory-report-title`.
Two different keys a letter apart; the referenced one exists in both. A grep for "inventory-report-title"
that stopped at the first hit would have produced a false finding, which is how I nearly filed one.

**Axis 2 — stale-response races.** I scanned every feature screen over 8 KB for `await` count versus the
presence of a generation counter, `AbortController`, or `cancelled` flag: 25 screens had 3+ awaits and no
such guard. Reading the top candidates cleared them all — `SalesHistoryScreen` (16 awaits, highest count)
keeps filters client-side and keys `load` on `[sessionToken, l10n]`, so no two reads can overlap;
`VariantManagementScreen`, `FeatureToggleScreen`, `KioskScreen` likewise. A guard is only needed where a
dependency can change mid-flight, and none of these has one.

Both axes are empty. Two focused subagents are running on listener/effect leaks and focus-trap boundaries,
which are the remaining shapes I have not measured.

## Round 54: one real a11y defect, and one refuted subagent claim

**The defect — one Escape dismissed every nested overlay.** `SalesHistoryScreen` mounts three
focus-trapped overlays, and the e-Faktur stamp dialog is opened from a button INSIDE the sale-detail
dialog. Both traps are therefore active at once, and `useFocusTrap` attaches one document keydown
listener per active trap with no check that the event concerns its own panel. One Escape ran every
active `onEscape`. Measured with a probe before touching any code:

```
BEFORE dialogs= 2        AFTER dialogs= 0
stamp gone= true         detail open= false
```

The cashier pressed Escape once and lost the detail view behind the stamp dialog as well. The existing
suite already had a test for the stamp overlay and it PASSED throughout — it asserts the stamp dialog
closes and the screen survives, which the double-dismiss also satisfies. A passing test for the wrong
half of the behaviour is how this survived.

Fix: the Escape branch now ignores the key unless the focused element is inside this panel. After:
`AFTER dialogs= 1, stamp gone= true, detail open= true`. Kill test verified by reverting.

**The refuted claim.** The focus/keyboard subagent reported that `LocationPicker`'s Enter handler
commits the wrong row because `isSearchFocused` guards Space (:247) but not Enter, and typing resets
`activeIndex` to 0 (:393). Every static claim in that report was true — I read all of them — but the
conclusion was not. I wrote the test it implied and it PASSED, then probed the two specific scenarios
it described:

| scenario | actual |
|---|---|
| type "Shelf 7" → Enter | commits `loc-7` — the single filtered row is at index 0, so index 0 is correct |
| type "Shelf 7" → Tab to the option → Enter | focus lands on Shelf 7, commits `loc-7` |
| ↓↓ → Enter with no query | commits the row at the highlighted index, correctly |

The reasoning error is worth naming: `activeIndex` being *stale at 0* is only a defect if 0 is the wrong
row, and after filtering it is exactly the right one. The claim generalised from "the index does not
track the selection" to "the wrong row is committed" without exercising a case where those differ.

I kept the passing test — it is a genuine regression guard for the Enter path, which had no coverage —
and recorded it as a test, not a fix.

## Round 55: the same nesting bug, in the layer the round-54 fix did not reach

Round 54 fixed Escape being answered by every active trap. The stamp dialog had a SECOND problem
underneath it, and fixing the first made it worth looking at the rest of the nesting:

**The child dialog painted UNDER its parent.** `SalesHistoryScreen` opens the e-Faktur stamp dialog
from a button inside the sale-detail dialog. The detail overlay stays mounted, both overlays are
`position: fixed; inset: 0; z-index: var(--z-modal)` (400), and the detail overlay is rendered AFTER
the stamp overlay (:1724 vs :1628). Equal z-index + later DOM position means the PARENT wins — the
stamp dialog opened completely hidden behind the detail overlay, unclickable.

I measured the DOM order rather than assuming it:

```
overlay count= 2
  [0] label=Stamp e-Faktur NSFP  stamp=true   detail=false
  [1] label=Sale detail          stamp=false  detail=true
```

The overlay at index 0 is the child and it is first, so it loses the cascade.

**Why this needed a stylesheet test, not a render test.** jsdom computes no layout: `getComputedStyle`
returned an empty string for `z-index` on both overlays, so a rendered assertion cannot see the bug at
all. This is exactly the case where a passing component test proves nothing about the visible result.
The guard is therefore a contract test over the source: a `--z-modal-nested` token strictly between
`--z-modal` and `--z-toast`, and the stamp overlay naming it. Verified to fail when the rule is
pointed back at `--z-modal`.

**One thing I am not claiming.** `:has()` is a modern selector and I did not run a browser to confirm
the paint order on a real WebView2 build. The token ordering and the selector are pinned by the test;
the visual result is inferred from the cascade rules, not observed. It should be verified on a device
before this is called done.

## Round 56: the same z-index inversion, found by scanning for its shape

Round 55 fixed the stamp-over-detail inversion. This round scanned for other instances of the shape
rather than waiting to trip over them, and found one — in the payment modal, where it is worse.

**The defect.** `PaymentModal` opens a customer-search dialog from inside itself, and both are focus
trapped (`useFocusTrap(panelRef, ...)` and `useFocusTrap(customerSearchPanelRef, showCustomerSearch, ...)`).
The parent is `.payment-overlay` at `calc(var(--z-modal) + 10)` = **410**; the child is
`.payment-customer-search-overlay` at plain `var(--z-modal)` = **400**. The child is mounted inside the
parent, so it painted 10 layers BELOW the panel it covers: focus moved into an input the operator could
not see, and the payment panel stayed on top.

**The repo had already solved this exact problem once, and said so.** `RestaurantCartSheet.css:31-48`
carries a five-line comment about `calc(var(--z-modal) + 1)` putting a panel above every modal in the
app, with a measurement and an `elementFromPoint` result. The pattern was known, written down, and not
applied here — because there was no test that would have caught the second occurrence. There is now: the
contract test asserts the nesting rule for every nested overlay I found and that `--z-modal-nested`
(450) clears the parent's `+ 10` layer specifically, not merely `--z-modal`.

**What I checked and left alone.** Six hardcoded `z-index` values reach or exceed the nested layer
(`RetailPosScreen.css` 2000/1000/900, `ReceivePoModal.css` 1050, `SessionLockScreen.css` 9999,
`LicenseActivationScreen.css` 1000). These are not the same defect: they are absolute values for
surfaces that are meant to sit above everything, and the ones I opened (`ReceivePoModal`) raise no
toasts, so their being above `--z-toast` has no consequence. Converting them to tokens without that
argument would be churn dressed as a fix.

## Round 57: a duplicate-id scanner, and the four hits it produced that were not bugs

I scanned every non-test `.tsx` for the same DOM `id` appearing twice in one file — a real
accessibility class, because a duplicate id makes `htmlFor`, `aria-labelledby` and `getElementById`
resolve to whichever node the browser finds first.

The first two scan attempts were wrong and worth recording, because the error is the kind that produces
a false report:

| attempt | hits | why it was wrong |
|---|---|---|
| `\sid="…"` | 20 files | matched `<Localized id="…">`, which is a Fluent message key, not a DOM id |
| exclude lines containing `<Localized` | 4 files | the tag is often on the line BEFORE the id (multi-line JSX props) |

The third pass correctly narrowed to 4 files, and **all four were false positives** once opened:

- `RestaurantReceiptsScreen.tsx:2800/2818` — two `<input id="resto-hw-printer-path">` behind MUTUALLY
  EXCLUSIVE conditions (`printerConnection === 'bluetooth'` vs `'network' | 'serial' | 'usb'`), so only
  one exists at a time. The shared `htmlFor` resolves correctly to whichever is rendered.
- `RetailSubViews.tsx:27/52/78` — three separately-exported sub-view components, each with the same
  skip-link target; only one is mounted at a time.
- `OverQuotaCard.tsx:231/383` and `FastPINOverlay.tsx:454/485` — `<Localized id=` again, missed by the
  line-based exclusion.

**The general lesson**: "the same id appears twice in this file" is only a defect when the two nodes can
be in the DOM simultaneously, and a static grep cannot see that. Every one of the four needed its
enclosing condition read. That is also why I am not shipping a scanner-based guard here — it would have
to encode those three exclusion rules and would still flag the two legitimate cases.

Nothing to fix. The axis is recorded as measured so a later pass does not repeat the false positives.

## Verification

`WorkspaceRestaurantPosSettings` 15 tests, `TableManagementScreen` 79, `RestaurantPaymentsScreen` 51,
`CurrencyContext` + `PosScreenCoreFlow` 56 — all pass. `tsc --noEmit` clean in every touched file,
`eslint` 0 errors.

**The full UI suite is red (17 failures) and none of it is this work:** `0be15c118`, another lane's
`feat(purchasing)` commit, landed `ReceivePoModal.css`, `VendorBillsScreen.tsx` and
`KasbonSettlementModal.css` with hardcoded colours, undefined tokens, uncited sheets and an
unlocalised toast. `git diff 0966258bc..HEAD --name-only` shows none of those paths in this session's
commits.

## Round 58: the debt ledger was ranking six already-paid entries, and the theme gate had gone red unnoticed

This round did not hunt a defect class. It started from the last 50 commits and asked what the
journal and the gates say about the tree's current state — and found both of them wrong in the
same direction: **work that was finished was still being handed out as work to do.**

**Finding 1 — six entries in `todo-optimize-crates.md` were paid and still ranked as open.**
`§11E` had already recorded this exact failure once (*"This is the fourth time today that work
recommended from a dated plan doc turned out already paid"*), and it recurred. Three entries —
**O-H23, O-H24, O-H26** — were fixed on 2026-09-27 by other lanes. Three more — **O-H03, O-H04,
O-H08** — literally say *"Fixed:"* in their own text and were nonetheless counted as open by every
tier census, including the one in §9's funding list, which named O-H23/O-H24/O-H25 as the head of
the queue.

The check that settled it is the one worth carrying: **name the symbol the fix introduced, then
`git grep` for it.** "A commit message says fixed" is not evidence; a function that exists at HEAD
is. That method confirmed `mark_offline_synced_batch` (`db/offline.rs:298`),
`shared_sync_http_client()` (`sync_client.rs:430`), `get_products_track_serial_batch`
(`db/products_crud.rs:830`), the `try_lock` at `ctx.rs:434`, and the 2a/2b lock split at
`email_scheduler.rs:70`/`:93`.

**The same method refuted one.** O-H01's entry reads as though it were addressed, but
`sales_lifecycle.rs:628` is still `for line in &sale.lines { self.recompute_popularity(...) }` —
one call per line, exactly the shape O-H01 describes. It stays open. A blanket "the Highs look
fixed" pass would have closed it wrongly.

All six now carry a ✅ PAID marker inside the entry, and the file opens with a measured table
(131 defined / 28 closed by §11 heading / 6 marked in-entry / 97 open) so a reader does not have
to re-derive any of it.

**Finding 2 — the theme-token gate had been red since `160734e90`, and the last round's record
attributed it to a different commit.** `themeTokenCompliance.test.ts` was failing 6 of its 53
cases with **71 hardcoded-value violations**, a baseline that the file declares as **0** ("All CSS
files now use design tokens"), plus **14 references to tokens that exist nowhere**
(`--color-surface`, `--color-scrim`, `--color-primary-light`, `--color-primary-subtle`,
`--color-info-fg`, `--color-surface-alt`, `--color-surface-hover`).

The undefined ones are the serious half. A `var(--color-surface, #ffffff)` with no definition does
not fall back to a token — it renders the literal, or renders **nothing at all** where no comma
fallback was given. Three sheets were carrying a private, invented token vocabulary that no theme
block defines, and jsdom could not see it.

Fixed by mapping every invented name onto the real token rather than adding fallbacks:
`--color-surface`→`--color-bg-surface`, `--color-scrim`→`--color-bg-overlay`,
`--color-surface-hover`→`--color-bg-hover`, `--color-surface-alt`→`--color-bg-secondary`,
`--color-primary-light`/`--color-primary-subtle`→`--color-primary-soft`,
`--color-info-fg`→`--color-fg` — and by replacing 71 raw values with the existing scale
(`--space-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--leading-*`, `--color-*`).

**Two things I checked that the gate does not.** First, that every one of the 60 tokens the three
sheets now use is actually **defined** — the gate grades some of this, but a token defined only in
`:root` and used in a themed sheet is a different question. All 60 resolve. Second, that the
colour tokens survive every theme: `--color-primary-soft` and `--color-danger-border` are absent
from the `[data-theme='dark']` block, which looks like a defect and is not — `:root` declares
both, and the cascade supplies them. Verified rather than assumed, because declaring a token
"missing" from a theme block it inherits is the easy false positive here.

**Finding 3 — a kill-test mutation was left live in the working tree.**
`sync_client.rs` carried `if false && outcomes.len() != pending.len()` — the O-H21 guard,
disabled — while HEAD held the correct `if outcomes.len() != ...`. The paired test file had also
been edited but never committed, so the fix's test was orphaned from the fix. Both are now
reconciled: the source restored to HEAD, the test committed, and `cargo test -p kasirmu-core
apply_sync_outcomes` green at 6/6.

**The transferable lesson:** the failure mode this round had in common across all three findings is
**trusting a label instead of a measurement** — a plan entry's presence read as open work, a
record's attribution of a red gate taken at face value, a guard's text read as live code. Each was
cheap to disprove and none had been disproved, because reading is faster than checking and the
documents looked authoritative.

> last audited 19-10-26 by docs-auditor
