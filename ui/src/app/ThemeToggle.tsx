import { useTheme } from './ThemeProvider';
import { useLocalization } from '@fluent/react';
import Tooltip from './Tooltip';

/**
 * A toggle button that switches between light and dark themes.
 * Shows a sun icon in dark mode (click to go light) and a moon
 * icon in light mode (click to go dark).
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { l10n } = useLocalization();
  const tooltipContent = l10n.getString('theme-toggle-label');

  // theme-toggle-aria is an attribute-only message (.aria-label), so we
  // access the FluentBundle directly to format its attribute with $mode.
  const bundle = l10n.getBundle('theme-toggle-aria');
  const msg = bundle?.getMessage('theme-toggle-aria');
  const ariaAttr = msg?.attributes?.['aria-label'];
  const ariaLabel = ariaAttr
    ? bundle!.formatPattern(ariaAttr, {
        mode: theme === 'light' ? 'dark' : 'light',
      }, [])
    : tooltipContent;

  return (
    <Tooltip content={tooltipContent} position="bottom">
      <button
        type="button"
        onClick={toggleTheme}
        className="theme-toggle"
        data-testid="theme-toggle"
        aria-label={ariaLabel}
      >
        <span className="sr-only">{tooltipContent}</span>
        {/* Palette icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.35626 19.5034 5.48512 20.2587 5.18364 20.8988C4.98265 21.3256 5.21316 21.8415 5.67035 21.9685C6.07929 22 6.49503 22 6.91891 22C7.46973 22 7.91501 21.5649 7.96205 21.0153C8.04945 19.9942 8.9056 19.2 9.94042 19.2H10.0596C11.0944 19.2 11.9505 19.9942 12.038 21.0153C12.085 21.5649 12.5303 22 13.0811 22" />
          <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor" />
          <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor" />
          <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </Tooltip>
  );
}
