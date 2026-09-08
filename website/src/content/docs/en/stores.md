---
title: Stores & Topology
description: Model branches, registers, and warehouses in one visual editor.
category: guides
order: 6
updated: "2026-09-08"
---

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Customer-facing page, first audit evidence it ever carried. · Finding: the deploy-history capability from ADR #46 shipped end to end (migration 20260915_topology_revisions.sql, three registered commands, ui/src/api/topology.ts, TopologyRevisionBrowser.tsx mounted by TopologyScreen.tsx:17 with topology-history-open as its trigger) yet this page described only apply-time diffing and Compare branches. A customer reading it would not know rollback exists. New “Deploy history” section added; every button name in it is real Fluent copy from ui/src/locales/multi-location.ftl (Show on canvas, Restore to editor, Pin this deploy, Unpin this deploy), and the preview-is-not-restore distinction plus the claim that a restored deploy becomes a NEW revision come from the component's own header comment and TopologyScreen.tsx:179, not from the ADR. · Two of my own draft claims were caught by verification before landing: “from the editor” was wrong (the host is TopologyScreen, not NodeTopologyEditor - the browser is imported in exactly two files, one of them a test), and two names I had flagged as undefined Fluent keys turned out to be CSS class names. · The id/ counterpart was NOT translated - see its own stamp. -->

## The topology editor

Stores, registers, warehouses, and hardware are arranged in a visual diagram —
the **Visual Store & Workspace Topology Builder**. Nodes are dragged from the
palette (or added with the number keys) and wired together on a canvas with
zoom, pan, minimap, auto-layout, snap-to-grid, and undo/redo. Ready-made
**Retail** and **Resto & KDS** presets scaffold a full store in one click, and
a **Test Order Simulation** sends test tickets through the layout so you can
watch the flow before going live.

## Nodes and connections

Each node is a real piece of your business: **Store** (branch location),
**Retail POS**, **Restaurant POS**, **Kitchen Display (KDS)**, **Warehouse**,
**Stock Room**, and **Hardware** (printers and peripherals). Cards expose typed
ports — **Location**, **Operation**, **Stock In/Out**, **Ticket**, and
**Device** — and connecting two ports asks what the wire means: stock routing,
inventory transfer, ticket routing, device connection, or operation. Wire
direction cycles one-way → reverse → two-way, so the diagram shows exactly
which way stock, tickets, and operations flow.

## Validation

The editor validates the layout as you build. An issues panel flags problems
live: exactly one branch location per graph, every workspace connected to its
branch via **Location In**, every KDS fed by a Restaurant POS via **Operation
In**, no directed cycles, and no duplicate nodes or wires. Warehouse warnings
appear when storage is at capacity or nothing routes stock into it.

## Applying changes

Applying the topology is a manager- or owner-only action — everyone else sees
a view-only canvas. Apply shows a diff summary of what will change (created,
updated, archived, type-changed, with the revision number) before it is saved.
If the topology changed on another register meanwhile, the editor loads the
latest version and asks you to re-apply.

## Deploy history

Every applied change to a branch's layout is recorded, newest first, with who applied
it, when, and the note they left. Open **Deploy history** from the topology screen to
browse it; a branch that has never been applied says so and lists nothing.

Selecting an entry can **preview** it: the past layout is drawn over your current canvas
as a ghost overlay via **Show on canvas** — the same rendering **Compare branches**
uses — so additions, removals and changes are visible side by side without touching your
work. Each row tells you how many changes have landed since that deploy, or that it
matches what is live now.

**Preview is not restore.** **Restore to editor** loads that layout in as an *unsaved
draft*, intercepted first if you have unsaved edits to lose; nothing becomes live until you
apply it yourself, with the usual manager-or-owner permission and diff summary. Applying a
restored draft records it as a **new** deploy — history is never rewritten, so the rollback
itself is auditable.

**Pin this deploy** keeps an entry out of retention pruning. Pruned entries stay listed
with their who/when/why intact, flagged that the snapshot is gone, and only their preview
and restore are withdrawn — so "what did we deploy on Tuesday" stays answerable after the
layout itself has been discarded.

## Branches, templates, and sharing

Topologies live per branch. A **Compare Branches** view shows what differs
between two branches and can focus on the differences. Templates save a layout
for reuse, and a topology can be **exported** to the clipboard and **imported**
elsewhere — handy for rolling out the same layout to every branch.

## Plan limits

The number of stores, registers, and warehouses is set by your plan tier. The
editor flags anything that exceeds your limits before you apply it, and
multiple warehouses or warehouse capacity limits require a Pro tier license.

## Keep devices in sync

Devices pull the topology when they reconnect, so a new register appears on
every screen without manual setup.

> last audited 08-09-26 by docs-auditor
