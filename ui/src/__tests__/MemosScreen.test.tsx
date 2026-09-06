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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode } from 'react';

import MemosScreen from '@/features/memo/MemosScreen';
import type { Memo } from '@/api/memos';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Hoisted mocks ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  createMemoScoped: vi.fn(),
  listAuthoredMemosScoped: vi.fn(),
  publishMemoScoped: vi.fn(),
  listLocationsScoped: vi.fn(),
}));

vi.mock('@/api/memos', () => ({
  createMemoScoped: mocks.createMemoScoped,
  listAuthoredMemosScoped: mocks.listAuthoredMemosScoped,
  publishMemoScoped: mocks.publishMemoScoped,
}));

vi.mock('@/api/locations', () => ({
  listLocationsScoped: mocks.listLocationsScoped,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

// ── Fluent wrapper over the real shared.ftl ───────────────────────

function FluentWrapper({ children }: { children: ReactNode }) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(sharedFtl));
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

describe('MemosScreen', () => {
  beforeEach(() => {
    mocks.listAuthoredMemosScoped.mockReset();
    mocks.createMemoScoped.mockReset();
    mocks.publishMemoScoped.mockReset();
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
});
