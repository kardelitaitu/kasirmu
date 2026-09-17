<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · DONE card accurately reflects code: apps/desktop-client/tauri.conf.json + apps/tablet-client/tauri.conf.json both have NON-NULL strict CSP allowlists matching the acceptance criteria (default-src 'self', script-src 'self', style-src 'self' 'unsafe-inline', connect-src 'self' + dev/asset schemes, frame-src 'none', object-src 'none', base-uri/form-action 'self'); docs/specs/_active/2026-07-12-desktop-app-audit.md §2 marked C-3 CLOSED (file stamped earlier) · closed by commit 2026-07-23 per card -->

# C-3 — Enable a strict Content Security Policy (`csp: null` → explicit allowlist)

- **Status:** DONE
- **Sprint:** 0.0.5-rc
- **Severity:** CRITICAL
- **Owner:** RSA-Agent (Buffy)
- **Implementer:** RSA-Agent (Buffy)
- **Closed by:** commit (2026-07-23)
- **Closes:** audit finding C-3 (2026-07-12-desktop-app-audit)
- **Audit source:** `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2

## Summary

`apps/desktop-client/tauri.conf.json` and
`apps/tablet-client/tauri.conf.json` set `security.csp = null`, which
disables the Tauri WebView's Content Security Policy. Any HTML/JS
loaded from any origin can execute, which is an XSS → RCE vector
under the Tauri IPC threat model. Replace the `null` value with a
strict allowlist CSP that aligns with the kasir.mu bundle's actual
needs (local assets, IPC, asset scheme).

## Baseline (pre-fix)

```json
// apps/desktop-client/tauri.conf.json:23-25
"security": { "csp": null }

// apps/tablet-client/tauri.conf.json (same shape, separate file)
```

The Tauri WebView's default CSP is permissive when `null`; any
`eval()` call, third-party plugin HTML injection, or attacker-
controlled receipt-render path (e.g. a malicious Lua plugin printing
untrusted receipt HTML) becomes an XSS vector that escalates to RCE
via `invoke()`. Compliance posture: fails PCI-DSS §6.5.7 and OWASP
ASVS V5.

## Acceptance criteria

- [ ] `apps/desktop-client/tauri.conf.json` has a non-null
      `security.csp` value
- [ ] `apps/tablet-client/tauri.conf.json` has a non-null
      `security.csp` value
- [ ] The CSP string covers the kasir.mu bundle's actual needs:
      - `default-src 'self'`
      - `img-src 'self' data: asset: https://asset.localhost`
      - `style-src 'self' 'unsafe-inline'` (the audit recommends
        keeping inline styles for the Fluent-driven React tree;
        document the exception)
      - `script-src 'self'` (no `'unsafe-inline'`, no `'unsafe-eval'`)
      - `connect-src 'self' ipc: https://ipc.localhost`
      - `font-src 'self' data:`
      - `frame-src 'none'`
      - `object-src 'none'`
      - `base-uri 'self'`
      - `form-action 'self'`
- [ ] All Tauri command IPC URLs in the WebView match the
      `connect-src` allowlist (the dev-mode `tauri://localhost` and
      production `https://tauri.localhost` are covered by `'self'`)
- [ ] All currently-passing front-end tests still pass
- [ ] `cargo build -p oz-pos-app -p oz-pos-tablet` exits 0
- [ ] `ui/` tests (`npm test` or equivalent) exit 0
- [ ] `verify-bundle-parity` (the pre-commit i18n script) passes
- [ ] A new doc-test or Tauri-config-validation test asserts the
      `csp` is non-null
- [ ] Audit doc §2 marks C-3 CLOSED; §6 X-2 (epic), §7 release-blocker
      list, and §10 grep caption updated

## Plan (proposed)

1. **Draft the CSP string** in `apps/desktop-client/tauri.conf.json`:
   ```json
   "security": {
     "csp": "default-src 'self'; img-src 'self' data: asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: https://ipc.localhost; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
   }
   ```
2. **Apply the same string** to `apps/tablet-client/tauri.conf.json`
   (the audit noted the tablet client has the same posture).
3. **Smoke-test in dev mode**:
   ```bash
   cd apps/desktop-client
   cargo tauri dev
   # Navigate to each main screen, confirm the devtools console shows
   # the CSP report and no errors.
   ```
4. **Verify the front-end still works** by exercising:
   - The login screen (uses Fluent inline styles)
   - The cart screen (loads images from `asset:` and `data:`)
   - The receipt print preview (uses IPC to invoke the printer command)
   - The exchange-rates screen (the C-1-closure surface; CSP must
     allow the IPC call to `invoke('list_exchange_rates')`)
5. **Add a JSON-schema validation** in the
   `.githooks/pre-commit` (or as a CI step) that fails the build
   if `security.csp` is null or empty. This locks the posture
   against accidental regression.
6. **Update `docs/specs/_active/2026-07-12-desktop-app-audit.md`**
   to mark C-3 CLOSED.

## Verification (post-implementation)

```bash
# 1. CSP is non-null in both clients
jq -r '.app.security.csp' apps/desktop-client/tauri.conf.json
jq -r '.app.security.csp' apps/tablet-client/tauri.conf.json
# expect: a non-empty string for both

# 2. CSP grep returns non-null
grep -A1 '"csp"' apps/desktop-client/tauri.conf.json
# expect: not "csp": null

# 3. Build clean
cargo build -p oz-pos-app -p oz-pos-tablet --lib --tests

# 4. Front-end tests
cd ui && npm test
cd ..

# 5. Pre-commit hooks pass
.githooks/pre-commit

# 6. Audit grep §10 line 3 returns the new CSP, not null
```

## Risks

- **Inline styles needed for Fluent**: the audit recommends keeping
  `'unsafe-inline'` for `style-src` because the Fluent React tree
  sets some inline styles. Confirm via dev-mode smoke test; if
  Fluent actually uses `style` attributes that violate
  `'unsafe-inline'`, an additional `nonce` mechanism would be
  required (out of scope).
- **WebView-specific CSP syntax**: Tauri's CSP is enforced by the
  underlying WebView (WebKit on macOS/iOS, WebView2 on Windows,
  Android System WebView on Android). The exact CSP directive set
  may differ slightly between platforms. Test on all three (or
  document platform exceptions in the tauri.conf.json comment).
- **Plugin HTML injection**: Lua plugins that produce custom
  receipt HTML may need to add a hash or nonce to the CSP. Add a
  follow-up ticket if any plugin breaks.

## Non-goals

- Subresource Integrity (SRI) for the front-end bundle: out of
  scope; the bundle is local and signed by the auto-updater
  (Epic X-2's L-4 follow-up).
- HTTPS-only / HSTS for the IPC channel: not applicable; the IPC
  channel is `ipc://` or `tauri://` scheme, not HTTP.

## References

- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2 C-3
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §6 X-2 (epic)
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §7 release-blocker list
- `apps/desktop-client/tauri.conf.json:23-25`
- `apps/tablet-client/tauri.conf.json` (same shape)
- Tauri v2 CSP docs: <https://tauri.app/v1/guides/distribution/security>
- PCI-DSS §6.5.7 (cross-site scripting in custom code)
- OWASP ASVS V5 (input/output validation)

> last audited 22-07-26 by Hermes-Agent
