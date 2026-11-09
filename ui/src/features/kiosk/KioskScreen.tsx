import { useEffect, useState, useRef, useCallback } from 'react';
import { requiredLocalized } from '@/components/requiredLocalized';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { listProductsScoped, listCategoriesScoped } from '@/api/products';
import type { ProductDto, CategoryDto } from '@/api/products';
import { startSaleScoped, addLineScoped, completeSaleScoped, type AddLineArgs } from '@/api/sales';
import { listTablesScoped, createTableScoped, assignTableOrderScoped } from '@/api/tables';
import { createKdsOrderFromSaleScoped } from '@/api/kds';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { formatMoney, getProductModifierGroups, type Product } from '@/types/domain';
import ItemModifierModal, { type ModifierSelection } from '@/features/sales/components/ItemModifierModal';
import QrisQrDisplay from '@/components/QrisQrDisplay';
import './KioskScreen.css';

const IDLE_TIMEOUT_MS = 60000;
const PRICE_VOLATILITY_MS = 24 * 60 * 60 * 1000;

function isPriceRecent(p: ProductDto): boolean {
  if (!p.price_updated_at) return false;
  const elapsed = Date.now() - new Date(p.price_updated_at).getTime();
  return elapsed >= 0 && elapsed < PRICE_VOLATILITY_MS;
}

interface CartItem {
  id: string;
  product: ProductDto;
  qty: number;
  modifiers?: ModifierSelection[];
  note?: string;
}

interface OrderSuccessData {
  saleId: string;
  receiptNumber?: string | null | undefined;
  totalMinor: number;
  orderType: 'dine_in' | 'takeaway';
  tableNumber?: string | undefined;
  method: 'counter' | 'qris';
}

/** Self-service kiosk screen — customer-facing product browsing, item modifier customization, cart management, and real checkout / KDS dispatch with idle timeout reset. */
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
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [tableNumber, setTableNumber] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<ProductDto | null>(null);
  const [showQrisModal, setShowQrisModal] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<OrderSuccessData | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [processingOrder, setProcessingOrder] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();

  /**
   * Return the kiosk to the attract screen, DISCARDING any abandoned order.
   * Unconditionally resets cart, checkout, success, table, and modifier modals.
   */
  const endSession = useCallback(() => {
    setCart([]);
    setCheckout(false);
    setOrderSuccess(null);
    setTableNumber('');
    setCustomizingProduct(null);
    setShowQrisModal(false);
    setIdle(true);
  }, []);

  const resetIdle = useCallback(() => {
    if (idle) setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(endSession, IDLE_TIMEOUT_MS);
  }, [idle, endSession]);

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
    idleTimer.current = setTimeout(endSession, IDLE_TIMEOUT_MS);
    return () => clearTimeout(idleTimer.current);
  }, [loadMenu, endSession]);

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

  // Countdown timer on order success screen before returning to attract mode
  useEffect(() => {
    if (!orderSuccess) return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          endSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [orderSuccess, endSession]);

  const filtered = activeCategory
    ? products.filter((p) => p.category === activeCategory)
    : products;

  const handleProductCardClick = (product: ProductDto) => {
    const groups = getProductModifierGroups(product as unknown as Product);
    if (groups.length > 0) {
      setCustomizingProduct(product);
    } else {
      addToCart(product);
    }
    resetIdle();
  };

  const addToCart = (product: ProductDto) => {
    setCart((prev) => {
      const existing = prev.find(
        (c) => c.product.sku === product.sku && (!c.modifiers || c.modifiers.length === 0),
      );
      if (existing) {
        return prev.map((c) =>
          c.id === existing.id
            ? { ...c, qty: c.qty + 1 }
            : c
        );
      }
      const id = `${product.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return [...prev, { id, product, qty: 1 }];
    });
    resetIdle();
  };

  const handleConfirmModifiers = (selections: ModifierSelection[], totalPriceMinor: number) => {
    if (!customizingProduct) return;
    const prod = customizingProduct;
    setCustomizingProduct(null);
    const customizedProduct: ProductDto = {
      ...prod,
      price: {
        ...prod.price,
        minor_units: totalPriceMinor,
      },
    };
    const id = `${prod.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setCart((prev) => [
      ...prev,
      {
        id,
        product: customizedProduct,
        qty: 1,
        modifiers: selections,
      },
    ]);
    resetIdle();
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) => {
      const next = prev
        .map((c) =>
          c.id === id
            ? { ...c, qty: Math.max(0, c.qty + delta) }
            : c
        )
        .filter((c) => c.qty > 0);
      return next;
    });
    resetIdle();
  };

  const processOrder = async (method: 'counter' | 'qris') => {
    if (processingOrder || cart.length === 0) return;
    setProcessingOrder(true);
    try {
      const { cartId } = await startSaleScoped(sessionToken, { currency });
      for (const item of cart) {
        const lineArgs: AddLineArgs = {
          cartId,
          sku: item.product.sku,
          qty: item.qty,
          unitPriceMinor: item.product.price.minor_units,
          unitPriceCurrency: item.product.price.currency,
          ...((item.modifiers && item.modifiers.length > 0) || item.note
            ? {
                modifiersJson: JSON.stringify([
                  ...(item.modifiers ?? []).map((m) => ({
                    name: m.groupName,
                    choice: m.modifierName,
                    price_minor: m.priceMinor,
                  })),
                  ...(item.note ? [{ name: 'Note', choice: item.note, price_minor: 0 }] : []),
                ]),
              }
            : {}),
        };
        await addLineScoped(sessionToken, lineArgs);
      }

      const saleResult = await completeSaleScoped(sessionToken, {
        cartId,
        paymentMethod: method === 'qris' ? 'qris' : 'counter',
        tenderedMinor: null,
      });

      if (orderType === 'dine_in' && tableNumber.trim()) {
        try {
          const tbls = await listTablesScoped(sessionToken);
          const searchNum = tableNumber.trim().toLowerCase();
          let match = tbls.find(
            (t) => t.name.toLowerCase() === searchNum || t.name.toLowerCase() === `table ${searchNum}`,
          );
          if (!match) {
            match = await createTableScoped(sessionToken, {
              id: '',
              name: tableNumber.trim().toLowerCase().startsWith('table') ? tableNumber.trim() : `Table ${tableNumber.trim()}`,
              capacity: 4,
              pos_x: 0,
              pos_y: 0,
              shape: 'square',
              width: 100,
              height: 100,
              status: 'occupied',
              active_sale_id: null,
              section: 'main',
              active: true,
              sort_order: tbls.length + 1,
            });
          }
          if (match) {
            await assignTableOrderScoped(sessionToken, match.id, saleResult.saleId);
          }
        } catch (tableErr) {
          console.warn('assignTableOrderScoped failed', tableErr);
        }
      }

      try {
        await createKdsOrderFromSaleScoped(sessionToken, saleResult.saleId);
      } catch (kdsErr) {
        console.warn('createKdsOrderFromSale failed', kdsErr);
      }

      setOrderSuccess({
        saleId: saleResult.saleId,
        receiptNumber: saleResult.receiptNumber,
        totalMinor,
        orderType,
        tableNumber: tableNumber.trim() || undefined,
        method,
      });
      setCart([]);
    } catch (err) {
      console.error('Kiosk checkout failed', err);
      addToast({
        message: requiredLocalized(l10n, 'kiosk-checkout-error'),
        type: 'warning',
      });
    } finally {
      setProcessingOrder(false);
    }
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
    if (orderSuccess) {
      return (
        <div className="kiosk-success" role="region" aria-label={requiredLocalized(l10n, 'kiosk-order-success-title')}>
          <div className="kiosk-success-card">
            <div className="kiosk-success-icon" aria-hidden="true">&#10003;</div>
            <h2 className="kiosk-success-title">
              <Localized id="kiosk-order-success-title">Order Placed!</Localized>
            </h2>
            <p className="kiosk-success-number">
              <Localized id="kiosk-order-number" vars={{ number: orderSuccess.receiptNumber || orderSuccess.saleId }}>
                <span>Order #{orderSuccess.receiptNumber || orderSuccess.saleId}</span>
              </Localized>
            </p>
            <p className="kiosk-success-type">
              {orderSuccess.orderType === 'dine_in' ? (
                <Localized id="kiosk-table-assigned" vars={{ table: orderSuccess.tableNumber || '1' }}>
                  <span>Table {orderSuccess.tableNumber || '1'}</span>
                </Localized>
              ) : (
                <Localized id="kiosk-takeaway-label">Takeaway</Localized>
              )}
            </p>
            <p className="kiosk-success-instructions">
              {orderSuccess.method === 'counter' ? (
                <Localized id="kiosk-pay-cashier-instructions">
                  Please take your order ticket and pay at the cashier counter.
                </Localized>
              ) : (
                <Localized id="kiosk-pay-qris-instructions">
                  Payment confirmed! Your order is being prepared in the kitchen.
                </Localized>
              )}
            </p>
            <p className="kiosk-success-timer">
              <Localized id="kiosk-auto-reset" vars={{ seconds: countdown }}>
                <span>Returning to start in {countdown}s</span>
              </Localized>
            </p>
            <button
              type="button"
              className="kiosk-success-btn"
              onClick={endSession}
              aria-label={requiredLocalized(l10n, 'kiosk-done')}
            >
              <Localized id="kiosk-done">Done</Localized>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="kiosk-checkout" role="region" aria-label={l10n.getString('kiosk-section-checkout')}>
        <h2><Localized id="kiosk-checkout-title">Checkout</Localized></h2>
        <div className="kiosk-checkout-items">
          {cart.map((c) => (
            <div key={c.id} className="kiosk-checkout-row">
              <div className="kiosk-cart-item-info">
                <span>{c.product.name} &times; {c.qty}</span>
                {c.modifiers && c.modifiers.length > 0 && (
                  <span className="kiosk-checkout-modifiers">
                    {c.modifiers.map((m) => m.modifierName).join(', ')}
                  </span>
                )}
              </div>
              <span>{formatMoney({ minor_units: c.product.price.minor_units * c.qty, currency })}</span>
            </div>
          ))}
        </div>
        <div className="kiosk-checkout-total">
          <span><Localized id="kiosk-total">Total</Localized></span>
          <span>{formatMoney({ minor_units: totalMinor, currency })}</span>
        </div>
        <div className="kiosk-checkout-actions">
          <button
            type="button"
            className="kiosk-checkout-pay"
            disabled={processingOrder}
            onClick={() => void processOrder('counter')}
            aria-label={l10n.getString('kiosk-pay')}
          >
            <Localized id="kiosk-pay">Pay</Localized>
          </button>
          <button
            type="button"
            className="kiosk-checkout-qris"
            disabled={processingOrder}
            onClick={() => setShowQrisModal(true)}
            aria-label={requiredLocalized(l10n, 'kiosk-pay-qris')}
          >
            <Localized id="kiosk-pay-qris">Pay with QRIS</Localized>
          </button>
          <button
            type="button"
            className="kiosk-checkout-back"
            disabled={processingOrder}
            onClick={() => setCheckout(false)}
            aria-label={l10n.getString('back')}
          >
            <Localized id="back">Back</Localized>
          </button>
        </div>

        {showQrisModal && (
          <QrisQrDisplay
            isOpen={showQrisModal}
            amount={totalMinor}
            currency={currency}
            reference={`KIOSK-${Date.now().toString(36).toUpperCase()}`}
            onClose={() => setShowQrisModal(false)}
            onPaymentConfirmed={() => {
              setShowQrisModal(false);
              void processOrder('qris');
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="kiosk" role="region" aria-label={l10n.getString('kiosk-section-kiosk')}>
      <div className="kiosk-top-bar">
        <div className="kiosk-dining-bar" role="region" aria-label={requiredLocalized(l10n, 'kiosk-dining-mode')}>
          <div className="kiosk-dining-toggle" role="radiogroup" aria-label={requiredLocalized(l10n, 'kiosk-dining-mode')}>
            <button
              type="button"
              className={`kiosk-dining-btn ${orderType === 'dine_in' ? 'active' : ''}`}
              onClick={() => { setOrderType('dine_in'); resetIdle(); }}
              role="radio"
              aria-checked={orderType === 'dine_in'}
            >
              <Localized id="kiosk-dine-in">Dine In</Localized>
            </button>
            <button
              type="button"
              className={`kiosk-dining-btn ${orderType === 'takeaway' ? 'active' : ''}`}
              onClick={() => { setOrderType('takeaway'); resetIdle(); }}
              role="radio"
              aria-checked={orderType === 'takeaway'}
            >
              <Localized id="kiosk-takeaway">Takeaway</Localized>
            </button>
          </div>
          {orderType === 'dine_in' && (
            <div className="kiosk-table-input-wrap">
              <label htmlFor="kiosk-table-input" className="kiosk-table-label">
                <Localized id="kiosk-table-number">Table Number</Localized>:
              </label>
              <input
                id="kiosk-table-input"
                type="text"
                inputMode="numeric"
                className="kiosk-table-input"
                value={tableNumber}
                onChange={(e) => { setTableNumber(e.target.value); resetIdle(); }}
                placeholder={requiredLocalized(l10n, 'kiosk-table-placeholder')}
                aria-label={requiredLocalized(l10n, 'kiosk-table-number')}
              />
            </div>
          )}
        </div>

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
        {filtered.map((p) => {
          const modGroups = getProductModifierGroups(p as unknown as Product);
          const hasModifiers = modGroups.length > 0;
          return (
            <div key={p.sku} role="listitem">
              <button type="button"
                className="kiosk-product-card"
                onClick={() => handleProductCardClick(p)}
                aria-label={l10n.getString('kiosk-product-label', { name: p.name, price: formatMoney({ minor_units: p.price.minor_units, currency }) })}
              >
                {isPriceRecent(p) && <span className="kiosk-price-volatility-hint" title={l10n.getString('kiosk-price-volatility-title')} />}
                <span className="kiosk-product-name">{p.name}</span>
                <span className="kiosk-product-price">{formatMoney({ minor_units: p.price.minor_units, currency })}</span>
                {hasModifiers && (
                  <span className="kiosk-customizable-badge"><Localized id="kiosk-customizing">Customizable</Localized></span>
                )}
                {p.stock_qty !== null && p.stock_qty <= 5 && (
                  <span className="kiosk-stock-badge"><Localized id="kiosk-stock-left" vars={{ count: p.stock_qty }}><span>{p.stock_qty} left</span></Localized></span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {cart.length > 0 && (
        <div className="kiosk-cart" role="region" aria-label={l10n.getString('kiosk-section-cart')}>
          <div className="kiosk-cart-items">
            {cart.map((c) => (
              <div key={c.id} className="kiosk-cart-item">
                <div className="kiosk-cart-item-info">
                  <span className="kiosk-cart-name">{c.product.name}</span>
                  {c.modifiers && c.modifiers.length > 0 && (
                    <span className="kiosk-cart-modifiers">
                      {c.modifiers.map((m) => m.modifierName).join(', ')}
                    </span>
                  )}
                </div>
                <div className="kiosk-cart-controls">
                  <button type="button" onClick={() => updateQty(c.id, -1)} aria-label={l10n.getString('kiosk-decrease')}>&minus;</button>
                  <span>{c.qty}</span>
                  <button type="button" onClick={() => updateQty(c.id, 1)} aria-label={l10n.getString('kiosk-increase')}>+</button>
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

      {customizingProduct && (
        <ItemModifierModal
          open={Boolean(customizingProduct)}
          productName={customizingProduct.name}
          basePriceMinor={customizingProduct.price.minor_units}
          currency={customizingProduct.price.currency}
          groups={getProductModifierGroups(customizingProduct as unknown as Product)}
          onConfirm={handleConfirmModifiers}
          onClose={() => setCustomizingProduct(null)}
        />
      )}
    </div>
  );
}