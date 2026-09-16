---
title: Offline-First Mode
description: How kasir.mu keeps working with zero connectivity.
category: guides
order: 1
updated: "2026-08-16"
---

## How it works

<svg class="docs-flow" role="img" aria-label="Offline flow: a sale is written to the local database first; online it syncs to the cloud, offline it waits in the queue and drains to the cloud when the connection returns; every register then updates." viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)"/>
    </marker>
  </defs>
  <rect x="8" y="32" width="130" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="73" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Sale or change</text>
  <line x1="138" y1="60" x2="160" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <rect x="160" y="32" width="145" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="232.5" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Local database first</text>
  <line x1="305" y1="60" x2="338" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <polygon points="338,60 390,28 442,60 390,92" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="390" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Online?</text>
  <line x1="442" y1="60" x2="492" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <text x="467" y="50" text-anchor="middle" font-size="12" fill="var(--color-muted)">yes</text>
  <rect x="492" y="32" width="115" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="549.5" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Cloud sync</text>
  <line x1="607" y1="60" x2="632" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <rect x="632" y="32" width="125" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="694.5" y="54" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="694.5" dy="0">All registers</tspan><tspan x="694.5" dy="15">update</tspan></text>
  <line x1="390" y1="92" x2="390" y2="158" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <text x="398" y="128" font-size="12" fill="var(--color-muted)">no</text>
  <rect x="325" y="158" width="130" height="44" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="390" y="185" text-anchor="middle" font-size="13" fill="var(--color-ink)">Offline queue</text>
  <line x1="455" y1="180" x2="530" y2="92" stroke="var(--color-accent)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#flow-arrow)"/>
  <text x="472" y="142" font-size="12" fill="var(--color-muted)">reconnect</text>
</svg>

Every change is written to the device's local database first. While offline
it waits in the queue; once connected, the queue drains in order and the
cloud confirms each item.

## Nothing stops at the counter

Sales, shifts, stock movements, and settings changes all write to the local
database first. A lost connection never blocks a transaction.

## The offline queue

Every change — a sale, a shift event, a stock movement, a settings update —
is appended to the outbound queue. When connectivity returns, the queue
drains in order and the server acknowledges each item. Every item is tracked
as pending, synced, or failed, so nothing disappears silently.

## Checking the queue

The Offline Queue screen (manager) shows how many items are pending, synced,
and failed, plus any conflicts, the last successful sync, and how old the
oldest pending item is. Use **Sync All** to drain immediately, pull to
refresh, or delete a stuck item. Items from the server that repeatedly fail
to apply are quarantined and can be requeued once the cause is fixed.

## Conflicts

Because each register works on its own local data and merges are
order-based, conflicts are rare and resolve deterministically — the latest
change wins for each record. Resolved conflicts surface as a count on the
queue screen, so you know it happened.

## Cloud sync and plans

Cloud sync moves the queue between registers and is part of paid plans. On a
plan without sync, the offline queue keeps working exactly the same — sales
are safe locally and drain the moment you upgrade. See
[Cloud Sync](../cloud-sync/) for what syncs and how to check its status.
