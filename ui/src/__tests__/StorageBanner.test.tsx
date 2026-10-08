import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StorageBanner from '@/app/StorageBanner';

const mockUseStorageHealth = vi.fn();

vi.mock('@/hooks/useStorageHealth', () => ({
  useStorageHealth: () => mockUseStorageHealth(),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => id,
    },
  }),
}));

describe('StorageBanner', () => {
  beforeEach(() => {
    mockUseStorageHealth.mockReset();
  });

  it('renders nothing when storage is not low', () => {
    mockUseStorageHealth.mockReturnValue({
      health: {
        availableBytes: 10 * 1024 * 1024 * 1024,
        totalBytes: 64 * 1024 * 1024 * 1024,
        isLowSpace: false,
        thresholdBytes: 500 * 1024 * 1024,
      },
      isLowSpace: false,
      refresh: vi.fn(),
    });

    const { container } = render(<StorageBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders warning banner when storage is low (< 500 MB)', () => {
    mockUseStorageHealth.mockReturnValue({
      health: {
        availableBytes: 250 * 1024 * 1024,
        totalBytes: 64 * 1024 * 1024 * 1024,
        isLowSpace: true,
        thresholdBytes: 500 * 1024 * 1024,
      },
      isLowSpace: true,
      refresh: vi.fn(),
    });

    render(<StorageBanner />);
    expect(screen.getByTestId('storage-health-banner')).toBeInTheDocument();
    expect(screen.getByText(/Low Storage Space/i)).toBeInTheDocument();
  });

  it('hides banner when dismiss button is clicked', () => {
    mockUseStorageHealth.mockReturnValue({
      health: {
        availableBytes: 250 * 1024 * 1024,
        totalBytes: 64 * 1024 * 1024 * 1024,
        isLowSpace: true,
        thresholdBytes: 500 * 1024 * 1024,
      },
      isLowSpace: true,
      refresh: vi.fn(),
    });

    render(<StorageBanner />);
    const dismissBtn = screen.getByLabelText('storage-low-banner-dismiss-aria');
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId('storage-health-banner')).toBeNull();
  });
});
