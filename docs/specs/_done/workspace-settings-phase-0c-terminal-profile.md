# Phase 0c — `terminal_profile.json` Schema + `useTerminalProfile` Hook

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0c of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 1)
- **Owner:** TBD
- **Est. effort:** 2-3 days

## Summary

Define a JSON file format for register-local hardware bindings (`terminal_profile.json`) that stores printer IP/USB path, serial scale COM port, and barcode scanner handler per terminal ID. Build a `useTerminalProfile(terminalId)` React hook with read, write, validate, and corruption recovery. This implements Pillar B's separation of store-wide settings (SQLite) from register-local hardware bindings (filesystem/localStorage).

## Baseline (pre-fix)

- `terminal_profile.json` — **does not exist** (no file format, no schema, no hook)
- `ui/src/hooks/useTerminalProfile.ts` — **does not exist**
- Printer, scanner, and scale configurations are currently stored in the flat `settings` SQLite table alongside store-wide rules — Register #2 can overwrite Register #1's hardware IP

## JSON Schema

```json
{
  "$schema": "terminal-profile-schema.json",
  "terminalId": "term-001",
  "storeId": "store-downtown",
  "hardware": {
    "printer": {
      "connection": "network | usb | serial | auto",
      "devicePath": "192.168.1.100 | /dev/usb/lp0 | COM1",
      "paperSize": "58 | 80 | a4 | letter",
      "testPrintIp": "192.168.1.100"
    },
    "scale": {
      "connection": "serial | usb | none",
      "devicePath": "COM3 | /dev/ttyUSB0",
      "baudRate": 9600,
      "zeroOnBoot": true
    },
    "scanner": {
      "mode": "keyboard | serial | auto",
      "deviceId": "scanner-hid-001"
    }
  },
  "localPrefs": {
    "soundVolume": 80,
    "darkMode": false,
    "scaleAutoZero": true
  },
  "initialized": "2026-07-23T12:00:00Z",
  "version": 1
}
```

**Storage location:** `%APPDATA%/oz-pos/terminals/{terminalId}/terminal_profile.json` (Windows) or `~/.local/share/oz-pos/terminals/{terminalId}/terminal_profile.json` (Linux/macOS). Fallback: `localStorage` key `oz-pos-terminal-profile-{terminalId}` when filesystem access is unavailable (browser dev mode).

## Acceptance criteria

### Schema document
- [ ] `docs/terminal-profile-schema.md` defines the full JSON schema with field types, defaults, and validation rules
- [ ] Schema versioned (`version: 1`) for future migration support
- [ ] All fields optional with sensible defaults (empty printer path = OS-default, empty scale = no scale)

### `useTerminalProfile` hook
- [ ] `useTerminalProfile(terminalId: string)` returns `{ profile, updatePrinter, updateScale, updateScanner, updateLocalPrefs, save, isLoading, error }`
- [ ] Reads `terminal_profile.json` from filesystem on mount (via Tauri `fs` plugin)
- [ ] Falls back to `localStorage` when filesystem unavailable (browser dev mode)
- [ ] Validates JSON against schema on read — invalid JSON triggers corruption recovery

### Corruption recovery
- [ ] If `terminal_profile.json` fails JSON parse: rename to `.corrupted.{timestamp}.json`, create fresh default profile, show toast: "Hardware profile was corrupted — reset to defaults."
- [ ] If schema validation fails (valid JSON, wrong shape): merge valid fields, reset invalid fields to defaults, save corrected profile
- [ ] Backup file created before each write (`terminal_profile.json.bak`)

### New terminal initialization
- [ ] When no `terminal_profile.json` exists: create default profile with auto-detect defaults
- [ ] Toast: "New terminal detected — hardware config initialized with defaults. Configure in F10 → Settings."
- [ ] Default printer path: empty string (OS-default printer)
- [ ] Default scale: `connection: "none"`
- [ ] Default scanner: `mode: "auto"`

### Three-phase commit for saves
- [ ] Save sequence: (1) backup existing → `.bak`, (2) write new JSON, (3) if successful, delete `.bak`
- [ ] If step 2 fails: abort SQLite transaction (caller's responsibility), restore from `.bak`, surface error
- [ ] Unit test: JSON write failure → old profile preserved, error surfaced
- [ ] Unit test: JSON write succeeds, `.bak` deleted

## Plan

1. Create `docs/terminal-profile-schema.md` — formal JSON schema specification
2. Create `ui/src/hooks/useTerminalProfile.ts` with `useTerminalProfile(terminalId)` hook
3. Implement read: Tauri `fs.readTextFile` → JSON.parse → schema validate → return
4. Implement write: JSON.stringify → Tauri `fs.writeTextFile` → return result
5. Implement corruption recovery: try/catch on parse → rename corrupted file → create default
6. Implement new terminal initialization: fs.exists check → create default if missing
7. Implement three-phase commit: backup → write → delete backup (or restore on failure)
8. Implement localStorage fallback for browser dev mode
9. Write unit tests

## Dependencies

- Tauri `fs` plugin for filesystem access (`@tauri-apps/plugin-fs`)
- `terminalId` from `TerminalManagementScreen` or Tauri `app.config` — Phase 0c assumes `terminalId` is available from existing infrastructure

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npx vitest run src/__tests__/useTerminalProfile.test.tsx` | all passing |
| Unit: read missing file → default profile created | Pass |
| Unit: read corrupted JSON → recovery, old file renamed | Pass |
| Unit: write JSON → file exists, content matches | Pass |
| Unit: three-phase commit: write fails mid-way → `.bak` restored, original intact | Pass |
| Unit: schema validation: invalid field type → reset to default | Pass |

## Residual / follow-ups

- Store-wide hardware template system (pre-configure defaults across terminals) is deferred to a follow-up ADR
- OS-specific device path validation (e.g., COM port format on Windows vs `/dev/` on Linux) is a future enhancement
- Printer connectivity test ("Test Print" button) is implemented in Phase 1 shared cards, not this hook

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar B, §Edge Case #1, #10, §Phase 0c
- `ui/src/features/terminals/TerminalManagementScreen.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
