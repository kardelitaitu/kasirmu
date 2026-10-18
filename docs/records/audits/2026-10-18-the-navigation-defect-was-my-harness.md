# The navigation "defect" was my harness, and the rule is documented — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 166 - status: 0 defects found;
     round 165's conclusion CORRECTED by tracing the mechanism to its end - branch: 0.0.41 -
     commit: none (no edits to commit) -->

<!- - Scope: finish what round 165 started. That round found a reproducible navigation
     failure and stopped short, naming the exact probe to run next: instrument
     `setActiveWorkspace` and log a stack trace at the null call. That probe REFUTED the
     round-165 diagnosis, and chasing the refutation to the end found the real answer. -->

## The named probe, run, and negative

Round 165 hypothesised that something sets `activeWorkspace` to null on a hashchange, so I
wrapped both the context setter and the raw `useState` dispatcher and collected stack traces.
Both came back **empty**: `count = 0` null-calls across a full reproduction. A third probe
confirmed the page does not reload (`window.__sentinel` survived) and a fourth counted the
provider lifecycle: `mounts: 2, unmounts: 1` — unchanged before and after. **The provider does
not remount and nothing nulls the workspace.** Every mechanism round 165 proposed was wrong.

## What the render log actually said

Instrumenting the render site itself (immediately above `if (!activeWorkspace)` in
`AppShell.tsx`) produced the decisive line:

```
render route=products ws=null      <- after selectWorkspace(admin), sidebar IS up
render route=locations ws=null     <- after the navigation
```

`ws` was **already null after `selectWorkspace(admin)`** — while the Settings sidebar was
plainly rendering. The workspace was never lost; **it was never set.**

## The rule, and why the product is right

`WorkspaceHome.tsx:553-565` `handleShortcutNav` states it explicitly:

> // Only a non-fullscreen destination (a Settings-hub deep link) needs a workspace to
> // render into.

```js
if (getPage(route)?.fullscreen !== true) setActiveWorkspace('admin');
```

`settings` is registered `fullscreen: true` (`features/settings/register.tsx:10`), so it needs
NO workspace — which is why the admin shell rendered with `ws=null` and looked like a
workspace that had been cleared. `locations` is NOT fullscreen (`features/locations/
register.tsx:9`), so reaching it REQUIRES an active workspace, and the tool card sets it.

Verified both halves in one run: clicking the **Settings** card renders the settings screen
with `picker=0` and no workspace; clicking the **Locations** card renders
`.multi-store-dashboard` with `picker=0`. The product does the right thing in both cases.

## Why the E2E helper fails

`helpers.ts:177` `navigateTo` sets `window.location.hash` and dispatches `hashchange`. It never
calls `handleShortcutNav`, so for a non-fullscreen route it arrives with no workspace and
`AppShell.tsx:708` (`if (!activeWorkspace)`) correctly renders the picker. The helper's own
admin branch has the same shape: it clicks the Settings card (fullscreen, sets no workspace)
and then expects specs to `navigateTo` another route — which cannot work for a non-fullscreen
target.

**So round 165's "product defect" was a harness gap.** The product rule was correct,
documented in a comment at the exact line that implements it, and I read that comment two
rounds ago without connecting it.

## What I am NOT claiming

I did not fix the helper. The change it needs — route-aware navigation that establishes a
workspace for non-fullscreen targets — touches shared E2E infrastructure used by 118 specs,
and two of those files are dirty in another lane right now. Writing it without being able to
run the suite against a settled tree would be guessing. Earlier in this session I reverted
four attempts to bend code to satisfy a scanner; the same discipline applies here.

I also did not re-triage the other ~18 E2E failures round 165 left unexamined. Those named
DIFFERENT errors (`sales-history tier surfaces missing`, `the seeded bill must attach to a
table`, `the plan has a free table`, a 480x800 horizontal scroll) and are still unexamined.

## Evidence

- Five probes, each deleted after use (verified: 0 `zz-*` files remain) and both production
  files reverted with `git checkout --`, confirmed clean against HEAD.
- The refuting measurements are in the transcript: null-setter `count=0`; provider
  `mounts: 2, unmounts: 1` pre and post; `__sentinel=alive`; render log `ws=null` with
  `sidebar=1`.
- The confirming run: Settings card -> `.settings-page=1, picker=0`; Locations card ->
  `.multi-store-dashboard=1, picker=0`.
- **No production file changed.** Nothing to commit but this record.

## Carried forward

1. The E2E helper fix, as its own task with the tree settled: `navigateTo` should route
   non-fullscreen targets through the workspace-setting path, or `selectWorkspace` should
   grow a route argument. Both are design choices for the lane that owns `ui/e2e/helpers.ts`.
2. The ~18 unexamined failures remain the highest-value open item in this lane, because they
   name specific unmet preconditions rather than a navigation shape.
3. Method note worth keeping: **round 165 found a real reproduction and a wrong cause.** A
   reproduction is evidence that something is wrong; it is not evidence about WHAT. The cause
   needed the setter/remount/render probes, and only the third one told the truth.

> last audited 18-10-26 by docs-auditor
