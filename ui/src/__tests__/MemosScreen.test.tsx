/**
 * Tests for `MemosScreen` — the Memo authoring surface (Phase 2 P1).
 *
 * Drives the REAL screen against mocked IPC api modules (`@/api/memos`,
 * `@/api/locations`) with a real Fluent bundle over `shared.ftl`, so the
 * FTL keys the screen references are exercised too.
 *
 * Covered: initial list render (statuses, scope chips, location names),
 * empty state, load-error + retry, the create-draft flow (form fill →
 * `createMemoScoped` args → list reload), scope/duration selection, and the
 * publish flow on draft rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode } from 'react';

import MemosScreen from '@/features/memo/MemosScreen';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import type * as SubscriptionContextModule from '@/contexts/SubscriptionContext';
import type { Memo } from '@/api/memos';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Hoisted mocks ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // The shell the component believes it is running in. Desktop by default so every
  // existing case keeps its meaning; the tablet cases flip it.
  tablet: false,
  createMemoScoped: vi.fn(),
  listAuthoredMemosScoped: vi.fn(),
  publishMemoScoped: vi.fn(),
  stopMemoScoped: vi.fn(),
  reviseMemoScoped: vi.fn(),
  listLocationsScoped: vi.fn(),
}));

vi.mock('@/api/memos', () => ({
  createMemoScoped: mocks.createMemoScoped,
  listAuthoredMemosScoped: mocks.listAuthoredMemosScoped,
  publishMemoScoped: mocks.publishMemoScoped,
  stopMemoScoped: mocks.stopMemoScoped,
  reviseMemoScoped: mocks.reviseMemoScoped,
}));

// The tablet shell registers the memo CONSUMER pair and not the authoring three, so
// `MemosScreen` guards its create/revise calls. Pin that guard: with the shell mocked
// to tablet the command must NOT be invoked, because on a real device it would reject.
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => mocks.tablet,
  isDesktopShell: () => !mocks.tablet,
}));

vi.mock('@/api/locations', () => ({
  listLocationsScoped: mocks.listLocationsScoped,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

// §B gate: defaults OPEN for the regular screen tests; the gate test
// overrides per-test. subscription.ftl supplies the lock strings.
vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionContextModule>();
  return {
    ...actual,
    useAdminGate: vi.fn().mockReturnValue({ locked: false, state: 'active' }),
  };
});
import subscriptionFtl from '@/locales/subscription.ftl?raw';

// ── Fluent wrapper over the real shared.ftl ───────────────────────

function FluentWrapper({ children }: { children: ReactNode }) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(sharedFtl));
  bundle.addResource(new FluentResource(subscriptionFtl));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

// ── Fixtures ──────────────────────────────────────────────────────

const publishedOrgMemo: Memo = {
  id: 'memo-org-1',
  tenantId: 'default',
  locationIds: [],
  authorUserId: 'user-1',
  authorRole: 'role-manager',
  title: 'End-of-day checklist',
  body: 'Close the drawer and count the float.',
  status: 'published',
  duration: '24h',
  revision: 1,
  publishedAt: '2026-09-08T09:00:00Z',
  expiresAt: '2026-09-09T09:00:00Z',
  createdAt: '2026-09-08T09:00:00Z',
};

const draftLocationMemo: Memo = {
  id: 'memo-loc-1',
  tenantId: 'default',
  locationIds: ['loc-1'],
  authorUserId: 'user-1',
  authorRole: 'role-manager',
  title: 'Restock aisle 3',
  body: 'Refill the front shelf before doors open.',
  status: 'draft',
  duration: '12h',
  revision: 0,
  publishedAt: null,
  expiresAt: null,
  createdAt: '2026-09-08T10:00:00Z',
};

const sampleLocations = [
  {
    id: 'loc-1',
    name: 'Downtown',
    address: '',
    tax_id: '',
    currency: 'USD',
    timezone: 'UTC',
    is_primary: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'loc-2',
    name: 'Harbor',
    address: '',
    tax_id: '',
    currency: 'USD',
    timezone: 'UTC',
    is_primary: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const adminGate = vi.mocked(useAdminGate);

describe('MemosScreen §B administrative gate', () => {
  afterEach(() => {
    adminGate.mockReturnValue({ locked: false, state: 'active' });
  });

  it('locks the screen while the subscription is not active (grace)', () => {
    // §B: Memo authoring/management is an administrative SaaS feature —
    // it locks at expiresAt (grace onward) while operational POS
    // runtime continues.
    adminGate.mockReturnValue({ locked: true, state: 'grace' });
    render(<MemosScreen />, { wrapper: FluentWrapper });
    expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    // The authoring surface must not render behind the lock.
    expect(screen.queryByText('End-of-day checklist')).not.toBeInTheDocument();
  });
});

describe('MemosScreen', () => {
  beforeEach(() => {
    mocks.listAuthoredMemosScoped.mockReset();
    mocks.tablet = false;
    mocks.createMemoScoped.mockReset();
    mocks.publishMemoScoped.mockReset();
    mocks.stopMemoScoped.mockReset();
    mocks.reviseMemoScoped.mockReset();
    mocks.listLocationsScoped.mockReset();

    mocks.listAuthoredMemosScoped.mockResolvedValue([publishedOrgMemo, draftLocationMemo]);
    mocks.listLocationsScoped.mockResolvedValue(sampleLocations);
    mocks.createMemoScoped.mockResolvedValue({ ...draftLocationMemo });
    mocks.publishMemoScoped.mockResolvedValue({ ...publishedOrgMemo });
  });

  it('renders the authoring form and the authored memo list', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });

    expect(screen.getByRole('heading', { name: 'Memos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New memo' })).toBeInTheDocument();

    // Rows resolve: title + scope chips + status badges.
    expect(await screen.findByText('End-of-day checklist')).toBeInTheDocument();
    expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();

    // 'Organization' renders once — the org scope chip on the org-targeted row
    // (the checkbox group lists locations only; org is the empty selection).
    expect(screen.getByText('Organization')).toBeInTheDocument();
    // 'Downtown' appears twice: as the draft row's scope chip and as a
    // checkbox label.
    expect(screen.getAllByText('Downtown').length).toBeGreaterThanOrEqual(2);

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('shows the empty state when no memos exist', async () => {
    mocks.listAuthoredMemosScoped.mockResolvedValue([]);

    render(<MemosScreen />, { wrapper: FluentWrapper });

    expect(
      await screen.findByText('No memos yet. Create your first memo with the form above.'),
    ).toBeInTheDocument();
  });

  it('shows the load error and retries successfully', async () => {
    mocks.listAuthoredMemosScoped.mockRejectedValue(new Error('boom'));

    render(<MemosScreen />, { wrapper: FluentWrapper });

    expect(await screen.findByText('Failed to load memos')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();

    // A successful retry re-fetches and renders the rows.
    mocks.listAuthoredMemosScoped.mockResolvedValue([publishedOrgMemo]);
    await userEvent.click(retry);
    expect(await screen.findByText('End-of-day checklist')).toBeInTheDocument();
  });

  it('keeps the create button disabled until title and body are filled', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    const createBtn = screen.getByRole('button', { name: 'Create draft' });
    expect(createBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Title'), 'Team briefing');
    expect(createBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Message'), 'Meet at the back office at 5 PM.');
    expect(createBtn).toBeEnabled();
  });

  it('creates an organization draft from the form and reloads the list', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.type(screen.getByLabelText('Title'), 'Team briefing');
    await userEvent.type(screen.getByLabelText('Message'), 'Meet at the back office at 5 PM.');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(mocks.createMemoScoped).toHaveBeenCalledTimes(1));
    expect(mocks.createMemoScoped).toHaveBeenCalledWith('tok-1', {
      locationIds: [],
      title: 'Team briefing',
      body: 'Meet at the back office at 5 PM.',
      duration: '24h',
    });

    // The list reloads after a successful create.
    await waitFor(() => expect(mocks.listAuthoredMemosScoped).toHaveBeenCalledTimes(2));
  });

  // THE TABLET DOES NOT AUTHOR MEMOS. The mobile shell registers
  // `list_active_memos_scoped` and `acknowledge_memo_scoped` and NOT
  // `create_memo_scoped`, so submitting the form there meets `command not found`
  // and `setActionError`. The component guards on `!isTabletShell()`.
  //
  // This case pins the CALL, not the markup: the form is still rendered on tablet
  // (hiding it is a separate product decision), so what must hold is that the
  // unregistered command is never invoked. Asserting `toHaveBeenCalledTimes(0)`
  // after a real submit is the only shape that would have caught the original
  // defect -- a test that merely rendered the screen passed all the time.
  it('does not invoke createMemoScoped on the tablet shell', async () => {
    mocks.tablet = true;
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.type(screen.getByLabelText('Title'), 'Tablet briefing');
    await userEvent.type(screen.getByLabelText('Message'), 'This must not reach the shell.');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    // Give the handler a turn to settle, then assert it never called the command.
    await waitFor(() => expect(mocks.listAuthoredMemosScoped).toHaveBeenCalled());
    expect(mocks.createMemoScoped).not.toHaveBeenCalled();
  });

  // A double submit on Create draft must not store the draft TWICE.
  //
  // `canSubmit` includes `!creating`, but `creating` is STATE: React commits it on its
  // next render, after the second submit of a real double tap. core does not refuse the
  // replay either -- `create_memo_draft` mints a fresh `uuid::Uuid::now_v7()` and INSERTs
  // unconditionally (crates/kasirmu-core/src/db/memos.rs:83), with no dedupe -- so two
  // submits store TWO identical drafts.
  //
  // SHAPE 3 (round 139): both submits inside ONE act() batch. Sequential `fireEvent`
  // wraps each dispatch in its own act() and React commits `setCreating(true)` between
  // them, disabling the button -- that shape reports 1 call where a real double submit
  // sends 2. The `removeAttribute` drops the disabled flag React has set but not yet made
  // authoritative, which is the state a live double tap does not have to wait for.
  it('creates one memo draft for a double submit while the first is in flight', async () => {
    let releaseCreate: (v: unknown) => void = () => {};
    const heldCreate = new Promise((resolve) => { releaseCreate = resolve; });
    mocks.createMemoScoped.mockImplementation(() => heldCreate as never);
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.type(screen.getByLabelText('Title'), 'Team briefing');
    await userEvent.type(screen.getByLabelText('Message'), 'Meet at the back office at 5 PM.');

    // The submit is the form, not the button: a real double tap dispatches twice before
    // React can re-render, so the disabled flag is not yet in the DOM's event path.
    const form = screen.getByLabelText('Title').closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
      form.querySelectorAll('button[type=submit]').forEach((b) => b.removeAttribute('disabled'));
      fireEvent.submit(form);
    });

    expect(
      mocks.createMemoScoped.mock.calls.length,
      'a second submit re-sent the create while the first was in flight; core has no ' +
        'dedupe, so this stores TWO identical memo drafts',
    ).toBe(1);

    releaseCreate({ id: 'memo-1' });
    await waitFor(() => expect(mocks.createMemoScoped).toHaveBeenCalledTimes(1));
  });

  it('passes the selected locations and duration to createMemoScoped', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    // Multi-targeting: both location checkboxes go in as one targeting set.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Downtown' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbor' }));
    await userEvent.selectOptions(screen.getByLabelText('Duration'), '7d');
    await userEvent.type(screen.getByLabelText('Title'), 'Deep clean');
    await userEvent.type(screen.getByLabelText('Message'), 'After close on Friday.');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(mocks.createMemoScoped).toHaveBeenCalledTimes(1));
    expect(mocks.createMemoScoped).toHaveBeenCalledWith('tok-1', {
      locationIds: ['loc-1', 'loc-2'],
      title: 'Deep clean',
      body: 'After close on Friday.',
      duration: '7d',
    });
  });

  it('toggling a location checkbox back off returns to the organization audience', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Downtown' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Downtown' }));
    await userEvent.type(screen.getByLabelText('Title'), 'All hands');
    await userEvent.type(screen.getByLabelText('Message'), 'Org-wide notice.');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(mocks.createMemoScoped).toHaveBeenCalledTimes(1));
    expect(mocks.createMemoScoped).toHaveBeenCalledWith('tok-1', {
      locationIds: [],
      title: 'All hands',
      body: 'Org-wide notice.',
      duration: '24h',
    });
  });

  it('publishes a draft row and reloads the list', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    // Only the draft row offers Publish.
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(mocks.publishMemoScoped).toHaveBeenCalledWith('tok-1', 'memo-loc-1'),
    );
    await waitFor(() => expect(mocks.listAuthoredMemosScoped).toHaveBeenCalledTimes(2));
  });

  // ── Early stop (A2 ruling: author or memo:stop) ──────────────

  it('stops a published row and reloads the list', async () => {
    // On the authoring screen every row is the viewer's own memo, so the
    // author short-circuit applies — Stop renders regardless of role.
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    const stopBtn = screen.getByRole('button', { name: 'Stop' });
    expect(stopBtn).toBeInTheDocument();

    await userEvent.click(stopBtn);

    await waitFor(() =>
      expect(mocks.stopMemoScoped).toHaveBeenCalledWith('tok-1', 'memo-org-1'),
    );
    await waitFor(() => expect(mocks.listAuthoredMemosScoped).toHaveBeenCalledTimes(2));
  });

  it('shows the action error when the stop fails', async () => {
    mocks.stopMemoScoped.mockRejectedValue(new Error('boom'));
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('The memo action failed. Please try again.')).toBeInTheDocument();
  });

  // ── Revise (corrections ruled in scope 2026-09-07) ───────────

  it('loads a published row into revise mode and publishes a new revision', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    // Entering revise mode swaps the form heading and fills the fields.
    await userEvent.click(screen.getByRole('button', { name: 'Revise' }));
    expect(screen.getByRole('heading', { name: 'Revise memo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('End-of-day checklist');
    expect(screen.getByLabelText('Message')).toHaveValue('Close the drawer and count the float.');

    // The correction edits the text and submits a revision.
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'End-of-day checklist (updated)');
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));

    await waitFor(() =>
      expect(mocks.reviseMemoScoped).toHaveBeenCalledWith('tok-1', 'memo-org-1', {
        title: 'End-of-day checklist (updated)',
        body: 'Close the drawer and count the float.',
      }),
    );
    await waitFor(() => expect(mocks.listAuthoredMemosScoped).toHaveBeenCalledTimes(2));
  });

  it('cancelling revise mode returns the form to create state', async () => {
    render(<MemosScreen />, { wrapper: FluentWrapper });
    await screen.findByText('End-of-day checklist');

    await userEvent.click(screen.getByRole('button', { name: 'Revise' }));
    expect(screen.getByRole('heading', { name: 'Revise memo' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'New memo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Publish revision' })).not.toBeInTheDocument();
  });
});