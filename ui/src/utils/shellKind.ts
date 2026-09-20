//! Which shell is rendering the shared UI.

/**
 * The one thing a component cannot infer from the code: the desktop and tablet
 * builds share every component and differ only in their entry point
 * (`main.tsx` vs `main.mobile.tsx`), which is the seam ADR #54 §2.7 names.
 *
 * Set once by the entry before the first render, so nothing can observe it
 * mid-flight changing. Non-reactive on purpose: a shell cannot become another
 * shell, and a context for that would be state that never changes.
 */
export type ShellKind = 'desktop' | 'tablet';

let shellKind: ShellKind = 'desktop';

/** Record which shell is booting. Called by the entry points only. */
export function setShellKind(kind: ShellKind): void {
  shellKind = kind;
}

/** The shell this bundle is running in. */
export function getShellKind(): ShellKind {
  return shellKind;
}

/** True when the tablet entry is rendering. */
export function isTabletShell(): boolean {
  return shellKind === 'tablet';
}
