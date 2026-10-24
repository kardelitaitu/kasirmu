# Five registered commands no client names: what each is, and why the list is not a todo

**Measured 2026-10-25 (round 176) at HEAD `49833e58b`.** `python scripts/verify-ipc-parity.py` prints:

```
info[cross-shell-unrequested]: 28 per-shell unrequested registration(s) are 5 command(s)
  named by no shipped UI file on ANY shell (desktop=13, tablet=5) = 5 named by neither side
  + 18 named by the other shell's UI only
```

**CORRECTION ADDED THE SAME ROUND, before this file was a day old.** The paragraph that stood
here said these five had been "acted on by nobody". That was false, and reading
`scripts/ipc-parity-allowlist.json` would have shown it: all four are in `scoped_orphans` with a
dated MEASURED reason, two of them naming the exact finding this file re-derives. The reasons were
written on 2026-10-25 and are the record; this file adds only the comparison nobody had made --
that these five are the SAME set as the cross-shell intersection the gate now prints. Its value is
that one read, not the discovery of five commands. Round 167’s lesson again: read the instrument
before writing the survey.
Four of the five are BACKEND-ONLY surfaces with bridge implementations, client-facing tests and a
documented contract; deleting them touches roughly forty files across two shells and a bridge. The
fifth is different in kind and is the one worth a decision.

## The five

| Command | Registered | Implemented | UI caller | What it is |
|---|---|---|---|---|
| `enqueue_offline_scoped` | desktop `offline.rs:47`, tablet `:173` | bridge `offline.rs:209` | none | the WRITE side of the offline queue |
| `list_pending_offline_scoped` | desktop `:60`, tablet `:220` | bridge `:251` | none | the read behind the same queue |
| `list_scale_devices_scoped` | desktop `scale.rs:31`, tablet `:51` | bridge `scale.rs:93` | none | configured weight scales, incl. HAL registry |
| `get_over_quota_report` | desktop `subscription.rs:90` | — | none | the AMBIENT twin of `_scoped`, which IS used |
| `pending_sync_count_scoped` | desktop `sync.rs:249`, tablet `:284` | bridge `sync.rs:400` | none | see below |

## The four that are not a defect

**`enqueue_offline_scoped` and `list_pending_offline_scoped`** are the two halves of a queue the app
does populate and does read — through `@/api/offline`, whose `listAllOfflineScoped` and
`pendingOfflineCountScoped` reach different commands in the same family. The pair has bridge
implementations, and `apps/mobile-tauri/src/commands/sync_tests.rs` covers the count path. A surface
the client does not call today is not the same as a surface nothing needs; these are the documented
API of a feature whose UI happens to use two of its nine doors.

**`list_scale_devices_scoped`** is the read behind the HAL scale registry. `crates/kasirmu-hal/src/registry.rs`
lists registered drivers and the bridge exposes them; the screens that configure scales use other
calls. Deleting it would remove the only way to enumerate scales, which the HAL tests exercise.

**`get_over_quota_report`** is the ambient twin of `get_over_quota_report_scoped`. The scoped one
IS called (`api/subscription.ts:287` by `OverQuotaCard`), so this is the ADR #7 pair where the
session-less arm has no caller because the product is session-scoped. Removing the ambient arm
would be a migration decision about pre-session operation, not cleanup.

## The one worth a decision: `pending_sync_count_scoped`

This is the member of the group that is a genuine inconsistency, and `verify-ipc-parity.py`
already classifies it: `info[scoped-orphans]` lists it under **GATED DEAD SURFACE**
(`pending_sync_count_scoped=SYNC_MANAGE`) — one of six "permission gates ... wired into
`generate_handler!` with no reachable caller, which reads as enforced posture while protecting
nothing."

The reason it sits there is concrete, and it is a duplicate:

- `crates/kasirmu-bridge/src/sync.rs:400` calls `ctx.require_session_permission(&session, SYNC_MANAGE)`
  then returns `store.pending_offline_count()`.
- `crates/kasirmu-bridge/src/offline.rs:305` `pending_offline_count_scoped` returns THE SAME VALUE
  from the same store function, with no permission call, marked `// ungated-ok: documented split`.
- That split is the module's stated contract (`offline.rs:8-10`): "`SYNC_MANAGE` on the four
  GATED paths" — and the four are the write paths. A count is a read.

So the tree contains two commands returning one number, where the one nobody calls is the one
that requires a permission and the one the UI calls is the one that does not. That is worth a
ruling, and the ruling is a product one — either

1. **`pending_sync_count_scoped` is the intended door** and `OfflineQueueScreen` should route
   through it, gaining a `SYNC_MANAGE` check on a read; or
2. **it is the leftover** and should be deregistered from both shells, with the bridge body deleted.

Both are defensible. Option 1 adds an authorisation requirement to a screen a cashier uses today;
option 2 removes a door that a future sync-status surface might want. **Neither was taken**, because
choosing which read needs `SYNC_MANAGE` is a policy call, and this lane does not make those.

## What a reader should not conclude

That `info[cross-shell-unrequested]` is a work list. Round 169 wrote down that the per-shell
lines are not arithmetic; this file records the other half — that the intersection is FIVE and four
of the five are legitimate. The gate reports a measurement, not a defect, and says so in its own
summary text.

## What this round actually changed

Three things, none of them a command:

1. **`info[cross-shell-reasons]`** -- a new line in `verify-ipc-parity.py` that prints how many of
   the cross-shell names already carry a dated reason in `scoped_orphans`, and names the residue.
   It is the link this file had to be written to discover. It now reads **5 of 5 covered**.
2. **`get_over_quota_report`** gained the reason it was the only one missing -- the ambient arm of
   an ADR #7 pair whose scoped twin `OverQuotaCard` uses.
3. **The allowlist stub for `pending_sync_count_scoped`** cited `crates/kasirmu-bridge/src/pos.rs`,
   which contains no such function; it lives at `sync.rs:400`. Corrected.

The gate prints the census; the allowlist holds the reasoning; this file connects them. A reader
who wants the full reasons should open `scripts/ipc-parity-allowlist.json` and search `scoped_orphans`.

## Filed by

The round-176 lane. No production file edited; the two shells and the bridge are untouched.
