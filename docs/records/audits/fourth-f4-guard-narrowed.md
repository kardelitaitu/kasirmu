# The fourth F4 guard: narrowed to one question, still unreached (round 233)

## What was attempted

Round 232 closed with the next step spelled out: *"Reaching it would need the injection armed
BEFORE the workspace mounts … or drive the Read through `reloadNonce` by pressing Retry on a
healthy load."* This round tried both and proved one of them is circular.

## What was eliminated

### The `reloadNonce` route is circular

`resto-card-retry-btn` lives INSIDE the `loadFailed` block (`:409-425`). There is nothing to press
on a healthy load:

```
RETRY_BTN=0   BANNER=0
```

So "press Retry to force a second read" cannot start a first one. **The route needs the failure
it was meant to create.**

### The seam works — verified, not assumed

Before concluding anything about the card, the instrument was checked against a case with a known
answer (round 226's rule). Armed from an init script and called through the app's own API:

```
ARMED=["get_setting_scoped"]
REJECTED: Error: [TAURI MOCK] injected failure for 'get_setting_scoped' (window.__MOCK_FAIL)
```

`mockDispatcher.ts:127-134` consults the seam BEFORE the handler, so the injection is real and
reaches this command. **The failure is being raised.**

### The card is mounted and live

Both of its toggles render with real labels (`resto-table-mgmt`, `resto-course-firing`) — round
232 measured that, and this round re-confirmed it. So the component is not gated out.

## What remains

With the injection armed from the first document and the modal opened as the first action, the
card renders normally and its banner never appears — checked at 1s, 3s and 6s:

```
AFTER_1000: banners=0 retry=0
AFTER_3000: banners=0 retry=0
AFTER_6000: banners=0 retry=0
HAS_FAIL_TEXT=false
```

An identical probe on the FIRST modal open, with the failure armed and no prior interaction, gives
the same result. So the effect either

1. does not run before the modal's render settles, and the once-per-session latch at `:98` then
   short-circuits it, or
2. runs and its `catch` is not reached — the read resolving from somewhere other than
   `get_setting_scoped`.

**Distinguishing those two is the whole remaining question**, and it is one instrumented run:
counting invokes inside the card's effect rather than observing its output.

## Why this is worth a record rather than a retry

Three things were eliminated by measurement and one was verified as working. That is a narrowed
problem — two candidate mechanisms, one experiment — rather than the indeterminate one round 232
left. The file's comment carries it, so the next round starts from here.

## Verified

| Item | Result |
|---|---|
| Retry route | circular — the button cannot exist before the failure |
| The injection seam | fires, verified against a known-answer call |
| The card's controls | mounted and labelled |
| The banner | absent at 1s, 3s, 6s, and on a first open |
| Probes | all removed |
| Source changed | none |
| New tests | zero |

## The F4 set, unchanged from round 231's honest count

| Screen | Round | Reachable |
|---|---|---|
| receipts | 223 | yes |
| payments | 227 | yes |
| settings | 230 | yes |
| workspace card | 231-233 | **still no — now for a named reason** |

> last audited 15-10-26 by docs-auditor
