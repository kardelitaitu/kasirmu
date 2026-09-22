# qris-core

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)](../../LICENSE)

Parse, build, decode, and render **QRIS** (Quick Response Code Indonesian Standard)
QR payment payloads in Rust.

QRIS is Indonesia's national QR payment standard, built on the
[EMVCo Merchant-Presented Mode (MPM)](https://www.emvco.com) TLV specification.

## Features

- **Parse** any QRIS string — extracts NMID, merchant details, amount, tip/fee block
- **Build** a QRIS payload from NMID + merchant details, with optional amount and convenience fees
- **Decode** a QR code image and parse the QRIS string (`decode` feature)
- **Render** a QRIS payload to PNG or SVG (`render` feature), with optional logo overlay
- **CRC-16/CCITT** verified on parse and recalculated on every serialisation
- **NMID parsing** — splits into country code, acquirer code, merchant number
- **MCC lookup** — human-readable descriptions for 100+ Merchant Category Codes

## Quick start

```toml
[dependencies]
qris-core = { workspace = true }

# Enable QR image decoding and rendering:
# qris-core = { workspace = true, features = ["decode", "render"] }
```

### Flow 1 — Read a QR sticker, extract the NMID and merchant details

```rust,no_run
use qris_core::QrisPayload;

// From an image file (requires `decode` feature)
let payload = QrisPayload::from_image("merchant_sticker.png")?;
println!("NMID:     {}", payload.nmid());
println!("Merchant: {}", payload.merchant_name);
println!("City:     {}", payload.merchant_city);

// Or from a raw QRIS string
let payload = QrisPayload::parse("000201010211...")?;
```

### Flow 2 — Build a dynamic QR from NMID and render to PNG

```rust,no_run
use qris_core::QrisBuilder;

let png = QrisBuilder::new()
    .nmid("ID1020001234567")
    .merchant_name("Warung Sayur Bu Sugeng")
    .merchant_city("Kab. Demak")
    .merchant_category_code("5812")
    .amount("50000")       // IDR 50,000 — makes it a dynamic QR
    .build()?
    .to_qr_png(300)?;     // requires `render` feature

std::fs::write("dynamic.png", png)?;
```

### Static → Dynamic conversion (common POS pattern)

```rust,no_run
let static_payload = QrisPayload::from_image("sticker.png")?;

// For each transaction:
let dynamic_png = static_payload
    .clone()
    .into_dynamic("75000")?
    .to_qr_png(300)?;
```

## Feature flags

| Feature  | Default | Adds              | Enables |
|----------|---------|-------------------|---------|
| `decode` | off     | `rqrr`, `image`   | `QrisPayload::from_image`, `from_bytes` |
| `render` | off     | `qrcode`, `image` | `QrisPayload::to_qr_png`, `to_qr_svg`, `to_qr_png_with_logo` |
| `serde`  | off     | `serde`           | `Serialize` / `Deserialize` on all data types |

## MSRV

Rust **1.88** or newer (matches the workspace MSRV of the oz-pos project).

## License

**Proprietary and Confidential — Copyright (c) 2024-2026 kasir.mu Contributors / All Rights Reserved.**

Part of the proprietary kasir.mu workspace: this crate is not published and is not open
source. See the repository [LICENSE](../../LICENSE) for terms and restrictions.
