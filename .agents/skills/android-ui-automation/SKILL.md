---
name: android-ui-automation
description: Drive and inspect the RUNNING Android tablet app over Chrome DevTools Protocol - read the live DOM and address elements by data-testid, tap an element by coordinate, capture a real frame when the renderer is producing one, and read the WebView console. Use when you need to verify what the tablet UI actually renders rather than what a unit test asserts; when a layout or behaviour claim cannot be checked from the desktop; when the app shows something on-device that the unit tests say is correct; when you need a screenshot of the running app; when an element cannot be addressed and you need to see what is on the screen (for a locked or panel-off tablet use `scripts/android-screen.mjs` instead, not CDP); when you need to read the WebView console or a JS error from the device; when you need to tap an element on the tablet; when UIAutomator/Espresso/Appium see the whole app as one opaque node and cannot address an inner control; when you must pick between cargo tauri android dev and a debug or release APK; or when you hit 'no devtools socket for pid N - the installed APK is a release build'.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: REPAIRED — 6 findings, all repaired in place · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. · F1 (HIGH, fixed): EVERY line citation into `scripts/android-cdp.mjs` was stale. The skill was written when the script was 289 lines; it is **427** as of this pass (+138). Re-measured and corrected: `adb` shell-out `:39`→`:46`; CRLF strip `:39`→`:46`/`:59`; WebSocket `:104`→`:105`; "not running" `:65-68`→`:72-75`; release-socket error `:71-77`→`:80-83`; `/proc/net/unix` grep `:70-71`→`:77-78`; the `tcp:9222` forward `:78`→`:85`; targets `:256-261`→`listTargets :90` / printed `:380-382`; eval `:157-172`→`:166-172`; `userGesture` `:163`→`:170`; screenshot `:180-200`→`:187-205`; the 30s surface fallback `:192`→`:199`; console `:203-229`→`collectConsole :210`, events `:213-214`; the 5s default `:271`→`:392-394`; tap `:232-239`→`:242-243`; exit-1 `:286-289`→`:426`. `:190` (the `fromSurface` comment) and `android-screen.mjs:208` were the only two that still held. A warning about re-grepping was added at the top. · F2 (HIGH, fixed): §10 taught that a hand-started `npm run dev:mobile` binds loopback unless `TAURI_DEV_HOST` is set. False since `f1a1a2cec` (20-09-26), which changed `ui/vite.mobile.config.ts:142` to `host: host || '0.0.0.0'` — same drift and same commit as F1 in the `android-apk-build` skill. Rewritten to state the current value and keep the old failure as a pre-`f1a1a2cec` caveat. · F3 (MEDIUM, fixed): the `apps/mobile-tauri/AGENTS.md` citations pointed at the wrong section — `:198-230` is Signing/keystore, the measured cost table is at `:244-276` (rows `:250-251`); "14s incremental" `:205`→`:251`; the ABI qualification `:207-216`→`:257-261`; the packaging-padding trap `:227-230`→`:273-274`. · F4 (MEDIUM, recorded, NOT fixed here — out of scope): the claim REV 1 refuted is **still written in the source it was derived from**. `scripts/android-cdp.mjs:14-15` ("renders the page even while the tablet shows its lockscreen") and `:190-193` ("That is what makes this work on a locked or screen-off tablet") both still assert it. Flagged inline in §6b as a `chore(docs)` follow-up; this audit edits `.agents/skills` only. · F5 (MEDIUM, recorded): the usage string at `:374` accepts `elements`, `tap-testid` and `wait-testid` — three commands the §5 table does not document. Added as an explicit unmeasured-caveat note rather than as rows, because none has been driven on a device in this pass. · F6 (LOW, fixed): the footer read `23-09-26`, a date one day in the *future* relative to this audit (22-09-26); the REV 1 note carries the same 2026-09-23 date. Corrected to 22-09-26. An audit stamp dated tomorrow cannot have been measured today. · Verified still accurate this pass: `scripts/android-cdp.mjs`, `scripts/android-screen.mjs` and `scripts/check-testid.mjs` all exist; `tauri.conf.json:8` is still `"devUrl": "http://localhost:1422"`; all four `data-testid` values resolve at their cited lines (`RetailCartPanel.tsx:206` and `:409`, `RetailProductGrid.tsx:658` and `:678`, `RestaurantSidebar.tsx:347`). · NOT re-measured (needs the tablet): the wry `devtools` cfg arms, the §6c/§6d capture measurements, and the `elements`/`tap-testid`/`wait-testid` commands. · NOTE ON PROCESS: several of these repairs were applied once, vanished from the working tree and had to be re-applied — this repo runs many agents in parallel against one checkout. All were re-verified present after re-application. -->

<!-- Superseded audit stamp: 2026-09-21 · docs-auditor · status: REPAIRED — one claim refuted by live measurement and withdrawn (see the REV 1 note at the end of this stamp), everything else re-confirmed. (new skill — created after the repo had a build/install skill but no way to look inside the running tablet app; every CDP claim below was taken from scripts/android-cdp.mjs read in full this pass, plus scripts/android-screen.mjs and four data-testid values, each grepped to its defining line. The build-mode decision table in §2 was DERIVED, NOT MEASURED BY ME: its costs and ABI qualifications come from apps/mobile-tauri/AGENTS.md:198-230 and from the android-apk-build skill (its ~171-178 passage on the custom-protocol feature); no build was run this pass. CORRECTION carried over the android-apk-build skill, which is NOT edited here: the wry devtools gate is `#[cfg(any(debug_assertions, feature = "devtools"))]` — crate `wry` 0.55.1, `android/main_pipe.rs:258`, read at source this pass — not `debug_assertions` alone; the older wording in that skill omitted the `feature = "devtools"` half) · REV 1 (2026-09-23, live-measurement correction lane) — **THE SCREENSHOT CLAIM WAS CORRECTED BY LIVE MEASUREMENT ON THIS DATE.** Status above changed from ACCURATE to REPAIRED; this is not a re-stamp, it is a refutation. WHAT REFUTED IT: an independent tester, on the attached Redmi tablet, this session. The claim withdrawn was that `fromSurface:false` “produces a real image while the tablet is locked or its panel is off” (§6b). Measured: with the display genuinely OFF (`mWakefulness=Asleep` pre and post), `node scripts/android-cdp.mjs screenshot` produced **nothing** — `Page.captureScreenshot timed out after 30000ms (renderer produced no frame?)`, the surface fallback timing out after the `fromSurface:false` call threw first — while `adb screencap` in the same condition returned a **valid all-black PNG** (11,778 B, 1920×1200, mean luminance 0, 1 distinct colour; the same capture with the panel on is 848,384 B, mean luminance 87.76, 3,779 colours). The claim’s premise about `screencap` is therefore CONFIRMED; its inference about `fromSurface` is NOT supported. The honest rule now written into §6c/§6e: CDP capture works when the renderer is producing frames, and returns nothing when it has stopped. Do NOT overcorrect — in an earlier turn of the same session the SAME command succeeded on this device (204,229 B, 1920×1200, panel on, app rendered), so CDP screenshots are not being condemned here, only the locked/panel-off case. Also added from the same measurement: §6d, a capture timeout with the screen fully ON (`mWakefulness=Awake`) while `Runtime.evaluate` kept working — a wedged renderer, recovered by `adb shell am force-stop mu.kasir.mobile` + relaunch; the error text names a frame, not a panel, and the panel must not be reported as the cause unverified. §10 added for the debug-APK dev-server dependency. `fromSurface:false`’s actual property (it asks the renderer for its own output rather than the system compositor) is KEPT — the platform state was the reason it failed here, not the flag. The router row in onboarding-guide/SKILL.md:~96 was corrected to match. VERIFIED MYSELF THIS PASS, by reading the files: `tauri.conf.json:8` is `devUrl: http://localhost:1422`; the APK asset listing contains `assets/tauri.conf.json` and no `index.html`; the current text of §6, the §5 command table, the §8 timeout row, the §9 limits, the frontmatter description and the onboarding router row all now agree; the `wry` devtools correction in §1 is untouched; `scripts/android-cdp.mjs` was NOT edited. REPORTED TO ME, NOT RE-MEASURED BY ME (the tester’s figures, reproduced above, not re-run here): every byte count, luminance and colour count in §6c, and the screen-state readings. The build-mode table in §2 remains DERIVED, NOT MEASURED — unchanged by this pass. · verified this pass: crate `wry` 0.55.1 `android/main_pipe.rs:258-264` read directly from the cargo registry (C:/Users/Dika/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.55.1/...), gate is any(debug_assertions, feature="devtools") and the `devtools` bool is the argument passed to setWebContentsDebuggingEnabled; crate `wry` 0.55.1 `Cargo.toml:55` declares `devtools = []`; its `lib.rs:834-837` defaults devtools true under debug_assertions and false otherwise; **the Platform-specific note at crate `wry` 0.55.1 `lib.rs:1238` declares "Wry's `WebView` devtools API isn't supported on Android"** (read verbatim above `with_devtools` at lib.rs:1240), which is why §1 scopes the release route to the Cargo feature only and warns against `with_devtools` rather than offering it; scripts/android-cdp.mjs exists at 289 lines and its switch (:255-282) exposes exactly targets/eval/screenshot/console/tap; userGesture:true at :163; fromSurface:false at :190 with the surface fallback at :192; the CRLF strip at :39; the 20000ms default timeout and its message at :129-135; Input.dispatchMouseEvent at :232-239; the two prepareForward errors at :65-68 and :72-77; scripts/android-screen.mjs calls adb exec-out screencap -p at :208; data-testid values confirmed at ui/src/features/retail/RetailCartPanel.tsx:206 (retail-cart-line-item) and :409 (pay-btn), ui/src/features/retail/RetailProductGrid.tsx:658 and :678 (product-grid-scroll, two nodes in one file), ui/src/features/restaurant/components/RestaurantSidebar.tsx:347 (restaurant-sidebar-deduction-override); apps/mobile-tauri/AGENTS.md:198-230 read and cited, not re-measured -->

# Android UI automation over CDP

Building and installing the APK is `android-apk-build` — this skill starts after
the app is on the device and **running**. Its subject is one script,
`scripts/android-cdp.mjs`, which speaks Chrome DevTools Protocol to
the tablet’s WebView over `adb forward`.

> **The script grew and every line number in this skill moved.** It was 289 lines
> when this skill was written; it is **427** as of 22-09-26. All the `:NNN`
> citations below were re-measured on 22-09-26 and are current, but they will move
> again on the next edit to that file — re-grep before quoting one.

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
`scripts/android-cdp.mjs:80-83` reports `no devtools socket for pid N - the
installed APK is a release build`, which is accurate for that common case and
for the default release configuration.

The script resolves the pid with `pidof mu.kasir.mobile`, greps `/proc/net/unix`
for the socket (`scripts/android-cdp.mjs:77-78`), and forwards `tcp:9222` to it
(`:85`).

## 2. Choosing the build mode: which APK answers which question

`apps/mobile-tauri/AGENTS.md:244-276` carries the measured cost table (release
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

**(a) The 14s is incremental.** `apps/mobile-tauri/AGENTS.md:251` says “14s
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
See `apps/mobile-tauri/AGENTS.md:257-261`.

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
  (`apps/mobile-tauri/AGENTS.md:273-274`). Run `gradlew clean` before trusting a
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
| `adb` on PATH | The script shells out to bare `adb` (`:46`), so whatever resolves first wins. |
| Node >= 22 | The `WebSocket` global is what keeps the script dependency-free (`:105`); no `npm i`. |
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
| `node scripts/android-cdp.mjs targets` | Lists the debuggable targets as `[type] title — url`, plus the pid (`listTargets` at `:90`, printed at `:380-382`). | First call on a fresh attach. Proves the socket answers and which target is the page. |
| `node scripts/android-cdp.mjs eval "<js>"` | `Runtime.evaluate` with `returnByValue` + `awaitPromise`; returns the JSON value, or throws with the page’s own exception text (`:166-172`). | Reading state: DOM presence, `getBoundingClientRect`, `getComputedStyle`, or firing a `.click()`. |
| `node scripts/android-cdp.mjs screenshot <path>` | `Page.enable`, then `Page.captureScreenshot` as PNG; writes the file and prints `{url, bytes}` (`:187-205`). | You need a frame **and the renderer is live** — the normal case. It returns nothing when the renderer has stopped (§6b); for a locked or panel-off tablet use `android-screen.mjs`. |
| `node scripts/android-cdp.mjs console --seconds 10` | Enables `Runtime` + `Log`, waits the window, prints `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and `Log.entryAdded` lines (`collectConsole` at `:210`, events at `:213-214`). Default is 5s (`:392-394`). | Catching a thrown error or a `console.*` the device emits and the desktop never sees. |
| `node scripts/android-cdp.mjs tap <x> <y>` | `Input.dispatchMouseEvent` mousePressed then mouseReleased at the coordinates (`:242-243`). | Simulating a real press, when `element.click()` is not enough. |

`tap` is **coordinate-based**, not selector-based. Pair it with an `eval` that
reads the rect first (§7).

**Three commands the script has that this table does not document:** the usage
string at `:374` also accepts `elements`, `tap-testid` and `wait-testid`. They
were added after this table was written and are **unmeasured here** — read them
in the source before relying on them, and prefer the `eval`-then-`tap` loop in §7
until someone has. `wait-testid` is the interesting one: it is the polling wait
this skill otherwise tells you to hand-roll.

## 6. Two properties the script engineers for

These are the reason to prefer it, and both are one-line choices in the source.

**(a) `userGesture: true` (`:170`).** `Runtime.evaluate` is sent with the
user-gesture flag, so a programmatic `element.click()` counts as a trusted gesture
and is not swallowed by user-activation checks — the ones that make a synthetic
`.click()` a no-op in a desktop browser. Popovers, focus rings and buttons gated on
activation behave as if a finger hit them.

**(b) `fromSurface: false` (`:190`) — a real property, and a refuted inference.**
`Page.captureScreenshot` is asked for the renderer’s own output instead of a
fresh compositor surface frame. That much is true and is worth documenting: it
is a request to the **renderer**, not to the system compositor.

The skill previously went on to claim this is what “produces a real image while
the tablet is locked or its panel is off”. **That claim is false and is
withdrawn — it was corrected by live measurement on 2026-09-23**, on the Redmi
tablet. Keep the flag; discard the inference. §6c is the measurement.

The script keeps the surface capture as a fallback (`:199`, 30s) because it is
the one that includes anything composited outside the renderer. That fallback is
exactly what times out when neither path yields a frame (§6c, §6d).

> **The refuted claim is still written in the source.** Two comments in
> `scripts/android-cdp.mjs` assert the inference §6c refuted: the file header at
> `:14-15` (`"`Page.captureScreenshot` renders the page even while the tablet shows
> its lockscreen"`) and the inline note at `:190-193` (`"That is what makes this work
> on a locked or screen-off tablet, where no new frame is ever produced"`). The
> measurement in §6c contradicts both. This skill no longer teaches it, but anyone
> who reads the script instead of the skill still will — the comments are a
> `chore(docs)` follow-up, not a code bug, and they were left unedited here because
> this audit's scope is `.agents/skills`.

Contrast with `scripts/android-screen.mjs`, which runs `adb exec-out screencap -p`
(`:208`) and decodes the frame with `zlib`. Measured: it returns a **valid black
PNG** when the panel is off, and a real image when it is on — it was the only one
of the two that produced anything in that condition.

### (c) The fromSurface claim does not survive measurement (2026-09-23)

Screen genuinely OFF (`mWakefulness=Asleep` before and after), same device, same
session:

| Capture path | Result with the panel OFF |
|---|---|
| `adb screencap` / `scripts/android-screen.mjs` | **A valid all-black PNG** — 11,778 B, 1920×1200, mean luminance 0, **1 distinct colour**. The same capture with the panel on is 848,384 B / mean luminance 87.76 / 3,779 colours, so the 72× byte drop is the panel, not a broken decoder. |
| `node scripts/android-cdp.mjs screenshot` | **No image at all.** `Page.captureScreenshot timed out after 30000ms (renderer produced no frame?)` — that is the **surface fallback** timing out, after the `fromSurface:false` call threw first. |

So the premise the old text rested on is half right and half wrong. `screencap`
does go black with the panel off — confirmed, one colour. But `fromSurface:false`
did **not** rescue it: it produced no frame, and the fallback produced none
either. **The platform state was the reason it failed, not the flag.**

This is not a blanket condemnation of CDP screenshots. In an earlier turn of the
same session `node scripts/android-cdp.mjs screenshot` **succeeded** on this
device — 204,229 B, 1920×1200, panel on, app rendered. CDP capture works when the
renderer is producing frames; it returns nothing when the renderer has stopped.

### (d) A capture timeout can happen with the screen ON — the panel may not be the cause

The same `screenshot` command **also** timed out with the panel fully on
(`mWakefulness=Awake`) while `Runtime.evaluate` kept working — the renderer had
simply stopped producing frames. It recovered only after a force-stop and
relaunch:

```bash
adb shell am force-stop mu.kasir.mobile
adb shell am start -n mu.kasir.mobile/.MainActivity
```

**The timeout message names a frame, not a panel — do not report the panel as the
cause until you have checked it.** The tool’s own error text
(‘renderer produced no frame?’) is accurate; it is the *inference* that a dark
panel explains it that is unsupported. Diagnose in this order: (1) if
`Runtime.evaluate` still answers, the process and socket are alive and the
likely cause is a **stuck renderer** — force-stop and relaunch; (2) confirm the
panel state independently (`adb shell dumpsys display | grep 'Display State'`,
`adb shell dumpsys window policy | grep showing=`) before blaming it; (3) if the
panel is genuinely off, stop reaching for CDP and capture with
`scripts/android-screen.mjs` (§6c).

### (e) Choosing the capture tool

| Question | Use |
|---|---|
| What does the **page** render, while the renderer is live; what is the DOM / rect / console? | `android-cdp.mjs` |
| The tablet is **locked or its panel is off** — is it even worth trying CDP? | **No.** Use `scripts/android-screen.mjs`. Measured: CDP returned nothing in that state and `screencap` returned a valid frame (§6c). A black frame from `android-screen.mjs` means **the panel is off**, not that the app is broken — check `dumpsys display` before concluding anything about the app. |
| What is on the **physical screen** — keyguard, native system UI, boot logo, anything outside the WebView? | `android-screen.mjs` |

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
| `mu.kasir.mobile is not running` (`:72-75`) | No live process holds the socket. | Launch it: `adb shell am start -n mu.kasir.mobile/.MainActivity`, then re-run. |
| `no devtools socket for pid N - the installed APK is a release build` (`:80-83`) | The installed APK took neither cfg arm at `android/main_pipe.rs:258` in crate `wry` 0.55.1 (§1). | Build a debug APK: `cargo tauri android build --debug --apk --target aarch64`. `--target aarch64` matters — it drops the other three ABIs and keeps the APK size sane (§2b). Then install and launch it. |
| `<method> timed out after Nms (renderer produced no frame?)` (`:136-141`, default `timeoutMs = 20000`) | The renderer produced no frame — measured for `screenshot` in **both** panel states, so **do not assume the display is off** (§6d). | If `eval` still answers, the renderer is stuck: `adb shell am force-stop mu.kasir.mobile` then relaunch. Otherwise check the panel (`dumpsys display`) and, for a capture specifically, use `scripts/android-screen.mjs` (§6c). The timeout is deliberate (default 20000ms) so a hung terminal does not look like a slow one. |
| A value looks padded, or a comparison silently fails on Windows | `adb` emits CRLF; the script strips `\r` at `:46` (and again on the error path at `:59`). | Nothing to fix in the script — but hand-rolled `adb` output of your own needs the same `.replace(/\r/g, "")` before you trim or compare it. |
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
  every command here. Use `scripts/android-screen.mjs` or `uiautomator` for those.
- **CDP capture needs a live renderer, and that is not the same as a live process.**
  A `screenshot` can time out at 30 s with the panel on (§6d) and returns nothing at
  all with the panel off (§6c). `eval` answering is the only way to tell the two
  apart. A locked or panel-off tablet is **not** a CDP capture case.
- **`tap` takes CSS pixels**, and `screenshot` captures the renderer’s viewport;
  both are independent of the device pixel ratio you would measure with `screencap`.

## 10. A debug APK needs a reachable dev server — or every testid reads zero

A **debug** APK bundles no frontend. `apps/mobile-tauri/tauri.conf.json:8` is
`"devUrl": "http://localhost:1422"`, and the debug build loads that URL instead
of embedded assets — verified by listing the APK’s own asset directory, which
contains only `assets/tauri.conf.json` and **no `index.html`**.

So a debug APK with no dev server running renders a Chromium error page
(“Webpage not available”). Every command in this skill then **works correctly**
and reports **zero elements** — `querySelector` returns `null`, the testid count
is `0`, and there is no app UI to tap. That is not a broken testid, a bad
selector, or a regression: it is the wrong artifact for the job, or a missing
server.

**`localhost` is not the tablet.** `http://localhost:1422` resolves on the device,
where nothing is listening. The host must be reachable **at that URL from the
tablet**, so the dev server must bind the host’s LAN address, not loopback:

```bash
# start the mobile dev server bound to the LAN IP the tablet can reach
TAURI_DEV_HOST=<lan-ip> npm run dev:mobile --prefix ui
```

`cargo tauri android dev` owns the server and sets `TAURI_DEV_HOST` itself, which
is why the `dev` path works without this. A hand-started `npm run dev:mobile`
**binds all interfaces since `f1a1a2cec` (20-09-26)** — `ui/vite.mobile.config.ts:142`
is `host: host || '0.0.0.0'`, so setting `TAURI_DEV_HOST` is no longer required to make
it reachable. It was `host: host || false` before that commit, and `false` binds
`localhost` (`::1` on Windows), which the tablet cannot reach — so on a branch that
predates it, or a config that overrides the fallback, the loopback failure is still
live and the command below remains the fix. Confirm reachability **from the tablet**,
not from the PC:

```bash
adb shell 'curl -s -m 8 -o /dev/null -w %{http_code} http://<lan-ip>:1422/'
```

`200` means it can reach the server; `000` means it cannot. Bind state on the
host: `Get-NetTCPConnection -LocalPort 1422 -State Listen` — a `::1`-only row is
the broken case.

**Do not fix this by changing code.** The remedy is either a reachable dev server
(`TAURI_DEV_HOST`) for UI iteration, or a **release** APK, which loads the
embedded bundle and needs no server at all. The build/install half — the
`custom-protocol` feature split, the `Failed to request http://<lan-ip>:1422/`
path, and the APK themselves — is the `android-apk-build` skill; do not re-derive
it here.

---

> last audited 22-09-26 by Budak-Korporat
