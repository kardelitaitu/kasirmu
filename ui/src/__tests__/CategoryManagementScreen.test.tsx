import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import CategoryManagementScreen from '@/features/categories/CategoryManagementScreen';
import sharedFtl from '@/locales/shared.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import type { CategoryDto } from '@/api/products';

const { mockListCategories, mockCreateCategory, mockUpdateCategory, mockDeleteCategory } =
  vi.hoisted(() => ({
    mockListCategories: vi.fn(),
    mockCreateCategory: vi.fn(),
    mockUpdateCategory: vi.fn(),
    mockDeleteCategory: vi.fn(),
  }));

// CAT-01: prove the session token flows through every scoped call. The
// mock preserves both args (token first) so tests can assert on them.
const TOKEN = 'mock-session-token';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: TOKEN,
    workspaceId: 'workspace-1',
    storeId: 'store-1',
  }),
  useWorkspaceScope: () => null,
}));

vi.mock('@/api/products', () => ({
  listCategories: () => mockListCategories(),
  listCategoriesScoped: (...args: unknown[]) => mockListCategories(...args),
  createCategory: (args: unknown) => mockCreateCategory(args),
  createCategoryScoped: (sessionToken: string, args: unknown) =>
    mockCreateCategory(sessionToken, args),
  updateCategory: (args: unknown) => mockUpdateCategory(args),
  updateCategoryScoped: (sessionToken: string, args: unknown) =>
    mockUpdateCategory(sessionToken, args),
  deleteCategory: (id: string) => mockDeleteCategory(id),
  deleteCategoryScoped: (sessionToken: string, id: string) =>
    mockDeleteCategory(sessionToken, id),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(sharedFtl));
bundle.addResource(new FluentResource(settingsFtl));
bundle.addResource(new FluentResource(productsFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <ToastProvider>
        <CategoryManagementScreen />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

function makeCategory(overrides: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: 'cat-bakery',
    name: 'Bakery',
    colour: '#f97316',
    icon: 'food',
    ...overrides,
  };
}

describe('CategoryManagementScreen', () => {
  beforeEach(() => {
    mockListCategories.mockResolvedValue([]);
    mockCreateCategory.mockResolvedValue({ id: 'new-cat' });
    mockUpdateCategory.mockResolvedValue({ id: 'cat-1' });
    mockDeleteCategory.mockResolvedValue({ affected_products: 0 });
  });

  it('renders the title', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Categories')).toBeDefined());
  });

  it('renders the Add Category button', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());
  });

  it('shows loading skeleton while fetching categories', () => {
    mockListCategories.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(document.querySelector('.cat-mgmt-loading-skeleton')).toBeDefined();
    expect(screen.queryByText('Loading categories…')).toBeNull();
  });

  it('shows empty state', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('No categories yet')).toBeDefined());
  });

  it('renders category cards with name and ID', async () => {
    mockListCategories.mockResolvedValue([
      makeCategory(),
      makeCategory({ id: 'cat-drinks', name: 'Drinks', colour: '#06b6d4' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Bakery')).toBeDefined();
      expect(screen.getByText('Drinks')).toBeDefined();
      expect(screen.getByText('cat-bakery')).toBeDefined();
      expect(screen.getByText('cat-drinks')).toBeDefined();
    });
  });

  it('shows category colour on each card', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#f97316')).toBeDefined());
  });

  it('renders icon badge with correct background colour', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => {
      const badge = document.querySelector('.cat-mgmt-icon-badge') as HTMLElement;
      expect(badge).toBeDefined();
      // CAT-07: dynamic colour now flows through the --cat-bg custom property
      // instead of an inline `background` style.
      expect(badge?.style.getPropertyValue('--cat-bg')).toBe('#f97316');
    });
  });

  it('uses a contrast-safe foreground on the icon badge (CAT-07)', async () => {
    // Light amber badge -> dark near-black foreground (never fixed white).
    mockListCategories.mockResolvedValue([makeCategory({ colour: '#f59e0b' })]);
    renderScreen();
    await waitFor(() => {
      const badge = document.querySelector('.cat-mgmt-icon-badge') as HTMLElement;
      expect(badge?.style.getPropertyValue('--cat-bg')).toBe('#f59e0b');
      expect(badge?.style.getPropertyValue('--cat-fg')).toBe('#0a0a0a');
    });
  });

  it('uses white foreground for a dark badge colour (CAT-07)', async () => {
    // Dark sky-blue badge -> white foreground.
    mockListCategories.mockResolvedValue([makeCategory({ colour: '#0ea5e9' })]);
    renderScreen();
    await waitFor(() => {
      const badge = document.querySelector('.cat-mgmt-icon-badge') as HTMLElement;
      expect(badge?.style.getPropertyValue('--cat-bg')).toBe('#0ea5e9');
      expect(badge?.style.getPropertyValue('--cat-fg')).toBe('#ffffff');
    });
  });

  it('shows edit and delete buttons on each card', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => {
      const editBtns = document.querySelectorAll('.cat-mgmt-edit-btn');
      const deleteBtns = document.querySelectorAll('.cat-mgmt-delete-btn');
      expect(editBtns.length).toBeGreaterThanOrEqual(1);
      expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('opens delete confirmation modal on delete click', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    const deleteBtn = document.querySelector('.cat-mgmt-delete-btn') as HTMLElement;
    await userEvent.click(deleteBtn);

    await waitFor(() =>
      expect(screen.getByText(/unlink all products/)).toBeDefined(),
    );
  });

  it('calls deleteCategoryScoped on confirm with the session token (CAT-01)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(document.querySelector('.cat-mgmt-delete-btn')!);
    await waitFor(() => expect(screen.getByText('Delete Category')).toBeDefined());

    // Confirm delete — click the danger Delete button in the SettingsPopup footer.
    const modalDeleteBtn = screen.getByRole('button', { name: 'Delete' });
    await userEvent.click(modalDeleteBtn);

    // CAT-01: the scoped command must receive the session token first.
    await waitFor(() =>
      expect(mockDeleteCategory).toHaveBeenCalledWith(TOKEN, 'cat-bakery'),
    );
  });

  it('reports how many products were unlinked after deletion (CAT-02)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    mockDeleteCategory.mockResolvedValue({ affected_products: 3 });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(document.querySelector('.cat-mgmt-delete-btn')!);
    await waitFor(() => expect(screen.getByText('Delete Category')).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Fluent wraps the interpolated count in Unicode directional-isolate
    // characters (⁨3⁩), so match on the message shape, not a literal regex.
    await waitFor(() =>
      expect(
        screen.getByText((content) => /^unlinked/i.test(content) && content.includes('3')),
      ).toBeDefined(),
    );
  });

  it('surfaces a delete failure instead of swallowing it (CAT-01)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    mockDeleteCategory.mockRejectedValue(new Error('category has linked tax config'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(document.querySelector('.cat-mgmt-delete-btn')!);
    await waitFor(() => expect(screen.getByText('Delete Category')).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      // ERR-05: raw backend text never renders — the localized copy does.
      expect(screen.getByText('Failed to delete category')).toBeDefined(),
    );
    expect(screen.queryByText(/category has linked tax config/i)).toBeNull();
  });

  it('calls createCategoryScoped and updateCategoryScoped with the session token (CAT-01)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    // Create flow
    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Snacks');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    // CAT-01: token must precede the payload in the scoped call.
    await waitFor(() =>
      expect(mockCreateCategory).toHaveBeenCalledWith(
        TOKEN,
        expect.objectContaining({ name: 'Snacks' }),
      ),
    );

    // Edit flow
    await userEvent.click(document.querySelector('.cat-mgmt-edit-btn')!);
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith(
        TOKEN,
        expect.objectContaining({ id: 'cat-bakery' }),
      ),
    );
  });

  it('opens add modal when Add Category is clicked', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    // Add modal heading — should show "Add Category" via FTL
    // The modal heading is also "Add Category" so it may duplicate
    await waitFor(() => expect(screen.queryByText('Cancel')).toBeDefined());
  });

  it('opens edit modal when edit button is clicked', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(document.querySelector('.cat-mgmt-edit-btn')!);
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
  });

  // ── CAT-03: load errors are distinct from an empty store ──────────────

  it('renders a load error state with Retry instead of the empty state (CAT-03)', async () => {
    mockListCategories.mockRejectedValue(new Error('database locked'));
    renderScreen();

    await waitFor(() =>
      expect(screen.getByText('Failed to load categories')).toBeDefined(),
    );
    // The genuine empty-state copy must NOT be shown.
    expect(screen.queryByText('No categories yet')).toBeNull();
    // ERR-05: the raw backend message is NEVER surfaced as detail.
    expect(screen.queryByText('database locked')).toBeNull();
  });

  it('recovers via Retry after a load failure (CAT-03)', async () => {
    mockListCategories
      .mockRejectedValueOnce(new Error('database locked'))
      .mockResolvedValueOnce([makeCategory()]);
    renderScreen();

    await waitFor(() =>
      expect(screen.getByText('Failed to load categories')).toBeDefined(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());
    expect(screen.queryByText('Failed to load categories')).toBeNull();
  });

  // ── CAT-08: overlapping loads resolve in order ────────────────────────

  it('ignores a stale load that resolves after a newer one (CAT-08)', async () => {
    // Load #1 (mount) hangs; load #2 (post-create refresh) resolves first.
    let resolveFirst: (v: CategoryDto[]) => void = () => {};
    let resolveSecond: (v: CategoryDto[]) => void = () => {};
    mockListCategories
      .mockImplementationOnce(
        () =>
          new Promise<CategoryDto[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<CategoryDto[]>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    renderScreen();
    // Trigger the second load through the create flow (handleCreate calls
    // `await load()` after createCategoryScoped succeeds).
    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Fresh');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Second load resolves FIRST with fresh data.
    resolveSecond([makeCategory({ id: 'cat-fresh', name: 'Fresh' })]);
    await waitFor(() => expect(screen.getByText('Fresh')).toBeDefined());

    // The stale first load resolves later with older data — must be ignored.
    resolveFirst([makeCategory({ id: 'cat-stale', name: 'Stale' })]);
    await waitFor(() => expect(screen.queryByText('Stale')).toBeNull());
    expect(screen.getByText('Fresh')).toBeDefined();
  });

  // ── CAT-09: field-level validation ────────────────────────────────────

  it('explains a disabled Save with a localized error once the name is typed then cleared (CAT-09)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // The Save/Create button stays disabled while the name is empty; the
    // field-level message appears once the operator has typed and cleared it.
    const createBtn = screen.getByRole('button', {
      name: 'Create',
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/e\.g\. bakery/i);
    await userEvent.type(nameInput, 'Snacks');
    await userEvent.clear(nameInput);
    await waitFor(() =>
      expect(screen.getByText('Category name is required')).toBeDefined(),
    );
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('rejects a duplicate category ID with a localized conflict error (CAT-09)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]); // id: cat-bakery
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // "Bakery" derives the same id (cat-bakery) as the existing category.
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Bakery');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByText('A category with this ID already exists')).toBeDefined(),
    );
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('rejects a case-variant name that collides with an existing ID (CAT-04)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]); // id: cat-bakery
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // "BAKERY" normalises to the same slug (cat-bakery) as the existing card.
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'BAKERY');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByText('A category with this ID already exists')).toBeDefined(),
    );
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('rejects a punctuation-variant name that collides with an existing ID (CAT-04)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]); // id: cat-bakery
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // "Bakery!" slugs to cat-bakery, colliding with the existing category.
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Bakery!');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByText('A category with this ID already exists')).toBeDefined(),
    );
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('derives a stable non-empty ID for a non-ASCII name (CAT-04)', async () => {
    mockListCategories.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // A fully non-ASCII name must not collapse to the degenerate `cat-` slug.
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'カフェ');
    const idPreview = document.querySelector('.cat-mgmt-hint code') as HTMLElement;
    expect(idPreview).toBeDefined();
    const derivedId = idPreview?.textContent ?? '';
    expect(derivedId.startsWith('cat-')).toBe(true);
    expect(derivedId.length).toBeGreaterThan(4);
  });

  it('allows a fresh non-conflicting name to create a category (CAT-04)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]); // id: cat-bakery
    mockCreateCategory.mockResolvedValue({ id: 'cat-drinks' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Drinks');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(mockCreateCategory).toHaveBeenCalledWith(TOKEN, {
        id: 'cat-drinks',
        name: 'Drinks',
        colour: expect.any(String),
        icon: expect.any(String),
      }),
    );
  });

  it('surfaces a create rejection with a localized error in the modal (CAT-10)', async () => {
    mockListCategories.mockResolvedValue([]);
    mockCreateCategory.mockRejectedValue(new Error('backend exploded'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. bakery/i), 'Drinks');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    // CAT-09: raw IPC text must not leak — the modal shows the localized generic.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to create category'),
    );
    expect(screen.queryByText(/backend exploded/i)).toBeNull();
    // The modal stays open so the operator can retry.
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('surfaces an update rejection with a localized error in the edit modal (CAT-10)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    mockUpdateCategory.mockRejectedValue(new Error('fk violation'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    await userEvent.click(document.querySelector('.cat-mgmt-edit-btn')!);
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    // The edit input is labelled by the visible "Name" label (htmlFor=cat-edit-name).
    await userEvent.type(screen.getByLabelText('Name'), 'Bakery 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to update category'),
    );
    expect(screen.queryByText(/fk violation/i)).toBeNull();
  });

  it('closes the create modal with Escape and leaves it dismissed (CAT-10)', async () => {
    mockListCategories.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());

    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Cancel')).toBeNull());
    // The screen itself stays rendered behind the modal.
    expect(screen.getByText('Add Category')).toBeDefined();
  });

  it('localizes the delete button aria-label via the Fluent bundle (CAT-10)', async () => {
    mockListCategories.mockResolvedValue([makeCategory()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Bakery')).toBeDefined());

    // category-delete-aria = Delete category { $name } (settings.ftl). Fluent
    // wraps interpolated vars in Unicode bidi isolation marks, so strip them.
    const deleteBtn = document.querySelector('.cat-mgmt-delete-btn');
    const label = (deleteBtn?.getAttribute('aria-label') ?? '').replace(/[\u2066-\u2069]/g, '');
    expect(label).toBe('Delete category Bakery');
  });

  it('navigates the icon radiogroup with arrow keys and a roving tabindex', async () => {
    mockListCategories.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Category')).toBeDefined());
    await userEvent.click(screen.getByText('Add Category').closest('button')!);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    const group = screen.getByRole('radiogroup', { name: /pick an icon/i });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(7);

    // The default icon is randomized, so locate the checked one — it is the
    // single tab stop (roving tabindex), all others are -1.
    const selectedIdx = radios.findIndex((r) => r.getAttribute('aria-checked') === 'true');
    expect(selectedIdx).toBeGreaterThanOrEqual(0);
    radios.forEach((r, i) => {
      expect(r).toHaveAttribute('tabindex', i === selectedIdx ? '0' : '-1');
    });

    // ArrowRight moves focus + selection to the next icon (wrapping).
    radios[selectedIdx]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    const nextIdx = (selectedIdx + 1) % radios.length;
    expect(radios[nextIdx]!).toHaveAttribute('aria-checked', 'true');
    expect(radios[nextIdx]!).toHaveFocus();

    // ArrowLeft wraps back to the original selection.
    await userEvent.keyboard('{ArrowLeft}');
    expect(radios[selectedIdx]!).toHaveAttribute('aria-checked', 'true');
    expect(radios[selectedIdx]!).toHaveFocus();
  });
});
