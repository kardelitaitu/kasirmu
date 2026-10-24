import { useKeyRotationReminder } from '@/hooks/useKeyAge';

/**
 * Mounts the encryption-key rotation reminder once, app-wide.
 *
 * `useKeyRotationReminder` existed and was tested, but NO file outside its own
 * module and its test ever rendered it -- so the hook's two toasts could never
 * reach a user. Its messages were nonetheless localized (2026-10-25), which
 * translated a sentence nobody could see. This component is the missing mount.
 *
 * Why a null-rendering component instead of calling the hook in `AppShell`:
 * `AppProviders` already establishes this exact pattern for app-wide surfaces
 * that need toast or locale context but no DOM (`GlobalErrorReporter`,
 * `IpcErrorReporter`, `CurrencyWorkspaceSync`, `OrgLocaleSync`). Following it
 * keeps every always-on effect in one place instead of scattering them into
 * each shell -- and the desktop and tablet shells would otherwise need their
 * own copy, which is how one of them gets forgotten.
 *
 * MUST sit inside `ToastProvider` and inside `LocaleProvider`; it reads both.
 */
export function KeyRotationReminder() {
  useKeyRotationReminder();
  return null;
}
