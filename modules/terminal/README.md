<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Full re-audit; the 2026-07-22-31-08 marker is retained as original evidence below. · Verified: §Lifecycle correctly describes all three hooks as stubs (log + `Ok(())`) with matching log strings; the crate carries `repository.rs`/`service.rs` (`TerminalRepository`/`TerminalService`) with no `tests/boundary_contract.rs`, exactly as the README states; the manifest block matches `modules/terminal/manifest.json` (perms `terminal:view`/`terminal:edit`). This file is one of the few module READMEs with no owned-path section, so there is no path to re-derive. · NOT re-measured: the terminal heartbeat/registration behaviour. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim:

  [Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · modules/terminal/src/lib.rs has TerminalModule (line 47); modules/terminal/manifest.json present with deps [] + permissions [terminal:view,terminal:edit] matching the Module Info table · Kernel::register/load_all/start_all code matches platform/kernel API · no owned-path claims to diverge · RE-AUDITED 31-08 by docs-auditor: manifest.json re-verified (id terminal, v1.0.0, deps [], perms view/edit); on_load/on_start/on_stop are stubs (log + "future phases will register handlers") — Lifecycle section corrected to say so (previously implied they validate/prepare/clean up); crate has repository.rs/service.rs (TerminalRepository/TerminalService) NOT wired into runtime and NOT parity-tested (no tests/boundary_contract.rs, unlike tax/inventory); normalized footer]
-->

# Terminal Module

**Status:** Active (Phase 2 — Module Extraction)

## Overview

The Terminal module manages registered POS terminals: device registration, heartbeat/ping tracking, and terminal configuration.

## Module Info

| Field        | Value                  |
|--------------|------------------------|
| ID           | `terminal`             |
| Version      | `1.0.0`                |
| Dependencies | `[]`                   |
| Permissions  | `terminal:view`, `terminal:edit` |

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are currently **stubs** — each logs a message and returns `Ok(())`; none touch the database or event bus yet:

1. **`on_load`** — logs "validating configuration" (a future phase will register event handlers to track terminal activity)
2. **`on_start`** — logs "ready for terminal operations"
3. **`on_stop`** — logs "cleaning up"

The crate also contains `repository.rs` (`TerminalRepository`) and `service.rs` (`TerminalService`), but these are **not yet wired into the runtime** — and unlike the tax/inventory modules there is no `tests/boundary_contract.rs` pinning them to the live path.

## Registration

Registered with the kernel during application setup:

```rust
use modules_terminal::TerminalModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(TerminalModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "terminal",
  "name": "Terminal",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["terminal:view", "terminal:edit"]
}
```

> last audited 11-10-26 by docs-auditor
