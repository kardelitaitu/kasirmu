# The restaurant shortcuts had never been executed — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 100 · status: coverage gap closed,
     hook verified correct, TWO of my own tests corrected · branch: 0.0.41 · commit: `654b2992a` -->

<!- - Scope: the restaurant shortcut hook, on a tree verified green at 811/811
     (12,882 passed) going in. No production code changed — the hook was correct. -->

## The gap

Every existing restaurant-shortcut test is a **source scan**.
`restaurantShortcutParity.test.ts` reads the manifest, the hook's interface and
PosScreen's handler object as TEXT. Those scans are good at "the map names a real
handler" and structurally blind to whether **the key event reaches it**.

A grep for the hook across `ui/src/__tests__` found it only inside comments of the
parity test and one unrelated CartPanel case. **Zero behavioural tests.** The five chords
(Shift+K/P/B/T/L) wired in round 93 had never been executed — a broken listener
registration, a broken matcher, or a broken `preventDefault` ordering would have passed
every suite in the repo.

That is the same shape as round 99's New Tab finding: a control with a source-level guard
and no execution.

## The hook is correct — and now provably so

Six cases, all driven through a real `renderHook` with real `KeyboardEvent`s on
`document`:

| Claim | What it pins |
|---|---|
| fires every advertised action | the manifest drives the test, so a sixth dead binding fails |
| stops at the first matching entry | one chord, one action, checked across every entry |
| suppresses while an editable target has focus | the `editableGuard` flag actually works |
| consumes the event | `preventDefault` — the difference between a shortcut and a browser shortcut |
| does not fire without Shift | a chord needs its modifier |
| stops listening on unmount | the cleanup callback is real |

## Two of my own tests were wrong, and the kill tests caught both

**Test 1 was a rubber stamp.** The first "only ONE handler per event" case passed with
the loop's early `return` REMOVED. With one handler per action and a single chord, only
one manifest entry can ever match — `matchesRestaurantShortcut` compares the key — so
the mutation it named was undetectable by it. Replaced with a case that asserts the
observable property across **every** entry rather than inferring it from one.

**Test 2 failed for the wrong reason first time.** The `editableGuard` case dispatched
the keydown on `document`, so `e.target` was the document and the guard correctly saw a
non-editable target — the test reported a defect that did not exist. Dispatch has to go
to the element, which is what a real keystroke does.

**Then my kill-runner produced four false "parse errors".** It matched my own crude
`/Error/` regex against the *AssertionError text* the tests were correctly printing. The
kills had worked; my reporting had not. Re-checked individually, each fails on its named
assertion.

Recorded because the session's last three rounds have each had a detector or a test that
was itself wrong, and that pattern is more useful to state than the individual wins.

## Verification

- **Full suite: 812/812 files, 12,888 passed, 0 failed** (3 skipped, 3 todo).
- **Four kill tests**, each reverting one claimed behaviour and each failing the case
  that names it: no `preventDefault`, no `editableGuard` check, no unmount cleanup,
  no listener registration.
- Production code **unchanged** — `git hash-object` on the hook is identical after the
  kill runs. The value here is a guard, not a fix.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> A source scan can prove a map names a real handler. It cannot prove the key reaches
> the handler. When a feature's entire test coverage is static, the runtime behaviour is
> unverified however many assertions the file carries — and the fix is one
> `renderHook` and a real event, not another regex.

> last audited 18-10-26 by autonomous-goal-round-100
