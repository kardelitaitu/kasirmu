---
name: figma-bridge
description: Connect to live Figma design files via figma-mcp-bridge (Figma desktop plugin + MCP server). Inspect layout trees, extract nodes and variables/tokens, inspect component selections, export screenshots, and map Figma designs to kasir.mu React components and tokens.css without hitting Figma REST API rate limits.
---

<!-- Audit stamp: 2026-09-24 · DSH · status: ACCURATE · initial version · REV 2 (28-09-26, DSH docs-auditor, shallow pass): the enforced footer was MISSING and is now added — this was the only one of 22 skills without it, which is exactly what skill-drift-guard check 9 reports as "missing audit date". Re-verified in this pass: the three repo paths this file names all resolve (prototypes/design-language.html, ui/src/theme/tokens.css, shared-ui/locales). The fluent finding in skill-drift-report.md is a FALSE POSITIVE on the feature.ftl / feature.id.ftl PLACEHOLDERS this file documents as patterns, not as ids that should exist. -->

# Figma MCP Bridge — kasir.mu Design Synchronization

kasir.mu uses `figma-mcp-bridge` (a local Figma desktop plugin paired with an MCP server via stdio/npx) to inspect, query, and synchronize live Figma designs with our React front-end without hitting Figma REST API rate limits (which cap free accounts at 6 requests/month).

---

## When to use

- Translating a UI design (e.g. Mobile Welcome Screen, Setup Wizard, Cart Screen) from Figma into kasir.mu React components.
- Inspecting active node selections or layout structures in Figma (`get_selection`, `get_layout_tree`).
- Extracting design tokens, color variables, and typography styles (`get_variable_defs`, `get_styles`) to map to `ui/src/theme/tokens.css`.
- Verifying padding, gaps, border radiuses, and auto-layout settings against `prototypes/design-language.html`.
- Exporting visual references or component screenshots (`get_screenshot`, `save_screenshots`).

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Figma Desktop App + Plugin must be running.** | The browser version of Figma cannot run development manifest plugins. The local MCP server talks directly to the running plugin. |
| 2 | **Always map extracted Figma styles to `ui/src/theme/tokens.css`.** | Never copy raw hex values (`#147EFB`) or pixel measurements into components. Use semantic CSS variables (`var(--color-primary)`, `var(--space-4)`). |
| 3 | **Figma text strings MUST be routed through `@fluent/react`.** | Never hardcode literal text copied from Figma layers. Create entries in `shared-ui/locales/<feature>.ftl` and `<feature>.id.ftl`. |
| 4 | **Interactive elements must receive `data-testid` attributes.** | Follow convention: `feature-element[-action]` in kebab-case (e.g., `setup-submit-button`, `pos-cart-line`). |
| 5 | **Node IDs must use the colon format.** | Figma node IDs look like `4029:12345` or `0:1`. Pass string IDs intact. |
| 6 | **Use read tools first; use write tools only upon explicit request.** | `set_text_content`, `set_node_properties`, etc., mutate the user's canvas. Prefer read tools for code generation. |

---

## Setup & Architecture

```
┌────────────────────────┐         WebSocket         ┌─────────────────────────┐
│ Figma Desktop App      │ ◄───────────────────────► │ @gethopp/               │
│ (Plugin: Manifest dev) │    (localhost / IPC)      │ figma-mcp-bridge (npx)  │
└────────────────────────┘                           └────────────┬────────────┘
                                                                  │ Stdio MCP
                                                                  ▼
                                                     ┌─────────────────────────┐
                                                     │ Antigravity Agent       │
                                                     │ (mcp_config.json)       │
                                                     └─────────────────────────┘
```

1. **MCP Configuration**: Registered globally in `~/.gemini/config/mcp_config.json`:
   ```json
   {
     "mcpServers": {
       "figma-bridge": {
         "command": "npx",
         "args": ["-y", "@gethopp/figma-mcp-bridge"]
       }
     }
   }
   ```
2. **Figma Plugin**: Installed in Figma Desktop via `Plugins > Development > Import plugin from manifest...` targeting `manifest.json`.

---

## Tool Reference

### 1. Document & File Discovery
- `list_files()`: Lists all currently connected Figma files across active plugin windows.
- `get_metadata(fileKey?)`: Retrieves file name, page list, and current active page info.
- `get_document(fileKey?, depth?)`: Returns the page node tree down to a specified depth.

### 2. Node & Selection Inspection
- `get_selection(fileKey?)`: **Most frequent starting point.** Returns the node IDs, layout, properties, and children of whatever the designer currently clicked on in Figma.
- `get_node(nodeId, fileKey?)`: Fetch detailed properties of a specific element (geometry, fills, layout mode, padding, typography).
- `get_layout_tree(nodeId?, depth?, fileKey?)`: Returns an AutoLayout-focused representation (flex direction, alignments, gap, padding, sizing constraints).
- `get_design_context(nodeId?, fileKey?)`: Depth-limited contextual tree optimized for LLM token efficiency.

### 3. Design Tokens & Styling
- `get_variable_defs(fileKey?)`: Extracts Figma variable collections (colors, dimensions, numbers, booleans) across themes (e.g. Light/Dark modes).
- `get_styles(fileKey?)`: Retrieves paint styles (fills/gradients), text styles (font family, weight, size, line-height), and effect styles (drop shadows).

### 4. Visual Export
- `get_screenshot(nodeId?, format?, scale?, fileKey?)`: Exports a base64-encoded image (`png`, `svg`, `jpg`, `pdf`) of a node or the current selection.
- `save_screenshots(nodes, outputDir, format?, scale?, fileKey?)`: Saves exports directly to disk.

---

## Design-to-Code Mapping Pipeline

When converting a Figma frame into kasir.mu UI:

### Step 1: Query the Selection
Ask the user to select the target frame or artboard in Figma, then call:
```json
call_mcp_tool(
  ServerName: "figma-bridge",
  ToolName: "get_selection",
  Arguments: {}
)
```
If specific node IDs are known, inspect via `get_layout_tree` to see AutoLayout direction, gaps, and padding.

### Step 2: Map AutoLayout to CSS Modules
Figma AutoLayout properties map cleanly to CSS Flexbox:

| Figma Property | CSS Equivalent |
|---|---|
| Auto Layout: Vertical | `display: flex; flex-direction: column;` |
| Auto Layout: Horizontal | `display: flex; flex-direction: row;` |
| `itemSpacing: 16` | `gap: var(--space-4);` (or rem equivalent) |
| `paddingTop: 24`, `paddingBottom: 24` | `padding-block: var(--space-6);` |
| `paddingLeft: 16`, `paddingRight: 16` | `padding-inline: var(--space-4);` |
| `primaryAxisAlignItems: CENTER` | `justify-content: center;` |
| `counterAxisAlignItems: CENTER` | `align-items: center;` |
| `layoutSizingHorizontal: FILL` | `width: 100%;` or `flex: 1;` |
| `cornerRadius: 12` | `border-radius: var(--radius-lg);` |

### Step 3: Map Colors & Styles to Tokens
Check `ui/src/theme/tokens.css` before styling:

| Figma Color / Role | kasir.mu Design Token |
|---|---|
| Background Canvas (#12141a) | `var(--color-bg)` |
| Card / Container Fill (#1c1f27) | `var(--color-bg-surface)` |
| Input Box Fill (#262a34) | `var(--color-bg-input)` |
| Primary Blue (#147EFB) | `var(--color-primary)` |
| Primary Text (#e8eaef) | `var(--color-fg)` |
| Secondary / Muted Text (#94a3b8) | `var(--color-fg-muted)` |
| Hairline Border | `1px solid var(--color-border)` |
| Focus Ring | `outline: 2px solid var(--color-border-focus); outline-offset: -2px;` |

### Step 4: Extract Strings to Fluent FTL
For every text node in the Figma tree:
1. Define a semantic FTL ID: `<feature>-<element>[-<state>]`.
2. Add English to `shared-ui/locales/<feature>.ftl`.
3. Add Indonesian to `shared-ui/locales/<feature>.id.ftl`.
4. Render in React using `<Localized id="..."><span>Fallback</span></Localized>`.

---

## Troubleshooting

1. **"Cannot connect to Figma" / Tool hangs**:
   - Ensure the Figma desktop application is running.
   - Verify the `figma-mcp-bridge` plugin is running in the open document (`Plugins > Development > figma-mcp-bridge`).
2. **"No active file connected"**:
   - The plugin UI must be open in the target Figma file tab. Run `list_files` to verify the bridge detected the window.
3. **Empty selection**:
   - Call `list_files` to ensure correct `fileKey`, or instruct the user to click on the desired frame/component in Figma before re-calling `get_selection`.

> last audited 28-09-26 by DSH
