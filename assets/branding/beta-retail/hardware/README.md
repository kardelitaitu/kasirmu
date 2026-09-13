<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, claims verified) · assets/source-icon.png exists at repo root; expected hardware files receipt-logo-58mm.png + receipt-logo-80mm.png present; generation commands match sync-branding.ps1:415-416; beta-retail manifest omits invoiceWatermark key but README only documents expected spec, not asserting file presence -->

# Hardware Assets - Beta Retail (beta-retail)

This directory holds specialized bitmap assets for thermal receipt printers
and invoice watermarks. These are generated from the master source icon
(assets/source-icon.png) via the whitelabel pipeline.

## Expected files

| File | Description | Spec |
|------|-------------|------|
| receipt-logo-58mm.png | 1-bit monochrome bitmap for 58mm thermal printers | 384x100 px |
| receipt-logo-80mm.png | 1-bit monochrome bitmap for 80mm thermal printers | 576x150 px |
| invoice-watermark.png | Subtle watermark for backend PDF invoices | 512x512 px |

## Generation

To generate receipt bitmaps from the master source icon:

`powershell
# Requires ImageMagick
magick convert assets/source-icon.png -resize 384x100 -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-58mm.png
magick convert assets/source-icon.png -resize 576x150 -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-80mm.png
`

> last audited 24-07-26 by Hermes-Agent
