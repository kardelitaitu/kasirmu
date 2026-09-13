// ── Deploy history browser (ADR #46 §2, §4, §8) ─────────────────────
//
// The behaviour that matters here is not "does it render" but the three
// promises the ADR makes about what history LOOKS like:
//   §4  a pruned snapshot is still a record — shown, with its who/when/why,
//       and only its preview affordance withdrawn
//   §8  "we deployed X on Tuesday" stays answerable — so the timestamp is
//       absolute, and a deflated row must never read as "this never happened"
//   §10 geometry is counted, never itemised, and volatile fields are absent
//
// The dev-mock backs the IPC, so these run against the same three-way
// restorable/deflated/not-found shapes the real commands return.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import type { TopologyNodePayload } from '@/api/topology';
// Type-only: erased at runtime, so the per-test `vi.resetModules()` + dynamic
// import below still gets a FRESH module instance while these stay typed.
import type * as TopologyApi from '@/api/topology';
import type TopologyRevisionBrowserType from '../features/locations/TopologyRevisionBrowser';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@tauri-apps/api/core', async () => {
  const { invoke } = await import('@/dev-mock/tauri-api');
  return { invoke };
});

/** English text for the keys these tests assert on; everything else falls
 *  back to the key, which is fine because those are not inspected. */
const EN: Record<string, string> = {
  'topology-rev-browser-preview': 'Show on canvas',
  'topology-rev-browser-pruned': 'Snapshot pruned — record kept',
  'topology-rev-browser-identical': 'Same configuration as now',
  'topology-rev-browser-empty': 'Nothing has been applied to this branch yet.',
  'topology-rev-browser-no-note': 'No note',
};

vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual('@fluent/react');
  return {
    ...actual,
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({
      l10n: {
        bundles: [{ locales: ['en'] }],
        getString: (key: string) => EN[key] ?? key,
      },
    }),
  };
});

const TOKEN = 'test-session-token';

/** Loaded fresh per test. The dev-mock initialises `mockTopology` and
 *  `mockTopologyRevisions` from localStorage at MODULE scope, so without a
 *  reset every test in this file inherits the previous one's deploys and the
 *  row counts below would be meaningless. */
let api: typeof TopologyApi;
let Browser: React.ComponentType<React.ComponentProps<typeof TopologyRevisionBrowserType>>;

const node = (id: string, name: string, x = 0): TopologyNodePayload => ({
  id, type: 'store', name, x, y: 0,
});

/** Apply through the real dev-mock, so the rows are the ones the
 *  backend-shaped code produces — including deflation past the budget. */
const deploy = async (nodes: TopologyNodePayload[], note: string, branchId?: string) => {
  // baseRevision must be the LIVE one. `applyTopologyDiff` declares it as
  // `baseRevision = 0`, so passing `undefined` sends 0 rather than omitting
  // it, and the dev-mock's conflict gate (correctly) rejects the second
  // deploy in any test.
  const current = await api.loadTopology();
  return api.applyTopologyDiff(
    TOKEN, [], [], [], nodes, [], branchId,
    current?.revision ?? 0,
    undefined, [], note,
  );
};

const renderBrowser = (props: Record<string, unknown> = {}) =>
  renderWithProvidersSync(
    <Browser
      sessionToken={TOKEN}
      currentGraph={{ nodes: [], wires: [] }}
      onClose={() => {}}
      onPreview={() => {}}
      {...props}
    />,
    multiStoreFtl,
    sharedFtl,
  );

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  api = await import('@/api/topology');
  Browser = (await import('../features/locations/TopologyRevisionBrowser')).default;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Each test deploys into its own branch. The dev-mock keeps its revision
// array at module scope and re-reads it from localStorage, which
// vi.resetModules() does not reliably undo once the IPC mock factory has
// resolved — so per-branch scoping is what actually isolates these tests,
// and it is also how the real backend behaves.
let BRANCH = 'branch-default';
beforeEach(() => {
  BRANCH = `branch-${Math.random().toString(36).slice(2, 10)}`;
});

describe('TopologyRevisionBrowser', () => {
  it('lists deploys newest-first with who, when and why', async () => {
    await deploy([node('a', 'Alpha')], 'first deploy', BRANCH);
    await deploy([node('a', 'Alpha'), node('b', 'Beta')], 'second deploy', BRANCH);
    renderBrowser({ branchId: BRANCH });

    const rows = await waitFor(() => {
      const found = document.querySelectorAll('.topology-rev-browser-row');
      expect(found.length).toBe(2);
      return found;
    });
    const notes = [...rows].map((r) =>
      r.querySelector('.topology-rev-browser-note')?.textContent?.trim());
    expect(notes).toEqual(['second deploy', 'first deploy']);
    // The publisher is shown, which is the §6 audit question answered inline.
    expect(rows[0]?.querySelector('.topology-rev-browser-meta')?.textContent)
      .toContain('dev-mock');
  });

  it('offers no preview for a pruned snapshot, but keeps its record', async () => {
    // 25 deploys, budget 20 -> the five oldest lose their diagram.
    for (let i = 0; i < 25; i += 1) {
      await deploy([node('a', 'Alpha')], `deploy ${i}`, BRANCH);
    }
    const list = await api.listTopologyRevisions(TOKEN, BRANCH, 50);
    const pruned = list.find((r) => !r.restorable);
    expect(pruned, 'the dev-mock should have deflated at least one row').toBeDefined();

    renderBrowser({ branchId: BRANCH });
    await waitFor(() =>
      expect(document.querySelectorAll('.topology-rev-browser-row').length).toBe(list.length));

    // Match on the row's OWN note rather than on `revision - 1`: the dev-mock
    // keeps one global revision counter across branches, so a test that runs
    // after another deploy has revisions offset by that test's deploys. The
    // arithmetic passed in isolation and failed in the full file — which is the
    // usual lesson about tests that depend on global sequence numbers.
    const prunedRow = [...document.querySelectorAll('.topology-rev-browser-row')].find((row) =>
      row.querySelector('.topology-rev-browser-note')?.textContent?.trim() === pruned!.changeNote);
    expect(prunedRow).toBeDefined();
    // §8: the record survives. Selecting it must not pretend it never happened.
    fireEvent.click(prunedRow!.querySelector('.topology-rev-browser-row-main')!);
    await waitFor(() =>
      expect(document.querySelector('.topology-rev-browser-detail')).not.toBeNull());
    // waitFor, not a direct read: the detail is rendered after an await, so
    // asserting immediately races it. (A debug line that awaited the API here
    // made the test pass, which is what identified the race rather than a
    // missing deflated branch.)
    await waitFor(() =>
      expect(document.querySelector('.topology-rev-browser-detail')?.textContent)
        .toContain('topology-rev-browser-deflated-body'));
    // ...and the preview affordance is withdrawn, not merely disabled.
    expect(prunedRow?.querySelector('.topology-rev-browser-pruned')).not.toBeNull();
  });

  it('says "same configuration as now" rather than showing an empty diff', async () => {
    const graph = [node('a', 'Alpha')];
    await deploy(graph, 'unchanged since', BRANCH);
    renderBrowser({ currentGraph: { nodes: graph, wires: [] }, branchId: BRANCH });

    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByText('Same configuration as now')).toBeInTheDocument());
  });

  it('counts geometry instead of itemising it (§10)', async () => {
    await deploy([node('a', 'Alpha', 0)], 'moved only', BRANCH);
    renderBrowser({
      currentGraph: { nodes: [node('a', 'Alpha', 400)], wires: [] },
      branchId: BRANCH,
    });

    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    // Identical business configuration, so the merchant sees the count and not
    // a scary list of "changes".
    await waitFor(() =>
      expect(screen.getByText('Same configuration as now')).toBeInTheDocument());
    expect(document.querySelector('.topology-rev-browser-geometry')?.textContent)
      .toContain('topology-rev-browser-geometry');
    expect(document.querySelectorAll('.topology-rev-browser-change')).toHaveLength(0);
  });

  it('pins and unpins without a reload', async () => {
    await deploy([node('a', 'Alpha')], 'pin me', BRANCH);
    renderBrowser({ branchId: BRANCH });
    await waitFor(() =>
      expect(document.querySelectorAll('.topology-rev-browser-row').length).toBe(1));

    const pinBtn = document.querySelector('.topology-rev-browser-pin') as HTMLButtonElement;
    expect(pinBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pinBtn);

    await waitFor(() =>
      expect((document.querySelector('.topology-rev-browser-pin') as HTMLButtonElement)
        .getAttribute('aria-pressed')).toBe('true'));
    // The backend agrees, so the UI is not the only place the pin exists.
    const after = await api.listTopologyRevisions(TOKEN, BRANCH, 50);
    expect(after[0]?.pinned).toBe(true);
  });

  it('shows an honest empty state rather than a blank panel', async () => {
    // No deploys in this branch scope.
    renderBrowser({ branchId: 'branch-never-applied' });
    await waitFor(() =>
      expect(screen.getByText('Nothing has been applied to this branch yet.')).toBeInTheDocument());
  });

  // ── Phase 2: restore-to-draft (§5) + pruned-snapshot messaging (§4, §7) ──

  it('offers restore to a writable host and reports the revision asked for', async () => {
    await deploy([node('a', 'Alpha')], 'restorable', BRANCH);
    renderBrowser({ branchId: BRANCH, onRestore: vi.fn() });
    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    const restore = await waitFor(() => {
      const b = document.querySelector('.topology-rev-browser-restore');
      expect(b).not.toBeNull();
      return b as HTMLButtonElement;
    });
    expect(restore.disabled).toBe(false);
    expect(restore.getAttribute('aria-label')).toBe('topology-rev-browser-restore-aria');
  });

  it('offers no restore affordance at all without a host callback', async () => {
    await deploy([node('a', 'Alpha')], 'no host', BRANCH);
    renderBrowser({ branchId: BRANCH });
    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    await waitFor(() =>
      expect(document.querySelector('.topology-rev-browser-detail-actions')).not.toBeNull());
    expect(document.querySelector('.topology-rev-browser-restore')).toBeNull();
  });

  it('withdraws restore from a pruned row alongside the preview (§4)', async () => {
    for (let i = 0; i < 25; i += 1) {
      await deploy([node('a', 'Alpha')], `pruned restore ${i}`, BRANCH);
    }
    const list = await api.listTopologyRevisions(TOKEN, BRANCH, 50);
    const pruned = list.find((r) => !r.restorable);
    expect(pruned).toBeDefined();
    renderBrowser({ branchId: BRANCH, onRestore: vi.fn() });
    await waitFor(() =>
      expect(document.querySelectorAll('.topology-rev-browser-row').length).toBe(list.length));
    const prunedRow = [...document.querySelectorAll('.topology-rev-browser-row')].find((row) =>
      row.querySelector('.topology-rev-browser-note')?.textContent?.trim() === pruned!.changeNote);
    expect(prunedRow).toBeDefined();
    fireEvent.click(prunedRow!.querySelector('.topology-rev-browser-row-main')!);
    // §4's remedy, stated where the loss is visible — not a dead end.
    await waitFor(() =>
      expect(document.querySelector('.topology-rev-browser-detail')?.textContent)
        .toContain('topology-rev-browser-deflated-remedy'));
    expect(document.querySelector('.topology-rev-browser-restore')).toBeNull();
  });

  it('flags a revision recorded under an older contract instead of hiding it (§7)', async () => {
    // Deploy normally, then demote the reported contract axis. The dev-mock
    // keeps its rows in module-scope memory that vi.resetModules cannot
    // rewind once the IPC factory has resolved (see the file header), so
    // patching storage is invisible — a wrapper mock over the api module is
    // the honest lever: it reports exactly what the real backend would for
    // a pre-v2 row.
    await deploy([node('a', 'Alpha')], 'old contract', BRANCH);
    vi.doMock('@/api/topology', async (importOriginal) => {
      const real = await importOriginal<typeof TopologyApi>();
      return {
        ...real,
        listTopologyRevisions: async (...args: Parameters<typeof real.listTopologyRevisions>) =>
          (await real.listTopologyRevisions(...args)).map((r) => ({ ...r, contractSchemaVersion: 1 })),
        loadTopologyRevision: async (...args: Parameters<typeof real.loadTopologyRevision>) => {
          const g = await real.loadTopologyRevision(...args);
          return g.status === 'restorable' ? { ...g, contractSchemaVersion: 1 } : g;
        },
      };
    });
    vi.resetModules();
    api = await import('@/api/topology');
    Browser = (await import('../features/locations/TopologyRevisionBrowser')).default;

    renderBrowser({ branchId: BRANCH, onRestore: vi.fn() });
    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    // The note renders as a NOTE (not an error) — and restore is still
    // offered: the draft loads and Apply re-validates against today's
    // contract. (The version numbers ride the l10n args; this test's
    // mocked getString returns the raw template, so the element's
    // existence is the component's contract here.)
    await waitFor(() =>
      expect(document.querySelector('.topology-rev-browser-old-contract')).not.toBeNull());
    expect(document.querySelector('.topology-rev-browser-old-contract')?.getAttribute('role'))
      .toBe('note');
    expect(document.querySelector('.topology-rev-browser-restore')).not.toBeNull();
  });

  it('shows the in-flight label on the restoring revision only', async () => {
    await deploy([node('a', 'Alpha')], 'slow arm', BRANCH);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    renderBrowser({
      branchId: BRANCH,
      onRestore: () => gate,
      // The host reports WHICH revision is arming; only that row's button
      // reads in-flight (a distinct key, per the file's one-English-fallback
      // rule).
      restoringRevision: null,
    });
    const row = await waitFor(() => {
      const r = document.querySelector('.topology-rev-browser-row-main');
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    fireEvent.click(row);
    const restore = await waitFor(() => {
      const b = document.querySelector('.topology-rev-browser-restore');
      expect(b).not.toBeNull();
      return b as HTMLButtonElement;
    });
    expect(restore.textContent).toBe('Restore to editor');
    release();
  });
});
