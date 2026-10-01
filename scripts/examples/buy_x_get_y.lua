-- Buy X Get Y Promotion Script for kasir.mu Lua Engine
-- Example: Buy 2 items of SKU "COFFEE-01", get 1 free (100% discount on 3rd item)

function apply_promotion(cart)
    local target_sku = "COFFEE-01"
    local required_qty = 2
    local total_discount = 0

    for _, line in ipairs(cart.lines) do
        if line.sku == target_sku then
            local eligible_free_items = math.floor(line.quantity / (required_qty + 1))
            if eligible_free_items > 0 then
                total_discount = eligible_free_items * line.unit_price_minor
            end
        end
    end

    return {
        discount_amount_minor = total_discount,
        description = "Buy 2 Get 1 Free (Coffee Special)"
    }
end
