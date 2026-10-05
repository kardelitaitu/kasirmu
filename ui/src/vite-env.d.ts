/// <reference types="vite/client" />

/**
 * The commit this bundle was built from, injected by `define` in both vite
 * configs (see `src/build-id.ts`).
 *
 * Declared rather than imported so a build that somehow misses the define
 * fails at type level in CI instead of reading `undefined` at runtime and
 * rendering the string "undefined" in the UI footer.
 */
declare const __BUILD_ID__: string;
