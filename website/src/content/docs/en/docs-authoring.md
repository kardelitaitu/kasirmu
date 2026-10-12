---
title: Docs Styling Guide
description: How to use callouts, links, tables, code, and charts when writing documentation.
category: reference
order: 4
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · First audit stamp on this page. MINOR, FIXED: the §Callouts list documented five labels (Note, Info, Tip, Warning, Danger) but the renderer accepts SIX — `caution` is in its `KINDS` map, aliased to the warning style (website/src/plugins/rehype-callouts.mjs, KINDS = {note, info, tip, warning, caution, danger}). A writer reading only this guide would not know `Caution` works. Added as an explicit alias, with the note that it is not a distinct color, since a label list that under-reports the accepted set is the one kind of omission a styling guide cannot afford. · VERIFIED AND LEFT ALONE: the doc-parity instruction is correct as written — `python3 scripts/check-doc-parity.py` must run FROM website/ (from the repo root it fails with "can't open file .../scripts/check-doc-parity.py"; from website/ it exits 0 with "OK: 20 page pairs in parity"); Mermaid is genuinely wired (website/astro.config.mjs:8-10,44-50 imports rehype-mermaid + rehype-mermaid-class, and the caveat that an unwired renderer would show plain text is exactly the inert-control framing this repo uses elsewhere); the branded-diagram rules match the working examples — `class="docs-flow"` rule at global.css:382 and a real ARIA-labelled inline SVG in offline-mode.md; every design token the section names (--color-accent, --color-surface, --color-ink, --color-muted) is a live token. · NOT re-measured: the build-time SVG output of a Mermaid block (needs a site build with .astro wiped, per that plugin's own warning). · Footer is an internal marker, stripped from the built site. -->

## Callouts

Callouts highlight important information. Write a blockquote whose first line
starts with a bold label — the label picks the color:

> **Note:** General information worth knowing. The default callout style.

> **Info:** Background context or additional details.

> **Tip:** A shortcut, best practice, or recommended approach.

> **Warning:** Something to be careful about — it may not do what you expect.

> **Danger:** An action that can cause data loss or break an installation.

> **Caution:** An alias for **Warning** — the renderer maps `caution` to the same
> style, so the two are interchangeable and neither is a distinct color.

Any text after the bold label is the callout body:

> **Warning:** Always back up your database before running a migration.

## Links

Relative links between docs pages use the page slug:

```
See the [cloud sync](../cloud-sync/) guide.
```

Renders as: See the [cloud sync](../cloud-sync/) guide.

## Tables

Pipe tables render with a bordered style:

| Feature        | Included |
| -------------- | -------- |
| Cloud sync     | ✓        |
| QRIS payments  | ✓        |
| Lua scripting  | ✓        |

## Code

Inline code uses backticks, e.g. `Money::from_minor(1000)`. Fenced blocks
render in a bordered, scrollable box:

```rust
let total = cart.total();
let due = total - discount;
```

## Charts & diagrams

Charts are written as text, not pasted as images. The site uses **Mermaid** —
diagrams live in fenced `mermaid` blocks and are rendered to static SVG at
build time (through the same rehype pipeline as callouts), so pages stay
JavaScript-free and the CSP never changes. If a `mermaid` block ever shows up
as plain text, the renderer is not wired into `astro.config.mjs` yet.

> **Note:** Mermaid is for structure — flows, sequences, states, and
> relationships. For numbers (pricing, quotas, feature comparisons) keep using
> tables, and for what the app actually looks like use a real screenshot.
> Mermaid's statistical charts (pie, bar) are too limited to carry data.

### Flowchart

```mermaid
flowchart LR
    A[Checkout] --> B[Paddle webhook]
    B --> C{License exists?}
    C -- yes --> D[No-op — replayed event]
    C -- no --> E[Mint key + email receipt]
```

### Sequence diagram

```mermaid
sequenceDiagram
    participant POS as POS client
    participant L as License server
    POS->>L: activate(key)
    L-->>POS: RSA-signed subscription
```

### Branded diagrams

For a hero diagram that must match the site exactly — the dark/light toggle
included — hand-build an inline SVG instead of using Mermaid. Every fill and
stroke is a design-token `var()`, so the diagram re-themes with the page.
See [Offline-First Mode](../offline-mode/) for a working example.

- Outlines, arrows, and the arrowhead use `var(--color-accent)` (the green
  brand color); box fills use `var(--color-surface)`; labels use
  `var(--color-ink)`; edge labels use `var(--color-muted)`.
- Add `class="docs-flow"` to the `<svg>` so it scales down on small screens
  (the rule lives in `global.css`), and keep the canvas close to 760×250
  with one row of about five boxes — a hero diagram must read at a glance.
- Short labels fit on one line; longer ones use two `<tspan>` lines inside
  the `<text>` instead of a wider box.
- Use a diamond `<polygon>` for a decision, and label every edge ("yes",
  "no", "reconnect") with 12px muted text.
- Define one `<marker id="flow-arrow">` arrowhead in `<defs>` and reference
  it from every line via `marker-end="url(#flow-arrow)"`.
- Give the `<svg>` `role="img"` and an `aria-label` that describes the flow.
- Keep the markup on contiguous lines — a blank line inside the tag breaks
  it out of the HTML block.

### Rules

- One idea per diagram; keep it under ~10 nodes.
- Label every edge; never rely on color alone to carry meaning.
- Add a plain-text summary after every diagram — screen readers and search
  engines read the markdown, not the SVG.
- Keep the `mermaid` source in the page. Never replace it with an exported
  PNG: the source is what stays reviewable, diffable, and translatable.

## Locale parity

Every `en` page needs an `id` twin with the same filename. Run the checker
after adding, renaming, or removing a page:

```sh
python3 scripts/check-doc-parity.py   # from website/
```

It fails when a counterpart is missing, and warns on heading-count or
`updated` drift between locales. The `updated` frontmatter of both locales
moves together whenever content changes — it is the page's freshness
signal, so editing a page without bumping it is itself drift.

> last audited 11-10-26 by docs-auditor
