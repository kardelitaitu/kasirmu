import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import WarehouseQuotaChip from '@/features/locations/WarehouseQuotaChip';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';

describe('WarehouseQuotaChip', () => {
  it('renders ok state within the cap', () => {
    renderWithFluentSync(<WarehouseQuotaChip count={1} maxWarehouses={3} />, multiStoreFtl);
    expect(screen.getByText('Warehouses: 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('topology-warehouse-quota--ok');
  });
  it('renders at-limit state', () => {
    renderWithFluentSync(<WarehouseQuotaChip count={2} maxWarehouses={2} />, multiStoreFtl);
    expect(screen.getByText('Warehouses: 2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('topology-warehouse-quota--at');
  });
  it('renders over-limit state for the downgrade scenario', () => {
    renderWithFluentSync(<WarehouseQuotaChip count={3} maxWarehouses={2} />, multiStoreFtl);
    expect(screen.getByText('Warehouses over plan limit: 3 / 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('topology-warehouse-quota--over');
  });
  it('renders unlimited state for Premium / Enterprise', () => {
    renderWithFluentSync(<WarehouseQuotaChip count={5} maxWarehouses={null} />, multiStoreFtl);
    expect(screen.getByText('Warehouses: 5 (unlimited)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('topology-warehouse-quota--unlimited');
  });
});
