// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Set a React-controlled input/textarea value via the native setter so React picks it up. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderContact(locale: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: ContactForm, SUPPORT_LABELS } = await import('../ContactForm');
  await act(async () => {
    root.render(<ContactForm labels={labelMap(locale, SUPPORT_LABELS)} />);
    await new Promise((r) => setTimeout(r, 10));
  });
  return { container, root };
}

function getSubmitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function getInputByName(container: HTMLElement, name: string): HTMLInputElement {
  return container.querySelector(`input[name="${name}"], textarea[name="${name}"], input[type="${name}"], input[type="${name}"]`) as HTMLInputElement;
}

function getInputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement | HTMLTextAreaElement {
  const inputs = container.querySelectorAll('input, textarea');
  for (const input of inputs) {
    if (input.getAttribute('placeholder')?.includes(placeholder)) return input as HTMLInputElement | HTMLTextAreaElement;
  }
  throw new Error(`Input with placeholder containing "${placeholder}" not found`);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The production shape: the Worker's /__oz/runtime-config.js advertises the
  // route, and the form reads it at submit time. The unconfigured case has its
  // own test below.
  window.__OZ_CONFIG__ = { contactEndpoint: '/api/contact' };
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ContactForm', () => {
  it('renders the form with name, email, and message fields', async () => {
    const { container, root } = await renderContact('en');
    try {
      expect(container.querySelector('form')).not.toBeNull();
      expect(container.querySelector('input[type="text"]')).not.toBeNull();
      expect(container.querySelector('input[type="email"]')).not.toBeNull();
      expect(container.querySelector('textarea')).not.toBeNull();
      expect(getSubmitButton(container)).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('renders i18n labels for Indonesian locale', async () => {
    const { container, root } = await renderContact('id');
    try {
      expect(container.textContent).toContain('Kirim pesan');
      expect(container.textContent).toContain('Nama');
      expect(container.textContent).toContain('Pesan');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('submits form data and shows success state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await renderContact('en');
    try {
      const nameInput = getInputByPlaceholder(container, 'Your name');
      const emailInput = getInputByPlaceholder(container, 'you@example.com');
      const messageInput = getInputByPlaceholder(container, 'How can we help?');

      await act(async () => {
        setNativeValue(nameInput as HTMLInputElement, 'Test User');
      });
      await act(async () => {
        setNativeValue(emailInput as HTMLInputElement, 'test@example.com');
      });
      await act(async () => {
        setNativeValue(messageInput as HTMLTextAreaElement, 'Hello, I need help with something specific.');
      });

      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(container.textContent).toContain('Thanks! Your message is on its way');
      expect(fetchMock).toHaveBeenCalledWith('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test User',
          email: 'test@example.com',
          message: 'Hello, I need help with something specific.',
        }),
      });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows error state when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { container, root } = await renderContact('en');
    try {
      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(container.textContent).toContain("Couldn't send your message");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('offers a mailto fallback with the entered message in the error state', async () => {
    // When the POST fails, the user must still have a way to reach support —
    // the error state renders a mailto link prefilled with the message.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { container, root } = await renderContact('en');
    try {
      const nameInput = getInputByPlaceholder(container, 'Your name');
      const emailInput = getInputByPlaceholder(container, 'you@example');
      const messageInput = getInputByPlaceholder(container, 'How can we help?');
      await act(async () => {
        setNativeValue(nameInput as HTMLInputElement, 'Bob');
        setNativeValue(emailInput as HTMLInputElement, 'bob@example.com');
        setNativeValue(messageInput as HTMLTextAreaElement, 'My printer stopped working.');
      });
      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      const mailto = container.querySelector('a[href^="mailto:"]') as HTMLAnchorElement | null;
      expect(mailto).not.toBeNull();
      expect(mailto?.getAttribute('href')).toContain('support@kasir.mu');
      expect(mailto?.getAttribute('href')).toContain(encodeURIComponent('Support: Bob'));
      expect(mailto?.getAttribute('href')).toContain(encodeURIComponent('My printer stopped working.'));
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('honeypot field triggers fake success without sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await renderContact('en');
    try {
      // The honeypot input has name="website" and is visually hidden.
      const honeypot = container.querySelector('input[name="website"]') as HTMLInputElement;
      expect(honeypot).not.toBeNull();
      expect(honeypot.closest('label')?.getAttribute('aria-hidden')).toBe('true');

      await act(async () => {
        setNativeValue(honeypot, 'https://spam-bot.example');
      });

      // Fill in required fields so the form can submit.
      const nameInput = getInputByPlaceholder(container, 'Your name');
      const emailInput = getInputByPlaceholder(container, 'you@example.com');
      const messageInput = getInputByPlaceholder(container, 'How can we help?');
      await act(async () => {
        setNativeValue(nameInput as HTMLInputElement, 'Bot Name');
        setNativeValue(emailInput as HTMLInputElement, 'bot@spam.com');
        setNativeValue(messageInput as HTMLTextAreaElement, 'Buy cheap watches now!!!');
      });

      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      // Shows success without calling fetch (bot was trapped).
      expect(fetchMock).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Thanks! Your message is on its way');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('moves focus to the confirmation when the form is replaced by it', async () => {
    // The submit button carries `disabled={status === 'sending'}`, so the button
    // the visitor had just pressed was disabled mid-request and focus fell to
    // <body>; on success the whole form is replaced, so the button that had
    // focus no longer exists (measured in a browser 2026-09-23 at 390px and
    // 1440px, en and id).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { container, root } = await renderContact('en');
    try {
      const submit = getSubmitButton(container);
      act(() => submit.focus());
      expect(document.activeElement).toBe(submit);

      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      const confirmation = container.querySelector('p[tabindex="-1"]') as HTMLParagraphElement;
      expect(confirmation).not.toBeNull();
      expect(document.activeElement).toBe(confirmation);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('puts focus back on the retry button when sending fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container, root } = await renderContact('en');
    try {
      // Focus starts in a field, not on the button: the browser moved focus to
      // <body> when the pressed button disabled, and jsdom does not model that,
      // so the recovery has to be asserted from somewhere it is not already.
      const email = container.querySelector('input[type="email"]') as HTMLInputElement;
      act(() => email.focus());
      expect(document.activeElement).toBe(email);

      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      // The form survives and the mailto fallback is offered; focus is the
      // button the visitor used, which is also the retry.
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(document.activeElement).toBe(getSubmitButton(container));
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('focuses the first field when "Send another message" brings the form back', async () => {
    // The panel's only control is removed by the press, so focus would fall to
    // <body> and the re-rendered form would start outside it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { container, root } = await renderContact('en');
    try {
      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      const sendAnother = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Send another'),
      ) as HTMLButtonElement;
      act(() => sendAnother.focus());
      await act(async () => {
        sendAnother.click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      const firstField = container.querySelector('form input[type="text"]') as HTMLInputElement;
      expect(document.activeElement).toBe(firstField);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('"Send another message" button returns to form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { container, root } = await renderContact('en');
    try {
      // Submit to reach success state (empty fields are handled by honeypot check).
      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(container.textContent).toContain('Thanks!');

      const sendAnother = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Send another'),
      ) as HTMLButtonElement;
      expect(sendAnother).not.toBeNull();

      await act(async () => {
        sendAnother.click();
      });

      expect(container.querySelector('form')).not.toBeNull();
      expect(getSubmitButton(container)).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('submit button is disabled while sending', async () => {
    let resolveFetch: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })),
    );
    const { container, root } = await renderContact('en');
    try {
      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      const btn = getSubmitButton(container);
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toContain('Sending');

      await act(async () => {
        resolveFetch!({ ok: true });
        await new Promise((r) => setTimeout(r, 10));
      });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('trims whitespace and lowercases email on submit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await renderContact('en');
    try {
      const nameInput = getInputByPlaceholder(container, 'Your name');
      const emailInput = getInputByPlaceholder(container, 'you@example.com');
      const messageInput = getInputByPlaceholder(container, 'How can we help?');

      await act(async () => {
        setNativeValue(nameInput as HTMLInputElement, '  Padded Name  ');
        setNativeValue(emailInput as HTMLInputElement, '  USER@EXAMPLE.COM  ');
        setNativeValue(messageInput as HTMLTextAreaElement, '   Padded message body.   ');
      });

      await act(async () => {
        const form = container.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(fetchMock).toHaveBeenCalledWith('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Padded Name',
          email: 'user@example.com',
          message: 'Padded message body.',
        }),
      });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('posts to the endpoint the runtime config advertises', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    window.__OZ_CONFIG__ = { contactEndpoint: 'https://license.example/api/v1/web/contact' };
    const { container, root } = await renderContact('en');
    try {
      await act(async () => {
        setNativeValue(getInputByPlaceholder(container, 'Your name') as HTMLInputElement, 'A');
        setNativeValue(getInputByPlaceholder(container, 'you@example.com') as HTMLInputElement, 'a@example.com');
        setNativeValue(getInputByPlaceholder(container, 'How can we help?') as HTMLTextAreaElement, 'Body long enough.');
      });
      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://license.example/api/v1/web/contact');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('offers the mailto fallback and posts nothing when no endpoint is configured', async () => {
    // The contract `.env.example` states for an empty PUBLIC_CONTACT_ENDPOINT.
    // Before the fix the form POSTed to a hardcoded '/api/contact' regardless —
    // a route no static host has — so the visitor's message was lost to a 404
    // before the fallback appeared (measured in a browser 2026-09-23).
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.__OZ_CONFIG__ = {};
    (import.meta.env as Record<string, unknown>).PUBLIC_CONTACT_ENDPOINT = '';
    const { container, root } = await renderContact('en');
    try {
      await act(async () => {
        setNativeValue(getInputByPlaceholder(container, 'Your name') as HTMLInputElement, 'Audit Tester');
        setNativeValue(getInputByPlaceholder(container, 'you@example.com') as HTMLInputElement, 'audit@example.com');
        setNativeValue(getInputByPlaceholder(container, 'How can we help?') as HTMLTextAreaElement, 'Body long enough.');
      });
      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(fetchMock).not.toHaveBeenCalled();
      const mailto = container.querySelector('a[href^="mailto:"]');
      expect(mailto?.getAttribute('href')).toContain('support@kasir.mu');
      expect(mailto?.getAttribute('href')).toContain('Audit%20Tester');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Regression: input background colour ──────────────────────────────
// Ensures ContactForm inputs/textarea never use bg-primary (brand blue).
// Root cause: ContactForm.tsx inputClass had bg-primary instead of bg-surface,
// making the support page name, email, and message fields solid blue (fixed in
// the same sweep as AuthForm / SignupForm / PasswordField / DocSidebar).

describe('ContactForm — input field styling regression', () => {
  it('name input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderContact('en');
    try {
      const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
      expect(nameInput, 'name input should be rendered').not.toBeNull();
      expect(nameInput!.className).not.toContain('bg-primary');
      expect(nameInput!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('email input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderContact('en');
    try {
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement | null;
      expect(emailInput, 'email input should be rendered').not.toBeNull();
      expect(emailInput!.className).not.toContain('bg-primary');
      expect(emailInput!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('message textarea does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderContact('en');
    try {
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
      expect(textarea, 'message textarea should be rendered').not.toBeNull();
      expect(textarea!.className).not.toContain('bg-primary');
      expect(textarea!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
