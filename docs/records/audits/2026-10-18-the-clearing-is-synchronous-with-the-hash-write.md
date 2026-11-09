# The clearing is synchronous with the hash write — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 203 · status: round-202 defect narrowed
     from "somewhere clears the workspace" to "it happens SYNCHRONOUSLY, before hashchange
     dispatches"; cause still unlocated, fix still not applied · branch: 0.0.41 · commit: none -->

<!-- Scope: locate the clearing site behind the admin-tool-route defect. -->

## What round 202 left, and what this round added

Round 202 established: from the admin workspace, navigating to any tool route except settings
renders the workspace PICKER (`workspace-home-wrapper`, `AppShell.tsx:708`, the
`!activeWorkspace` branch). So `activeWorkspace` goes null. This round tried to catch it in
the act. It did not, and the near-misses are what changed the picture.

## The finding that matters: the switch precedes `hashchange`

I hooked `hashchange` and the history API, then navigated:

```
PROBE=HIST[{"ev":"hashchange","hash":"#/shifts","home":1}]
```

**At the `hashchange` event the picker is ALREADY rendered** (`home: 1`). The workspace was
gone before the event the whole app listens to could fire. A sampler running every 120ms saw the
same thing from the other side — its FIRST sample, taken after the write, already had `home: 1`.

That is decisive about the SHAPE even though it does not name the line: **the clear is synchronous
with the hash assignment, not a listener reaction to it.** `AppShell` own `syncFromHash` is
therefore not the cause — it is a `hashchange` listener, and it would run after.

## What was ruled out, each by measurement

| hypothesis | how it was killed |
|---|---|
| `handleSetActive(null)` clears it | instrumented the null branch with a stack trace; **it never logged** |
| `handleSetActiveInstance(null)` clears it | instrumented that branch; **never logged** |
| the session-change reset at `:293` | instrumented; **never logged** |
| a full page reload resets state | painted a window marker before navigating; it SURVIVED (`mark: "alive"`) |
| the provider remounts | exactly one `<WorkspaceProvider>` mount (`AppProviders.tsx:106`), no `key=` |
| `AppShell` holds its own copy | it destructures from `useWorkspace()` at `:130`; no local state |
| the route is unregistered / permission missing | settled in round 202 |

**All three context setters are instrumented and silent, yet the value is null.** That is the
contradiction this round ends on, and it is a sharper one than round 202 had: the value is not
cleared by the module that owns it.

## The two readings that remain, and why I did not pick one

1. **A second `activeWorkspace` source.** Some component may compute a local
   "workspace is active" from the hash and short-circuit the shell before the context is
   consulted. `AppShell`:337-342` is the right shape for that but the wrong direction — it
   REACTS to the workspace going falsy.
2. **The instrumentation did not reach the running bundle.** If the dev server served a cached
   module, my three probes would all be silent. This is the explanation I would once have
   dismissed, and rounds 198-201 are the reason I will not: three broken instruments in that
   stretch each produced a confident false negative.

**I am not choosing between them without a control**, because the control is cheap and picking
wrong wastes a round on a behavioural change to shared navigation.

## Why the fix is still not applied

Unchanged from round 202, and now better justified. The candidate site is not located, and the
only structural clue points at shared routing. Two rounds of the same session have already
measured what an unverified navigation change costs (177, 189); the correct output here is a
narrower reproduction, which I have.

## Verified

| check | result |
|---|---|
| the defect still reproduces | `shift.spec.ts` **5 failed** |
| clear happens before `hashchange` | `home: 1` AT the event |
| no page reload | window marker survived |
| three context setters | instrumented, all silent |
| `WorkspaceContext.tsx` restored | byte-identical (`edc9bcf817d3c8cf`) |
| production change | **none** |

## Carried forward — the exact next step

**Control first.** Re-apply one instrumented `console.log` to `WorkspaceContext` and prove it
reaches the browser (e.g. log unconditionally on mount) BEFORE concluding anything from its
silence. If the marker appears, reading 1 is true and the second source is real; if it does not,
the three "silent setters" prove nothing and the cause may be one of them after all.

That single control decides between the two readings, and it is the step rounds 198-201 each
needed and one of them got.

> last audited 18-10-26 by docs-auditor
