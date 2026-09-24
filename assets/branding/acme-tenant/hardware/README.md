# Hardware Assets - ACME POS (acme-tenant)

This directory holds the brand's print assets. The receipts and invoices are
produced by the app; these files are the artwork that goes on them.

## Expected files

| File | Description | Spec |
|------|-------------|------|
| receipt-logo-58mm.png | 1-bit monochrome bitmap for 58mm thermal printers | 384x100 px |
| receipt-logo-80mm.png | 1-bit monochrome bitmap for 80mm thermal printers | 576x150 px |
| invoice-watermark.png | Subtle watermark for backend PDF invoices | 512x512 px |

## Generation

To generate receipt bitmaps from the master source icon:

```powershell
# Requires ImageMagick
magick convert assets/source-icon.png -resize 384x100! -threshold 50% assets/branding/acme-tenant/hardware/receipt-logo-58mm.png
magick convert assets/source-icon.png -resize 576x150! -threshold 50% assets/branding/acme-tenant/hardware/receipt-logo-80mm.png
```