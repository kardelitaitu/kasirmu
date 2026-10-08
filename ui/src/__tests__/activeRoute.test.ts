import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveRoute,
  setActiveRoute,
  subscribeActiveRoute,
} from '@/utils/activeRoute';

/**
 * Contract tests for the shell route signal.
 *
 * WHY THIS MODULE EXISTS — measured 2026-10-07: the tablet shell navigates
 * tools by React state (`TabletAppShell.tsx` `setCurrentRoute`), NOT by
 * `location.hash` — only the settings hub and deep links change the hash. The
 * full-page error boundary therefore could not see tool-to-tool navigation and
 * kept a caught error until the 30s auto-reload fired. Shells publish here;
 * `AppProviders` subscribes and feeds the value into `resetKeys`.
 */

describe('activeRoute', () => {
  beforeEach(() => {
    setActiveRoute('');
  });

  it('starts empty and reflects the last published route', () => {
    expect(getActiveRoute()).toBe('');
    setActiveRoute('pos');
    expect(getActiveRoute()).toBe('pos');
    setActiveRoute('settings');
    expect(getActiveRoute()).toBe('settings');
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveRoute(listener);
    setActiveRoute('pos');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveRoute(listener);
    unsubscribe();
    setActiveRoute('pos');
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when the route is unchanged', () => {
    // useSyncExternalStore re-reads the snapshot on every notification; a
    // redundant one would force an avoidable re-render at the app root.
    const listener = vi.fn();
    const unsubscribe = subscribeActiveRoute(listener);
    setActiveRoute('pos');
    setActiveRoute('pos');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('returns a stable snapshot for the same value', () => {
    // getSnapshot must return the same reference between calls or React
    // treats it as a change on every render.
    setActiveRoute('pos');
    expect(getActiveRoute()).toBe(getActiveRoute());
  });
});
