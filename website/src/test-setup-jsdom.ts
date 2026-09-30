// jsdom-specific vitest setup.
//
// Stub `window.location` so a navigation never reaches jsdom's
// `Not implemented: navigation (except hash changes)` handler. The default
// jsdom setter logs that error and does nothing -- fine in a browser, but
// vitest surfaces those console errors as test failures, so a redirect that
// fires before any per-test override is in place turns the suite red.
//
// No-op when `window` is undefined: the website suite runs most tests under
// the `node` environment, and setupFiles run for every test file.
if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
  let href = window.location.href;
  try {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return href;
        },
        set href(v: string) {
          href = String(v);
        },
        assign() {
          /* no-op: a test that needs the target reads the getter */
        },
        replace() {
          /* no-op */
        },
      },
      writable: true,
    });
  } catch {
    // jsdom may lock `location`; the per-test overrides in
    // src/components/__tests__/auth-form.test.tsx still cover that case.
  }
}
