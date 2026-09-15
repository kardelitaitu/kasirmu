import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { type Product } from '@/types/domain';
import { useLocalization } from '@fluent/react';
import { useProducts } from '@/features/products/useProducts';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getUserPreferencesScoped, setUserPreferencesScoped } from '@/api/settings';
import { MenuCategoryTabBar } from './components/MenuCategoryTabBar';
import { MenuItemGrid } from './components/MenuItemGrid';
import { MenuItemContextMenu, type RestaurantContextMenuState } from './components/MenuItemContextMenu';
import { MenuPreferencesMenu, type RestaurantSidebarActions } from './components/MenuPreferencesMenu';
import { MenuSearchBar } from './components/MenuSearchBar';
import './RestaurantMenu.css';

// ── Props ──────────────────────────────────────────────────────────

export interface RestaurantMenuProps {
  /** Called when the user clicks "Add" on a product. */
  onAddProduct?: (product: Product) => void;
  /** Controlled sidebar open state (synced with PosScreen to hide cart). */
  sidebarOpen?: boolean;
  /** Callback when sidebar open state changes. */
  onSidebarOpenChange?: (open: boolean) => void;
  /**
   * The cart header's terminal actions, relocated into the sidebar popover
   * (shift, deduction override, tables, history, KDS). PosScreen owns the
   * state and the modals; this screen only renders the rows. Absent = no
   * group, which is what every test render and non-POS host gets.
   */
  cartActions?: RestaurantSidebarActions;
}

// ── Helpers ────────────────────────────────────────────────────────

type Category = string;

function key(uid: string, name: string) {
  return `restaurant-${uid}-${name}`;
}

// ── Menu state storage: two tiers ───────────────────────────────────
//
// Tier 1 — backend, with localStorage as the offline fallback:
//   `sort`, `cardsize`, `fontsize`, `font-smoothing`.
//   Written by `persistMenuPreference` → `setUserPreferencesScoped`,
//   rehydrated from `getUserPreferencesScoped` on mount (see the effect
//   below). These follow the user to another terminal.
//
// Tier 2 — localStorage only:
//   `pinned`, `colors`, `unavailable`, `pop`.
//   Namespaced per user through `key()` above but never sent to the server,
//   so they do NOT follow the user across terminals. `pinned` and `colors`
//   are personal curation and read as defensibly terminal-local.
//   `unavailable` is the odd one out: it is an operational flag (86 an
//   item), so a waiter marking an item unavailable on one terminal does not
//   propagate to the others, which looks more like a gap than a choice.
//
// This split is recorded in code but is NOT backed by an ADR or product
// decision — treat it as unresolved rather than settled. If `unavailable`
// (or the rest of Tier 2) should be shared, promote it to Tier 1; note the
// preference store is generic string KV (api/settings.ts:198-202), so a set
// or map needs serialising first. Raised by .agents/resto-pos-ui-review.md §F5.

// Sort options in menu order. Exported, and SortMode derived from it rather
// than written out separately, so the two cannot drift: the hamburger renders
// `restaurant-sort-${mode}` by interpolation, which no static gate can follow,
// and dynamicFluentFamilies.test.ts enumerates THIS array to pin all four ids
// against both bundles.
export const SORT_MODES = ['manual', 'a-z', 'date', 'popularity'] as const;
type SortMode = (typeof SORT_MODES)[number];

function loadPinned(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(uid, 'pinned'));
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function savePinned(pinned: Set<string>, uid: string) {
  try { localStorage.setItem(key(uid, 'pinned'), JSON.stringify([...pinned])); } catch { /* storage unavailable */ }
}

function loadColors(uid: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key(uid, 'colors'));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveColors(colors: Record<string, string>, uid: string) {
  try { localStorage.setItem(key(uid, 'colors'), JSON.stringify(colors)); } catch { /* storage unavailable */ }
}

function loadPop(uid: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key(uid, 'pop'));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePop(pop: Record<string, number>, uid: string) {
  try { localStorage.setItem(key(uid, 'pop'), JSON.stringify(pop)); } catch { /* quota */ }
}

function loadUnavailable(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(uid, 'unavail'));
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveUnavailable(unavail: Set<string>, uid: string) {
  try { localStorage.setItem(key(uid, 'unavail'), JSON.stringify([...unavail])); } catch { /* storage unavailable */ }
}

/** Sort so pinned items appear first, preserving original order within each group. */
function sortPinnedFirst(items: Product[], pinned: Set<string>): Product[] {
  const pinnedList: Product[] = [];
  const rest: Product[] = [];
  for (const p of items) {
    if (pinned.has(p.sku)) pinnedList.push(p);
    else rest.push(p);
  }
  return [...pinnedList, ...rest];
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Restaurant-style menu panel for the POS.
 *
 * Shows a search box, horizontal scrollable row of category pills,
 * and a responsive product grid. Right-click any item to pin it to
 * the top of the grid.
 */
export default function RestaurantMenu({
  onAddProduct,
  sidebarOpen: controlledSidebarOpen,
  onSidebarOpenChange,
  cartActions,
}: RestaurantMenuProps) {
  const { l10n } = useLocalization();
  const { products, categoryMeta, loading } = useProducts();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { session } = useAuth();
  const { sessionToken } = useWorkspace();
  const userId = session?.user_id ?? 'default';
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);
  const isControlled = controlledSidebarOpen !== undefined;
  const menuOpen = isControlled ? controlledSidebarOpen : internalMenuOpen;
  const setMenuOpen = useCallback((action: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof action === 'function' ? action(menuOpen) : action;
    if (isControlled) {
      onSidebarOpenChange?.(nextVal);
    } else {
      setInternalMenuOpen(nextVal);
    }
  }, [isControlled, menuOpen, onSidebarOpenChange]);
  const contextMenuOpenRef = useRef(false);
  // The dropdown element ref is owned here (not in MenuPreferencesMenu)
  // because the global app-search gate — which moved into MenuSearchBar with
  // the input it targets — must test whether focus is inside the popover.
  // The same ref object is passed to both children.
  const hamburgerDropdownRef = useRef<HTMLDivElement>(null);

  const [addedSku, setAddedSku] = useState<string | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddProduct = useCallback((product: Product) => {
    const nextCounts = { ...addCountRef.current, [product.sku]: (addCountRef.current[product.sku] ?? 0) + 1 };
    addCountRef.current = nextCounts;
    setPopularityCounts(nextCounts);
    savePop(nextCounts, userId);
    onAddProduct?.(product);
    setAddedSku(product.sku);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAddedSku(null), 400);
  }, [onAddProduct, userId]);

  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [pinned, setPinned] = useState<Set<string>>(loadPinned(userId));
  const [colors, setColors] = useState<Record<string, string>>(loadColors(userId));
  const [unavailable, setUnavailable] = useState<Set<string>>(loadUnavailable(userId));
  const addCountRef = useRef<Record<string, number>>(loadPop(userId));
  const [popularityCounts, setPopularityCounts] = useState<Record<string, number>>(() => loadPop(userId));
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const stored = localStorage.getItem(key(userId, 'sort'));
      return stored === 'a-z' || stored === 'date' || stored === 'popularity' ? stored : 'manual';
    } catch { return 'manual'; }
  });
  const [cardSize, setCardSize] = useState(() => {
    try { return Math.min(4, Math.max(0, parseInt(localStorage.getItem(key(userId, 'cardsize')) ?? '0', 10) || 0)); }
    catch { return 0; }
  });
  const [fontSize, setFontSize] = useState(() => {
    try { return Math.min(4, Math.max(0, parseInt(localStorage.getItem(key(userId, 'fontsize')) ?? '0', 10) || 0)); }
    catch { return 0; }
  });
  const menuStateUserIdRef = useRef(userId);
  const skipMenuPersistenceRef = useRef(false);
  const locallyModifiedPreferencesRef = useRef<Set<string>>(new Set());

  // Rehydrate user-scoped card state when the authenticated user changes.
  // Without this boundary, React preserves the previous user's card settings
  // because the component remains mounted across session changes.
  useLayoutEffect(() => {
    if (menuStateUserIdRef.current === userId) return;
    menuStateUserIdRef.current = userId;
    skipMenuPersistenceRef.current = true;
    locallyModifiedPreferencesRef.current.clear();
    setContextMenu(null);
    contextMenuOpenRef.current = false;
    contextTriggerRef.current = null;
    contextFromKeyboardRef.current = false;
    setAddedSku(null);
    setPinned(loadPinned(userId));
    setColors(loadColors(userId));
    setUnavailable(loadUnavailable(userId));
    addCountRef.current = loadPop(userId);
    setPopularityCounts(addCountRef.current);
    try {
      const storedSort = localStorage.getItem(key(userId, 'sort'));
      setSortMode(storedSort === 'a-z' || storedSort === 'date' || storedSort === 'popularity' ? storedSort : 'manual');
      setCardSize(Math.min(4, Math.max(0, parseInt(localStorage.getItem(key(userId, 'cardsize')) ?? '0', 10) || 0)));
      setFontSize(Math.min(4, Math.max(0, parseInt(localStorage.getItem(key(userId, 'fontsize')) ?? '0', 10) || 0)));
    } catch {
      setSortMode('manual');
      setCardSize(0);
      setFontSize(0);
    }
  }, [userId]);

  // Clean up add-to-cart animation timer on unmount
  useEffect(() => {
    return () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    };
  }, []);

  const persistMenuPreference = useCallback((preferenceKey: string, value: string) => {
    locallyModifiedPreferencesRef.current.add(preferenceKey);
    try { localStorage.setItem(key(userId, preferenceKey), value); } catch { /* offline / quota */ }
    if (!sessionToken) return;
    void setUserPreferencesScoped(sessionToken, [{ key: preferenceKey, value }]).catch(() => {
      // Keep the local preference when the scoped backend is temporarily offline.
    });
  }, [sessionToken, userId]);

  const changeCardSize = useCallback((delta: number) => {
    const next = Math.min(4, Math.max(0, cardSize + delta));
    if (next === cardSize) return;
    setCardSize(next);
    persistMenuPreference('cardsize', String(next));
  }, [cardSize, persistMenuPreference]);

  const changeFontSize = useCallback((delta: number) => {
    const next = Math.min(4, Math.max(0, fontSize + delta));
    if (next === fontSize) return;
    setFontSize(next);
    persistMenuPreference('fontsize', String(next));
  }, [fontSize, persistMenuPreference]);

  // Load preferences from backend on mount, syncing to localStorage. Ignore
  // late responses when the active user or store session changes.
  useEffect(() => {
    if (!sessionToken) return;
    // A fresh session (new token) is authoritative: drop the locally-armed
    // guards carried over from the previous session so the backend
    // rehydrates this session's display preferences (sort / card / font
    // size). Same-token late responses are still guarded below.
    locallyModifiedPreferencesRef.current.clear();
    let cancelled = false;
    getUserPreferencesScoped(sessionToken).then((prefs) => {
      if (cancelled) return;
      const cs = prefs['cardsize'];
      if (cs !== undefined && !locallyModifiedPreferencesRef.current.has('cardsize')) {
        const v = Math.min(4, Math.max(0, parseInt(cs, 10) || 0));
        setCardSize(v);
        try { localStorage.setItem(key(userId, 'cardsize'), String(v)); } catch { /* noop */ }
      }
      const fs = prefs['fontsize'];
      if (fs !== undefined && !locallyModifiedPreferencesRef.current.has('fontsize')) {
        const v = Math.min(4, Math.max(0, parseInt(fs, 10) || 0));
        setFontSize(v);
        try { localStorage.setItem(key(userId, 'fontsize'), String(v)); } catch { /* noop */ }
      }
      const savedSort = prefs['sort'];
      if (!locallyModifiedPreferencesRef.current.has('sort') && (savedSort === 'manual' || savedSort === 'a-z' || savedSort === 'date' || savedSort === 'popularity')) {
        setSortMode(savedSort);
        try { localStorage.setItem(key(userId, 'sort'), savedSort); } catch { /* noop */ }
      }
      const fsm = prefs['font-smoothing'];
      if (fsm === 'antialiased' || fsm === 'subpixel') {
        document.documentElement.setAttribute('data-font-smoothing', fsm);
      }
    }).catch(() => { /* offline — keep localStorage values */ });
    return () => { cancelled = true; };
  }, [userId, sessionToken]);

  // Sync pinned/colors/unavailable to localStorage whenever state changes.
  // Extracted from setState updaters to avoid side effects in pure functions
  // (React 18 strict mode calls updaters twice, causing duplicate writes).
  // Skip the first pass after a user switch so the previous user's state cannot
  // overwrite the newly selected user's storage before rehydration completes.
  useEffect(() => {
    if (skipMenuPersistenceRef.current) {
      skipMenuPersistenceRef.current = false;
      return;
    }
    savePinned(pinned, userId);
    saveColors(colors, userId);
    saveUnavailable(unavailable, userId);
  }, [pinned, colors, unavailable, userId]);

  // ── Context menu state ──────────────────────────────
  // The open/closed descriptor and the trigger bookkeeping stay here: the
  // tile (deep in the grid) reports openings through handleContextMenu, the
  // global keyboard shortcuts must know whether an overlay is up, and the
  // user-switch rehydration below resets it. The overlay itself — focus
  // trap, roving menuitems, dismissal — lives in MenuItemContextMenu.
  const [contextMenu, setContextMenu] = useState<RestaurantContextMenuState | null>(null);
  // A11Y-06: the card that opened the menu (for focus restoration) and whether
  // it was opened via keyboard (Shift+F10 / ContextMenu key) — only the
  // keyboard path should move focus into the menu and restore it on close.
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const contextFromKeyboardRef = useRef(false);

  // A11Y-06: close the menu and, when it was opened from the keyboard, return
  // focus to the triggering card (WAI-ARIA menu pattern).
  const closeContextMenu = useCallback(() => {
    contextMenuOpenRef.current = false;
    setContextMenu(null);
    if (contextFromKeyboardRef.current) contextTriggerRef.current?.focus();
    contextTriggerRef.current = null;
    contextFromKeyboardRef.current = false;
  }, []);

  const handleContextMenu = useCallback((sku: string, e: React.MouseEvent, trigger?: HTMLElement, fromKeyboard = false, sourceInStock = true) => {
    e.preventDefault();
    contextTriggerRef.current = trigger ?? null;
    contextFromKeyboardRef.current = fromKeyboard;
    contextMenuOpenRef.current = true;
    const x = Number.isFinite(e.clientX) ? e.clientX : 4;
    const y = Number.isFinite(e.clientY) ? e.clientY : 4;
    setContextMenu({ sku, x, y, isPinned: pinned.has(sku), isUnavailable: unavailable.has(sku), sourceInStock, currentColor: colors[sku], fromKeyboard });
  }, [pinned, colors, unavailable]);

  // Restaurant and retail are separate workspaces. Category tabs must be
  // derived from restaurant products rather than the shared catalog category
  // list, otherwise a retail-only category can leak into this menu.
  const restaurantProducts = useMemo(
    () => products.filter((p) => p.productType === 'restaurant'),
    [products],
  );

  const categoryOptions = useMemo<Category[]>(
    () => ['All', ...new Set(restaurantProducts.map((p) => p.category))].sort((a, b) => {
      if (a === 'All') return -1;
      if (b === 'All') return 1;
      return a.localeCompare(b);
    }),
    [restaurantProducts],
  );

  // Keep the selection valid when products are refreshed or removed. The
  // derived value prevents a transient empty result while the state catches
  // up; the effect also clears the stale selection if that category returns.
  const effectiveCategory = categoryOptions.includes(activeCategory) ? activeCategory : 'All';
  useEffect(() => {
    if (activeCategory !== 'All' && !categoryOptions.includes(activeCategory)) {
      setActiveCategory('All');
    }
  }, [activeCategory, categoryOptions]);

  const catMetaMap = useMemo(() => {
    const m = new Map<string, { colour: string; icon: string }>();
    for (const c of categoryMeta) m.set(c.name, { colour: c.colour, icon: c.icon });
    return m;
  }, [categoryMeta]);

  const handleSelectSort = useCallback((mode: SortMode) => {
    setSortMode(mode);
    persistMenuPreference('sort', mode);
    setMenuOpen(false);
  }, [persistMenuPreference]);

  const filtered = useMemo(() => {
    let result = restaurantProducts;
    if (effectiveCategory !== 'All') result = result.filter((p) => p.category === effectiveCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    result = [...result];
    const counts = sortMode === 'popularity' ? popularityCounts : undefined;
    switch (sortMode) {
      case 'a-z':
        result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        break;
      case 'date':
        result.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      case 'popularity':
        result.sort((a, b) => (counts?.[b.sku] ?? 0) - (counts?.[a.sku] ?? 0));
        break;
    }
    return sortPinnedFirst(result, pinned);
  }, [effectiveCategory, restaurantProducts, searchQuery, pinned, sortMode, popularityCounts]);

  return (
    <div
      className={`restaurant-menu ${menuOpen ? 'restaurant-menu--sidebar-open' : ''}`}
      style={{ '--card-size': cardSize, '--font-size': fontSize } as React.CSSProperties}
    >
      {/* ── Header row: hamburger + back + search ── */}
      <div className="restaurant-header">
        <MenuPreferencesMenu
          {...(cartActions ? { cartActions } : {})}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          dropdownRef={hamburgerDropdownRef}
          sortMode={sortMode}
          onSelectSort={handleSelectSort}
          cardSize={cardSize}
          onCardSizeStep={changeCardSize}
          fontSize={fontSize}
          onFontSizeStep={changeFontSize}
        />

        <button
          type="button"
          className="restaurant-back-btn"
          onClick={goToWorkspacePicker}
          aria-label={l10n.getString('restaurant-menu-back-aria')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" style={{ pointerEvents: 'none' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <MenuSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          menuOpen={menuOpen}
          contextMenuOpenRef={contextMenuOpenRef}
          popoverRef={hamburgerDropdownRef}
        />
      </div>

      {/* ── Category pills ─────────────────────────── */}
      <MenuCategoryTabBar
        options={categoryOptions}
        active={effectiveCategory}
        onSelect={setActiveCategory}
        metaMap={catMetaMap}
      />

      {/* ── Product grid ───────────────────────────── */}
      <MenuItemGrid
        loading={loading}
        items={filtered}
        pinned={pinned}
        unavailable={unavailable}
        colors={colors}
        catMetaMap={catMetaMap}
        addedSku={addedSku}
        onAdd={handleAddProduct}
        onContextMenu={handleContextMenu}
      />

      {/* ── Context menu ─────────────────────────────── */}
      {contextMenu && (
        <MenuItemContextMenu
          menu={contextMenu}
          setPinned={setPinned}
          setUnavailable={setUnavailable}
          setColors={setColors}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}