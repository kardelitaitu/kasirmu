# kasir.mu Website Plan
<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Undated plan written in present tense, so its §10 Deployment rows read as current fact; corrected to what the workflows do today. Verified from the files: (a) the live website job is dev-ci.yml:137-163 — "Website Check + Build", needs changes, if needs.changes.outputs.website == 'true', steps asset hygiene / npm ci / playwright chromium (for Mermaid) / npm run check / npm test / npm run build and NOT a deploy; (b) git grep -l wrangler .github/workflows matches only website.yml.bak, so no live workflow deploys; (c) website/package.json:17 is the deploy route, "deploy": "bash ../scripts/wrangler-deploy.sh", which fails closed at scripts/wrangler-deploy.sh:42-43 when CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID are unset. FLAGGED, NOT FIXED (config, out of doc-repair scope): that npm script invokes bare bash, which root AGENTS.md records as resolving to WSL on this workstation and hanging or running the Linux node against Windows-built node_modules; the runbook records the same and gives the explicit Git-bash form. ALSO FLAGGED, NOT FIXED: the §0 blurb says "hosted on Cloudflare Pages" while §10 and website/wrangler.toml say Workers static assets — a contradiction internal to this plan, not a CI claim, so it is left for whoever owns the site. LEFT ALONE: the Pages-alternative note under §10 and all env-var semantics (verified against wrangler.toml bindings by the rows themselves, and untouched by this pass). -->

> Static marketing site hosted on Cloudflare Pages — two locales, Paddle checkout,
> tenant-email auth via the license server (PocketBase datastore on Northflank).

---

## 1. Overview

| Aspect | Detail |
|--------|--------|
| **Purpose** | Marketing site + pricing page + license purchase flow |
| **Locales** | `en` (global/international) and `id` (Indonesia) |
| **Hosting** | Cloudflare Pages (free tier) — static files only |
| **Checkout** | Paddle.js overlay (handles payments, tax, VAT, invoicing) |
| **Auth** | Tenant auth on the **license server** — email OTP **or** password, no new auth collection |
| **Database** | PocketBase (existing license-server datastore on Northflank) — **internal only**, the website never calls it directly |
| **Pricing** | Real tier enum `free` / `plus` / `pro` / `premium` / `enterprise` (subscription-tiers.md); annual default toggle; six Paddle prices pending |
| **Repo location** | `website/` directory in the monorepo |

> **Grounding:** everything in this plan maps to code that already exists
> (`apps/license-server/`, `crates/oz-core/src/subscription.rs`,
> `apps/license-server/pb_schema.json`). Sections marked **(new server work)**
> are endpoints the license server does not have yet — they must be built,
> not assumed.

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Astro** | Static-first, partial hydration, built-in i18n routing |
| Styling | **Tailwind CSS** | Fast to build, consistent design system |
| Checkout | **Paddle.js overlay** | No backend — Paddle handles tax, VAT, invoicing |
| Auth | **License server API (Go)** | Tenant identity already lives there; the Go router issues OTP sessions and already rate-limits |
| Hosting | **Cloudflare Pages** | Free, fast global CDN, auto deploys from Git |
| Analytics | Cloudflare Web Analytics | Free, privacy-friendly |

### Why auth goes through the license server, not PocketBase directly

The license server already runs PocketBase on Northflank with **four
collections**: `license_keys`, `tenants`, `subscriptions`, `tenant_machines`
(see `apps/license-server/pb_schema.json`). The customer's identity in this
system is the **`tenants` record** — `email` (unique), `phone`, and the
bcrypt-hashed `api_key` used by the POS client.

The plan's original `web_users` collection would create a **second, disjoint
auth system** for the same customer — the opposite of futureproof. Instead:

- the website account **is** the tenant;
- all browser traffic goes to the license server's Go router
  (`ratelimit.go`, CORS-controlled) — PocketBase is never exposed to the
  browser (its admin UI and `/api/collections/*` surface stay internal);
- authentication is the tenant record itself, with **two login modes**:
  email OTP (register-or-login) and password (set at signup or from the
  dashboard). Passwords are bcrypt-hashed on `tenants.password_hash`,
  reset via email OTP with a 7-day cooldown, and the POS `api_key` stays a
  separate server-issued credential (never a web password).

```
Website (Cloudflare Pages, static)
    │
    ├── Paddle.js checkout → payment processed
    │
    └── License Server API (Northflank, Go + PocketBase)   ← all new endpoints
        ├── POST /api/v1/web/request-otp     (new)  email → 6-digit code
        ├── POST /api/v1/web/verify-otp      (new)  email + code → session + subscription
        ├── POST /api/v1/web/me              (new)  Bearer → current tenant + subscription
        ├── POST /api/v1/web/logout          (new)  invalidate session
        └── POST /api/v1/paddle/webhook      (new)  Paddle events → mint key + subscription
            └── PocketBase (internal): tenants · subscriptions · license_keys · tenant_machines
```

---

## 3. Site Structure

```
website/
├── astro.config.mjs
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── public/
│   ├── favicon.ico
│   ├── og-image.png
│   └── fonts/
├── src/
│   ├── layouts/
│   │   └── Base.astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── PricingGrid.tsx     # cards + monthly/yearly toggle (annual default)
│   │   ├── PricingPreviewCard.astro
│   │   ├── FeatureTable.astro
│   │   ├── Hero.astro
│   │   ├── CheckoutButton.tsx    # Interactive: Paddle.js overlay
│   │   ├── AuthForm.tsx          # Interactive: login (Email code | Password tabs + forgot-password)
│   │   ├── SignupForm.tsx        # Interactive: register (email + password + strength meter)
│   │   ├── PasswordStrength.tsx  # Shared 4-class meter (signup, reset, dashboard)
│   │   └── LocaleSwitcher.tsx
│   ├── content/
│   │   └── pricing/
│   │       ├── en.ts
│   │       └── id.ts
│   ├── i18n/
│   │   ├── en.json
│   │   └── id.json
│   └── pages/
│       ├── index.astro
│       ├── [locale]/
│       │   ├── index.astro
│       │   ├── pricing.astro
│       │   ├── untuk-kafe.astro
│       │   ├── untuk-minimarket.astro
│       │   ├── untuk-warung.astro
│       │   ├── untuk-restoran.astro
│       │   ├── features.astro
│       │   ├── download.astro
│       │   ├── login.astro
│       │   ├── signup.astro
│       │   ├── account.astro
│       │   └── legal/
│       │       ├── privacy.astro
│       │       └── terms.astro
│       └── 404.astro
└── wrangler.toml
```

---

## 4. Locale Strategy

### Routing (path-based only — no subdomains)

| URL | Locale | Content |
|-----|--------|---------|
| `ozpos.my.id/` | Auto-detect → redirect | Detects country or browser lang |
| `ozpos.my.id/en/` | English | Global pricing (USD) |
| `ozpos.my.id/id/` | Bahasa Indonesia | Indonesia pricing (IDR) |
| `ozpos.my.id/en/pricing` | English pricing | USD price cards |
| `ozpos.my.id/id/pricing` | Indonesian pricing | IDR price cards |

### Locale Detection

| Signal | Method | Priority |
|--------|--------|----------|
| URL | Explicit `/en/` or `/id/` | Highest |
| Cloudflare header | `CF-IPCountry: ID` | High |
| Browser language | `navigator.language.startsWith('id')` | Low |
| Manual toggle | User clicks toggle in header | Override |

---

## 5. Registration & Auth (Tenant Email OTP)

### Self-signup (register-or-login)

Payment is **register-first**. Two entry points create the tenant:

- `/api/v1/web/register` (the `/signup` page) — email + password (min 8
  chars, at least 3 of lowercase/uppercase/number/symbol), then an emailed
  6-digit code; `verify-otp` flips `email_verified` and issues the session.
- `request-otp` (the login page's "Email code" tab) — self-signs an ACTIVE
  tenant when the email is new (`createTenantForEmail` in
  `apps/license-server/web_otp.go`, mirroring the webhook's tenant shape),
  so the checkout always finds a tenant for `custom_data.email`.

The Paddle webhook still upserts by email at first purchase — it just
attaches the subscription to the account the customer registered instead
of creating a parallel one. Trial users who never buy have a dormant
account with no license; there is nothing to manage.

### Identity = the `tenants` collection (exists today)

| Field | Type | Notes |
|-------|------|-------|
| `id` | text (auto) | PocketBase record id |
| `email` | email, unique index | The login identifier |
| `phone` | email-adjacent, **required today** | ⚠️ webhook must supply it (Paddle custom field) or the schema must relax it |
| `api_key` | text (bcrypt hash) | POS client credential — not a web password |
| `api_key_lookup` | text (SHA-256, indexed) | O(1) tenant resolution for the POS API |
| `password_hash` | text (bcrypt) | Web password login (`/login`; set at signup or from the dashboard) |
| `password_reset_at` | date | 7-day cooldown after a password reset |
| `email_verified` | bool | True once OTP verification completes (webhook-created tenants start false) |
| `status` | select: active / suspended / revoked | Gate web sessions on this |

### New license-server endpoints (new server work)

All web endpoints run inside the existing Go router (rate-limited, CORS
allow-listed) and read/write PocketBase server-side. None are raw
`/api/collections/*` calls from the browser.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/web/register` | POST | `{email, password}` → validates the password policy, creates the tenant (`email_verified=false`), emails a 6-digit code. `409` on an existing email. |
| `/api/v1/web/request-otp` | POST | `{email}` → looks up **or self-signs** the tenant (register-or-login), sends 6-digit code via SMTP. **Always returns 200** (no account enumeration). |
| `/api/v1/web/verify-otp` | POST | `{email, code}` → issues a short-lived session token + subscription summary, flips `email_verified=true` |
| `/api/v1/web/login` | POST | `{email, password}` → session. Generic `401 invalid email or password` for every failure (no enumeration). |
| `/api/v1/web/set-password` | POST | `{password}` (Bearer session) → set/rotate the web password; must differ from the stored hash |
| `/api/v1/web/request-password-reset` | POST | `{email}` → emails a reset code; skips the send and returns `cooldown_until` when a reset happened <7 days ago (always 200) |
| `/api/v1/web/reset-password` | POST | `{email, code, password}` → verifies the code, enforces policy + must-differ, stamps `password_reset_at`, sets `email_verified=true`, issues a session |
| `/api/v1/web/me` | GET | `Authorization: Bearer <token>` → tenant profile + subscription + license status |
| `/api/v1/web/logout` | POST | Invalidates the session token |
| `/api/v1/web/contact` | POST | Support form → Discord webhook (`OZ_DISCORD_WEBHOOK`); `503` + mailto fallback when unset |

### Two login modes (decision — supersedes "OTP only")

Auth was originally planned OTP-only because `tenants` had no password
field. The signup work added passwords as a first-class mode:

- **Password** — set at signup (`/register`) or from the dashboard
  (`/set-password`); bcrypt-hashed on `tenants.password_hash`.
- **Email OTP** — always works, including as the fallback when a password
  is forgotten (OTP is the only reset mechanism).

Password policy (server-enforced AND mirrored by the client meter):
minimum 8 characters with at least 3 of lowercase / uppercase / number /
symbol. Password resets stamp a **7-day cooldown** (`password_reset_at`),
and both reset and in-dashboard changes reject the current password. The
email-code path remains the magic-link / WebAuthn upgrade path later.

### Session token storage (decision)

| Approach | Storage | Security | Status |
|----------|---------|----------|--------|
| **sessionStorage** (v1, shipped) | `oz_session` in `sessionStorage`, set by `/verify-otp` | Scoped to the tab, cleared on tab close (better than localStorage), survives reloads — good UX for an account page | v1 |
| httpOnly cookie | Set by license server with `SameSite=None; Secure` + `X-CSRF-Token` header | Best, but cross-site cookie handling + CSRF needed | Hardening follow-up |
| localStorage | Browser storage | Vulnerable to XSS persistence | **Never** |

v1 stores the short-lived session token (default 24h TTL, server-side expiry)
in `sessionStorage` — scoped to the tab and cleared on close, unlike
localStorage. The account page reads it to call `/me`; any 401 clears it and
returns the user to the signed-out state. Hardening path stays the httpOnly
cookie + CSRF header.

### Email delivery (license server SMTP env vars on Northflank)

| Email Type | When | Content |
|------------|------|---------|
| OTP Code | Login request | 6-digit code |
| License receipt | Paddle webhook | Key string + tier + expiry |
| Subscription events | Created / cancelled / payment failed | Status notices |

**No custom domain yet:** Northflank provides no SMTP — the license server
sends via **Brevo** (`smtp-relay.brevo.com`: 587 STARTTLS, or 465 implicit
TLS — both supported), authenticated with the Brevo SMTP login id + key.
`code.run` / `workers.dev` aren't domains you can add DNS to, so the sender
must be **verified in Brevo Sender Identity** and set as `OZ_SMTP_FROM`
explicitly (the code default `no-reply@ozpos.my.id` is an unowned domain);
the server fails fast at boot when `OZ_SMTP_FROM` is missing. SPF/DKIM/DMARC
on the owned domain is the real inbox-not-spam fix — see
`apps/license-server/DEPLOY.md` step 5.

---

## 6. Pricing (mapped to the real tier enum)

> Tier names below are the **actual** `tier_key` values the schema and the
> client understand (`free`, `trial`, `pro`, `premium`, `enterprise` in
> `apps/license-server/pb_schema.json` and
> `crates/oz-core/src/subscription.rs`).
>
> **Sandbox catalog (live, created 2026-08-16 via the sandbox API):**
>
> | Product | Price (USD) |
> |---------|-------------|
> | kasir.mu Pro — `pro_01m05gdcbasdrc6wczkdc1bn3v` | `pri_01m05gdnqp30xze6db73qcracp` — $19/mo |
> | kasir.mu Premium — `pro_01m05gdctj4qcph8a957xwm9nw` | `pri_01m05gdpk4hmnm0k8e6vxm8cec` — $49/mo |
>
> ⚠️ **Superseded by the 5-tier lineup** (subscription-tiers.md §2): the
> prices above are the OLD $19/$49 sandbox prices. The six real Paddle
> prices (Plus/Pro/Premium × monthly/yearly) do not exist yet — the site
> displays the new lineup with placeholder price ids, so checkout degrades
> to the mailto fallback until the catalog lands (`PADDLE_PRICE_TIERS`
> needs the six price ids once D2 ships).
>
> **IDR limitation:** Paddle does not support IDR as a billing currency
> (its price-currency allowlist has no IDR). The `id` locale displays Rp
> but the checkout charges the USD price id above. True IDR billing would
> need a local provider (e.g. Midtrans/Xendit — see subscription-tiers.md
> §2 Payment routing).

### Global (USD) — subscription-tiers.md §2 (FINAL 2026-08-17)

| Tier | tier_key | Price | Type |
|------|----------|-------|------|
| Free | `free` | $0 | Free forever |
| Plus | `plus` | $4.99/mo · $49.99/yr | Monthly / yearly |
| Pro ⭐ | `pro` | $9.99/mo · $99.99/yr | Monthly / yearly |
| Premium | `premium` | $39.99/mo · $399.99/yr | Monthly / yearly |
| Enterprise | `enterprise` | Custom | Contact sales |

### Indonesia (IDR) — subscription-tiers.md §2 (FINAL 2026-08-17)

| Tier | tier_key | Price | Type |
|------|----------|-------|------|
| Free | `free` | Rp 0 | Gratis selamanya |
| Plus | `plus` | Rp 49.000/mo · Rp 500.000/yr | Bulanan / tahunan |
| Pro ⭐ | `pro` | Rp 99.000/mo · Rp 1.000.000/yr | Bulanan / tahunan |
| Premium | `premium` | Rp 399.000/mo · Rp 3.999.000/yr | Bulanan / tahunan |
| Enterprise | `enterprise` | Kustom | Hubungi sales |

> **"1-Time / perpetual" is NOT in the tier enum today.** Adding it means a
> new `tier_key` value (e.g. `lifetime`) in the schema **and** client-side
> quota/licensing changes (`crates/oz-core/src/subscription.rs`). Excluded
> from v1 — decide separately.

### Feature Comparison (subscription-tiers.md §3)

| Feature | Free | Plus | Pro | Premium | Enterprise |
|---------|------|------|-----|---------|------------|
| Stores | 1 | 1 | 2 | 5 | Unlimited |
| Registers / store | 1 | 2 | 5 | Unlimited | Unlimited |
| Warehouses | 1 | 2 | 3 | Unlimited | Unlimited |
| KDS screens | 0 | 0 | 2 | Unlimited | Unlimited |
| Max products/menu | 200 | 500 | 1,000 | 10,000 | Unlimited |
| Staff users | 1 | 5 | 20 | 50 | Unlimited |
| Sales history | 3 months | 1 year | 5 years | Unlimited | Unlimited |
| QRIS | ✗ | ✓ | ✓ | ✓ | ✓ |
| Daily Sales Dashboard | ✗ | ✓ | ✓ | ✓ | ✓ |
| Analytics / KDS | ✗ | ✗ | ✓ | ✓ | ✓ |
| Loyalty / Lua | ✗ | ✗ | ✗ | ✓ | ✓ |

(The full matrix lives in `website/src/content/pricing/{en,id}.ts`.)

---

## 7. Paddle Integration

### Setup Steps (One-Time)

1. Create Paddle account at [paddle.com](https://paddle.com)
2. **Sandbox catalog created via API** (2026-08-16): 2 products + 2 USD
   prices (see §6). Live catalog is the same shape once approved.
3. **Sandbox notification destination created via API** (2026-08-16):
   `ntfset_01m05htpgfq0qmcvb0er6byrsx` →
   `https://license.ozpos.my.id/api/v1/paddle/webhook`
   (events: subscription.created/updated/canceled, transaction.completed/
   payment_failed). The signing secret is **dashboard-only** — copy it from
   the sandbox dashboard (Settings → Notifications) into
   `PADDLE_WEBHOOK_SECRET` on the license server.
4. Credentials: `PUBLIC_PADDLE_CLIENT_TOKEN` (site, sandbox `test_…`),
   `PADDLE_WEBHOOK_SECRET` (server, dashboard), `PADDLE_PRICE_TIERS`
   (server — both currency ids per tier), `PADDLE_API_URL`
   (`https://sandbox-api.paddle.com` for sandbox).

### Checkout Flow (register-first)

```
User clicks "Choose Pro" → signed out? → /login (self-signup via OTP)
→ signed in → Paddle.js v2 overlay (Paddle.Initialize + Checkout.open,
  prefilled with the account email) → payment + VAT handled by Paddle
→ Paddle webhook → license server → key minted + subscription provisioned
  onto the registered tenant → dashboard shows the key + subscription
→ customer activates in the POS with the key
```

Implementation notes (see `website/src/components/paddle.ts`):
- The site loads the **v2** SDK (`https://cdn.paddle.com/paddle/v2/paddle.js`).
  The legacy URL (`cdn.paddle.com/paddle/paddle.js`) serves the v1 SDK whose
  `Setup`/`Checkout` signatures differ and would break with this code.
- `custom_data.email` is the **account** email (register-first) — the
  webhook attaches the subscription to that tenant.
- `PADDLE_PRICE_TIERS` maps both currencies of a tier to the same tier_key
  (e.g. `pri_pro_usd:pro,pri_pro_idr:pro`).

### Paddle Product Mapping (6 products)

> ⚠️ **Legacy sandbox catalog** — these are the old pre-5-tier prices
> (superseded by `subscription-tiers.md` §2 and §6 above; see the warning
> note in §6). The new Plus/Pro/Premium × monthly/yearly catalog has not
> been created yet, so the site ships placeholder price ids and checkout
> degrades to the mailto fallback.

| Product ID | Locale | tier_key | Price |
|------------|--------|----------|-------|
| `PADDLE_PRO_GLOBAL` | Global | `pro` | $19/mo |
| `PADDLE_PREMIUM_GLOBAL` | Global | `premium` | $49/mo |
| `PADDLE_ENT_GLOBAL` | Global | `enterprise` | Custom |
| `PADDLE_PRO_ID` | Indonesia | `pro` | Rp 299.000/mo |
| `PADDLE_PREMIUM_ID` | Indonesia | `premium` | Rp 749.000/mo |
| `PADDLE_ENT_ID` | Indonesia | `enterprise` | Custom |

### Webhook: License Server (not a Worker)

Paddle webhooks go **directly to the license server** on Northflank. The
license server already owns the RSA signing key and PocketBase — a
Cloudflare Worker would only add a hop. (This supersedes any earlier
"Worker" mention.)

```
Paddle webhook
    │
    ▼
https://license.ozpos.my.id/api/v1/paddle/webhook        (new server work)
    │
    ├── Verify Paddle signature (v1 public key / v2 webhook secret)
    ├── Dedup by event_id (Paddle retries — replays must be no-ops)
    ├── Parse event (subscription.created / updated / cancelled, transaction.completed)
    ├── Map Paddle product_id → tier_key (table above)
    ├── Upsert tenant by email (Paddle supplies email; collect phone as custom field)
    ├── Mint a human-readable license key string (e.g. OZ-PRO-XXXX-XXXX)
    ├── Insert license_keys record + create/update subscriptions:
    │   signed_payload + signature = the EXISTING RSA signing (not the key string)
    └── Return 200 OK (non-200 → Paddle retries)
```

> **Two different "keys":** the human-readable license key the customer
> types into the POS (a `license_keys` record) and the RSA-signed
> subscription payload (`signed_payload` + `signature` on `subscriptions`).
> The webhook must generate the first and *sign* the second — the RSA key
> does not "generate" the license key string.

### Paddle Webhook Events

| Event | Action |
|-------|--------|
| `subscription.created` | Upsert tenant, mint key, create subscription (RSA-signed) |
| `subscription.updated` | Update tier/status on `subscriptions` |
| `subscription.cancelled` | Mark subscription canceled (grace period via `grace_until`) |
| `subscription.payment_failed` | Flag for follow-up |
| `transaction.completed` | One-time purchases (only when a `lifetime` tier ships) |

---

## 8. Pages Breakdown

### Homepage (`/[locale]/`)

| Section | Content |
|---------|---------|
| Hero | "The Offline-First POS Platform" + CTA |
| Features Grid | 6 key features with icons |
| Screenshots | Desktop + tablet screenshots |
| Pricing Preview | Link to pricing page |
| CTA Banner | "Start Your Free Trial" |

### Pricing Page (`/[locale]/pricing`)

| Element | Detail |
|---------|--------|
| Tier Cards | Free / Plus / Pro ⭐ / Premium / Enterprise — annual default toggle ("2 months free") |
| Feature Comparison | Full matrix below cards |
| Buy Buttons | Paddle overlay checkout (product id per locale) |
| Trust Signals | "30-day money back" · "Cancel anytime" |

### Login Page (`/[locale]/login`)

| Element | Detail |
|---------|--------|
| Email code tab | Email → OTP (`request-otp`) → code (`verify-otp`) — self-signs a new account |
| Password tab | Email + password (`/login`) |
| Forgot password | Email → reset code + new password (`request-password-reset` → `reset-password`); 7-day cooldown after a reset |

### Signup Page (`/[locale]/signup`)

| Element | Detail |
|---------|--------|
| Email field | Format-validated client-side |
| Password field | Live strength meter (min 8 chars, ≥3 of 4 classes) — submit disabled until valid |
| Verify step | Code emailed by `/register` → `verify-otp` → straight into the dashboard |

### Account Page (`/[locale]/account`)

| Element | Detail |
|---------|--------|
| License Info | `license_keys` record: key, tier, status, expiry |
| Subscription | `subscriptions` record: tier, next billing, `grace_until` |
| Actions | Change plan (Paddle link), cancel (via Paddle) |

Data comes from `/api/v1/web/me` — the account page is read-only.

### Download Page (`/[locale]/download`)

| Element | Detail |
|---------|--------|
| Platform Cards | Windows / macOS / Linux |
| Version Info | Current version (0.0.25), release date |
| System Requirements | OS version, RAM, disk |

### Vertical Landing Pages (`/[locale]/untuk-{kafe,minimarket,warung,restoran}`)

Lead with vertical language + the kasir.mu positioning statement, never tier
names (subscription-tiers.md §5). Each page deep-links to its natural tier
on the pricing page via the `#plus` / `#pro` / `#premium` card anchors:

| Page | Entry hook | Tier CTA |
|------|-----------|----------|
| `untuk-kafe` | KDS + analytics + multi-terminal | Pro |
| `untuk-minimarket` | Inventory + multi-terminal + warehouses | Pro |
| `untuk-warung` | QRIS + Daily Sales Dashboard | Plus |
| `untuk-restoran` | KDS + loyalty + scheduled reports | Premium |

---

## 9. Design System

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#1a1a2e` | Dark navy — primary backgrounds |
| `--color-accent` | `#e94560` | Red accent — CTAs, highlights |
| `--color-surface` | `#16213e` | Card backgrounds |
| `--color-text` | `#eee2dc` | Body text |
| `--color-muted` | `#8d99ae` | Secondary text |

### Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 640px | Single column |
| Tablet | 640–1024px | 2-column grid |
| Desktop | > 1024px | Full layout |

---

## 10. Deployment

### Cloudflare Workers (static assets)

Live at `https://ozpos.my.id` until the custom domain is bought.

| Setting | Value |
|---------|-------|
| Platform | Workers static assets (`wrangler deploy` from `website/`) |
| Config | `website/wrangler.toml` (built in) |
| CI | **check + build only, on a PR.** `dev-ci.yml#website` runs asset hygiene, `npm ci`, typecheck/lint, unit tests and `npm run build`, path-gated on the `changes` router (`.github/workflows/dev-ci.yml:137-163`). **Deploy:** `.github/workflows/website.yml` ("Website Deploy", restored 2026-09-24 from the `.bak` it became on 2026-09-02) gates the build and deploys on push to main path-filtered to `website/**` + `prototypes/**`, and on manual dispatch — fail-closed on the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` GitHub secrets, with a token-verify step before the build. `npm run deploy` from `website/` → `scripts/wrangler-deploy.sh` remains for a manual redeploy and reads the same names from env (`scripts/wrangler-deploy.sh:42-43`) |
| Framework | Astro |
| Build command | `npm run build` |
| Output | `dist/` |
| Root dir | `website/` |

> Cloudflare Pages (Git integration) remains a valid alternative — same build
> command/output; `wrangler.toml` is then ignored and env vars go in Pages →
> Settings → Builds. `public/_headers` (CSP) and `public/_redirects` (301s)
> are honored by both platforms.

### Custom Domain (path-based locales — no subdomains)

| Domain | Locale |
|--------|--------|
| `ozpos.my.id` | Root → auto-redirect |
| `ozpos.my.id/en` | English (global) |
| `ozpos.my.id/id` | Bahasa Indonesia |

### Environment Variables

**Cloudflare (site) — Workers static assets (deployed by `.github/workflows/website.yml` on push to main, or by hand with `npm run deploy` from `website/`):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `PUBLIC_LICENSE_API_URL` | `https://license.ozpos.my.id` | Web auth + license API (replaces any direct PocketBase URL). Build-time fallback only: the Worker serves the runtime override from the `LICENSE_API_URL` [vars] binding in wrangler.toml, so a backend move needs no rebuild |
| `PUBLIC_PADDLE_CLIENT_TOKEN` | `xxxxx` | Paddle.js v2 client token (`Paddle.Checkout`, `custom_data.email`). Empty = checkout buttons degrade to the mailto fallback |
| `PUBLIC_PADDLE_ENVIRONMENT` | `sandbox` | Paddle SDK env: `sandbox` or `production` (defaults to `production` when unset — set `sandbox` until real price ids ship) |
| `PUBLIC_CONTACT_ENDPOINT` | `https://license.ozpos.my.id/api/v1/web/contact` | Support contact-form target; empty = mailto fallback |

**Northflank (license server, new):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `PADDLE_WEBHOOK_SECRET` | `xxxxx` | Verify webhook signatures (HMAC-SHA256 over `ts:rawBody`, 5-min replay window). **Required at boot** — the server fails fast without it |
| `PADDLE_PRICE_TIERS` | `pri_x:pro,pri_y:premium` | Price id → tier_key map (unmapped prices fail provisioning with 500 → Paddle retries). **Required at boot** |
| `PADDLE_API_KEY` | optional | Server-side Paddle API key — fallback via `GET /customers/{id}` when `custom_data.email` is absent (the checkout now passes it, so this is rarely needed) |
| `OZ_SMTP_HOST` / `OZ_SMTP_PORT` / `OZ_SMTP_USER` / `OZ_SMTP_PASSWORD` / `OZ_SMTP_FROM` | relay creds | OTP + license-key receipt emails. Port 465 = implicit TLS, anything else = STARTTLS (`net/smtp`). `OZ_SMTP_FROM` **required at boot** when SMTP is configured (sender must be verified with the relay) |
| `OZ_DISCORD_WEBHOOK` | optional | Support-contact target for `/api/v1/web/contact`; unset → `503` + mailto fallback |
| `OZ_WEB_ALLOWED_ORIGINS` | `https://ozpos.my.id,https://ozpos.my.id,http://localhost:4321` | Web API CORS allowlist |
| `OZ_WEB_SESSION_TTL` | `24h` | Web session lifetime (Go duration) |

**Shipped web endpoints** (all rate-limited per plan §11, CORS allow-listed):

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/web/register` | Email + password → OTP email (`409` on existing) |
| `POST /api/v1/web/request-otp` | Email → 6-digit code (always 200, no enumeration) |
| `POST /api/v1/web/verify-otp` | Email + code → session token + summary, `email_verified=true` |
| `POST /api/v1/web/login` | Email + password → session (generic `401`) |
| `POST /api/v1/web/set-password` | Set/rotate password (Bearer session, must-differ) |
| `POST /api/v1/web/request-password-reset` | Email → reset code (7-day cooldown, always 200) |
| `POST /api/v1/web/reset-password` | Code + new password → session |
| `GET /api/v1/web/me` | Bearer → tenant profile + license + subscription |
| `POST /api/v1/web/logout` | Invalidate session (idempotent) |
| `POST /api/v1/web/contact` | Support form → Discord (`503` when unset) |

### Health & monitoring (shipped beyond the original plan)

`GET /api/health` reports every boot-gate status as JSON — `smtp`
(`configured`/`verified`), `paddle` (`secret_configured`,
`price_tiers_configured`, `price_tiers_mappings`), `rsa`, `discord` — as
*status*, not liveness (only a DB outage fails the HTTP check). The unified
container's shell healthcheck (`apps/unified/healthcheck.sh`) fails the
container after N consecutive bad probes (`OZ_HEALTH_SMTP_MAX_FAILS` /
`OZ_HEALTH_PADDLE_MAX_FAILS`, default 3), so a broken relay or a rotated
Paddle secret eventually flips the container unhealthy; its test harness is
a registered CI gate (`unified-healthcheck`).
`apps/license-server/uptime-monitor.md` documents keyword monitors (e.g.
`"verified":false` on `/api/health`) for UptimeRobot-style alerting.

---

## 11. Security

### CORS (on the license server, not PocketBase)

The website only talks to `https://license.ozpos.my.id`. The Go router sets
CORS for the allow-listed origins; **PocketBase stays internal** — its admin
UI and `/api/collections/*` surface are never reachable from the browser.

```json
// License server CORS allowlist — OZ_WEB_ALLOWED_ORIGINS env var
// (comma-separated). Default when unset:
{ "allowedOrigins": ["https://ozpos.my.id", "https://ozpos.my.id", "http://localhost:4321"] }
```

### Content Security Policy

Cloudflare Pages `_headers` file to allow Paddle.js iframe:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.paddle.com; frame-src https://*.paddle.com; connect-src 'self' https://license.ozpos.my.id https://*.paddle.com; style-src 'self' 'unsafe-inline'
```

### Token Storage (v1 decision)

| Approach | Storage | Security |
|----------|---------|----------|
| **sessionStorage** (v1, shipped) | `oz_session` in sessionStorage, server-side 24h TTL | Tab-scoped, cleared on tab close, survives reload |
| httpOnly cookie (follow-up) | License server cookie + CSRF header | Best, needs cross-site cookie + CSRF work |
| localStorage | Browser storage | Vulnerable to XSS — never |

### CSRF

Bearer tokens (v1) are inherently CSRF-safe. If/when cookie sessions land,
add `X-CSRF-Token` on state-changing requests.

### Rate Limiting (already in the license server)

`apps/license-server/ratelimit.go` already rate-limits the POS endpoints —
the web endpoints reuse it:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/v1/web/request-otp` | 3 per email | 15 min |
| `/api/v1/web/verify-otp` | 5 attempts | 15 min |
| `/api/v1/web/register` | 3 per email | 15 min |
| `/api/v1/web/login` | 5 per email | 15 min |
| `/api/v1/web/request-password-reset` | 3 per email | 15 min |
| `/api/v1/web/reset-password` | 5 attempts | 15 min |
| `/api/v1/paddle/webhook` | HMAC-verified + event-id dedup | replay-safe |

All web endpoints additionally share a per-IP backstop limiter
(`apps/license-server/ratelimit.go`).

### Account Page Auth Guard

```tsx
useEffect(() => {
  const token = sessionToken; // in-memory, from /verify-otp
  if (!token) {
    window.location.href = `/${locale}/login`;
    return;
  }
  fetch(`${LICENSE_API_URL}/api/v1/web/me`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(res => {
    if (!res.ok) window.location.href = `/${locale}/login`;
  });
}, []);
```

### Offline / License Server Unreachable

| Scenario | Behavior |
|----------|----------|
| Login page + server down | Show "Service temporarily unavailable" message |
| Account page + server down | Show cached license info if available, prompt retry |
| Paddle checkout + server down | Paddle still processes payment; webhook retries later (dedup makes replays safe) |

---

## 12. Webhook Responsibilities (Summary)

- **Verify** the Paddle signature — never trust unauthenticated calls.
- **Dedup** by `event_id` — Paddle retries on non-200; a replayed event must
  be a no-op, not a second license.
- **Map** `product_id → tier_key` via the §7 table.
- **Upsert tenant** by email (phone comes from a Paddle checkout custom
  field, or the schema relaxes `phone` to optional).
- **Mint** the license key string and insert a `license_keys` record.
- **Sign** the subscription payload with the existing RSA private key
  (`signed_payload` + `signature`).
- **Return 200** so Paddle stops retrying.

---

## 13. License / Updates Policy

The 1-Time/perpetual SKU is **not** part of the tier enum yet (see §6).
Until a `lifetime` tier ships, only time-based tiers exist:

| License Type | tier_key | Updates Included |
|-------------|----------|------------------|
| Free | `free` | All updates — free forever (license server renews free at +100y) |
| Pro | `pro` | All updates while subscribed |
| Premium | `premium` | All updates while subscribed |
| Enterprise | `enterprise` | Contract terms |

When a 1-Time SKU is added: perpetual use of the version purchased; minor
updates (0.0.x) within the same major version are free; major versions
(1.0 → 2.0) require a new purchase.

---

## 14. Development Workflow

```bash
cd website/
npm install
npm run dev     # localhost:4321
npm run build   # outputs to dist/
```

License server side (new work) needs locally:

- the four `/api/v1/web/*` endpoints and `/api/v1/paddle/webhook` ✅ shipped
  (webhook: signature verification, event-id dedup, subscription events →
  tenant upsert + license-key mint + RSA-signed subscription, receipt email)
- `PADDLE_WEBHOOK_SECRET` + `PADDLE_PRICE_TIERS` (+ `PADDLE_API_KEY` for the
  email fallback) + SMTP env vars
- Paddle **sandbox** mode for checkout + webhook testing (event-id dedup,
  retry replay, signature verification all testable in sandbox)

---

## 15. Future Enhancements

| Enhancement | Priority |
|-------------|----------|
| Paddle price catalog — six real prices (Plus/Pro/Premium × monthly/yearly) | P0 — required before paid checkout |
| `lifetime` (1-Time) tier — schema + client change | P1 |
| httpOnly cookie sessions + CSRF | P1 |
| Midtrans checkout for IDR (Phase 2 — subscription-tiers.md §2) | P1 |
| Paddle customer portal (change plan / invoices self-serve) | P2 |
| OAuth login (Google, GitHub) | P2 |
| Blog (markdown-based, SEO) | P2 |
| Customer testimonials | P3 |
| Newsletter signup | P3 |
| Dark/Light mode toggle | P3 |

---

## 16. Estimated Timeline

Includes the new license-server work the previous plan silently assumed.

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **1. Scaffold** | 1 day | Astro + Tailwind + i18n routing |
| **2. Pages** | 2-3 days | Homepage, pricing, features, download |
| **3. License-server web API** | 2 days | `/web/*` OTP endpoints, session, SMTP, CORS |
| **4. Paddle** | 2 days | Checkout integration + webhook (signature, dedup, key minting, RSA signing) |
| **5. Auth pages** | 2 days | Login (OTP + password + forgot-password), signup + strength meter, account page (reads `/me`), password reset + 7-day cooldown |
| **6. Polish** | 1-2 days | Responsive, SEO, analytics |
| **7. Deploy** | 0.5 day | Cloudflare Pages + custom domain + env vars |
| **Total** | **~10-12 days** | Full site live + purchase flow end-to-end |

---

## 17. Cost Estimate

| Item | Cost | Notes |
|------|------|-------|
| Cloudflare Pages | **Free** | 500 builds/mo, unlimited bandwidth |
| Cloudflare Workers | **Free** | Not needed for v1 (no Worker hops) |
| Paddle | **5% + $0.50/txn** | Handles payment processing |
| License server | existing | Northflank Hobby tier, already deployed |
| Domain | ~$10/year | Cloudflare Registrar |
| **Total** | **~$0-10/mo** | Before Paddle transaction fees |

> last audited 09-09-26 by docs-auditor
