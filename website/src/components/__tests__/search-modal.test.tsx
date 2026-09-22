// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SearchModal, { SEARCH_LABELS } from '../SearchModal';
import SearchTrigger from '../SearchTrigger';
import { labelMap } from '../../i18n';
import type { SearchDoc } from '../../lib/search-index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Docs now arrive as a prop from the content collection. Ranking and real-corpus
// coverage are tested in lib/__tests__/search-index.test.ts; here a small stand-in
// is enough to exercise the modal's rendering and keyboard behaviour.
const DOCS: SearchDoc[] = [
  { slug: 'welcome', title: 'Welcome to kasir.mu', description: 'What kasir.mu is.' },
  { slug: 'cloud-sync', title: 'Cloud Sync', description: 'Sync across stores.' },
  { slug: 'inventory', title: 'Inventory & Warehouses', description: 'Track stock.' },
  { slug: 'settings', title: 'Settings & Data', description: 'Branding and receipts.' },
];

describe('SearchModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function renderModal(isOpen = true, onClose = vi.fn(), locale = 'en') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SearchModal
          isOpen={isOpen}
          onClose={onClose}
          locale={locale}
          labels={labelMap(locale, SEARCH_LABELS)}
          docs={DOCS}
        />,
      );
    });

    return {
      container,
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it('does not render when isOpen is false', async () => {
    const { unmount } = await renderModal(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await unmount();
  });

  it('renders search input and initial results when open', async () => {
    const { unmount } = await renderModal(true);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toContain('Search');
    await unmount();
  });

  it('filters results based on query', async () => {
    const { unmount } = await renderModal(true);
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(input, 'pricing');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const results = document.body.querySelectorAll('a[role="option"]');
    expect(results.length).toBeGreaterThan(0);
    const titles = Array.from(results).map((r) => r.textContent);
    expect(titles.some((t) => t?.toLowerCase().includes('pricing'))).toBe(true);
    await unmount();
  });

  it('shows no results message for unmatched query', async () => {
    const { unmount } = await renderModal(true);
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(input, 'xyznonexistentterm123');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('No matching results found');
    await unmount();
  });

  it('calls onClose when Escape key is pressed or backdrop is clicked', async () => {
    const onClose = vi.fn();
    const { unmount } = await renderModal(true, onClose);

    const backdrop = document.body.querySelector('[data-backdrop="true"]') as HTMLElement;
    if (backdrop) {
      await act(async () => {
        backdrop.click();
      });
      expect(onClose).toHaveBeenCalled();
    }

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();

    await unmount();
  });

  it('calls onClose on mousedown outside the dialog', async () => {
    const onClose = vi.fn();
    const { unmount } = await renderModal(true, onClose);

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();

    await unmount();
  });
});

// ── SearchModal — keyboard navigation (gap analysis) ─────────────────

describe('SearchModal — keyboard navigation', () => {
  async function renderOpen(locale = 'en') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <SearchModal isOpen onClose={vi.fn()} locale={locale} labels={labelMap(locale, SEARCH_LABELS)} docs={DOCS} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const options = () => Array.from(document.body.querySelectorAll('a[role="option"]')) as HTMLElement[];
    const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    return {
      root,
      container,
      options,
      selected,
      press: async (key: string, opts: KeyboardEventInit = {}) => {
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
        });
      },
      unmount: async () => {
        await act(async () => { root.unmount(); });
        container.remove();
      },
    };
  }

  it('starts with the first option selected', async () => {
    const m = await renderOpen();
    try {
      expect(m.selected()).toBe(0);
    } finally {
      await m.unmount();
    }
  });

  it('ArrowDown moves selection forward', async () => {
    const m = await renderOpen();
    try {
      await m.press('ArrowDown');
      expect(m.selected()).toBe(1);
    } finally {
      await m.unmount();
    }
  });

  it('ArrowDown wraps from the last option to the first', async () => {
    const m = await renderOpen();
    try {
      for (let i = 0; i < 8; i++) await m.press('ArrowDown'); // 8 items → wraps
      expect(m.selected()).toBe(0);
    } finally {
      await m.unmount();
    }
  });

  it('ArrowUp wraps from the first option to the last', async () => {
    const m = await renderOpen();
    try {
      await m.press('ArrowUp');
      expect(m.selected()).toBe(m.options().length - 1);
    } finally {
      await m.unmount();
    }
  });

  it('resets selection to 0 when the query changes', async () => {
    const m = await renderOpen();
    try {
      await m.press('ArrowDown');
      expect(m.selected()).toBe(1);
      const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(input, 'value', { value: 'qris', configurable: true, writable: true });
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(m.selected()).toBe(0);
    } finally {
      await m.unmount();
    }
  });

  it('highlights the hovered option', async () => {
    const m = await renderOpen();
    try {
      const third = m.options()[2];
      // React's onMouseEnter is simulated from native mouseover/mouseout;
      // a bare `mouseenter` event never fires the synthetic handler.
      await act(async () => {
        third.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      });
      expect(m.selected()).toBe(2);
    } finally {
      await m.unmount();
    }
  });

  it('filters by keywords (docs)', async () => {
    const m = await renderOpen();
    try {
      const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(input, 'value', { value: 'cloud-sync', configurable: true, writable: true });
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // 'cloud-sync' matches the doc URL/title — keyword search must surface it.
      const opts = m.options();
      expect(opts.length).toBe(1);
      expect(opts[0].textContent?.toLowerCase()).toContain('cloud sync');
    } finally {
      await m.unmount();
    }
  });

  it('uses localized titles for the id locale', async () => {
    const m = await renderOpen('id');
    try {
      expect(m.options().some((o) => o.textContent?.includes('Beranda'))).toBe(true);
    } finally {
      await m.unmount();
    }
  });

  // ── Focus containment ─────────────────────────────────────────────
  // Measured live before this: 10 tabs forward out of the dialog, and one
  // shift-tab back. `aria-modal="true"` claims the rest of the page is inert,
  // so it must not be tabbable either.

  const searchInput = () => document.body.querySelector('input[type="search"]') as HTMLInputElement;

  it('wraps focus to the first stop when tabbing forward off the last option', async () => {
    const m = await renderOpen();
    try {
      const options = m.options();
      options[options.length - 1].focus();
      await m.press('Tab');
      expect(document.activeElement).toBe(searchInput());
    } finally {
      await m.unmount();
    }
  });

  it('wraps focus to the last option on Shift+Tab from the first stop', async () => {
    const m = await renderOpen();
    try {
      searchInput().focus();
      await m.press('Tab', { shiftKey: true });
      const options = m.options();
      expect(document.activeElement).toBe(options[options.length - 1]);
    } finally {
      await m.unmount();
    }
  });

  it('pulls focus back into the dialog if it is outside it', async () => {
    const m = await renderOpen();
    try {
      const outsider = document.createElement('button');
      document.body.appendChild(outsider);
      outsider.focus();
      await m.press('Tab');
      expect(document.activeElement).toBe(searchInput());
      outsider.remove();
    } finally {
      await m.unmount();
    }
  });
});

// ── SearchModal — focus is returned to the opener on close ───────────

describe('SearchModal — focus restore', () => {
  async function render(open: boolean, root: ReturnType<typeof createRoot>) {
    await act(async () => {
      root.render(
        <SearchModal
          isOpen={open}
          onClose={vi.fn()}
          locale="en"
          labels={labelMap('en', SEARCH_LABELS)}
          docs={DOCS}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
  }

  it('hands focus back to the element that opened it', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Search';
    document.body.appendChild(opener);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      opener.focus();
      await render(true, root);
      // Focus moved into the dialog while open.
      expect(document.activeElement).toBe(document.body.querySelector('input[type="search"]'));

      await render(false, root);
      // …and comes back to the trigger, so the next Tab resumes there rather
      // than restarting at the top of the page.
      expect(document.activeElement).toBe(opener);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      opener.remove();
    }
  });
});

// ── SearchTrigger (gap analysis: 0 tests) ────────────────────────────

describe('SearchTrigger — toggle', () => {
  async function renderTrigger(locale = 'en') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SearchTrigger locale={locale} labels={labelMap(locale, SEARCH_LABELS)} docs={DOCS} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    return {
      container,
      root,
      button: () => container.querySelector('button[aria-label="Search"]') as HTMLButtonElement | null,
      unmount: async () => {
        await act(async () => { root.unmount(); });
        container.remove();
      },
    };
  }

  it('opens the modal on button click', async () => {
    const m = await renderTrigger();
    try {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => {
        m.button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      await m.unmount();
    }
  });

  it('toggles the modal with Ctrl+K', async () => {
    const m = await renderTrigger();
    try {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      // Toggle closed.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', metaKey: true, bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await m.unmount();
    }
  });
});
