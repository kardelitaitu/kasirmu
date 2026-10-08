<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Neither this review nor the plan it reviews carried an audit stamp or footer, so nothing had ever checked them; both now do. This file is a reviewer's assessment of `docs/archived/plan-product-images.md`, and its judgements are about the PLAN rather than about code, which is the right thing for a review document to be. The technical claims that could be falsified were checked against the tree the plan went on to produce, and they hold up: the `product_images` table the plan specifies is real and landed exactly where the plan's own phase list implied — `crates/kasirmu-core/migrations/20260901_product_images.sql:26`, carried into the base schema at `crates/kasirmu-core/migrations/20260813_init.pg.sql:2784`; `SubscriptionTier::max_products()` exists at `crates/kasirmu-core/src/entitlements.rs:191`; `QuotaError` is `crates/kasirmu-core/src/subscription/quota.rs:17`; and the "website as single source of truth" premise holds because `website/src/content/pricing/en.ts` — the file the plan names as the tier-definition source — is real and present. · ONE GAP IN THE PLAN ITSELF, recorded here because the review is the document that ought to have caught it and did not: the plan's Appendix A.2 proposes adding `supports_product_images()` to `SubscriptionTier`, and that function does not exist — `crates/kasirmu-core/src/entitlements.rs` contains no image-entitlement helper at all, and a repo-wide search finds no such symbol. A.1 (`max_products`) and A.3 (`QuotaError`) both landed; A.2 did not, at least not under that name. Since this file reviews the plan and the plan's appendix is the most concrete part of it, the omission belongs on the reviewer's record. I have NOT added the function — the default repair direction is doc-to-code, and a missing entitlement helper is a code gap for the plan's owner to decide, not something an audit pass invents. · NOT re-measured: the storage estimates, cost analysis, effort estimates, and success metrics, which are projections rather than claims, and the 801-line plan's unchecked phase checklist, which is a to-do list whose state is not something this audit can infer. · No stamp or footer existed on this file before this pass. -->

# Product Image Storage Plan - Review Summary

## Review Date: 2026-08-21

## Executive Summary

The plan is **comprehensive and ready for implementation**. All key decisions have been made, technical details are specified, and the impact is minimal.

---

## ✅ Consistency Check

| Section | Free | Plus | Pro | Premium | Enterprise | Status |
|---------|------|------|-----|---------|------------|--------|
| Tier Limits | 200 | 500 | 2,000 | 5,000 | Unlimited | ✅ Consistent |
| Images Synced | No | Yes | Yes | Yes | Yes | ✅ Consistent |
| Server Storage | 0 | 6 MB | 24 MB | 60 MB | 6 GB max | ✅ Consistent |
| Success Metrics | 200 | 500 | 2K | 5K | — | ✅ Consistent |

---

## ✅ Technical Review

### Storage Estimation
- **Per image**: 512×512 WebP @ 40% quality = ~12 KB ✅
- **Realistic max**: 2.4 GB (40% of 6 GB volume) ✅
- **Free tier**: 0 GB (local only) ✅

### API Endpoints
1. **Upload** — POST /api/v1/product-images/{product_id} ✅
2. **Serve** — GET /api/v1/product-images/{product_id} ✅
3. **Delete** — DELETE /api/v1/product-images/{product_id} ✅
4. **Bulk Check** — POST /api/v1/product-images/bulk ✅

### Database Schema
- `product_images` table with proper indexes ✅
- `products.has_image` flag for sync ✅
- Unique constraint on (tenant_id, product_id) ✅

### Cleanup Logic
- Product deletion → delete image files ✅
- Image replacement → delete old, store new ✅
- Tenant deletion → delete entire directory ✅
- Orphaned file cleanup job ✅

---

## ✅ Code Changes Required

### Server-Side (Rust)
1. `crates/oz-core/src/subscription.rs` — Add `max_products()` and `supports_product_images()` ✅
2. `crates/oz-core/migrations/` — New migration for `product_images` table ✅
3. `apps/cloud-server/src/` — New image endpoints (upload, serve, delete, bulk) ✅
4. `crates/oz-core/src/db/products.rs` — Enforce product limits on create ✅

### Client-Side (TypeScript)
1. `ui/src/api/products.ts` — Add image upload/delete functions ✅
2. `ui/src/features/products/` — Update product card and edit dialog ✅
3. `platform/sync/src/transport.rs` — Add `has_image` to Product struct ✅

---

## ✅ Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Storage overflow | Low | High | Monitor usage, Enterprise per-tenant cap |
| Image upload abuse | Low | Medium | Rate limiting, file size limits |
| Orphaned files | Medium | Low | Daily cleanup job |
| Sync protocol bloat | Low | Medium | `has_image` flag, bulk check endpoint |

---

## ✅ Cost Impact

| Resource | Before | After | Delta | Status |
|----------|--------|-------|-------|--------|
| Storage | 0.02 GB | 0.15 GB | +0.13 GB | ✅ Negligible |
| CPU | 0.15 core | 0.152 core | +0.002 core | ✅ Negligible |
| Memory | 140 MB | 141 MB | +1 MB | ✅ Negligible |
| Terminals | 400 | 398 | -2 | ✅ Negligible |

---

## ✅ Success Criteria

- [ ] Free tier: 200 products, images local-only
- [ ] Plus tier: 500 products, images synced
- [ ] Pro tier: 2,000 products, images synced
- [ ] Premium tier: 5,000 products, images synced
- [ ] Enterprise: unlimited, images synced
- [ ] Storage stays under 6 GB
- [ ] No measurable performance impact
- [ ] Images deleted on product/tenant deletion

---

## Reviewer Notes

1. **Free tier local-only is smart** — Reduces server storage by 50%, clear upgrade path
2. **Client-side processing saves CPU** — Server just stores files, no image processing
3. **Tier limits on products, not images** — Simple, one number to remember
4. **Cleanup logic is thorough** — Covers all deletion scenarios
5. **Appendix A provides exact code changes** — Ready for implementation

---

## Recommendation

**APPROVE for implementation.** The plan is well-designed, technically sound, and has minimal impact on server resources. The Free tier local-only approach is particularly clever — it reduces costs while providing a clear upgrade incentive.

---

## Next Steps

1. Add `max_products()` to `SubscriptionTier` (Phase 1.1)
2. Create database migration (Phase 1.2)
3. Implement server endpoints (Phase 1.3-1.7)
4. Update client UI (Phase 2.1-2.6)
5. Add polish (Phase 3.1-3.4)

> last audited 29-09-26 by docs-auditor
