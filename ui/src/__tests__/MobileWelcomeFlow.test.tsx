import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from './test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import { MobileWelcomeFlow } from '@/features/setup/mobile';

describe('MobileWelcomeFlow (Figma 720x1280 Mobile Setup Wizard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the initial Welcome Screen (Frame 3:142) with branding and CTAs', () => {
    renderWithFluentSync(<MobileWelcomeFlow initialScreen="welcome" />, settingsFtl);

    expect(screen.getByTestId('mobile-welcome-screen')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-welcome-logo')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-welcome-start-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-welcome-signup-btn')).toBeInTheDocument();
  });

  it('navigates from Welcome Screen to Setup Wizard Hub (Frame 3:4)', () => {
    renderWithFluentSync(<MobileWelcomeFlow initialScreen="welcome" />, settingsFtl);

    fireEvent.click(screen.getByTestId('mobile-welcome-start-btn'));

    expect(screen.getByTestId('mobile-setup-hub')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-hub-google-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-hub-email-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-hub-qr-btn')).toBeInTheDocument();
  });

  it('navigates back from Hub to Welcome Screen', () => {
    renderWithFluentSync(<MobileWelcomeFlow initialScreen="hub" />, settingsFtl);

    fireEvent.click(screen.getByTestId('mobile-hub-back-btn'));

    expect(screen.getByTestId('mobile-welcome-screen')).toBeInTheDocument();
  });

  it('navigates to Google Auth View (Frame 3:15) and handles selection', () => {
    const onProvisioned = vi.fn();
    renderWithFluentSync(
      <MobileWelcomeFlow initialScreen="hub" onProvisioned={onProvisioned} />,
      settingsFtl,
    );

    fireEvent.click(screen.getByTestId('mobile-hub-google-btn'));

    expect(screen.getByTestId('mobile-google-auth-view')).toBeInTheDocument();
    expect(screen.getByTestId('google-account-joko')).toBeInTheDocument();
    expect(screen.getByTestId('google-account-valentino')).toBeInTheDocument();

    // Selecting an account triggers provision callback
    fireEvent.click(screen.getByTestId('google-account-joko'));
    expect(onProvisioned).toHaveBeenCalledTimes(1);
  });

  it('navigates to Email Auth View (Frame 3:26) and submits credentials', () => {
    const onProvisioned = vi.fn();
    renderWithFluentSync(
      <MobileWelcomeFlow initialScreen="hub" onProvisioned={onProvisioned} />,
      settingsFtl,
    );

    fireEvent.click(screen.getByTestId('mobile-hub-email-btn'));

    expect(screen.getByTestId('mobile-email-auth-view')).toBeInTheDocument();

    const emailInput = screen.getByTestId('mobile-email-input');
    const passwordInput = screen.getByTestId('mobile-password-input');
    const submitBtn = screen.getByTestId('mobile-email-submit-btn');

    fireEvent.change(emailInput, { target: { value: 'owner@kasirmu.com' } });
    fireEvent.change(passwordInput, { target: { value: 'Secret123!' } });

    fireEvent.click(submitBtn);
    expect(onProvisioned).toHaveBeenCalledTimes(1);
  });

  it('navigates to QR Code View (Frame 3:35) and supports copy link', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    renderWithFluentSync(
      <MobileWelcomeFlow
        initialScreen="hub"
        pairingUrl="https://kasir.mu/login?=TEST-1234"
        pairingCode="TEST-1234"
      />,
      settingsFtl,
    );

    fireEvent.click(screen.getByTestId('mobile-hub-qr-btn'));

    expect(screen.getByTestId('mobile-qr-pairing-view')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-qr-reticle-box')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-qr-link-text')).toHaveTextContent('TEST-1234');

    const copyBtn = screen.getByTestId('mobile-qr-copy-btn');
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('https://kasir.mu/login?=TEST-1234');
  });

  it('disables signup button when onSignUp is not provided, enables when provided', () => {
    const { unmount } = renderWithFluentSync(
      <MobileWelcomeFlow initialScreen="welcome" />,
      settingsFtl,
    );
    expect(screen.getByTestId('mobile-welcome-signup-btn')).toBeDisabled();
    unmount();

    const onSignUp = vi.fn();
    renderWithFluentSync(
      <MobileWelcomeFlow initialScreen="welcome" onSignUp={onSignUp} />,
      settingsFtl,
    );
    const signupBtn = screen.getByTestId('mobile-welcome-signup-btn');
    expect(signupBtn).not.toBeDisabled();
    fireEvent.click(signupBtn);
    expect(onSignUp).toHaveBeenCalledTimes(1);
  });

  it('renders custom google accounts when provided', () => {
    const onProvisioned = vi.fn();
    renderWithFluentSync(
      <MobileWelcomeFlow
        initialScreen="google"
        onProvisioned={onProvisioned}
        googleAccounts={[
          {
            name: 'Custom Admin',
            email: 'admin@kasirmu.com',
            avatarColor: '#6366f1',
            testId: 'google-account-admin',
          },
        ]}
      />,
      settingsFtl,
    );

    expect(screen.getByTestId('google-account-admin')).toBeInTheDocument();
    expect(screen.getByText('Custom Admin')).toBeInTheDocument();
    expect(screen.getByText('admin@kasirmu.com')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('google-account-admin'));
    expect(onProvisioned).toHaveBeenCalledTimes(1);
  });
});

