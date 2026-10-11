#!/usr/bin/env node
/**
 * desktop-cdp.mjs — inspect and drive the RUNNING kasir.mu DESKTOP app from a
 * terminal, addressing elements by `data-testid` instead of screen coordinates.
 *
 * WHY THIS EXISTS. The desktop shell is a Tauri WebView2, so every control the UI
 * renders is a DOM node — but until now nothing in this repo could reach it. The
 * only automation available was screenshotting the window and synthesising mouse
 * events at pixel offsets, which is fragile in three specific ways: the window can
 * move or resize between capture and click, a click at a coordinate silently
 * lands on whatever is painted there (a different element after any layout
 * change), and DPI scaling makes the coordinates you measured not the coordinates
 * you click. This script removes all three by never using a coordinate it did not
 * read from the element it is about to act on.
 *
 * WHY THE ENV VAR. WebView2 opens a DevTools endpoint only when told to. Tauri
 * does not pass `--remote-debugging-port` itself, so the app must be launched
 * with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set (see the desktop-cdp skill for
 * the launch recipe). Measured on this host: with that variable set the live
 * msedgewebview2.exe command line carries `--remote-debugging-port=9222` and
 * http://127.0.0.1:9222/json/version answers; without it the port refuses the
 * connection and this script exits 1 with the launch recipe.
 *
 * IMPORTANT — the endpoint is a SECURITY surface. It grants full control of the
 * app's DOM to anything that can reach the loopback port, and it persists for the
 * life of the process. Launch with it only while you are actively testing, and
 * restart the app normally (without the variable) afterwards. Do NOT bake it into
 * `scripts/start-desktop.bat` or any shipped config.
 *
 * Commands (from the repo root):
 *
 *   node scripts/desktop-cdp.mjs targets
 *   node scripts/desktop-cdp.mjs eval "document.title"
 *   node scripts/desktop-cdp.mjs elements [--filter <substr>]
 *   node scripts/desktop-cdp.mjs click-testid <testid>
 *   node scripts/desktop-cdp.mjs fill-testid <testid> <value>
 *   node scripts/desktop-cdp.mjs wait-testid <testid> [--timeout <ms>]
 *   node scripts/desktop-cdp.mjs screenshot [path]
 *   node scripts/desktop-cdp.mjs console [--seconds <n>]
 *
 * Exit code is 1 on any failure, so the commands compose into a gate.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.DESKTOP_CDP_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The launch recipe, quoted in every error that a missing endpoint can cause.
 * Kept as one constant so the two failure sites cannot drift apart.
 */
const LAUNCH_RECIPE =
  "the desktop app is not exposing a DevTools endpoint on port " +
  PORT +
  ".\n" +
  "WebView2 only opens one when told to, so relaunch the app with:\n" +
  "\n" +
  "  # PowerShell, from the repo root\n" +
  "  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=" + PORT + "'\n" +
  "  cmd /c \"set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=" + PORT + " && cargo tauri dev\"\n" +
  "\n" +
  "  # Git Bash\n" +
  "  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=" + PORT + "' cargo tauri dev\n" +
  "\n" +
  "Run it from apps/desktop-tauri (or let scripts/start-desktop.bat do it), and note that the\n" +
  "variable is inherited by the WebView2 child, not by Tauri itself.\n" +
  "The endpoint grants full DOM control over loopback: use it only while testing.";

/** List the debuggable targets WebView2 exposes. */
async function listTargets() {
  let response;
  try {
    response = await fetch(`${BASE}/json/list`);
  } catch {
    throw new Error(LAUNCH_RECIPE);
  }
  if (!response.ok) throw new Error(`${BASE}/json/list returned HTTP ${response.status}`);
  return response.json();
}

/** Pick the app page target, not an injected helper frame. */
function pickPage(targets) {
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? targets[0];
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(
      "no debuggable page target found — the endpoint answered but exposed no page.\n" +
        "Targets seen: " +
        JSON.stringify(targets.map((t) => `${t.type}:${t.url}`)),
    );
  }
  return page;
}

/**
 * Open a CDP session and run `work` against it.
 *
 * The WebSocket global (Node >= 22) keeps this dependency-free, and the explicit
 * close in `finally` matters: an open socket keeps Node's event loop alive and
 * the process would hang after printing.
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

  // Every request is bounded: a CDP call can block until the renderer produces a
  // frame, and a hung renderer would otherwise hang the terminal.
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
      // userGesture makes a programmatic .click() a TRUSTED activation, so
      // handlers gated on user activation (popovers, focus rings) behave as if
      // a real click had happened. Without it a synthetic click is a silent
      // no-op in exactly the cases a tester cares about.
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
 * Enumerate every element carrying a [data-testid].
 *
 * Returns only elements with a non-zero rect — a display:none or zero-size node
 * cannot be clicked — plus how many were skipped, so the addressable surface is
 * visible in full rather than silently reduced.
 */
async function listElements(filter) {
  // The filter is interpolated as JSON so an argv value can never break out of
  // the expression (string-injection guard).
  const expression = `(function () {
    const out = [];
    let skipped = 0;
    const filter = ${JSON.stringify(filter)};
    for (const el of document.querySelectorAll('[data-testid]')) {
      const testid = el.getAttribute('data-testid');
      if (filter && !testid.includes(filter)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { skipped++; continue; }
      out.push({
        testid,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
    return { elements: out, skipped };
  })()`;
  return evaluate(expression);
}

/**
 * Resolve an element by data-testid and CLICK IT BY ELEMENT.
 *
 * This is the command the script exists for. It deliberately does NOT convert the
 * rect to a coordinate and synthesise a mouse event: `el.click()` dispatches on
 * the node itself, so the click cannot land on a neighbouring element because the
 * layout moved, the window was scaled, or the DPI differs. The rect is still read
 * and reported, because a zero-size or off-screen rect is a real reason to refuse
 * rather than a click that silently does nothing.
 *
 * @param {string} testid
 */
async function clickTestid(testid) {
  // JSON.stringify guards the testid so it cannot break out of the expression.
  const resolved = await evaluate(`(function () {
    const el = document.querySelector('[data-testid=' + ${JSON.stringify(testid)} + ']');
    if (!el) {
      const all = Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
      return { missing: true, nearest: all.slice(0, 12) };
    }
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      missing: false,
      tag: el.tagName.toLowerCase(),
      disabled: el.disabled === true,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`);

  if (resolved.missing) {
    throw new Error(
      `no element with data-testid=${JSON.stringify(testid)}` +
        (resolved.nearest.length ? ` — nearest: ${resolved.nearest.join(", ")}` : ""),
    );
  }
  if (resolved.disabled) {
    throw new Error(`element data-testid=${JSON.stringify(testid)} is disabled — refusing to click`);
  }
  if (resolved.rect.width === 0 || resolved.rect.height === 0) {
    throw new Error(
      `element data-testid=${JSON.stringify(testid)} has a zero-size rect (hidden?) — refusing to click`,
    );
  }
  const cx = resolved.rect.x + resolved.rect.width / 2;
  const cy = resolved.rect.y + resolved.rect.height / 2;
  if (cx < 0 || cy < 0 || cx > resolved.viewport.width || cy > resolved.viewport.height) {
    throw new Error(
      `element data-testid=${JSON.stringify(testid)} is off-screen at (${cx},${cy}) after scrollIntoView`,
    );
  }

  // Click in-page, then re-read the node to report what actually happened.
  const clicked = await evaluate(`(function () {
    const el = document.querySelector('[data-testid=' + ${JSON.stringify(testid)} + ']');
    if (!el) return { ok: false, why: 'element vanished between resolve and click' };
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`);
  if (!clicked.ok) throw new Error(`click failed: ${clicked.why}`);
  return { clicked: testid, tag: clicked.tag, rect: resolved.rect };
}

/**
 * Fill an input addressed by data-testid, the way a user types.
 *
 * A bare `el.value = x` is invisible to React: React tracks the previous value on
 * the DOM node and skips its onChange when the assignment looks like no change.
 * The native `value` setter bypasses that tracker, and the explicit input/change
 * events are what actually notify the framework. Without both halves the field
 * shows the text and the app never sees it — the failure looks like "the form
 * ignored my input".
 *
 * @param {string} testid
 * @param {string} value
 */
async function fillTestid(testid, value) {
  const result = await evaluate(`(function () {
    const el = document.querySelector('[data-testid=' + ${JSON.stringify(testid)} + ']');
    if (!el) {
      const all = Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
      return { missing: true, nearest: all.slice(0, 12) };
    }
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : (tag === 'select' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!desc || !desc.set) return { missing: false, unsupported: tag };
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { missing: false, tag, value: el.value };
  })()`);

  if (result.missing) {
    throw new Error(
      `no element with data-testid=${JSON.stringify(testid)}` +
        (result.nearest.length ? ` — nearest: ${result.nearest.join(", ")}` : ""),
    );
  }
  if (result.unsupported) {
    throw new Error(`data-testid=${JSON.stringify(testid)} is a <${result.unsupported}> — fill-testid handles input/textarea/select`);
  }
  return { filled: testid, tag: result.tag, value: result.value };
}

/**
 * Poll in-page until the element exists with a non-zero rect.
 * Without this every caller writes its own retry loop against an async mount.
 */
async function waitTestid(testid, timeoutMs = 5000) {
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

/** Render the page to a PNG. */
async function screenshot(path) {
  return withSession(async ({ send, page }) => {
    await send("Page.enable");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
    }
    return { url: page.url, bytes: Math.floor((shot.data.length * 3) / 4) };
  });
}

/** Collect console output and uncaught errors for a window of time. */
async function collectConsole(seconds) {
  const wanted = new Set(["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"]);
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

/** Print a value the way a terminal reads best: JSON for objects. */
function show(value) {
  if (value === undefined) console.log("undefined");
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    throw new Error(
      "usage: desktop-cdp.mjs targets|eval|elements|click-testid|fill-testid|wait-testid|screenshot|console",
    );
  }

  switch (command) {
    case "targets": {
      const targets = await listTargets();
      console.log(`${targets.length} target(s) on ${BASE}`);
      for (const t of targets) console.log(`  [${t.type}] ${t.title} — ${t.url}`);
      break;
    }
    case "eval":
      show(await evaluate(rest.join(" ")));
      break;
    case "elements": {
      const filterIdx = rest.indexOf("--filter");
      const filter = filterIdx >= 0 ? rest[filterIdx + 1] : undefined;
      show(await listElements(filter));
      break;
    }
    case "click-testid":
      show(await clickTestid(rest[0]));
      break;
    case "fill-testid": {
      // Join the remainder so a value containing spaces needs no quoting games.
      show(await fillTestid(rest[0], rest.slice(1).join(" ")));
      break;
    }
    case "wait-testid": {
      const timeoutIdx = rest.indexOf("--timeout");
      const timeout = timeoutIdx >= 0 ? Number(rest[timeoutIdx + 1]) : 5000;
      show(await waitTestid(rest[0], timeout));
      break;
    }
    case "screenshot":
      show(await screenshot(rest[0]));
      break;
    case "console": {
      const seconds = rest.includes("--seconds") ? Number(rest[rest.indexOf("--seconds") + 1]) : 5;
      const lines = await collectConsole(seconds);
      console.log(`captured ${lines.length} message(s) over ${seconds}s`);
      for (const line of lines) console.log(line);
      break;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`desktop-cdp: ${error.message}`);
  process.exit(1);
});
