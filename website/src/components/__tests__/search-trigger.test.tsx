// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SearchTrigger from '../SearchTrigger';
import { SEARCH_LABELS } from '../SearchModal';
import { labelMap } from '../../i18n';
import type { SearchDoc } from '../../lib/search-index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The real corpus coverage lives in lib/__tests__/search-index.test.ts; these
// tests only need the prop present.
const DOCS: SearchDoc[] = [
  { slug: 'cloud-sync', title: 'Cloud Sync', description: 'Sync across stores.' },
  { slug: 'settings', title: 'Settings & Data', description: 'Branding and receipts.' },
];

describe('SearchTrigger Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function renderTrigger(locale = 'en') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SearchTrigger locale={locale} labels={labelMap(locale, SEARCH_LABELS)} docs={DOCS} />);
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

  it('renders trigger icon button with keyboard shortcut title', async () => {
    const { container, unmount } = await renderTrigger('en');
    const btn = container.querySelector('button[aria-label="Search"]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('title')).toContain('⌘K');
    await unmount();
  });

  it('renders Indonesian title when locale is id', async () => {
    const { container, unmount } = await renderTrigger('id');
    const btn = container.querySelector('button[aria-label="Search"]');
    expect(btn?.getAttribute('title')).toContain('Cari');
    await unmount();
  });

  it('opens search modal on button click', async () => {
    const { container, unmount } = await renderTrigger('en');
    const btn = container.querySelector('button[aria-label="Search"]') as HTMLButtonElement;

    await act(async () => {
      btn.click();
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await unmount();
  });

  it('toggles search modal on Cmd+K or Ctrl+K keypress', async () => {
    const { unmount } = await renderTrigger('en');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await unmount();
  });
});
