/**
 * Shared money formatting for the sales payment surface (features/sales/payment).
 *
 * Canonical implementations now reside in `@/types/domain` so they are uniformly
 * available across all workspaces and shells. Re-exported here for existing callers.
 */

export {
  minorUnitsToInputString,
  formatMoneyInput,
  parseMoneyInput,
} from '@/types/domain';
