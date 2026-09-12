//! Display-label maps shared by an analytics card and its CSV exporter.

/**
 * Fluent message ids for the payment methods the backend reports. The CSV
 * exporter and the payments card both resolve these, so the map lives here
 * rather than in either one — a divergence would make the download's column
 * labels disagree with the on-screen legend.
 */
export const PAYMENT_NAMES: Record<string, string> = {
  cash: 'analytics-card-payments-cash',
  card: 'analytics-card-payments-card',
  qris: 'analytics-card-payments-qris',
  ewallet: 'analytics-card-payments-ewallet',
};

/**
 * Largest-remainder rounding of a set of percentages so the segments
 * always sum to exactly 100 instead of drifting from independent rounding.
 */
