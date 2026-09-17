/**
 * LoyaltyTenderPanel - the loyalty / points-redeem block of PaymentModal.
 *
 * Markup only, in the shape ./CashTenderPanel, ./CardTenderPanel,
 * ./QrisTenderPanel and ./SplitTenderRows set: the balance read-out (points plus
 * their money value), the Use Points affordance, and the active redeem row
 * (label, constrained number input, the "/ balance" hint, the discount read-out
 * and Cancel). No state, no effect, no memo and no IPC moved in, and none
 * created here - useLocalization is the only hook this file reads.
 *
 * EVERY LOYALTY ATOM STAYED IN THE SHELL, deliberately and completely, because
 * loyaltyDiscount is consumed OUTSIDE this region. The five useState
 * (loyaltyAccount, redeemPoints, loyaltyDiscount, pointsToRedeem,
 * pointsWorthMinor) and all THREE effects behind them - the account fetch, the
 * pointsWorthMinor valuation of the BALANCE, and the loyaltyDiscount valuation of
 * pointsToRedeem WITH ITS CLAMP against totalMinor - are the shell's. The
 * discount is read by ./useTenderMath as an input (its effectiveTotal is what the
 * total row renders), by the total row's own loyaltyDiscount > 0n branch, by
 * sufficient (hence by canComplete and the Settle button), and by the
 * redeem-on-settle call on BOTH settle paths. A panel-local copy of that atom
 * would leave every label in here rendering while Total Due, the tender math and
 * the redemption payload quietly stopped moving - so loyaltyDiscount arrives as a
 * read-only VALUE, already clamped, and nothing in this file writes it: the two
 * places the region mutated state inline (redeem start, and redeem cancel, which
 * resets redeemPoints, pointsToRedeem AND loyaltyDiscount together) are the
 * shell's handlers, called out and passed back in as props. Nothing in this file
 * decides whether the sale may settle.
 *
 * The feature/account gate is passed IN as `loyaltyOffered`, which is the shape
 * ./CardTenderPanel takes for its own gate (`terminalOffered` :42, `if
 * (!terminalOffered) return null` :64) and ./QrisTenderPanel for `qrisAllowed`:
 * the shell reads useFeatures() once for the whole modal and hands the verdict
 * down, so this file calls no hook - and, unlike the first cut of this panel,
 * it can refuse itself. That refusal is the point. The panel used to render
 * whenever it was mounted at all, leaving the shell's mount gate - today
 * PaymentModal.tsx:1629, `{loyaltyLicensed && loyaltyAccount && (` - as the ONLY
 * thing standing between an unlicensed tenant and a Points row, so a second
 * caller inherited no protection from it. `loyaltyLicensed` is the modal's
 * `isEnabled(FEATURES.LOYALTY_PROGRAM)` read, declared once at
 * PaymentModal.tsx:283 and shared by that gate, the loyalty fetch that now checks
 * it before calling the bridge, and the prop below. The modal keeps its own gate
 * (it also performs the narrowing that lets `points` arrive as a plain number).
 *
 * WHAT THAT DOES AND DOES NOT GUARANTEE, precisely. There is exactly ONE
 * production caller today, the JSX at PaymentModal.tsx:1630, and it passes
 * `loyaltyOffered={loyaltyLicensed && !!loyaltyAccount}` - a literal restatement
 * of its own enclosing condition - so on today's paths the `!loyaltyOffered`
 * return below is UNREACHABLE from the modal. It stays because it is the default
 * a second caller gets for free, and PaymentModalLoyalty's L14 mounts the panel
 * directly to prove the branch works rather than merely exists. The compile-time
 * half is narrower than the sentence it replaces: `loyaltyOffered` is required
 * with no default, so a new caller must answer the LICENSING question, but
 * TypeScript was never what carried the ACCOUNT condition - `points` is required
 * and non-nullable, so a caller cannot construct these props at all without an
 * account already in hand. The prop adds the flag; the account was structural.
 *
 * Nullable props: `pointsWorthMinor` is `number | null` (null while the
 * balance's valuation is pending, rendered as the ellipsis at :145) and that is
 * the ONLY nullable value here; every other prop is required and non-null.
 * Nullability was deliberately not extended to carry the gate: `points: number
 * | null` would express only "no account", never "unlicensed", so it would be a
 * guard that looks defensive and is not."
 *
 * Money stays i64 minor units / Money end to end. Both figures this file renders
 * still go through the SAME production call they used in the page -
 * formatMoney({ minor_units: ..., currency } as Money) from @/types/domain, over
 * pointsWorthMinor and over Number(loyaltyDiscount) - no new helper, no
 * re-derivation, no float arithmetic, nothing rounded. points and pointsToRedeem
 * are POINTS, never money, and are never formatted as currency. The clamp that
 * keeps a rich conversion from out-discounting the bill is NOT here and must not
 * be re-implemented here: this file displays the value it is given.
 *
 * The one piece of logic that DID cross is the input's whole-non-negative-number
 * guard, byte-for-byte with its comment: it rejects a fractional or negative
 * in-progress keystroke instead of truncating it, then calls the shell's setter
 * with a number. It writes points, not money, and it owns no state.
 *
 * Strings: l10n comes from the Fluent context here, as it does in the sibling
 * panels, and no new key is introduced - payment-loyalty-points-label,
 * payment-loyalty-use-points, payment-loyalty-points-aria,
 * payment-loyalty-discount-label and payment-cancel are the five ids the page
 * already used, each defined in BOTH shared-ui/locales/sales.ftl and
 * shared-ui/locales/sales.id.ftl. Both Localized render paths are preserved: the
 * element form (the two buttons) and the vars form (the discount read-out),
 * beside the requiredLocalized and getString reads exactly where they were.
 *
 * Class names are unchanged and are still styled by ../PaymentModal.css, which
 * the page imports once for the whole modal - the same arrangement the four
 * sibling panels rely on, and why no CSS file is in this change set. Three of
 * them are queried by CLASS ONLY, with no accessible name to fall back on. The
 * census at this writing is EIGHT, counting nodes whose only test route is a
 * class selector: .payment-loyalty-label, .payment-loyalty-value,
 * .payment-loyalty-discount-label, .payment-loyalty-section,
 * .payment-loyalty-active, .payment-loyalty-input-label,
 * .payment-loyalty-input-hint, .payment-loyalty-balance. (The two buttons and
 * the number input are not on it - they also answer to role/accessible-name
 * queries.) Reproduce with: for each class in
 * `grep -oE 'payment-loyalty-[a-z-]+' <this file> | sort -u`, count
 * `.payment-loyalty-...` occurrences in the four PaymentModal*.test.tsx suites;
 * this line was three before 87b4dc8b0 and that was already wrong. Renaming any
 * of the eight reddens a characterization case without meaning anything real,
 * so do not rename them.
 *
 * The JSX below is the page's lines verbatim, at the page's own indentation; only
 * the values and handlers named in the props differ.
 */
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { formatMoney, type Money } from '@/types/domain';

export interface LoyaltyTenderPanelProps {
  /**
   * The shell's `isEnabled(FEATURES.LOYALTY_PROGRAM) && !!loyaltyAccount`.
   * False, or a caller that never asks the question, renders NOTHING - the
   * panel gates itself so a second call site cannot mount a loyalty UI on an
   * unlicensed tenant. Required, no default: see the header.
   */
  loyaltyOffered: boolean;
  /** loyaltyAccount.account.points: the balance shown, the input max, the hint. */
  points: number;
  /** pointsWorthMinor - value of the BALANCE, null while its valuation pending. */
  pointsWorthMinor: number | null;
  /** total.currency: the unit both money read-outs format in. */
  currency: string;
  /** The shell's redeemPoints: which affordance renders. */
  redeemPoints: boolean;
  /** The shell's pointsToRedeem: the input's value. */
  pointsToRedeem: number;
  /** The shell's loyaltyDiscount in minor units, ALREADY CLAMPED to the payable. */
  loyaltyDiscount: bigint;
  /** The shell's redeem start: setRedeemPoints(true) + seed from the balance. */
  onRedeemStart: () => void;
  /** The shell's setPointsToRedeem. */
  onPointsChange: (points: number) => void;
  /** The shell's redeem cancel: resets redeemPoints, pointsToRedeem AND discount. */
  onRedeemCancel: () => void;
}

/** The loyalty balance row, the Use Points affordance and the active redeem row. */
export default function LoyaltyTenderPanel({
  loyaltyOffered,
  points,
  pointsWorthMinor,
  currency,
  redeemPoints,
  pointsToRedeem,
  loyaltyDiscount,
  onRedeemStart,
  onPointsChange,
  onRedeemCancel,
}: LoyaltyTenderPanelProps) {
  const { l10n } = useLocalization();

  if (!loyaltyOffered) return null;

  return (
              <div className="payment-loyalty-section">
                <div className="payment-loyalty-balance">
                  <span className="payment-loyalty-label">
                    {requiredLocalized(l10n, 'payment-loyalty-points-label')}: {points}
                  </span>
                  <span className="payment-loyalty-value">
                    {pointsWorthMinor !== null
                      ? `(${formatMoney({ minor_units: pointsWorthMinor, currency } as Money)})`
                      : '…'}
                  </span>
                </div>
                {points > 0 && !redeemPoints && (
                  <Localized id="payment-loyalty-use-points">
                    <button
                      type="button"
                      className="payment-loyalty-redeem-btn"
                      onClick={onRedeemStart}
                    >
                      <span>Use Points</span>
                    </button>
                  </Localized>
                )}
                {redeemPoints && (
                  <div className="payment-loyalty-active">
                    <div className="payment-loyalty-input-row">
                      <Localized id="payment-loyalty-points-label"><span className="payment-loyalty-input-label">Points</span></Localized>
                      <input
                        type="number"
                        className="payment-loyalty-input"
                        value={pointsToRedeem}
                        onChange={(e) => {
                          // Whole number only — ignore fractional in-progress input
                          // instead of silently truncating it via parseInt.
                          const v = Number(e.target.value);
                          if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                            onPointsChange(e.target.value === '' ? 0 : v);
                          }
                        }}
                        min={0}
                        max={points}
                        aria-label={l10n.getString('payment-loyalty-points-aria')}
                      />
                      <span className="payment-loyalty-input-hint">
                        / {points}
                      </span>
                    </div>
                    <span className="payment-loyalty-discount-label">
                      <Localized id="payment-loyalty-discount-label" vars={{ amount: formatMoney({
                        minor_units: Number(loyaltyDiscount),
                        currency,
                      } as Money) }}>
                        <span>{'Discount: -{ $amount }'}</span>
                      </Localized>
                    </span>
                    <Localized id="payment-cancel">
                      <button
                        type="button"
                        className="payment-loyalty-cancel-btn"
                        onClick={onRedeemCancel}
                      >
                        <span>Cancel</span>
                      </button>
                    </Localized>
                  </div>
                )}
              </div>
  );
}
