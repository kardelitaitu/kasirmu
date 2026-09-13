<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (1 minor note) · DONE card matches code: apps/desktop-client/src/lan_server.rs defaults to "127.0.0.1:9180" (line 190) with configurable bind_addr (line 114); PSK handshake present (HelloMsg{psk}, PSK_HANDSHAKE_TIMEOUT_SECS=5, psk: Option<Arc<String>>, lines 48-94); tests for loopback-default + external-rejected + psk paths exist. Minor: card references Settings::get_lan_server_bind/set_lan_server_bind in db/settings.rs/settings.rs, which don't exist by that name — bind is read via LanServerConfig/bind_addr instead; narrative otherwise accurate · closed by commit 2026-07-23 per card -->

# C-4 — LAN event server: default-bind to loopback, add PSK for opt-in KDS bridge

- **Status:** DONE
- **Sprint:** 0.0.5-rc
- **Severity:** CRITICAL
- **Owner:** RSA-Agent (Buffy)
- **Implementer:** RSA-Agent (Buffy)
- **Closed by:** commit (2026-07-23)
- **Closes:** audit finding C-4 (2026-07-12-desktop-app-audit)
- **Audit source:** `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2

## Summary

`apps/desktop-client/src/lan_server.rs` binds the LAN event server
to `0.0.0.0:9180` in plaintext, with no TLS, no shared-secret
handshake, and no IP allowlist. Any device on the corporate LAN can
subscribe to `sale.completed` and `order.course_fired` events
(customer line items, totals, IDs) and can drown the offline buffer
with crafted payloads. Default-bind to `127.0.0.1` and add a
pre-shared-key (PSK) handshake for the opt-in KDS bridge mode.

## Baseline (pre-fix)

```rust
// apps/desktop-client/src/lan_server.rs:56, 95-110
let listener = TcpListener::bind("0.0.0.0:9180").await?;
// ... newline-delimited JSON, no TLS, no handshake, no allowlist
```

The intended use case is local: customer-facing KDS tablets and
second displays that the feature is designed for. But the same
listener is exposed to the corporate LAN/Wi-Fi. Other employees,
contractors, and the office router can snoop sales data without
authentication. Any LAN peer that sends a hardcoded payload can
also drown the offline buffer.

## Acceptance criteria

- [ ] TCP listener binds to `127.0.0.1:9180` by default
- [ ] `0.0.0.0` bind requires an explicit opt-in (e.g.,
      `lan_server_bind: "0.0.0.0"` setting in the SQLite settings
      table) and the operator has documented justification
- [ ] When `0.0.0.0` bind is enabled, the server requires a
      pre-shared key (PSK) handshake on the first message before
      granting subscribe permissions
- [ ] PSK is stored in the OS credential store (not the SQLite
      settings table) per the C-5 follow-up; for this card, a
      per-deployment secret in the settings table is acceptable as
      an interim measure
- [ ] New unit test: connection from `127.0.0.1` is accepted when
      default-bind is on
- [ ] New unit test: connection from a non-loopback address is
      rejected (handshake fails or connection times out) when
      default-bind is on
- [ ] New unit test: PSK-less connection is rejected when
      opt-in `0.0.0.0` mode is on
- [ ] New unit test: correct PSK grants subscribe permission
- [ ] All previously-passing tests still pass
- [ ] `cargo fmt --all -- --check` and
      `cargo clippy --workspace --all-targets -- -D warnings` clean
- [ ] Audit doc §2 marks C-4 CLOSED; §6 X-2 (epic), §7 release-blocker
      list, and §10 grep caption updated
- [ ] Documentation update in `docs/security/` for both modes
      (loopback default + opt-in `0.0.0.0` with PSK)

## Plan (proposed)

1. **Add a `lan_server_bind` setting** in the SQLite settings table
   with default value `"127.0.0.1"`. Reject `"0.0.0.0"` unless the
   `lan_server_psk` setting is also present and non-empty.
2. **Read the bind address from settings** in
   `lan_server::start()` instead of hardcoding `"0.0.0.0:9180"`:
   ```rust
   let bind = oz_core::Settings::get_lan_server_bind(&conn)
       .unwrap_or_else(|_| "127.0.0.1".into());
   let listener = TcpListener::bind(format!("{bind}:9180")).await?;
   ```
3. **Add a PSK handshake** in the connection accept loop:
   - First message from the client must be `{"op":"hello","psk":"..."}`
     (PSK value redacted; transmitted over the (still-plaintext)
     loopback or LAN channel for this card — TLS is a follow-up
     ticket).
   - If `bind == "0.0.0.0"` and the PSK is missing or wrong, close
     the connection and log a `tracing::warn!`.
   - If `bind == "127.0.0.1"`, the handshake is optional (the
     loopback is assumed trusted).
4. **Persist the PSK in the OS credential store** if the
   `keyring` crate is already in the dependency tree (C-5's
   work). Otherwise, store it in the settings table with a
   `// SECURITY: move to OS credential store in C-5` marker.
5. **Add unit tests** in `lan_server.rs`:
   - `lan_server_loopback_default` — server starts on
     `127.0.0.1:9180` and a `TcpStream::connect("127.0.0.1:9180")`
     succeeds.
   - `lan_server_external_address_rejected` — server is
     configured to bind to `0.0.0.0` and a `TcpStream::connect`
     from a non-loopback address is rejected at the PSK handshake.
   - `lan_server_psk_required_on_external` — server on
     `0.0.0.0` rejects PSK-less connection within 1s.
   - `lan_server_psk_accepted` — server on `0.0.0.0` accepts a
     connection with the correct PSK and grants subscribe.
6. **Update `docs/security/LAN-SERVER-MODES.md`** to document the
   two modes (loopback default + opt-in `0.0.0.0` with PSK).
7. **Update `docs/specs/_active/2026-07-12-desktop-app-audit.md`**
   to mark C-4 CLOSED in §2, §6 (X-2), §7, and §10.

## Verification (post-implementation)

```bash
# 1. Default-bind is 127.0.0.1
grep -A2 'lan_server_bind' apps/desktop-client/src/lan_server.rs
# expect: "127.0.0.1" (or via settings table)

# 2. Tests pass
cargo test -p oz-pos-app --lib --features test
# expect: 4 new tests in lan_server pass

# 3. Lint + fmt clean
cargo clippy -p oz-pos-app --lib --tests -- -D warnings
cargo fmt --all -- --check

# 4. Manual smoke test: external connection rejected
# Start the server, run `nmap -p 9180 <lan_ip>`, then
# `nc <lan_ip> 9180` and send `{"op":"subscribe","topic":"sale.completed"}`
# — expect: connection closed within 1s, tracing::warn! emitted

# 5. Audit grep §10 line 4 returns the new bind config
grep -rn 'TcpListener::bind' apps/desktop-client/src/
# expect: "127.0.0.1:9180" (or via settings table)
```

## Risks

- **Plaintext PSK transmission**: the PSK is sent in the first
  message before the TLS handshake. A future card should layer
  TLS on top of the TCP listener (e.g., `rustls` + ALPN). For
  this card, the PSK provides a low-cost authentication barrier
  without encryption; an attacker on the LAN can still sniff
  the PSK if they can observe the first packet.
- **PSK rotation**: the settings-table PSK is operator-rotated by
  editing the DB. The OS credential store (C-5 follow-up) provides
  a better rotation path; this card sets up the structure.
- **KDS bridge mode usability**: if the PSK rotation is too
  frequent, the KDS tablets need to be reconfigured. Document the
  rotation cadence in the operator runbook.
- **IPv6 link-local addresses**: `0.0.0.0` is IPv4-only. If a
  customer runs IPv6-only, the bind is loopback-only by default;
  document this in the deployment guide.

## Non-goals

- Mutual TLS: the PSK is one-factor (server trusts the client);
  mTLS is a follow-up card.
- Rate-limiting at the LAN server: a related concern (H-2 covers
  the sync_pull path) but distinct from this card's auth scope.
- LAN server encryption: the events themselves are sent
  plaintext. End-to-end encryption of sale events is a future
  card.

## References

- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2 C-4
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §6 X-2 (epic)
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §7 release-blocker list
- `apps/desktop-client/src/lan_server.rs:56, 95-110`
- `crates/oz-core/src/settings.rs` (where the `lan_server_bind`
  setting will live)
- `crates/oz-core/src/db/settings.rs` (`Settings::get_lan_server_bind`
  and `Settings::set_lan_server_bind` to be added)

> last audited 22-07-26 by Hermes-Agent
