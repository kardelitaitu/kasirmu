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
import { useAuth } from '@/contexts/AuthContext';
import { isRovingKey, computeRovingIndex } from './sidebarLogic';
import { hasGrantedPermission } from '@/registries/page-registry';

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
  /**
   * Whether the Kitchen Display row is reachable for this user.
   *
   * KDS access is a feature/route ENTITLEMENT, not a role, so a disabled row with
   * a "Manager+" badge would mislabel the reason. It is hidden instead, matching
   * `showTables` — and for the same cause: the host decides before render, because
   * a click-time answer cannot hide a row that is already on screen. Without this
   * the row silently no-opped or bounced the user to Products (F7).
   */
  showKitchenDisplay: boolean;
  onOpenKitchenDisplay: () => void;
  /** Full-page configuration sub-screens */
  onOpenMenuEditor?: () => void;
  onOpenReceipts?: () => void;
  onOpenPayments?: () => void;
  onOpenSettings?: () => void;
  /** Open cash drawer manually */
  onOpenCashDrawer?: () => void;
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
  /** Override manager permissions (defaults to useAuth().isManager). */
  isManager?: boolean | undefined;
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

const LockSmallGlyph = () => (
  <svg {...GLYPH} width={12} height={12}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const MenuEditorGlyph = () => (
  <svg {...GLYPH}>
    <path d="M4 3h11l5 5v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);

const ReceiptGlyph = () => (
  <svg {...GLYPH}>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M8 7h8M8 11h8M8 15h5" />
  </svg>
);

const PaymentGlyph = () => (
  <svg {...GLYPH}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const SettingsGlyph = () => (
  <svg {...GLYPH}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

const DrawerGlyph = () => (
  <svg {...GLYPH}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <circle cx="12" cy="16" r="1.5" />
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
  isManager: isManagerProp,
}: RestaurantSidebarProps) {
  const { l10n } = useLocalization();
  const { isManager: authIsManager, session } = useAuth();

  // F8: the manager rows (Menu Editor / Receipts / Payments / Settings) all write
  // through commands that enforce `permissions::SETTINGS_EDIT` on the backend —
  // e.g. `kasirmu-bridge/src/settings.rs` on every settings write. Gating them on
  // the ROLE alone let a user whose role is "manager" but whose grant omits
  // `settings:edit` reach a control whose save is then refused at the IPC
  // boundary: an enabled button that always errors.
  //
  // The check now mirrors the backend: when the session carries granted keys, the
  // PERMISSION is authoritative (wildcard-aware via `hasGrantedPermission`, which
  // handles the Owner preset's `["*"]`). When it carries none — an older session
  // shape — it falls back to the role, so a session that cannot answer the
  // question is not silently locked out. That is exactly `passesGate`'s contract.
  //
  // `isManagerProp` still wins when supplied: it is the explicit override the
  // workspace-card and inspector hosts pass, and it predates this fix.
  const canEditSettings =
    isManagerProp ??
    (session?.permissions !== undefined
      ? hasGrantedPermission(session.permissions, 'settings:edit')
      : authIsManager);
  const effectiveIsManager = canEditSettings;
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
      // No stale timer to clear here: `exitTimerRef.current` is nulled either
      // by the timer callback (before it calls setExiting(false)) or by the
      // effect's own cleanup on transition, so it is always null by the time
      // `exiting` is false.
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
    if (!isRovingKey(e.key)) return;
    const items = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item') ?? [],
    );
    // `computeRovingIndex` returns `null` for an empty row list (the
    // empty-tablist case, unit-tested at the pure-logic layer) — then
    // `next ?? -1` points past the list, `items[-1]` is `undefined`, and
    // `?.focus()` skips it. No branch is needed here.
    const next = computeRovingIndex(items.indexOf(e.currentTarget), items.length, e.key);
    e.preventDefault();
    items[next ?? -1]?.focus();
  }, [sidebarRef]);

  const avatar = profile ? (
    <ProductThumb
      hash={profile.avatarHash}
      name={profile.displayName}
      size={48}
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
          {cartActions.showKitchenDisplay && (
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
          )}
          <button
            type="button"
            className={`restaurant-sidebar-item${!effectiveIsManager ? ' restaurant-sidebar-item--disabled' : ''}`}
            disabled={!effectiveIsManager}
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('restaurant-sidebar-menu-editor')}
            data-testid="restaurant-sidebar-menu-editor"
            onClick={() => {
              // The button is disabled for non-managers, so a non-manager click
              // can never reach here; no guard is needed.
              cartActions.onOpenMenuEditor?.();
              onOpenChange(false);
            }}
          >
            <Tile>
              <MenuEditorGlyph />
            </Tile>
            <Localized id="restaurant-sidebar-menu-editor"><span>Menu Editor</span></Localized>
            {!effectiveIsManager && (
              <span className="restaurant-sidebar-badge-manager">
                <LockSmallGlyph />
                <Localized id="restaurant-manager-required"><span>Manager+</span></Localized>
              </span>
            )}
          </button>
          <button
            type="button"
            className={`restaurant-sidebar-item${!effectiveIsManager ? ' restaurant-sidebar-item--disabled' : ''}`}
            disabled={!effectiveIsManager}
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('restaurant-sidebar-receipts')}
            onClick={() => {
              // The button is disabled for non-managers, so a non-manager
              // click can never reach here; no guard is needed.
              cartActions.onOpenReceipts?.();
              onOpenChange(false);
            }}
          >
            <Tile>
              <ReceiptGlyph />
            </Tile>
            <Localized id="restaurant-sidebar-receipts"><span>Receipts</span></Localized>
            {!effectiveIsManager && (
              <span className="restaurant-sidebar-badge-manager">
                <LockSmallGlyph />
                <Localized id="restaurant-manager-required"><span>Manager+</span></Localized>
              </span>
            )}
          </button>
          <button
            type="button"
            className={`restaurant-sidebar-item${!effectiveIsManager ? ' restaurant-sidebar-item--disabled' : ''}`}
            disabled={!effectiveIsManager}
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('restaurant-sidebar-payments')}
            onClick={() => {
              // The button is disabled for non-managers, so a non-manager
              // click can never reach here; no guard is needed.
              cartActions.onOpenPayments?.();
              onOpenChange(false);
            }}
          >
            <Tile>
              <PaymentGlyph />
            </Tile>
            <Localized id="restaurant-sidebar-payments"><span>Payments</span></Localized>
            {!effectiveIsManager && (
              <span className="restaurant-sidebar-badge-manager">
                <LockSmallGlyph />
                <Localized id="restaurant-manager-required"><span>Manager+</span></Localized>
              </span>
            )}
          </button>
          <button
            type="button"
            className={`restaurant-sidebar-item${!effectiveIsManager ? ' restaurant-sidebar-item--disabled' : ''}`}
            disabled={!effectiveIsManager}
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('restaurant-sidebar-settings')}
            data-testid="restaurant-sidebar-settings"
            onClick={() => {
              // The button is disabled for non-managers, so a non-manager
              // click can never reach here; no guard is needed.
              cartActions.onOpenSettings?.();
              onOpenChange(false);
            }}
          >
            <Tile>
              <SettingsGlyph />
            </Tile>
            <Localized id="restaurant-sidebar-settings"><span>Settings</span></Localized>
            {!effectiveIsManager && (
              <span className="restaurant-sidebar-badge-manager">
                <LockSmallGlyph />
                <Localized id="restaurant-manager-required"><span>Manager+</span></Localized>
              </span>
            )}
          </button>
          {cartActions.onOpenCashDrawer && (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-cart-open-drawer')}
              onClick={() => {
                cartActions.onOpenCashDrawer?.();
                onOpenChange(false);
              }}
            >
              <Tile>
                <DrawerGlyph />
              </Tile>
              <Localized id="pos-cart-open-drawer"><span>Open Cash Drawer</span></Localized>
            </button>
          )}
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
