#!/usr/bin/env node
/**
 * android-cdp.mjs — inspect and drive the Android WebView from a terminal.
 *
 * Why this exists: the tablet shell is a WebView, and a release APK gives no
 * view into it — no console, no DOM, no screenshots that survive the screen
 * being off or the keyguard being up. wry calls
 * `setWebContentsDebuggingEnabled` only under `cfg(debug_assertions)`
 * (`wry-0.55.1/src/android/main_pipe.rs:258-264`), so a **debug** APK opens a
 * `@webview_devtools_remote_<pid>` socket and this script attaches to it over
 * `adb forward`, then speaks Chrome DevTools Protocol to it.
 *
 * That makes four things possible that nothing else in this repo can do:
 * `Page.captureScreenshot` renders the page even while the tablet shows its
 * lockscreen, and `Runtime.evaluate` reads the live DOM and its computed
 * styles — so a layout claim can be measured instead of inferred. On top of
 * that, elements can be addressed by their `data-testid` instead of guessed
 * pixel coordinates: an agent enumerates what is addressable, then taps or
 * waits on a named element. That turns the WebView into something a script can
 * act on without knowing the device's screen geometry.
 *
 * Commands (from the repo root):
 *
 *   node scripts/android-cdp.mjs targets
 *   node scripts/android-cdp.mjs eval "document.title"
 *   node scripts/android-cdp.mjs eval "getComputedStyle(document.querySelector('.tablet-shell')).height"
 *   node scripts/android-cdp.mjs screenshot .tmp-android-audit/page.png
 *   node scripts/android-cdp.mjs console --seconds 10
 *   node scripts/android-cdp.mjs tap 960 600
 *   node scripts/android-cdp.mjs elements [--filter <substr>]
 *   node scripts/android-cdp.mjs tap-testid <testid>
 *   node scripts/android-cdp.mjs wait-testid <testid> [--timeout <ms>]
 *
 * Requires: the debug APK installed and running, and `adb` on PATH. Exit code
 * is 1 when the device, the socket or the command fails, so it can gate a
 * build/build verification step.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = 9222;

/** Run adb and return stdout with CR stripped (adb emits CRLF on Windows). */
function adb(...args) {
  return execFileSync("adb", args, { encoding: "utf8" }).replace(/\r/g, "");
}

/**
 * Same as `adb`, but treats a non-zero remote exit code as an empty string.
 * `pidof` exits 1 when there is no match, and execFileSync turns that into a
 * thrown "Command failed" — which would report a missing process as a broken
 * adb rather than as an app that needs launching.
 */
function adbTolerant(...args) {
  try {
    return adb(...args);
  } catch (error) {
    return error.stdout ? String(error.stdout).replace(/\r/g, "") : "";
  }
}

/**
 * Point `tcp:PORT` at the running app's WebView devtools socket.
 * adb refuses the forward when no process holds the socket, which is the
 * signal that the installed APK is a release build — surfaced as a clear
 * error rather than a connection reset later.
 */
function prepareForward() {
  const pid = adbTolerant("shell", "pidof", "mu.kasir.mobile").trim();
  if (!pid) {
    throw new Error(
      "mu.kasir.mobile is not running — launch it first:\n" +
        "  adb shell am start -n mu.kasir.mobile/.MainActivity",
    );
  }
  const socket = adb("shell", "cat", "/proc/net/unix");
  if (!socket.includes(`webview_devtools_remote_${pid}`)) {
    throw new Error(
      `no devtools socket for pid ${pid} — the installed APK is a release build ` +
        "(wry enables WebView debugging only in debug builds). Build one with:\n" +
        "  cargo tauri android build --debug --apk --target aarch64",
    );
  }
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
}

/** List the debuggable targets the WebView exposes. */
async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);
  return response.json();
}

/** Pick the page target: the shell itself, not an injected helper frame. */
function pickPage(targets) {
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("no debuggable page target found");
  return page;
}

/**
 * Open a CDP session and run `work` against it.
 *
 * The WebSocket global (Node >= 22) keeps this dependency-free, and the
 * explicit close in `finally` matters: an open socket keeps Node's event loop
 * alive and the process would hang after printing.
 */
async function withSession(work) {
  const page = pickPage(await listTargets());
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.method) {
      events.push(message);
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  // Every request is bounded: some CDP calls only answer once the renderer
  // produces a frame, and with the tablet's panel off it may never do so. A
  // timeout turns that into a diagnosable error instead of a hung terminal.
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms (renderer produced no frame?)`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });

  try {
    return await work({ send, events, page });
  } finally {
    socket.close();
  }
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(expression) {
  return withSession(async ({ send }) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result.value;
  });
}

/**
 * Render the page to a PNG.
 *
 * This is the reason the script exists: the capture comes from the renderer,
 * so it is correct while the tablet is locked or its panel is off.
 */
async function screenshot(path) {
  return withSession(async ({ send, page }) => {
    await send("Page.enable");
    // `fromSurface: false` captures the renderer's own output instead of asking
    // the system compositor for a fresh surface frame. That is what makes this
    // work on a locked or screen-off tablet, where no new frame is ever
    // produced. The surface path is kept as a fallback because it is the one
    // that includes anything composited outside the renderer.
    let shot;
    try {
      shot = await send("Page.captureScreenshot", { format: "png", fromSurface: false });
    } catch {
      shot = await send("Page.captureScreenshot", { format: "png" }, 30000);
    }
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
    }
    return { url: page.url, bytes: Math.floor((shot.data.length * 3) / 4) };
  });
}

/** Collect console output and uncaught errors for a window of time. */
async function collectConsole(seconds) {
  const wanted = new Set([
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Log.entryAdded",
  ]);
  return withSession(async ({ send, events }) => {
    await send("Runtime.enable");
    await send("Log.enable");
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const lines = [];
    for (const event of events) {
      if (!wanted.has(event.method)) continue;
      if (event.method === "Runtime.consoleAPICalled") {
        const args = event.params.args.map((a) => a.value ?? a.description ?? a.type);
        lines.push(`${event.params.type}: ${args.join(" ")}`);
      } else if (event.method === "Runtime.exceptionThrown") {
        const d = event.params.exceptionDetails;
        lines.push(`EXCEPTION: ${d.exception?.description ?? d.text}`);
      } else {
        const e = event.params.entry;
        lines.push(`${e.level} [${e.source}]: ${e.text}`);
      }
    }
    return lines;
  });
}

/** Dispatch a touch tap at device-independent CSS coordinates. */
async function tap(x, y) {
  return withSession(async ({ send }) => {
    const common = { x, y, button: "left", clickCount: 1 };
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
    return { tapped: [x, y] };
  });
}

/** Print a value the way a terminal reads best: JSON for objects. */
function show(value) {
  if (value === undefined) console.log("undefined");
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

/**
 * Enumerate every element carrying a [data-testid] in the live page.
 * Returns only elements with a non-zero rect — display:none / zero-size nodes
 * are skipped, because a caller can only tap or wait on a painted box — and
 * how many were skipped, so an agent sees the addressable surface in full.
 * @param {string} [filter] optional substring matched against the testid.
 * @returns {Promise<{elements: Array<{testid:string,tag:string,text:string,rect:{x:number,y:number,width:number,height:number}}>, skipped:number}>}
 */
async function listElements(filter) {
  // Build the in-page expression once, interpolating the filter as JSON so an
  // argv value can never break out of the expression (string-injection guard).
  const expression = `(function () {
    const out = [];
    let skipped = 0;
    const filter = ${JSON.stringify(filter)};
    for (const el of document.querySelectorAll('[data-testid]')) {
      const testid = el.getAttribute('data-testid');
      if (filter && !testid.includes(filter)) continue;
      const r = el.getBoundingClientRect();
      const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      if (rect.width === 0 || rect.height === 0) { skipped++; continue; }
      out.push({
        testid,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        rect,
      });
    }
    return { elements: out, skipped };
  })()`;
  return evaluate(expression);
}

/**
 * Resolve an element by its data-testid and tap its rect centre.
 * The element is scrolled into view and the rect re-read, because a rect
 * measured before a scroll is stale. The tap itself goes through the existing
 * tap() so the behaviour is identical to the coordinate command — a tap at the
 * rect centre, in device-independent CSS pixels.
 * @param {string} testid
 */
async function tapTestid(testid) {
  // JSON.stringify guards the testid so it cannot break out of the expression.
  // The viewport is read INSIDE the IIFE (page scope, where `window` is valid)
  // and returned alongside the rect — the bounds check below runs in Node and
  // must never touch a page global, or it dies with "window is not defined".
  const resolved = await evaluate(`(function () {
    const el = document.querySelector('[data-testid=' + ${JSON.stringify(testid)} + ']');
    if (!el) {
      const all = Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
      return { missing: true, nearest: all };
    }
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      missing: false,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`);
  if (resolved.missing) {
    const nearest = (resolved.nearest || []).slice(0, 8);
    throw new Error(
      `no element with data-testid=${JSON.stringify(testid)}` +
        (nearest.length ? ` — nearest: ${nearest.join(', ')}` : ""),
    );
  }
  const rect = resolved.rect;
  // A zero-size rect means the element is hidden — tapping (0,0) would hit
  // whatever sits at the origin, so refuse instead of guessing.
  if (rect.width === 0 || rect.height === 0) {
    throw new Error(`element data-testid=${JSON.stringify(testid)} has a zero-size rect (hidden?) — refusing to tap (0,0)`);
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  // Compare against the viewport read in-page; never reference `window` here.
  if (cx < 0 || cy < 0 || cx > resolved.viewport.width || cy > resolved.viewport.height) {
    throw new Error(`element data-testid=${JSON.stringify(testid)} is off-screen at (${cx},${cy}) after scrollIntoView`);
  }
  return tap(cx, cy);
}

/**
 * Poll in-page until the element exists and has a non-zero rect.
 * This is what makes the read-measure-act loop reliable on a UI that mounts
 * asynchronously — without it every caller writes its own retry.
 * @param {string} testid
 * @param {number} [timeoutMs] poll budget in ms (default 5000).
 */
async function waitTestid(testid, timeoutMs = 5000) {
  // JSON.stringify guards the testid; timeoutMs is a plain number emitted into
  // the expression. The promise is returned to evaluate(), which awaits it
  // (awaitPromise: true), so the CDP timeout still bounds a hung renderer.
  const expression = `(function () {
    const target = ${JSON.stringify(testid)};
    const budget = ${Number(timeoutMs) || 5000};
    const start = Date.now();
    return new Promise((resolve) => {
      (function check() {
        const el = document.querySelector('[data-testid=' + target + ']');
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { resolve({ found: true }); return; }
        }
        if (Date.now() - start >= budget) { resolve({ found: false }); return; }
        requestAnimationFrame(check);
      })();
    });
  })()`;
  const result = await evaluate(expression);
  if (!result.found) {
    throw new Error(`timed out after ${timeoutMs}ms waiting for data-testid=${JSON.stringify(testid)}`);
  }
  return { found: testid };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    throw new Error("usage: android-cdp.mjs targets|eval|screenshot|console|tap|elements|tap-testid|wait-testid");
  }
  const pid = prepareForward();

  switch (command) {
    case "targets": {
      const targets = await listTargets();
      console.log(`pid ${pid} — ${targets.length} target(s)`);
      for (const t of targets) console.log(`  [${t.type}] ${t.title} — ${t.url}`);
      break;
    }
    case "eval":
      show(await evaluate(rest.join(" ")));
      break;
    case "screenshot":
      show(await screenshot(rest[0]));
      break;
    case "console": {
      const seconds = rest.includes("--seconds")
        ? Number(rest[rest.indexOf("--seconds") + 1])
        : 5;
      const lines = await collectConsole(seconds);
      console.log(`captured ${lines.length} message(s) over ${seconds}s`);
      for (const line of lines) console.log(line);
      break;
    }
    case "tap":
      show(await tap(Number(rest[0]), Number(rest[1])));
      break;
    case "elements": {
      const filterIdx = rest.indexOf("--filter");
      const filter = filterIdx >= 0 ? rest[filterIdx + 1] : undefined;
      show(await listElements(filter));
      break;
    }
    case "tap-testid":
      show(await tapTestid(rest[0]));
      break;
    case "wait-testid": {
      const timeoutIdx = rest.indexOf("--timeout");
      const timeout = timeoutIdx >= 0 ? Number(rest[timeoutIdx + 1]) : 5000;
      show(await waitTestid(rest[0], timeout));
      break;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`android-cdp: ${error.message}`);
  process.exit(1);
});
