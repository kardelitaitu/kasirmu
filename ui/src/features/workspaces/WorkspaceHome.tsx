import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFullscreen } from '@/hooks/useFullscreen';
import { Localized, useLocalization } from '@fluent/react';
import { ConfirmDialog, requiredLocalized } from '@/frontend/shared';
import { WorkspaceIcon } from '@/components/WorkspaceIcon';
import { RoleIcon } from '@/components/RoleIcon';
import OrgSelector from '@/components/OrgSelector';
import type { LoginSessionDto } from '@/api/staff';
import { useSubscription, useAdminGate } from '@/contexts/SubscriptionContext';
import { tierSatisfies } from '@/utils/tierLevel';
import { ROLE_HIERARCHY, roleAtLeast } from '@/utils/role';
import { TOOLS, TOOL_GROUP_ORDER, type ToolItem, type ToolGroupId } from './tools';
import { ToolsCategoryGrid } from './components/ToolsCategoryGrid';
import type { ToolLockReason } from './components/ToolCard';
import './WorkspaceHome.css';

// ── Per-workspace accent color classes ────────────────────────────

const WS_COLORS: Record<string, string> = {
  'restaurant-pos': 'ws-color-restaurant-pos',
  'store-pos': 'ws-color-store-pos',
  kds: 'ws-color-kds',
  warehouse: 'ws-color-warehouse',
  admin: 'ws-color-admin',
};

// ── Favorites persistence (localStorage) ─────────────────────────

const PINS_KEY = 'workspace-pins';
const LAST_USED_KEY = 'workspace-last-used';

function loadPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function savePins(pins: Set<string>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(pins)));
  } catch {
    // Quota / private-mode / disabled storage — fail silently (mirrors loadPins).
  }
}

function loadLastUsed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveLastUsed(lastUsed: Record<string, number>) {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(lastUsed));
  } catch {
    // Quota / private-mode / disabled storage — fail silently (mirrors loadLastUsed).
  }
}

// ── Workspace sort order ──────────────────────────────────────────

/**
 * How many cards a single digit keypress can reach. The handler accepts exactly
 * `1`-`9` and maps them with `parseInt(e.key, 10) - 1`, so indices 0-8 are
 * addressable and index 9 is not: a tenth card would have to be named by the
 * two-character sequence "10", which arrives as two keydowns (`1` then `0`) and
 * selects nothing. The cap is therefore the design, not an oversight -- what was
 * wrong is the overlay label that advertised a key no handler can receive. Gate
 * the label on this; do not renumber the cards, which would only move the lie to
 * the last slot. Pinned by WorkspaceHome.test.tsx "advertises a digit shortcut
 * only for the cards that digit can reach".
 */
const MAX_DIGIT_SHORTCUT = 9;

const WS_ORDER: Record<string, number> = {
  'restaurant-pos': 1,
  'store-pos': 2,
  kds: 3,
  warehouse: 4,
  admin: 5,
};

// ── Tools section — declarative access policy (todo-tools.md) ──
//
// The catalogue lives in `./tools` (grouped Operations / Insights /
// Configuration, each entry declaring minimumRole + minimumTier).
// Gate stacking, lowest-precedence first:
//   1. section visibility — manager+ only (unchanged);
//   2. role gate — below the minimum the tool is HIDDEN, except
//      `lockBelowRole` tools (Settings) which render locked;
//   3. subscription validity — expired/canceled/paused/unavailable
//      locks every card (role-only never bypasses entitlement
//      validity); `loading` stays open for role-only tools so the
//      first fetch cannot flash-lock the section;
//   4. tier gate — insufficient plan locks the card (visible, greyed,
//      non-clickable, localized badge); tier-gated tools additionally
//      honor the §B admin gate, which locks the moment the
//      subscription leaves `active` (grace never re-opens admin
//      features).

// (The Tools catalogue — entries, icons, groups, access policy — lives
// in `./tools` and is imported below.)

// ── Icons ─────────────────────────────────────────────────────────

function getIcon(key: string) {
  return <WorkspaceIcon wsKey={key} />;
}

// ── Skeleton ──────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="workspace-skeleton-grid">
      {[1, 2, 3].map((i) => (
        <div key={i} className="workspace-skeleton-card">
          <div className="workspace-skeleton-icon" />
          <div className="workspace-skeleton-body">
            <div className="workspace-skeleton-title" />
            <div className="workspace-skeleton-desc" />
            <div className="workspace-skeleton-desc" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Randomized multilingual greeting ────────────────────────────

const GREETINGS: { word: string; lang: string }[] = [
  { word: 'Hello', lang: 'English' },
  { word: 'Hola', lang: 'Spanish' },
  { word: 'Bonjour', lang: 'French' },
  { word: 'Ciao', lang: 'Italian' },
  { word: 'Konnichiwa', lang: 'Japanese' },
  { word: 'Annyeong', lang: 'Korean' },
  { word: 'Ni hao', lang: 'Chinese' },
  { word: 'Salaam', lang: 'Arabic' },
  { word: 'Sawasdee', lang: 'Thai' },
  { word: 'Zdravstvuyte', lang: 'Russian' },
  { word: 'Guten Tag', lang: 'German' },
  { word: 'Olá', lang: 'Portuguese' },
  { word: 'Namaste', lang: 'Hindi' },
  { word: 'Merhaba', lang: 'Turkish' },
  { word: 'Hej', lang: 'Swedish' },
  { word: 'Salut', lang: 'French' },
  { word: 'Hallo', lang: 'Dutch' },
  { word: 'Ahoj', lang: 'Czech' },
  { word: 'Selamat datang', lang: 'Indonesian' },
  { word: 'Sawubona', lang: 'Zulu' },
  { word: 'Shalom', lang: 'Hebrew' },
  { word: 'Jambo', lang: 'Swahili' },
];

function pickGreeting(): { word: string; lang: string } {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!;
}

// ── Role color map ────────────────────────────────────────────────

function getRoleColor(role: string): string {
  switch (role.toLowerCase()) {
    case 'owner':
    case 'role-owner':
    case 'admin':
    case 'role-admin':   return 'role-badge--owner';
    case 'manager':
    case 'role-manager': return 'role-badge--manager';
    case 'staff':
    case 'role-staff':   return 'role-badge--staff';
    case 'auditor':
    case 'role-auditor': return 'role-badge--auditor';
    case 'custom':
    case 'role-custom':  return 'role-badge--custom';
    default:             return 'role-badge--default';
  }
}

// ── Layer 1: Background ──────────────────────────────────────────

function LayerBackground() {
  return (
    <div className="ws-layer-bg" aria-hidden="true">
      <div className="ws-layer-bg-gradient" />
      <div className="ws-layer-bg-particles">
        <div className="ws-particle" />
        <div className="ws-particle" />
        <div className="ws-particle" />
        <div className="ws-particle" />
        <div className="ws-particle" />
        <div className="ws-particle" />
      </div>
    </div>
  );
}

// ── Toolbar buttons (fullscreen, user profile, logout) ────────

function LayerFloatingButtons({
  session,
  displayName,
  roleName,
  l10n,
  toggleFullscreen,
  handleLogoutClick,
  error,
  retry,
  greeting,
}: {
  session: LoginSessionDto | null;
  displayName: string;
  roleName: string;
  l10n: ReturnType<typeof useLocalization>['l10n'];
  toggleFullscreen: () => void;
  handleLogoutClick: () => void;
  error: string | null;
  retry: () => void;
  greeting: { word: string; lang: string };
}) {
  return (
    <>
    {session && displayName && (
      <span className="ws-header-greeting" title={greeting.lang}>
        {greeting.word}, {displayName}
      </span>
    )}
    <div className="ws-header-buttons">
        <button
          type="button"
          className="workspace-home-fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label={l10n.getString('workspace-home-fullscreen-aria')}
          title={requiredLocalized(l10n, 'workspace-home-fullscreen-hint')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="18" height="18">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
        {session && (
          <>
            <button type="button" className="workspace-home-user-profile" aria-label={l10n.getString('workspace-home-user-aria', { name: displayName })}>
              <div className="workspace-home-user-avatar">
                <div className="workspace-home-user-avatar-inner">
                  <RoleIcon role={roleName} size={16} />
                </div>
              </div>
              <div className="workspace-home-user-info">
                <span className="workspace-home-user-name">{displayName}</span>
                <span className={`workspace-home-user-role ${getRoleColor(roleName)}`}>{roleName}</span>
              </div>
            </button>
            <button type="button" className="workspace-home-logout-btn" onClick={handleLogoutClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <Localized id="workspace-home-logout"><span>Logout</span></Localized>
            </button>
          </>
        )}
        {error && (
          <button
            type="button"
            className="workspace-home-logout-btn"
            onClick={retry}
            title={l10n.getString('workspace-home-retry-btn')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <Localized id="workspace-home-retry-btn">
              <span>Retry</span>
            </Localized>
          </button>
        )}
    </div>
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────

/** Workspace home screen — two areas: active workspaces (top) + role-gated tools (bottom). */
export default function WorkspaceHome() {
  const { l10n } = useLocalization();
  const { availableWorkspaces, loading, error, retry, setActiveWorkspace, lastWorkspace } = useWorkspace();
  const { session, logout } = useAuth();
  const gridRef = useRef<HTMLDivElement>(null);
  const ripplesRef = useRef<HTMLSpanElement[]>([]);
  const rippleTimersRef = useRef<number[]>([]);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const roleName = (session?.role_name ?? '').toLowerCase();

  // ── Favorites & last-used state ────────────────────────────────

  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(loadPins);
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, number>>(loadLastUsed);

  const pinnedKeysRef = useRef(pinnedKeys);
  const lastUsedMapRef = useRef(lastUsedMap);

  useEffect(() => { pinnedKeysRef.current = pinnedKeys; }, [pinnedKeys]);
  useEffect(() => { lastUsedMapRef.current = lastUsedMap; }, [lastUsedMap]);

  const togglePin = useCallback((key: string) => {
    const next = new Set(pinnedKeysRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    pinnedKeysRef.current = next;
    setPinnedKeys(next);
    savePins(next);
  }, []);

  const recordLastUsed = useCallback((key: string) => {
    const next = { ...lastUsedMapRef.current, [key]: Date.now() };
    lastUsedMapRef.current = next;
    setLastUsedMap(next);
    saveLastUsed(next);
  }, []);

  // Sort workspaces: pinned first (by pin order), then by last-used, then by static order
  const sortedWorkspaces = useMemo(() => {
    const pinnedArr: typeof availableWorkspaces = [];
    const unpinnedArr: typeof availableWorkspaces = [];

    // The admin workspace is not shown on the home screen — its features
    // (settings, analytics, reports) are accessible via the Tools section below.
    const visible = availableWorkspaces.filter((ws) => ws.type_key !== 'admin');

    for (const ws of visible) {
      if (pinnedKeys.has(ws.type_key)) {
        pinnedArr.push(ws);
      } else {
        unpinnedArr.push(ws);
      }
    }

    unpinnedArr.sort((a, b) => {
      const aLast = lastUsedMap[a.type_key] ?? 0;
      const bLast = lastUsedMap[b.type_key] ?? 0;
      if (aLast !== bLast) return bLast - aLast;
      return (WS_ORDER[a.type_key] ?? 99) - (WS_ORDER[b.type_key] ?? 99);
    });

    return [...pinnedArr, ...unpinnedArr];
  }, [availableWorkspaces, pinnedKeys, lastUsedMap]);

  // ── Role-based access ────────────────────────────────────────

  const roleLevel = ROLE_HIERARCHY[roleName] ?? 0;

  /** Staff badge/shortcut role — checkout-only, never manages workspaces. */
  const isStaffRole =
    roleName === 'staff' || roleName === 'role-staff';

  /** Management roles (owner/admin/manager) may add workspaces — but only
   *  when no workspace is available yet (per the home-screen rules). Staff
   *  never sees the Add card, even on an empty list. */
  const canAddWorkspace = roleLevel >= (ROLE_HIERARCHY['manager'] ?? 0) && sortedWorkspaces.length === 0;

  // ── Tools gates (todo-tools.md role/tier matrix) ─────────────

  // Routed through `roleAtLeast` rather than compared inline, so this gate and
  // the settings-page gate read ONE vocabulary instead of two with opposite
  // defaults. The inline form was `roleLevel >= (ROLE_HIERARCHY[minimumRole] ?? 0)`
  // — an unrecognised `minimumRole` demanded **0** and the gate FAILED OPEN,
  // while `roleAtLeast` (role.ts:72) demands `Number.MAX_SAFE_INTEGER` for an
  // unknown floor. Ruled FAIL CLOSED (2026-09-16): an unknown floor on an
  // admin-tool gate must deny, not allow. Type-blocked today — `ToolRole` is
  // 'owner' | 'admin' | 'manager' (tools.tsx:25) and all three are in the
  // table — so this is behaviour-neutral now and removes a latent fail-open.
  const canAccessTool = useCallback(
    (access: ToolItem['access']): boolean => roleAtLeast(roleName, access.minimumRole),
    [roleName],
  );

  // C2.2/§B: capabilities + lifecycle state drive the tier and validity
  // gates. The §B admin gate (useAdminGate) locks administrative tools
  // the moment the subscription leaves `active` — grace never re-opens
  // them, and a missing/invalid subscription fails closed.
  const { caps, state: subscriptionState } = useSubscription();
  const { locked: adminLocked } = useAdminGate();

  const toolLock = useCallback(
    (tool: ToolItem): ToolLockReason | 'none' | 'hidden' => {
      if (!canAccessTool(tool.access)) {
        return tool.access.lockBelowRole ? 'role' : 'hidden';
      }
      // Role-only tools keep working through the signed grace window
      // (operational continuity); everything hard-locks once the
      // subscription is expired/canceled/paused or its data unreadable.
      // `loading` stays open — the first fetch must not flash-lock the
      // section. Tier-gated tools are stricter: useAdminGate locks them
      // on anything but `active`.
      const validityOpen =
        subscriptionState === 'active' ||
        subscriptionState === 'grace' ||
        subscriptionState === 'loading';
      if (!validityOpen) return 'subscription';
      if (tool.access.minimumTier !== 'free' && adminLocked) return 'subscription';
      if (!tierSatisfies(caps?.tier, tool.access.minimumTier)) return 'tier';
      return 'none';
    },
    [canAccessTool, subscriptionState, adminLocked, caps],
  );

  // Only owner/admin/manager roles see the Tools section at all — staff and
  // auditor operate the assigned workspaces below, never the admin tools.
  const canSeeTools = roleLevel >= (ROLE_HIERARCHY['manager'] ?? 0);

  const toolGroups = useMemo(() => {
    if (!canSeeTools) return [];
    return TOOL_GROUP_ORDER.map((groupId) => ({
      id: groupId as ToolGroupId,
      tools: TOOLS.filter((t) => t.group === groupId)
        .map((tool) => ({ tool, lock: toolLock(tool) }))
        // Type predicate, not a plain boolean: it must NARROW the element
        // type to the union ToolsCategoryGrid accepts — with a boolean
        // filter 'hidden' lingers in the type and the prop never checks.
        .filter(
          (entry): entry is { tool: ToolItem; lock: ToolLockReason | 'none' } =>
            entry.lock !== 'hidden',
        ),
    })).filter((group) => group.tools.length > 0);
  }, [canSeeTools, toolLock]);
  // (The old `visibleTools` flat-memo existed only to guard the inline
  // Tools block; ToolsCategoryGrid null-guards on empty groups itself.)

  // ── Shortcut navigation to tools (switches to admin workspace) ──
  const handleShortcutNav = useCallback(
    (route: string) => {
      window.location.hash = `#/${route}`;
      setActiveWorkspace('admin');
    },
    [setActiveWorkspace],
  );

  const canAccess = useCallback(
    (_key: string): boolean => {
      switch (roleName) {
        case 'owner': case 'role-owner':
        case 'admin': case 'role-admin':
        case 'manager': case 'role-manager':
        case 'staff': case 'role-staff':
        case 'auditor': case 'role-auditor':
          return true;
        default:
          return false;
      }
    },
    [roleName],
  );

  const greeting = useMemo(() => pickGreeting(), []);
  const displayName = session?.display_name ?? '';
  const showSkeleton = loading;
  const { toggleFullscreen } = useFullscreen();

  // ── Logout confirmation ────────────────────────────────────────

  const handleLogoutClick = useCallback(() => { setShowLogoutModal(true); }, []);
  const handleLogoutCancel = useCallback(() => { setShowLogoutModal(false); }, []);
  const handleLogoutConfirm = useCallback(() => { setShowLogoutModal(false); logout(); }, [logout]);

  // ── Ripple cleanup on unmount ──────────────────────────────

  useEffect(() => {
    return () => {
      rippleTimersRef.current.forEach((t) => clearTimeout(t));
      rippleTimersRef.current = [];
      ripplesRef.current.forEach(r => r.remove());
      ripplesRef.current = [];
    };
  }, []);

  // ── Workspace activation + click ripple ─────────────────────────

  const activateWorkspace = useCallback(
    (key: string): boolean => {
      if (!canAccess(key)) return false;
      recordLastUsed(key);
      setActiveWorkspace(key);
      return true;
    },
    [canAccess, recordLastUsed, setActiveWorkspace],
  );

  const handleCardClick = useCallback(
    (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
      if (!activateWorkspace(key)) return;
      const card = e.currentTarget;
      const rect = card.getBoundingClientRect();

      const ripple = document.createElement('span');
      ripple.className = 'workspace-card-ripple';
      const size = Math.max(rect.width, rect.height);
      const clickX = e.clientX !== 0 ? e.clientX : rect.left + rect.width / 2;
      const clickY = e.clientY !== 0 ? e.clientY : rect.top + rect.height / 2;
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${clickX - rect.left - size / 2}px`;
      ripple.style.top = `${clickY - rect.top - size / 2}px`;
      card.appendChild(ripple);
      ripplesRef.current.push(ripple);

      const removeRipple = () => {
        if (ripple.parentNode) ripple.remove();
        ripplesRef.current = ripplesRef.current.filter(r => r !== ripple);
      };

      let timer: number | undefined;
      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          rippleTimersRef.current = rippleTimersRef.current.filter(t => t !== timer);
          timer = undefined;
        }
        removeRipple();
      };

      ripple.addEventListener('animationend', cleanup);
      timer = window.setTimeout(cleanup, 600);
      rippleTimersRef.current.push(timer);
    },
    [activateWorkspace],
  );

  // ── Keyboard navigation ──────────────────────────────────────

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const cards = grid.querySelectorAll<HTMLButtonElement>('.workspace-card:not(.workspace-card--disabled)');
    if (cards.length === 0) return;

    function focusCard(index: number) {
      const target = cards[index];
      if (target && !target.disabled) {
        target.focus();
      }
    }

    function getColumns(): number {
      const all = grid!.querySelectorAll<HTMLElement>('.workspace-card');
      if (all.length === 0) return 1;
      const firstTop = all[0]!.offsetTop;
      let cols = 0;
      for (const el of all) {
        if (el.offsetTop !== firstTop) break;
        cols += 1;
      }
      return Math.max(cols, 1);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
        const idx = parseInt(e.key, 10) - 1;
        const key = sortedWorkspaces[idx]?.type_key;
        if (key && canAccess(key)) {
          e.preventDefault();
          activateWorkspace(key);
        }
        return;
      }

      const active = document.activeElement;
      if (!active || !grid.contains(active)) return;

      let currentIndex = -1;
      for (let i = 0; i < cards.length; i++) {
        if (cards[i] === active) { currentIndex = i; break; }
      }
      if (currentIndex < 0) return;

      const cols = getColumns();

      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); if (currentIndex < cards.length - 1) focusCard(currentIndex + 1); break;
        case 'ArrowLeft':  e.preventDefault(); if (currentIndex > 0) focusCard(currentIndex - 1); break;
        case 'ArrowDown':  e.preventDefault(); if (currentIndex + cols < cards.length) focusCard(currentIndex + cols); break;
        case 'ArrowUp':    e.preventDefault(); if (currentIndex - cols >= 0) focusCard(currentIndex - cols); break;
        case 'Home':       e.preventDefault(); focusCard(0); break;
        case 'End':        e.preventDefault(); focusCard(cards.length - 1); break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedWorkspaces, canAccess, activateWorkspace]);

  // ── Clear stale focus on mount ─────────────────────────────────
  useEffect(() => {
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  // ── Shared floating layer props ────────────────────────────────

  const floatingProps = {
    session, displayName, roleName, l10n,
    toggleFullscreen, handleLogoutClick, error, retry, greeting,
  };

  // ── Loading state ────────────────────────────────────────────

  if (showSkeleton) {
    return (
      <div className="workspace-home" data-testid="workspace-home">
        <LayerBackground />
        <div className="ws-layer-content">
          <div className="ws-header">
            <LayerFloatingButtons {...floatingProps} />
          </div>
          <div className="ws-main">
            <header className="workspace-home-header">
              <OrgSelector />
            </header>
            <SkeletonGrid />
          </div>
          <div className="ws-footer" />
        </div>
        <span className="ws-sr-status" role="status" aria-live="polite">
          {loading ? requiredLocalized(l10n, 'workspace-home-loading') : error && !loading ? requiredLocalized(l10n, 'workspace-home-sr-error') : requiredLocalized(l10n, 'workspace-home-available', { count: sortedWorkspaces.length })}
        </span>
        <ConfirmDialog
          open={showLogoutModal}
          onCancel={handleLogoutCancel}
          onConfirm={handleLogoutConfirm}
          title={l10n.getString('workspace-home-logout-confirm-title')}
          message={l10n.getString('workspace-home-logout-confirm-desc')}
          variant="warning"
          confirmLabel={l10n.getString('workspace-home-logout-confirm-confirm')}
          cancelLabel={l10n.getString('workspace-home-logout-confirm-cancel')}
        />
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────

  return (
    <div className="workspace-home" data-testid="workspace-home">
      <LayerBackground />

      <div className="ws-layer-content">
        <div className="ws-header">
          <LayerFloatingButtons {...floatingProps} />
        </div>
        <div className="ws-main">
          <header className="workspace-home-header" />

          {error && sortedWorkspaces.length === 0 ? (
            <div className="workspace-error">
              <div className="workspace-error-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="workspace-error-title">
                <Localized id="workspace-home-error-title"><span>Connection Error</span></Localized>
              </p>
              <p className="workspace-error-desc">
                <Localized id="workspace-home-error-desc"><span>Could not load your workspaces. Check your connection and try again.</span></Localized>
              </p>
              <button type="button" className="workspace-error-retry" onClick={retry}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <Localized id="workspace-home-retry"><span>Try Again</span></Localized>
              </button>
            </div>
          ) : sortedWorkspaces.length === 0 ? (
            canAddWorkspace ? (
              <div className="workspace-home-content">
                <div className="workspace-section">
                  <div className="workspace-section-header">
                    <h2 className="workspace-section-title">
                      <Localized id="workspace-home-workspaces-section"><span>Workspaces</span></Localized>
                    </h2>
                  </div>
                  <div className="workspace-grid" ref={gridRef} role="group" aria-label={l10n.getString('workspaces-aria')}>
                    <button
                      type="button"
                      className="workspace-card workspace-card--add"
                      data-testid="workspace-card-add"
                      onClick={() => handleShortcutNav('settings/topology')}
                      aria-label={l10n.getString('workspace-home-add-workspace-aria')}
                    >
                      <div className="workspace-card-row">
                        <div className="workspace-card-icon">
                          <div className="workspace-card-icon-inner">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden="true">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          </div>
                        </div>
                        <div className="workspace-card-body">
                          <div className="workspace-card-title">
                            <h2 className="workspace-card-name">
                              <Localized id="workspace-home-add-workspace"><span>Add Workspace</span></Localized>
                            </h2>
                          </div>
                          <div className="workspace-card-text">
                            <p className="workspace-card-desc">
                              <Localized id="workspace-home-add-workspace-desc"><span>Configure workspaces in the topology editor</span></Localized>
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            ) : isStaffRole ? (
              // A staff user with no assigned workspace has nothing to do
              // on this screen — they cannot open the admin tools (staff
              // never sees the Tools section) or add workspaces, so a
              // centered notice is the only content they need.
              <div className="workspace-empty" data-testid="workspace-empty-staff">
                <div className="workspace-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="workspace-empty-title">
                  <Localized id="workspace-home-staff-empty"><span>No workspaces available</span></Localized>
                </p>
                <p className="workspace-empty-desc">
                  <Localized id="workspace-home-staff-empty-desc"><span>Contact Administrator</span></Localized>
                </p>
              </div>
            ) : (
            <div className="workspace-empty">
              <div className="workspace-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  <line x1="7" y1="9" x2="17" y2="9" />
                </svg>
              </div>
              <p className="workspace-empty-title">
                <Localized id="workspace-home-empty"><span>No workspaces available</span></Localized>
              </p>
              <p className="workspace-empty-desc">
                <Localized id="workspace-home-empty-desc"><span>You don&apos;t have access to any workspaces yet. Contact an administrator.</span></Localized>
              </p>
            </div>
            )
          ) : (
            <div className="workspace-home-content">
              {/* ── Section 1: Active Workspaces ───────────────────── */}
              <div className="workspace-section">
                <div className="workspace-section-header">
                  <h2 className="workspace-section-title">
                    <Localized id="workspace-home-workspaces-section"><span>Workspaces</span></Localized>
                  </h2>
                </div>
                <div className="workspace-grid" ref={gridRef} role="group" aria-label={l10n.getString('workspaces-aria')}>
                  {sortedWorkspaces.map((ws, idx) => {
                    const disabled = !canAccess(ws.type_key);
                    const colorClass = WS_COLORS[ws.type_key] ?? '';
                    const isActive = ws.type_key === lastWorkspace && !disabled;
                    if (disabled) {
                      return (
                        <div
                          key={ws.type_key}
                          className={`workspace-card ${colorClass} workspace-card--disabled`}
                          data-testid="workspace-card"
                          aria-label={l10n.getString('workspace-card-no-access-aria', { name: ws.name })}
                        >
                          <div className="workspace-card-key-hint">{idx + 1}</div>
                          <div className="workspace-card-row">
                            <div className="workspace-card-icon">
                              <div className="workspace-card-icon-inner">{getIcon(ws.type_key)}</div>
                            </div>
                            <div className="workspace-card-body">
                              <div className="workspace-card-title">
                                <h2 className="workspace-card-name">{ws.name}</h2>
                              </div>
                              <div className="workspace-card-text">
                                <p className="workspace-card-desc">{ws.description}</p>
                              </div>
                              <div className="workspace-card-actions">
                                <span className="workspace-card-badge">
                                  <Localized id="workspace-card-no-access-badge"><span>Not available</span></Localized>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={ws.type_key}
                        type="button"
                        aria-current={isActive ? 'true' : undefined}
                        className={`workspace-card ${colorClass}${isActive ? ' workspace-card--active' : ''}`}
                        data-testid="workspace-card"
                        onClick={(e) => handleCardClick(ws.type_key, e)}
                        aria-label={l10n.getString('workspace-card-open-aria', { name: ws.name })}
                      >
                        <div className="workspace-card-key-hint">{idx + 1}</div>
                        <span
                          role="button"
                          className={`workspace-card-pin-btn${pinnedKeys.has(ws.type_key) ? ' workspace-card-pin-btn--pinned' : ''}`}
                          onClick={(e) => { e.stopPropagation(); togglePin(ws.type_key); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePin(ws.type_key); } }}
                          aria-label={pinnedKeys.has(ws.type_key) ? l10n.getString('workspace-card-unpin-aria', { name: ws.name }) : l10n.getString('workspace-card-pin-aria', { name: ws.name })}
                          tabIndex={0}
                        >
                          <svg viewBox="0 0 24 24" fill={pinnedKeys.has(ws.type_key) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </span>
                        {isActive && (
                          <div className="workspace-card-active-dot" aria-label={requiredLocalized(l10n, 'workspace-card-active-aria')}>
                            <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
                              <circle cx="12" cy="12" r="6" />
                            </svg>
                          </div>
                        )}
                        <div className="workspace-card-row">
                          <div className="workspace-card-icon">
                            <div className="workspace-card-icon-inner">{getIcon(ws.type_key)}</div>
                          </div>
                          <div className="workspace-card-body">
                            <div className="workspace-card-title">
                              <h2 className="workspace-card-name">{ws.name}</h2>
                            </div>
                            <div className="workspace-card-text">
                              <p className="workspace-card-desc">{ws.description}</p>
                            </div>
                            <div className="workspace-card-actions" />
                          </div>
                        </div>
                        <div className="workspace-card-overlay" aria-hidden="true">
                          {/* Capped at MAX_DIGIT_SHORTCUT: a card past the ninth is real, but
                              no single keypress can name it -- the handler maps one key
                              character with parseInt(e.key, 10) - 1. The label is the part
                              that was wrong, so the label stops advertising it. */}
                          {idx < MAX_DIGIT_SHORTCUT && (
                          <span className="workspace-card-overlay-hint">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="12" height="12">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01" />
                              <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01" />
                            </svg>
                            <Localized id="workspace-home-shortcut-hint" vars={{ key: `${idx + 1}` }}>
                              <span>Press {idx + 1} to open</span>
                            </Localized>
                          </span>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {/* ── Add workspace card is not shown when workspaces
                     exist — per the home-screen rules, owner/admin/manager
                     see it only on the empty state, and staff never sees it. */}
                </div>
              </div>

              {/* ── Section 2: Tools (grouped, role/tier-gated) ───── */}
              {toolGroups.length > 0 && (
                <ToolsCategoryGrid
                  groups={toolGroups}
                  onNavigate={handleShortcutNav}
                  getAriaLabel={(key) => l10n.getString(key)}
                />
              )}
            </div>
          )}
        </div>
        <div className="ws-footer" />
      </div>

      {/* Layer 5: Overlays */}
      <ConfirmDialog
        open={showLogoutModal}
        onCancel={handleLogoutCancel}
        onConfirm={handleLogoutConfirm}
        title={l10n.getString('workspace-home-logout-confirm-title')}
        message={l10n.getString('workspace-home-logout-confirm-desc')}
        variant="warning"
        confirmLabel={l10n.getString('workspace-home-logout-confirm-confirm')}
        cancelLabel={l10n.getString('workspace-home-logout-confirm-cancel')}
      />
    </div>
  );
}
