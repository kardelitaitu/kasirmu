import { useEffect } from 'react';
import { Localized } from '@fluent/react';

/**
 * Boot splash — React stage (stage 2) of the two-stage loading
 * screen.
 *
 * Stage 1 is the static markup rendered by `index.html` /
 * `index.mobile.html` (visible from the very first paint, before any
 * JS runs). This component renders the identical visual so the handoff
 * from static HTML to React is seamless: the same localized status
 * label occupies the same centered layout.
 *
 * Rendered by AppShell / TabletAppShell while the boot gate (license +
 * setup restore) is in flight, replacing the previous bare-text
 * "Loading…" state.
 *
 * On mount it removes the static stage-1 node (`#boot-splash`), which
 * sits outside `#root` and is therefore not cleared by React.
 *
 * Keep the markup and inline styles synchronized with both HTML entry
 * files (`.app-splash` rules in their `<head>` style blocks).
 */
export function AppBootSplash() {
  useEffect(() => {
    document.getElementById('boot-splash')?.remove();
  }, []);

  return (
    <div className="app-splash" role="status" aria-live="polite" aria-busy="true">
      <Localized id="shared-loading">
        <span className="app-splash__label">Loading&hellip;</span>
      </Localized>
    </div>
  );
}
