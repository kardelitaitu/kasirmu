-- Minimum Order Enforcement Script for kasir.mu Lua Engine
-- Example: Reject any transaction where the total is less than
-- 25,000 minor units (e.g. $25.00 in USD). Returns a user-facing
-- error message explaining the minimum-order policy.
--
-- Hook: validate_order
--
-- NOTE: In the sandboxed runtime, os.date, os.time, string, and table
-- are available. os.execute, io, and other I/O globals are nil.

local MIN_ORDER_MINOR = 25000  -- $25.00 in USD minor units

function validate_order(lines, total_minor, currency)
    if total_minor < MIN_ORDER_MINOR then
        local shortfall = MIN_ORDER_MINOR - total_minor

        -- Build a human-readable currency prefix
        local prefix = ""
        if currency == "USD" then
            prefix = "$"
        elseif currency == "IDR" then
            prefix = "Rp"
        elseif currency == "EUR" then
            prefix = "€"
        else
            prefix = currency .. " "
        end

        local msg = string.format(
            "Minimum order is %s%.2f (short by %s%.2f)",
            prefix, MIN_ORDER_MINOR / 100,
            prefix, shortfall / 100
        )
        return { msg }
    end

    return {}
end
