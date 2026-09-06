import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CustomReportScreen from '@/features/reports/CustomReportScreen';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from '@/__tests__/test-utils/storeZoneCase';

// Mock the buildCustomReport API
vi.mock('@/api/reports', () => ({
  buildCustomReport: vi.fn().mockResolvedValue({
    columns: ['id', 'total_minor', 'status'],
    rows: [
      ['1', '500', 'completed'],
      ['2', '300', 'completed'],
    ],
  }),
}));

// R36-06: the screen now fetches the primary store to anchor its default
// window. Unmocked, that call hits real invoke, rejects, and is swallowed --
// leaving the store-zone path untested while the suite stays green.
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

// Mock Fluent
vi.mock('@fluent/react', () => ({
  Localized: ({ children, id }: { children: React.ReactNode; id: string }) => {
    if (React.isValidElement(children)) {
      return <span data-testid={`localized-${id}`}>{children.props.children ?? children}</span>;
    }
    return <span data-testid={`localized-${id}`}>{children}</span>;
  },
  useLocalization: () => ({
    l10n: {
      getString: (id: string, vars?: Record<string, string>) => {
        const strings: Record<string, string> = {
          'custom-report-title': 'Custom Report',
          'custom-report-dataset': 'Dataset',
          'custom-report-start': 'Start',
          'custom-report-end': 'End',
          'custom-report-columns': 'Columns',
          'custom-report-run': 'Run Report',
          'custom-report-results': 'Results',
          'custom-report-export-csv': 'Export CSV',
          'shared-loading': 'Loading…',
          'error-occurred': 'An error occurred',
          'no-results': 'No results found',
          'custom-report-no-columns-match': 'No columns match your search',
          // a11y labels
          'custom-report-dataset-aria': 'Dataset',
          'custom-report-start-aria': 'Start date',
          'custom-report-end-aria': 'End date',
          'custom-report-search-placeholder': 'Search columns…',
          'custom-report-search-aria': 'Search columns',
          'custom-report-search-clear-aria': 'Clear search',
          'custom-report-columns-aria': 'Column selection',
          'custom-report-run-aria': 'Run report',
          'custom-report-region-aria': 'Custom Report Builder',
          'custom-report-export-aria': 'Export CSV',
          'custom-report-columns-selected': '{ $selected } / { $total } selected',
        };
        let result = strings[id];
        if (result && vars) {
          result = result.replace(/\{\s*\$(\w+)\s*\}/g, (_, key) => vars[key] ?? `{$${key}}`);
        }
        return result ?? id;
      },
    },
  }),
}));

// Mock Card and Button components
vi.mock('@/components/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({ children, onClick, disabled, variant }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>
  ),
}));

/** Helper: get the column listbox element and query within it. */
function getColumnItems() {
  const listbox = screen.getByRole('listbox');
  return within(listbox).getAllByRole('option');
}

/** Helper: get all checkboxes within the column listbox. */
function getColumnCheckboxes() {
  const listbox = screen.getByRole('listbox');
  return within(listbox).getAllByRole('checkbox') as HTMLInputElement[];
}

describe('CustomReportScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Store profile with no timezone -> the UTC fallback, so pre-existing
    // assertions stay meaningful. Must come after clearAllMocks().
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: null });
  });

  
  it('anchors the default window to the primary store timezone (R36-06)', async () => {
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    render(<CustomReportScreen />);

    await waitFor(() => {
      expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 0));
      expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 30));
    });
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });

  it('does not clobber a window the operator already edited (R36-06)', async () => {
    const zone = discriminatingStoreZone();
    // Hold the store response open so the edit provably precedes it.
    let resolveStore: (v: unknown) => void = () => {};
    mockGetPrimaryLocationScoped.mockReturnValue(new Promise((r) => { resolveStore = r; }));
    render(<CustomReportScreen />);

    const startInput = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-01-05' } });

    resolveStore({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    await waitFor(() => {
      const input = screen.getByLabelText('Start date') as HTMLInputElement;
      expect(input.value).toBe('2026-01-05');
    });
  });

  it('renders the title and config card', () => {
    render(<CustomReportScreen />);
    expect(screen.getByText('Custom Report')).toBeTruthy();
    expect(screen.getByLabelText('Dataset')).toBeTruthy();
    expect(screen.getByText('Run Report')).toBeTruthy();
  });

  it('renders all 6 datasets in the selector', () => {
    render(<CustomReportScreen />);
    const select = screen.getByLabelText('Dataset') as HTMLSelectElement;
    expect(select.options.length).toBe(6);
    const opts = select.options;
    expect(opts[0]!.text).toBe('Sales History');
    expect(opts[1]!.text).toBe('Current Inventory');
    expect(opts[2]!.text).toBe('Customers');
    expect(opts[3]!.text).toBe('Staff');
    expect(opts[4]!.text).toBe('Tax Rates');
    expect(opts[5]!.text).toBe('Shifts');
  });

  it('shows date pickers for date-filtered datasets (sales)', () => {
    render(<CustomReportScreen />);
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByLabelText('End date')).toBeTruthy();
  });

  it('hides date pickers for non-date-filtered datasets', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'inventory' } });
    expect(screen.queryByLabelText('Start date')).toBeNull();
    expect(screen.queryByLabelText('End date')).toBeNull();
  });

  it('renders all columns in the drag-and-drop list for sales dataset', () => {
    render(<CustomReportScreen />);
    const items = getColumnItems();
    expect(items.length).toBe(5);
    expect(screen.getByText('Sale ID')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('toggles column selection on checkbox click', async () => {
    render(<CustomReportScreen />);
    const checkboxes = getColumnCheckboxes();
    expect(checkboxes[0]!.checked).toBe(true);

    fireEvent.click(checkboxes[0]!);
    await waitFor(() => {
      const updated = getColumnCheckboxes();
      expect(updated[0]!.checked).toBe(false);
    });

    fireEvent.click(getColumnCheckboxes()[0]!);
    await waitFor(() => {
      const updated = getColumnCheckboxes();
      expect(updated[0]!.checked).toBe(true);
    });
  });

  it('shows selected count', () => {
    render(<CustomReportScreen />);
    expect(screen.getByText('5 / 5 selected')).toBeTruthy();
  });

  it('updates selected count when toggling a column', async () => {
    render(<CustomReportScreen />);
    const checkboxes = getColumnCheckboxes();

    fireEvent.click(checkboxes[0]!);
    await waitFor(() => {
      expect(screen.getByText(/4 \/ 5 selected/)).toBeTruthy();
    });

    fireEvent.click(checkboxes[1]!);
    await waitFor(() => {
      expect(screen.getByText(/3 \/ 5 selected/)).toBeTruthy();
    });
  });

  it('filters columns by search term', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Search columns'), { target: { value: 'total' } });
    const items = getColumnItems();
    expect(items.length).toBe(1);
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('shows no-match message when search yields no results', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Search columns'), { target: { value: 'zzzznotexist' } });
    expect(screen.getByText('No columns match your search')).toBeTruthy();
  });

  it('clears search when clicking clear button', () => {
    render(<CustomReportScreen />);
    const searchInput = screen.getByLabelText('Search columns') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'total' } });
    expect(searchInput.value).toBe('total');

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(searchInput.value).toBe('');
  });

  it('switches columns when dataset changes', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'inventory' } });
    const items = getColumnItems();
    expect(items.length).toBe(6);
    expect(screen.getByText('SKU')).toBeTruthy();
    expect(screen.getByText('Barcode')).toBeTruthy();
  });

  it('switches to customers dataset', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'customers' } });
    const items = getColumnItems();
    expect(items.length).toBe(7);
    expect(screen.getByText('Customer ID')).toBeTruthy();
    expect(screen.getByText('Loyalty Points')).toBeTruthy();
  });

  it('switches to staff dataset', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'staff' } });
    const items = getColumnItems();
    expect(items.length).toBe(5);
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Display Name')).toBeTruthy();
  });

  it('shows date pickers for customers', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'customers' } });
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByLabelText('End date')).toBeTruthy();
  });

  it('hides date pickers for staff', () => {
    render(<CustomReportScreen />);
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'staff' } });
    expect(screen.queryByLabelText('Start date')).toBeNull();
  });

  it('runs report and shows results', async () => {
    render(<CustomReportScreen />);
    fireEvent.click(screen.getByText('Run Report'));

    await waitFor(() => {
      expect(screen.getByText('Results')).toBeTruthy();
    });
    // Sale ID appears in both column list and table header — use getAllByText
    const saleIdElements = screen.getAllByText('Sale ID');
    expect(saleIdElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Total').length).toBeGreaterThanOrEqual(1);
  });

  it('disables Run Report button when no columns selected', async () => {
    render(<CustomReportScreen />);
    const checkboxes = getColumnCheckboxes();
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }
    await waitFor(() => {
      const runBtn = screen.getByRole('button', { name: /run report/i });
      expect(runBtn).toBeDisabled();
    });
  });

  it('shows error message when API call fails', async () => {
    const { buildCustomReport } = await import('@/api/reports');
    vi.mocked(buildCustomReport).mockRejectedValueOnce(new Error('Server is down'));

    render(<CustomReportScreen />);
    fireEvent.click(screen.getByText('Run Report'));

    await waitFor(() => {
      expect(screen.getByText(/Server is down/)).toBeTruthy();
    });
  });
});
