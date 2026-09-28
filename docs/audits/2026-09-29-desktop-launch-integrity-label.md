# Desktop launch failure — root cause: a Low Mandatory Level ACL on the checkout

<!-- Audit stamp: 2026-09-29 · BK · status: ACCURATE · version lock: 0.0.40
     change: incident record. Supersedes two earlier theories from 2026-09-28 —
     (a) a stale-process handle race and (b) "binaries produced by rustc are denied
     file access". Both observed real symptoms and both got the mechanism wrong. -->

## 0. Summary

`cargo tauri dev` could not start the desktop client **without** administrator rights, and
started fine **with** them. The cause is an inherited `Mandatory Label\Low Mandatory Level` ACL
on the checkout: every binary under `C:\dev\kasirmu` ran at Low integrity, and a Low-integrity
process may not write to a higher-integrity object.

Fixed by relabelling the checkout to Medium. No application code was at fault.

```powershell
icacls "C:\dev\kasirmu" /setintegritylevel "(OI)(CI)M"
```

## 1. Symptoms

Two errors, always together, only without admin:

```
ERROR failed to create webview: WebView2 error: WindowsError(Error {
  code: HRESULT(0x800700AA), message: "The requested resource is in use." })

thread 'main' panicked at tauri-2.11.3/src/app.rs:1425:11:
Failed to setup app: error encountered during setup hook: internal error:
seeding primary store: attempt to write a readonly database
```

An earlier variant of the same failure reported `reading journal_mode: unable to open database
file` instead of the readonly message. Both are the same denial seen from different statements.

## 2. What was ruled out, and why the first two theories were wrong

| Theory | Verdict |
|---|---|
| A killed predecessor still holds the SQLite `-shm` mapping and the EBWebView profile lock (Windows releases them lazily) | **Not the cause.** Plausible and never disproved directly, but it cannot explain why running as admin changes the outcome. |
| Binaries produced by `rustc` are denied file creation (Trap N+5) | **Wrong mechanism.** The symptom was real; the cause is the label, not the compiler. |
| `tauri-build` cannot read `tauri.conf.json` (OS error 5) | Same label. It was never a file-lock or ACL-on-the-config problem. |
| A `cargo check` that passes means the environment recovered | **False.** Cargo replays cached build-script output. See §6. |

The discriminator that settled it: **admin works, normal rights fail.** Nothing about a file
handle behaves differently for an administrator; an integrity label does.

## 3. Root cause — measured

Measured 2026-09-29, before the fix:

| Object | Integrity label |
|---|---|
| `C:\dev` (parent) | none |
| `C:\dev\kasirmu` | `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)` — explicit, propagates |
| `C:\dev\kasirmu\target` | `Low Mandatory Level:(I)(OI)(CI)(NW)` |
| `C:\dev\kasirmu\target\debug\kasirmu-app.exe` | `Low Mandatory Level:(I)(NW)` |
| `C:\Users\<user>\AppData\Roaming\mu.kasir.app` (store DB) | none → **Medium** |
| `C:\Users\<user>\AppData\Local\mu.kasir.app` (WebView2 `EBWebView`) | none → **Medium** |

`(NW)` = **NoWriteUp**. A Low-integrity subject cannot write to a Medium object, so:

- SQLite cannot write `kasir.db` → `attempt to write a readonly database`
- WebView2 cannot create its profile directory → `HRESULT(0x800700AA)`

The store DB is under **Roaming**, the WebView2 profile under **Local**. Both are Medium.

**Decisive experiment.** `ui\node_modules\@esbuild\win32-x64\esbuild.exe` could not read *any*
file, anywhere, including under `C:\Users`. A Python `shutil.copy` of the same 10,617,344 bytes
to `C:\Users\Dika\ebtest\esbuild-copy.exe` bundled correctly; copying it **back** into
`node_modules` re-inherited Low and failed again. The label belongs to the location, not the
bytes.

**Confirmation.** Copying `target\debug\kasirmu-app.exe` (66,460,672 bytes) to
`C:\Users\Dika\kasirmu-run\kasirmu-app.exe` — Medium, no Low label — booted the whole app: 14
modules loaded and started, hardware bootstrap complete, `server origin attested
https://license.kasir.mu`, `pg sync cycle completed`. Neither error appeared.

## 4. The fix

Requires elevation. `Authenticated Users:(M)` is Modify, which does not include `WRITE_OWNER`,
so an unelevated prompt always returns `Access is denied`.

```powershell
# 1. confirm the window is elevated — must print True
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# 2. relabel — quote the label argument
icacls "C:\dev\kasirmu" /setintegritylevel "(OI)(CI)M"

# 3. verify — expect no output, or a Medium line
icacls "C:\dev\kasirmu\target\debug\kasirmu-app.exe" | findstr /i mandatory
```

Children show `(I)` (inherited), so relabelling the root propagates immediately. **Do not add
`/T`** — it would traverse `node_modules` and `target` for no benefit.

### The label argument must be quoted, except in `cmd.exe`

| Shell | Failure if unquoted |
|---|---|
| PowerShell | `OI: The term 'OI' is not recognized as a name of a cmdlet...` (parentheses are grouping syntax) |
| Git Bash | `Invalid parameter "C:/.../PortableGit/.../setintegritylevel"` (MSYS path conversion — prefix `MSYS_NO_PATHCONV=1`) |
| `cmd.exe` | works bare |

The owner hit the PowerShell variant on the first attempt, which is why the label appeared
unchanged after the first try.

### After the fix

- Root reads `Mandatory Label\Medium Mandatory Level:(OI)(CI)(NW)`.
- `kasirmu-app.exe` reads `Mandatory Label\Medium Mandatory Level:(I)(NW)`.
- esbuild reads files in place again — no `winapi error #5`. Plain `npm run dev` works; the
  `ESBUILD_BINARY_PATH` workaround is no longer needed.
- `cargo tauri dev` and `scripts/start-desktop.bat` work without admin.

## 5. What this one ACL also explains

These were filed as separate environmental traps. They are all this label:

- temp-file / temp-dir `PermissionDenied` (OS error 5) across many test suites
- `tauri-build` unable to read `tauri.conf.json` (OS error 5)
- esbuild `Cannot read file "package.json": winapi error #5`, which made Vite impossible
- `cargo test -p kasirmu-app` failing while `cargo check -p kasirmu-app` passed

## 6. Reusable diagnostics

**A passing `cargo check` is not evidence.** Cargo caches build-script output; a check that
finishes in seconds and prints no `Compiling <crate>` line replayed a cache. Force a fresh run
with `TAURI_CONFIG=1 cargo check -p kasirmu-app`, which trips the build script's own
`cargo:rerun-if-env-changed=TAURI_CONFIG`. `cargo test` always re-runs the script and is the
honest one.

**Workarounds when you cannot elevate:**

- `CARGO_TARGET_DIR` outside the labelled tree (e.g. `C:/Users/Dika/kt`) — build scripts are
  then created unlabelled.
- Copy the denied binary outside the tree and run the copy; for esbuild set
  `ESBUILD_BINARY_PATH` to the copy.

**Localhost HTTP through this tool's shell goes via a proxy.** `http_proxy` is set, so
`curl http://127.0.0.1:1420/` returns **502** from the proxy. Vite binds `[::1]` only, so
`curl --noproxy '*' http://127.0.0.1:1420/` returns **000**. Use `http://[::1]:1420/`, and set
`NO_PROXY` for anything doing a dev-server readiness check.

## 7. Recontextualising two earlier commits

`db0e131dc` (retry the DB writability probe inside the open sequence) and `84a67d4db` (poll for
released locks instead of a fixed sleep) were written against the stale-handle theory. They are
legitimate hardening and should stay — a retried open and a verified lock wait are both correct
— but **neither was the cause**, and the long operator message "another kasir.mu instance is
already running" describes an ACL symptom as though it were contention. It should not be read
as evidence the next time this class of failure appears.

## 8. Open, and unrelated to this fix

A **clean** build of `kasirmu-app` fails, reproduced twice in a fresh `CARGO_TARGET_DIR` with
zero occurrences of `OS Error 5`, under both default features and `--no-default-features`:

```
error[E0107]: struct takes 3 generic arguments but 2 generic arguments were supplied
  schemars-0.8.22\src\lib.rs:12  pub type Map<K, V> = indexmap::IndexMap<K, V>;
  indexmap-1.9.3\src\map.rs:76   pub struct IndexMap<K, V, S>
```

`Cargo.lock` is clean and pins indexmap 1.9.3 + 2.14.0 and schemars 0.8.22 / 0.9.0 / 1.2.1. The
shared `target/` masks it with stale artifacts, which is why `cargo tauri dev` still finishes in
seconds.

**Unproven hypothesis:** a workspace-wide build enables indexmap's `std` feature, which supplies
the `S = RandomState` default that makes `IndexMap<K, V>` legal, while a package-scoped build
does not. CI runs `--workspace`, so CI may be unaffected. Not tested — that is another ~10 minute
build. Test it before calling this a CI break.

> last audited 29-09-26 by BK
