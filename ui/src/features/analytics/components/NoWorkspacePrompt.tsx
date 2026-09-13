//! "No workspace selected" actionable prompt — the screen's empty state
//! when no session exists. Extracted verbatim from `AnalyticsScreen.tsx`
//! (JSX-shell split, slice 1).

import { Localized } from '@fluent/react';

export function NoWorkspacePrompt({ onSelectWorkspace }: { onSelectWorkspace: () => void }) {
  return (
    <div className="analytics-no-workspace" role="status">
      <svg
        className="analytics-no-workspace-icon"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <h2 className="analytics-no-workspace-title">
        <Localized id="analytics-no-workspace-title"><span>No workspace selected</span></Localized>
      </h2>
      <p className="analytics-no-workspace-message">
        <Localized id="analytics-no-workspace-message"><span>Select a workspace to view analytics</span></Localized>
      </p>
      <button
        type="button"
        className="analytics-no-workspace-action"
        onClick={onSelectWorkspace}
      >
        <Localized id="analytics-select-workspace"><span>Select workspace</span></Localized>
      </button>
    </div>
  );
}
