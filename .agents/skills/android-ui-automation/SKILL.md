---
name: android-ui-automation
description: Drive and inspect the RUNNING Android tablet app over Chrome DevTools Protocol - read the live DOM and address elements by data-testid, tap an element by coordinate, capture a real frame while the tablet is locked or its panel is off, and read the WebView console. Use when you need to verify what the tablet UI actually renders rather than what a unit test asserts; when a layout or behaviour claim cannot be checked from the desktop; when the app shows something on-device that the unit tests say is correct; when you need a screenshot while the tablet is locked or its panel is off; when you need to read the WebView console or a JS error from the device; when you need to tap an element on the tablet; when UIAutomator/Espresso/Appium see the whole app as one opaque node and cannot address an inner control; when you must pick between cargo tauri android dev and a debug or release APK; or when you hit 'no devtools socket for pid N - the installed APK is a release build'.
---

<!-- Audit stamp: 2026-09-21 · docs-auditor · status: ACCURATE (new skill — created after the repo had a build/install skill but no way to look inside the running tablet app; every CDP claim below was taken from scripts/android-cdp.mjs read in full this pass, plus scripts/android-screen.mjs and four data-testid values, each grepped to its defining line. The build-mode decision table in §2 was DERIVED, NOT MEASURED BY ME: its costs and ABI qualifications come from apps/mobile-tauri/AGENTS.md:198-230 and from the android-apk-build skill (its ~171-178 passage on the custom-protocol feature); no build was run this pass. CORRECTION carried over the android-apk-build skill, which is NOT edited here: the wry devtools gate is `#[cfg(any(debug_assertions, feature = "devtools"))]` — crate `wry` 0.55.1, `android/main_pipe.rs:258`, read at source this pass — not `debug_assertions` alone; the older wording in that skill omitted the `feature = "devtools"` half) · verified this pass: crate `wry` 0.55.1 `android/main_pipe.rs:258-264` read directly from the cargo registry (C:/Users/Dika/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.55.1/...), gate is any(debug_assertions, feature="devtools") and the `devtools` bool is the argument passed to setWebContentsDebuggingEnabled; crate `wry` 0.55.1 `Cargo.toml:55` declares `devtools = []`; its `lib.rs:834-837` defaults devtools true under debug_assertions and false otherwise; **the Platform-specific note at crate `wry` 0.55.1 `lib.rs:1238` declares "Wry's `WebView` devtools API isn't supported on Android"** (read verbatim above `with_devtools` at lib.rs:1240), which is why §1 scopes the release route to the Cargo feature only and warns against `with_devtools` rather than offering it; scripts/android-cdp.mjs exists at 289 lines and its switch (:255-282) exposes exactly targets/eval/screenshot/console/tap; userGesture:true at :163; fromSurface:false at :190 with the surface fallback at :192; the CRLF strip at :39; the 20000ms default timeout and its message at :129-135; Input.dispatchMouseEvent at :232-239; the two prepareForward errors at :65-68 and :72-77; scripts/android-screen.mjs calls adb exec-out screencap -p at :208; data-testid values confirmed at ui/src/features/retail/RetailCartPanel.tsx:206 (retail-cart-line-item) and :409 (pay-btn), ui/src/features/retail/RetailProductGrid.tsx:658 and :678 (product-grid-scroll, two nodes in one file), ui/src/features/restaurant/components/RestaurantSidebar.tsx:347 (restaurant-sidebar-deduction-override); apps/mobile-tauri/AGENTS.md:198-230 read and cited, not re-measured -->

# Android UI automation over CDP

Building and installing the APK is `android-apk-build` — this skill starts after
the app is on the device and **running**. Its subject is one script,
`scripts/android-cdp.mjs` (289 lines), which speaks Chrome DevTools Protocol to
the tablet’s WebView over `adb forward`.

## 1. Why there is a socket at all — the real gate

wry enables WebView debugging under
`#[cfg(any(debug_assertions, feature = "devtools"))]`
(crate `wry` 0.55.1, cargo-registry copy — `android/main_pipe.rs:258-264`, read
at source this pass). Two
independent things can therefore open the `@webview_devtools_remote_<pid>`
abstract socket:

1. **`debug_assertions`** — the ordinary case. Any debug build takes the arm,
   and wry also defaults the flag on: `devtools: true` under
   `#[cfg(debug_assertions)]`, `false` otherwise (crate `wry` 0.55.1, registry
   copy — `lib.rs:834-837`).
   That defaulted boolean is what is handed to `setWebContentsDebuggingEnabled`.
2. **`feature = "devtools"`** — a release build can take the same arm, and this
   is the *only* way it can: wry declares the feature as `devtools = []`
   (crate `wry` 0.55.1, registry copy — `Cargo.toml:55`) — a build-level
   feature, not a runtime flag.

   Do **not** reach for `WebViewBuilder::with_devtools` instead. Its own doc
   comment states that “Wry's `WebView` devtools API isn't supported on Android”
   (crate `wry` 0.55.1, registry copy — `lib.rs:1238`, the “Platform-specific”
   section above
   `with_devtools` at `:1240`), so the per-WebView override is not the lever here
   even though it sets the very `attrs.devtools` boolean that
   `main_pipe.rs:258-264` passes to `setWebContentsDebuggingEnabled`. On Android
   the cfg arm is what decides, and the Cargo feature is the only way a release
   build reaches it.

> **Not measured in this repo.** Route 2 is an available path, not a proven
> recipe here: no release APK has been built in this repo with the wry
> `devtools` feature enabled, and neither that feature nor `with_devtools` is
> wired up anywhere in `apps/mobile-tauri` as of this pass. Treat it as the
> option for a special case — a release-mode artifact you must nevertheless
> drive. It is **not** the
> everyday path, and it is not a recommendation: a release APK you ship to
> merchants should not carry a devtools socket.

The practical rule is unchanged: **install a debug build for normal work.**
`scripts/android-cdp.mjs:71-77` reports `no devtools socket for pid N - the
installed APK is a release build`, which is accurate for that common case and
for the default release configuration.

The script resolves the pid with `pidof mu.kasir.mobile`, greps `/proc/net/unix`
for the socket (`scripts/android-cdp.mjs:70-71`), and forwards `tcp:9222` to it
(`:78`).

## 2. Choosing the build mode: which APK answers which question

`apps/mobile-tauri/AGENTS.md:198-230` carries the measured cost table (release
26.9 MB / 1m 56s vs debug 152.7 MB / 14s incremental) and heads it “Prefer the
release APK on device”. Read in isolation that is a trap: an agent concludes
“release is better”, installs it, and then discovers there is **zero automation
surface**. The missing knowledge is which build for which task. Cite the size
table there; do not restate it here.

### Two independent switches that get read as one

| Switch | Gates | Effect |
|---|---|---|
| `cfg(debug_assertions)` / wry `devtools` feature | wry’s `setWebContentsDebuggingEnabled` (crate `wry` 0.55.1, registry copy — `android/main_pipe.rs:258-264`) | Whether CDP works **at all**. §1. |
| the `custom-protocol` Cargo feature | `get_app_url` — `tauri/build.rs:257` is `dev = !has_feature("custom-protocol")`; `tauri/src/manager/mod.rs:353` is `#[cfg(dev)]`-gated; the CLI sets the feature in `Rust::build_options` (`tauri-cli/src/interface/rust.rs:485`) | Whether the app loads the **embedded bundle** or `build.devUrl`. |

They are **independent**. A debug build can still load the embedded bundle when
the feature is on. The full derivation, including why the WebView shows
`Failed to request http://<lan-ip>:1422/`, is in the `android-apk-build` skill
(its `### Failed to request...` subsection) — read it there, do not re-derive.

### The decision table

| Task | Build | Why |
|---|---|---|
| Iterating on React/UI | `cargo tauri android dev` | Hot-reload via `build.devUrl` on `http://<lan-ip>:1422` — no rebuild for a frontend change, **and** the debug socket is present. |
| Verifying the SHIPPED artifact | `cargo tauri android build --apk --target aarch64` (release) | The only build that loads the embedded bundle, so the only build that proves packaging is correct. |
| Driving/inspecting the UI over CDP | a **DEBUG** build — `cargo tauri android dev`, or `cargo tauri android build --debug --apk --target aarch64` | Mandatory, not a preference: a stock release APK opens no `@webview_devtools_remote_<pid>` socket (§1), so there is no automation surface at all. |
| Reproducing a debug-only defect | `cargo tauri android build --debug --apk --target aarch64` | Debug assertions active; ~5.7x the release size. |

### Three facts that keep the table honest

**(a) The 14s is incremental.** `apps/mobile-tauri/AGENTS.md:205` says “14s
incremental”, and that qualifier is load-bearing: it is the Gradle + packaging +
relink step with the **Rust graph already compiled**. `generate_context!` reads
`frontendDist` at compile time, so a frontend-only change needs
`touch apps/mobile-tauri/src/lib.rs` to force the re-embed — otherwise the APK
silently ships the OLD bundle (the same hazard `android-apk-build` records at its
:161-163). A cold build is minutes, not seconds. Nobody should read “debug builds
in 14s”.

**(b) `--target aarch64` is not optional for the quoted numbers.** Without it the
build is the `universal` flavour across four ABIs: the four-ABI release APK is
104,737,268 B (~104.7 MB) and a four-ABI debug APK is ~583 MB (the four debug
`.so` sum to 577,077,264 B). The 26.9 MB / 152.7 MB figures are **single-ABI**.
See `apps/mobile-tauri/AGENTS.md:207-216`.

**(c) For UI iteration, `dev` beats both.** Hot-reload means no rebuild at all for
a React change, and the debug socket is present, so it satisfies automation *and*
fast iteration in one install. Its limitation: it loads `devUrl`, so it **cannot**
prove the packaged bundle is correct — that is what release is for.

Two conveniences worth knowing before you commit to one:

- `gen/android/app/build/outputs/apk/` keeps `universal/debug/`, `arm64/debug/`
  and `universal/release/` **side by side**, so having both installed and
  switching between them is normal. You do not have to choose one.
- Packaging is incremental, so an APK can far exceed its contents — a debug APK
  measured 412.6 MB on disk while holding 152.7 MB
  (`apps/mobile-tauri/AGENTS.md:227-230`). Run `gradlew clean` before trusting a
  surprising size.

**Match the artifact to the question.** Debug is not “better for automation
because it is faster” — it is better because it is the *only* option; and release
is not “better” either, it is the only build that can answer a packaging question.

## 3. The key insight: a Tauri Android app is a WebView

The tablet shell renders HTML, so the controls you want are **DOM nodes**, not
native Android views. That single fact decides the tooling:

UIAutomator, Espresso and Appium walk the *native* view hierarchy. To them the
whole kasir.mu app is **one opaque node** — they can assert that a WebView exists
and cannot address `pay-btn` inside it. CDP walks the DOM, so it can. This is why
this skill exists instead of an Appium guide. The corollary is a limit, not a
convenience: CDP sees only what the WebView renders (§8).

## 4. Prerequisites

| Requirement | Detail |
|---|---|
| Debug APK installed **and launched** (or `dev` running) | The socket is held by the live process. See §2 for which build, and `android-apk-build` for the build, signing and install steps themselves — not restated here. |
| `adb` on PATH | The script shells out to bare `adb` (`:39`), so whatever resolves first wins. |
| Node >= 22 | The `WebSocket` global is what keeps the script dependency-free (`:104`); no `npm i`. |
| Device reachable | Same `adb devices` / wireless-ADB state as for a build. |

> **The adb PATH trap, from `android-apk-build`:** a Windows `$ANDROID_HOME`
> entry in `PATH` is silently ignored by Git Bash, so a stale standalone `adb`
> can win the lookup and report a device state that is not the real one. Cite the
> absolute form when the two disagree:
> `"$ANDROID_HOME/platform-tools/adb.exe"`.

## 5. Command reference

Run from the repo root. Exit code is 1 on any failure (`:286-289`), so these
compose into a gate.

| Command | What it does | Reach for it when |
|---|---|---|
| `node scripts/android-cdp.mjs targets` | Lists the debuggable targets as `[type] title — url`, plus the pid (`:256-261`). | First call on a fresh attach. Proves the socket answers and which target is the page. |
| `node scripts/android-cdp.mjs eval "<js>"` | `Runtime.evaluate` with `returnByValue` + `awaitPromise`; returns the JSON value, or throws with the page’s own exception text (`:157-172`). | Reading state: DOM presence, `getBoundingClientRect`, `getComputedStyle`, or firing a `.click()`. |
| `node scripts/android-cdp.mjs screenshot <path>` | `Page.enable`, then `Page.captureScreenshot` as PNG; writes the file and prints `{url, bytes}` (`:180-200`). | You need a frame — including while the tablet is locked or dark. |
| `node scripts/android-cdp.mjs console --seconds 10` | Enables `Runtime` + `Log`, waits the window, prints `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and `Log.entryAdded` lines (`:203-229`). Default is 5s (`:271`). | Catching a thrown error or a `console.*` the device emits and the desktop never sees. |
| `node scripts/android-cdp.mjs tap <x> <y>` | `Input.dispatchMouseEvent` mousePressed then mouseReleased at the coordinates (`:232-239`). | Simulating a real press, when `element.click()` is not enough. |

`tap` is **coordinate-based**, not selector-based. Pair it with an `eval` that
reads the rect first (§7).

## 6. Two properties the script engineers for

These are the reason to prefer it, and both are one-line choices in the source.

**(a) `userGesture: true` (`:163`).** `Runtime.evaluate` is sent with the
user-gesture flag, so a programmatic `element.click()` counts as a trusted gesture
and is not swallowed by user-activation checks — the ones that make a synthetic
`.click()` a no-op in a desktop browser. Popovers, focus rings and buttons gated on
activation behave as if a finger hit them.

**(b) `fromSurface: false` (`:190`).** `Page.captureScreenshot` is asked for the
renderer’s own output instead of a fresh compositor surface frame. That is what
produces a real image **while the tablet is locked or its panel is off** — the
surface path needs a new frame, and with the panel dark none is ever produced. The
script keeps the surface capture as a fallback (`:192`, 30s) because it is the one
that includes anything composited outside the renderer.

Contrast with `scripts/android-screen.mjs`, which runs `adb exec-out screencap -p`
(`:208`) and decodes the frame with `zlib`. It depends on the system compositor
too, so it goes pure black under exactly the condition (b) survives.

| Question | Use |
|---|---|
| What does the **page** render, locked or not; what is the DOM / rect / console? | `android-cdp.mjs` |
| What is on the **physical screen** — keyguard, native system UI, boot logo, anything outside the WebView? | `android-screen.mjs` (needs the display on) |

## 7. Addressing: elements are DOM nodes, keyed by `data-testid`

Every control this UI wants automated carries a `data-testid`, and that is the only
stable handle — class names are generated or themed, and text is localised through
`@fluent/react`, so address by neither.

```bash
node scripts/android-cdp.mjs eval "document.querySelector('[data-testid=\"pay-btn\"]').click()"
```

Known-good testids, each verified at its defining line:

| testid | Defined at |
|---|---|
| `pay-btn` | `ui/src/features/retail/RetailCartPanel.tsx:409` |
| `retail-cart-line-item` | `ui/src/features/retail/RetailCartPanel.tsx:206` (a `<tr>`, so there are N of them) |
| `product-grid-scroll` | `ui/src/features/retail/RetailProductGrid.tsx:658` **and** `:678` — two nodes in one file, only one mounted |
| `restaurant-sidebar-deduction-override` | `ui/src/features/restaurant/components/RestaurantSidebar.tsx:347` |

Verify a testid with grep before you cite it; the repo has a liveness checker
(`scripts/check-testid.mjs`) precisely because these drift.

### The read–measure–act loop

1. **read** — `eval` a `querySelector` to confirm the node is mounted and how many
   matched (`.length`).
2. **measure** — `eval` `getBoundingClientRect()` for the coordinates.
3. **act** — `eval` `.click()` (counts as a gesture, §6a); if the handler needs a
   real press, `tap <x> <y>` with the rect’s centre.
4. **confirm** — `screenshot` the result.
5. **catch** — `console --seconds 10` if the act should have logged or thrown.

End to end, with testids that exist:

```bash
# 1. is the cart non-empty?
node scripts/android-cdp.mjs eval \
  "document.querySelectorAll('[data-testid=\"retail-cart-line-item\"]').length"

# 2. where is the pay button? -> {x,y,width,height,...}
node scripts/android-cdp.mjs eval \
  "JSON.stringify(document.querySelector('[data-testid=\"pay-btn\"]').getBoundingClientRect())"

# 3a. press it as a gesture
node scripts/android-cdp.mjs eval "document.querySelector('[data-testid=\"pay-btn\"]').click()"

# 3b. or tap its centre (if the rect printed x=880 y=1240 w=140 h=64)
node scripts/android-cdp.mjs tap 950 1272

# 4. did the cart empty and the grid repaint?
node scripts/android-cdp.mjs screenshot .tmp-android-audit/after-pay.png
node scripts/android-cdp.mjs eval \
  "document.querySelectorAll('[data-testid=\"retail-cart-line-item\"]').length"

# 5. anything thrown while it happened?
node scripts/android-cdp.mjs console --seconds 10
```

For the grid, measure the scroll container before assuming a scroll offset:

```bash
node scripts/android-cdp.mjs eval \
  "const g=document.querySelector('[data-testid=\"product-grid-scroll\"]'); JSON.stringify({h:g.clientHeight,sh:g.scrollHeight,top:g.scrollTop})"
```

## 8. Error catalogue

| Message | Cause | Fix |
|---|---|---|
| `mu.kasir.mobile is not running` (`:65-68`) | No live process holds the socket. | Launch it: `adb shell am start -n mu.kasir.mobile/.MainActivity`, then re-run. |
| `no devtools socket for pid N - the installed APK is a release build` (`:72-77`) | The installed APK took neither cfg arm at `android/main_pipe.rs:258` in crate `wry` 0.55.1 (§1). | Build a debug APK: `cargo tauri android build --debug --apk --target aarch64`. `--target aarch64` matters — it drops the other three ABIs and keeps the APK size sane (§2b). Then install and launch it. |
| `<method> timed out after Nms (renderer produced no frame?)` (`:129-135`) | The renderer produced no frame, i.e. the display is off. | Wake the tablet (`adb shell input keyevent KEYCODE_WAKEUP`, or press power) and re-run. The timeout is deliberate (default 20000ms) so a hung terminal does not look like a slow one. |
| A value looks padded, or a comparison silently fails on Windows | `adb` emits CRLF; the script strips `\r` at `:39`. | Nothing to fix in the script — but hand-rolled `adb` output of your own needs the same `.replace(/\r/g, "")` before you trim or compare it. |
| Connection refused / stale target after a relaunch | `tcp:9222` still points at a dead pid’s socket. | `adb forward --remove tcp:9222`, then re-run (the script re-forwards). |

## 9. Limits — state them, do not paper over them

- **The socket needs a build that takes the cfg arm.** A stock release APK exposes
  no devtools socket, by design (§1). The wry `devtools` feature is the only other
  route and is unmeasured here.
- **The socket dies with the process.** After any relaunch — including a crash or an
  `adb install -r` — the forward is stale; re-run and let `prepareForward`
  re-resolve the pid.
- **CDP drives the WebView.** Anything the native Android layer draws outside it
  (keyguard, status bar, system dialogs, a native crash screen) is invisible to
  every command here. Use `scripts/android-screen.mjs` (display on) or
  `uiautomator` for those.
- **`tap` takes CSS pixels**, and `screenshot` captures the renderer’s viewport;
  both are independent of the device pixel ratio you would measure with `screencap`.

---

> last audited 21-09-26 by docs-auditor
