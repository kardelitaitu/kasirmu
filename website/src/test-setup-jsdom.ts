// jsdom-specific vitest setup.
//
// Make `window.location.href` assignment inert, so a redirect cannot reach
// jsdom's `Not implemented: navigation (except hash changes)` handler. The
// default jsdom setter logs that error and does nothing -- fine in a browser,
// but vitest surfaces those console errors as test failures, so a redirect
// that fires before any per-test override is in place turns the suite red.
//
// ONLY `href` (plus assign/replace) is redefined. An earlier version of this
// file replaced the whole `location` object, which silently dropped `search`,
// `pathname` and the rest -- and `PairView` reads the pairing code from
// `window.location.search`, so five pair-view tests failed with "No pairing
// code found". Never swap the object; override the one member that has to be
// inert.
//
// No-op when `window` is undefined: the website suite runs most tests under
// the `node` environment, and setupFiles run for every test file.
if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
  const loc = window.location as unknown as Record<string, unknown>;
  let href = String(loc.href);
  try {
    Object.defineProperty(loc, 'href', {
      configurable: true,
      get() {
        return href;
      },
      set(v: string) {
        href = String(v);
      },
    });
    Object.defineProperty(loc, 'assign', {
      configurable: true,
      value(v: string) {
        href = String(v);
      },
    });
    Object.defineProperty(loc, 'replace', {
      configurable: true,
      value(v: string) {
        href = String(v);
      },
    });
  } catch {
    // jsdom may lock these members; the per-test overrides in
    // src/components/__tests__/auth-form.test.tsx still cover that case.
  }
}
