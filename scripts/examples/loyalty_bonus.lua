-- Loyalty Bonus Script for kasir.mu Lua Engine
-- Example: Customers spending over 100,000 minor units (e.g. $100)
-- in a single transaction earn a 5% bonus on their next purchase.
--
-- Hook: apply_discount
-- Returns a discount percentage and a descriptive label when the
-- spending threshold is met. Small orders pass through with no bonus.

local BONUS_THRESHOLD_MINOR = 100000  -- $100.00 in USD minor units
local BONUS_PERCENT = 5

function apply_discount(lines)
    local total_minor = 0

    for _, line in ipairs(lines) do
        total_minor = total_minor + line.qty * line.unit_price_minor
    end

    if total_minor >= BONUS_THRESHOLD_MINOR then
        return {
            percent = BONUS_PERCENT,
            label = "Loyalty Bonus (5%)"
        }
    end

    return nil
end
