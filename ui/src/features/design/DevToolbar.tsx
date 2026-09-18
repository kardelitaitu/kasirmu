import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTheme, type Theme } from '@/app/ThemeProvider';
import { useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createMemoScoped, publishMemoScoped, type MemoDuration } from '@/api/memos';
import { listLocationsScoped } from '@/api/locations';
import { parseAppError } from '@/utils/app-error';
import { devLog } from '@/utils/devLog';
import './DevToolbar.css';

/**
 * Render a rejected spawn as a single diagnostic line.
 *
 * A Tauri command rejects with the typed `AppError` OBJECT, not an `Error`,
 * so the previous `e instanceof Error ? e.message : String(e)` produced the
 * literal string `[object Object]` for every real backend refusal — which is
 * how a refused Location Memo publish came to be reported as nothing at all.
 * `parseAppError` also unwraps the v2 runtime's JSON-prefixed error string.
 * This is a DEV surface, so the raw backend message is the point; the
 * user-safe mapping in `plainErrorMessage` deliberately hides it.
 */
function describeSpawnError(e: unknown): string {
  const typed = parseAppError(e);
  if (typed) {
    const sub = 'subKind' in typed && typed.subKind ? `${typed.subKind}: ` : '';
    return `${sub}${typed.message ?? typed.kind}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// ── SVG icons ──────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

interface ThemeOption {
  key: Theme;
  label: string;
  icon: ReactNode;
  swatches: string[];
}

const THEMES: ThemeOption[] = [
  { key: 'light', label: 'Light', icon: <SunIcon />, swatches: ['#f1f5f9', '#1052bc', '#1e293b'] },
  { key: 'dark', label: 'Dark', icon: <MoonIcon />, swatches: ['#080e16', '#5a9fd4', '#cddff0'] },
];

const STORAGE_POS = 'oz-pos-dev-toolbar-pos';

// The toolbar is a fixed 256×256 panel (DevToolbar.css). Clamping keeps
// at least the drag handle on-screen: without it, a position saved on a
// larger window (or a drag to the viewport edge) remounts the toolbar
// out of view on the next load, with no way to recover it.
const TOOLBAR_SIZE = 256;
const MIN_VISIBLE = 48;

function clampToViewport(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, MIN_VISIBLE - TOOLBAR_SIZE), window.innerWidth - MIN_VISIBLE),
    y: Math.min(Math.max(y, MIN_VISIBLE - TOOLBAR_SIZE), window.innerHeight - MIN_VISIBLE),
  };
}

// Spawned memos cycle the display-duration ladder so one dev session can
// exercise every expiry class without re-authoring by hand.
const SPAWN_DURATIONS: MemoDuration[] = ['12h', '24h', '3d', '7d', '30d'];
let spawnDurationIndex = 0;

/** One dev memo fixture: a body tuned to a rendered shape. */
export interface MemoFixture {
  /** RENDERED line count the body is tuned to produce in the bubble. */
  lines: 1 | 2 | 3 | 6;
  /** Whether the LAST rendered line is a stub or nearly full. */
  tail: 'short' | 'long';
  /** The memo body. No trailing duration: see the note below. */
  body: string;
}

/**
 * The bodies a dev spawn cycles through — one per (line count × tail)
 * combination the memo display surface has to survive (owner direction,
 * 2026-09-19: "we want more variation on both org + location memo").
 *
 * `lines` is the RENDERED line count, not a newline count. The bubble wraps
 * with `white-space: normal`, so any `\n` in a body collapses to a space and
 * only the wrap decides how many lines appear — the fixtures are therefore
 * prose of a tuned LENGTH, never text with inserted breaks. `tail` describes
 * the final line: `short` leaves a stub, `long` nearly fills it. That pair is
 * the point — a stub is what exposes an orphan, a full line is what exposes
 * an over-eager clamp.
 *
 * MEASURED, NOT ASSUMED. Sweeping body length through the real bubble at its
 * 560px cap (`--text-md` at this app's 14px root) gives the char band for each
 * rendered line count:
 *
 *   1 line   27..76      4 lines  246..306     7 lines  472..541
 *   2 lines  85..161     5 lines  319..381
 *   3 lines 172..232     6 lines  395..460
 *
 * `.memo-banner-text` carries `text-wrap: pretty`, so an orphan is rebalanced
 * rather than left as a lone word — the bands above already include that, and
 * a greedy-wrap estimate will not reproduce them. Each fixture sits near an
 * END of its band: `short` low in it, `long` high in it, so the pair brackets
 * the shape rather than sampling its middle. Re-measure after any change to
 * the bubble width, the body font size, or the text-wrap rule.
 *
 * No duration is appended to these bodies on purpose: a 15-character
 * "Duration: 12h." suffix would push each fixture across a line boundary by a
 * variable amount and silently destroy the tuning. The duration still cycles
 * per spawn and is reported in the toolbar's status line.
 */
export const MEMO_FIXTURES: readonly MemoFixture[] = [
  { lines: 1, tail: 'short', body: 'Back in five minutes.' },
  {
    lines: 1,
    tail: 'long',
    body: 'Front counter float is short — top it up before the evening shift.',
  },
  {
    lines: 2,
    tail: 'short',
    body: 'Please restock the chiller before lunch and check the dairy dates on everything in the fridge.',
  },
  {
    lines: 2,
    tail: 'long',
    body: 'Please restock the chiller before lunch and check the dairy dates. The front counter float is short, so top it up before the evening shift starts today.',
  },
  {
    lines: 3,
    tail: 'short',
    body: 'Please restock the chiller before lunch and check the dairy dates. The front counter float is short, so top it up before the evening shift starts today. Sort the returns first.',
  },
  {
    lines: 3,
    tail: 'long',
    body: 'Please restock the chiller before lunch and check the dairy dates. The front counter float is short, so top it up before the evening shift starts today. Sort the returns first. Deep clean the coffee machine tonight and log it.',
  },
  {
    lines: 6,
    tail: 'short',
    body: 'Please restock the chiller before lunch and check the dairy dates. The front counter float is short, so top it up before the evening shift starts today. Sort the returns first. Deep clean the coffee machine tonight and log it. Two crates of cooking oil arrived damaged, so hold them for returns. The back door lock is sticking again, so report it to maintenance. Check the back door lock and the shutter today.',
  },
  {
    lines: 6,
    tail: 'long',
    body: 'Please restock the chiller before lunch and check the dairy dates. The front counter float is short, so top it up before the evening shift starts today. Sort the returns first. Deep clean the coffee machine tonight and log it. Two crates of cooking oil arrived damaged, so hold them for returns. The back door lock is sticking again, so report it to maintenance. Check the back door lock and the shutter today. Move the seasonal display to the window.',
  },
];
let spawnFixtureIndex = 0;

// ── Draggable hook ─────────────────────────────────────────────────

function useDragToolbar() {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_POS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          // Clamp into the CURRENT viewport — the saved position may
          // predate a window resize or monitor change.
          return clampToViewport(parsed.x, parsed.y);
        }
        // Corrupt stored position — clear and reset
        localStorage.removeItem(STORAGE_POS);
      }
    } catch { /* ignore */ }
    return { x: -1, y: -1 }; // -1 means default (bottom-right)
  });

  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const offset = useRef({ x: -1, y: -1 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    offset.current = { x: pos.x, y: pos.y };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [pos]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      setPos(clampToViewport(offset.current.x + dx, offset.current.y + dy));
    };

    const handleUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Persist position on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_POS, JSON.stringify(pos));
    } catch { /* ignore */ }
  }, [pos]);

  return { pos, onMouseDown };
}

// ── Component ──────────────────────────────────────────────────────

/**
 * DevToolbar — a draggable developer overlay providing realtime
 * theme switching and one-click memo spawning. Always visible. Remove
 * when no longer needed.
 */
export function DevToolbar() {
  const { l10n } = useLocalization();
  const { theme, setTheme } = useTheme();
  const { pos, onMouseDown } = useDragToolbar();
  const { sessionToken } = useWorkspace();
  const currentTheme = THEMES.find((t) => t.key === theme);
  const [spawning, setSpawning] = useState(false);
  const [spawnStatus, setSpawnStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(
    null,
  );

  /**
   * Draft + publish a memo through the REAL IPC surface (the same
   * commands the authoring screen uses — in dev mode the dev-mock
   * answers), then fire `memos:refresh` so every mounted memo banner
   * picks it up immediately instead of waiting out the server-issued
   * poll cadence (up to 15 minutes).
   *
   * `org` spawns an Organization Memo (empty targeting = everyone);
   * `loc` targets the first location the environment serves.
   *
   * Each spawn takes the NEXT fixture from [`MEMO_FIXTURES`] and advances the
   * index, so clicking repeatedly walks all eight shapes (1/2/3/6 rendered
   * lines, each short- and long-tailed) on either scope. The title names the
   * fixture it spawned — `· 3L short` — which is what makes a screenshot or a
   * report self-identifying. The title carries NO timestamp (owner direction,
   * 2026-09-19: "its a memo, no need clock"); the fixture tag is not a clock,
   * it says which fixture you are looking at.
   *
   * Every outcome is REPORTED under the buttons, because the silent path is
   * indistinguishable from a broken button. The `loc` spawn in particular can
   * be refused by the backend: `publish_memo` fans a Location Memo out only to
   * terminals whose `bound_location_id` matches, and refuses the publish
   * outright when that set is empty, so the memo stays a DRAFT and nothing
   * renders. That refusal is correct — it is the toolbar's silence about it
   * that reads as "not working".
   */
  const spawnMemo = useCallback(async (scope: 'org' | 'loc') => {
    if (!sessionToken || spawning) return;
    setSpawning(true);
    setSpawnStatus(null);
    const label = scope === 'org' ? 'Organization' : 'Location';
    try {
      let locationIds: string[] = [];
      if (scope === 'loc') {
        const locations = await listLocationsScoped(sessionToken);
        const first = locations[0]?.id;
        if (!first) {
          const text = 'no locations exist in this environment';
          devLog.warn('dev-toolbar', `${text}; spawn a Location memo after creating one`);
          setSpawnStatus({ tone: 'error', text: `Location memo: ${text}` });
          return;
        }
        locationIds = [first];
      }
      const duration = SPAWN_DURATIONS[spawnDurationIndex % SPAWN_DURATIONS.length]!;
      spawnDurationIndex += 1;
      const fixture = MEMO_FIXTURES[spawnFixtureIndex % MEMO_FIXTURES.length]!;
      spawnFixtureIndex += 1;
      const memo = await createMemoScoped(sessionToken, {
        locationIds,
        title: `Dev ${label} memo · ${fixture.lines}L ${fixture.tail}`,
        body: fixture.body,
        duration,
      });
      await publishMemoScoped(sessionToken, memo.id);
      window.dispatchEvent(new CustomEvent('memos:refresh'));
      setSpawnStatus({
        tone: 'ok',
        text: `${label} memo ${fixture.lines}L ${fixture.tail} published${locationIds.length ? ` to ${locationIds[0]}` : ''} · ${duration}`,
      });
    } catch (e) {
      const text = describeSpawnError(e);
      devLog.error('dev-toolbar', `memo spawn failed: ${text}`);
      setSpawnStatus({ tone: 'error', text: `${label} memo: ${text}` });
    } finally {
      setSpawning(false);
    }
  }, [sessionToken, spawning]);

  const style: React.CSSProperties | undefined =
    pos.x !== -1 || pos.y !== -1
      ? { left: pos.x, top: pos.y, bottom: undefined, right: undefined }
      : undefined;

  return (
    <div
      className="dev-toolbar"
      style={style}
      role="toolbar"
      aria-label={l10n.getString('developer-tools-aria')}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="dev-toolbar-header" onMouseDown={onMouseDown}>
        <span>DevTools</span>
      </div>

      <div className="dev-toolbar-body">
        <p className="dev-toolbar-label">Theme</p>
        <div className="dev-toolbar-themes" role="radiogroup" aria-label={l10n.getString('theme-selector-aria')}>
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`dev-toolbar-theme-btn${theme === t.key ? ' dev-toolbar-theme-btn--active' : ''}`}
              onClick={() => setTheme(t.key)}
              role="radio"
              aria-checked={theme === t.key}
              aria-label={`${t.label} theme`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="dev-toolbar-bottom">
          <span className="dev-toolbar-badge">
            {currentTheme?.label ?? theme}
          </span>
          <div className="dev-toolbar-swatches" aria-hidden="true">
            {currentTheme?.swatches.map((c, i) => (
              <span key={i} className="dev-toolbar-swatch" style={{ background: c }} />
            ))}
          </div>
        </div>

        <div className="dev-toolbar-actions">
          <button
            type="button"
            className="dev-toolbar-action-btn"
            onClick={() => void spawnMemo('org')}
            disabled={!sessionToken || spawning}
            aria-label="Spawn an Organization memo (draft + publish)"
          >
            Spawn Org memo
          </button>
          <button
            type="button"
            className="dev-toolbar-action-btn"
            onClick={() => void spawnMemo('loc')}
            disabled={!sessionToken || spawning}
            aria-label="Spawn a Location memo targeting the first location (draft + publish)"
          >
            Spawn Loc memo
          </button>
          <button
            type="button"
            className="dev-toolbar-action-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('app:lock'))}
          >
            Lock
          </button>
        </div>

        {spawnStatus && (
          <p
            className={`dev-toolbar-status dev-toolbar-status--${spawnStatus.tone}`}
            role="status"
          >
            {spawnStatus.text}
          </p>
        )}
      </div>
    </div>
  );
}
