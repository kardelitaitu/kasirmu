# done-todo-android-device-identity

> **Status: VERIFIED & ACCEPTED.** Implemented and verified 2026-10-07. Persistent device UUID generated on fresh
> installs and persisted in settings (`device.terminal_id`) and cached in `AppState::terminal_id`.
> Adopts single existing provisioning row (`unknown-device`) on legacy upgrades so existing tablets
> never re-onboard. Acceptance commands passed: `cargo test -p kasirmu-core --lib db::provisioning` (36 passed),
> `cargo test -p kasirmu-mobile` (715 passed), and `npm run test -- src/__tests__/ProvisioningFlow.test.tsx` (48 passed).

**Symptom.** Every Android tablet provisions as terminal `unknown-device`. It works today, and it is
one environment variable away from failing on every boot.

## What was measured

`kasirmu_bridge::health::get_device_id` (`crates/kasirmu-bridge/src/health.rs:76-80`) reads
`COMPUTERNAME`, then `HOSTNAME`, then falls back to the literal `"unknown-device"`.

On the tablet (Redmi `23073RPBFG`, Android 15, `mu.kasir.mobile` 0.0.41, DEBUGGABLE):

```
adb shell run-as mu.kasir.mobile cat /proc/<pid>/environ | tr '\0' '\n' | grep -icE '^HOSTNAME|^COMPUTERNAME'
--> 0        (18 environment variables, neither name present)
```

The device's own database confirms the consequence:

```
provisioning.terminal_id = 'unknown-device'     (mode = 'linked')
```

Re-measured 2026-10-05, unchanged. `apps/mobile-tauri/src/commands/health.rs:40` is a shim over the
same bridge body, so the tablet has no Android-specific path.

## Why it works today, and why that is luck

The value is *consistently* wrong. The provision write and the boot read both call `get_device_id`,
both get `"unknown-device"`, and they agree. Nothing about that is guaranteed:

- The day a build or ROM sets `HOSTNAME` — or sets it to something that varies with the network —
  the boot read disagrees with the row written at provisioning, `get_first_run_state` answers
  `unprovisioned`, and **the tablet re-enters onboarding on every boot**.
- Separately, the value is not an identity at all: every Android install in the field shares it. It
  is also what a linked provision records as `device_credential_id` when the link issued no terminal
  (`ui/src/features/setup/ProvisioningFlow.tsx:561`), so the "credential" is a global constant.

## The trap — do not do the obvious fix

Generating a random UUID per process is **worse than the bug**. `get_device_id` is called fresh on
every boot and during provisioning; a per-process value changes every launch, so the boot read would
never match the stored row and the tablet would re-enter onboarding *immediately*, on every device,
rather than hypothetically.

## The change that is actually required

1. **Persist the identifier, do not derive it per process.** A value written once on first run and
   read thereafter. `get_device_id` currently takes **no arguments** and has no connection or
   filesystem access, so this needs plumbing: give it `State<'_, AppState>` (Tauri injects state, so
   `ui/src/api/system.ts`'s `getDeviceId()` call site needs no change) and resolve a path or a
   settings key from `AppState`.
2. **Adopt the existing row, or you strand every installed tablet.** Any device already provisioned
   carries `terminal_id = 'unknown-device'`. Shipping a new id with no backfill re-onboards all of
   them — including the one on the bench. Either keep returning `unknown-device` when a provisioning
   row exists under that id and none under the new one, or migrate the row.
3. **Scope it to Android.** `#[cfg(target_os = "android")]` on the new arm; desktop keeps reading
   `COMPUTERNAME`/`HOSTNAME`, which is correct there.
4. **Decide the reinstall semantics deliberately.** App data cleared ⇒ new id ⇒ the device looks new.
   That is probably right for a linked install (the server grant is the identity) and wrong for a
   `local` one (the data is on the device). This is an owner decision, not an implementation detail.

### Optional, and cheaper: make the boot read resilient instead

Independently of changing the id, `get_first_run_state` could adopt the single existing provisioning
row when the requested `terminal_id` has none and exactly one row exists. That removes the
re-onboard-on-id-change failure mode permanently without touching identity at all. Guard it on
"exactly one row", or a multi-terminal database becomes ambiguous.

## Acceptance

```
cargo test -p kasirmu-core --lib db::provisioning
cargo test -p kasirmu-mobile
cd ui && npx vitest run src/__tests__/ProvisioningFlow.test.tsx
```

Plus, on the device, after a reinstall:

```
adb shell run-as mu.kasir.mobile sqlite3 databases/../kasir.db \
  "SELECT terminal_id, mode FROM provisioning;"
--> terminal_id must NOT be 'unknown-device', and must be stable across two boots
```

Note the DB lives at `/data/data/mu.kasir.mobile/kasir.db`, **not** under `databases/` — that
directory is empty on Android. Pull it with `adb exec-out run-as mu.kasir.mobile cat kasir.db` and
copy the `-wal` and `-shm` alongside it or you read a stale page set.

## Related, already pinned

- `test(core): pin the linked provision fail-closed entitlement` (`5372c7d68`) — a linked provision
  writes no subscription row, so it reads `Unavailable` and every tool locks.
- `test(ui): pin the linked credential fallback when no terminal is issued` (`22b4757f7`) — pins
  that a link with no terminal sends the device id, and records why blocking it is the wrong fix.
