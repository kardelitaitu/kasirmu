-- Example plugin: Tuesday discount
-- Applied before every sale completes.

function apply_tuesday_discount(sale)
  local now = oz.get_time()
  if now.wday == 3 then
    oz.log("info", "Tuesday 10% discount applied")
    oz.apply_discount("cart", 10)
  end
end

oz.register_hook("sale.before_complete", "apply_tuesday_discount")
