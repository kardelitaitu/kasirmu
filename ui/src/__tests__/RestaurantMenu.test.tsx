import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { withFluent } from '@/locales/test-utils';
import userEvent from '@testing-library/user-event';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';
import type { Product } from '@/types/domain';
import sharedFtl from '@/locales/shared.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';

const mockSessionUserId = { current: 'user-1' };
const mockSessionToken = { current: null as string | null };

const mockProducts = [
  {
    sku: 'NASI-GORENG', name: 'Nasi Goreng', category: 'Makanan',
    productType: 'restaurant', price: { minor_units: 25000, currency: 'IDR' },
    inStock: true, createdAt: '2026-01-01',
  },
  {
    sku: 'ES-TEH', name: 'Es Teh', category: 'Minuman',
    productType: 'restaurant', price: { minor_units: 5000, currency: 'IDR' },
    inStock: true, createdAt: '2026-01-02',
  },
] as Product[];

const mockUseProducts = vi.fn();
const mockGoToWorkspacePicker = vi.fn();
const mockLogout = vi.fn();
const mockToggleTheme = vi.fn();
const mockToggleFullscreen = vi.fn();
const mockGetUserPreferences = vi.fn();
const mockSetUserPreferences = vi.fn();

vi.mock('@/features/products/useProducts', () => ({
  useProducts: (...args: unknown[]) => mockUseProducts(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'restaurant-pos',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: mockSessionToken.current,
    swapSessionToken: vi.fn(),
  }),
}));

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: mockGoToWorkspacePicker }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: mockSessionUserId.current, username: 'test', role_name: 'cashier', token: 't', role_id: 'r', display_name: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: (...args: unknown[]) => mockLogout(...args),
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/frontend/shell/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: mockToggleTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => ({ toggleFullscreen: mockToggleFullscreen }),
}));

vi.mock('@/api/settings', () => ({
  // @deprecated kept for backward compat; RestaurantMenu uses getUserPreferencesScoped
  getUserPreferences: (...args: unknown[]) => mockGetUserPreferences(...args),
  getUserPreferencesScoped: (...args: unknown[]) => mockGetUserPreferences(...args),
  setUserPreferences: (...args: unknown[]) => mockSetUserPreferences(...args),
  setUserPreferencesScoped: (...args: unknown[]) => mockSetUserPreferences(...args),
}));

beforeEach(() => {
  mockUseProducts.mockReset();
  mockGoToWorkspacePicker.mockReset();
  mockLogout.mockReset();
  mockToggleTheme.mockReset();
  mockToggleFullscreen.mockReset();
  mockGetUserPreferences.mockReset().mockResolvedValue({});
  mockSetUserPreferences.mockReset().mockResolvedValue(undefined);

  localStorage.clear();
  mockSessionUserId.current = 'user-1';
  mockSessionToken.current = null;
  mockUseProducts.mockReturnValue({
    products: mockProducts,
    categories: ['Makanan', 'Minuman'],
    categoryMeta: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  });
});

afterEach(() => {
  localStorage.clear();
});

function renderMenu(props: { onAddProduct?: (product: Product) => void } = {}) {
  const { onAddProduct } = props;
  // LOAD-05: the loading label resolves via requiredLocalized, so the
  // products bundle (restaurant-menu-loading) must be present.
  return renderWithFluentSync(<RestaurantMenu onAddProduct={onAddProduct!} />, sharedFtl, productsFtl);
}

describe('RestaurantMenu', () => {
  it('shows loading state', () => {
    mockUseProducts.mockReturnValue({ products: [], categories: [], categoryMeta: [], loading: true });
    renderMenu();
    expect(screen.getByText('Loading menu…')).toBeTruthy();
  });

  it('shows empty state', () => {
    mockUseProducts.mockReturnValue({ products: [], categories: [], categoryMeta: [], loading: false, error: null, reload: vi.fn() });
    renderMenu();
    // Real bundle value (products.ftl) now that the bundle is loaded.
    expect(screen.getByText('Menu is empty')).toBeTruthy();
  });

  it('does not leak pinned card state when the authenticated user changes', async () => {
    const renderResult = renderMenu();
    const user = userEvent.setup();
    const nasiCard = screen.getByRole('button', { name: /Nasi Goreng.*Add/i });

    fireEvent.contextMenu(nasiCard, { clientX: 100, clientY: 200 });
    await user.click(screen.getByRole('menuitem', { name: 'Pin to top' }));
    expect(nasiCard).toHaveClass('restaurant-card--pinned');

    localStorage.setItem('restaurant-user-2-pinned', JSON.stringify(['ES-TEH']));
    mockSessionUserId.current = 'user-2';
    renderResult.rerender(withFluent(<RestaurantMenu />, sharedFtl, productsFtl));

    const userTwoCards = screen.getAllByRole('button', { name: /Rp .*Add/ });
    expect(userTwoCards[0]).toHaveAccessibleName(/Es Teh.*Add/);
    expect(screen.getByRole('button', { name: /Nasi Goreng.*Add/i })).not.toHaveClass('restaurant-card--pinned');
    expect(localStorage.getItem('restaurant-user-2-pinned')).toBe(JSON.stringify(['ES-TEH']));
  });

  it('closes a previous user context menu and clears transient card feedback on user change', async () => {
    const renderResult = renderMenu();
    const user = userEvent.setup();
    const nasiCard = screen.getByRole('button', { name: /Nasi Goreng.*Add/i });

    fireEvent.contextMenu(nasiCard, { clientX: 100, clientY: 200 });
    expect(screen.getByRole('menuitem', { name: 'Pin to top' })).toBeTruthy();
    await user.click(nasiCard);
    expect(nasiCard).toHaveClass('restaurant-card--added');

    mockSessionUserId.current = 'user-2';
    renderResult.rerender(withFluent(<RestaurantMenu />, sharedFtl, productsFtl));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Nasi Goreng.*Add/i })).not.toHaveClass('restaurant-card--added');
  });

  it('reorders cards when popularity changes after an item is added', async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Popularity' }));

    const esTeh = screen.getByRole('button', { name: /Es Teh.*Add/i });
    await user.click(esTeh);

    const cards = screen.getAllByRole('button', { name: /Rp .*Add/ });
    expect(cards[0]).toHaveAccessibleName(/Es Teh.*Add/);
  });

  it('keeps card actions usable when menu persistence storage is unavailable', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const onAddProduct = vi.fn();
      renderMenu({ onAddProduct });
      const card = screen.getByRole('button', { name: /Nasi Goreng.*Add/i });

      fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
      await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }));
      expect(card).toHaveClass('restaurant-card--pinned');

      await userEvent.click(card);
      expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('renders product cards as non-selectable buttons without changing search selection', () => {
    renderMenu();
    const card = screen.getByRole('button', { name: /Nasi Goreng.*Rp 25\.000.*Add/i });
    const input = screen.getByRole('searchbox', { name: 'Search menu items' });

    expect(card).toHaveClass('restaurant-card');
    // The card's CSS disables selection while the search field explicitly
    // remains selectable for operators who need to copy a query.
    expect(input).toHaveStyle({ userSelect: 'text' });
  });

  it('renders product cards with localized prices and accessible add labels', () => {
    renderMenu();
    expect(screen.getByText('Nasi Goreng')).toBeTruthy();
    expect(screen.getByText('Es Teh')).toBeTruthy();
    expect(screen.getByText('Rp 25.000')).toBeTruthy();
    expect(screen.getByText('Rp 5.000')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Nasi Goreng.*Rp 25\.000.*Add/i })).toBeTruthy();
  });

  it('shows a visible and accessible unavailable status without adding the card', async () => {
    mockUseProducts.mockReturnValue({
      products: [{ ...mockProducts[0]!, inStock: false }, mockProducts[1]!],
      categories: ['Makanan', 'Minuman'],
      categoryMeta: [],
      loading: false,
    });
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const card = screen.getByRole('button', { name: /Nasi Goreng.*Unavailable/i });
    expect(card.querySelector('.restaurant-card-status')).toHaveTextContent('Unavailable');
    expect(card.querySelectorAll('.restaurant-card-status')).toHaveLength(1);
    // The disabled add affordance is now an icon-only minus badge (no text).
    expect(card.querySelector('.restaurant-card-add-icon--disabled .restaurant-card-add-badge')).toBeTruthy();
    expect(card).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(card);
    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it('swaps the add badge to a check while the added flash is showing', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await user.click(card);
    expect(card).toHaveClass('restaurant-card--added');
    // Added flash: the badge glyph is the check path.
    expect(card.querySelector('.restaurant-card-add-badge path')?.getAttribute('d')).toBe('M8.5 12.5l2.5 2.5 4.5-5');

    // After the 400ms flash expires the plus glyph returns.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(card).not.toHaveClass('restaurant-card--added');
    expect(card.querySelector('.restaurant-card-add-badge path')?.getAttribute('d')).toBe('M12 8v8M8 12h8');
  });

  it('does not offer a local availability toggle for source-unavailable products', async () => {
    mockUseProducts.mockReturnValue({
      products: [{ ...mockProducts[0]!, inStock: false }, mockProducts[1]!],
      categories: ['Makanan', 'Minuman'],
      categoryMeta: [],
      loading: false,
    });
    renderMenu();
    const card = screen.getByRole('button', { name: /Nasi Goreng.*Unavailable/i });

    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });

    expect(screen.queryByRole('menuitem', { name: 'Mark unavailable' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Mark available' })).toBeNull();
    expect(card).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders category pills', () => {
    renderMenu();
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Makanan')).toBeTruthy();
    expect(screen.getByText('Minuman')).toBeTruthy();
  });

  it('moves between category tabs with arrows and roves the Tab stop', async () => {
    renderMenu();
    const user = userEvent.setup();
    const all = screen.getByRole('tab', { name: 'All' });
    const makanan = screen.getByRole('tab', { name: 'Makanan' });
    const minuman = screen.getByRole('tab', { name: 'Minuman' });
    // Active tab holds the single Tab stop.
    expect(all).toHaveAttribute('tabindex', '0');
    expect(makanan).toHaveAttribute('tabindex', '-1');

    all.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(makanan);
    // Arrows move focus only — manual activation, so no refilter yet.
    expect(screen.getByText('Es Teh')).toBeTruthy();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(minuman);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(all);
    // Enter activates the focused tab.
    makanan.focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Nasi Goreng')).toBeNull();
    expect(screen.getByText('Es Teh')).toBeTruthy();
  });

  it('derives category pills from restaurant products only', () => {
    const retailProduct = {
      sku: 'RETAIL-COFFEE', name: 'Retail Coffee', category: 'Retail Only',
      productType: 'retail', price: { minor_units: 1000, currency: 'IDR' },
      inStock: true, createdAt: '2026-01-03',
    } as Product;
    mockUseProducts.mockReturnValue({
      products: [...mockProducts, retailProduct],
      categories: ['Makanan', 'Minuman', 'Retail Only'],
      categoryMeta: [],
      loading: false,
    });

    renderMenu();

    expect(screen.getByText('Makanan')).toBeTruthy();
    expect(screen.getByText('Minuman')).toBeTruthy();
    expect(screen.queryByText('Retail Only')).toBeNull();
    expect(screen.queryByText('Retail Coffee')).toBeNull();
  });

  it('falls back to All when the selected category disappears after a refresh', async () => {
    const updatedProducts = [mockProducts[0]!];
    mockUseProducts.mockReturnValue({
      products: mockProducts,
      categories: ['Makanan', 'Minuman'],
      categoryMeta: [],
      loading: false,
    });
    const renderResult = renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Minuman'));
    expect(screen.getByText('Es Teh')).toBeTruthy();

    mockUseProducts.mockReturnValue({
      products: updatedProducts,
      categories: ['Makanan'],
      categoryMeta: [],
      loading: false,
    });
    renderResult.rerender(withFluent(<RestaurantMenu />, sharedFtl, productsFtl));

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Nasi Goreng')).toBeTruthy();
  });

  it('filters by category', async () => {
    renderMenu();
    const user = userEvent.setup();

    await user.click(screen.getByText('Makanan'));

    expect(screen.getByText('Nasi Goreng')).toBeTruthy();
    expect(screen.queryByText('Es Teh')).toBeNull();
  });

  it('disables browser saved-info/autofill on the menu search field', () => {
    renderMenu();
    const input = screen.getByRole('searchbox', { name: 'Search menu items' });

    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('data-1p-ignore', 'true');
    expect(input).toHaveAttribute('data-lpignore', 'true');
    expect(input).toHaveAttribute('data-bwignore', 'true');
  });

  it('allows selecting text in the search field', () => {
    renderMenu();
    const input = screen.getByRole('searchbox', { name: 'Search menu items' });

    expect(input).toHaveClass('restaurant-search-input');
    expect(input).toHaveStyle({ userSelect: 'text' });
  });

  it('filters by search query', async () => {
    renderMenu();
    const input = document.querySelector('.restaurant-search-input') as HTMLInputElement;

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )?.set;
      nativeSetter?.call(input, 'Teh');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(screen.queryByText('Nasi Goreng')).toBeNull();
    expect(screen.getByText('Es Teh')).toBeTruthy();
  });

  it('supports long-press context menu on touch without adding the card', async () => {
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
      await new Promise((resolve) => setTimeout(resolve, 550));
      fireEvent.pointerUp(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    });

    await waitFor(() => expect(screen.getByText('Pin to top')).toBeTruthy());
    expect(onAddProduct).not.toHaveBeenCalled();
    expect(screen.queryByText('Nasi Goreng')).toBeTruthy();

    // Dismissing the touch menu must not poison the next legitimate tap.
    await userEvent.keyboard('{Escape}');
    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerUp(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.click(card);
    expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
  });

  it('adds on a normal touch tap without opening the context menu', async () => {
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerUp(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.click(card);

    expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
    expect(screen.queryByText('Pin to top')).toBeNull();
  });

  it('cancels long-press when the pointer leaves or is cancelled', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerLeave(card, { pointerType: 'touch' });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(screen.queryByText('Pin to top')).toBeNull();

    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerCancel(card, { pointerType: 'touch' });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(screen.queryByText('Pin to top')).toBeNull();
  });

  it('does not trigger long-press after touch movement beyond the touch slop', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 140, clientY: 200 });
    fireEvent.pointerUp(card, { pointerType: 'touch', clientX: 140, clientY: 200 });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(screen.queryByText('Pin to top')).toBeNull();
  });

  it('keeps a long-press alive through harmless touch jitter', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
      fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 102, clientY: 201 });
      await new Promise((resolve) => setTimeout(resolve, 550));
    });

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Pin to top' })).toBeTruthy());
  });

  it('uses native button semantics without nested heading content', () => {
    renderMenu();
    const card = screen.getByRole('button', { name: /Nasi Goreng.*Add/i });

    expect(card.tagName).toBe('BUTTON');
    expect(card.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(card).toHaveAttribute('aria-label', 'Nasi Goreng, Rp 25.000, Add');
  });

  it('keeps long names readable at the largest persisted card and font settings', () => {
    const longProduct = {
      ...mockProducts[0]!,
      name: 'Nasi Goreng Spesial dengan Telur Mata Sapi dan Sambal Tradisional',
    };
    localStorage.setItem('restaurant-user-1-cardsize', '4');
    localStorage.setItem('restaurant-user-1-fontsize', '4');
    mockUseProducts.mockReturnValue({
      products: [longProduct],
      categories: ['Makanan'],
      categoryMeta: [],
      loading: false,
    });

    renderMenu();

    const card = screen.getByRole('button', { name: /Nasi Goreng Spesial/ });
    expect(card).toHaveTextContent('Rp 25.000');
    expect(card).toHaveClass('restaurant-card');
  });

  it('calls onAddProduct when a card is clicked', async () => {
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const user = userEvent.setup();

    await user.click(screen.getByText('Nasi Goreng'));

    expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
  });

  it('opens hamburger menu', async () => {
    renderMenu();
    const user = userEvent.setup();
    const hamburger = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;

    await user.click(hamburger);

    await waitFor(() => {
      expect(screen.getByText('Manual')).toBeTruthy();
    });
  });

  it('closes the hamburger menu with Escape and restores focus to its trigger', async () => {
    renderMenu();
    const user = userEvent.setup();
    const hamburger = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;

    hamburger.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Manual')).toBeTruthy());
    expect(document.activeElement?.textContent).toContain('Manual');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText('Manual')).toBeNull());
    expect(document.activeElement).toBe(hamburger);
  });

  it('supports keyboard navigation within the hamburger menu', async () => {
    renderMenu();
    const user = userEvent.setup();
    const hamburger = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;

    await user.click(hamburger);
    await waitFor(() => expect(screen.getByText('Manual')).toBeTruthy());

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('A–Z');
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toContain('Toggle Fullscreen');
    await user.keyboard('{Home}');
    expect(document.activeElement?.textContent).toContain('Manual');
  });

  it('does not let the app-search shortcut steal focus while the hamburger menu is open', async () => {
    renderMenu();
    const user = userEvent.setup();
    const hamburger = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;

    await user.click(hamburger);
    await waitFor(() => expect(screen.getByText('Manual')).toBeTruthy());
    window.dispatchEvent(new Event('app-search'));

    expect(document.activeElement).not.toBe(screen.getByRole('searchbox', { name: 'Search menu items' }));
  });

  it('does not let global typing shortcuts steal focus while the hamburger menu is open', async () => {
    renderMenu();
    const user = userEvent.setup();
    const hamburger = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;

    await user.click(hamburger);
    await waitFor(() => expect(screen.getByText('Manual')).toBeTruthy());
    await user.keyboard('x');

    expect(screen.queryByDisplayValue('x')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Manual');
  });

  it('keeps a newer local menu-size change when an older preference response resolves late', async () => {
    let resolvePreferences: (preferences: Record<string, string>) => void = () => {};
    mockSessionToken.current = 'session-1';
    mockGetUserPreferences.mockReturnValueOnce(new Promise<Record<string, string>>((resolve) => {
      resolvePreferences = resolve;
    }));

    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Increase size' }));

    expect(localStorage.getItem('restaurant-user-1-cardsize')).toBe('1');

    await act(async () => {
      resolvePreferences({ cardsize: '0' });
    });

    expect(document.querySelectorAll('.restaurant-size-value')[0]).toHaveTextContent('1');
    expect(localStorage.getItem('restaurant-user-1-cardsize')).toBe('1');
  });

  it('rehydrates backend preferences when the session token rotates', async () => {
    mockSessionToken.current = 'session-1';
    mockGetUserPreferences.mockResolvedValueOnce({});
    const renderResult = renderMenu();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Increase size' }));
    expect(document.querySelectorAll('.restaurant-size-value')[0]).toHaveTextContent('1');

    mockSessionToken.current = 'session-2';
    mockGetUserPreferences.mockResolvedValueOnce({ cardsize: '3' });
    renderResult.rerender(withFluent(<RestaurantMenu />, sharedFtl, productsFtl));

    await waitFor(() => expect(document.querySelectorAll('.restaurant-size-value')[0]).toHaveTextContent('3'));
  });

  it('persists hamburger menu settings through the scoped preference API', async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement);

    await user.click(screen.getByRole('button', { name: 'Increase size' }));
    expect(mockSetUserPreferences).not.toHaveBeenCalled();

    // The test workspace has no session token, so local persistence is used.
    expect(localStorage.getItem('restaurant-user-1-cardsize')).toBe('1');
  });

  it('does not add an unavailable card to the sale', async () => {
    const unavailableProduct = { ...mockProducts[0]!, inStock: false };
    mockUseProducts.mockReturnValue({
      products: [unavailableProduct, mockProducts[1]!],
      categories: ['Makanan', 'Minuman'],
      categoryMeta: [],
      loading: false,
    });
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const user = userEvent.setup();

    await user.click(screen.getByText('Nasi Goreng'));

    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it('falls back to safe context-menu coordinates when touch coordinates are unavailable', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      fireEvent.pointerDown(card, { pointerType: 'touch' });
      await new Promise((resolve) => setTimeout(resolve, 550));
      fireEvent.pointerUp(card, { pointerType: 'touch' });
    });

    await waitFor(() => expect(screen.getByText('Pin to top')).toBeTruthy());
    expect(document.querySelector('.restaurant-context-menu')).not.toHaveStyle({ left: 'NaNpx', top: 'NaNpx' });
  });

  it('shows context menu on right-click', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
    });

    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });
  });

  it('shows empty state when no products match filter', () => {
    mockUseProducts.mockReturnValue({ products: [], categories: ['Makanan'], categoryMeta: [], loading: false, error: null, reload: vi.fn() });
    renderMenu();
    expect(screen.getByText('Menu is empty')).toBeTruthy();
  });

  it('shows the no-match state with a clear-search recovery when a filter empties the grid', async () => {
    renderMenu();
    const user = userEvent.setup();
    const searchbox = screen.getByRole('searchbox', { name: 'Search menu items' });
    await user.type(searchbox, 'zzz-no-such-item');
    await waitFor(() => expect(screen.getByText('No items match your search')).toBeTruthy());
    // The search box's own × ("Clear search input") and the grid recovery
    // ("Clear search") share a substring; scope to the empty-state panel.
    const empty = screen.getByText('No items match your search').closest('.restaurant-empty')!;
    const gridClear = empty.querySelector('.restaurant-empty-retry') as HTMLButtonElement;
    await user.click(gridClear);
    await waitFor(() => expect(screen.queryByText('No items match your search')).toBeNull());
    expect(screen.getByText('Nasi Goreng')).toBeTruthy();
  });

  it('shows the fetch error with a retry action instead of an empty catalog', async () => {
    const reload = vi.fn();
    mockUseProducts.mockReturnValue({ products: [], categories: [], categoryMeta: [], loading: false, error: 'IPC unavailable', reload });
    renderMenu();
    expect(screen.getByText('IPC unavailable')).toBeTruthy();
    expect(screen.queryByText('Menu is empty')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('marks a product unavailable via the context menu and blocks adding it', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
    });

    await waitFor(() => {
      expect(screen.getByText('Mark unavailable')).toBeTruthy();
    });
    await user.click(screen.getByText('Mark unavailable'));

    // The menu closes and the card reads as blocked: aria-disabled plus the
    // Unavailable badge (the card stays visible — it is not hidden).
    await waitFor(() => {
      expect(screen.queryByText('Mark unavailable')).toBeNull();
    });
    const blocked = screen.getByRole('button', { name: /Nasi Goreng.*Unavailable/i });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked.textContent).toContain('Unavailable');
  });

  // ── A11Y-06: context menu keyboard operability (WAI-ARIA menu pattern) ──

  it('opens the context menu via Shift+F10 and moves focus to the first menuitem', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    card.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');

    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });
    // Keyboard-open must move focus into the menu (first menuitem).
    expect(document.activeElement?.textContent).toContain('Pin to top');
  });

  it('opens the context menu via the ContextMenu key', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    card.focus();
    await user.keyboard('{ContextMenu}');

    await waitFor(() => {
      expect(screen.getByText('Mark unavailable')).toBeTruthy();
    });
  });

  it('supports ArrowUp/ArrowDown roving focus between menuitems', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    card.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });

    // First menuitem is focused after open; ArrowDown moves to the second.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Mark unavailable');

    // ArrowUp wraps back to the first.
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toContain('Pin to top');
  });

  it('roves ArrowDown from the last menuitem into the colour swatches', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    card.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });

    // First menuitem focused on open; ArrowDown walks the menuitems, then
    // reaches the first swatch instead of stranding above the palette.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Mark unavailable');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.classList.contains('restaurant-context-swatch')).toBe(true);
  });

  it('closes the context menu via Escape and restores focus to the card', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    card.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Pin to top')).toBeNull();
    });
    // Focus must return to the triggering card (not the body).
    expect(document.activeElement).toBe(card);
  });

  it('preserves search text when Escape closes the context menu', async () => {
    renderMenu();
    const user = userEvent.setup();
    const input = screen.getByRole('searchbox', { name: 'Search menu items' });
    await user.type(input, 'Teh');
    const card = screen.getByText('Es Teh').closest('button')!;

    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
    });
    await waitFor(() => expect(screen.getByText('Pin to top')).toBeTruthy());
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('Teh');
  });

  it('closes the pointer-opened context menu via Escape without moving focus into the menu', async () => {
    renderMenu();
    const user = userEvent.setup();
    const card = screen.getByText('Nasi Goreng').closest('button')!;
    const focusedBefore = document.activeElement;

    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
    });
    await waitFor(() => {
      expect(screen.getByText('Pin to top')).toBeTruthy();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Pin to top')).toBeNull();
    });
    // Pointer-open must not steal focus into the menu or force-restore it —
    // the element focused before opening stays focused after Escape.
    expect(document.activeElement).toBe(focusedBefore);
  });

  it('pins a card from the context menu and persists its order', async () => {
    renderMenu();
    const card = screen.getByText('Es Teh').closest('button')!;

    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }));

    const cards = screen.getAllByRole('button', { name: /Rp .*Add/ });
    expect(cards[0]).toHaveAccessibleName(/Es Teh.*Add/);
    expect(localStorage.getItem('restaurant-user-1-pinned')).toBe(JSON.stringify(['ES-TEH']));

    const rerenderedCard = screen.getByRole('button', { name: /Es Teh.*Add/ });
    expect(rerenderedCard).toHaveClass('restaurant-card--pinned');
  });

  it('marks a card unavailable and available again without allowing checkout while unavailable', async () => {
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark unavailable' }));

    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveAccessibleName(/Nasi Goreng.*Unavailable/);
    expect(localStorage.getItem('restaurant-user-1-unavail')).toBe(JSON.stringify(['NASI-GORENG']));
    await userEvent.click(card);
    expect(onAddProduct).not.toHaveBeenCalled();

    // The source product is available in this test; only the local override
    // should be removable through the context menu.
    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark available' }));
    expect(card).toHaveAttribute('aria-disabled', 'false');

    await userEvent.click(card);
    expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
  });

  it('persists and clears a custom card color from the context menu', async () => {
    renderMenu();
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    await userEvent.click(screen.getByRole('button', { name: 'Color Red' }));

    expect(card.style.getPropertyValue('--btn-color')).toBe('#ef4444');
    expect(localStorage.getItem('restaurant-user-1-colors')).toBe(JSON.stringify({ 'NASI-GORENG': '#ef4444' }));

    fireEvent.contextMenu(card, { clientX: 100, clientY: 200 });
    await userEvent.click(screen.getByRole('button', { name: 'Clear color' }));

    expect(card.style.getPropertyValue('--btn-color')).toBe('var(--color-accent)');
    expect(localStorage.getItem('restaurant-user-1-colors')).toBe('{}');
  });

  it('does not let a touch long-press suppress the next keyboard activation', async () => {
    const onAddProduct = vi.fn();
    renderMenu({ onAddProduct });
    const card = screen.getByText('Nasi Goreng').closest('button')!;

    await act(async () => {
      fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
      await new Promise((resolve) => setTimeout(resolve, 550));
      fireEvent.pointerUp(card, { pointerType: 'touch', clientX: 100, clientY: 200 });
    });
    await waitFor(() => expect(screen.getByText('Pin to top')).toBeTruthy());

    await userEvent.keyboard('{Escape}');
    card.focus();
    await userEvent.keyboard('{Enter}');

    expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'NASI-GORENG' }));
  });
});
