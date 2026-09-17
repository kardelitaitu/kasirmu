import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import sharedFtl from '@/locales/shared.ftl?raw';
import { AppBootSplash } from '@/components/AppBootSplash';

// ── AppBootSplash tests ─────────────────────────────────────────────
//
// Covers the React stage of the two-stage boot splash:
//   - renders the localized loading label (logo and spinner were
//     removed from the splash)
//   - exposes a polite status region with aria-busy (replaces the old
//     bare-text AppShell gate)
//   - removes the static stage-1 splash node (#boot-splash) on mount

describe('AppBootSplash', () => {
  afterEach(() => {
    cleanup();
    document.getElementById('boot-splash')?.remove();
  });

  function mountWithStaticStage() {
    const splash = document.createElement('div');
    splash.id = 'boot-splash';
    document.body.appendChild(splash);
  }

  it('renders the splash with the localized label and no logo or spinner', async () => {
    await renderInAct(withFluent(<AppBootSplash />, sharedFtl));
    expect(document.querySelector('.app-splash')).toBeInTheDocument();
    expect(document.querySelector('.app-splash__logo')).not.toBeInTheDocument();
    expect(document.querySelector('.app-splash__spinner')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('is a polite busy status region', async () => {
    await renderInAct(withFluent(<AppBootSplash />, sharedFtl));
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('removes the static stage-1 splash node on mount', async () => {
    mountWithStaticStage();
    await renderInAct(withFluent(<AppBootSplash />, sharedFtl));
    expect(document.getElementById('boot-splash')).toBeNull();
  });
});
