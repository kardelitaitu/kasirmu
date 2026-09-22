// ── RestaurantSidebar component ──────────────────────────────────────────
//
// The docked sidebar panel containing the signed-in cashier's identity and the
// workspace/terminal operations (shift open/close, deduction override, table
// management, sales history, kitchen display, lock terminal, exit terminal).
// Slides in from the left and docks to the layout, hiding the cart panel when
// open.
//
// Invariants:
// - Exit animation plays smoothly on close without unmount flashes.
// - Escape key closes the sidebar and returns focus to the trigger button.
// - ArrowUp/Down/Home/End rove across the action buttons, not the avatar.
// - Actions close the sidebar upon execution.
//
// The rows carry no colour and no selected state on purpose: every row fires a
// handler and closes the panel, so nothing here is ever "current". The one
// emphasised element is the avatar, and it is emphasised by being a photo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Localized } from '@/components/Localized';
import { ProductThumb } from '@/components/ProductThumb';
import { useLocalization } from '@fluent/react';
import { animDuration } from '@/utils/animation';
import { hueFromName } from '@/utils/color';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useVersionStatus } from '@/hooks/useVersionStatus';

/** The signed-in cashier, as the sidebar header shows them. */
export interface RestaurantSidebarProfile {
  /** Display name from the auth session. */
  displayName: string;
  /** Role name as stored, e.g. `cashier`. */
  roleName: string;
  /** Content-addressed avatar hash, or null for the initials fallback. */
  avatarHash: string | null;
}

export interface RestaurantSidebarActions {
  /** Shift lookup in flight: no shift row at all. */
  shiftLoading: boolean;
  hasActiveShift: boolean;
  onOpenShift: () => void;
  onCloseShift: () => void;
  /** Locked deduction location; null = not deducting, so no row. */
  deductionLocationName: string | null;
  deductionOverridden: boolean;
  onOverrideDeduction: () => void;
  /** Table Management is feature-gated: render-and-hide is not an option. */
  showTables: boolean;
  onOpenTables: () => void;
  onOpenHistory: () => void;
  onOpenKitchenDisplay: () => void;
  /** Request exit from workspace; handled by host to check shifts. */
  onRequestExit?: () => void;
}

export interface RestaurantSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebarRef: React.RefObject<HTMLDivElement>;
  container?: HTMLElement | null | undefined;
  cartActions?: RestaurantSidebarActions | undefined;
  onRequestExit?: (() => void) | undefined;
  triggerRef?: React.RefObject<HTMLButtonElement> | undefined;
  /** Cashier identity for the header. Absent = no header block. */
  profile?: RestaurantSidebarProfile | undefined;
  /**
   * Opens the photo picker. Absent = the avatar renders as a static tile, so a
   * host with no upload path does not get a button that does nothing.
   */
  onChangePhoto?: (() => void) | undefined;
}

// ── Row glyphs ─────────────────────────────────────────────────────────
//
// Inline rather than imported: the repo has no general icon set, only the
// domain-specific RoleIcon and WorkspaceIcon. Every glyph is decorative — the
// row's accessible name comes from the button's aria-label — so they are
// hidden from the accessibility tree and take their colour from the tile.

const GLYPH = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 18,
  height: 18,
  'aria-hidden': true,
  style: { pointerEvents: 'none' as const },
};

const ShiftGlyph = () => (
  <svg {...GLYPH}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const TablesGlyph = () => (
  <svg {...GLYPH}>
    <path d="M4 8h16M4 8l1-3h14l1 3M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
  </svg>
);

const HistoryGlyph = () => (
  <svg {...GLYPH}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v4h4" />
    <path d="M12 8v4l3 2" />
  </svg>
);

const KitchenGlyph = () => (
  <svg {...GLYPH}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
  </svg>
);

const LockGlyph = () => (
  <svg {...GLYPH}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const ExitGlyph = () => (
  <svg {...GLYPH}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const DeductionGlyph = () => (
  <svg {...GLYPH} width={14} height={14}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/**
 * A row's icon tile. `aria-hidden` because the button already carries the
 * accessible name, and a glyph announced twice is noise.
 */
function Tile({ children }: { children: React.ReactNode }) {
  return (
    <span className="restaurant-sidebar-tile" aria-hidden="true">
      {children}
    </span>
  );
}

export function RestaurantSidebar({
  open,
  onOpenChange,
  sidebarRef,
  container,
  cartActions,
  onRequestExit,
  triggerRef,
  profile,
  onChangePhoto,
}: RestaurantSidebarProps) {
  const { l10n } = useLocalization();
  // The live app version, from the ONE shared probe (`StatusBar` reads the same
  // singleton, so this adds no second updater check). Not a hardcoded string:
  // the login footer's `v0.0.39` is already duplicated in three files.
  const { currentVersion } = useVersionStatus();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const sidebarWasOpenRef = useRef(false);
  const sidebarOpenedWithKeyboardRef = useRef(false);

  // Animation state for sliding out when open flips to false
  const [prevOpen, setPrevOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasEverOpenRef = useRef(open);

  if (open) {
    wasEverOpenRef.current = true;
  }

  // Adjust state synchronously during render when open transitions true -> false
  // to avoid a 1-frame unmount gap where the sidebar disappears before exiting begins.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && wasEverOpenRef.current) {
      setExiting(true);
    } else if (open) {
      setExiting(false);
    }
  }

  useEffect(() => {
    if (!exiting) {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      return;
    }
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
    }, animDuration(300));
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [exiting]);

  // Focus management: move focus into the sidebar on open, restore on close.
  // The first ROW is focused, not the first button: the header's avatar button
  // is a distinct control and sits outside the roving list, so landing on it
  // would leave ArrowUp resolving against the wrong index.
  useEffect(() => {
    if (open) {
      const panel = sidebarRef.current;
      if (panel) {
        const items = panel.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item');
        (items[0] ?? panel.querySelector<HTMLButtonElement>('button'))?.focus();
      }
    } else if (sidebarWasOpenRef.current && sidebarOpenedWithKeyboardRef.current) {
      triggerRef?.current?.focus();
    }
    sidebarWasOpenRef.current = open;
  }, [open, sidebarRef, triggerRef]);

  // Close sidebar on Escape before global shortcuts can handle it
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      sidebarOpenedWithKeyboardRef.current = true;
      onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Close sidebar on click outside, EXCEPT on trigger or inside the sidebar
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef?.current?.contains(e.target as Node)) return;
      if (sidebarRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange, sidebarRef, triggerRef]);

  const handleSidebarKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(e.currentTarget);
    const next = e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : e.key === 'ArrowDown'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    e.preventDefault();
    items[next]?.focus();
  }, [sidebarRef]);

  const avatar = profile ? (
    <ProductThumb
      hash={profile.avatarHash}
      name={profile.displayName}
      size={38}
      shape="circle"
      lazy={false}
      hue={hueFromName(profile.displayName)}
    />
  ) : null;

  const asideContent = (
    <aside
      ref={sidebarRef}
      id="restaurant-sidebar-panel"
      className={`restaurant-sidebar${exiting ? ' restaurant-sidebar--exiting' : ''}`}
      role="region"
      tabIndex={-1}
      aria-label={l10n.getString('restaurant-sidebar-toggle-aria')}
    >
      {profile && (
        <>
          <div className="restaurant-sidebar-profile">
            {onChangePhoto ? (
              <button
                type="button"
                className="restaurant-sidebar-avatar restaurant-sidebar-avatar--button"
                onClick={onChangePhoto}
                aria-label={l10n.getString('restaurant-avatar-edit-aria', { name: profile.displayName })}
              >
                {avatar}
              </button>
            ) : (
              <span className="restaurant-sidebar-avatar">{avatar}</span>
            )}
            <div className="restaurant-sidebar-identity">
              <span className="restaurant-sidebar-name">{profile.displayName}</span>
              <span className="restaurant-sidebar-role">{profile.roleName}</span>
            </div>
          </div>
          <div className="restaurant-sidebar-divider" role="separator" />
        </>
      )}
      {cartActions && (
        <>
          {cartActions.deductionLocationName && (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-cart-deduction-badge-aria', { name: cartActions.deductionLocationName })}
              onClick={() => { cartActions.onOverrideDeduction(); onOpenChange(false); }}
            >
              <Tile>
                <DeductionGlyph />
              </Tile>
              <Localized id="pos-cart-deducting-label" vars={{ name: cartActions.deductionLocationName }}>
                <span>Deducting: {cartActions.deductionLocationName}</span>
              </Localized>
              {cartActions.deductionOverridden && (
                <span className="restaurant-sidebar-override" data-testid="restaurant-sidebar-deduction-override">
                  {' '}(Override)
                </span>
              )}
            </button>
          )}
          {!cartActions.shiftLoading && (cartActions.hasActiveShift ? (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-shift-close-aria')}
              onClick={() => { cartActions.onCloseShift(); onOpenChange(false); }}
            >
              <Tile>
                <ShiftGlyph />
              </Tile>
              <Localized id="pos-shift-close-aria"><span>Close current shift</span></Localized>
            </button>
          ) : (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-shift-open-aria')}
              onClick={() => { cartActions.onOpenShift(); onOpenChange(false); }}
            >
              <Tile>
                <ShiftGlyph />
              </Tile>
              <Localized id="pos-shift-open-aria"><span>Open a new shift</span></Localized>
            </button>
          ))}
          {cartActions.showTables && (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('tables-title')}
              onClick={() => { cartActions.onOpenTables(); onOpenChange(false); }}
            >
              <Tile>
                <TablesGlyph />
              </Tile>
              <Localized id="tables-title"><span>Table Management</span></Localized>
            </button>
          )}
          <button
            type="button"
            className="restaurant-sidebar-item"
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('retail-fn-history')}
            onClick={() => { cartActions.onOpenHistory(); onOpenChange(false); }}
          >
            <Tile>
              <HistoryGlyph />
            </Tile>
            <Localized id="retail-fn-history"><span>History</span></Localized>
          </button>
          <button
            type="button"
            className="restaurant-sidebar-item"
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('kds-title')}
            onClick={() => { cartActions.onOpenKitchenDisplay(); onOpenChange(false); }}
          >
            <Tile>
              <KitchenGlyph />
            </Tile>
            <Localized id="kds-title"><span>Kitchen Display</span></Localized>
          </button>
          <div className="restaurant-sidebar-divider" role="separator" />
        </>
      )}
      <button
        type="button"
        className="restaurant-sidebar-item"
        onKeyDown={handleSidebarKeyDown}
        aria-label={l10n.getString('restaurant-lock-terminal')}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('app:lock'));
          onOpenChange(false);
        }}
      >
        <Tile>
          <LockGlyph />
        </Tile>
        <Localized id="restaurant-lock-terminal"><span>Lock Terminal</span></Localized>
      </button>
      <button
        type="button"
        className="restaurant-sidebar-item"
        onKeyDown={handleSidebarKeyDown}
        aria-label={l10n.getString('restaurant-exit-terminal')}
        onClick={() => {
          if (cartActions?.onRequestExit) {
            cartActions.onRequestExit();
          } else if (onRequestExit) {
            onRequestExit();
          } else {
            goToWorkspacePicker();
          }
          onOpenChange(false);
        }}
      >
        <Tile>
          <ExitGlyph />
        </Tile>
        <Localized id="restaurant-exit-terminal"><span>Exit Terminal</span></Localized>
      </button>
      {/* Mirrors the login screen's bottom-left: the one place in this panel that
          names the product. `margin-top: auto` pins it to the foot of the flex
          column, so it sits flush with the bottom when the rows do not fill the
          panel and scrolls with them when they do. */}
      <div className="restaurant-sidebar-footer">
        <span className="restaurant-sidebar-version">v{currentVersion}</span>
        <Localized id="restaurant-sidebar-copyright">
          <span className="restaurant-sidebar-copyright">
            &copy; 2026 kasir.mu. All rights reserved.
          </span>
        </Localized>
      </div>
    </aside>
  );

  if (!open && !exiting) return null;
  return container ? createPortal(asideContent, container) : asideContent;
}
