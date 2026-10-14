# IPC failure diagnostics on a device

How to name a failing Tauri command from a live tablet or desktop install,
without a debugger and without guessing.

## The problem this solves

Measured 2026-10-07: the tablet cold start intermittently rejected one source of
the settings fan-out and toasted *"Some settings could not be loaded"*. The toast
is deliberately vague — it cannot name the command, because a merchant-facing
string must not. Nothing on the device could: patching
`window.__TAURI_INTERNALS__.invoke` from a CDP session is **inert** against this
app's transport (`ui/src/api/tauri.ts` → `rawInvoke`), so zero calls came through
the patched door while the fan-out demonstrably ran.

Two commands were missing from the tablet shell for exactly this reason and stayed
invisible until the recorder existed: `version_scoped` (silently fell back to the
unscoped `version` per ADR #7) and `offline_queue_status_summary_scoped` (the
section degraded to its empty state). Both are registered now.

## The recorder

`ui/src/components/IpcErrorReporter.tsx` subscribes through the app's own error
boundary (`onIpcError`), so it sees every IPC failure by construction — not by
patching a door that may not be the one in use. It mounts once inside
`AppProviders`, next to `GlobalErrorReporter`.

The log lives at **`window.__ipcFailures`**, an array of:

| Field | Meaning |
|---|---|
| `command` | The Tauri command name that failed. |
| `message` | `redactedDiagnostic(error)` — tokens, SQL and customer data are stripped. |
| `userKey` | The localized key the UI would render (e.g. `app-error-generic`). |
| `at` | Epoch milliseconds. |

Two properties matter for a support session:

- **Bounded to the last 40 entries** (`MAX_ENTRIES`). It is written on every
  failure for the life of the session, so an unbounded array would grow without
  limit. Oldest entries are dropped first.
- **Redacted.** `redactedDiagnostic` is applied at record time, so nothing
  sensitive ever lands in a surface a support session can dump.

The log is **per session**: it starts empty at app start and does not survive a
restart. A failure that happened before the last launch is not here.

## Reading it from a device

The walk cannot be the only reader, so any CDP client works. Forward the WebView
socket, then evaluate one expression:

```bash
PID=$(adb shell pidof mu.kasir.mobile | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
```

```js
// In a CDP Runtime.evaluate against http://127.0.0.1:9222
JSON.stringify(window.__ipcFailures || [])
```

Do **not** spawn `adb` from a Node script in a sandboxed shell: `execFileSync`
throws `spawnSync adb EBUSY` there. Both scripts below speak HTTP + WebSocket
directly for that reason.

## Two scripts that already surface it

- **`scripts/android-settings-walk.mjs`** — walks the settings hub and the topology
  route (**14 `SECTIONS` entries plus `#/topology`, i.e. 15 routes** by default) and
  records `invokeFailures` per route in its `--json` output, attributing only the
  delta since the previous route (`:307`). A failure is therefore attached to the
  screen that caused it, which a flat dump cannot do. (Count clarified 11-10-26:
  `SECTIONS` holds 14 settings sections; the 15th walked route is the topology one.)
- **`scripts/android-homescreen-probe.mjs`** — the home-screen counterpart the settings
  walk never renders (workspace picker, org selector, tool locks, favorites keys).
  It does **not** mirror `invokeFailures`: its four assertions are the org picker
  appearing *after* the list resolves, per-user favorites keys, a greyed (not merely
  dimmed) disabled card, and no tool flash-lock during the first entitlement fetch.
  Run it for those shapes; use the settings walk for IPC-failure attribution.
  (Clarified 11-10-26 — "the same idea" implied an IPC surface the probe does not have.)

## Triage: what a failure usually means

| Shape of `message` | Usual cause |
|---|---|
| `Command <name> not found` | The UI calls a command the shell does not register. Run `python scripts/verify-ipc-parity.py`; a name the UI invokes but no shell registers is a parity gap, and the gate fails on stale allowlist entries too. |
| `PermissionDenied("user not found")` | The session user is absent from the store DB the command authorizes in. Since 2026-10-08 the session mint replicates the user into the store DB (`platform/core/src/database/identity_sync.rs`). |
| `PermissionDenied("<permission>")` | The role lacks the key. Check the tool's `access.minimumRole`/`minimumTier` and the route's own gate — the home card is cosmetic, the route gate is authoritative. |
| anything with `userKey: app-error-generic` | A failure with no merchant-facing wording; `message` is the only signal. |

## What this is not

- Not a replacement for the app log: it records failures the UI boundary saw, and
  only while the app was running.
- Not proof of absence: an empty log means no failure since launch, not that the
  command is registered. For that, use the parity gate.
