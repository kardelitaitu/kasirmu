import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './SettingsSelect.css';

/** A single option for the SettingsSelect dropdown. */
export interface SettingsSelectOption {
  value: string;
  label: string;
}

/** Props for the SettingsSelect custom dropdown component. */
export interface SettingsSelectProps {
  /** Unique element id (passed to the trigger button). */
  id?: string;
  /** Currently selected value. */
  value: string;
  /** Called when the user selects an option. */
  onChange: (value: string) => void;
  /** Available options. */
  options: SettingsSelectOption[];
  /** Disable the select. */
  disabled?: boolean;
  /** aria-label for accessibility. */
  ariaLabel?: string;
  /** Placeholder text shown when no value matches. */
  placeholder?: string;
  /** Optional data-testid for tests. */
  'data-testid'?: string;
}

/**
 * Custom dropdown select that replaces the native `<select>` with a
 * fully theme-styled button + popover list. All colors use CSS custom
 * properties so the dropdown matches the app's theme exactly (light
 * mode, dark mode, accent colors, etc.).
 *
 * Supports full keyboard navigation: Enter/Space to toggle, Arrow keys
 * to navigate, Home/End to jump, Enter to confirm, Escape to close.
 */
export default function SettingsSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  placeholder,
  'data-testid': testId,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeByMouseRef = useRef(false);

  // Keep option refs array in sync.
  optionRefs.current = optionRefs.current.slice(0, options.length);

  // Close on click outside — check both container and portal dropdown.
  // Also marks closeByMouseRef so the refocus effect skips mouse-initiated closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inContainer && !inDropdown) {
        closeByMouseRef.current = true;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus the active option when dropdown opens or activeIndex changes.
  useEffect(() => {
    if (!open) return;
    const el = optionRefs.current[activeIndex];
    if (el) el.focus();
  }, [open, activeIndex]);

  // Select an option and close.
  const selectOption = useCallback(
    (optValue: string) => {
      onChange(optValue);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const selectedOption = options.find((o) => o.value === value);
  const selectedIndex = selectedOption ? options.indexOf(selectedOption) : -1;

  // ── Keyboard handler for both trigger and options ──────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!open) {
            // Opening — set active to selected or first.
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
            setOpen(true);
          } else {
            // Confirm current active option.
            const opt = options[activeIndex];
            if (opt) selectOption(opt.value);
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (!open) {
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
            setOpen(true);
          } else {
            setActiveIndex((prev) =>
              prev < options.length - 1 ? prev + 1 : 0,
            );
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (!open) {
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
            setOpen(true);
          } else {
            setActiveIndex((prev) =>
              prev > 0 ? prev - 1 : options.length - 1,
            );
          }
          break;

        case 'Home':
          e.preventDefault();
          if (open) setActiveIndex(0);
          break;

        case 'End':
          e.preventDefault();
          if (open) setActiveIndex(options.length - 1);
          break;

        case 'Escape':
          if (open) {
            e.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
          break;

        case 'Tab':
          // Tab closes the dropdown without confirming the active option.
          // Mark as mouse-close so the refocus effect does NOT steal focus
          // from the element that Tab moves to.
          if (open) {
            closeByMouseRef.current = true;
            setOpen(false);
            setActiveIndex(-1);
          }
          break;

        default:
          break;
      }
    },
    [disabled, open, activeIndex, options, selectedIndex, selectOption],
  );

  /** Calculate dropdown position — flips above if insufficient space below. */
  const calcPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Estimated dropdown height: up to 15rem (~240px), so check if <200px below.
    const flipUp = spaceBelow < 200 && rect.top > spaceBelow;
    return {
      position: 'fixed' as const,
      top: flipUp ? `${rect.top - 4}px` : `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      minWidth: `${rect.width}px`,
      zIndex: 9999,
    };
  }, []);

  // Recalculate position on scroll or resize while open.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const pos = calcPosition();
      if (pos) setDropdownStyle(pos);
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, calcPosition]);

  const handleTriggerClick = useCallback(() => {
    if (!disabled) {
      const nextOpen = !open;
      if (nextOpen) {
        setDropdownStyle(calcPosition());
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      } else {
        setDropdownStyle(null);
        setActiveIndex(-1);
      }
      setOpen(nextOpen);
    }
  }, [disabled, open, selectedIndex, calcPosition]);

  // Track active option ref for scrolling into view.
  useEffect(() => {
    const el = optionRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Refocus trigger only when dropdown closes via keyboard (Enter, Space, Escape, Tab).
  // Skip refocus on mouse-initiated closes (click outside) to avoid stealing focus.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open && !closeByMouseRef.current) {
      triggerRef.current?.focus();
    }
    closeByMouseRef.current = false;
    prevOpenRef.current = open;
  }, [open]);

  return (
    <div className="ssel-container" ref={containerRef}>
      {/* Hidden native select for label association via htmlFor.
          Mirrors the custom button's value so screen readers and
          label elements can associate correctly via the id prop. */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => e.preventDefault()}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className="ssel-trigger"
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
      >
        <span className="ssel-label">
          {selectedOption?.label ?? placeholder ?? ''}
        </span>
        <svg
          className={`ssel-chevron${open ? ' ssel-chevron--open' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>

      {open && dropdownStyle && createPortal(
        <div ref={dropdownRef} className="ssel-dropdown" role="listbox" aria-label={ariaLabel} style={dropdownStyle}>
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <button
                key={opt.value}
                ref={(el) => { optionRefs.current[idx] = el; }}
                id={id ? `ssel-opt-${id}-${idx}` : undefined}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`ssel-option${isSelected ? ' ssel-option--selected' : ''}${isActive ? ' ssel-option--active' : ''}`}
                onClick={() => selectOption(opt.value)}
                onKeyDown={handleKeyDown}
                tabIndex={-1}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
