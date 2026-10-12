import { loggedInvoke } from '@/utils/logged-invoke';

export interface QrisListenerStatus {
  isSupported: boolean;
  isEnabled: boolean;
  isConnected: boolean;
  platform: string;
}

export interface QrisRecentPayment {
  provider: string;
  amountMinor: number;
  amountFormatted: string;
  rawText: string;
  packageName: string;
  timestampMs: number;
  senderName?: string | null;
}

export interface SimulateQrisNotificationArgs {
  packageName?: string;
  title?: string;
  text: string;
  timestampMs?: number;
}

export async function getQrisListenerStatusScoped(sessionToken: string): Promise<QrisListenerStatus> {
  return loggedInvoke<QrisListenerStatus>('get_qris_listener_status_scoped', { sessionToken });
}

export async function openQrisListenerSettingsScoped(sessionToken: string): Promise<void> {
  return loggedInvoke<void>('open_qris_listener_settings_scoped', { sessionToken });
}

export async function simulateQrisNotificationScoped(
  sessionToken: string,
  args: SimulateQrisNotificationArgs,
): Promise<QrisRecentPayment | null> {
  return loggedInvoke<QrisRecentPayment | null>('simulate_qris_notification_scoped', { sessionToken, args });
}
