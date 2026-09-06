import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  createMemoScoped,
  listAuthoredMemosScoped,
  publishMemoScoped,
  reviseMemoScoped,
  stopMemoScoped,
  type Memo,
  type MemoDuration,
} from '@/api/memos';
import { listLocationsScoped, type LocationProfile } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { l10nErrorMessage } from '@/utils/app-error';
import './MemosScreen.css';

// ── Helpers ─────────────────────────────────────────────────────────

/** Display durations in canonical order (mirrors `MemoDuration`). */
const DURATIONS: MemoDuration[] = ['12h', '24h', '3d', '7d', '30d'];

/** FTL id per duration value — the values themselves are wire literals. */
const DURATION_FLUENT_IDS: Record<MemoDuration, string> = {
  '12h': 'memos-duration-12h',
  '24h': 'memos-duration-24h',
  '3d': 'memos-duration-3d',
  '7d': 'memos-duration-7d',
  '30d': 'memos-duration-30d',
};

/** FTL id per lifecycle status (mirrors `MemoStatus`). */
const STATUS_FLUENT_IDS: Record<Memo['status'], string> = {
  draft: 'memos-status-draft',
  published: 'memos-status-published',
  expired: 'memos-status-expired',
  stopped: 'memos-status-stopped',
  archived: 'memos-status-archived',
};

function statusBadgeClass(status: Memo['status']): string {
  switch (status) {
    case 'published': return 'memos-badge--published';
    case 'draft': return 'memos-badge--draft';
    case 'stopped': return 'memos-badge--stopped';
    default: return 'memos-badge--muted';
  }
}

/**
 * Resolve the negotiated application locale from the Fluent context (same
 * approach as AuditLogScreen): the first bundle's locale wins.
 */
function activeLocale(l10n: ReturnType<typeof useLocalization>['l10n']): string {
  for (const bundle of l10n.bundles) {
    const locales = bundle.locales;
    const primary = locales && locales.length > 0 ? locales[0] : undefined;
    if (primary) return primary;
  }
  return 'en';
}

/** Format an ISO timestamp for display; falls back to the raw string. */
function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Component ───────────────────────────────────────────────────────

/**
 * Memo authoring screen (Phase 2 P1): create drafts, publish them to the
 * target terminals, and review everything the session user has authored.
 * The screen is registry-gated to `manager` + `memo:write`; the backend
 * re-checks the permission on every command (scoped — ADR #7).
 */
/**
 * §B administrative gate (todo-global-saas-1.md): Memo authoring/management
 * is an administrative SaaS feature — it locks while the subscription is
 * not `active` while POS operational runtime continues through grace.
 */
export default function MemosScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <MemosScreenContent />;
}

function MemosScreenContent() {
  const { l10n } = useLocalization();
  const locale = activeLocale(l10n);
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  // Scope options come from the location profiles. A failure here is
  // non-fatal — the form degrades to Organization-only scope rather than
  // blocking authoring.
  const [locations, setLocations] = useState<LocationProfile[]>([]);

  // Create-form state. Targeting is a set of location ids: none selected ⇒
  // Organization Memo (the empty set is the organization-wide audience).
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedLocations, setSelectedLocations] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [duration, setDuration] = useState<MemoDuration>('24h');
  const [creating, setCreating] = useState(false);
  // Revision mode: when set, the form submits a correction for the published
  // memo instead of creating a draft (the spec's "corrections create a new
  // revision"). Location/duration controls are hidden — a correction fixes
  // the text, it does not re-target or extend the memo's life.
  const [revising, setRevising] = useState<Memo | null>(null);
  // Dedicated notice for create/publish failures — the list load error state
  // only renders when the table is empty, so a publish failure with rows
  // present would otherwise be silent (same rationale as AUD-09).
  const [actionError, setActionError] = useState<string | null>(null);

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await listAuthoredMemosScoped(sessionToken);
      if (seq !== loadSeqRef.current) return;
      setMemos(rows);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(l10nErrorMessage(err, l10n, 'memos-error-load'));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [sessionToken, l10n]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    listLocationsScoped(sessionToken)
      .then((rows) => {
        if (!cancelled) setLocations(rows);
      })
      .catch(() => {
        // Non-fatal: the scope selector keeps Organization only.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !creating;

  const toggleLocation = (id: string) => {
    setSelectedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit || !sessionToken) return;
    setCreating(true);
    setActionError(null);
    try {
      await createMemoScoped(sessionToken, {
        locationIds: [...selectedLocations],
        title: title.trim(),
        body: body.trim(),
        duration,
      });
      setTitle('');
      setBody('');
      await load();
    } catch (err) {
      setActionError(l10nErrorMessage(err, l10n, 'memos-error-action'));
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (memoId: string) => {
    if (!sessionToken || publishingId) return;
    setPublishingId(memoId);
    setActionError(null);
    try {
      await publishMemoScoped(sessionToken, memoId);
      await load();
    } catch (err) {
      setActionError(l10nErrorMessage(err, l10n, 'memos-error-action'));
    } finally {
      setPublishingId(null);
    }
  };

  // Early stop (A2 ruling): on this authoring screen every row is the
  // session user's own memo, so the author short-circuit always applies —
  // the button is a first-class alternative to waiting out the duration.
  const handleStop = async (memoId: string) => {
    if (!sessionToken || stoppingId) return;
    setStoppingId(memoId);
    setActionError(null);
    try {
      await stopMemoScoped(sessionToken, memoId);
      await load();
    } catch (err) {
      setActionError(l10nErrorMessage(err, l10n, 'memos-error-action'));
    } finally {
      setStoppingId(null);
    }
  };

  const startRevise = (memo: Memo) => {
    setRevising(memo);
    setTitle(memo.title);
    setBody(memo.body);
    setSelectedLocations(new Set(memo.locationIds));
    setDuration(memo.duration);
    setActionError(null);
  };

  const cancelRevise = () => {
    setRevising(null);
    setTitle('');
    setBody('');
    setSelectedLocations(new Set());
    setDuration('24h');
    setActionError(null);
  };

  const handleRevise = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!revising || !canSubmit || !sessionToken) return;
    setCreating(true);
    setActionError(null);
    try {
      await reviseMemoScoped(sessionToken, revising.id, {
        title: title.trim(),
        body: body.trim(),
      });
      cancelRevise();
      await load();
    } catch (err) {
      setActionError(l10nErrorMessage(err, l10n, 'memos-error-action'));
    } finally {
      setCreating(false);
    }
  };

  const locationName = (id: string): string =>
    locations.find((loc) => loc.id === id)?.name ?? id.slice(0, 8);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="memos" data-testid="memos-screen">
      <div className="memos-header">
        <Localized id="memos-title">
          <h1 className="memos-title"><span>Memos</span></h1>
        </Localized>
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
          <Localized id="memos-refresh">
            <span>Refresh</span>
          </Localized>
        </Button>
      </div>

      {/* Create form */}
      <Card shadow="sm" className="memos-form-card">
        <Localized id={revising ? 'memos-revise-heading' : 'memos-new-heading'}>
          <h2 className="memos-form-heading"><span>{revising ? 'Revise memo' : 'New memo'}</span></h2>
        </Localized>
        {revising && (
          <p className="memos-revise-note">
            <Localized id="memos-revise-note">
              <span>Corrections publish a new revision (v{(revising.revision ?? 0) + 1}); the duration and audience stay unchanged.</span>
            </Localized>
          </p>
        )}
        <form
          className="memos-form"
          onSubmit={(e) => void (revising ? handleRevise(e) : handleCreate(e))}
        >
          <div className="memos-form-grid">
            <div className="memos-field memos-field--full">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="memos-label" htmlFor="memos-title-input">
                <Localized id="memos-label-title"><span>Title</span></Localized>
              </label>
              <input
                id="memos-title-input"
                className="memos-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={l10n.getString('memos-placeholder-title')}
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="memos-field">
              <span className="memos-label" id="memos-scope-label">
                <Localized id="memos-label-scope"><span>Audience</span></Localized>
              </span>
              <div
                className="memos-scope-group"
                role="group"
                aria-labelledby="memos-scope-label"
              >
                {locations.map((loc) => (
                  <label key={loc.id} className="memos-scope-option">
                    <input
                      type="checkbox"
                      checked={selectedLocations.has(loc.id)}
                      onChange={() => toggleLocation(loc.id)}
                    />
                    <span>{loc.name}</span>
                  </label>
                ))}
              </div>
              <Localized id="memos-scope-hint">
                <p className="memos-scope-hint">
                  <span>Leave every location unchecked to reach all of them (Organization).</span>
                </p>
              </Localized>
            </div>
            <div className="memos-field">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="memos-label" htmlFor="memos-duration">
                <Localized id="memos-label-duration"><span>Duration</span></Localized>
              </label>
              <select
                id="memos-duration"
                className="memos-select"
                value={duration}
                disabled={revising !== null}
                onChange={(e) => setDuration(e.target.value as MemoDuration)}
              >
                {DURATIONS.map((d) => (
                  <Localized key={d} id={DURATION_FLUENT_IDS[d]}>
                    <option value={d}>{d}</option>
                  </Localized>
                ))}
              </select>
            </div>
            <div className="memos-field memos-field--full">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="memos-label" htmlFor="memos-body">
                <Localized id="memos-label-body"><span>Message</span></Localized>
              </label>
              <textarea
                id="memos-body"
                className="memos-textarea"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={l10n.getString('memos-placeholder-body')}
              />
            </div>
          </div>
          {actionError && (
            <div className="memos-action-error" role="alert">
              <span className="memos-action-error-icon" aria-hidden="true">⚠</span>
              {actionError}
            </div>
          )}
          <div className="memos-form-actions">
            {revising ? (
              <>
                <Button type="submit" disabled={!canSubmit} state={creating ? 'processing' : 'ready'}>
                  <Localized id="memos-revise">
                    <span>Publish revision</span>
                  </Localized>
                </Button>
                <Button type="button" variant="secondary" onClick={cancelRevise}>
                  <Localized id="memos-revise-cancel">
                    <span>Cancel</span>
                  </Localized>
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!canSubmit} state={creating ? 'processing' : 'ready'}>
                <Localized id="memos-create">
                  <span>Create draft</span>
                </Localized>
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Authored list */}
      {loading && memos.length === 0 ? (
        <div className="memos-loading-skeleton" aria-hidden="true">
          <div className="memos-table-wrap">
            <table className="memos-table">
              <thead>
                <tr>
                  <Localized id="memos-col-title"><th><span>Title</span></th></Localized>
                  <Localized id="memos-col-scope"><th><span>Audience</span></th></Localized>
                  <Localized id="memos-col-status"><th><span>Status</span></th></Localized>
                  <Localized id="memos-col-duration"><th><span>Duration</span></th></Localized>
                  <Localized id="memos-col-revision"><th><span>Revision</span></th></Localized>
                  <Localized id="memos-col-created"><th><span>Created</span></th></Localized>
                  <Localized id="memos-col-actions"><th><span>Actions</span></th></Localized>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton variant="text" width="10rem" /></td>
                    <td><Skeleton variant="text" width="6rem" /></td>
                    <td><Skeleton variant="block" width="4.5rem" height="1.25rem" /></td>
                    <td><Skeleton variant="text" width="5rem" /></td>
                    <td><Skeleton variant="text" width="2rem" /></td>
                    <td><Skeleton variant="text" width="8rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.75rem" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : error && memos.length === 0 ? (
        <Card shadow="sm">
          <div className="memos-state">
            <p>{error}</p>
            <Localized id="memos-retry">
              <Button variant="secondary" onClick={() => void load()}><span>Retry</span></Button>
            </Localized>
          </div>
        </Card>
      ) : memos.length === 0 && !loading ? (
        <Card shadow="sm">
          <div className="memos-state">
            <Localized id="memos-empty">
              <span>No memos yet. Create your first memo with the form above.</span>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="memos-table-wrap">
          <table className="memos-table" aria-label={l10n.getString('memos-table-aria')}>
            <thead>
              <tr>
                <Localized id="memos-col-title"><th><span>Title</span></th></Localized>
                <Localized id="memos-col-scope"><th><span>Audience</span></th></Localized>
                <Localized id="memos-col-status"><th><span>Status</span></th></Localized>
                <Localized id="memos-col-duration"><th><span>Duration</span></th></Localized>
                <Localized id="memos-col-revision"><th><span>Revision</span></th></Localized>
                <Localized id="memos-col-created"><th><span>Created</span></th></Localized>
                <Localized id="memos-col-actions"><th><span>Actions</span></th></Localized>
              </tr>
            </thead>
            <tbody>
              {memos.map((memo) => (
                <tr key={memo.id}>
                  <td className="memos-cell-title">
                    <span className="memos-memo-title">{memo.title}</span>
                    <span className="memos-body-preview">
                      {memo.body.slice(0, 80)}{memo.body.length > 80 ? '…' : ''}
                    </span>
                  </td>
                  <td>
                    {memo.locationIds.length === 0 ? (
                      <Localized id="memos-scope-org">
                        <span className="memos-scope-chip memos-scope-chip--org">Organization</span>
                      </Localized>
                    ) : (
                      <span className="memos-scope-chips">
                        {memo.locationIds.map((id) => (
                          <span key={id} className="memos-scope-chip" title={id}>
                            {locationName(id)}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`memos-badge ${statusBadgeClass(memo.status)}`}>
                      <Localized id={STATUS_FLUENT_IDS[memo.status]}>
                        <span>{memo.status}</span>
                      </Localized>
                    </span>
                  </td>
                  <td>
                    <Localized id={DURATION_FLUENT_IDS[memo.duration]}>
                      <span>{memo.duration}</span>
                    </Localized>
                  </td>
                  <td className="memos-cell-mono">v{memo.revision}</td>
                  <td className="memos-cell-date">
                    <time dateTime={memo.createdAt} title={memo.createdAt}>
                      {formatDate(memo.createdAt, locale)}
                    </time>
                  </td>
                  <td>
                    {memo.status === 'draft' ? (
                      <Localized id="memos-publish">
                        <Button
                          size="sm"
                          variant="secondary"
                          state={publishingId === memo.id ? 'processing' : 'ready'}
                          onClick={() => void handlePublish(memo.id)}
                        >
                          <span>Publish</span>
                        </Button>
                      </Localized>
                    ) : memo.status === 'published' ? (
                      <span className="memos-actions-pair">
                        <Localized id="memos-revise-row">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => startRevise(memo)}
                          >
                            <span>Revise</span>
                          </Button>
                        </Localized>
                        <Localized id="memos-stop">
                          <Button
                            size="sm"
                            variant="secondary"
                            state={stoppingId === memo.id ? 'processing' : 'ready'}
                            onClick={() => void handleStop(memo.id)}
                          >
                            <span>Stop</span>
                          </Button>
                        </Localized>
                      </span>
                    ) : (
                      <span className="memos-actions-none">&mdash;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
