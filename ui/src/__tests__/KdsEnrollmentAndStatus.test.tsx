import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import kdsFtl from '@/locales/kds.ftl?raw';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// Mock KdsDeviceStatusIndicator dependencies
vi.mock('@/api/kds', () => ({
  listKdsDevicesScoped: vi.fn().mockResolvedValue([]),
}));

function makeL10n() {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(kdsFtl));
  return new ReactLocalization([bundle]);
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <LocalizationProvider l10n={makeL10n()}>
      {children}
    </LocalizationProvider>
  );
}

// ── KdsDeviceStatusIndicator ─────────────────────────────────

describe('KdsDeviceStatusIndicator', () => {
  it('renders without crashing when no devices', async () => {
    const { KdsDeviceStatusIndicator } = await import(
      '@/features/kds/components/KdsDeviceStatusIndicator'
    );
    // Should not throw when no devices are registered.
    const { container } = render(
      <TestWrapper>
        <KdsDeviceStatusIndicator sessionToken="test-token" />
      </TestWrapper>,
    );
    // Correcting the comment this replaced: it claimed the indicator "returns
    // null" with no devices. It does not — it renders a real button showing a
    // 0/0 count. The old assertion was `expect(true)`, so nobody ever checked.
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(container.textContent).toMatch(/0\s*\/\s*0/);
  });
});

// ── KdsEnrollmentModal ───────────────────────────────────────

describe('KdsEnrollmentModal', () => {
  it('renders nothing when closed', async () => {
    const { KdsEnrollmentModal } = await import(
      '@/features/kds/components/KdsEnrollmentModal'
    );
    const { container } = render(
      <TestWrapper>
        <KdsEnrollmentModal isOpen={false} onClose={() => {}} sessionToken="test-token" restaurantPosId="resto-1" onEnrolled={() => {}} />
      </TestWrapper>,
    );
    // When closed, the modal should not render a dialog.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the form when opened', async () => {
    const { KdsEnrollmentModal } = await import(
      '@/features/kds/components/KdsEnrollmentModal'
    );
    render(
      <TestWrapper>
        <KdsEnrollmentModal isOpen={true} onClose={() => {}} sessionToken="test-token" restaurantPosId="resto-1" onEnrolled={() => {}} />
      </TestWrapper>,
    );
    // Should show the enrollment form with the title.
    expect(screen.getByText(/enroll kds device/i)).toBeTruthy();
  });
});
