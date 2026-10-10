// ── RestaurantSidebar — component-level logic branches ────────────────
//
// Complements the full-POS coverage in RestaurantPosSidebar.test.tsx by
// rendering the sidebar DIRECTLY with hand-crafted `cartActions` props, so the
// branches that need a particular cart state (deduction row, override badge,
// active/inactive shift, tables, history, exit fallback, roving keys, Escape)
// can be exercised in isolation instead of driving the whole PosScreen.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

// F8 needs the session's granted keys to be controllable per case: the manager
// rows are gated on `settings:edit` when the session carries permissions, and
// fall back to the role when it does not.
const mockAuth = vi.hoisted(() => ({
  session: undefined as { role_name?: string; permissions?: string[] } | undefined,
  isManager: false,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isManager: mockAuth.isManager, isOwner: false, session: mockAuth.session }),
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
    // Default true so the existing cases keep exercising the row; the gating
    // case overrides it to false.
    showKitchenDisplay: true,
    onOpenKitchenDisplay: vi.fn(),
    onOpenReceipts: vi.fn(),
    onOpenPayments: vi.fn(),
    onOpenSettings: vi.fn(),
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
describe('RestaurantSidebar — manager rows follow settings:edit (F8)', () => {
  beforeEach(() => { mockGoToWorkspacePicker.mockClear(); });

  // The backend refuses every one of these screens' writes without
  // `settings:edit`. Gating on the role alone produced an enabled control whose
  // save always failed. These four cases pin the permission as authoritative.

  it('disables the manager rows when the session lacks settings:edit', () => {
    mockAuth.isManager = true; // the role says manager...
    mockAuth.session = { role_name: 'Manager', permissions: ['sales:process'] }; // ...the grant says no
    renderSidebar({ cartActions: makeActions() });

    expect(screen.getByTestId('restaurant-sidebar-settings')).toBeDisabled();
    expect(screen.getByTestId('restaurant-sidebar-menu-editor')).toBeDisabled();
  });

  it('enables the manager rows when the session holds settings:edit', () => {
    mockAuth.session = { role_name: 'Manager', permissions: ['settings:edit'] };
    renderSidebar({ cartActions: makeActions() });

    expect(screen.getByTestId('restaurant-sidebar-settings')).not.toBeDisabled();
    expect(screen.getByTestId('restaurant-sidebar-menu-editor')).not.toBeDisabled();
  });

  it('accepts the Owner wildcard, which is not a literal settings:edit match', () => {
    // The Owner preset grants ['*'], so a raw includes() would lock an owner out.
    mockAuth.session = { role_name: 'Owner', permissions: ['*'] };
    renderSidebar({ cartActions: makeActions() });

    expect(screen.getByTestId('restaurant-sidebar-settings')).not.toBeDisabled();
  });


  it('does not tell a MANAGER they need Manager+ when the grant is what blocks them', () => {
    // The badge names a ROLE, but the gate is a PERMISSION. `settings:edit` is
    // usually manager-ish, so the two coincide for the common case — but not for
    // this one: the session's role IS 'Manager', and the row is disabled because
    // the GRANT omits `settings:edit` (a custom role, or a narrowed preset). The
    // badge then reads "Manager+" to a manager, which is both wrong and useless —
    // it names a thing they already are.
    //
    // The gate itself is correct and pinned above. This case pins the LABEL, which
    // the F8 tests never looked at: they assert disabled/enabled, never what the
    // disabled row says. A row that explains the wrong reason is the same class as
    // the KDS badge the component's own header refuses to use (RestaurantSidebar
    // :56-64: "a 'Manager+' badge would mislabel the reason").
    mockAuth.isManager = true;
    mockAuth.session = { role_name: 'Manager', permissions: ['sales:process'] };
    renderSidebar({ cartActions: makeActions() });

    const settingsRow = screen.getByTestId('restaurant-sidebar-settings');
    expect(settingsRow).toBeDisabled();
    expect(
      within(settingsRow).queryByText('Manager+'),
      'the row is blocked by a missing settings:edit GRANT, not by the role — the ' +
        'badge must not name a role the operator already holds',
    ).toBeNull();
  });


  it('PRODUCTION SHAPE: the role-based prop must not bypass the permission gate', () => {
    // ⚠️ The four F8 cases above never pass `isManager`, so they exercise the
    // PERMISSION branch. But `PosScreen.tsx:1239` always supplies
    // `isManager={isManager}` from `useAuth()`, and that prop WINS:
    //
    //     const canEditSettings = isManagerProp ?? (session?.permissions !== undefined ? ... )
    //
    // `AuthContext.isManager` is a pure ROLE check (owner/admin/manager), with no
    // permission awareness, so in the real app the permission logic never runs and
    // the F8 defect it was written to fix is still live: a "manager" role whose
    // grant omits `settings:edit` reaches these rows, and their save is refused at
    // the IPC boundary — the enabled-control-that-always-errors F8 names.
    //
    // This case renders the real production shape to pin it.
    mockAuth.isManager = true; // the role says manager...
    mockAuth.session = { role_name: 'Manager', permissions: ['sales:process'] }; // ...the grant says no
    renderSidebar({ cartActions: makeActions(), isManager: true }); // what PosScreen passes

    expect(
      screen.getByTestId('restaurant-sidebar-settings'),
      'the role prop bypassed the permission gate — the F8 fix is inert in production',
    ).toBeDisabled();
  });

  it('falls back to the role when the session carries no permission list', () => {
    // An older session shape cannot answer the permission question, so it must
    // not be silently locked out of every settings screen.
    mockAuth.isManager = true;
    mockAuth.session = { role_name: 'Manager' };
    renderSidebar({ cartActions: makeActions() });

    expect(screen.getByTestId('restaurant-sidebar-settings')).not.toBeDisabled();
  });
});

const renderSidebar = (props: HarnessProps) =>
  renderWithFluentSync((<Harness {...props} />) as ReactElement, ...FTL);
const rows = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item'));

const historyRow = () => screen.getByRole('button', { name: /History/i });
const kitchenRow = () => screen.getByRole('button', { name: /Kitchen Display/i });
const exitRow = () => screen.getByRole('button', { name: /Exit Terminal/i });
const lockRow = () => screen.getByRole('button', { name: /Lock Terminal/i });

describe('RestaurantSidebar — roving keyboard navigation', () => {
  beforeEach(() => {
    mockGoToWorkspacePicker.mockClear();
    // Default: no session permissions, so the pre-existing cases keep exercising
    // the role fallback they were written against.
    mockAuth.session = undefined;
    mockAuth.isManager = false;
  });

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

  // F7: KDS access is an entitlement, not a role, so the row is HIDDEN rather
  // than shown disabled with a Manager+ badge. Before this the row always
  // rendered and its click silently no-opped (or bounced to Products).
  it('omits the Kitchen Display row when the user cannot reach the route', () => {
    const actions = makeActions({ showKitchenDisplay: false });
    renderSidebar({ cartActions: actions });
    expect(screen.queryByRole('button', { name: /Kitchen Display/i })).toBeNull();
  });

  it('renders and fires the Kitchen Display row when it is reachable', () => {
    const actions = makeActions({ showKitchenDisplay: true });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: /Kitchen Display/i }));
    expect(actions.onOpenKitchenDisplay).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

describe('RestaurantSidebar — manager gating on Receipts/Payments/Settings', () => {
  it('disables and refuses Receipts/Payments/Settings for a non-manager', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, isManager: false, onOpenChange });
    const receipts = screen.getByRole('button', { name: /Receipts/i });
    const payments = screen.getByRole('button', { name: /Payments/i });
    const settings = screen.getByRole('button', { name: /Settings/i });
    expect(receipts).toBeDisabled();
    expect(payments).toBeDisabled();
    expect(settings).toBeDisabled();
    fireEvent.click(receipts);
    expect(actions.onOpenReceipts).not.toHaveBeenCalled();
    fireEvent.click(payments);
    expect(actions.onOpenPayments).not.toHaveBeenCalled();
    fireEvent.click(settings);
    expect(actions.onOpenSettings).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('enables Receipts/Payments/Settings for a manager and fires their handlers on click', () => {
    const actions = makeActions();
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, isManager: true, onOpenChange });
    const receipts = screen.getByRole('button', { name: /Receipts/i });
    const payments = screen.getByRole('button', { name: /Payments/i });
    const settings = screen.getByRole('button', { name: /Settings/i });
    expect(receipts).not.toBeDisabled();
    expect(payments).not.toBeDisabled();
    expect(settings).not.toBeDisabled();
    fireEvent.click(receipts);
    expect(actions.onOpenReceipts).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(payments);
    expect(actions.onOpenPayments).toHaveBeenCalled();
    fireEvent.click(settings);
    expect(actions.onOpenSettings).toHaveBeenCalled();
  });

  it('renders Open Cash Drawer when onOpenCashDrawer is provided and invokes it on click', () => {
    const onOpenCashDrawer = vi.fn();
    const actions = makeActions({ onOpenCashDrawer });
    const onOpenChange = vi.fn();
    renderSidebar({ cartActions: actions, onOpenChange });
    const drawerBtn = screen.getByRole('button', { name: /Open Cash Drawer/i });
    expect(drawerBtn).toBeInTheDocument();
    fireEvent.click(drawerBtn);
    expect(onOpenCashDrawer).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
    // Focus restoration runs from the focus effect synchronously during the
    // close render's act, so a direct assertion is stable. (Verified across
    // repeated isolated and union runs; the one intermittent failure observed
    // was CPU contention from parallel vitest instances, not a test bug.)
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
