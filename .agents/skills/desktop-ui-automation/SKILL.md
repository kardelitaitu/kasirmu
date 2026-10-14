---
name: desktop-ui-automation
description: Drive and inspect the RUNNING kasir.mu DESKTOP app (Tauri WebView2) over Chrome DevTools Protocol - read the live DOM, address elements by data-testid instead of screen coordinates, click an element, fill an input, wait for a node to mount, capture a screenshot, and read the WebView console. Use when you need to verify what the desktop UI actually renders rather than what a unit test asserts; when a click by screen coordinate lands on the wrong element or misses after a layout change or DPI scaling; when you need a screenshot of the running desktop app; when a data-testid needs to be clicked but the window position is unknown; when you need to read the WebView console or a JS error from the desktop shell; or when http://127.0.0.1:9222 refuses the connection and you need the launch recipe that opens it.
---

<!-- Audit stamp: 2026-10-11 · DSH · status: NEW — created this pass, every claim measured
against the running app on branch `0.0.41`. Measured this pass, not transcribed:
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` makes the live
`msedgewebview2.exe` command line carry `--remote-debugging-port=9222` and
`http://127.0.0.1:9222/json/version` answers `Browser: Edg/154.0.4258.62`; without it the
port refuses the connection. `scripts/desktop-cdp.mjs` was run end to end this pass:
`targets` (1 page target, `http://localhost:1420/`), `eval`, `elements`,
`click-testid` (navigated workspace-home -> Restaurant POS), `fill-testid`
(read back `Test Customer`), `wait-testid`, `screenshot` (1280x800 PNG),
`console --seconds 3` (228 messages), and both error paths (missing testid, unknown
command) exit 1. The override-icon case in §6 is the real end-to-end proof: clicking
`cart-line-override-btn` by testid opened the Price Override modal. NOT measured here:
the same flow on a release build (which is expected to expose no endpoint), and the
multi-window case (only one page target existed on this host). -->

# Desktop UI automation over CDP

Screenshotting the desktop window and synthesising mouse events at pixel offsets is
the tool this skill replaces. That approach fails in three specific ways, and each
one is a reason a coordinate-driven test lies about what it checked:

1. **The window can move or resize** between the capture that measured a coordinate
   and the click that uses it. The click lands somewhere else and the test reports
   whatever it finds there.
2. **A coordinate has no identity.** After any layout change, the pixel you measured
   belongs to a different element. Nothing in the click records which control was
   meant, so a wrong click and a right click are indistinguishable.
3. **DPI scaling** means the coordinates you measured on screen are not the
   coordinates the app receives.

This skill removes all three by **never using a coordinate it did not read from the
element it is about to act on**. Elements are addressed by `data-testid`, which is the
one handle this UI guarantees to keep stable — class names are generated or themed,
and text is localised through `@fluent/react`, so address by neither.

The Android equivalent is `android-ui-automation` (`scripts/android-cdp.mjs` over
`adb forward`). The two scripts share a shape deliberately; the desktop one exists
because the desktop app has no `adb` and a different port story.

## 1. The gate: WebView2 opens an endpoint only when told to

Tauri does not pass `--remote-debugging-port` to WebView2. The endpoint appears only
when the environment variable **`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`** carries the
flag, and the variable must be visible to the **WebView2 child process**, not to the
Tauri binary alone.

Measured on this host (2026-10-11), with the variable set:

```text
"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\154.0.4258.62\msedgewebview2.exe"
  --embedded-browser-webview=1 --webview-exe-name=kasirmu-app.exe --webview-exe-version=0.0.41
  --user-data-dir="C:\Users\<user>\AppData\Local\mu.kasir.app\EBWebView"
  --remote-debugging-port=9222 --lang=en-US ...
```

`GET http://127.0.0.1:9222/json/version` then answers:

```json
{ "Browser": "Edg/154.0.4258.62", "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/<id>" }
```

Without it the port refuses the connection and every command in this skill exits 1
with the launch recipe. That is the correct failure — a missing endpoint and a
broken selector are different problems and must not look alike.

> **⚠️ The endpoint is a SECURITY surface.** It grants full control of the app's DOM
> to anything that can reach the loopback port, and it lives as long as the process.
> Launch with it only while actively testing, and relaunch normally afterwards.
> **Do NOT add it to `scripts/start-desktop.bat`** or to any shipped config — that
> would ship a debugging socket in the everyday dev path.

## 2. Launching with the endpoint open

The app must be **restarted** for the variable to take effect; setting it in a shell
where the app already runs does nothing. Two forms that work, both from the repo root:

```powershell
# PowerShell — the detached form survives the calling shell exiting.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
Start-Process -FilePath 'cmd.exe' -WindowStyle Minimized -ArgumentList '/c',
  'set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 && cargo tauri dev > .tmp-desktop-cdp.log 2>&1'
```

```bash
# Git Bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222' cargo tauri dev
```

Two traps worth knowing:

- **A plain `Start-Process cargo tauri dev` can die with its parent shell.** The
  measured symptom was `cargo-tauri` and `kasirmu-app` both gone, the port refusing
  the connection, and no error anywhere. The `cmd.exe /c` wrapper above detaches it.
- **The app is slow to expose the port.** Measured ~45 s from launch to the first
  successful `/json/version` (Vite start + Rust link). Poll for it rather than
  testing once immediately after launch.

Confirm the endpoint before blaming the script:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing | Select -Expand Content
```

## 3. Command reference

Run from the repo root. Exit code is 1 on any failure, so these compose into a gate.

| Command | What it does | Reach for it when |
|---|---|---|
| `node scripts/desktop-cdp.mjs targets` | Lists the debuggable targets as `[type] title — url`. | First call on a fresh attach. Proves the endpoint answers and which target is the app page. |
| `node scripts/desktop-cdp.mjs eval "<js>"` | `Runtime.evaluate` with `returnByValue` + `awaitPromise`; returns the JSON value, or throws with the page's own exception text. | Reading state: DOM presence, `getBoundingClientRect`, `getComputedStyle`, or firing a `.click()` directly. |
| `node scripts/desktop-cdp.mjs elements [--filter <substr>]` | Every `[data-testid]` node with a **non-zero rect**, plus how many were skipped as hidden. | You need to know what is addressable before writing a selector. |
| `node scripts/desktop-cdp.mjs click-testid <testid>` | Resolves the element, scrolls it into view, checks it is enabled and on-screen, then clicks **the element** (not a coordinate). | **The default way to press anything.** §4. |
| `node scripts/desktop-cdp.mjs fill-testid <testid> <value>` | Sets an input/textarea/select through the native value setter and dispatches `input` + `change`. | Typing into a field React must observe. §5. |
| `node scripts/desktop-cdp.mjs wait-testid <testid> [--timeout <ms>]` | Polls in-page until the node exists with a non-zero rect (default 5000 ms). | The UI mounts asynchronously and you would otherwise hand-roll a retry. |
| `node scripts/desktop-cdp.mjs screenshot [path]` | `Page.captureScreenshot` as PNG; writes the file and prints `{url, bytes}`. | You need a frame of the page. |
| `node scripts/desktop-cdp.mjs console [--seconds <n>]` | Enables `Runtime` + `Log`, waits the window, prints console calls, uncaught exceptions and log entries. Default 5 s. | Catching a thrown error or a `console.*` the shell emits. |

## 4. Why `click-testid` clicks the element, not a coordinate

This is the whole point of the skill, so the choice is explicit.

The command reads the element's rect, refuses the click when the node is **missing**,
**disabled**, **zero-size** (hidden), or **off-screen after scrollIntoView** — and
then calls `el.click()` on the node. It never converts the rect to a coordinate and
synthesises a mouse event, because:

- `el.click()` **dispatches on the node itself**, so the click cannot land on a
  neighbour because the layout moved or the window was scaled.
- `Runtime.evaluate` is sent with **`userGesture: true`**, so the programmatic click
  counts as a *trusted* activation. Popovers, focus rings and any control gated on
  user activation behave as if a real click happened. Without that flag a synthetic
  `.click()` is a silent no-op in exactly the cases a tester cares about.

The rect is still measured and returned, because it is what makes a refusal
diagnosable: `has a zero-size rect (hidden?)` and `off-screen at (x,y)` are real
findings, whereas a coordinate click at `(0,0)` is a click on whatever happens to sit
at the origin.

## 5. Why `fill-testid` cannot be a bare `el.value = x`

React tracks the previous value on the DOM node and **skips its `onChange` when an
assignment looks like no change**. A bare `el.value = 'owner'` therefore updates the
visible field while the app never sees it — the failure reads as "the form ignored my
input", which sends a tester hunting through the component instead of the harness.

The fix has two halves, both required: call the **native `value` setter** (obtained
from the prototype, which bypasses React's tracker), then dispatch `input` and
`change` with `bubbles: true` so the framework is actually notified.

## 6. The read–measure–act loop

1. **read** — `elements` (or `eval` a `querySelector`) to confirm the node is mounted.
2. **act** — `click-testid` / `fill-testid`; both refuse rather than guess.
3. **wait** — `wait-testid` for whatever the action should have mounted.
4. **confirm** — `screenshot` the result, or `eval` the new state.
5. **catch** — `console --seconds 10` if the action should have logged or thrown.

Measured end to end on this host (2026-10-11). Log in, then open the price-override
modal by clicking the `$` icon on a cart line — no coordinate anywhere:

```bash
# The username step, then the PIN pad (digit buttons carry aria-label, not testid).
node scripts/desktop-cdp.mjs eval \
  "(function(){var i=document.querySelector('input[type=text]');
    var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
    d.set.call(i,'owner'); i.dispatchEvent(new Event('input',{bubbles:true})); return i.value;})()"

# Whatever the app mounted, listed with rects — this is how you find the next testid.
node scripts/desktop-cdp.mjs elements --filter cart-line

# Click the override icon BY ELEMENT; this opened the "Price Override" modal.
node scripts/desktop-cdp.mjs click-testid cart-line-override-btn

# Confirm what it mounted.
node scripts/desktop-cdp.mjs wait-testid price-override-modal --timeout 4000
node scripts/desktop-cdp.mjs screenshot .tmp-desktop/override.png
```

The last screenshot is the proof: the modal renders `Price Override` with the line's
name and current price. A coordinate click could have opened it by luck; only the
testid records that it opened **the control that was meant**.

## 7. Error catalogue

| Message | Cause | Fix |
|---|---|---|
| `the desktop app is not exposing a DevTools endpoint on port 9222` (with the launch recipe) | The app was started without `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, or it exited. | Relaunch with the variable (§2). A variable set after launch has no effect on the running process. |
| `no debuggable page target found` | The endpoint answered but exposed no page — typically the WebView is still booting. | Wait and retry; if it persists, `targets` lists what the endpoint did expose. |
| `no element with data-testid="X" — nearest: ...` | The testid does not exist, or the screen that carries it is not mounted. | Use `elements` to see what **is** addressable. Do not guess a testid — verify it with `scripts/check-testid.mjs`. |
| `element data-testid="X" is disabled — refusing to click` | The control is genuinely disabled (e.g. a permission gate). | The app is behaving correctly; assert on the disabled state instead of clicking. |
| `element data-testid="X" has a zero-size rect (hidden?)` | The node is in the DOM but not laid out (a closed panel, a `display:none` branch). | Open the container first, or `wait-testid` after the action that should reveal it. |
| `element data-testid="X" is off-screen at (x,y) after scrollIntoView` | The node could not be scrolled into the viewport. | Usually a clipped ancestor; check the layout rather than forcing a click. |
| `<method> timed out after Nms (renderer produced no frame?)` | The renderer stopped producing frames. | `eval` answering is the tell that the process and socket are alive and the renderer is stuck: restart the app. |

## 8. Limits — state them, do not paper over them

- **The endpoint needs the environment variable at launch.** There is no runtime
  switch, and a release build is not expected to expose one at all (the Android
  sibling documents the same shape under its own gate).
- **CDP drives the WebView only.** Anything the native layer draws outside it —
  the OS window frame, a native menu, a system dialog — is invisible to every
  command here.
- **The desktop app is single-window today** (one page target measured), so there is
  no window-selection logic. If a second window appears, `targets` will list it and
  `pickPage` takes the first page target — revisit this then.
- **`screenshot` captures the page viewport**, not the OS window, so it will not show
  window chrome or the dev toolbar overlay's placement relative to the screen.
- **A green `click-testid` proves a click was dispatched, not that the handler
  worked.** Always confirm the effect (`wait-testid`, `eval`, `screenshot`).

---

> last audited 11-10-26 by DSH
