# User Guide — kasir.mu

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (2 findings) · first stamp this page ever carried · verified against code: the PIN lockout really is 3 failed attempts in a 60 s window per account (apps/desktop-client/src/commands/auth.rs:169-171, max_attempts: 3 at line 215), with two further tiers the guide sensibly omits — 10 per device and 30 globally, both 60 s; the session lock really is 5 minutes (ui/src/hooks/useIdleTimer.ts DEFAULT_MINUTES = 5); the KDS SLA thresholds are now stated correctly (see KDS step 5). Repaired: the KDS colour line merged red (>=10 min) with urgent (>=15 min), and the footer read "Last audited: 2026-08-08 by docs-auditor (repairs applied)" — ISO with a colon, which matches no footer pattern, so detect.sh and check-audit-stamps.py both saw an unstamped file while a human saw an audited one. A footer is only machine-read if it has the machine's shape. NOTE for the next auditor: setAutoLockMinutes() is exported from useIdleTimer.ts, unit-tested with 1-120 clamps, and called by NO production UI — only the E2E suite writes auto-lock-minutes (0.25 for a 15 s lock). The idle timeout is therefore not user-configurable today, and "5 minutes" is correct as shipped; do not "repair" this line into promising a Settings control that does not exist. -->

## Login

1. Enter your **username** on the login screen
2. Tap your **PIN** on the number pad
3. Select your **workspace** (Store POS, KDS, Inventory, etc.)

> If you enter the wrong PIN 3 times within 60 seconds, your account is temporarily locked with a backoff timer (retry-after shown on screen; backoff can grow up to an hour).

## Point of Sale (POS)

### Making a Sale

1. **Add items**: Tap a product card, or scan a barcode
2. **Adjust quantity**: Tap the item in the cart, use +/- buttons
3. **Apply discounts** (if enabled): Select a promotion from the discount menu
4. **Pay**: Tap the **Pay** button

### Payment Methods

- **Cash**: Enter amount tendered → automatic change calculation
- **Card**: Swipe/tap/insert → terminal processes automatically
- **QRIS**: Customer scans the QR code on their phone
- **Split payment**: Select multiple tender types for a single sale

### After Payment

- **Print receipt**: Tap **Print** to send to the receipt printer
- **Skip receipt**: Tap **Skip** to close without printing
- A receipt preview shows before printing — confirm or cancel

### Voiding a Sale

1. Go to **Sales History**
2. Find the sale, tap **Void**
3. Confirm — the sale is marked voided (refund if paid)

## Product Lookup

- Tap the **search bar** to search by name, SKU, or barcode
- Scroll through the product grid — grouped by category
- Tap a product to see details: price, stock level, variants

## KDS (Kitchen Display)

For kitchen staff:

1. Select **KDS** workspace
2. View incoming orders as **ticket cards**
3. Tap a ticket to **acknowledge** (mark as in progress)
4. Tap again to **complete** the order
5. Ticket colors indicate age: 🟢 under 5 min · 🟡 5–10 min · 🔴 **10 min and over** · plus a red urgent badge on top of the red background at **15 min**.
   Four states, not three — the line used to read "🔴 ≥15min (overdue/urgent)", which
   merged the red threshold with the urgent one and left 10–15 min unassigned. Source:
   `ui/src/features/kds/hooks/useTicketSla.ts` (`yellowAtSec: 300`, `redAtSec: 600`,
   urgent at 900 s). These are **defaults**: both thresholds are configurable per board
   from the KDS settings panel, so a kitchen that has changed them will not match the
   numbers above.

## Tablet Usage

The tablet interface is optimized for touch:
- **Swipe left** on cart → open payment
- **Swipe right** on payment → back to cart
- **Pull down** on lists to refresh
- All buttons are ≥ 44px for comfortable tapping

## Session Lock

- The screen locks after 5 minutes of inactivity
- Enter your PIN to unlock and resume where you left off
- Lock screen shows your name and workspace

---

> last audited 08-09-26 by docs-auditor
