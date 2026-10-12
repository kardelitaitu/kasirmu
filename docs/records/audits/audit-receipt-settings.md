# Audit — Receipt Settings (resto-pos → Receipts) & Settings → Business Defaults

Scope: the two receipt-settings surfaces reachable in the product, their write paths, and what actually reaches the printer.
Verdict: **the feature is functionally split in two, and one of the two halves (the newer, "scoped" one) does not reach the printer at all.** Below, findings are ordered by severity.

---

## 1. BLOCKER — the new `receipt_formats` layer is write-only (dead to printing)

There are **two** receipt-configuration stores:

| Layer | Stored in | Written by | Read by the printer? |
|---|---|---|---|
| Legacy `receipt.*` keys | `settings` KV, store-global | Restaurant Receipts screen (`setReceiptSettingsScoped`) | **Yes** |
| New `receipt_formats` rows | `receipt_formats` table (legal_entity / workspace / terminal) | Business Defaults card (`setReceiptLayoutScoped` / `setReceiptContentScoped`) | **No** |

Evidence — the print path reads only the legacy keys, in both apps:

- `crates/kasirmu-bridge/src/hardware.rs:282-317` (`read_receipt_config`, used by `print_sales_receipt`): paper width, show_currency, decimal separator, show_tax, footer, show_table_number all come from `Settings::get_receipt_*(conn)`. **There is no call to `effective_receipt_format` anywhere in this file.**
- `apps/mobile-tauri/src/commands/hardware.rs:259-278`: identical — legacy keys only.
- `crates/kasirmu-core/src/db/receipt_formats.rs:353` `effective_receipt_format` **is** used by `crates/kasirmu-bridge/src/receipt_format.rs:43,89,178` (the get/set commands) and the desktop/mobile `commands/receipt_format.rs` — i.e. it is read back **only to render the Business Defaults card to itself**, never by any print/receipt-render code.

Consequence: a manager who configures receipts in **Settings → Business Defaults** gets a success toast, a persisted row, and a card that reports the value back — but **the printed customer receipt ignores every one of those settings**, including `required_fields` (the statutory element checklist, `RECEIPT_ELEMENT_CODES`), `footer_text`, `show_tax`, `show_currency`, `decimal_separator`, paper width and margins. The statutory-numbering feature shipped in `crates/kasirmu-core/src/db/receipt_formats.rs` has no runtime effect.

## 2. HIGH — two surfaces own the same receipt concepts, with silent shadowing

Six settings exist on **both** surfaces under different stores:

`showTableNumber`, footer text, paper width, showTax, showCurrency, decimal separator.

- Restaurant screen (`ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx` `handleSave`, lines 651-824) writes the legacy layer via `setReceiptSettingsScoped`.
- Business Defaults card (`ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx`) writes the new layer via `setReceiptLayoutScoped` / `setReceiptContentScoped` under `ui/src/api/receipt-format.ts`.

Neither surface reads the other. Because the printer reads **only** the legacy layer (finding 1), editing the Business Defaults card is silently ineffective; editing the restaurant screen is effective but invisible to the Business Defaults card. There is no UI anywhere that shows both values side by side, so the two screens will routinely disagree and neither displays a warning.

## 3. HIGH — most restaurant-screen receipt controls are per-USER, not per-store

`RestaurantReceiptsScreen.tsx` `handleSave` persists **12 `resto_rcpt_*` keys as user preferences** (`setUserPreferencesScoped`) plus an additional mirror into `localStorage`. Those keys cover font size, logo/logo position, header title and header lines, showReceiptCode / DateTime / StaffName / ItemNotes, tax rate percent, and printer connection/paper size. (Pinned by `ui/src/__tests__/storageKeyPins.test.ts:76-90` — 13 keys.)

Impact: a receipt-format change is **personal to the signed-in user**. Two cashiers signed into the same terminal produce different-looking receipts, and a manager's "store-wide" configuration is invisible to staff who never opened the screen. The screen's own copy presents these as store settings; they are not.

Also note the write path is **non-atomic across three stores** — `handleSave` fires `setReceiptSettingsScoped` (legacy DB), `hw.save()` (terminal hardware profile), and `setUserPreferencesScoped` (user prefs) in a single `Promise.all`. If one rejects, the others may already have committed, and the single success/error toast cannot tell the user which half landed.

## 4. MEDIUM — the restaurant screen has no route to the new layer, and `terminalId` is not even passed

- `ui/src/features/sales/PosScreen.tsx:682-693` renders `<RestaurantReceiptsScreen onBack=… tablesEnabled=… />` — **no `terminalId` prop**, even though the screen's save path and hardware profile are terminal-scoped. Anything terminal-specific therefore falls back to a default.
- `RestaurantReceiptsScreen` never calls `setReceiptLayoutScoped`/`setReceiptContentScoped`, so the newer per-terminal/per-workspace scoping is unreachable from the restaurant flow. A restaurant manager simply cannot express "this terminal prints narrow, that one standard" through the UI they are given.

## 5. MEDIUM — test print does not exercise the real content pipeline

`handleTestPrint` builds a **hardcoded sample** (receipt number `01-01-260929-01-000042`; Nasi Goreng 25000 + Es Teh 5000; cash payment 35000) unrelated to the store's catalog, tax rate, or currency. It validates that bytes reach the printer, but **not** the receipt content pipeline. It also prints a cash payment of 35000 with `change: null` (cash exceeds total, yet no change line) — a sample-data inconsistency that a real sale would not produce.

## 6. MEDIUM — preview geometry and formatting are heuristics that can diverge from the printer

- `ui/src/features/restaurant/screens/receiptLogic.ts` `approxCols` uses density formulas (narrow `max(16, round(area/52*32))`; standard `max(20, round(area/74*44))`) with font multipliers (very_small 1.25, small 1.1, large 0.85). These are not measured glyph metrics, so the preview's column count and wrapping can differ from the real printer's font/DPI.
- `formatPrice` always uses **id-ID** separators (`.`) regardless of the `decimalSeparator` setting the same screen exposes — so the preview visibly ignores one of its own controls. (The print path does honor `decimal_separator`; the preview does not.)

## 7. LOW — duplication and doc drift

- `RECEIPT_ELEMENT_CODES` is defined twice: `crates/kasirmu-core/src/db/receipt_formats.rs:49` (Rust, the validated source of truth) and mirrored in `ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx` (TS). No generation/parity test, so the two can drift and the card can offer codes the backend rejects (or omit valid ones).
- `crates/kasirmu-bridge/src/receipt_format.rs` header comment states content is "read-only on this surface", but `set_receipt_content_scoped` exists and writes — stale doc.
- `ui/src/features/settings/sections/ReceiptSection.tsx` is dead (header comment DEAD 2026-09-15, no registry entry); harmless but should be removed to avoid a third, misleading entry point.
- FTL: no receipt strings were found in `settings.ftl`; the JSX ids (`restaurant-receipts-*`, `restaurant-save-success`, `settings-save-error`) live in another bundle — **unverified**, worth confirming so nothing renders as a raw id.

## 8. What is correct / worth keeping

- The `receipt_formats` schema and validation are sound: closed element enum, no duplicate codes, footer ≤500 chars, `decimal_separator` in {dot,comma,none}, paper width 20–120 mm, non-negative margins, `print_copies ≥ 0` (`crates/kasirmu-core/src/db/receipt_formats.rs`, migrations `20260925_receipt_formats.sql`, `20261006_receipt_hierarchy_code.sql`).
- Bridge gating is correct and consistently ordered: `get_receipt_format_scoped` requires `SETTINGS_READ`; `set_receipt_layout_scoped`/`set_receipt_content_scoped` require `SETTINGS_EDIT` **plus** a resource check on the location/primary-location, and fail closed when no primary location or legal entity is linked. `set_receipt_settings_scoped` correctly gates (scope-aware) **before** `open_store` (R10), so an out-of-scope caller gets `PermissionDenied`, not filesystem work.
- The manager-only gating of the restaurant Receipts button (`ui/src/features/restaurant/components/RestaurantSidebar.tsx:437-460`, badge "Manager+") is enforced.

---

## Recommended direction (for your decision — no fixes applied)

1. **Pick one owner for receipt config.** Either (a) make the print path resolve through `effective_receipt_format` and have the restaurant screen write `receipt_formats` (retire the parallel legacy UI), or (b) consciously keep the legacy layer as the printer's source of truth and remove/disable the Business Defaults receipt card until (a) ships. The current state — two UIs, one of which cannot work — is the worst option and is actively misleading.
2. **Move per-user `resto_rcpt_*` keys to store/terminal scope** for anything that changes the printed artefact (logo, header, font, show* toggles); keep only genuinely personal items (e.g. printer connection on a shared workstation) as prefs.
3. **Make the save atomic or surfaced**: sequential/transactional writes with per-part error reporting, instead of `Promise.all` + one toast.
4. Add a **parity test** for `RECEIPT_ELEMENT_CODES` and a test that asserts the print path consumes the same source the settings UI writes.

No files were modified. This is audit/review only.
---

## Re-verified 2026-10-11 (docs-auditor) — the blocker and three findings are CLOSED

This record was written before `b1a6bdf27` (*fix(receipt): converge restaurant receipt settings
on the scoped `receipt_formats` resolver*, 2026-09-30) and was filed into `docs/records/audits/`
on 2026-10-02 without a correction. Its §1 BLOCKER is therefore **false about the present**, and
four of the seven findings have moved. Nothing above is rewritten: the readings were correct on
the day they were taken, and the sections below say what is true now.

| § | Finding as written | State at 2026-10-11 |
|---|---|---|
| 1 | **BLOCKER** — the print path reads only the legacy `receipt.*` keys; `effective_receipt_format` is never called by any print code | **CLOSED.** Both print paths now resolve through the scoped resolver: `read_receipt_config_for_scope` calls `store.effective_receipt_format(terminal_id, None)` at `crates/kasirmu-bridge/src/hardware.rs:347`, and it is called by `print_sales_receipt` (`:278`) **and** `print_sales_receipt_scoped` (`:309`), plus `:715`. The mobile print path resolves the same way (`apps/mobile-tauri/src/commands/hardware.rs:321`). The `receipt_formats` layer is no longer write-only; the legacy keys remain as the documented fallback, not the sole source. |
| 2 | HIGH — two surfaces own the same concepts; the card's edits are silently ineffective | **ADDRESSED.** The restaurant screen now writes the scoped layer too: `setReceiptLayoutScoped` is imported (`RestaurantReceiptsScreen.tsx:15`) and called (`:1107`), with the workspace scope resolved on load (`:200-204`). Shadowing is reduced but not abolished: the legacy keys are still read as fallback, so a value present in both layers still resolves by precedence rather than by a visible rule. |
| 4 | MEDIUM — the restaurant screen has no route to the new layer, and `terminalId` is not passed | **PARTLY CLOSED — this is the one item still live.** The screen now accepts `terminalId?: string` (`:62`) and reads the context value (`:109`, `:117`), and it does call `setReceiptLayoutScoped`. **But the mount site still omits the prop**: `ui/src/features/sales/PosScreen.tsx:1389-1392` renders `<RestaurantReceiptsScreen onBack=… tablesEnabled=… />` with no `terminalId`, so the per-terminal layout scope is still unreachable from the restaurant flow. The plumbing exists; the call site does not supply it. |
| 7 | LOW — `crates/kasirmu-bridge/src/receipt_format.rs` header says content is "read-only on this surface" | **CLOSED — the stale comment is gone** (`grep 'read-only on this surface'` → 0 hits). `ReceiptSection.tsx` is also confirmed **absent** from the tree, so the third entry point was removed as recommended. |

**Verified unchanged** (re-derived at HEAD, not inherited): `RECEIPT_ELEMENT_CODES` is still
defined twice — the Rust source of truth and the TS mirror in
`ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx` — so §7's parity-test
recommendation still stands. `RestaurantReceiptsScreen.tsx:109` and `:117` show the prop being
read, and `storageKeyPins.test.ts` still pins the `resto_rcpt_*` user-preference keys, so §3's
per-user finding is unchanged.

**NOT re-measured:** the print output on real hardware, the `Promise.all` atomicity of
`handleSave` (§3), the preview geometry heuristics (§6), and whether a statutory
`required_fields` element now actually appears on a printed receipt — establishing that the
resolver is *called* is not the same as observing the printer consume it.
