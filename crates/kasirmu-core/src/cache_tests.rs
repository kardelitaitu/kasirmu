use super::*;
use crate::Money;

fn usd() -> crate::Currency {
    "USD".parse().unwrap()
}

fn make_product(sku: &str) -> ProductWithDetails {
    ProductWithDetails {
        product: crate::Product::new(
            sku,
            "Test Product",
            Money {
                minor_units: 100,
                currency: usd(),
            },
        ),
        category_name: None,
        stock_qty: None,
        popularity_score: 0.0,
        images: Vec::new(),
    }
}

// ── NoopCache tests ─────────────────────────────────────────────────────────

#[test]
fn noop_cache_get_product_returns_none() {
    let cache = NoopCache;
    assert!(cache.get_product("anything").is_none());
}

#[test]
fn noop_cache_get_inventory_returns_none() {
    let cache = NoopCache;
    assert!(cache.get_inventory("any-id").is_none());
}

#[test]
fn noop_cache_set_product_is_noop() {
    let cache = NoopCache;
    let p = make_product("SKU");
    cache.set_product("sku", &p);
    assert!(cache.get_product("sku").is_none());
}

#[test]
fn noop_cache_set_inventory_is_noop() {
    let cache = NoopCache;
    cache.set_inventory("p", 50);
    assert!(cache.get_inventory("p").is_none());
}

#[test]
fn noop_cache_invalidation_is_noop() {
    let cache = NoopCache;
    cache.invalidate_product("sku");
    cache.invalidate_inventory("p");
}

#[test]
fn noop_cache_is_not_healthy() {
    let cache = NoopCache;
    assert!(!cache.is_healthy());
}

#[test]
fn noop_cache_start_inventory_pubsub_returns_none() {
    let cache = NoopCache;
    let arc_cache: Arc<dyn Cache> = Arc::new(NoopCache);
    assert!(cache.start_inventory_pubsub(arc_cache, None).is_none());
}

#[test]
fn create_cache_falls_back_to_noop() {
    let cache = create_cache("redis://127.0.0.1:1/", 300);
    assert!(!cache.is_healthy());
}

// ── Cache trait contract via MockCache ───────────────────────────────────────

/// A mock cache implementation to verify the trait contract.
struct MockCache {
    products: std::sync::Mutex<std::collections::HashMap<String, ProductWithDetails>>,
    inventory: std::sync::Mutex<std::collections::HashMap<String, i64>>,
}

impl MockCache {
    fn new() -> Self {
        Self {
            products: std::sync::Mutex::new(std::collections::HashMap::new()),
            inventory: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl Cache for MockCache {
    fn get_product(&self, sku: &str) -> Option<ProductWithDetails> {
        self.products.lock().unwrap().get(sku).cloned()
    }

    fn set_product(&self, sku: &str, product: &ProductWithDetails) {
        self.products
            .lock()
            .unwrap()
            .insert(sku.to_string(), product.clone());
    }

    fn invalidate_product(&self, sku: &str) {
        self.products.lock().unwrap().remove(sku);
    }

    fn get_inventory(&self, product_id: &str) -> Option<i64> {
        self.inventory.lock().unwrap().get(product_id).copied()
    }

    fn set_inventory(&self, product_id: &str, qty: i64) {
        self.inventory
            .lock()
            .unwrap()
            .insert(product_id.to_string(), qty);
    }

    fn invalidate_inventory(&self, product_id: &str) {
        self.inventory.lock().unwrap().remove(product_id);
    }

    fn is_healthy(&self) -> bool {
        true
    }
}

#[test]
fn mock_cache_set_and_get_product() {
    let cache = MockCache::new();
    let p = make_product("SKU-1");
    cache.set_product("SKU-1", &p);
    assert!(cache.get_product("SKU-1").is_some());
    assert_eq!(
        cache.get_product("SKU-1").unwrap().product.sku.to_string(),
        "SKU-1"
    );
}

#[test]
fn mock_cache_get_miss_returns_none() {
    let cache = MockCache::new();
    assert!(cache.get_product("nonexistent").is_none());
}

#[test]
fn mock_cache_invalidate_product() {
    let cache = MockCache::new();
    let p = make_product("SKU-2");
    cache.set_product("SKU-2", &p);
    assert!(cache.get_product("SKU-2").is_some());
    cache.invalidate_product("SKU-2");
    assert!(cache.get_product("SKU-2").is_none());
}

#[test]
fn mock_cache_set_and_get_inventory() {
    let cache = MockCache::new();
    cache.set_inventory("prod-1", 42);
    assert_eq!(cache.get_inventory("prod-1"), Some(42));
}

#[test]
fn mock_cache_inventory_miss_returns_none() {
    let cache = MockCache::new();
    assert!(cache.get_inventory("nonexistent").is_none());
}

#[test]
fn mock_cache_invalidate_inventory() {
    let cache = MockCache::new();
    cache.set_inventory("prod-2", 100);
    assert_eq!(cache.get_inventory("prod-2"), Some(100));
    cache.invalidate_inventory("prod-2");
    assert!(cache.get_inventory("prod-2").is_none());
}

#[test]
fn mock_cache_overwrite_product() {
    let cache = MockCache::new();
    let p1 = make_product("SKU-A");
    let p2 = make_product("SKU-A");
    cache.set_product("SKU-A", &p1);
    cache.set_product("SKU-A", &p2);
    assert_eq!(
        cache.get_product("SKU-A").unwrap().product.sku.to_string(),
        "SKU-A"
    );
}

#[test]
fn mock_cache_is_healthy() {
    let cache = MockCache::new();
    assert!(cache.is_healthy());
}

// ── Arc<dyn Cache> dynamic dispatch ──────────────────────────────────────────

#[test]
fn arc_dyn_cache_works() {
    let cache: Arc<dyn Cache> = Arc::new(MockCache::new());
    cache.set_inventory("prod-3", 99);
    assert_eq!(cache.get_inventory("prod-3"), Some(99));
}

#[test]
fn arc_dyn_cache_noop_fallback() {
    let cache: Arc<dyn Cache> = Arc::new(NoopCache);
    assert!(!cache.is_healthy());
    assert!(cache.get_product("x").is_none());
}

// ── Send + Sync traits ───────────────────────────────────────────────────────

#[test]
fn noop_cache_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<NoopCache>();
}

#[test]
fn mock_cache_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<MockCache>();
}

// ── create_cache edge cases ──────────────────────────────────────────────────

#[test]
fn create_cache_with_various_invalid_urls() {
    // All should fall back to NoopCache
    let urls = ["", "not-a-url", "redis://", "redis://invalid-host:99999/"];
    for url in &urls {
        let cache = create_cache(url, 300);
        assert!(!cache.is_healthy(), "URL {url} should fall back to noop");
    }
}

#[test]
fn create_cache_with_various_ttl_values() {
    // TTL shouldn't affect the fallback behavior
    for ttl in [0, 1, 300, 86400] {
        let cache = create_cache("redis://invalid:1/", ttl);
        assert!(!cache.is_healthy());
    }
}

// ── Default trait method behavior ────────────────────────────────────────────

#[test]
fn default_publish_inventory_change_is_noop() {
    let cache = NoopCache;
    // Should not panic
    cache.publish_inventory_change("pid", "sku", 10, Some("term-1"));
    cache.publish_inventory_change("pid", "sku", 10, None);
}

#[test]
fn default_publish_negative_stock_event_is_noop() {
    let cache = NoopCache;
    // Should not panic
    cache.publish_negative_stock_event("pid", "sku", "loc-1", -5, -5, Some("term-1"));
    cache.publish_negative_stock_event("pid", "sku", "loc-1", -5, -5, None);
}

// ── Edge cases ───────────────────────────────────────────────────────────────

#[test]
fn empty_string_product_id() {
    // SKU cannot be empty (enforced by Sku type), but product_id is a plain String
    let cache = MockCache::new();
    cache.set_inventory("", 0);
    assert_eq!(cache.get_inventory(""), Some(0));
    cache.invalidate_inventory("");
    assert!(cache.get_inventory("").is_none());
}

#[test]
fn large_inventory_values() {
    let cache = MockCache::new();
    cache.set_inventory("p", i64::MAX);
    assert_eq!(cache.get_inventory("p"), Some(i64::MAX));
    cache.set_inventory("p", i64::MIN);
    assert_eq!(cache.get_inventory("p"), Some(i64::MIN));
}

#[test]
fn many_products_cached() {
    let cache = MockCache::new();
    for i in 0..1000 {
        let sku = format!("SKU-{i:04}");
        cache.set_product(&sku, &make_product(&sku));
    }
    // All should be retrievable
    for i in 0..1000 {
        let sku = format!("SKU-{i:04}");
        assert!(cache.get_product(&sku).is_some());
    }
    // Invalidate half
    for i in 0..500 {
        let sku = format!("SKU-{i:04}");
        cache.invalidate_product(&sku);
    }
    // First half gone, second half still there
    assert!(cache.get_product("SKU-0000").is_none());
    assert!(cache.get_product("SKU-0500").is_some());
}

#[test]
fn unicode_sku() {
    let cache = MockCache::new();
    let p = make_product("SKU-日本語");
    cache.set_product("SKU-日本語", &p);
    assert!(cache.get_product("SKU-日本語").is_some());
    cache.invalidate_product("SKU-日本語");
    assert!(cache.get_product("SKU-日本語").is_none());
}
