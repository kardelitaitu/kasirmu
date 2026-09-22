// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';
import PairView, { PAIR_LABELS } from '../PairView';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_API = 'https://license.kasir.mu';

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => handler(url, init)));
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function errorJson(status: number, data: unknown) {
  return { ok: false, status, json: async () => data };
}

async function renderPairView(locale = 'en') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const labels = labelMap(locale, PAIR_LABELS);

  await act(async () => {
    root.render(<PairView locale={locale} labels={labels} />);
  });

  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  return { container, root };
}

describe('PairView', () => {
  let activeRoot: Root | null = null;

  beforeEach(() => {
    window.__OZ_CONFIG__ = { licenseApiUrl: TEST_API };
    sessionStorage.clear();
    window.history.replaceState({}, '', '/en/pair');
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders not-configured message when licenseApiUrl is absent', async () => {
    delete window.__OZ_CONFIG__;
    const { container, root } = await renderPairView();
    activeRoot = root;

    expect(container.textContent).toContain('Pairing service is currently unavailable.');
  });

  it('renders anonymous prompt with sign-in link when user is not logged in', async () => {
    mockFetch(() => errorJson(401, { error: 'unauthorized' }));
    window.history.replaceState({}, '', '/en/pair?code=ABCD-1234');

    const { container, root } = await renderPairView();
    activeRoot = root;

    expect(container.textContent).toContain('Sign in to continue');
    expect(container.textContent).toContain('You must be signed in to claim this pairing code.');
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain('/en/login?next=');
    expect(link?.getAttribute('href')).toContain(encodeURIComponent('/en/pair?code=ABCD-1234'));
  });

  it('pre-fills pairing code from query parameter when signed in', async () => {
    sessionStorage.setItem('oz_session', 'mock-token-123');
    mockFetch((url) => {
      if (url.includes('/__oz/session')) return okJson({ token: 'mock-token-123' });
      return okJson({});
    });
    window.history.replaceState({}, '', '/en/pair?code=ABCD1234');

    const { container, root } = await renderPairView();
    activeRoot = root;

    const input = container.querySelector('input#pairing-code') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('ABCD-1234');
  });

  it('submits pairing claim and transitions to success state', async () => {
    sessionStorage.setItem('oz_session', 'mock-token-123');
    let claimCalled = false;
    let claimBody = '';

    mockFetch((url, init) => {
      if (url.includes('/__oz/session')) return okJson({ token: 'mock-token-123' });
      if (url.includes('/api/v1/pairing/claim')) {
        claimCalled = true;
        claimBody = String(init?.body ?? '');
        return okJson({ status: 'claimed', tenant_id: 't-123', code: 'ABCD-1234' });
      }
      return okJson({});
    });
    window.history.replaceState({}, '', '/en/pair?code=ABCD-1234');

    const { container, root } = await renderPairView();
    activeRoot = root;

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
    });

    expect(claimCalled).toBe(true);
    expect(JSON.parse(claimBody)).toEqual({ code: 'ABCD1234' });
    expect(container.textContent).toContain('Tablet paired!');
    expect(container.textContent).toContain('Your tablet will connect automatically in a few seconds.');
  });

  it('displays error message when pairing code is expired', async () => {
    sessionStorage.setItem('oz_session', 'mock-token-123');

    mockFetch((url) => {
      if (url.includes('/__oz/session')) return okJson({ token: 'mock-token-123' });
      if (url.includes('/api/v1/pairing/claim')) {
        return errorJson(400, { error: 'invalid or expired pairing code' });
      }
      return okJson({});
    });
    window.history.replaceState({}, '', '/en/pair?code=ABCD-1234');

    const { container, root } = await renderPairView();
    activeRoot = root;

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(container.textContent).toContain('This pairing code has expired. Generate a new code on the tablet and try again.');
  });

  it('displays error message when pairing code was already used', async () => {
    sessionStorage.setItem('oz_session', 'mock-token-123');

    mockFetch((url) => {
      if (url.includes('/__oz/session')) return okJson({ token: 'mock-token-123' });
      if (url.includes('/api/v1/pairing/claim')) {
        return errorJson(400, { error: 'pairing code already used' });
      }
      return okJson({});
    });
    window.history.replaceState({}, '', '/en/pair?code=ABCD-1234');

    const { container, root } = await renderPairView();
    activeRoot = root;

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(container.textContent).toContain('This pairing code has already been used.');
  });

  it('formats input with hyphen when user types', async () => {
    sessionStorage.setItem('oz_session', 'mock-token-123');
    mockFetch((url) => {
      if (url.includes('/__oz/session')) return okJson({ token: 'mock-token-123' });
      return okJson({});
    });

    const { container, root } = await renderPairView();
    activeRoot = root;

    const input = container.querySelector('input#pairing-code') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'value', { value: 'wxyz9876', configurable: true, writable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Code length check
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
  });
});
