import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { labelMap } from '../../i18n';

/**
 * Regression net for the "auth API is not configured" flash (2026-08-17).
 *
 * The bug: AuthForm/SignupForm returned the not-configured notice from the
 * top of the component, so the Astro SSR pass baked it into the HTML when
 * the build-time PUBLIC_LICENSE_API_URL was unset — then hydration swapped
 * in the real form (the Worker's runtime config provides the URL), flashing
 * the notice on every load.
 *
 * These tests render the components exactly as SSR does (no window, no
 * build-time env) and assert the notice can never be in the first paint.
 */
const NOT_CONFIGURED = 'The auth API is not configured on this deployment.';

describe('SSR first paint — auth forms', () => {
  it('AuthForm server HTML never contains the not-configured notice', async () => {
    const { default: AuthForm, AUTH_FORM_LABELS } = await import('../AuthForm');
    const html = renderToString(
      createElement(AuthForm, { locale: 'en', labels: labelMap('en', AUTH_FORM_LABELS) }),
    );
    expect(html).not.toContain(NOT_CONFIGURED);
    // The real form must render instead: the email-code / password tabs.
    expect(html).toContain('Email code');
    expect(html).toContain('Password');
  });

  it('SignupForm server HTML never contains the not-configured notice', async () => {
    const { default: SignupForm, SIGNUP_FORM_LABELS } = await import('../SignupForm');
    const html = renderToString(
      createElement(SignupForm, { locale: 'en', labels: labelMap('en', SIGNUP_FORM_LABELS) }),
    );
    expect(html).not.toContain(NOT_CONFIGURED);
    expect(html).toContain('type="email"');
  });
});

/**
 * The Google OAuth link depends on `licenseApiUrl()`: undefined during SSR
 * (no build-time PUBLIC_LICENSE_API_URL), present on the client (the Worker's
 * runtime config). Rendering it on `API` alone made the server omit the block
 * while the client's first render included it — a React hydration mismatch
 * (#418) that discarded the server HTML on every login/signup page.
 *
 * renderToString models the SSR pass AND the pre-effect first client render
 * (effects never run), so it proves the two agree even when the API URL is
 * configured. If the OAuth block were gated on `API` alone, the configured
 * case below would contain the link and fail.
 */
describe('SSR first paint — Google OAuth entry is mount-gated', () => {
  const OAUTH = '/api/v1/web/oauth/google/start';

  async function withApi<T>(fn: () => T): Promise<T> {
    const env = import.meta.env as Record<string, unknown>;
    const prev = env.PUBLIC_LICENSE_API_URL;
    env.PUBLIC_LICENSE_API_URL = 'https://license.test';
    try {
      return fn();
    } finally {
      env.PUBLIC_LICENSE_API_URL = prev;
    }
  }

  it('AuthForm first render omits the OAuth link even with the API configured', async () => {
    const { default: AuthForm, AUTH_FORM_LABELS } = await import('../AuthForm');
    const html = await withApi(() =>
      renderToString(createElement(AuthForm, { locale: 'en', labels: labelMap('en', AUTH_FORM_LABELS) })),
    );
    expect(html).not.toContain(OAUTH);
  });

  it('SignupForm first render omits the OAuth link even with the API configured', async () => {
    const { default: SignupForm, SIGNUP_FORM_LABELS } = await import('../SignupForm');
    const html = await withApi(() =>
      renderToString(createElement(SignupForm, { locale: 'en', labels: labelMap('en', SIGNUP_FORM_LABELS) })),
    );
    expect(html).not.toContain(OAUTH);
  });
});
