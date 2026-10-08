// ── Category icon renderer ────────────────────────────────────────────────
//
// Lives apart from ./categoryIcons.ts because that module is data and pure
// helpers: mixing a component into it would disable React Fast Refresh for the
// whole file (react-refresh/only-export-components).

import type { ReactElement } from 'react';

/**
 * Render the SVG for a given icon id.
 *
 * @returns the glyph, or null when the id names no icon (a category created
 *   before an icon was chosen). Callers must handle null rather than assuming
 *   a fallback: the picker offers a generic option for that case.
 */
export function CategoryIconSvg({
  icon,
  size = 18,
}: {
  icon: string;
  size?: number;
}): ReactElement | null {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: size,
    height: size,
    'aria-hidden': true,
  };

  if (icon === 'food') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Fork */}
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
        <line x1="7" y1="11" x2="7" y2="22" />
        {/* Knife */}
        <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z" />
        <line x1="21" y1="15" x2="21" y2="22" />
      </svg>
    );
  }
  if (icon === 'snack') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Bowl */}
        <path d="M4 12h16" />
        <path d="M4 12c0 5.5 3.6 9 8 9s8-3.5 8-9" />
        {/* Snack items */}
        <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
        <circle cx="13" cy="8" r="2" fill="currentColor" stroke="none" />
        <circle cx="17" cy="9" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (icon === 'hot-drink') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Cup */}
        <path d="M6 8h12l-1.5 12h-9L6 8z" />
        {/* Handle */}
        <path d="M17 11h2a2 2 0 0 1 0 4h-2" />
        {/* Steam */}
        <path d="M8 8C8.8 6.5 7.2 5.5 8 4" />
        <path d="M13 8C13.8 6.5 12.2 5.5 13 4" />
      </svg>
    );
  }
  if (icon === 'cold-drink') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Cup body */}
        <path d="M5 7h14l-2 15H7L5 7z" />
        {/* Rim */}
        <line x1="3" y1="7" x2="21" y2="7" />
        {/* Straw */}
        <line x1="16" y1="2" x2="12" y2="22" />
      </svg>
    );
  }
  if (icon === 'dots-1') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="8" cy="8" r="3.5" />
      </svg>
    );
  }
  if (icon === 'dots-2') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="4.5" cy="8" r="3" />
        <circle cx="11.5" cy="8" r="3" />
      </svg>
    );
  }
  if (icon === 'dots-3') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="2.5" cy="8" r="2.5" />
        <circle cx="8" cy="8" r="2.5" />
        <circle cx="13.5" cy="8" r="2.5" />
      </svg>
    );
  }
  return null;
}
