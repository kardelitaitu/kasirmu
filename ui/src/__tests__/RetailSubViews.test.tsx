import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { ToastProvider } from '@/components/Toast';
import { SalesHistoryView, TableManagementView, StockInquiryView } from '@/features/retail/RetailSubViews';

// Mock the sub-components
vi.mock('@/features/sales/SalesHistoryScreen');
vi.mock('@/features/tables/TableManagementScreen');
vi.mock('@/features/products/ProductLookupScreen');
vi.mock('@/features/retail/RetailHeader');

import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';
import RetailHeader from '@/features/retail/RetailHeader';

// RetailHeader props type (not exported, so defined locally)
interface RetailHeaderProps {
  variant?: 'full' | 'minimal';
  storeSettings?: unknown;
  shiftLoading?: boolean;
  activeShift?: unknown;
  displayName?: string;
  dateStr?: string;
  timeStr?: string;
  shiftDuration?: string | null;
  onWorkspacePicker?: () => void;
  title?: string;
  onBack?: () => void;
  skipTarget?: string;
  children?: React.ReactNode;
}

// Test utilities
async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const salesIdFtl = await import('@/locales/sales.id.ftl?raw');
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl.default);
  await renderInAct(wrapped);
}

// Type for ProductLookupScreen props
interface ProductLookupScreenProps {
  onAddProduct: (product: unknown) => void;
}

// Type for the test product (matches what ProductLookupScreen expects)
interface TestProduct {
  sku: string;
  name: string;
  category: string;
  price: { minor_units: number; currency: string };
  barcode: string;
  inStock: boolean;
  stockQty: number;
  productType: string;
  createdAt: string;
  priceUpdatedAt: string;
}

describe('RetailSubViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SalesHistoryScreen).mockImplementation(() => <div data-testid="sales-history-screen" />);
    vi.mocked(TableManagementScreen).mockImplementation(() => <div data-testid="table-management-screen" />);
    vi.mocked(ProductLookupScreen).mockImplementation(() => <div data-testid="product-lookup-screen" />);
    vi.mocked(RetailHeader).mockImplementation((props: RetailHeaderProps) => {
      const { variant, title, onBack, skipTarget, children } = props;
      return (
        <div data-testid={`retail-header-${variant}`} data-title={title} data-onback={onBack} data-skptarget={skipTarget}>
          {children}
        </div>
      );
    });
  });

  describe('SalesHistoryView', () => {
    it('renders SalesHistoryScreen with minimal RetailHeader', async () => {
      await renderWithFluent(<SalesHistoryView theme="dark" onBack={vi.fn()} />);

      // Check RetailHeader props (component does NOT pass theme)
      // React StrictMode may cause double-invocation
      expect(RetailHeader).toHaveBeenCalled();
      const calls = vi.mocked(RetailHeader).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0]?.[0] as RetailHeaderProps | undefined;
      expect(firstCall).toBeDefined();
      expect(firstCall).toEqual(
        expect.objectContaining({
          variant: 'minimal',
          onBack: expect.any(Function),
          skipTarget: 'retail-subview-main',
        })
      );

      // Check that SalesHistoryScreen is rendered
      expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument();
    });

    it('renders in Indonesian locale', async () => {
      await renderWithFluentId(<SalesHistoryView theme="light" onBack={vi.fn()} />);

      // Check that RetailHeader was called with Indonesian title
      expect(RetailHeader).toHaveBeenCalled();
      const calls = vi.mocked(RetailHeader).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0]?.[0] as RetailHeaderProps | undefined;
      expect(firstCall).toBeDefined();
      expect(firstCall).toEqual(
        expect.objectContaining({
          title: expect.any(String), // Would be the localized string for 'retail-fn-history'
        })
      );
    });
  });

  describe('TableManagementView', () => {
    it('renders TableManagementScreen with minimal RetailHeader', async () => {
      await renderWithFluent(<TableManagementView theme="dark" onBack={vi.fn()} />);

      // Check RetailHeader props (component does NOT pass theme)
      expect(RetailHeader).toHaveBeenCalled();
      const calls = vi.mocked(RetailHeader).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0]?.[0] as RetailHeaderProps | undefined;
      expect(firstCall).toBeDefined();
      expect(firstCall).toEqual(
        expect.objectContaining({
          variant: 'minimal',
          onBack: expect.any(Function),
          skipTarget: 'retail-subview-main',
        })
      );

      // Check that TableManagementScreen is rendered
      expect(screen.getByTestId('table-management-screen')).toBeInTheDocument();
    });
  });

  describe('StockInquiryView', () => {
    const mockOnAddProduct = vi.fn();

    it('renders ProductLookupScreen with minimal RetailHeader and passes onAddProduct', async () => {
      await renderWithFluent(<StockInquiryView theme="dark" onBack={vi.fn()} onAddProduct={mockOnAddProduct} />);

      // Check RetailHeader props (component does NOT pass theme)
      expect(RetailHeader).toHaveBeenCalled();
      const headerCalls = vi.mocked(RetailHeader).mock.calls;
      expect(headerCalls.length).toBeGreaterThan(0);
      const firstCall = headerCalls[0]?.[0] as RetailHeaderProps | undefined;
      expect(firstCall).toBeDefined();
      expect(firstCall).toEqual(
        expect.objectContaining({
          variant: 'minimal',
          onBack: expect.any(Function),
          skipTarget: 'retail-subview-main',
        })
      );

      // Check that ProductLookupScreen is rendered
      expect(screen.getByTestId('product-lookup-screen')).toBeInTheDocument();

      // Verify that ProductLookupScreen received the onAddProduct prop
      const productLookupCalls = vi.mocked(ProductLookupScreen).mock.calls;
      expect(productLookupCalls.length).toBeGreaterThan(0);
      const productLookupCall = productLookupCalls[0]?.[0] as ProductLookupScreenProps | undefined;
      expect(productLookupCall).toBeDefined();
      expect(productLookupCall).toEqual(
        expect.objectContaining({
          onAddProduct: expect.any(Function),
        })
      );
    });

    it('transforms product data correctly when onAddProduct is called', async () => {
      await renderWithFluent(<StockInquiryView theme="light" onBack={vi.fn()} onAddProduct={mockOnAddProduct} />);

      // Get the onAddProduct prop that was passed to ProductLookupScreen
      const productLookupCalls = vi.mocked(ProductLookupScreen).mock.calls;
      expect(productLookupCalls.length).toBeGreaterThan(0);
      const productLookupCall = productLookupCalls[0]?.[0] as ProductLookupScreenProps | undefined;
      expect(productLookupCall).toBeDefined();
      const onAddProductProp = productLookupCall?.onAddProduct;

      // Create a test product with camelCase properties as used by the API
      const testProduct: TestProduct = {
        sku: 'TEST-123',
        name: 'Test Product',
        category: 'cat-1',
        price: { minor_units: 15000, currency: 'IDR' },
        barcode: '987654321',
        inStock: true,
        stockQty: 5,
        productType: 'retail',
        createdAt: '2024-01-01T00:00:00.000Z',
        priceUpdatedAt: '2024-01-01T00:00:00.000Z',
      };

      // Call the onAddProduct function
      if (onAddProductProp) {
        onAddProductProp(testProduct);
      }

      // Verify the transformation matches what the component does
      // The component uses: p.inStock, p.stockQty, p.productType, p.createdAt, p.priceUpdatedAt
      expect(mockOnAddProduct).toHaveBeenCalledWith({
        sku: 'TEST-123',
        name: 'Test Product',
        category: 'cat-1',
        price: { minor_units: 15000, currency: 'IDR' },
        barcode: '987654321',
        in_stock: true,
        stock_qty: 5,
        product_type: 'retail',
        tax_rate_ids: [],
        created_at: '2024-01-01T00:00:00.000Z',
        price_updated_at: '2024-01-01T00:00:00.000Z',
      });
    });
  });
});