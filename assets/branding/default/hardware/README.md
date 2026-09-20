<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (1 observe) · O1: default README line 5 has typo 'ssets/source-icon.png' (missing 'a') + malformed code fence (line 19 backtick lacks language); cosmetic, not a code-claim error · verified accurate: assets/source-icon.png exists at repo root; all 3 expected hardware files (receipt-logo-58mm/80mm.png, invoice-watermark.png) present for default; acme/beta have receipt logos; generation commands match sync-branding.ps1:415-416; manifest asset keys (receiptLogo58mm/80mm) present -->

# Hardware Assets — OZ-POS (default)

This directory holds specialized bitmap assets for thermal receipt printers
and invoice watermarks. These are generated from the master source icon
(ssets/source-icon.png) via the whitelabel pipeline.

## Expected files

| File | Description | Spec |
|------|-------------|------|
| 
eceipt-logo-58mm.png | 1-bit monochrome bitmap for 58mm thermal printers | 384×100 px |
| 
eceipt-logo-80mm.png | 1-bit monochrome bitmap for 80mm thermal printers | 576×150 px |
| invoice-watermark.png | Subtle watermark for backend PDF invoices | 512×512 px |

## Generation

To generate receipt bitmaps from the master source icon:

`powershell
# Requires ImageMagick
magick convert assets/source-icon.png -resize 384x100! -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-58mm.png
magick convert assets/source-icon.png -resize 576x150! -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-80mm.png
`

> last audited 24-07-26 by Hermes-Agent
