# Restaurant POS — live accessible-name audit (2026-10-12)

## Why this exists

Unit tests run in **jsdom**, which does not implement the browser's accessible
name computation. axe-core catches missing labels, but it does **not** catch a
control whose name is assembled from text the user cannot see — for example a
label hidden with `opacity: 0`, which stays in the accessibility tree. One such
defect shipped and was only found by measuring the running app:

- `KdsHeaderRight`'s Start/End Shift button holds BOTH labels stacked in one
  grid cell, toggled by opacity (`KdsScreen.css:337`). Chrome computed its name
  as `"Start Shift End Shift"` — ambiguous and self-contradicting. axe passed it.
  Fixed in `b54a957a3` (aria-label + aria-hidden on the inactive label); Chrome
  now computes `"Start Shift"`.

This record captures the method and the result of applying it across the
restaurant POS, so the sweep is not repeated from scratch.

## Method

Against the running desktop app over CDP (WebView2, port 9222), driving the real
UI to each screen, then for every interactive element:

1. Tag each visible control with a probe attribute via `Runtime.evaluate`.
2. Resolve its node id with `DOM.querySelector`.
3. Read **Chrome's own** name with `Accessibility.getPartialAXTree`.

The third step is the point: it is the same engine a screen reader consumes, so
it reports what is actually announced, not what the markup appears to say.

Script shape (not committed — throwaway, run per screen):

```js
const ax = await send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
ax.result.nodes[0].name.value   // the announced name
```

## Result

| Screen | Controls probed | Unnamed | Mis-named |
|---|---|---|---|
| Workspace home | 32 | 0 | 0 |
| Restaurant POS (cart + menu) | 47 | 0 | 0 |
| Payment modal (split mode open) | 66 | 0 | 0 |
| KDS board | 18 | 0 | 0 |

Every control reports a real name. Notable confirmations:

- `kds-topbar-shift` → `"Start Shift"` (the fix; was both labels).
- `payment-split-other-input` / the "Other" radio → `"Other payment method name"`
  (the round-5 fix; the radio previously had no name at all).
- `pos-cart-line-swipe-remove` reports `IGNORED` while the swipe action is
  unrevealed — correct, it is `aria-hidden` until revealed.
- Tab names that include a count (`kds-tab-open` → `"Open 0"`) are intentional
  and informative, not defects.

Dev-toolbar entries are the only names over 55 characters; they are descriptive
on purpose and are not resident in the product surface.

## How to re-run

Start the app with the debug port, then repeat the CDP probe per screen:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
cmd /c "set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 && cargo tauri dev"
```

Sign in as `owner` / PIN `1234`, open a workspace, and run the probe. The Vite
dev server hot-reloads edits, so a fix can be re-measured without a restart.

## What this does NOT cover

- Screens not driven in this pass (receipts / payments / settings / menu editor
  were audited separately by axe unit tests, and by an earlier unnamed-control
  sweep that returned zero).
- **Focus order** and **keyboard reachability** — names only.
- Live regions / announcements.

> last audited 14-10-26 by docs-auditor
