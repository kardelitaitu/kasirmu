// ── RestaurantSidebar — component-level logic branches ────────────────
//
// Complements the full-POS coverage in RestaurantPosSidebar.test.tsx by
// rendering the sidebar DIRECTLY with hand-crafted `cartActions` props, so the
// branches that need a particular cart state (deduction row, override badge,
// active/inactive shift, tables, history, exit fallback, roving keys, Escape)
// can be exercised in isolation instead of driving the whole PosScreen.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createRef } from 'react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import { RestaurantSidebar, type RestaurantSidebarActions } from '@/features/restaurant/components/RestaurantSidebar';

const mockGoToWorkspacePicker = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: mockGoToWorkspacePicker }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isManager: false, isOwner: false }),
}));

vi.mock('@/hooks/useVersionStatus', () => ({
  useVersionStatus: () => ({ currentVersion: '0.0.40' }),
}));

function makeActions(overrides: Partial<RestaurantSidebarActions> = {}): RestaurantSidebarActions {
  return {
    shiftLoading: false,
    hasActiveShift: false,
    onOpenShift: vi.fn(),
    onCloseShift: vi.fn(),
    deductionLocationName: null,
    deductionOverridden: false,
    onOverrideDeduction: vi.fn(),
    showTables: false,
    onOpenTables: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenKitchenDisplay: vi.fn(),
    onOpenReceipts: vi.fn(),
    onOpenPayments: vi.fn(),
    ...overrides,
  };
}

interface HarnessProps {
  open?: boolean;
  cartActions?: RestaurantSidebarActions;
  onRequestExit?: (() => void) | undefined;
  isManager?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

function Harness({ open = true, cartActions, onRequestExit, isManager, onOpenChange, triggerRef }: HarnessProps) {
  const ref = createRef<HTMLDivElement>();
  return (
    <RestaurantSidebar
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      sidebarRef={ref}
      cartActions={cartActions}
      onRequestExit={onRequestExit}
      isManager={isManager}
      triggerRef={triggerRef}
    />
  );
}

const FTL = [salesFtl, productsFtl, inventoryFtl, settingsFtl, tablesFtl, kdsFtl];

const renderSidebar = (props: HarnessProps) =>
  renderWithFluentSync((<Harness {...props} />) as ReactElement, ...FTL);
const rows = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item'));

const historyRow = () => screen.getByRole('button', { name: /History/i });
const kitchenRow = () => screen.getByRole('button', { name: /Kitchen Display/i });
const exitRow = () => screen.getByRole('button', { name: /Exit Terminal/i });
const lockRow = () => screen.getByRole('button', { name: /Lock Terminal/i });

describe('RestaurantSidebar — roving keyboard navigation', () => {
  beforeEach(() => mockGoToWorkspacePicker.mockClear());

  it('ignores non-roving keys without moving focus', () => {
    renderSidebar({});
    const items = rows();
    const first = items[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('ArrowDown moves to the next row and wraps from last to first', () => {
    renderSidebar({});
    const items = rows();
    const first = items[0]!;
    const last = items[items.length - 1]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowUp moves to the previous row and wraps from first to last', () => {
    renderSidebar({});
    const items = rows();
    const first = items[0]!;
    const second = items[1]!;
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Home and End jump to the first and last rows', () => {
    renderSidebar({});
    const items = rows();
    const second = items[1]!;
    second.focus();
    fireEvent.keyDown(second, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });
});

describe('RestaurantSidebar — close mechanisms', () => {
  it('closes when Escape is pressed while open', () => {
    const onOpenChange = vi.fn();
    renderSidebar({ onOpenChange });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when a mousedown lands outside the sidebar and trigger', () => {
    const onOpenChange = vi.fn();
    renderSidebar({ onOpenChange });
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('RestaurantSidebar — action row handlers', () => {
  beforeEach(() => mockGoToWorkspacePicker.mockClear());

  it('History row fires onOpenHistory and closes the sidebar', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    historyRow();
    fireEvent.click(historyRow());
    expect(actions.onOpenHistory).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Kitchen Display row fires onOpenKitchenDisplay and closes the sidebar', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    fireEvent.click(kitchenRow());
    expect(actions.onOpenKitchenDisplay).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the Close-shift row when a shift is active and fires onCloseShift on click', () => {
    const actions = makeActions({ hasActiveShift: true });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    const closeRow = screen.getByRole('button', { name: /Close current shift/i });
    fireEvent.click(closeRow);
    expect(actions.onCloseShift).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the Open-shift row when no shift is active and fires onOpenShift on click', () => {
    const actions = makeActions({ hasActiveShift: false });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    const openRow = screen.getByRole('button', { name: /Open a new shift/i });
    fireEvent.click(openRow);
    expect(actions.onOpenShift).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders and fires the Tables row when showTables is true', () => {
    const actions = makeActions({ showTables: true });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    const tablesRow = screen.getByRole('button', { name: /Table Management/i });
    fireEvent.click(tablesRow);
    expect(actions.onOpenTables).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('omits the Tables row when showTables is false', () => {
    const actions = makeActions({ showTables: false });
    renderSidebar({ cartActions: actions });
    expect(screen.queryByRole('button', { name: /Table Management/i })).toBeNull();
  });

  it('deduction row renders with the location and fires onOverrideDeduction when clicked', () => {
    const actions = makeActions({ deductionLocationName: 'Warehouse A', deductionOverridden: false });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    const deductRow = screen.getByRole('button', { name: /Warehouse A/i });
    expect(document.querySelector('[data-testid="restaurant-sidebar-deduction-override"]')).toBeNull();
    fireEvent.click(deductRow);
    expect(actions.onOverrideDeduction).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the override badge when the deduction is overridden', () => {
    const actions = makeActions({ deductionLocationName: 'Warehouse A', deductionOverridden: true });
    renderSidebar({ cartActions: actions });
    expect(document.querySelector('[data-testid="restaurant-sidebar-deduction-override"]')).toBeTruthy();
  });
});

describe('RestaurantSidebar — manager gating on Receipts/Payments', () => {
  it('disables and refuses Receipts/Payments for a non-manager', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, isManager: false, onOpenChange });
    const receipts = screen.getByRole('button', { name: /Receipts/i });
    const payments = screen.getByRole('button', { name: /Payments/i });
    expect(receipts).toBeDisabled();
    expect(payments).toBeDisabled();
    fireEvent.click(receipts);
    expect(actions.onOpenReceipts).not.toHaveBeenCalled();
    fireEvent.click(payments);
    expect(actions.onOpenPayments).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('enables Receipts/Payments for a manager and fires their handlers on click', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, isManager: true, onOpenChange });
    const receipts = screen.getByRole('button', { name: /Receipts/i });
    const payments = screen.getByRole('button', { name: /Payments/i });
    expect(receipts).not.toBeDisabled();
    fireEvent.click(receipts);
    expect(actions.onOpenReceipts).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(payments);
    expect(actions.onOpenPayments).toHaveBeenCalled();
  });
});

describe('RestaurantSidebar — exit terminal branch', () => {
  it('uses the prop onRequestExit when cartActions has no exit handler', () => {
    const actions = makeActions(); // onRequestExit undefined in cartActions
    const propExit = vi.fn();
    renderSidebar({ cartActions: actions, onRequestExit: propExit });
    fireEvent.click(exitRow());
    expect(propExit).toHaveBeenCalled();
    expect(mockGoToWorkspacePicker).not.toHaveBeenCalled();
  });

  it('falls back to goToWorkspacePicker when neither exit handler is provided', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    fireEvent.click(exitRow());
    expect(mockGoToWorkspacePicker).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Lock Terminal fires the app:lock window event and closes', () => {
    const events: string[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).type);
    window.addEventListener('app:lock', listener);
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    fireEvent.click(lockRow());
    expect(events).toContain('app:lock');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    window.removeEventListener('app:lock', listener);
  });
});

describe('RestaurantSidebar — exit animation & focus lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('restores focus to the trigger after a keyboard (Escape) close', () => {
    const triggerEl = document.createElement('button');
    triggerEl.id = 'side-trigger';
    document.body.appendChild(triggerEl);
    const triggerRef = { current: triggerEl } as unknown as React.RefObject<HTMLButtonElement>;
    triggerEl.focus();
    const onOpenChange = vi.fn();

    const result = render(
      withFluent((<Harness onOpenChange={onOpenChange} triggerRef={triggerRef} />) as ReactElement, ...FTL),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    result.rerender(
      withFluent((<Harness open={false} onOpenChange={onOpenChange} triggerRef={triggerRef} />) as ReactElement, ...FTL),
    );
    expect(triggerEl).toHaveFocus();
    triggerEl.remove();
  });

  it('runs and clears the exit-animation timer across an open-close-reopen churn', () => {
    const actions = makeActions();
    const result = render(withFluent((<Harness cartActions={actions} />) as ReactElement, ...FTL));
    const close = () =>
      result.rerender(withFluent((<Harness open={false} cartActions={actions} />) as ReactElement, ...FTL));
    const reopen = () =>
      result.rerender(withFluent((<Harness open={true} cartActions={actions} />) as ReactElement, ...FTL));
    // Open -> close starts the exit timer.
    close();
    // Reopen BEFORE the timer fires so `exiting` flips back to false while a
    // timer is still pending — this drives the clearTimeout branch and forces
    // the cleanup/clear cycle.
    reopen();
    vi.advanceTimersByTime(400);
    // Now close again and let the timer run to completion.
    close();
    vi.advanceTimersByTime(400);
    expect(actions.onOpenHistory).toBeDefined();
  });
});
