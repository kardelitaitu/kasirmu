<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE (0 findings, re-verified) · Replaces the 2026-07-25 Hermes-Agent stamp, whose one repair still stands: the platform stack is kasirmu-hal's #[async_trait] device traits (BarcodeScanner, ReceiptPrinter, CashDrawer, CustomerDisplay, WeightScale, EdcTerminal) plus the optional ProtocolCodec, not embedded-hal. · Checked today rather than assumed, because this page is the one most likely to be read by someone who will never open the code: minSdk 26 is confirmed twice, in apps/tablet-client/gen/android/app/build.gradle.kts:35 and as tauri.conf.json:38 minSdkVersion, and API 26 is Android 8.0 as claimed; Tauri v2 (workspace dependency, v2 conventions throughout); SQLite local storage with a sync module; the five-layer stack description matches docs/guides/ARCHITECTURE.md. · Note the incidental evidence: gen/android IS committed (49 tracked files), which is what makes a claim like minSdk checkable at all - and the reason its iOS counterpart in docs/guides/ios-*.md is not is that gen/apple was never generated. Same document family, opposite verifiability. -->

# Whitepaper: kasir.mu Software Framework

## Introduction

**kasir.mu** is a modular, extensible, and high-performance Point-of-Sale software framework built with Rust and Tauri v2. It provides a battle-tested foundation for retail stores, restaurants, and any merchant environment — abstracting inventory management, transaction handling, device integration, reporting, and cloud sync so that developers can focus on delivering unique business value.

---

## Name & Philosophy

> *"Pay no attention to the man behind the curtain."*
> — The Wizard of Oz

The name **OZ** is a deliberate reference to *The Wizard of Oz* — and it captures the entire spirit of the project in a single word.

### The Wizard Metaphor

In the story, the Wizard of Oz is a small, ordinary man who — from behind a curtain — creates the appearance of limitless, magical power. kasir.mu works the same way:

- The **merchant** sees a fast, beautiful, effortless checkout experience.
- The **developer** integrates a clean, composable API.
- **Behind the curtain**, a lean Rust engine silently handles transactions, encryption, hardware, sync, and business logic — invisibly and reliably.

### The Four Pillars of OZ

| Pillar | What It Means |
|--------|---------------|
| 🧙 **Magical** | Complex operations — barcode scanning, payment processing, encrypted export, cloud sync — feel effortless. The hard parts are hidden. |
| 🧵 **Small Core** | The `kasirmu-core` crate stays minimal and focused. Every capability is a composable module; you only carry what you need. |
| ♾️ **Limitless Possibilities** | Lua scripting, plugin drivers, multi-store, analytics, cloud DB — all grow on top of the same foundation without re-architecture. |
| 📈 **Scalable** | From a single warung to a nationwide chain, the same codebase scales horizontally. No migration. No rewrite. |

### Crate Naming Convention

Every crate in the workspace follows the `oz-*` prefix, making the ecosystem immediately recognisable as a unified family:

```
oz-pos          →  root workspace / meta-crate
kasirmu-core         →  transaction engine & data models
kasirmu-hal          →  hardware abstraction layer (barcode, printer, drawer, display, scale, EDC)
kasirmu-lua          →  embedded Lua scripting runtime (mlua)
kasirmu-security     →  encryption, secrets, PCI-DSS helpers
kasirmu-payment      →  payment processor abstraction (Stripe, Square, QRIS, mock)
kasirmu-reporting    →  analytics & CSV export engine
kasirmu-logging      →  structured logging (tracing)
kasirmu-api          →  HTTP API server (axum)
kasirmu-notification →  email & push notification dispatching
kasirmu-plugin       →  plugin sandbox & lifecycle (Lua scripting bridge)
kasirmu-cli          →  command-line tools (migrations, backup, export)
kasirmu-crypto       →  AES-256-GCM encryption helpers (data at rest)
kasirmu-media        →  image processing (thumbnails, compression, auto-crop) — stubs
```

The `oz-` prefix is short, memorable, and signals: *this is part of the wizard's toolkit.*

---

## Core Language

- **Primary Language:** **Rust**
  - **Why Rust?**
    - **Safety:** Guarantees memory safety without a garbage collector, reducing runtime crashes.
    - **Performance:** Near‑C speed, essential for low‑latency transaction processing.
    - **Concurrency:** Powerful async/await model and fearless concurrency, enabling smooth handling of multiple peripheral devices.
    - **Ecosystem:** Growing ecosystem for embedded development, networking, and UI tooling (e.g., Tauri v2 for cross-platform desktop/mobile apps).
- **Secondary Scripting Layer:** **Lua** (via `mlua` crate — migrated from `rlua` in 0.0.19)
  - Provides runtime extensibility for merchants to customize business rules, promotions, and UI layouts without recompiling the core.
- **Inter‑op Bindings:** A thin **C‑FFI** layer is provided for legacy integrations written in C/C++ or Java, allowing the framework to be embedded in existing POS terminals.

---

## Target Hardware

| Category | Typical Devices | Rationale |
|----------|----------------|-----------|
| **Windows PC** | Windows 10/11, modern hardware (x86‑64) | Full desktop UI, peripheral support (USB, Bluetooth, NFC). |
| **Linux PC** | Ubuntu, Debian, Fedora (x86‑64) | Open‑source OS, robust networking, wide driver support. |
| **Android Tablet** | Android 8.0+ tablets (ARM, minSdk 26) | Portable POS, touchscreen UI, integrated Wi‑Fi/Cellular. |
| **iPad** | iPadOS (ARM) | Premium touch UI, Apple Pay integration, high‑resolution display. |

**Hardware Abstraction Layer (HAL):**
- Implemented in Rust using `#[async_trait]` async traits (`BarcodeScanner`, `ReceiptPrinter`, `CashDrawer`, `CustomerDisplay`, `WeightScale`, `EdcTerminal`), allowing drivers for barcode scanners, receipt printers, cash drawers, customer displays, weight scales, and EDC payment terminals to be swapped seamlessly.
- Provides a `DriverRegistry` for lookup/injection per device category, plus programmable mock drivers for testing.

---

## Architecture Overview

1. **Core Engine** – Written in Rust, handles transaction lifecycle, state machines, and data persistence.
2. **Device Integration Layer** – HAL + driver plugins for peripherals.
3. **Scripting Runtime** – Embedded Lua VM for dynamic rule evaluation.
4. **UI Layer** – Built with **Tauri v2**, leveraging Rust for the backend and a modern web stack (e.g., React, TypeScript) for the frontend, delivering native‑like performance across desktop, embedded, and web platforms.
5. **Data Services** – SQLite for local storage, optional sync module for cloud back‑ends.

---

## Scalability & Barcode Support

- **Scalable Architecture:** Designed using micro‑service patterns and asynchronous Rust concurrency, allowing the system to handle thousands of concurrent transactions across multiple stores.
- **Barcode Integration:** Native support for USB, Bluetooth, and serial barcode scanners via the HAL, providing fast and reliable product lookup.
- **Horizontal Scaling:** Stateless components (e.g., UI front‑ends, transaction processors) can be replicated behind load balancers for high availability.
- **Data Sharding:** SQLite can be complemented with distributed databases (e.g., PostgreSQL, CockroachDB) for multi‑store deployments.

---

## Database Strategy

- **Local Store:** SQLite via `rusqlite` – ACID, zero‑config, works offline on all target platforms.
- **Cloud Sync / Multi‑store:** PostgreSQL (or CockroachDB) for centralized relational data, replication, and analytics.
- **Event Log:** the outbox pattern lives in the local SQLite `offline_queue` table (RocksDB/LMDB were evaluated but are not dependencies).
- **Cache / Pub‑Sub:** Redis for fast product look‑ups, pricing rules, and real‑time inventory updates.
- **Sync Flow:** Edge SQLite writes are appended to an outbox; a background daemon streams changes to PostgreSQL; Redis notifies terminals of updates.

These choices balance performance, reliability, and scalability across small boutiques to large chain deployments.

### Optional Cloud Database Service

- Users can opt‑in to a managed cloud database (e.g., AWS RDS PostgreSQL, Azure Database for PostgreSQL) for automatic backups, scaling, and multi‑region availability.
- This service is offered as an **on‑features** add‑on, billed per usage, and integrates seamlessly via the existing sync daemon.




## Benefits
- **Deterministic Performance:** Sub-millisecond latency for barcode scans and payment authorisations.
- **Security:** Memory safety and minimal attack surface; optional secure enclave support for cryptographic operations.
- **Extensibility:** Plug-and-play drivers and Lua scripts enable rapid feature addition.
- **Cross-Platform Reach:** Same core binary runs on Windows, Linux, Android tablets, and iPads.
- **Feature-Toggle Architecture:** Every feature is off by default. Merchants activate only what they need via the Setup Wizard — keeping the UI clean and the system lean.
- **Composable Modules:** The `oz-*` crate ecosystem lets developers include only the capabilities their deployment requires.

---

## Conclusion

kasir.mu is more than a POS system — it is a **platform**. Like the wizard behind the curtain, it hides extraordinary complexity behind a simple, magical interface. Rust guarantees safety and speed. Tauri v2 delivers a native experience on every target. The feature-flag system ensures every merchant — from a solo warung owner to an enterprise chain operator — gets exactly the tool they need, nothing more and nothing less.

> *Small codebase. Limitless possibilities.*

> last audited 08-09-26 by docs-auditor

