// ── KdsHamburgerPanel tests ──────────────────────────────────────
//
// Covers: open/close toggle, sound/auto-accept/density toggles,
// SLA threshold sliders, order ID / table number switches,
// zoom and column controls, colour hex-input commit-on-valid-hex,
// reset colours button, and hardware-accel toggle visibility.
//
// Mocks: ThemeProvider (optional), HardwareAccelContext (optional),
// useFocusTrap (no-op), useSwipe (no-op), KdsCardColorsContext.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KdsHamburgerPanel } from '@/features/kds/KdsHamburgerPanel';
import type { KdsSettings } from '@/features/kds/KdsSettingsPanel';
import { DEFAULT_SETTINGS } from '@/features/kds/KdsSettingsPanel';
import { DEFAULT_COLORS_DARK } from '@/features/kds/kdsCardColors';
import kdsFtl from '@/locales/kds.ftl?raw';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';

// ── Mocks ───────────────────────────────────────────────────────────

// Theme: return null by default (no theme toggle rendered).
let mockTheme: string | null = null;
vi.mock('@/frontend/shell/ThemeProvider', () => ({
  useOptionalTheme: () =>
    mockTheme === null
      ? null
      : { theme: mockTheme, setTheme: (t: string) => { mockTheme = t; } },
}));

// Hardware acceleration: null by default (no toggle rendered).
let mockHwAccel: { enabled: boolean; setEnabled: (v: boolean) => void } | null = null;
vi.mock('@/contexts/HardwareAccelContext', () => ({
  useOptionalHardwareAccel: () => mockHwAccel,
}));

// Focus trap — no-op.
vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => {},
}));

// Swipe — return empty handlers.
vi.mock('@/hooks/useSwipe', () => ({
  useSwipe: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn() }),
}));

// Card colours context — expose mutable colours + callbacks.
let mockColors = { ...DEFAULT_COLORS_DARK };
const mockUpdateColor = vi.fn();
const mockResetColors = vi.fn();
vi.mock('@/features/kds/KdsCardColorsContext', () => ({
  useKdsCardColors: () => ({
    colors: mockColors,
    updateColor: mockUpdateColor,
    resetColors: mockResetColors,
  }),
}));

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULTS = DEFAULT_SETTINGS;

function makeProps(overrides: Partial<React.ComponentProps<typeof KdsHamburgerPanel>> = {}): React.ComponentProps<typeof KdsHamburgerPanel> {
  return {
    settings: { ...DEFAULTS } as KdsSettings,
    onChangeSound: vi.fn(),
    onChangeYellowThreshold: vi.fn(),
    onChangeRedThreshold: vi.fn(),
    onChangeAutoAcknowledge: vi.fn(),
    onChangeDensity: vi.fn(),
    showOrderId: true,
    showTableNumber: false,
    onToggleOrderId: vi.fn(),
    onToggleTableNumber: vi.fn(),
    ...overrides,
  };
}

async function openPanel(props = makeProps()) {
  const result = renderWithFluentSync(<KdsHamburgerPanel {...props} />, kdsFtl);
  const user = userEvent.setup();
  await user.click(screen.getByTestId('kds-topbar-settings'));
  return { user, ...result, props };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('KdsHamburgerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = null;
    mockHwAccel = null;
    mockColors = { ...DEFAULT_COLORS_DARK };
  });

  // ── Open / close ──────────────────────────────────────────────────

  describe('open/close', () => {
    it('renders the hamburger button with aria-expanded=false', () => {
      renderWithFluentSync(<KdsHamburgerPanel {...makeProps()} />, kdsFtl);
      const btn = screen.getByTestId('kds-topbar-settings');
      expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the panel on click and sets aria-expanded=true', async () => {
      await openPanel();
      expect(screen.getByRole('dialog', { name: /kds settings/i })).toBeInTheDocument();
      expect(screen.getByTestId('kds-topbar-settings')).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes the panel on second click of the hamburger button', async () => {
      const { user } = await openPanel();
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('kds-topbar-settings'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('panel has role="dialog" and aria-modal="true"', async () => {
      await openPanel();
      const dialog = screen.getByRole('dialog', { name: /kds settings/i });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  // ── Display section ───────────────────────────────────────────────

  describe('Display section', () => {
    it('renders section heading "Settings"', async () => {
      await openPanel();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('column stepper shows current value', async () => {
      await openPanel({ ...makeProps(), settings: { ...DEFAULTS, density: 3 } });
      expect(screen.getByTestId('kds-settings-density-value')).toHaveTextContent('3');
    });

    it('clicking + increases column count', async () => {
      const props = makeProps({ settings: { ...DEFAULTS, density: 2 } });
      const { user } = await openPanel(props);
      await user.click(screen.getByTestId('kds-settings-density-in'));
      expect(props.onChangeDensity).toHaveBeenCalledWith(3);
    });

    it('clicking − decreases column count', async () => {
      const props = makeProps({ settings: { ...DEFAULTS, density: 3 } });
      const { user } = await openPanel(props);
      await user.click(screen.getByTestId('kds-settings-density-out'));
      expect(props.onChangeDensity).toHaveBeenCalledWith(2);
    });

    it('Order ID switch reflects showOrderId prop', async () => {
      await openPanel({ ...makeProps(), showOrderId: true });
      const toggle = screen.getByRole('switch', { name: /order id/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking Order ID switch calls onToggleOrderId', async () => {
      const props = makeProps({ showOrderId: true });
      const { user } = await openPanel(props);
      await user.click(screen.getByRole('switch', { name: /order id/i }));
      expect(props.onToggleOrderId).toHaveBeenCalledWith(false);
    });

    it('Table Number switch reflects showTableNumber prop', async () => {
      await openPanel({ ...makeProps(), showTableNumber: false });
      const toggle = screen.getByRole('switch', { name: /table number/i });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('clicking Table Number switch calls onToggleTableNumber', async () => {
      const props = makeProps({ showTableNumber: false });
      const { user } = await openPanel(props);
      await user.click(screen.getByRole('switch', { name: /table number/i }));
      expect(props.onToggleTableNumber).toHaveBeenCalledWith(true);
    });
  });

  // ── Zoom controls ─────────────────────────────────────────────────

  describe('zoom controls (when onChangePageZoom provided)', () => {
    it('renders zoom controls when onChangePageZoom is provided', async () => {
      await openPanel({ ...makeProps(), pageZoom: 100, onChangePageZoom: vi.fn() });
      expect(screen.getByTestId('kds-settings-zoom-value')).toHaveTextContent('100%');
    });

    it('zoom-in button increases by 10', async () => {
      const onChangePageZoom = vi.fn();
      const { user } = await openPanel({ ...makeProps(), pageZoom: 80, onChangePageZoom });
      await user.click(screen.getByTestId('kds-settings-zoom-in'));
      expect(onChangePageZoom).toHaveBeenCalledWith(90);
    });

    it('zoom-out button decreases by 10', async () => {
      const onChangePageZoom = vi.fn();
      const { user } = await openPanel({ ...makeProps(), pageZoom: 120, onChangePageZoom });
      await user.click(screen.getByTestId('kds-settings-zoom-out'));
      expect(onChangePageZoom).toHaveBeenCalledWith(110);
    });

    it('zoom-out button clamps at 50', async () => {
      const onChangePageZoom = vi.fn();
      const { user } = await openPanel({ ...makeProps(), pageZoom: 50, onChangePageZoom });
      await user.click(screen.getByTestId('kds-settings-zoom-out'));
      expect(onChangePageZoom).toHaveBeenCalledWith(50);
    });

    it('zoom-in button clamps at 200', async () => {
      const onChangePageZoom = vi.fn();
      const { user } = await openPanel({ ...makeProps(), pageZoom: 200, onChangePageZoom });
      await user.click(screen.getByTestId('kds-settings-zoom-in'));
      expect(onChangePageZoom).toHaveBeenCalledWith(200);
    });

    it('clicking zoom value resets to 100', async () => {
      const onChangePageZoom = vi.fn();
      const { user } = await openPanel({ ...makeProps(), pageZoom: 140, onChangePageZoom });
      await user.click(screen.getByTestId('kds-settings-zoom-value'));
      expect(onChangePageZoom).toHaveBeenCalledWith(100);
    });

    it('does not render zoom controls when onChangePageZoom is absent', async () => {
      await openPanel(makeProps()); // no onChangePageZoom
      expect(screen.queryByTestId('kds-settings-zoom-value')).not.toBeInTheDocument();
    });
  });

  // ── Column controls ───────────────────────────────────────────────

  describe('column controls (when onChangeColumns provided)', () => {
    it('renders column controls', async () => {
      await openPanel({ ...makeProps(), columns: 3, onChangeColumns: vi.fn() });
      expect(screen.getByTestId('kds-settings-cols-value')).toHaveTextContent('3');
    });

    it('increase button increments columns', async () => {
      const onChangeColumns = vi.fn();
      const { user } = await openPanel({ ...makeProps(), columns: 2, onChangeColumns });
      await user.click(screen.getByTestId('kds-settings-cols-in'));
      expect(onChangeColumns).toHaveBeenCalledWith(3);
    });

    it('decrease button decrements columns', async () => {
      const onChangeColumns = vi.fn();
      const { user } = await openPanel({ ...makeProps(), columns: 3, onChangeColumns });
      await user.click(screen.getByTestId('kds-settings-cols-out'));
      expect(onChangeColumns).toHaveBeenCalledWith(2);
    });

    it('decrease button clamps at 1', async () => {
      const onChangeColumns = vi.fn();
      const { user } = await openPanel({ ...makeProps(), columns: 1, onChangeColumns });
      await user.click(screen.getByTestId('kds-settings-cols-out'));
      expect(onChangeColumns).toHaveBeenCalledWith(1);
    });

    it('clicking value resets to 0 (auto)', async () => {
      const onChangeColumns = vi.fn();
      const { user } = await openPanel({ ...makeProps(), columns: 3, onChangeColumns });
      await user.click(screen.getByTestId('kds-settings-cols-value'));
      expect(onChangeColumns).toHaveBeenCalledWith(0);
    });
  });

  // ── Hardware acceleration toggle ──────────────────────────────────

  describe('hardware acceleration toggle', () => {
    it('renders toggle when hwAccel context is available', async () => {
      mockHwAccel = { enabled: true, setEnabled: vi.fn() };
      await openPanel();
      expect(screen.getByTestId('kds-settings-hw-accel-toggle')).toBeInTheDocument();
    });

    it('calls setEnabled on click', async () => {
      const setEnabled = vi.fn();
      mockHwAccel = { enabled: true, setEnabled };
      const { user } = await openPanel();
      await user.click(screen.getByTestId('kds-settings-hw-accel-toggle'));
      expect(setEnabled).toHaveBeenCalledWith(false);
    });

    it('does not render when hwAccel context is null', async () => {
      mockHwAccel = null;
      await openPanel();
      expect(screen.queryByTestId('kds-settings-hw-accel-toggle')).not.toBeInTheDocument();
    });
  });

  // ── Behaviour section ─────────────────────────────────────────────

  describe('Behaviour section', () => {
    it('renders section heading "Behaviour"', async () => {
      await openPanel();
      expect(screen.getByText('Behaviour')).toBeInTheDocument();
    });

    it('has the kds-panel-section--behaviour class for full-width span', async () => {
      renderWithFluentSync(<KdsHamburgerPanel {...makeProps()} />, kdsFtl);
      await userEvent.setup().click(screen.getByTestId('kds-topbar-settings'));
      const section = screen.getByText('Behaviour').closest('.kds-panel-section');
      expect(section).toHaveClass('kds-panel-section--behaviour');
    });

    it('sound toggle reflects settings.soundEnabled', async () => {
      await openPanel({ ...makeProps(), settings: { ...DEFAULTS, soundEnabled: true } });
      const toggle = screen.getByRole('switch', { name: /sound/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking sound toggle calls onChangeSound', async () => {
      const props = makeProps({ settings: { ...DEFAULTS, soundEnabled: false } });
      const { user } = await openPanel(props);
      await user.click(screen.getByRole('switch', { name: /sound/i }));
      expect(props.onChangeSound).toHaveBeenCalledWith(true);
    });

    it('auto-acknowledge toggle reflects settings.autoAcknowledge', async () => {
      await openPanel({ ...makeProps(), settings: { ...DEFAULTS, autoAcknowledge: true } });
      const toggle = screen.getByRole('switch', { name: /auto-accept/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking auto-acknowledge toggle calls onChangeAutoAcknowledge', async () => {
      const props = makeProps({ settings: { ...DEFAULTS, autoAcknowledge: false } });
      const { user } = await openPanel(props);
      await user.click(screen.getByRole('switch', { name: /auto-accept/i }));
      expect(props.onChangeAutoAcknowledge).toHaveBeenCalledWith(true);
    });

    it('card animations toggle renders when onChangeCardAnimations is provided', async () => {
      const onChangeCardAnimations = vi.fn();
      await openPanel({ ...makeProps(), cardAnimations: true, onChangeCardAnimations });
      expect(screen.getByTestId('kds-settings-anim-toggle')).toBeInTheDocument();
    });

    it('card animations toggle does not render when handler absent', async () => {
      await openPanel(makeProps()); // no onChangeCardAnimations
      expect(screen.queryByTestId('kds-settings-anim-toggle')).not.toBeInTheDocument();
    });

    it('yellow threshold slider renders with correct value', async () => {
      await openPanel({ ...makeProps(), settings: { ...DEFAULTS, yellowThresholdMin: 5 } });
      const slider = screen.getByRole('slider', { name: /yellow/i });
      expect(slider).toHaveAttribute('aria-valuenow', '5');
    });

    it('changing yellow threshold via arrow key', async () => {
      const props = makeProps();
      await openPanel(props);
      const slider = screen.getByRole('slider', { name: /yellow/i });
      slider.focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(props.onChangeYellowThreshold).toHaveBeenCalled();
    });

    it('red threshold slider renders with correct value', async () => {
      await openPanel({ ...makeProps(), settings: { ...DEFAULTS, redThresholdMin: 10 } });
      const slider = screen.getByRole('slider', { name: /red/i });
      expect(slider).toHaveAttribute('aria-valuenow', '10');
    });

    it('changing red threshold via arrow key', async () => {
      const props = makeProps();
      await openPanel(props);
      const slider = screen.getByRole('slider', { name: /red/i });
      slider.focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(props.onChangeRedThreshold).toHaveBeenCalled();
    });
  });

  // ── Colours section ───────────────────────────────────────────────

  describe('Colours section', () => {
    it('renders all six colour groups', async () => {
      await openPanel();
      const keys = ['dinein', 'takeaway', 'rush', 'processing', 'prepared', 'complete'];
      for (const key of keys) {
        expect(screen.getByTestId(`kds-settings-colors-native-${key}`)).toBeInTheDocument();
        expect(screen.getByTestId(`kds-settings-colors-hex-${key}`)).toBeInTheDocument();
      }
    });

    it('hex input shows the current colour from context', async () => {
      mockColors = { ...DEFAULT_COLORS_DARK, dinein: '#aabbcc' };
      await openPanel();
      const hex = screen.getByTestId('kds-settings-colors-hex-dinein') as HTMLInputElement;
      expect(hex.value).toBe('#aabbcc');
    });

    it('typing a valid hex in the input calls updateColor', async () => {
      const { user } = await openPanel();
      const hex = screen.getByTestId('kds-settings-colors-hex-dinein');
      await user.clear(hex);
      await user.type(hex, '#ff00aa');
      expect(mockUpdateColor).toHaveBeenCalledWith('dinein', '#ff00aa');
    });

    it('native picker change calls updateColor', async () => {
      await openPanel();
      const native = screen.getByTestId('kds-settings-colors-native-dinein');
      fireEvent.change(native, { target: { value: '#112233' } });
      expect(mockUpdateColor).toHaveBeenCalledWith('dinein', '#112233');
    });

    it('reset button calls resetColors', async () => {
      const { user } = await openPanel();
      await user.click(screen.getByTestId('kds-settings-colors-reset'));
      expect(mockResetColors).toHaveBeenCalledTimes(1);
    });

    it('theme tag shows current theme or defaults to "dark"', async () => {
      await openPanel();
      expect(screen.getByTestId('kds-settings-colors-theme-tag')).toHaveTextContent('dark');
    });

    it('theme tag shows "light" when theme context is light', async () => {
      mockTheme = 'light';
      await openPanel();
      expect(screen.getByTestId('kds-settings-colors-theme-tag')).toHaveTextContent('light');
    });
  });
});
