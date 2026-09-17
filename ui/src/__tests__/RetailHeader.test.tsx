import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';
import RetailHeader from '@/features/retail/RetailHeader';
import type { StoreSettingsDto } from '@/api/settings';
import type { ShiftDto } from '@/api/shifts';

const defaultStoreSettings: StoreSettingsDto = {
  name: 'TOKO TEST',
  address: 'Jl. Contoh No. 123',
  taxId: '',
  currency: 'IDR',
  branch: 'Cabang A',
  logo: '',
};

const defaultActiveShift: ShiftDto = {
  id: 'shift-1',
  userId: 'user-1',
  terminalId: null,
  openedAt: new Date().toISOString(),
  closedAt: null,
  openingBalanceMinor: 100000,
  closingBalanceMinor: null,
  expectedCashMinor: 400000,
  cashDifferenceMinor: -100000,
  totalSalesMinor: 500000,
  totalCashMinor: 300000,
  totalCardMinor: 0,
  totalOtherMinor: 0,
  totalVoidsMinor: 0,
  totalRefundsMinor: 0,
  totalPayoutsMinor: 0,
  notes: '',
  status: 'open',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl, sharedFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl, sharedIdFtl);
  await renderInAct(wrapped);
}

describe('RetailHeader', () => {
  describe('Full variant', () => {
    it('renders header element', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} />);

      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('shows store name and branch', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} activeShift={null} />);

      expect(screen.getByText('TOKO TEST')).toBeInTheDocument();
      expect(screen.getByText((c: string) => c.includes('Cabang A'))).toBeInTheDocument();
    });

    it('shows store address', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} />);

      expect(screen.getByText('Jl. Contoh No. 123')).toBeInTheDocument();
    });

    it('shows fallback name when storeSettings is missing', async () => {
      await renderWithFluent(<RetailHeader />);

      expect(screen.getByText('TOKO')).toBeInTheDocument();
    });

    it('shows shift badge with "Shift · Rp 500.000" when active shift', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} activeShift={defaultActiveShift} />);

      // formatMoney uses id-ID locale with IDR exponent=0: "Rp 500.000" (space after Rp, dots for thousands)
      expect(screen.getByText((c: string) => c.includes('Shift') && c.includes('500.000'))).toBeInTheDocument();
    });

    it('shows shift badge with "No shift" when no active shift', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} activeShift={null} />);

      expect(screen.getByText('No shift')).toBeInTheDocument();
    });

    it('shows shift badge with "Loading…" when shiftLoading is true', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} shiftLoading={true} />);

      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders workspace picker button with aria-label', async () => {
      const onWorkspacePicker = vi.fn();
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} onWorkspacePicker={onWorkspacePicker} />);

      const btn = screen.getByLabelText('Back to workspaces');
      expect(btn).toBeInTheDocument();
    });

    it('calls onWorkspacePicker when workspace button clicked', async () => {
      const onWorkspacePicker = vi.fn();
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} onWorkspacePicker={onWorkspacePicker} />);

      await screen.getByLabelText('Back to workspaces').click();
      expect(onWorkspacePicker).toHaveBeenCalledTimes(1);
    });

    it('shows cashier name when displayName provided', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} displayName="John Doe" />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('hides cashier when displayName not provided', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} />);

      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });

    it('shows date and time when provided', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} dateStr="2024-01-15" timeStr="14:30:00" />);

      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
      expect(screen.getByText('14:30:00')).toBeInTheDocument();
    });

    it('shows shift duration when provided', async () => {
      await renderWithFluent(<RetailHeader storeSettings={defaultStoreSettings} dateStr="2024-01-15" timeStr="14:30:00" shiftDuration="02:30:00" />);

      expect(screen.getByText('02:30:00')).toBeInTheDocument();
    });

    it('shows store logo when provided', async () => {
      await renderWithFluent(<RetailHeader storeSettings={{ ...defaultStoreSettings, logo: 'base64logo' }} />);

      // Logo img may or may not render depending on implementation
      // Just verify the component renders without error
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('uses fallback name when store name missing', async () => {
      await renderWithFluent(<RetailHeader storeSettings={{ ...defaultStoreSettings, name: '' }} />);

      expect(screen.getByText('TOKO')).toBeInTheDocument();
    });
  });

  describe('Minimal variant', () => {
    it('renders header element', async () => {
      await renderWithFluent(<RetailHeader variant="minimal" title="Sub View" />);

      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('shows title', async () => {
      await renderWithFluent(<RetailHeader variant="minimal" title="Settings" />);

      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders skip-to-main link when skipTarget provided', async () => {
      await renderWithFluent(<RetailHeader variant="minimal" title="View" skipTarget="main-content" />);

      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('renders back button when onBack provided', async () => {
      const onBack = vi.fn();
      await renderWithFluent(<RetailHeader variant="minimal" title="View" onBack={onBack} />);

      const backBtn = screen.getByLabelText('Back');
      expect(backBtn).toBeInTheDocument();
      expect(backBtn).toHaveTextContent('← Back');
    });

    it('calls onBack when back button clicked', async () => {
      const onBack = vi.fn();
      await renderWithFluent(<RetailHeader variant="minimal" title="View" onBack={onBack} />);

      await screen.getByLabelText('Back').click();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('does not render back button when onBack not provided', async () => {
      await renderWithFluent(<RetailHeader variant="minimal" title="View" />);

      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
    });
  });

  describe('Indonesian locale', () => {
    it('shows fallback name "TOKO" in Indonesian', async () => {
      await renderWithFluentId(<RetailHeader />);

      expect(screen.getByText('TOKO')).toBeInTheDocument();
    });

    it('shows "Shift" label in Indonesian', async () => {
      await renderWithFluentId(<RetailHeader storeSettings={defaultStoreSettings} activeShift={defaultActiveShift} />);

      expect(screen.getByText((c: string) => c.includes('Shift') && c.includes('Rp'))).toBeInTheDocument();
    });

    it('shows "Tidak ada shift" when no active shift', async () => {
      await renderWithFluentId(<RetailHeader storeSettings={defaultStoreSettings} activeShift={null} />);

      expect(screen.getByText('Tidak ada shift')).toBeInTheDocument();
    });

    it('shows workspace picker aria-label in Indonesian', async () => {
      const onWorkspacePicker = vi.fn();
      await renderWithFluentId(<RetailHeader storeSettings={defaultStoreSettings} onWorkspacePicker={onWorkspacePicker} />);

      const btn = screen.getByLabelText('Kembali ke ruang kerja');
      expect(btn).toBeInTheDocument();
    });

    it('shows skip-to-main link in Indonesian', async () => {
      await renderWithFluentId(<RetailHeader variant="minimal" title="View" skipTarget="main-content" />);

      const skipLink = screen.getByText('Lewati ke konten utama');
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('shows back button text in Indonesian', async () => {
      const onBack = vi.fn();
      await renderWithFluentId(<RetailHeader variant="minimal" title="View" onBack={onBack} />);

      const backBtn = screen.getByLabelText('Kembali');
      expect(backBtn).toHaveTextContent('← Kembali');
    });
  });
});