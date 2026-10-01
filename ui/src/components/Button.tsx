import { forwardRef, useState, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { animDuration } from '@/utils/animation';

// ── Types ──────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'unstyled';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonState = 'ready' | 'processing' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. @default 'primary' */
  variant?: ButtonVariant;
  /** Size preset. @default 'md' */
  size?: ButtonSize;
  /**
   * Visual state of the button.
   * - `ready`: idle, clickable (default)
   * - `processing`: shows a spinner and disables the button
   * - `success`: shows a checkmark and disables the button (after-state)
   * @default 'ready'
   */
  state?: ButtonState;
  /**
   * Show a loading spinner and disable the button.
   * @deprecated Use `state="processing"` instead.
   */
  loading?: boolean;
  /** Optional icon placed before children. */
  icon?: ReactNode;
  /** Render as an icon-only button (square, equal padding). Requires an visible label or `aria-label`. */
  iconOnly?: boolean;
  /** Remove design-system variant/size styling; keep base reset, focus ring, and disabled behaviour. */
  unstyled?: boolean;
  /** Button text or content. */
  children: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Reusable button using design tokens.
 *
 * Examples:
 * ```tsx
 * <Button>Save</Button>
 * <Button variant="danger" size="lg">Delete</Button>
 * <Button variant="ghost" state="processing">Please wait…</Button>
 * <Button variant="ghost" iconOnly aria-label="Close"><CloseIcon /></Button>
 * <Button unstyled className="my-custom-toggle" aria-label="Toggle">☰</Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      state = 'ready',
      loading,
      icon,
      iconOnly,
      unstyled,
      children,
      className,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const isProcessing = state === 'processing' || loading === true;
    const isSuccess = state === 'success';
    const isDisabled = disabled || isProcessing || isSuccess;

    // ── T6: spinner exit animation ──────────────────────────────────
    // When isProcessing flips true→false the spinner fades+scales out
    // over 150 ms instead of snapping away. `spinnerExiting` keeps it
    // mounted for the duration of the exit animation, then unmounts it.
    const [spinnerMounted, setSpinnerMounted] = useState(isProcessing);
    const [spinnerExiting, setSpinnerExiting] = useState(false);
    const spinnerExitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (isProcessing) {
        // Processing started: cancel any in-flight exit, show spinner.
        if (spinnerExitTimer.current !== null) {
          clearTimeout(spinnerExitTimer.current);
          spinnerExitTimer.current = null;
        }
        setSpinnerExiting(false);
        setSpinnerMounted(true);
      } else if (spinnerMounted) {
        // Processing ended: run exit animation then unmount.
        setSpinnerExiting(true);
        spinnerExitTimer.current = setTimeout(() => {
          setSpinnerMounted(false);
          setSpinnerExiting(false);
          spinnerExitTimer.current = null;
        }, animDuration(150));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isProcessing]);

    // Cancel timer on unmount — never setState against an unmounted component.
    useEffect(() => {
      return () => {
        if (spinnerExitTimer.current !== null) {
          clearTimeout(spinnerExitTimer.current);
        }
      };
    }, []);

    const classNames = [
      unstyled ? 'btn--unstyled' : 'btn',
      !unstyled && `btn--${variant}`,
      !unstyled && `btn--${size}`,
      iconOnly && 'btn--icon-only',
      isSuccess && 'btn--success-state',
      className ?? '',
    ]
      .filter((v): v is string => Boolean(v))
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        className={classNames}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={isProcessing || undefined}
        {...rest}
      >
        {spinnerMounted ? (
          <span
            className={`btn__spinner${spinnerExiting ? ' btn__spinner--exiting' : ''}`}
            aria-hidden="true"
          />
        ) : isSuccess ? (
          <svg className="btn__check" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : icon ? (
          <span className="btn__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {isProcessing || isSuccess ? <span className="sr-only">{children}</span> : children}
      </button>
    );
  },
);

Button.displayName = 'Button';
