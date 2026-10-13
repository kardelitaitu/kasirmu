# The credential contradiction does not exist: the save path sanitizes (round 125)

## What three earlier records claimed

`rail-parameters-unread.md` (round 121):

> *(merchantId/serverKey are CREDENTIALS, and `local-payment.ts:17-18` says "no gateway
> credential can appear in `parameters` (the backend write path rejects)" — so the screen
> writes them to a field the backend is documented to REJECT.*

Rounds 123 and 124 repeated the framing. **It is wrong.**

## What is actually true

`updateRailParams` (`RestaurantPaymentsScreen.tsx:565-580`) does not write to the backend at
all. It merges into local component state:

```ts
setDrafts((prev) => { ... return { ...d, parameters: JSON.stringify(merged) }; });
```

The backend call happens once, in `handleSave` (`:739-786`), and it **sanitizes first** —
`:746` says so in as many words ("Sanitize parameters so credentials are never stored in
market rails"):

| Rail | Parameters that reach `setLocalPaymentMethodsScoped` |
|---|---|
| `midtrans` | `channels` only (`:756-765`) |
| `stripe` | `reader`, `currency` only (`:767-777`) |
| all others | passed through unchanged |

The credentials go where the architecture requires — `setPaymentGatewayConfigScoped`
(`:789-809`), the gateway axis, encrypted at rest.

## So the guard is satisfied, not violated

Checked the Rust side to be sure the sanitizer is sufficient:

* `payment_methods.rs:40-48` — FORBIDDEN_PARAMETER_FRAGMENTS = credential, secret, api_key,
  apikey, token, password, private_key;
* `:56-82` `validate_parameters_bag` rejects any key containing one, case-insensitively;
* `:137` applies it per rail, inside the write's validation loop.

`stripe.secretKey` would be rejected — and it never reaches that function. The scan I ran
that flagged it counted the **local draft** writes, not the submitted payload, which is why
it produced a false positive.

## The architecture doc already said this

`apps/desktop-tauri/src/commands/local_payment.rs:15-28` is explicit:

* rails (`*_payment_methods*`) are MARKET facts — "a rail carries no secrets";
* credentials (`*_payment_gateway*`) are the opposite by purpose, plaintext in `config_json`,
  encrypted at rest under `PAYMENT_GATEWAY_AT_REST_DOMAIN`;
* "a credential reaching this module is EXPECTED on the gateway axis and a DEFECT on the
  rail axis. What is not expected is the two being documented as one thing."

That last sentence is the one the three records should have read. They documented the two as
one thing.

## What remains true from rounds 120-124

The **consumption** finding is untouched: `channels`, `reader`, `currency`, `env`,
`mode` (stripe), `nmid`, `surcharge`, `defaultTerminalId` reach the rail and nothing acts on
them. That is a real inventory of settings without consumers — it is just not a security or
data-loss problem, and three records implied it was.

`presets` was wired in round 122. `mode` (qris) was characterised correctly in round 124 as a
third control over a per-sale decision.

## The method lesson, twice in five rounds

Round 121 concluded "no reader" from a `railParam(` search and was corrected by round 123.
Round 121 also concluded "the backend rejects this write" from the same kind of grep — a
pattern match on `updateRailParams` — without following the value to the wire. This round
followed it, and the claim does not survive.

**A grep finds where a string appears; it cannot tell you which of those sites is the write
path.** The two errors have the same root, and the check that catches both is reading the
function that actually performs the side effect.

## Verified

| Item | Result |
|---|---|
| `updateRailParams` | local `setDrafts` only, `:565-580` |
| `handleSave` sanitizer | `:746-777`, midtrans -> channels, stripe -> reader+currency |
| Credentials | `setPaymentGatewayConfigScoped`, `:789-809` |
| Backend guard | `payment_methods.rs:40-82`, applied `:137` |
| Credential reaching the rail write | **none** |
| Tree | no source changed this round |