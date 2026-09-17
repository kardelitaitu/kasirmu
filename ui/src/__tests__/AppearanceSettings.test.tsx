import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from '@/features/settings/AppearanceSettings';

// ── Mocks ────────────────────────────────────────────────────────

const mockGetBrandSettings = vi.fn();
const mockSetBrandPrimaryColour = vi.fn();
const mockSetBrandLogoPath = vi.fn();
const mockSetBrandStoreName = vi.fn();
const mockPickLogoFile = vi.fn();
// Distinct from mockPickLogoFile rather than delegating to it: a mirror registers a call on the
// unscoped spy, which makes `expect(mockPickLogoFile).not.toHaveBeenCalled()` unprovable and the
// test would pass whether or not the permission check ran. See DataManagementBackup.test.tsx.
const mockPickLogoFileScoped = vi.fn();
const mockRefreshBrandSettings = vi.fn();

vi.mock('@/api/branding', () => ({
  getBrandSettings: () => mockGetBrandSettings(),
  getBrandSettingsScoped: (t: string) => mockGetBrandSettings(t),
  setBrandPrimaryColour: (t: string, c: string) => mockSetBrandPrimaryColour(t, c),
  setBrandLogoPath: (t: string, p: string) => mockSetBrandLogoPath(t, p),
  setBrandStoreName: (t: string, n: string) => mockSetBrandStoreName(t, n),
  pickLogoFile: () => mockPickLogoFile(),
  pickLogoFileScoped: (t: string) => mockPickLogoFileScoped(t),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-appearance' }),
}));

vi.mock('@/contexts/ZoomContext', () => ({
  useAppZoom: () => ({ zoomLevel: 'auto', setZoomLevel: vi.fn() }),
}));

const mockSetHwAccelEnabled = vi.fn();

vi.mock('@/contexts/HardwareAccelContext', () => ({
  useHardwareAccel: () => ({ enabled: true, setEnabled: (val: boolean) => mockSetHwAccelEnabled(val) }),
  HardwareAccelProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/BrandContext', () => ({
  useBrand: () => ({
    settings: {
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: '',
    },
    refreshBrandSettings: () => mockRefreshBrandSettings(),
  }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'primary-colour-picker-aria': 'Primary colour picker',
          'colour-hex-aria': 'Colour hex value',
          'reset-colour-aria': 'Reset colour to default',
          'appearance-follow-theme-aria': 'Following theme colour — pick a colour to override',
          'pick-logo-aria': 'Pick logo file',
          'reset-appearance-aria': 'Reset all appearance settings',
          'save-appearance-aria': 'Save appearance',
        };
        return map[id] || id;
      },
    },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
}));

const mockDeriveAccentPalette = vi.fn();
const mockApplyAccentPalette = vi.fn();
const mockClearAccentPalette = vi.fn();

vi.mock('@/utils/color', () => ({
  deriveAccentPalette: (base: string) => mockDeriveAccentPalette(base),
  applyAccentPalette: (palette: unknown) => mockApplyAccentPalette(palette),
  clearAccentPalette: (...args: unknown[]) => mockClearAccentPalette(...args),
  applyThemeContrasts: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button
      onClick={onClick}
      className={`btn btn--${variant ?? 'primary'}`}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

// ── Default brand settings ────────────────────────────────────────

const defaultBrandResponse = {
  primary_colour: '#147EFB',
  logo_path: null,
  store_name: '',
};

// ── Tests ────────────────────────────────────────────────────────

describe('AppearanceSettings', () => {
  beforeEach(() => {
    mockGetBrandSettings.mockResolvedValue(defaultBrandResponse);
    mockSetBrandPrimaryColour.mockResolvedValue(undefined);
    mockSetBrandLogoPath.mockResolvedValue(undefined);
    mockSetBrandStoreName.mockResolvedValue(undefined);
    mockPickLogoFile.mockResolvedValue(null);
    mockDeriveAccentPalette.mockReturnValue({});
    mockApplyAccentPalette.mockReturnValue(undefined);
    mockSetHwAccelEnabled.mockClear();
  });

  // ── Rendering ──────────────────────────────────────────────────

  it('renders inside three CSS card containers in non-embedded mode', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      const cards = document.querySelectorAll('.card');
      expect(cards).toHaveLength(3);
    });
  });

  it('toggles Hardware Acceleration when clicking toggle slider', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Hardware Acceleration')).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText('Hardware Acceleration') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // Verify clicking the visual slider or label container properly delegates click to checkbox
    const toggleContainer = document.querySelector('.settings-toggle') as HTMLElement;
    expect(toggleContainer).not.toBeNull();
    fireEvent.click(toggleContainer);

    expect(mockSetHwAccelEnabled).toHaveBeenCalledWith(false);
  });

  it('renders card containers in embedded mode without reset/save buttons', () => {
    render(<AppearanceSettings embedded colour="#ff0000" storeName="Test Store" />);
    // Embedded mode now also renders cards, just without reset/save.
    const cards = document.querySelectorAll('.card');
    expect(cards).toHaveLength(3);
    expect(screen.queryByLabelText('Save appearance')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reset all appearance settings')).not.toBeInTheDocument();
  });

  it('shows "Branding" section title as first card heading in non-embedded mode', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByText('Branding')).toBeInTheDocument();
      expect(screen.getByText('Interface')).toBeInTheDocument();
      expect(screen.getByText('Preview')).toBeInTheDocument();
    });
  });

  // ── Colour picker ──────────────────────────────────────────────

  it('renders colour picker with initial value', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Primary colour picker')).toBeInTheDocument();
    });

    const colourInput = screen.getByLabelText('Primary colour picker') as HTMLInputElement;
    expect(colourInput.value).toBe('#147efb');
  });

  it('renders hex text input with initial value', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });

    const hexInput = screen.getByLabelText('Colour hex value') as HTMLInputElement;
    expect(hexInput.value).toBe('#147EFB');
  });

  it('updates colour picker value when user changes hex input', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });

    const hexInput = screen.getByLabelText('Colour hex value') as HTMLInputElement;
    // Use fireEvent.change (not user.type) so the full hex value is
    // processed at once — user.type types character-by-character and
    // normaliseHex rejects the leading '#' on its own.
    fireEvent.change(hexInput, { target: { value: '#ff5500' } });

    expect(hexInput.value).toBe('#ff5500');
    // Colour picker should sync.
    const colourInput = screen.getByLabelText('Primary colour picker') as HTMLInputElement;
    expect(colourInput.value).toBe('#ff5500');
  });

  // ── Store name ─────────────────────────────────────────────────

  it('renders store name input', async () => {
    mockGetBrandSettings.mockResolvedValue({ ...defaultBrandResponse, store_name: 'My Shop' });
    render(<AppearanceSettings />);

    await waitFor(() => {
      const input = screen.getByDisplayValue('My Shop');
      expect(input).toBeInTheDocument();
    });
  });

  it('updates store name when user types', async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });

    const storeNameInput = document.getElementById('store-name-display') as HTMLInputElement;
    await user.clear(storeNameInput);
    await user.type(storeNameInput, 'Acme POS');

    expect(storeNameInput.value).toBe('Acme POS');
  });

  // ── Logo section ──────────────────────────────────────────────

  it('renders "Choose Logo" button', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Pick logo file')).toBeInTheDocument();
    });
  });

  it('shows logo preview image when logo path is set', async () => {
    mockGetBrandSettings.mockResolvedValue({
      ...defaultBrandResponse,
      logo_path: '/path/to/logo.png',
    });
    render(<AppearanceSettings />);

    await waitFor(() => {
      expect(screen.getByAltText('Store logo')).toBeInTheDocument();
    });
  });

  it('shows logo file path text when logo is set', async () => {
    mockGetBrandSettings.mockResolvedValue({
      ...defaultBrandResponse,
      logo_path: '/path/to/logo.png',
    });
    render(<AppearanceSettings />);

    await waitFor(() => {
      expect(screen.getByText('/path/to/logo.png')).toBeInTheDocument();
    });
  });

  it('calls pickLogoFile when "Choose Logo" button is clicked', async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Pick logo file')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Pick logo file'));

    // pick_logo_file opens a native file dialog and, unscoped, checks no permission at all;
    // pick_logo_file_scoped (branding.rs:271) enforces permissions::SETTINGS_EDIT. The very next
    // statement in the handler already passes sessionToken to setBrandLogoPath
    // (AppearanceSettings.tsx:134), so the token is in hand at this exact point -- the unscoped
    // call was the lone outlier, not a deliberate choice.
    // 'tok-appearance', not HARNESS_SESSION_TOKEN: this file overrides useWorkspace at L31 with
    // its own token, and the sibling assertions at L308/367/368 already assert against it.
    // Matching the block's own convention is what makes the assertion meaningful here.
    expect(mockPickLogoFileScoped).toHaveBeenCalledWith('tok-appearance');
    expect(mockPickLogoFile).not.toHaveBeenCalled();
  });

  it('sets logo path and refreshes brand when pickLogoFile returns a path', async () => {
    const user = userEvent.setup();
    mockPickLogoFile.mockResolvedValue('/new/logo.png');
    // The component takes the scoped branch under this file's session token, so the scenario has
    // to be configured there too.
    mockPickLogoFileScoped.mockResolvedValue('/new/logo.png');
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Pick logo file')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Pick logo file'));

    await waitFor(() => {
      // RED (round AD): logo-path persistence is also session-scoped.
      expect(mockSetBrandLogoPath).toHaveBeenCalledWith('tok-appearance', '/new/logo.png');
      expect(mockRefreshBrandSettings).toHaveBeenCalled();
    });
  });

  // ── Preview ────────────────────────────────────────────────────

  it('renders preview heading', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByText('Preview')).toBeInTheDocument();
    });
  });

  it('shows store name in preview when set', async () => {
    mockGetBrandSettings.mockResolvedValue({
      ...defaultBrandResponse,
      store_name: 'My Preview Store',
    });
    render(<AppearanceSettings />);

    await waitFor(() => {
      expect(screen.getByText('My Preview Store')).toBeInTheDocument();
    });
  });

  it('shows kasir.mu fallback in preview when store name is empty', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByText('kasir.mu')).toBeInTheDocument();
    });
  });

  // ── Save button ───────────────────────────────────────────────

  it('renders save button in non-embedded mode', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).toBeInTheDocument();
    });
  });

  it('does not render save button in embedded mode', () => {
    render(<AppearanceSettings embedded colour="#ff0000" storeName="Test" />);
    expect(screen.queryByLabelText('Save appearance')).not.toBeInTheDocument();
  });

  it('calls setBrandPrimaryColour and setBrandStoreName on save', async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Save appearance'));

    await waitFor(() => {
      // RED (round AD): the Rust commands require a session token
      // (SETTINGS_EDIT) — the token must lead every setter call.
      expect(mockSetBrandPrimaryColour).toHaveBeenCalledWith('tok-appearance', '#147EFB');
      expect(mockSetBrandStoreName).toHaveBeenCalledWith('tok-appearance', '');
      expect(mockRefreshBrandSettings).toHaveBeenCalled();
    });
  });

  it('disables save button while saving', async () => {
    const user = userEvent.setup();
    // Make setBrandPrimaryColour hang so saving stays true.
    mockSetBrandPrimaryColour.mockReturnValue(new Promise(() => {}));
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Save appearance'));

    expect(screen.getByLabelText('Save appearance')).toBeDisabled();
  });

  it('re-enables save button when API call fails', async () => {
    const user = userEvent.setup();
    mockSetBrandPrimaryColour.mockRejectedValue(new Error('network error'));
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Save appearance'));

    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).not.toBeDisabled();
    });
  });

  it('calls setBrandPrimaryColour and setBrandStoreName with updated values on save', async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });

    // Change colour via fireEvent.change (not user.type) so normaliseHex
    // gets the complete hex value in one call.
    const hexInput = screen.getByLabelText('Colour hex value') as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: '#aabbcc' } });

    // Save.
    await user.click(screen.getByLabelText('Save appearance'));

    await waitFor(() => {
      // RED (round AD): token must flow through the updated-values path too.
      expect(mockSetBrandPrimaryColour).toHaveBeenCalledWith('tok-appearance', '#aabbcc');
    });
  });

  // ── Embedded mode ──────────────────────────────────────────────

  it('uses colour prop in embedded mode', () => {
    render(<AppearanceSettings embedded colour="#ff0000" storeName="Embedded" />);

    const colourInput = screen.getByLabelText('Primary colour picker') as HTMLInputElement;
    expect(colourInput.value).toBe('#ff0000');
  });

  it('uses storeName prop in embedded mode', () => {
    render(<AppearanceSettings embedded colour="#ff0000" storeName="Embedded Store" />);

    const storeNameInput = document.getElementById('store-name-display') as HTMLInputElement;
    expect(storeNameInput.value).toBe('Embedded Store');
  });

  it('calls onColourChange prop when colour changes in embedded mode', async () => {
    const onColourChange = vi.fn();
    render(
      <AppearanceSettings
        embedded
        colour="#ff0000"
        storeName="Test"
        onColourChange={onColourChange}
      />,
    );

    // Embedded mode is prop-driven — use fireEvent.change to set the exact value.
    fireEvent.change(screen.getByLabelText('Colour hex value'), {
      target: { value: '#00ff00' },
    });

    expect(onColourChange).toHaveBeenCalledWith('#00ff00');
  });

  it('calls onStoreNameChange prop when name changes in embedded mode', async () => {
    const onStoreNameChange = vi.fn();
    render(
      <AppearanceSettings
        embedded
        colour="#ff0000"
        storeName="Test"
        onStoreNameChange={onStoreNameChange}
      />,
    );

    fireEvent.change(document.getElementById('store-name-display')!, {
      target: { value: 'New Name' },
    });

    expect(onStoreNameChange).toHaveBeenCalledWith('New Name');
  });

  // ── Accent palette ─────────────────────────────────────────────

  it('applies accent palette on colour change', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });

    const hexInput = screen.getByLabelText('Colour hex value') as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: '#334455' } });

    expect(mockDeriveAccentPalette).toHaveBeenCalledWith('#334455');
    expect(mockApplyAccentPalette).toHaveBeenCalled();
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it('loads brand settings on mount in non-embedded mode', async () => {
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(mockGetBrandSettings).toHaveBeenCalled();
    });
  });

  it('does not load brand settings in embedded mode', () => {
    render(<AppearanceSettings embedded colour="#ff0000" storeName="Test" />);
    expect(mockGetBrandSettings).not.toHaveBeenCalled();
  });
});

  // ── Follow-theme sentinel (round AH) ─────────────────────────────

  it('treats empty loaded colour as follow-theme: shows theme primary, not a stale hex', async () => {
    // jsdom resolves tokens.css custom props to '' — falls back to
    // DEFAULT_COLOUR, never to the old hardcoded initial state.
    mockGetBrandSettings.mockResolvedValue({ ...defaultBrandResponse, primary_colour: '' });
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Colour hex value')).toBeInTheDocument();
    });
    const hexInput = screen.getByLabelText('Colour hex value') as HTMLInputElement;
    expect(hexInput.value).toBe('#147EFB');
    // Reset control becomes the follow-theme (sun) indicator.
    expect(screen.getByLabelText('Following theme colour — pick a colour to override')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reset colour to default')).not.toBeInTheDocument();
  });

  it('clear button restores follow-theme: clears palette and saves empty colour', async () => {
    mockGetBrandSettings.mockResolvedValue({ ...defaultBrandResponse, primary_colour: '#ff0000' });
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Reset colour to default')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByLabelText('Reset colour to default'));

    expect(mockClearAccentPalette).toHaveBeenCalled();
    // Instant local state → null (hex shows theme primary via mock).
    expect(screen.getByLabelText('Following theme colour — pick a colour to override')).toBeInTheDocument();
  });

  it('save with follow-theme persists the empty sentinel', async () => {
    mockGetBrandSettings.mockResolvedValue({ ...defaultBrandResponse, primary_colour: '' });
    render(<AppearanceSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText('Save appearance')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByLabelText('Save appearance'));

    await waitFor(() => {
      expect(mockSetBrandPrimaryColour).toHaveBeenCalledWith('tok-appearance', '');
    });
  });