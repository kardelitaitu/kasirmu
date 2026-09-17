import { useState, useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { contrastFg } from '@/utils/color';
import { Localized, useLocalization } from '@fluent/react';
import {
  listCategoriesScoped,
  createCategoryScoped,
  updateCategoryScoped,
  deleteCategoryScoped,
  type CategoryDto,
} from '@/api/products';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized, EmptyState } from '@/components';
import { NoCategoriesIcon } from '@/components/EmptyStateIllustrations';
import { useToast } from '@/components/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import './CategoryManagementScreen.css';

// ── Predefined colour palette for the colour picker ──────────────────

const COLOURS = [
  '#06b6d4', // cyan
  '#f97316', // orange
  '#10b981', // emerald
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ef4444', // red
  '#84cc16', // lime
  '#3b82f6', // blue
  '#a855f7', // purple
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#22c55e', // green
  '#d946ef', // fuchsia
];

// ── Icon set ─────────────────────────────────────────────

interface IconOption {
  id: string;
  label: string;
}

const ICON_OPTIONS: IconOption[] = [
  { id: 'food',       label: 'Food'       },
  { id: 'snack',      label: 'Snack'      },
  { id: 'hot-drink',  label: 'Hot drink'  },
  { id: 'cold-drink', label: 'Cold drink' },
  { id: 'dots-1',     label: 'Generic ·'  },
  { id: 'dots-2',     label: 'Generic ··' },
  { id: 'dots-3',     label: 'Generic ···'},
];

/** Icon ids in display order, for arrow-key navigation over the radiogroup. */
const ICON_IDS: readonly string[] = ICON_OPTIONS.map((opt) => opt.id);

/** Render the SVG for a given icon id. Returns null for no-icon. */
function CategoryIconSvg({ icon, size = 18 }: { icon: string; size?: number }) {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: size,
    height: size,
    'aria-hidden': true,
  };

  if (icon === 'food') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Fork */}
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
        <line x1="7" y1="11" x2="7" y2="22" />
        {/* Knife */}
        <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z" />
        <line x1="21" y1="15" x2="21" y2="22" />
      </svg>
    );
  }
  if (icon === 'snack') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Bowl */}
        <path d="M4 12h16" />
        <path d="M4 12c0 5.5 3.6 9 8 9s8-3.5 8-9" />
        {/* Snack items */}
        <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
        <circle cx="13" cy="8" r="2" fill="currentColor" stroke="none" />
        <circle cx="17" cy="9" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (icon === 'hot-drink') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Cup */}
        <path d="M6 8h12l-1.5 12h-9L6 8z" />
        {/* Handle */}
        <path d="M17 11h2a2 2 0 0 1 0 4h-2" />
        {/* Steam */}
        <path d="M8 8C8.8 6.5 7.2 5.5 8 4" />
        <path d="M13 8C13.8 6.5 12.2 5.5 13 4" />
      </svg>
    );
  }
  if (icon === 'cold-drink') {
    return (
      <svg viewBox="0 0 24 24" {...strokeProps}>
        {/* Cup body */}
        <path d="M5 7h14l-2 15H7L5 7z" />
        {/* Rim */}
        <line x1="3" y1="7" x2="21" y2="7" />
        {/* Straw */}
        <line x1="16" y1="2" x2="12" y2="22" />
      </svg>
    );
  }
  if (icon === 'dots-1') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="8" cy="8" r="3.5" />
      </svg>
    );
  }
  if (icon === 'dots-2') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="4.5" cy="8" r="3" />
        <circle cx="11.5" cy="8" r="3" />
      </svg>
    );
  }
  if (icon === 'dots-3') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size} aria-hidden="true">
        <circle cx="2.5" cy="8" r="2.5" />
        <circle cx="8" cy="8" r="2.5" />
        <circle cx="13.5" cy="8" r="2.5" />
      </svg>
    );
  }
  return null;
}

// ── Default random colour ────────────────────────────────────────────

function randomColour(): string {
  return COLOURS[Math.floor(Math.random() * COLOURS.length)]!;
}

function randomIcon(): string {
  return ICON_OPTIONS[Math.floor(Math.random() * ICON_OPTIONS.length)]!.id;
}

/** WAI-ARIA radiogroup: Arrow keys move focus AND selection; Tab leaves the
 *  group. Returns the next value (wrapping) or null for a non-arrow key. */
function nextRadioValue(
  options: readonly string[],
  current: string,
  key: string,
): string | null {
  const idx = options.indexOf(current);
  if (idx < 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return options[(idx + 1) % options.length]!;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return options[(idx - 1 + options.length) % options.length]!;
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function colourToId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // CAT-04: fully non-ASCII names (e.g. カフェ) collapse to an empty slug,
  // which would produce the degenerate ID `cat-`. Fall back to a stable hash
  // suffix derived from the name so the ID is never empty.
  if (!slug) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return `cat-${hash.toString(36)}`;
  }
  return `cat-${slug}`;
}

/** Inline custom properties for dynamic-colour elements (CAT-07). */
function catColourVars(colour: string): CSSProperties {
  return { '--cat-bg': colour, '--cat-fg': contrastFg(colour) } as CSSProperties;
}

// ── Component ────────────────────────────────────────────────────────

/** Category management screen — create, edit, and delete product categories with colour and icon selection. */
export default function CategoryManagementScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  // CAT-03: track load failures separately from a genuinely empty category set.
  const [loadError, setLoadError] = useState<string | null>(null);
  // CAT-08: request-sequence guard — a slower response from an earlier
  // session/refresh must never overwrite newer category data.
  const loadSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Keep `load` memoized on [sessionToken] only — locale identity changes
  // must not re-fire the load effect (mirrors ProductManagementScreen).
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;

  // CAT-08: a session switch is a new generation — the next load shows the
  // skeleton instead of the previous store's categories.
  useEffect(() => {
    hasLoadedOnceRef.current = false;
  }, [sessionToken]);

  // ── Create modal state ──────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  // Lazy initializers so Math.random() runs once (not on every render).
  const [newColour, setNewColour] = useState(() => randomColour());
  const [newIcon, setNewIcon] = useState(() => randomIcon());
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // CAT-09: track that the operator has typed into the name field so the
  // empty-name message explains why Save stays disabled (instead of silence).
  const [nameTouched, setNameTouched] = useState(false);

  // ── Edit modal state ────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<CategoryDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editColour, setEditColour] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNameTouched, setEditNameTouched] = useState(false);

  // ── Delete modal state ──────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const closeCreate = useCallback(() => setShowModal(false), []);
  const closeEdit = useCallback(() => setEditTarget(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    // CAT-08/PROD-04: only the first load shows the skeleton — refreshes
    // preserve the last known list on screen instead of flashing a skeleton.
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const cats = await listCategoriesScoped(sessionToken);
      if (seq !== loadSeqRef.current) return;
      setCategories(cats);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      // CAT-03: a failed load must not be indistinguishable from an empty store.
      if (seq !== loadSeqRef.current) return;
      setLoadError(
        l10nErrorMessage(err, l10nRef.current, 'categories-error-load'),
      );
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  // ── Create handlers ──────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setNewName('');
    setNewColour(randomColour());
    setNewIcon(randomIcon());
    setCreateError(null);
    setNameTouched(false);
    setShowModal(true);
  }, []);

  // CAT-09: client-side field-level validation — mirrors the backend's
  // authoritative rules (non-empty name, unique ID, valid colour) so the
  // operator sees a localized reason instead of a disabled Save or raw text.
  const validateCreate = useCallback((): string | null => {
    const trimmed = newName.trim();
    if (!trimmed) return requiredLocalized(l10n, 'categories-error-name-required');
    const id = colourToId(trimmed);
    if (categories.some((c) => c.id === id)) {
      return requiredLocalized(l10n, 'categories-error-id-conflict');
    }
    if (!COLOURS.includes(newColour)) {
      return requiredLocalized(l10n, 'categories-error-colour-invalid');
    }
    return null;
  }, [newName, newColour, categories, l10n]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    const fieldError = validateCreate();
    if (fieldError) {
      setCreateError(fieldError);
      return;
    }

    setSaving(true);
    setCreateError(null);

    try {
      const id = colourToId(trimmed);
      await createCategoryScoped(sessionToken, { id, name: trimmed, colour: newColour, icon: newIcon });
      setShowModal(false);
      await load();
    } catch (err) {
      // CAT-09: surface a stable, localized message rather than raw IPC text.
      setCreateError(requiredLocalized(l10n, 'categories-error-create'));
      void err;
    } finally {
      setSaving(false);
    }
  }, [newName, newColour, newIcon, load, sessionToken, l10n, validateCreate]);

  // ── Edit handlers ────────────────────────────────────────────────

  const openEdit = useCallback((cat: CategoryDto) => {
    setEditTarget(cat);
    setEditName(cat.name);
    setEditColour(cat.colour);
    setEditIcon(cat.icon);
    setEditError(null);
    setEditNameTouched(false);
  }, []);

  const handleEdit = useCallback(async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    // CAT-09: the name must stay non-empty and the colour valid.
    if (!trimmed) {
      setEditError(requiredLocalized(l10n, 'categories-error-name-required'));
      return;
    }
    if (!COLOURS.includes(editColour)) {
      setEditError(requiredLocalized(l10n, 'categories-error-colour-invalid'));
      return;
    }

    setEditSaving(true);
    setEditError(null);

    try {
      await updateCategoryScoped(sessionToken, { id: editTarget.id, name: trimmed, colour: editColour, icon: editIcon });
      setEditTarget(null);
      await load();
    } catch (err) {
      setEditError(requiredLocalized(l10n, 'categories-error-update'));
      void err;
    } finally {
      setEditSaving(false);
    }
  }, [editTarget, editName, editColour, editIcon, load, sessionToken, l10n]);

  // ── Delete handlers ──────────────────────────────────────────────

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    setDeleteTarget(null);
    try {
      // CAT-02: the backend unlinks products transactionally and reports how
      // many were affected — surface that to the operator.
      const result = await deleteCategoryScoped(sessionToken, deleteTarget.id);
      if (result.affected_products > 0) {
        addToast({
          message: requiredLocalized(l10n, 'categories-delete-unlinked', { count: String(result.affected_products) }),
          type: 'success',
        });
      }
      await load();
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'categories-error-delete'),
        type: 'error',
      });
    } finally {
      setDeleting(null);
    }
  }, [deleteTarget, load, addToast, l10n, sessionToken]);

  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Refs for the icon/colour radiogroup options so arrow-key navigation can
  // move focus to the newly-selected option (roving tabindex, WAI-ARIA radio).
  const iconRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const editIconRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const colourRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const editColourRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleIconKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioValue(ICON_IDS, newIcon, e.key);
    if (!next) return;
    e.preventDefault();
    setNewIcon(next);
    iconRadioRefs.current[next]?.focus();
  }, [newIcon]);

  const handleEditIconKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioValue(ICON_IDS, editIcon, e.key);
    if (!next) return;
    e.preventDefault();
    setEditIcon(next);
    editIconRadioRefs.current[next]?.focus();
  }, [editIcon]);

  const handleColourKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioValue(COLOURS, newColour, e.key);
    if (!next) return;
    e.preventDefault();
    setNewColour(next);
    colourRadioRefs.current[next]?.focus();
  }, [newColour]);

  const handleEditColourKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioValue(COLOURS, editColour, e.key);
    if (!next) return;
    e.preventDefault();
    setEditColour(next);
    editColourRadioRefs.current[next]?.focus();
  }, [editColour]);

  // Focus name inputs when modals open.
  useEffect(() => {
    if (showModal && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showModal]);

  useEffect(() => {
    if (editTarget && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editTarget]);

  return (
    <div className="cat-mgmt">
      <div className="cat-mgmt-header">
        <Localized id="categories-title">
          <h1 className="cat-mgmt-title">Categories</h1>
        </Localized>
        <Localized id="categories-add">
          <Button onClick={openCreate}>Add Category</Button>
        </Localized>
      </div>

      {loading ? (
        <div className="cat-mgmt-loading-skeleton" aria-hidden="true">
          <div className="cat-mgmt-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="9rem" height="2.25rem" />
          </div>
          <div className="cat-mgmt-grid">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Card key={i} shadow="xs">
                <div className="cat-mgmt-card">
                  <Skeleton variant="circle" width="2.75rem" height="2.75rem" />
                  <div className="cat-mgmt-card-info">
                    <Skeleton variant="text" width={`${5 + (i % 3) * 2}rem`} height="1rem" />
                    <Skeleton variant="text" width="6rem" height="0.75rem" />
                    <Skeleton variant="text" width="4rem" height="0.75rem" />
                  </div>
                  <Skeleton variant="block" width="1.75rem" height="1.75rem" />
                  <Skeleton variant="block" width="1.75rem" height="1.75rem" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : loadError && categories.length === 0 ? (
        <Card shadow="sm">
          <div className="cat-mgmt-empty" role="alert">
            <Localized id="categories-error-load">
              <p className="cat-mgmt-load-error-title">Failed to load categories</p>
            </Localized>
            {loadError && loadError !== requiredLocalized(l10n, 'categories-error-load') && (
              <p className="cat-mgmt-load-error-detail">{loadError}</p>
            )}
            <Localized id="categories-error-retry">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </Localized>
          </div>
        </Card>
      ) : categories.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NoCategoriesIcon />}
            title={requiredLocalized(l10n, 'categories-no-categories')}
            description={requiredLocalized(l10n, 'categories-empty-desc')}
            action={{
              label: requiredLocalized(l10n, 'categories-add-first'),
              onClick: openCreate,
            }}
          />
        </Card>
      ) : (
        <div className="cat-mgmt-grid">
          {categories.map((cat) => (
            <Card key={cat.id} shadow="xs">
              <div className="cat-mgmt-card">
                {/* Icon badge — coloured circle with icon SVG */}
                <div
                  className="cat-mgmt-icon-badge"
                  style={catColourVars(cat.colour)}
                  aria-hidden="true"
                >
                  {cat.icon ? (
                    <CategoryIconSvg icon={cat.icon} size={20} />
                  ) : (
                    <span className="cat-mgmt-icon-badge-empty" />
                  )}
                </div>
                <div className="cat-mgmt-card-info">
                  <span className="cat-mgmt-card-name">{cat.name}</span>
                  <span className="cat-mgmt-card-id">{cat.id}</span>
                  <span className="cat-mgmt-card-colour">{cat.colour}</span>
                </div>
                {/* Edit button */}
                <button
                  type="button"
                  className="cat-mgmt-edit-btn"
                  onClick={() => openEdit(cat)}
                  aria-label={l10n.getString('category-mgmt-edit-aria', { name: cat.name }, `Edit category ${cat.name}`)}
                >
                  ✎
                </button>
                {/* Delete button */}
                <Localized id="category-delete-aria" attrs={{ 'aria-label': true }} vars={{ name: cat.name }}>
                  <button
                    type="button"
                    className="cat-mgmt-delete-btn"
                    onClick={() => setDeleteTarget({ id: cat.id, name: cat.name })}
                    disabled={deleting === cat.id}
                  >
                    &times;
                  </button>
                </Localized>
              </div>
            </Card>
          ))}
        </div>
      )}

      <SettingsPopup
        open={!!deleteTarget}
        onClose={closeDelete}
        title={l10n.getString('categories-delete-confirm', { name: deleteTarget?.name ?? '' })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting !== null}>
              <Localized id="cancel"><span>Cancel</span></Localized>
            </Button>
            <Button variant="danger" loading={deleting !== null} onClick={confirmDelete}>
              <Localized id="delete"><span>Delete</span></Localized>
            </Button>
          </>
        }
      >
        <Localized id="categories-delete-warning">
          <p className="cat-mgmt-delete-warning">Are you sure you want to delete this category?</p>
        </Localized>
      </SettingsPopup>

      <SettingsPopup
        open={showModal}
        onClose={closeCreate}
        title={l10n.getString('categories-add')}
        saving={saving}
        error={createError}
        onSave={handleCreate}
        saveLabel={l10n.getString('categories-create')}
        saveDisabled={!newName.trim()}
        cancelLabel={l10n.getString('cancel')}
      >
        {/* Name input */}
        <div className="cat-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="cat-new-name" className="cat-mgmt-label">
            <Localized id="categories-name">
              <span>Name</span>
            </Localized>
          </label>
          <Localized id="categories-name-placeholder" attrs={{ placeholder: true }}>
            <input
              className="cat-mgmt-input"
              type="text"
              id="cat-new-name"
              name="cat-new-name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value.trim()) setNameTouched(true);
              }}
              ref={inputRef}
              aria-label={requiredLocalized(l10n, 'categories-name-aria')}
            />
          </Localized>
          {nameTouched && !newName.trim() && (
            <span className="cat-mgmt-field-error" role="alert">
              {requiredLocalized(l10n, 'categories-error-name-required')}
            </span>
          )}
          <span className="cat-mgmt-hint">
            <Localized id="categories-id-preview">
              <span>Category ID will be:</span>
            </Localized>{' '}
            <code>{newName.trim() ? colourToId(newName.trim()) : '…'}</code>
          </span>
        </div>

        {/* Icon picker */}
        <div className="cat-mgmt-field">
          <Localized id="categories-icon">
            <span className="cat-mgmt-label">Icon</span>
          </Localized>
          <div className="cat-mgmt-icon-picker" role="radiogroup" aria-label={l10n.getString('categories-icon-picker-aria')}>
            {ICON_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                ref={(el) => { iconRadioRefs.current[opt.id] = el; }}
                tabIndex={newIcon === opt.id ? 0 : -1}
                aria-checked={newIcon === opt.id}
                aria-label={l10n.getString(
                  opt.id === 'food' ? 'categories-icon-food' :
                  opt.id === 'snack' ? 'categories-icon-snack' :
                  opt.id === 'hot-drink' ? 'categories-icon-hot-drink' :
                  opt.id === 'cold-drink' ? 'categories-icon-cold-drink' :
                  'categories-icon-generic'
                )}
                className={
                  newIcon === opt.id
                    ? 'cat-mgmt-icon-btn cat-mgmt-icon-btn--selected'
                    : 'cat-mgmt-icon-btn'
                }
                style={newIcon === opt.id ? catColourVars(newColour) : undefined}
                onClick={() => setNewIcon(opt.id)}
                onKeyDown={handleIconKeyDown}
              >
                <CategoryIconSvg icon={opt.id} size={20} />
              </button>
            ))}
          </div>
        </div>

        {/* Colour swatch picker */}
        <div className="cat-mgmt-field">
          <Localized id="categories-colour">
            <span className="cat-mgmt-label">Colour</span>
          </Localized>
          <div className="cat-mgmt-colour-picker" role="radiogroup" aria-label={l10n.getString('categories-colour-picker-aria')}>
              {COLOURS.map((colour) => (
                <Localized key={colour} id="category-colour-swatch-aria" attrs={{ 'aria-label': true }} vars={{ colour }}>
                  <button
                    type="button"
                    role="radio"
                    ref={(el) => { colourRadioRefs.current[colour] = el; }}
                    tabIndex={newColour === colour ? 0 : -1}
                    aria-checked={newColour === colour}
                    className={
                      newColour === colour
                        ? 'cat-mgmt-colour-swatch cat-mgmt-colour-swatch--selected'
                        : 'cat-mgmt-colour-swatch'
                    }
                    style={{ '--cat-bg': colour } as CSSProperties}
                    onClick={() => setNewColour(colour)}
                    onKeyDown={handleColourKeyDown}
                  />
                </Localized>
              ))}
            </div>
        </div>

        {/* Preview */}
        <div className="cat-mgmt-preview">
          <Localized id="categories-preview">
            <span className="cat-mgmt-label">Preview</span>
          </Localized>
          <span
            className="cat-mgmt-preview-chip"
            style={catColourVars(newColour)}
          >
            <CategoryIconSvg icon={newIcon} size={14} />
            {newName.trim() || <Localized id="category-name-fallback"><span>Category Name</span></Localized>}
          </span>
        </div>
      </SettingsPopup>

      <SettingsPopup
        open={!!editTarget}
        onClose={closeEdit}
        title={l10n.getString('categories-edit')}
        saving={editSaving}
        error={editError}
        onSave={handleEdit}
        saveLabel={l10n.getString('categories-save')}
        saveDisabled={!editName.trim()}
        cancelLabel={l10n.getString('cancel')}
      >
        {/* Name input */}
        <div className="cat-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="cat-edit-name" className="cat-mgmt-label">
            <Localized id="categories-name">
              <span>Name</span>
            </Localized>
          </label>
          <input
            className="cat-mgmt-input"
            type="text"
            id="cat-edit-name"
            name="cat-edit-name"
            value={editName}
            onChange={(e) => {
              setEditName(e.target.value);
              if (e.target.value.trim()) setEditNameTouched(true);
            }}
            ref={editInputRef}
            aria-label={requiredLocalized(l10n, 'categories-name-aria')}
          />
          {editNameTouched && !editName.trim() && (
            <span className="cat-mgmt-field-error" role="alert">
              {requiredLocalized(l10n, 'categories-error-name-required')}
            </span>
          )}
        </div>

        {/* Icon picker */}
        <div className="cat-mgmt-field">
          <Localized id="categories-icon">
            <span className="cat-mgmt-label">Icon</span>
          </Localized>
          <div className="cat-mgmt-icon-picker" role="radiogroup" aria-label={l10n.getString('categories-icon-picker-aria')}>
            {ICON_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                ref={(el) => { editIconRadioRefs.current[opt.id] = el; }}
                tabIndex={editIcon === opt.id ? 0 : -1}
                aria-checked={editIcon === opt.id}
                aria-label={l10n.getString(
                  opt.id === 'food' ? 'categories-icon-food' :
                  opt.id === 'snack' ? 'categories-icon-snack' :
                  opt.id === 'hot-drink' ? 'categories-icon-hot-drink' :
                  opt.id === 'cold-drink' ? 'categories-icon-cold-drink' :
                  'categories-icon-generic'
                )}
                className={
                  editIcon === opt.id
                    ? 'cat-mgmt-icon-btn cat-mgmt-icon-btn--selected'
                    : 'cat-mgmt-icon-btn'
                }
                style={editIcon === opt.id ? catColourVars(editColour) : undefined}
                onClick={() => setEditIcon(opt.id)}
                onKeyDown={handleEditIconKeyDown}
              >
                <CategoryIconSvg icon={opt.id} size={20} />
              </button>
            ))}
          </div>
        </div>

        {/* Colour swatch picker */}
        <div className="cat-mgmt-field">
          <Localized id="categories-colour">
            <span className="cat-mgmt-label">Colour</span>
          </Localized>
          <div className="cat-mgmt-colour-picker" role="radiogroup" aria-label={l10n.getString('categories-colour-picker-aria')}>
            {COLOURS.map((colour) => (
              <Localized key={colour} id="category-colour-swatch-aria" attrs={{ 'aria-label': true }} vars={{ colour }}>
                <button
                    type="button"
                    role="radio"
                    ref={(el) => { editColourRadioRefs.current[colour] = el; }}
                    tabIndex={editColour === colour ? 0 : -1}
                    aria-checked={editColour === colour}
                    className={
                      editColour === colour
                        ? 'cat-mgmt-colour-swatch cat-mgmt-colour-swatch--selected'
                        : 'cat-mgmt-colour-swatch'
                    }
                    style={{ '--cat-bg': colour } as CSSProperties}
                    onClick={() => setEditColour(colour)}
                    onKeyDown={handleEditColourKeyDown}
                  />
              </Localized>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="cat-mgmt-preview">
          <Localized id="categories-preview">
            <span className="cat-mgmt-label">Preview</span>
          </Localized>
          <span
            className="cat-mgmt-preview-chip"
            style={catColourVars(editColour)}
          >
            <CategoryIconSvg icon={editIcon} size={14} />
            {editName.trim() || editTarget?.name || ''}
          </span>
        </div>
      </SettingsPopup>
    </div>
  );
}
