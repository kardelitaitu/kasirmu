import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { LocaleProvider, LocaleContext } from '@/i18n/LocaleContext';
import { OrgLocaleSync } from '@/i18n/OrgLocaleSync';

// OrgLocaleSync (regional slice 4): the bridge rendered BELOW
// WorkspaceProvider that pushes ONE read of the slice-1 regional chain
// into the locale negotiation — below the stored per-user choice, above
// the browser heuristic. LocaleProvider sits above WorkspaceProvider, so
// it can never observe a session by itself; the bridge is the only path
// the org default has into negotiation (mirrors CurrencyWorkspaceSync).

const wsState = vi.hoisted(() => ({ current: null as string | null }));
const mockGetPrimaryLocationScoped = vi.hoisted(() => vi.fn());
const mockGetRegionalConfigScoped = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: wsState.current }),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

vi.mock('@/api/regional', () => ({
  getRegionalConfigScoped: (...args: unknown[]) => mockGetRegionalConfigScoped(...args),
}));

beforeEach(() => {
  localStorage.clear();
  mockGetPrimaryLocationScoped.mockReset();
  mockGetRegionalConfigScoped.mockReset();
  wsState.current = null;
});

/** Renders the bridge and exposes the effective locale for assertions. */
function LocaleProbe() {
  const { locale, orgDefaultLocale } = useContext(LocaleContext);
  return <div data-testid="locale-probe" data-locale={locale} data-org={orgDefaultLocale ?? ''} />;
}

function Tree() {
  return (
    <LocaleProvider>
      <OrgLocaleSync />
      <LocaleProbe />
    </LocaleProvider>
  );
}

/** The probe's data-locale attribute, once mounted. */
async function probeLocale(): Promise<string> {
  const el = await waitFor(() => {
    const node = document.querySelector('[data-testid="locale-probe"]');
    expect(node).toBeTruthy();
    return node as HTMLElement;
  });
  return el.dataset['locale'] ?? '';
}

describe('OrgLocaleSync', () => {
  it('does not read the chain without a session token', async () => {
    render(<Tree />);
    expect(await probeLocale()).toBe('en');
    expect(mockGetPrimaryLocationScoped).not.toHaveBeenCalled();
    expect(mockGetRegionalConfigScoped).not.toHaveBeenCalled();
  });

  it('feeds a configured org locale into negotiation on session start', async () => {
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'loc-1', is_primary: true });
    mockGetRegionalConfigScoped.mockResolvedValue({
      location_id: 'loc-1',
      locale: { value: 'id-ID', scope: 'organization' },
    });
    wsState.current = 'tok-1';
    const { rerender } = render(<Tree />);
    rerender(<Tree />);

    await waitFor(() =>
      expect(mockGetRegionalConfigScoped).toHaveBeenCalledWith('tok-1', 'loc-1'),
    );
    await waitFor(() => expect(probeLocale()).resolves.toBe('id'));
  });

  it('feeds nothing when the chain answers built_in (nothing configured)', async () => {
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'loc-1', is_primary: true });
    mockGetRegionalConfigScoped.mockResolvedValue({
      location_id: 'loc-1',
      locale: { value: 'en-US', scope: 'built_in' },
    });
    wsState.current = 'tok-1';
    const { rerender } = render(<Tree />);
    rerender(<Tree />);

    await waitFor(() => expect(mockGetRegionalConfigScoped).toHaveBeenCalled());
    // built_in = the org never configured a locale; the browser heuristic
    // (en-US here) must keep answering — the built-in default must not
    // masquerade as an org decision and flip every fresh device to 'en'.
    await waitFor(() => expect(probeLocale()).resolves.toBe('en'));
  });

  it('clears the org default on logout so it cannot outlive the session', async () => {
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'loc-1', is_primary: true });
    mockGetRegionalConfigScoped.mockResolvedValue({
      location_id: 'loc-1',
      locale: { value: 'id-ID', scope: 'organization' },
    });
    wsState.current = 'tok-1';
    const { rerender } = render(<Tree />);
    rerender(<Tree />);
    await waitFor(() => expect(probeLocale()).resolves.toBe('id'));

    wsState.current = null;
    rerender(<Tree />);
    await waitFor(() => expect(probeLocale()).resolves.toBe('en'));
  });
});