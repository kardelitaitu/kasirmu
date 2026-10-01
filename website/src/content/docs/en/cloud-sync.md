---
title: Cloud Sync
description: Sync across locations and registers through the cloud.
category: guides
order: 8
updated: "2026-10-01"
---

## How sync works

<svg class="docs-flow" role="img" aria-label="Sync flow: each register keeps a local copy and pushes and pulls changes through the shared cloud server." viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)"/>
    </marker>
  </defs>
  <rect x="20" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="95" y="92" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="95" dy="0">Register 1</tspan><tspan x="95" dy="15">local copy</tspan></text>
  <line x1="170" y1="100" x2="305" y2="100" stroke="var(--color-accent)" stroke-width="1.5" marker-start="url(#flow-arrow)" marker-end="url(#flow-arrow)"/>
  <text x="237.5" y="88" text-anchor="middle" font-size="12" fill="var(--color-muted)">push &amp; pull</text>
  <rect x="305" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="380" y="102" text-anchor="middle" font-size="13" fill="var(--color-ink)">Cloud</text>
  <line x1="455" y1="100" x2="590" y2="100" stroke="var(--color-accent)" stroke-width="1.5" marker-start="url(#flow-arrow)" marker-end="url(#flow-arrow)"/>
  <text x="522.5" y="88" text-anchor="middle" font-size="12" fill="var(--color-muted)">push &amp; pull</text>
  <rect x="590" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="665" y="92" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="665" dy="0">Register 2</tspan><tspan x="665" dy="15">local copy</tspan></text>
</svg>

Each device maintains a local copy of everything it needs. Changes are pushed
to the cloud server and pulled by every other device, so all registers see the
same products, prices, and stock.

## Sync status

The status screen shows queue depth, last successful sync, and any pending
items. A healthy queue drains within seconds of reconnecting.

## What syncs

Sales, stock movements, shifts, staff, products, and topology changes all
sync. The tenant is isolated per account, so data never crosses between
businesses.
