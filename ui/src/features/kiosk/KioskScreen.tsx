import { useEffect, useState, useRef, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import { listProductsScoped, listCategoriesScoped } from '@/api/products';
import type { ProductDto, CategoryDto } from '@/api/products';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { formatMoney } from '@/types/domain';
import './KioskScreen.css';

const IDLE_TIMEOUT_MS = 60000;
const PRICE_VOLATILITY_MS = 24 * 60 * 60 * 1000;

function isPriceRecent(p: ProductDto): boolean {
  if (!p.price_updated_at) return false;
  const elapsed = Date.now() - new Date(p.price_updated_at).getTime();
  return elapsed >= 0 && elapsed < PRICE_VOLATILITY_MS;
}

interface CartItem {
  product: ProductDto;
  qty: number;
}

/** Self-service kiosk screen — customer-facing product browsing, cart management, and checkout with idle timeout reset. */
export default function KioskScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { currency } = useCurrency();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();

  const resetIdle = useCallback(() => {
    if (idle) setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_TIMEOUT_MS);
  }, [idle]);

  const loadMenu = useCallback(() => {
    setLoadError(false);
    listProductsScoped(sessionToken)
      .then(setProducts)
      .catch(() => setLoadError(true));
    listCategoriesScoped(sessionToken)
      .then(setCategories)
      .catch(() => setLoadError(true));
  }, [sessionToken]);

  useEffect(() => {
    loadMenu();
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_TIMEOUT_MS);
    return () => clearTimeout(idleTimer.current);
  }, [loadMenu]);

  useEffect(() => {
    const handler = () => resetIdle();
    window.addEventListener('touchstart', handler);
    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('touchstart', handler);
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [resetIdle]);

  const filtered = activeCategory
    ? products.filter((p) => p.category === activeCategory)
    : products;

  const addToCart = (product: ProductDto) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.sku === product.sku);
      if (existing) {
        return prev.map((c) =>
          c.product.sku === product.sku
            ? { ...c, qty: c.qty + 1 }
            : c
        );
      }
      return [...prev, { product, qty: 1 }];
    });
    resetIdle();
  };

  const updateQty = (sku: string, delta: number) => {
    setCart((prev) => {
      const next = prev
        .map((c) =>
          c.product.sku === sku
            ? { ...c, qty: Math.max(0, c.qty + delta) }
            : c
        )
        .filter((c) => c.qty > 0);
      return next;
    });
  };

  const totalMinor = cart.reduce((s, c) => s + c.product.price.minor_units * c.qty, 0);

  if (idle) {
    return (
      <button type="button" className="kiosk-attract" aria-label={l10n.getString('kiosk-attract-label')} onClick={resetIdle}>
        <div className="kiosk-attract-content">
          <h1 className="kiosk-attract-title">kasir.mu</h1>
          <p className="kiosk-attract-subtitle"><Localized id="kiosk-tap-to-start">Tap to start</Localized></p>
        </div>
      </button>
    );
  }

  if (checkout) {
    return (
      <div className="kiosk-checkout" role="region" aria-label={l10n.getString('kiosk-section-checkout')}>
        <h2><Localized id="kiosk-checkout-title">Checkout</Localized></h2>
        <div className="kiosk-checkout-items">
          {cart.map((c) => (
            <div key={c.product.sku} className="kiosk-checkout-row">
              <span>{c.product.name} &times; {c.qty}</span>
              <span>{formatMoney({ minor_units: c.product.price.minor_units * c.qty, currency })}</span>
            </div>
          ))}
        </div>
        <div className="kiosk-checkout-total">
          <span><Localized id="kiosk-total">Total</Localized></span>
          <span>{formatMoney({ minor_units: totalMinor, currency })}</span>
        </div>
        <button type="button" className="kiosk-checkout-pay" onClick={() => {
          addToast({ message: l10n.getString('kiosk-pay-success'), type: 'success' });
          setCart([]);
          setCheckout(false);
        }} aria-label={l10n.getString('kiosk-pay')}>
          <Localized id="kiosk-pay">Pay</Localized>
        </button>
        <button type="button" className="kiosk-checkout-back" onClick={() => setCheckout(false)} aria-label={l10n.getString('back')}>
          <Localized id="back">Back</Localized>
        </button>
      </div>
    );
  }

  return (
    <div className="kiosk" role="region" aria-label={l10n.getString('kiosk-section-kiosk')}>
      <div className="kiosk-categories" role="tablist" aria-label={l10n.getString('kiosk-section-categories')}>
        <button type="button"
          className={`kiosk-cat-chip ${activeCategory === null ? 'active' : ''}`}
          onClick={() => setActiveCategory(null)}
          role="tab"
          aria-selected={activeCategory === null}
        >
          <Localized id="kiosk-all">All</Localized>
        </button>
        {categories.map((cat) => (
          <button type="button"
            key={cat.id}
            className={`kiosk-cat-chip ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
            role="tab"
            aria-selected={activeCategory === cat.id}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="kiosk-load-error" role="alert">
          <p><Localized id="kiosk-load-error">Failed to load the menu</Localized></p>
          <button type="button" onClick={loadMenu} aria-label={l10n.getString('kiosk-retry')}>
            <Localized id="kiosk-retry">Retry</Localized>
          </button>
        </div>
      )}

      <div className="kiosk-grid" role="list" aria-label={l10n.getString('kiosk-section-products')}>
        {filtered.map((p) => (
          <button type="button"
            key={p.sku}
            className="kiosk-product-card"
            onClick={() => addToCart(p)}
            aria-label={l10n.getString('kiosk-product-label', { name: p.name, price: formatMoney({ minor_units: p.price.minor_units, currency }) })}
          >
            {isPriceRecent(p) && <span className="kiosk-price-volatility-hint" title={l10n.getString('kiosk-price-volatility-title')} />}
            <span className="kiosk-product-name">{p.name}</span>
            <span className="kiosk-product-price">{formatMoney({ minor_units: p.price.minor_units, currency })}</span>
            {p.stock_qty !== null && p.stock_qty <= 5 && (
              <span className="kiosk-stock-badge"><Localized id="kiosk-stock-left" vars={{ count: p.stock_qty }}><span>{p.stock_qty} left</span></Localized></span>
            )}
          </button>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="kiosk-cart" role="region" aria-label={l10n.getString('kiosk-section-cart')}>
          <div className="kiosk-cart-items">
            {cart.map((c) => (
              <div key={c.product.sku} className="kiosk-cart-item">
                <span className="kiosk-cart-name">{c.product.name}</span>
                <div className="kiosk-cart-controls">
                  <button type="button" onClick={() => updateQty(c.product.sku, -1)} aria-label={l10n.getString('kiosk-decrease')}>&minus;</button>
                  <span>{c.qty}</span>
                  <button type="button" onClick={() => updateQty(c.product.sku, 1)} aria-label={l10n.getString('kiosk-increase')}>+</button>
                </div>
                <span className="kiosk-cart-price">{formatMoney({ minor_units: c.product.price.minor_units * c.qty, currency })}</span>
              </div>
            ))}
          </div>
          <div className="kiosk-cart-total">
            <span><Localized id="kiosk-total">Total</Localized></span>
            <span>{formatMoney({ minor_units: totalMinor, currency })}</span>
          </div>
          <button type="button" className="kiosk-checkout-btn" onClick={() => setCheckout(true)} aria-label={l10n.getString('kiosk-checkout')}>
            <Localized id="kiosk-checkout">Checkout</Localized>
          </button>
        </div>
      )}
    </div>
  );
}
