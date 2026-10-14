# The kasirmu-bridge suite does not fail — it does not finish (2026-10-13)

## Why this note exists

Round 31 of the restaurant-POS objective ran `cargo test -p kasirmu-bridge --lib`,
saw harness text ending in:

```
error: test failed, to rerun pass `-p kasirmu-bridge --lib`
```

and recorded the bridge suite as **failing**. That reading was wrong, and the way it
was wrong is worth keeping: the string is what cargo prints whenever the test process
is killed, and nothing distinguished it from an assertion failure.

## What is actually true

A full run writes to a file so the result survives the wait:

```bash
timeout 1500 cargo test -p kasirmu-bridge --lib > /tmp/b2.txt 2>&1; echo "EXIT=$?"
```

| Observation | Value |
|---|---|
| tests passed | **1509** |
| tests failed | **0** |
| ignored | 1 |
| `test result:` line | `ok. 1509 passed; 0 failed; 1 ignored` |
| wall clock | **1038.89s = 17.3 minutes** |
| exit code | **0** |

**The suite PASSES in full.** It is simply slow: 17.3 minutes exceeds every wait window
used on it, so each earlier attempt was killed mid-run and its output ended with cargo's
`error: test failed` prefix — which is printed for a KILLED process, not only a failing
one. That single line is what round 31 misread.

## The red herring inside the output, and how it was ruled out

The run prints, for whichever test is starved at that moment:

```
test stock_transfers::tests::scoped_transfer_reads_are_isolated_between_store_sessions
  has been running for over 60 seconds
```

That names a REAL test, which invites "this test hangs". It does not — run alone it
passes in **3.55s**:

```
test result: ok. 1 passed; 0 failed; ... finished in 3.55s
```

**The named test CHANGES between runs** (observed: `stock_transfers`, then `terminals`),
which is the diagnostic. A genuine hang names the same test every time; a contention
artifact names whichever test lost the race. 1510 tests run in parallel on this host.

## What to do instead of reading the exit text

1. **Redirect to a file.** Output read through a wait window is lost mid-run, and the
   `error: test failed` line arrives at the START of a killed process's output, not the
   end — it is easy to catch the prefix and miss that no summary followed.
2. **Check for a `test result:` line.** Its absence means the process was killed, not
   that assertions failed.
3. **Read exit code 143 / 124 as termination**, not failure. 124 is `timeout`'s own
   code; 143 is SIGTERM.
4. **Re-run the named test alone** before treating it as broken.

## What remains open

The bridge suite takes **17.3 minutes** wall clock on this host, which exceeds a single
agent wait. That is a real cost, not a bug, and it is why the Nextest CI leg cannot be
reproduced locally in one step. Two things work:

- **Scope narrowing** — `cargo test -p kasirmu-bridge --lib <module>` returns in seconds
  and is what verified rounds 31-32's changes (`qris_listener` 3 passed,
  `registration_gate` 12 passed).
- **A full run redirected to a file**, with a wait long enough to see it finish. 1038s is
  under a 1500s budget; anything shorter kills it and reproduces the false reading above.

**Not measured here:** where the 17.3 minutes goes. The pass/fail state is settled —
1509/0. Optimising the runtime is the open question, and it is an efficiency task, not a
reliability one.

> last audited 14-10-26 by docs-auditor
