---
name: tauri-ipc
description: Tauri v2 command and front-end API conventions for kasir.mu — where Rust commands live, how they are registered, and how the React/TypeScript front-end calls them. Use when adding a new IPC surface or wiring a new feature end-to-end.
---

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: ACCURATE (rev 3 — golden rules 1 and 2 rewritten to name BOTH shells and new rule 7 added: a command only one shell registers is a parity gap that only scripts/verify-ipc-parity.py can see; the checklist's registration item and pitfall 8 now say the same; Layout shows apps/mobile-tauri. Learned from f49170d3d, where the avatar feature shipped desktop-only while the shared PosScreen restaurant sidebar, which the tablet shell also mounts, invoked it) · prior: 2026-09-03 · DSH · status: ACCURATE (rev 2 — command example rewritten to the real add_line_scoped(session_token, args, state) pattern with resolve_session + permission check; registration example now uses the module-qualified commands::<mod>:: names and real reports commands (get_daily_revenue_scoped etc. — daily_summary/export_csv do not exist); api wrapper example corrected to the real sales.ts pattern: loggedInvoke from utils/logged-invoke (bare @tauri-apps imports inside api/ are allowed but unused there); TS error guidance corrected — AppError is serde-tagged with a camelCase kind discriminator, there is no AppError class to instanceof on the TS side; hook example shadowing bug fixed; test checklist item aligned with the sibling *_tests.rs convention (51 such files under commands/)) · prior: 2026-08-31 docs-auditor rev (F1 fictional payments.rs removed, ~47 modules, *_scoped ADR #7 documented, per-domain api files) · STAMPS MERGED INTO THIS ONE on 2026-09-08 (§13: replace, do not stack) — carrying forward the superseded audits’ evidence verbatim:  ·· [2026-08-31] · docs-auditor · status: ACCURATE (F1 repaired + scoped-IPC documented) · F1 FIXED: Layout/registration examples no longer reference the fictional payments.rs (payment commands are split, e.g. void.rs/gift_cards.rs); noted ~47 command modules, not 5 · NEW: golden rule 6 documents the *_scoped convention (ADR #7 Data Scope Guard) — the dominant pattern at HEAD (101 files) previously undocumented; registration example now shows pos::start_sale_scoped/complete_sale_scoped (verified at HEAD) · FIXED: 'pos.ts is the only entry point' corrected to per-domain ui/src/api/<feature>.ts (matches rule 3; real files currency.ts/edc.ts/hardware.ts/…); sales::→pos:: · verified accurate: commands/ dir, pos.rs/inventory.rs/hardware.rs/reports.rs present, AppError in error.rs, invoke_handler(generate_handler![…]) in lib.rs, State<AppState> + async Result<T,AppError> convention -->
# Tauri IPC & Front-end API

kasir.mu uses Tauri v2 to bridge Rust and a React/TypeScript front-end. The IPC boundary is the single most important architectural seam in the app: every command is a contract, and every contract must be in the right place.

---

## When to use

- Adding a new feature that needs to cross the Rust ↔ React boundary.
- Defining a new Tauri command on the backend.
- Calling a backend command from a React component or hook.
- Reviewing the IPC surface for errors or inconsistencies.
- Adding a new event the front-end should listen for.

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Rust commands live in `apps/<shell>-tauri/src/commands/<feature>.rs`** — `apps/desktop-tauri` and `apps/mobile-tauri` (the tablet shell). | One folder per feature per shell, easy to find. |
| 2 | **A command is registered in BOTH shells' `lib.rs`**, or the shell that lacks it is recorded in `scripts/ipc-parity-allowlist.json`. | Registration lives next to `Builder::default()` in each `invoke_handler!` list, and the two lists are not the same list. |
| 3 | **Front-end calls go through `ui/src/api/` (per-domain files).** Components never call `invoke()` directly. |
| 4 | **Every command is `async fn` and returns `Result<T, AppError>`.** | Errors are typed on both sides; no stringified blobs. |
| 5 | **Every command takes its dependencies via `tauri::State<...>`.** | No globals, no thread-locals. |
| 6 | **Multi-store commands ship a `*_scoped` variant** that resolves the store from the session token (ADR #7 Data Scope Guard). Register and call the scoped form; the unscoped form is deprecated and largely unregistered at HEAD. | Tenant isolation is enforced at the command boundary, not in the UI. |
| 7 | **A command only ONE shell registers is a parity gap, and only `python scripts/verify-ipc-parity.py` can see it.** | `ui/` is shared by both shells, so a screen the tablet mounts can call a command only the desktop registered. The registration ratchet sweeps just the names a shell already registers, so a command that was never registered produces no row and no red. |

---

## Layout

├── apps/desktop-tauri/              # the desktop shell
├── apps/mobile-tauri/               # the tablet shell — the same commands/ layout
│                                    #   below, but its OWN lib.rs registration list;
│                                    #   neither list contains the other
└── src/
    ├── main.rs                      # thin entry point — calls kasirmu_app_lib::run()
    ├── lib.rs                       # the run() function: app setup + command registration
    └── commands/
        ├── mod.rs                   # pub use for each command module
        ├── pos.rs                   # start_sale_scoped, add_line_scoped, complete_sale_scoped
        ├── inventory.rs             # lookup_sku_scoped, adjust_stock_scoped
        ├── hardware.rs              # open_cash_drawer(_scoped), print_receipt(_scoped)
        ├── reports.rs               # get_daily_revenue_scoped, get_menu_engineering_scoped, …
        └── …                        # ~64 modules total (currencies, exchange_rates,
                                     #   gift_cards, kds, license, audit, …). There is
                                     #   NO payments.rs — payment commands are split
                                     #   (e.g. void.rs, gift_cards.rs).
```

```
ui/
└── src/
    ├── api/
    │   └── (per-domain files)       # typed invoke() wrappers, one per feature
    ├── features/
    │   ├── sales/
    │   │   ├── CartScreen.tsx
    │   │   └── usePosState.ts       # uses pos.ts, not invoke()
    │   └── inventory/
    │       └── StockScreen.tsx
    └── components/                  # presentational, no invoke()
```

---

## Defining a Rust command

```rust
 // apps/desktop-tauri/src/commands/pos.rs

use serde::{Deserialize, Serialize};
use tauri::State;
use kasirmu_core::{Money, Sku};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct AddLineArgs {
    pub cart_id: CartId,
    pub sku: Sku,
    pub qty: i64,
}

#[derive(Debug, Serialize)]
pub struct AddLineResult {
    pub line_id: LineId,
    pub line_total: Money,
}

#[tauri::command]
pub async fn add_line_scoped(
    session_token: String,
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    // Scoped commands resolve the store from the session first (ADR #7),
    // then verify the caller holds the required permission.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SALES_PROCESS).await?;
    let cart = /* resolve cart through state.db_manager … */;
    let line = cart.add_line(args.sku, args.qty)?;
    Ok(AddLineResult { line_id: line.id, line_total: line.total() })
}
```

**Rules:**
- Argument struct is `*Args`, return type is `*Result`. Keeps the call site readable.
- `State<'_, AppState>` is the only way to reach the database, services, or hardware. No module-level `static`s.
- Scoped commands take `session_token: String` **first**, call `state.resolve_session(&session_token)?`, and check the required permission before touching data.
- Errors are `AppError`, defined once in `apps/desktop-tauri/src/error.rs` and re-exported. Don't return `String` errors.
- Commands are pure: they take inputs, return outputs, and use `State` for the world. No hidden state.

---

## Registering in `lib.rs`

```rust
 // apps/desktop-tauri/src/main.rs

mod commands;
mod error;
mod state;

fn main() {
    kasirmu_app_lib::run();
}
```

```rust
 // apps/desktop-tauri/src/lib.rs

use tauri::Builder;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .manage(AppState::new()?)
        .invoke_handler(tauri::generate_handler![
            commands::pos::start_sale_scoped,
            commands::pos::add_line_scoped,
            commands::pos::complete_sale_scoped,
            commands::inventory::lookup_sku_scoped,
            commands::hardware::open_cash_drawer_scoped,
            commands::hardware::print_receipt_scoped,
            commands::reports::get_daily_revenue_scoped,
            commands::reports::get_menu_engineering_scoped,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Rules:**
- Commands are registered **module-qualified** (`commands::<feature>::<name>`) and grouped by feature module in the `generate_handler!` list.
- Mobile entry point is gated with `#[cfg_attr(mobile, ...)]` so the same code runs on desktop and mobile.
- `AppState::new()` must be fallible (DB open, migrations, etc.) — surface errors with `?` before `.manage(...)`.

---

## Calling from React — one wrapper per command, in the domain's `ui/src/api/<feature>.ts`

```ts
// ui/src/api/sales.ts

import { loggedInvoke } from '@/utils/logged-invoke';
import type { CartId, LineId, Money, Sku } from '@/types/domain';

export interface AddLineArgs {
  cartId: CartId;
  sku: Sku;
  qty: number;
}

export interface AddLineResult {
  lineId: LineId;
  lineTotal: Money;
}

export async function addLine(sessionToken: string, args: AddLineArgs): Promise<AddLineResult> {
  return loggedInvoke<AddLineResult>('add_line_scoped', { sessionToken, args });
}
```

**Rules:**
- One TypeScript function per Rust command. Names are camelCase; Rust is snake_case — `invoke()` does the conversion automatically.
- Route calls through `loggedInvoke` (`ui/src/utils/logged-invoke.ts`) so every IPC call gets timing/telemetry logging. Components and hooks never import `@tauri-apps/api/*` — that's the enforceable line; `ui/src/api/tauri.ts` is the sanctioned re-export surface.
- Every TypeScript wrapper has explicit `*Args` and `*Result` interfaces. Don't use `any` or `unknown` to skip the type.
- All errors are `Result<T, AppError>`; Tauri serializes `AppError` with a camelCase `kind` discriminator (and a typed `subKind` on core/hardware failures) — branch on those fields, never on message strings.
- Domain types (`CartId`, `Sku`, `Money`, …) live in `ui/src/types/domain.ts` and are imported everywhere.

---

## React hooks consume the api layer, not `invoke()`

```tsx
// ui/src/features/sales/usePosState.ts

import { useState, useCallback } from 'react';
import { addLine as addLineApi } from '@/api/sales';
import type { Cart, CartId, Sku } from '@/types/domain';

export function usePosState(cartId: CartId) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLine = useCallback(async (sessionToken: string, sku: Sku, qty: number) => {
    try {
      await addLineApi(sessionToken, { cartId, sku, qty });
      // refetch cart, or trust the lineTotal and optimistically update
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    }
  }, [cartId]);

  return { cart, error, addLine };
}
```

**Rules:**
- Hooks are the only place that knows how to talk to the api layer. Components consume hooks.
- Components never import from `@tauri-apps/api/core` — that's the line we don't cross.
- Async errors are surfaced via local state, not thrown. Throw only in test code or top-level error boundaries.

---

## Events from backend to front-end

Use Tauri events for streaming or push-style updates (e.g., barcode scan, printer status, sync progress).

```rust
// apps/desktop-tauri/src/commands/hardware.rs

use tauri::{AppHandle, Emitter};  // <-- Emitter trait is required for .emit()

#[tauri::command]
pub async fn subscribe_barcode_scans(app: AppHandle) -> Result<(), AppError> {
    let app = app.clone();
    tokio::spawn(async move {
        let mut rx = /* open barcode channel */;
        while let Some(scan) = rx.recv().await {
            let _ = app.emit("barcode:scan", &scan);
        }
        Ok::<_, AppError>(())
    });
    Ok(())
}
```

```ts
// ui/src/api/hardware.ts

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BarcodeScan } from '@/types/domain';

export async function onBarcodeScan(
  handler: (scan: BarcodeScan) => void,
): Promise<UnlistenFn> {
  return listen<BarcodeScan>('barcode:scan', (e) => handler(e.payload));
}
```

**Rules:**
- Event names are `domain:verb` (kebab/snake allowed; be consistent). Example: `barcode:scan`, `sale:completed`, `sync:progress`.
- Always return the `UnlistenFn` from `listen()`. Components must call it in cleanup to avoid leaks.
- Payload types are defined in `ui/src/types/domain.ts` and shared with the backend via JSON.

---

## Adding a new command — checklist

- [ ] Rust: define `*Args` and `*Result` types in `commands/<feature>.rs`.
- [ ] Rust: write the `#[tauri::command] async fn` taking `State<'_, AppState>`.
- [ ] Rust: register the command in `lib.rs`'s `invoke_handler!` list — in **both** `apps/desktop-tauri` and `apps/mobile-tauri`, or allowlist the shell that lacks it in `scripts/ipc-parity-allowlist.json` with its reason. Then run `python scripts/verify-ipc-parity.py`.
- [ ] TS: define `*Args` and `*Result` interfaces in `ui/src/api/<feature>.ts`.
- [ ] TS: write the `invoke<>('cmd_name', { args })` wrapper.
- [ ] TS: create a hook in `ui/src/features/<feature>/` that calls the wrapper.
- [ ] Tests: add unit tests in the sibling `commands/<feature>_tests.rs` (wired via `#[cfg(test)] #[path = ...] mod tests;` — see `rust-backend`), using a mock `AppState`.
- [ ] Tests: add a component test in `ui/src/__tests__/` for the hook.
- [ ] A11y: any UI changes pass `eslint-plugin-jsx-a11y`.
- [ ] I18n: any user-visible strings go through `@fluent/react`.

---

## Common pitfalls

1. **Calling `invoke()` from a component** to "save time." It works, but it makes the API surface un-mockable for tests and hides the call from code search.
2. **Returning `String` errors** from a command. Front-end has to string-match. Use `AppError` with variants.
3. **Putting a command in `mod.rs` of `commands/`** instead of a sub-module. Bloats `mod.rs` and breaks the feature-folder convention.
4. **Forgetting `tauri::generate_handler!`** — the command compiles but is not callable at runtime. Easy to miss; lint with a startup smoke test.
5. **Reusing a domain type from `kasirmu-core` directly in a command's `*Result`** without wrapping. Tauri serializes via JSON, and internal fields may include `i64` IDs that the JS side can't represent. Wrap with a serializable `Id(String)` or similar.
6. **`State<'_, T>` borrowing across an `await`** — fine on the outer `async fn`, but if you call helper functions, pass `&T` from the state, not the `State` guard.
7. **Returning raw `Money.minor_units` into the UI without a renderer.** The number is correct but `123456` cents reads as "123,456" in the UI. Render through the front-end's `formatMoney` helper (`ui/src/types/domain.ts`).
8. **Registering a command in one shell only.** `ui/` is shared, so a screen the tablet mounts can invoke a command only the desktop registered; the invoke then rejects at runtime, and if the caller swallows the rejection (`.catch()`) it fails *silently* — which is how the avatar read shipped broken on the tablet while every other gate stayed green. The registration ratchet cannot see it, because it sweeps only the names a shell already registers. `python scripts/verify-ipc-parity.py` is the only instrument that walks the UI's invoke sites: run it after adding any command. Adding the missing shim is usually ledger-neutral — when the bridge module's own file names a permission, the sweep reads a shim that delegates to it as gated.

---

## See also

- **[`rust-backend`](../rust-backend/SKILL.md)** — defines the `kasirmu-core` types (`Money`, `CartId`, `Sku`, …) that cross this IPC boundary. Read it before adding a new command so you know how the types are meant to be constructed and serialized.
- **[`hal-drivers`](../hal-drivers/SKILL.md)** — the hardware drivers and `DriverRegistry` that hardware-touching commands (barcode scan, cash drawer, receipt print) reach into. The wiring pattern `State<'_, AppState>` -> `DriverRegistry::scanner(id)` lives in both skills; keep them in sync.
- **[`ui-components`](../ui-components/SKILL.md)** — the React/TypeScript side of this contract. Every command you add here needs a `ui/src/api/<feature>.ts` wrapper and a hook in `ui/src/features/<feature>/`.
- **[`project-scaffold`](../project-scaffold/SKILL.md)** — the CI matrix and branch policy that gate this code into release.

---

> last audited 19-09-26 by Budak-Korporat
