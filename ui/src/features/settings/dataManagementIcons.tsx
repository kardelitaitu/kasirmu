/**
 * dataManagementIcons — the SVG icon builders used by the Data management
 * screen's password toggles and its three wizard tabs.
 *
 * Moved verbatim out of DataManagementScreen.tsx by DataManagement lane slice 2:
 * eyeIcon/eyeOffIcon were at :38-51 and ICON_PROPS/tabIcon/folderIcon/checkIcon
 * at :55-74 (in the 944-line file slice 1 left behind). The only edits are the
 * five added `export` keywords; ICON_PROPS stayed module-private because nothing
 * outside this file reads it.
 *
 * They could not join dataManagementModel.ts, which is a .ts: every value here
 * returns JSX. That is also why React is imported as a type namespace — the moved
 * signatures spell `React.ReactNode`, and the import keeps those three lines
 * byte-identical instead of forcing a rename.
 *
 * NO CSS CLASS MOVED WITH THIS FILE. The builders emit bare <svg> elements with no
 * className (measured: 0 occurrences of className / class= in the moved range), and
 * the classes that style them — .data-mgmt-tab-icon (DataManagementScreen.css :81)
 * and .data-mgmt-progress-done (:258, :270) — sit on the CALL SITES, which stayed
 * in the screen. Both are element-descendant selectors, so they still match: the
 * svg lands in the same DOM position as before. That is why
 * screenExtraction.test.ts needed no entry for this file — and that claim was
 * tested, not assumed: the guard still exits 0 with this file absent from it.
 */
import type * as React from 'react';

// ── SVG icon helpers ──────────────────────────────────────────────
// ── SVG icon helpers ──────────────────────────────────────────────

export const eyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const eyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// ── Tab / icon helpers ───────────────────────────────────────────

const ICON_PROPS = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function tabIcon(tab: 'export' | 'import' | 'backup'): React.ReactNode {
  switch (tab) {
    case 'export':
      return <svg {...ICON_PROPS}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case 'import':
      return <svg {...ICON_PROPS}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    case 'backup':
      return <svg {...ICON_PROPS}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
  }
}

export function folderIcon(): React.ReactNode {
  return <svg {...ICON_PROPS} width={32} height={32}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
}

export function checkIcon(): React.ReactNode {
  return <svg {...ICON_PROPS}><polyline points="20 6 9 17 4 12"/></svg>;
}
