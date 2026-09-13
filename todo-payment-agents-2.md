# Orchestrator Agent 2: Hardware Abstraction Layer & LAN EDC Drivers

<!-- Partial stamp: 2026-09-13 · DSH · DO NOT RE-EXECUTE PHASES 2.0–2.1.
The driver tree LANDED on 31-08-26 with a different layout than this
fence: `drivers/edc/{mod,wired,wireless}.rs` + `drivers/edc/protocol/
{pax,ingenico,verifone}.rs` + three test files, and the mock lives in
`drivers/mock.rs::MockEdcTerminal` (fails closed until set_success) per
the AGENTS.md mandatory-mock rule, not `edc/mock.rs`. HardwareConfig in
`bootstrap.rs` carries the EDC wiring. What does NOT exist: the
`test_edc_connection_scoped` IPC of Phase 2.2 (zero references tree-wide).
That single item remains open; it touches the bridge campaign's hot zone
(desktop-client commands), so re-scope it there before acting. -->

**Document:** `todo-payment-agents-2.md`  
**Role:** Orchestrator Agent 2 (Peripherals & Embedded Hardware Architect)  
**Goal:** Implement real and mock hardware driver protocols for LAN/USB Electronic Data Capture (EDC) card terminals (PAX POS-link, Ingenico, Verifone) and expose terminal-scoped override configurations in `oz-hal` and `oz-core`.

**Target Crate:** `crates/oz-hal/` & `crates/oz-core/src/terminal_override.rs`  
**Sibling Documents:**
- [`todo-payment-agents-1.md`](./todo-payment-agents-1.md) (Agent 1 — Cloud Gateway, Midtrans API & Webhooks)
- [`todo-payment-agents-3.md`](./todo-payment-agents-3.md) (Agent 3 — Checkout UI, Dynamic QR & Payment Polling)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(payment-hal): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `crates/oz-hal/src/drivers/edc/`
     - `pax.rs` (NEW)
     - `ingenico.rs` (NEW)
     - `mock.rs`
     - `wired.rs` & `wireless.rs`
   - `crates/oz-hal/src/traits/edc.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit cloud server webhook code (Owned by Agent 1).
   - DO NOT edit UI checkout screens (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Inspect `crates/oz-hal/src/traits/edc.rs` and `drivers/edc/mod.rs`.

### Phase 2.1: Implement Protocol Codecs & Network Sockets
- [ ] Implement framing, checksum, and command packets for PAX POS-link over TCP/IP socket.
- [ ] Implement sale initiation, amount encoding (`i64` minor units), card tap/insert wait loop, and approval/decline response parsing.
- [ ] Provide robust mock EDC driver in `drivers/edc/mock.rs` to allow testing without physical terminals.
- [ ] Verify: `cargo test -p oz-hal edc`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-hal): implement PAX POS-link EDC driver and mock test fixture"
  ```

### Phase 2.2: Terminal-Scoped Hardware Overrides
- [ ] Wire EDC IP and port configuration into `HardwareConfig` and `platform_startup::hardware`.
- [ ] Implement IPC command `test_edc_connection_scoped` in `desktop-client`.
- [ ] Verify: `cargo check --workspace`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-hal): wire EDC hardware configuration and test connection IPC"
  ```
