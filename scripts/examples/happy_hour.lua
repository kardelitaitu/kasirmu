-- Happy Hour Pricing Script for kasir.mu Lua Engine
-- Example: Apply a 15% discount to all items between 14:00 and 17:00 UTC.
--
-- Hook: apply_discount
-- Uses os.date("!*t") to get UTC time. Outside happy hours,
-- returns nil so no discount is applied.
--
-- NOTE: In the sandboxed runtime os.date and os.time are available
-- because they are read-only. os.execute and os.rename are stripped.

local HAPPY_HOUR_START = 14  -- 2 PM UTC
local HAPPY_HOUR_END   = 17  -- 5 PM UTC
local DISCOUNT_PERCENT = 15

function apply_discount(_lines)
    local now = os.date("!*t")  -- UTC time table
    local hour = now.hour

    if hour >= HAPPY_HOUR_START and hour < HAPPY_HOUR_END then
        return {
            percent = DISCOUNT_PERCENT,
            label = "Happy Hour (15%)"
        }
    end

    return nil
end
