# Orchestrator Agent 5: Device-Keyed Offline Replay for LAN KDS Sync

**Document:** `done-todo-kds-agents-5.md` (opened as `todo-kds-agents-5.md`)
**Role:** Orchestrator Agent 5 (Multi-Terminal Resilience Architect)
**Goal:** Make reconnect replay actually work for real tablets. Found and stamped by Agent 4's live validation (`0302039258`, `done-todo-kds-agents-2.md` follow-up section).

## The problem (evidence, not theory)
`crates/oz-lan` buffers events for a peer whose socket write fails, keyed by the **ephemeral TCP peer address (ip:port)**. A real KDS tablet that drops and reconnects gets a NEW source port — so the buffer under the dead address is never found and replay is effectively dead in production. Agent 4's tests only see replay by rebinding the exact local port. Meanwhile `device_id` is ALREADY on the wire: hello/discover carry serde-default `station_ids` + `device_id` (kds-sync), parsed into `PeerSubscription`.

## Task
- [x] 1. Key the per-peer offline buffer by `device_id` when the subscription has one; keep `peer_addr` keying as the legacy path for device-less (pre-kds-sync) peers. Both paths tested. → **Landed: new `crates/oz-lan/src/replay.rs` — `ReplayKey::Device(id) | ReplayKey::Addr(ip:port)`, two disjoint namespaces. Both paths carry live-forwarder proofs (`device_peer_reconnect_from_new_port_replays_buffered_events`, `legacy_peer_without_device_id_stays_addr_keyed`) plus the unchanged pre-change pins.**
- [x] 2. When a hello/discover presents a `device_id` that has a pending buffer from a DIFFERENT address: drain it, replay through the same station filter, attach the new address, log the handoff. → **Landed: the drain moved from `run()`'s accept arm into `handle_peer` phase 2 (the accept loop cannot know the identity — only the address). Each queue records the `peer_addr` its last push failed on; a device drain whose recorded source differs from the live `peer_addr` emits `tracing::info!(device, buffered_at, reconnected_at, count, "offline replay buffer handed off to a new peer address")` and the next failed push re-attaches the queue to the new address. Replay still passes every line through `should_deliver`; lines filtered out are retired with the queue (no unclaimed residue), same semantics the pre-change addr path pinned in the desktop live suite.**
- [x] 3. Bounded retention: per-device cap + total cap (drop-oldest + `tracing::warn!`); no unbounded memory. → **Landed: `MAX_OFFLINE_BUFFER_PER_PEER = 1024` (carried over unchanged from the DC-2 cap) per queue, plus a new `MAX_OFFLINE_BUFFER_TOTAL = 8192` across all queues, evicting the GLOBALLY oldest line (per-event sequence numbers) so a flood from one device cannot cannibalise another's fresher history. Both evictions `tracing::warn!` with key, cap and dropped seq; the handoff logs `tracing::info!`. Pinned by `per_device_cap_drops_oldest_with_bounded_growth` and `total_cap_evicts_global_oldest_across_queues`.**

## Verification
- [x] New `cargo test -p oz-lan` covering: reconnect-on-new-port gets its buffered events; legacy no-device peer unchanged; filter respected on device-keyed replay; cap drops oldest. → **10 new tests (6 in `replay_tests.rs`, 4 live-forwarder tests in `lib_tests.rs`); full names + tails in the stamp below. Suite: 63 → 73 passed + 1 doctest.**
- [x] Existing suite green: `cargo test -p oz-lan` (63+1 baseline), `cargo test -p oz-pos-app kds_lan_live` (5/5), `--lib registration` 12/12, `--lib state` 13/13. → **All four green at baseline BEFORE any edit, all four green after, kds_lan_live twice back-to-back identical (see stamp).**

## Fence & law
`crates/oz-lan/**` ONLY (lib.rs + kds_sync.rs + their test files) + this doc. NO desktop-client, NO bridge, NO `ui/**`. Wire format frozen — no serialization changes. `feat(kds-lan):` subjects; one-line pathspec commits; new files via the sanctioned add-chain; per-file `rustfmt --edition 2024` ONLY (the hook no longer runs cargo fmt; NEVER --all/-p). No clippy mid-run, no push/branch/stash/amend. Stamp honestly, then rename this doc → `done-todo-kds-agents-5.md`.

---

## ✅ Results stamp — 2026-09-13 (Orchestrator Agent 5)

**Code commit:** `212078e554` — `feat(kds-lan): key offline replay buffer by device_id so a reconnecting tablet finds its queue on a new port`
Files: `crates/oz-lan/src/replay.rs` (NEW, 239 ln) + `crates/oz-lan/src/replay_tests.rs` (NEW, 170 ln) + `crates/oz-lan/src/lib.rs` + `crates/oz-lan/src/lib_tests.rs` + `crates/oz-lan/src/kds_sync.rs` (doc-only) + `crates/oz-lan/src/noise.rs` (doc-comment name fix). `git show --stat` lists exactly these six; `create mode` entries are exactly the two new files (sanctioned single-line add-chain).
**Doc commits:** `e7ff738202` (RESOLVED append into `done-todo-kds-agents-2.md`) + this doc's stamp-and-rename commit (its SHA is recorded in the session's final report).

### Baselines (recorded BEFORE any edit — all green, no foreign-in-flight)

| Gate | Baseline |
|---|---|
| `cargo test -p oz-lan` | **63 passed + 1 doctest** |
| `cargo test -p oz-pos-app kds_lan_live` | **5 passed / 0 failed** (4.89 s) |
| `cargo test -p oz-pos-app --lib registration` | **12 passed** |
| `cargo test -p oz-pos-app --lib state` | **13 passed** |

### Design decisions

- **Buffer struct shape:** `OfflineReplayBuffer { inner: Arc<tokio::sync::Mutex<BufferInner>> }` with `BufferInner { queues: HashMap<ReplayKey, PeerQueue>, total: usize, next_seq: u64 }` and `PeerQueue { events: VecDeque<BufferedEvent>, last_addr: Option<String> }`. The `Arc<Mutex<…>>` moved INSIDE the buffer (was `Arc<Mutex<HashMap<String, Vec<String>>>>` plumbed through `lib.rs`), so the forwarder/`handle_peer` plumbing carries a cheap `Clone` value instead of a raw lock; all mutation goes through async methods (`push`/`drain`/counts). `ReplayKey::Device` and `ReplayKey::Addr` are separate map namespaces — a `device_id` string equal to an `ip:port` can never mix queues (pinned).
- **Where drain hooks in:** `handle_peer` phase 2, immediately after phase 0/1 have resolved the subscription — NOT the accept loop. The accept loop knows only the ephemeral address; the identity arrives on the hello/discover line, which is read inside `handle_peer`. Consequences, all deliberate: (1) an unauthenticated connection (bad PSK) no longer deletes a legacy queue parked at its address (the old accept-time `remove(&addr)` did, and the events died with the rejected task); (2) phase 2 drains BOTH `Addr(peer_addr)` (first, so a same-address legacy reconnect behaves byte-for-byte as before — this is what `kds_lan_live_offline_buffer_replay_respects_station_filter` pins) and `Device(id)` (when presented); (3) on a replay write-failure every still-undelivered line is re-buffered under the key it was drained from — this also fixes the pre-existing "re-buffer the failed line, silently drop the rest" wart of the old flush loop.
- **Caps chosen + why:** 1,024/queue — carried the DC-2 number verbatim, ~hundreds-of-KB per absent peer. 8,192 total = 8× the per-queue cap: device keying made queue count follow *device count* rather than live connections, so the sum needed its own bound; worst case stays a few MB on a POS machine. Global eviction is oldest-by-insertion-seq, so fresh devices' histories survive a flood. The handoff is `tracing::info!`, both cap evictions `tracing::warn!`.
- **Wire format:** untouched, as ordered — `hello`/`discover` serde shapes unchanged (`device_id` was already parsed; consumed, not extended), buffered lines are stored and replayed as verbatim JSON strings (inside noise frames as before, plaintext unchanged), no `KdsSyncEvent`/`KdsDiscoverResponse` field changed.
- **Known boundary (unchanged by this work order):** only the event whose write FAILS is buffered (the old code had the same shape, stamped by agent 4) — events broadcast while a peer is fully absent remain the `{"op":"discover","want_queue":true}` snapshot's job. Device keying is what makes the failed-write event findable again; a buffering registry for the whole absence window needs a device→subscription map and is deliberately NOT in this fence.

### New tests (all green; names verbatim)

`replay_tests.rs` (6 — buffer semantics, no sockets):
- `per_device_cap_drops_oldest_with_bounded_growth`
- `total_cap_evicts_global_oldest_across_queues`
- `drain_reports_source_addr_and_new_pushes_reattach_it`
- `device_and_addr_keys_never_collide_under_equal_strings`
- `two_devices_do_not_see_each_owners_queues`
- `from_subscription_prefers_device_id_then_falls_back_to_addr`

`lib_tests.rs` (4 — LIVE `LanEventForwarder::run()` on dynamic loopback ports, RST-forced write failure via `SO_LINGER(0)`, every read under a bounded 10 s timeout, bounded polling everywhere):
- `device_peer_reconnect_from_new_port_replays_buffered_events` — **THE point of the order**: tablet hellos `device_id=kds-9`, drops with RST, the failed line is asserted INSIDE the buffer under `ReplayKey::Device("kds-9")` and under NO addr key; the reconnect is bound to an explicitly different port (asserted) and still receives the buffered line FIRST, **byte-identical** to the exact string broadcast (full-line `assert_eq!`, not `contains`), then the live line; buffer drains to 0.
- `station_filter_applies_to_device_keyed_replay` — device queue seeded with a grill + a fry line; a grill subscriber on a fresh port replays only the grill line byte-exact and the drain retires the queue (count → 0).
- `legacy_peer_without_device_id_stays_addr_keyed` — byte-for-byte legacy hello: failed write buffers under `Addr`; a *different* address must NOT inherit the queue (empty stream, count still 1); the SAME address reconnecting replays it (the pre-kds-sync contract, end to end).
- `two_devices_alternating_addresses_do_not_cross_deliver` — dev-a buffers at address X, dev-b buffers at address Y, dev-a reconnects FROM Y: it replays only its own line and dev-b's queue survives untouched — the cross-delivery the old addr keying committed is impossible now.

### Verification tail (AFTER the change)

```
$ cargo test -p oz-lan                     # run 1 + run 2 back-to-back, identical
test result: ok. 73 passed; 0 failed; ...; finished in 9.09s   (x2)
test result: ok. 1 passed; 0 failed; ... (doc-tests)

$ cargo test -p oz-lan replay              # 9 of the 10 new tests by name
test tests::device_peer_reconnect_from_new_port_replays_buffered_events ... ok
test tests::station_filter_applies_to_device_keyed_replay ... ok
test replay::tests::total_cap_evicts_global_oldest_across_queues ... ok
test replay::tests::per_device_cap_drops_oldest_with_bounded_growth ... ok
   (+ 5 more, all ok)

$ cargo test -p oz-lan -- tests::legacy_peer_without_device_id_stays_addr_keyed tests::two_devices_alternating_addresses_do_not_cross_deliver tests::legacy_discover_response_is_byte_identical tests::psk_hello_peer_receives_scoped_events_without_subscription tests::discover_pipelined_with_hello_is_answered tests::noise_peer_subscribes_and_receives_snapshot_and_filter
test result: ok. 6 passed; 0 failed; ...

$ cargo test -p oz-pos-app kds_lan_live    # pass 1: 5 passed; 0 failed (4.89 s)
$ cargo test -p oz-pos-app kds_lan_live    # pass 2: 5 passed; 0 failed (4.86 s) — identical
$ cargo test -p oz-pos-app --lib registration   # 12 passed
$ cargo test -p oz-pos-app --lib state          # 13 passed
```

Byte-compat confirmation for legacy peers: the existing pins all stayed green with zero edits to their assertions — `legacy_discover_response_is_byte_identical`, `psk_hello_peer_receives_scoped_events_without_subscription`, `discover_pipelined_with_hello_is_answered` (the one-connection-level-`BufReader` fix at `355d651a5f` is preserved; no transient readers reintroduced), `noise_peer_subscribes_and_receives_snapshot_and_filter`, and the desktop live suite's rebind-the-same-port replay proofs.

House law: per-file `rustfmt --edition 2024` on exactly the six touched files; no `cargo fmt --all`, no clippy mid-run, no workspace tests, no push/branch/stash/amend; both new files entered via the single-line add-chain. Foreign ` M` state on the fence: none at baseline, none before commit, none after.

### Deferred

- Buffering events for the WHOLE absence window (not just the failed write) — needs a device→subscription registry beyond this order's scope; snapshot reconciliation (`want_queue`) remains the completeness mechanism, as designed in agent 2.
- desktop-client provider wiring note (`with_kds_queue` INTEGRATION comment in `lib.rs`) untouched: `apps/**` is fenced (two live sessions; tablet auth mid-flight).
- `git push`: not run — awaits an explicit order.
