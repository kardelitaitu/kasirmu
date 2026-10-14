# `courseFiringEnabled`: checked, and NOT a defect (round 98)

## Why this was checked

`course-bar-render-gates.md` (round 97) measured that on `restaurant-pos`, with a cart
line present and the CartPanel rendering in landscape, the course bar still did not
appear. The remaining input was `courseFiringEnabled !== false` (`CartPanel.tsx:961`), and
`PosScreen.tsx:1223` resolves an unset key to `false`:

```ts
getSettingScoped(sessionToken || null, 'restaurant.course_firing')
  .then((raw) => { if (stale()) return; setCourseFiringEnabled(raw === 'true'); })
```

An unset key leaves the bar hidden. That looked like the defect.

## It is not

Three independent facts make it coherent, and they were checked in this order:

1. **The declared default agrees.** `restaurantSettingsModel.ts:60` is `courseFiring:
   false`. So the POS and the settings screen describe the same state — an unset key is
   OFF in both.
2. **A guard pins the agreement.** `restaurantSettingDefaultsAgree.test.ts` handles this
   key in `NON_QUERY_GATES` (:92-107) and says so at :83-84: *"`courseFiring` reads
   `raw === 'true'`, so an unset key yields an explicit `false` (not `null`), and its
   settings default is `false` — agreement by a different route."* It passes (6 tests).
3. **The comment is about the INITIAL value, and is accurate.** `PosScreen.tsx:352-355`
   says the state *"defaults to the workspace check alone until the setting loads"* —
   that is `useState<boolean | null>(null)`, and `CartPanel`'s `!== false` gate shows the
   bar for `null`. The comment is not claiming anything about the resolved value.

So the third gate on the failing case is **by design**, and the case's premise is wrong:
it never sets `restaurant.course_firing`, so the bar is correctly hidden and the
assertion can never hold.

## The one thing worth noting

`courseFiring` is the ONLY cart gate whose unset value is OFF. `guestCount`,
`orderTypePrompt` and `saveTab` all resolve an unset key to ON, and
`restaurantSettingsModel.ts:51-56` records why — *"a settings outage must not remove a
POS capability"* — after the guest-count bug where the screen "described something the
POS was not doing".

`courseFiring: false` was left as-is, so coursing is the one restaurant capability that
an unset key removes. **That is a product decision, not a bug**, and it is consistent
across the screen and the runtime — but it is the reason the failing case's assertion is
unreachable, and a reader comparing the two comments could reasonably conclude otherwise.

## The three gates, together

| Gate | Effect on the failing case |
|---|---|
| `enabled: activeWorkspace !== 'restaurant-pos'` (PosScreen.tsx:567) | a scan cannot add a line |
| `!isPortraitRestaurant` (PosScreen.tsx:1789) | no CartPanel, so no bar (jsdom is landscape, so this one is satisfiable) |
| `courseFiringEnabled !== false` (CartPanel.tsx:961) | unset key means OFF, so the bar is hidden |

A repair has to satisfy all three: seed the cart (not scan), and set
`restaurant.course_firing` to `'true'` in the mock. The third was the missing piece.