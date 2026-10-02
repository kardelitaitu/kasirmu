<!-- Audit stamp: 2026-09-29 · docs-auditor · status: SUBSTANTIALLY IMPLEMENTED, 1 appendix item not landed — no repairs needed · Audited on branch 0.0.40. Neither this plan nor its review carried an audit stamp or footer, so nothing had ever checked them. This is an 801-line implementation plan that has clearly been acted on, and the useful audit question is which parts of it became code. Answered by measurement: IMPLEMENTED — the `product_images` table landed at `crates/kasirmu-core/migrations/20260901_product_images.sql:26` and was carried into the base schema at `crates/kasirmu-core/migrations/20260813_init.pg.sql:2784`, which is exactly the appendix's A.4 step and matches the "Spec 0046b (migration 20260901_product_images)" annotation the expected-tables test in `crates/kasirmu-core/src/migrations_tests.rs` carries; A.1 landed, `SubscriptionTier::max_products()` is at `crates/kasirmu-core/src/entitlements.rs:191`; A.3 landed, `QuotaError` is at `crates/kasirmu-core/src/subscription/quota.rs:17`; and the central architectural premise — website-as-source-of-truth for tier limits — is real, `website/src/content/pricing/en.ts` exists and is the file the plan names as the place to edit. NOT IMPLEMENTED — A.2, `supports_product_images()`, does not exist anywhere: `crates/kasirmu-core/src/entitlements.rs` has no image-entitlement helper, and a repo-wide symbol search returns nothing. One appendix item of four is outstanding, and the image-capability check the plan wanted is either named differently or was never built. Recorded, not repaired: a missing entitlement helper is a code gap, and inventing one would be exactly the "code drift — flag and stop" case rather than a doc fix. · LEFT ALONE deliberately: the 801-line body, including every unchecked phase checkbox in the Implementation Checklist, the storage/cost/effort estimates, and the sample SQL and API shapes. This is a dated plan, and a plan whose checkboxes someone ticked or unticked without evidence would be worse than one left honestly open. · The companion review is `docs/archived/plan-product-images-review.md`, audited in the same pass. · No stamp or footer existed on this file before this pass. -->

# Plan: Product Image Storage System

## Overview

Store product images on the server's persistent NVMe volume (6 GB), served through the existing Rust cloud server. Limits are **account-bound** (per tenant), not per terminal.

**Key Design Decision:** All image processing (resize to 512×512, WebP conversion at 40% quality) happens on the **client device** before upload. The server stores the final 10-15 KB image as-is — no server-side processing needed.

## Architecture: Website as Single Source of Truth

The **website** (`website/src/content/pricing/en.ts`) is the canonical source for all tier definitions. The Rust server and clients read from it.

### Why Website-First?

1. **Pricing is a business decision** — marketing defines limits, not engineers
2. **One place to update** — change limits in `en.ts`, everything else follows
3. **Visible to stakeholders** — pricing page IS the source, not hidden in Rust code
4. **Type-safe** — TypeScript types enforce consistency across tiers

### How It Works

```
website/src/content/pricing/en.ts  (CANONICAL SOURCE)
         │
         ├──→ website/src/pages/[locale]/pricing.astro  (rendered page)
         ├──→ website/src/components/PricingGrid.tsx      (checkout flow)
         ├──→ crates/oz-core/src/subscription.rs          (server enforcement)
         └──→ ui/src/features/products/                   (client limits)
```

### Current Tier Definitions (en.ts)

| Tier | Stores | Registers | Warehouses | Staff | Sales History | Products (NEW) | Images Synced (NEW) |
|------|--------|-----------|------------|-------|---------------|----------------|---------------------|
| Free | 1 | 1 | 1 | 1 | 3 months | 200 | No (local only) |
| Plus | 1 | 2 | 2 | 5 | 1 year | 500 | Yes |
| Pro | 2 | 5 | 3 | 20 | 5 years | 1,000 | Yes |
| Premium | 5 | Unlimited | Unlimited | 50 | Unlimited | 10,000 | Yes |
| Enterprise | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited | Yes |

### Step 1: Update Website (en.ts)

Add product limits to the pricing content:

```typescript
// In website/src/content/pricing/en.ts
export const pricing: PricingTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    name: 'Free',
    // ... existing fields ...
    features: [
      { label: '200 products', included: true },
      { label: 'Product images (local only)', included: true },
      // ... other features ...
    ],
  },
  // ... other tiers ...
];

// Add to featureRows:
export const featureRows: FeatureRow[] = [
  // ... existing rows ...
  { label: 'Max products', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Unlimited' } },
  { label: 'Product image sync', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } },
];
```

### Step 2: Generate Shared Config

Create a script that extracts limits from `en.ts` and generates:

1. **Rust constants** → `crates/oz-core/src/tier_limits.rs`
2. **Client config** → `ui/src/config/tier-limits.ts`
3. **License server config** → `apps/license-server/tier_config.json`

```bash
# Run after updating en.ts
node scripts/generate-tier-config.mjs
```

### Step 3: Server Reads Generated Config

```rust
// crates/oz-core/src/tier_limits.rs (GENERATED — do not edit manually)
pub const TIER_MAX_PRODUCTS: &[(&str, Option<i64>)] = &[
    ("free", Some(200)),
    ("plus", Some(500)),
    ("pro", Some(1_000)),
    ("premium", Some(10_000)),
    ("enterprise", None),
];

pub const TIER_SUPPORTS_IMAGE_SYNC: &[(&str, bool)] = &[
    ("free", false),
    ("plus", true),
    ("pro", true),
    ("premium", true),
    ("enterprise", true),
];
```

## Tier Limits (Simplified: Max Products = Max Images)

| Tier | Max Products | Images Synced | Size/Image | Server Storage |
|------|-------------|---------------|------------|----------------|
| **Free** | 200 | **No** (local only) | 12 KB | **0** |
| **Plus** | 500 | Yes | 12 KB | 6 MB |
| **Pro** | 1,000 | Yes | 12 KB | 12 MB |
| **Premium** | 10,000 | Yes | 12 KB | 120 MB |
| **Enterprise** | Unlimited | Yes | 12 KB | 6 GB max |

**Why Free images are local-only:**
- Free tier = 1 device only (no sync needed)
- Images stored locally on device, not uploaded to server
- Reduces server storage by 50% (Free tier images don't count)
- Clear upgrade path: "Upgrade to Plus to sync images across devices"

**Why simplified:**
- One number to remember: "Free tier: 200 products"
- No confusion about separate image limits
- Image is just an attribute of the product, not a separate entity
- Users think in terms of "how many products can I add?"

**Why these generous limits:**
- 6 GB NVMe volume was sitting empty (0.02 GB used)
- 512×512 WebP @ 40% = ~12 KB per image (very compact)
- Free tier gets 200 products (local only, no server storage)
- Premium gets 10,000 — covers large retailers with full catalogs
- Realistic max: 100 Premium tenants × 10,000 products = 1.2 GB (20% of volume)

## Storage Layout

```
/data/product-images/
├── {tenant_id}/
│   ├── {product_id}.webp      # Main image (512x512, 40% WebP)
│   └── {product_id}_thumb.webp # Thumbnail (128x128, 40% WebP)
```

**Client-Side Processing:**
- Resize to 512×512 (maintain aspect ratio, pad if needed)
- Convert to WebP at 40% quality
- Generate 128×128 thumbnail
- Upload both files in single request (Plus+ only)
- Free tier: store locally, skip upload

**Why client-side:**
- Saves server CPU (0.2 core budget is tight)
- Faster upload (12 KB vs 500 KB raw)
- Consistent quality across all uploads
- Server stays stateless — just stores files
- Free tier: no server upload needed

## API Endpoints

### 1. Upload Image (Replace if exists)
```http
POST /api/v1/product-images/{product_id}
Content-Type: multipart/form-data
Authorization: Bearer {jwt}

Body: 
  - image: file (already processed to 512x512 WebP @ 40%)
  - thumbnail: file (already processed to 128x128 WebP @ 40%)
```

**Response:**
```json
{
  "product_id": "abc-123",
  "image_url": "/api/v1/product-images/abc-123",
  "thumbnail_url": "/api/v1/product-images/abc-123?thumb=1",
  "size_bytes": 12400,
  "replaced": true
}
```

**Validation:**
- Check product exists: verify product_id belongs to tenant
- Check file size: `file.size <= 100 KB` (safety limit for processed images)
- Check content type: only `image/webp`
- If product already has image: delete old files, replace with new
- Update `products.has_image = 1`

**Note:** Tier limit is enforced when creating products, not when uploading images. A product can always have an image if it exists.

### 2. Serve Image
```http
GET /api/v1/product-images/{product_id}?thumb=1
```

**Response:**
- `Content-Type: image/webp`
- `Cache-Control: public, max-age=86400` (1 day)
- `ETag: "{hash}"` (for conditional requests)

**Missing image:** Return 404 (client shows placeholder icon)

### 3. Delete Image
```http
DELETE /api/v1/product-images/{product_id}
Authorization: Bearer {jwt}
```

**Response:** `204 No Content`

**Behavior:**
- Delete `{product_id}.webp` and `{product_id}_thumb.webp` from disk
- Delete row from `product_images` table
- Update `products.has_image = 0`
- Decrement tenant image count

### 4. Bulk Check (for initial sync)
```http
POST /api/v1/product-images/bulk
Content-Type: application/json
Authorization: Bearer {jwt}

Body: { "product_ids": ["abc-123", "def-456"] }
```

**Response:**
```json
{
  "images": {
    "abc-123": { "exists": true, "thumbnail_url": "/api/v1/product-images/abc-123?thumb=1" },
    "def-456": { "exists": false }
  }
}
```

## Database Changes

### New Table: `product_images`
```sql
CREATE TABLE product_images (
    id TEXT PRIMARY KEY,                    -- UUID v7
    tenant_id TEXT NOT NULL,                -- Tenant isolation
    product_id TEXT NOT NULL,               -- References products.id
    file_path TEXT NOT NULL,                -- /data/product-images/{tenant}/{product}.webp
    thumb_path TEXT NOT NULL,               -- /data/product-images/{tenant}/{product}_thumb.webp
    file_size INTEGER NOT NULL,             -- Bytes (main image)
    thumb_size INTEGER NOT NULL,            -- Bytes (thumbnail)
    width INTEGER NOT NULL DEFAULT 512,     -- Pixel width
    height INTEGER NOT NULL DEFAULT 512,    -- Pixel height
    created_at TEXT NOT NULL,               -- ISO-8601
    updated_at TEXT NOT NULL,               -- ISO-8601
    
    UNIQUE(tenant_id, product_id)           -- One image per product
);

CREATE INDEX idx_product_images_tenant ON product_images(tenant_id);
CREATE INDEX idx_product_images_product ON product_images(product_id);
```

### Modified Table: `products`
```sql
-- Add computed column for image presence (denormalized for sync)
ALTER TABLE products ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;
```

### Image Lifecycle Triggers

**On Product Delete:**
```sql
-- When a product is deleted, automatically delete its image
CREATE TRIGGER trg_product_image_delete
AFTER DELETE ON products
BEGIN
    DELETE FROM product_images WHERE product_id = OLD.id AND tenant_id = OLD.tenant_id;
    -- Note: Actual file deletion happens in application code
END;
```

**On Image Replace:**
```sql
-- Handled in application code: delete old files before inserting new record
```

## Client Changes

### 1. Product Card Enhancement
```tsx
// Instead of opening Google Images, show actual product image
<ProductCard>
  {product.has_image ? (
    <img 
      src={`${API_BASE}/api/v1/product-images/${product.id}?thumb=1`}
      alt={product.name}
      loading="lazy"
    />
  ) : (
    <div className="product-placeholder">
      <IconPackage />
    </div>
  )}
</ProductCard>
```

### 2. Product Edit Dialog
```tsx
<ProductEditDialog>
  <ImageUpload
    productId={product.id}
    currentImage={product.has_image}
    maxFileSize={tierLimits.maxSizePerImage}
    onUpload={(url) => setProduct({ ...product, has_image: true })}
    onDelete={() => setProduct({ ...product, has_image: false })}
  />
</ProductEditDialog>
```

### 3. Sync Protocol Extension
```rust
// Add to Product struct in platform/sync
pub struct Product {
    // ... existing fields ...
    pub has_image: bool,  // NEW: whether server has an image
}
```

## Image Lifecycle & Cleanup

### Automatic Cleanup Scenarios

| Event | Action | Files Deleted |
|-------|--------|---------------|
| Product deleted | Delete image + thumbnail | `{product_id}.webp`, `{product_id}_thumb.webp` |
| Image replaced (new upload) | Delete old files, store new | Old `{product_id}.webp`, old `{product_id}_thumb.webp` |
| Tenant deleted | Delete all tenant images | Entire `{tenant_id}/` directory |
| Manual delete via API | Delete image + thumbnail | `{product_id}.webp`, `{product_id}_thumb.webp` |

### Implementation Details

**1. Product Deletion Hook:**
```rust
// In product delete handler, BEFORE deleting the product row:
async fn delete_product(tenant_id: &str, product_id: &str) -> Result<()> {
    // 1. Delete image files from disk
    let image_dir = format!("/data/product-images/{}", tenant_id);
    let main_path = format!("{}/{}.webp", image_dir, product_id);
    let thumb_path = format!("{}/{}_thumb.webp", image_dir, product_id);
    
    let _ = tokio::fs::remove_file(&main_path).await;
    let _ = tokio::fs::remove_file(&thumb_path).await;
    
    // 2. Delete database record
    db.execute(
        "DELETE FROM product_images WHERE tenant_id = ?1 AND product_id = ?2",
        params![tenant_id, product_id],
    )?;
    
    // 3. Delete product (cascades if foreign key exists)
    db.execute(
        "DELETE FROM products WHERE tenant_id = ?1 AND id = ?2",
        params![tenant_id, product_id],
    )?;
    
    Ok(())
}
```

**2. Image Replacement (Upload Handler):**
```rust
async fn upload_image(tenant_id: &str, product_id: &str, image: Bytes, thumb: Bytes) -> Result<()> {
    let image_dir = format!("/data/product-images/{}", tenant_id);
    let main_path = format!("{}/{}.webp", image_dir, product_id);
    let thumb_path = format!("{}/{}_thumb.webp", image_dir, product_id);
    
    // 1. Verify product exists and belongs to tenant
    let product = get_product(tenant_id, product_id)?
        .ok_or_else(|| Error::NotFound("product not found"))?;
    
    // 2. Check if image exists — delete old files if replacing
    if let Some(old) = get_image_record(tenant_id, product_id)? {
        let _ = tokio::fs::remove_file(&old.file_path).await;
        let _ = tokio::fs::remove_file(&old.thumb_path).await;
        tracing::info!(product_id, "replaced existing product image");
    }
    
    // 3. Write new files
    tokio::fs::create_dir_all(&image_dir).await?;
    tokio::fs::write(&main_path, &image).await?;
    tokio::fs::write(&thumb_path, &thumb).await?;
    
    // 4. Upsert database record
    db.execute(
        "INSERT INTO product_images (id, tenant_id, product_id, file_path, thumb_path, file_size, thumb_size, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(tenant_id, product_id) DO UPDATE SET
             file_path = excluded.file_path,
             thumb_path = excluded.thumb_path,
             file_size = excluded.file_size,
             thumb_size = excluded.thumb_size,
             updated_at = excluded.updated_at",
        params![uuid, tenant_id, product_id, main_path, thumb_path, image.len(), thumb.len(), now],
    )?;
    
    // 5. Update product.has_image flag
    db.execute(
        "UPDATE products SET has_image = 1 WHERE tenant_id = ?1 AND id = ?2",
        params![tenant_id, product_id],
    )?;
    
    Ok(())
}
```

**Note:** Tier limit check happens when creating products (in `create_product` handler), not when uploading images. This keeps the logic simple — if you can create a product, you can give it an image.

**3. Tenant Deletion (Batch Cleanup):**
```rust
async fn delete_tenant_images(tenant_id: &str) -> Result<()> {
    let image_dir = format!("/data/product-images/{}", tenant_id);
    
    // 1. Delete entire directory
    if Path::new(&image_dir).exists() {
        tokio::fs::remove_dir_all(&image_dir).await?;
    }
    
    // 2. Delete all database records
    db.execute(
        "DELETE FROM product_images WHERE tenant_id = ?1",
        params![tenant_id],
    )?;
    
    tracing::info!(tenant_id, "deleted all product images for tenant");
    Ok(())
}
```

### Disk Space Recovery

**Background Job (optional):** Run daily to find orphaned files:
```rust
async fn cleanup_orphaned_images() -> Result<()> {
    // Find files on disk that don't have a database record
    let tenants = list_tenant_dirs("/data/product-images").await?;
    
    for tenant_dir in tenants {
        let tenant_id = tenant_dir.file_name();
        let files = list_files(&tenant_dir).await?;
        
        for file in files {
            let product_id = file.file_stem();
            if !image_record_exists(tenant_id, product_id)? {
                tracing::warn!(file = %file.display(), "removing orphaned image");
                tokio::fs::remove_file(&file).await?;
            }
        }
    }
    
    Ok(())
}
```

## Implementation Checklist

### Phase 1: Website — Define Tier Limits (SOURCE OF TRUTH)
- [ ] 1.1 Add product limits to `en.ts` features
  - File: `website/src/content/pricing/en.ts`
  - Add `{ label: '200 products', included: true }` to Free tier
  - Add `{ label: '500 products', included: true }` to Plus tier
  - Add `{ label: '1,000 products', included: true }` to Pro tier
  - Add `{ label: '10,000 products', included: true }` to Premium tier
  - Add `{ label: 'Unlimited products', included: true }` to Enterprise tier
- [ ] 1.2 Add product image sync to features
  - Add `{ label: 'Product images (local only)', included: true }` to Free
  - Add `{ label: 'Product image sync', included: true }` to Plus+
- [ ] 1.3 Update `featureRows` comparison table
  - File: `website/src/content/pricing/en.ts`
  - Add `{ label: 'Max products', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Unlimited' } }`
  - Add `{ label: 'Product image sync', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } }`
- [ ] 1.4 Update Indonesian pricing (`id.ts`)
  - File: `website/src/content/pricing/id.ts`
  - Mirror all changes from `en.ts`
- [ ] 1.5 Verify pricing page renders correctly
  - Run `cd website && npm run check`
  - Run `cd website && npm run build`
  - Verify all 5 tiers show product limits

### Phase 2: Generate Shared Tier Config
- [ ] 2.1 Create tier config generator script
  - File: `scripts/generate-tier-config.mjs` (new)
  - Read: `website/src/content/pricing/en.ts`
  - Output: `crates/oz-core/src/tier_limits.rs` (Rust constants)
  - Output: `ui/src/config/tier-limits.ts` (client config)
  - Output: `apps/license-server/tier_config.json` (license server)
- [ ] 2.2 Add `tier_limits.rs` to oz-core
  - File: `crates/oz-core/src/tier_limits.rs` (generated)
  - Constants: `TIER_MAX_PRODUCTS`, `TIER_SUPPORTS_IMAGE_SYNC`
- [ ] 2.3 Add `#[path = "tier_limits.rs"] pub mod tier_limits;` to lib.rs
  - File: `crates/oz-core/src/lib.rs`
- [ ] 2.4 Run generator and verify output
  - Command: `node scripts/generate-tier-config.mjs`
  - Verify: `cargo check -p oz-core` passes

### Phase 3: Database Migration
- [ ] 3.1 Create migration file for `product_images` table
  - File: `crates/oz-core/migrations/20260821_product_images.sql`
  - Include: CREATE TABLE, indexes, ALTER TABLE for `has_image`
- [ ] 3.2 Add migration to migration runner
  - File: `crates/oz-core/src/db/migrations.rs` (or equivalent)
  - Ensure migration runs on both SQLite and PostgreSQL
- [ ] 3.3 Test migration on empty database
- [ ] 3.4 Test migration on existing database with products

### Phase 4: Server-Side Tier Enforcement
- [ ] 4.1 Add `max_products()` to `SubscriptionTier` using generated config
  - File: `crates/oz-core/src/subscription.rs`
  - Import: `use crate::tier_limits::TIER_MAX_PRODUCTS;`
  - Returns: lookup from `TIER_MAX_PRODUCTS` constant
- [ ] 4.2 Add `supports_image_sync()` to `SubscriptionTier` using generated config
  - File: `crates/oz-core/src/subscription.rs`
  - Import: `use crate::tier_limits::TIER_SUPPORTS_IMAGE_SYNC;`
  - Returns: lookup from `TIER_SUPPORTS_IMAGE_SYNC` constant
- [ ] 4.3 Add `ProductLimit` variant to `QuotaError` enum
  - File: `crates/oz-core/src/subscription.rs`
  - Fields: `tier`, `limit`, `current`
- [ ] 4.4 Add product count check to `create_product` handler
  - File: `crates/oz-core/src/db/products.rs`
  - Query: `SELECT COUNT(*) FROM products WHERE tenant_id = ?`
  - Compare: count < tier.max_products()
  - Return: `QuotaError::ProductLimit` if exceeded
- [ ] 4.5 Add unit tests for tier enforcement
  - File: `crates/oz-core/src/subscription_tests.rs`
  - Test all 5 tiers with product limits
  - Test Enterprise → no limit

### Phase 5: Server-Side Image Endpoints
- [ ] 5.1 Create image storage module
  - File: `apps/cloud-server/src/product_images.rs` (new)
  - Functions: `upload_image`, `serve_image`, `delete_image`, `bulk_check`
- [ ] 5.2 Implement `upload_image` handler
  - Validate: product exists, file size <= 100 KB, content type = image/webp
  - Check: `tier.supports_image_sync()` — reject if Free tier
  - Delete old files if replacing
  - Write new files to `/data/product-images/{tenant_id}/`
  - Upsert `product_images` record
  - Update `products.has_image = 1`
- [ ] 5.3 Implement `serve_image` handler
  - Return image with `Content-Type: image/webp`
  - Add `Cache-Control: public, max-age=86400`
  - Add `ETag` header for conditional requests
  - Return 404 if image not found
- [ ] 5.4 Implement `delete_image` handler
  - Delete files from disk
  - Delete `product_images` record
  - Update `products.has_image = 0`
  - Return 204 No Content
- [ ] 5.5 Implement `bulk_check` handler
  - Accept list of product_ids
  - Return map of product_id → {exists, thumbnail_url}
- [ ] 5.6 Register routes in `main.rs`
  - File: `apps/cloud-server/src/main.rs`
  - Routes: POST/GET/DELETE `/api/v1/product-images/{product_id}`, POST `/api/v1/product-images/bulk`
- [ ] 5.7 Add rate limiting to upload endpoint
  - Use existing rate limiter
  - Limit: 10 uploads per minute per tenant

### Phase 6: Cleanup Hooks
- [ ] 6.1 Add image cleanup to product delete handler
  - File: `crates/oz-core/src/db/products.rs`
  - Before deleting product: delete image files and `product_images` record
- [ ] 6.2 Add tenant image cleanup handler
  - File: `apps/cloud-server/src/product_images.rs`
  - Delete entire `/data/product-images/{tenant_id}/` directory
  - Delete all `product_images` records for tenant
- [ ] 6.3 Add orphaned file cleanup job
  - File: `apps/cloud-server/src/product_images.rs`
  - Run daily
  - Find files without database records
  - Delete orphaned files

### Phase 7: Client-Side - Desktop Client
- [ ] 7.1 Import tier limits from generated config
  - File: `ui/src/config/tier-limits.ts` (generated)
  - Import: `TIER_MAX_PRODUCTS`, `TIER_SUPPORTS_IMAGE_SYNC`
- [ ] 7.2 Add `has_image` to `ProductDto`
  - File: `apps/desktop-client/src/commands/products.rs`
  - Field: `pub has_image: bool`
- [ ] 7.3 Update `row_to_product_with_details` to include `has_image`
  - File: `crates/oz-core/src/db/products.rs`
  - Add: `has_image: row.get("has_image")`
- [ ] 7.4 Update product card component
  - File: `ui/src/features/products/ProductCard.tsx`
  - Show image if `has_image = true`, else show placeholder icon
- [ ] 7.5 Add image upload to product edit dialog
  - File: `ui/src/features/products/ProductEditDialog.tsx`
  - Add file picker, preview, upload button
  - Check: `TIER_SUPPORTS_IMAGE_SYNC[currentTier]` — hide if Free
- [ ] 7.6 Implement client-side image processing
  - File: `ui/src/utils/imageProcessing.ts` (new)
  - Functions: `resizeTo512`, `convertToWebP`, `generateThumbnail`
  - Use canvas API for resize, browser-native WebP conversion
- [ ] 7.7 Add image upload API function
  - File: `ui/src/api/products.ts`
  - Function: `uploadProductImage(productId, imageBlob, thumbnailBlob)`
- [ ] 7.8 Add image delete API function
  - File: `ui/src/api/products.ts`
  - Function: `deleteProductImage(productId)`

### Phase 8: Client-Side - Tablet Client
- [ ] 8.1 Add `has_image` to `ProductDto`
  - File: `apps/tablet-client/src/commands/products.rs`
  - Field: `pub has_image: bool`
- [ ] 8.2 Update product card component (shared with Desktop)
  - File: `ui/src/features/products/ProductCard.tsx`
  - Show image if `has_image = true`, else show placeholder icon
- [ ] 8.3 Add image upload to product edit dialog (shared with Desktop)
  - File: `ui/src/features/products/ProductEditDialog.tsx`
  - Add file picker, preview, upload button

### Phase 9: Sync Protocol Update
- [ ] 9.1 Add `has_image` to `Product` struct in sync transport
  - File: `platform/sync/src/transport.rs`
  - Field: `pub has_image: bool`
- [ ] 9.2 Update sync push handler to include `has_image`
  - File: `apps/cloud-server/src/sync_store.rs`
  - Include `has_image` in product INSERT/UPDATE
- [ ] 9.3 Update sync pull handler to include `has_image`
  - File: `apps/cloud-server/src/sync_store.rs`
  - Include `has_image` in product SELECT
- [ ] 9.4 Test sync with `has_image` field

### Phase 10: Free Tier - Local Storage
- [ ] 10.1 Add local image storage to client
  - File: `ui/src/utils/localImageStorage.ts` (new)
  - Functions: `saveLocalImage`, `loadLocalImage`, `deleteLocalImage`
  - Store in app's data directory (Tauri: `app_data_dir`)
- [ ] 10.2 Update product creation for Free tier
  - File: `ui/src/features/products/ProductForm.tsx`
  - Check: `TIER_SUPPORTS_IMAGE_SYNC[currentTier]`
  - If false: save image locally, skip server upload
- [ ] 10.3 Update product display for Free tier
  - File: `ui/src/features/products/ProductCard.tsx`
  - If Free tier: load image from local storage

### Phase 11: Polish & Testing
- [ ] 11.1 Add image upload progress indicator
  - File: `ui/src/features/products/ImageUpload.tsx` (new)
  - Show progress bar during upload
- [ ] 11.2 Add admin dashboard for image storage
  - File: `ui/src/features/admin/ImageStorageDashboard.tsx` (new)
  - Show: total images, storage used, per-tier breakdown
- [ ] 11.3 Add integration tests for image endpoints
  - File: `apps/cloud-server/src/product_images_tests.rs` (new)
  - Test: upload, serve, delete, bulk check
  - Test: tier limit enforcement
  - Test: cleanup on product/tenant deletion
- [ ] 11.4 Add E2E tests for image workflow
  - File: `ui/e2e/product-images.spec.ts` (new)
  - Test: upload image, verify display, delete image
- [ ] 11.5 Update documentation
  - File: `docs/api/product-images.md` (new)
  - Document: all endpoints, request/response formats

## Implementation Order

1. **Phase 1**: Website tier definitions (SOURCE OF TRUTH)
2. **Phase 2**: Generate shared config (Rust + client)
3. **Phase 3**: Database migration
4. **Phase 4**: Server-side tier enforcement
5. **Phase 5**: Server-side image endpoints
6. **Phase 6**: Cleanup hooks
7. **Phase 7-8**: Client-side UI (Desktop + Tablet)
8. **Phase 9**: Sync protocol update
9. **Phase 10**: Free tier local storage
10. **Phase 11**: Polish & testing

## Estimated Effort

| Phase | Hours | Priority |
|-------|-------|----------|
| Phase 1: Website Tier Definitions | 2 | High |
| Phase 2: Generate Shared Config | 2 | High |
| Phase 3: Database Migration | 1 | High |
| Phase 4: Server Tier Enforcement | 3 | High |
| Phase 5: Server Image Endpoints | 6 | High |
| Phase 6: Cleanup Hooks | 2 | Medium |
| Phase 7: Desktop Client | 6 | High |
| Phase 8: Tablet Client | 4 | Medium |
| Phase 9: Sync Protocol | 3 | High |
| Phase 10: Free Tier Local | 4 | Medium |
| Phase 11: Polish & Testing | 6 | Low |
| **Total** | **39 hours** | — |

## Appendix A: Required Code Changes

### A.1 Add `max_products()` to `SubscriptionTier`

Location: `crates/oz-core/src/subscription.rs`

```rust
/// Maximum number of products allowed for this tier.
/// Returns `None` for unlimited (Enterprise).
/// Free tier gets 200 products (images stored locally).
/// Plus+ tiers get more products with cloud image sync.
pub fn max_products(&self) -> Option<i64> {
    match self {
        Self::Free | Self::OneTime => Some(200),
        Self::Plus => Some(500),
        Self::Pro => Some(2_000),
        Self::Premium => Some(5_000),
        Self::Enterprise => None,
    }
}
```

### A.2 Add `supports_product_images()` to `SubscriptionTier`

```rust
/// Whether this tier supports cloud-synced product images.
/// Free tier images are local-only (single device).
pub fn supports_product_images(&self) -> bool {
    matches!(self, Self::Plus | Self::Pro | Self::Premium | Self::Enterprise)
}
```

### A.3 Update `QuotaError` enum

Add new variant for product limit:

```rust
/// The tenant has reached their product count limit.
ProductLimit {
    tier: String,
    limit: i64,
    current: i64,
},
```

### A.4 Add `product_images` table migration

Location: `crates/oz-core/migrations/` (new file)

```sql
-- Add product_images table for cloud-synced product images.
-- Free tier images are stored locally on device, not in this table.
CREATE TABLE IF NOT EXISTS product_images (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    thumb_size INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 512,
    height INTEGER NOT NULL DEFAULT 512,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_images_tenant ON product_images(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- Add has_image flag to products table.
ALTER TABLE products ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;
```

## Cost Analysis

| Resource | Before | After | Delta |
|----------|--------|-------|-------|
| Storage | 0.02 GB | ~0.15 GB | +0.13 GB (2% of 6 GB) |
| CPU | ~0.15 core | ~0.152 core | +0.002 core (file serving only) |
| Memory | ~140 MB | ~141 MB | +1 MB (file handles) |
| Terminals | ~400 | ~398 | -2 (negligible CPU) |

**Verdict:** Negligible impact. Free tier images are local-only (0 server storage). Client-side processing means server just stores and serves tiny files. The 6 GB volume was sitting empty — this puts it to good use.

**Storage Breakdown:**
- Free tier: 0 GB (local only)
- Plus tier: ~600 MB (100 tenants × 500 products × 12 KB)
- Pro tier: ~600 MB (50 tenants × 1,000 products × 12 KB)
- Premium tier: ~1.2 GB (10 tenants × 10,000 products × 12 KB)
- **Total: ~2.4 GB** (40% of 6 GB volume)

## Security Considerations

1. **Tenant Isolation:** All queries filter by `tenant_id`
2. **File Validation:** Check MIME type, file size, and image dimensions
3. **Path Traversal Prevention:** Sanitize product IDs, never use user input in file paths
4. **Rate Limiting:** Apply existing rate limits to upload endpoint
5. **Size Enforcement:** Check tier limits before accepting upload

## Success Metrics

- [ ] Product images upload successfully for Plus+ tiers
- [ ] Free tier images stored locally (not uploaded to server)
- [ ] Images display correctly on all terminals
- [ ] Tier limits enforced (Free: 200 products, Plus: 500, Pro: 2K, Premium: 5K)
- [ ] Storage stays under 6 GB volume limit
- [ ] No measurable impact on sync performance
- [ ] Images deleted when product is deleted
- [ ] Old images deleted when new image is uploaded (replacement)
- [ ] All tenant images deleted when tenant is deleted
- [ ] No orphaned files on disk

> last audited 29-09-26 by docs-auditor
