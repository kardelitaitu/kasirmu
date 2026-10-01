import { loggedInvoke } from '@/utils/logged-invoke';

/**
 * A payment gateway configuration row (mirrors `kasirmu_core::db::payment_gateways::PaymentGatewayConfig`).
 */
export interface PaymentGatewayConfig {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  /** Decrypted gateway configuration JSON string. */
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

/** Arguments to create or update a payment gateway configuration. */
export interface SetPaymentGatewayArgs {
  gatewayName: string;
  isActive: boolean;
  configJson: string;
}

/**
 * Get configuration for a single payment gateway (ADR #7 scoped, gated `settings:read`).
 */
export const getPaymentGatewayConfigScoped = (
  sessionToken: string,
  gatewayName: string,
): Promise<PaymentGatewayConfig | null> =>
  loggedInvoke<PaymentGatewayConfig | null>('get_payment_gateway_config_scoped', {
    sessionToken,
    gatewayName,
  });

/**
 * List all configured payment gateways for the store (gated `settings:read`).
 */
export const listPaymentGatewaysScoped = (
  sessionToken: string,
): Promise<PaymentGatewayConfig[]> =>
  loggedInvoke<PaymentGatewayConfig[]>('list_payment_gateways_scoped', {
    sessionToken,
  });

/**
 * Save or update payment gateway configuration (gated `settings:edit`).
 */
export const setPaymentGatewayConfigScoped = (
  sessionToken: string,
  args: SetPaymentGatewayArgs,
): Promise<PaymentGatewayConfig> =>
  loggedInvoke<PaymentGatewayConfig>('set_payment_gateway_config_scoped', {
    sessionToken,
    args,
  });

/**
 * Delete a payment gateway configuration (gated `settings:edit`).
 */
export const deletePaymentGatewayScoped = (
  sessionToken: string,
  gatewayName: string,
): Promise<boolean> =>
  loggedInvoke<boolean>('delete_payment_gateway_scoped', {
    sessionToken,
    gatewayName,
  });
