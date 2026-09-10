//! Receipt formats (regional receipt-format axis — the LAST missing axis of
//! saas-2 L167).
//!
//! Owns `receipt_formats` (`20260925_receipt_formats.sql`): ONE closed
//! record per scope, split by owner exactly as the design maps them —
//!
//! * **content** on the legal entity: what MUST appear on a receipt in this
//!   market (a closed element-code enum, footer text, display flags, decimal
//!   separator). Statutory — NOT overridable downstream; a site cannot
//!   silently drop a market-mandated element.
//! * **layout** on workspace/terminal: presentational (paper width, margins,
//!   print copies, logo, footer note). Terminal overrides workspace per
//!   field (deep-merge, terminal wins) — the slice-6 override rule,
//!   presentational edition.
//!
//! Verdict B (supervisor-ratified): a dedicated table, NOT a generic
//! `regional_settings` KV — a closed 10-field record split by owner is
//! resource language a KV expresses only as untyped key-prefix soup, and
//! building a second generic KV beside `settings` for a single consumer is
//! the smell the slice-6 ruling rejected. One row per scope (UNIQUE
//! (scope_type, scope_id)) vs payments' rail list is the deliberate
//! distinction: this axis is a record, not a list.
//!
//! Legacy compat (ratified, pinned): the read falls back to the TEN
//! org-global `settings` keys listed in [`LEGACY_RECEIPT_KEYS`] when no
//! scoped row exists — the exact literal list is pinned by test so the
//! fallback cannot drift when the settings-rebuild stream retires keys. A
//! scoped row OVERRIDES the legacy key for the same concern (also pinned).
//! No data migration, no dual write.
//!
//! `paper_width_mm` is a dedicated INTEGER column with a DB-layer CHECK
//! (BETWEEN 20 AND 120 — supervisor addition 3) so nonsense widths fail at
//! the DB too; the write boundary validates the same range.
//!
//! RLS posture: tenant_id stamped from birth, RLS_EXEMPT like slices 5-6
//! (desktop-local writes; parents already exempt).

use crate::error::CoreError;
use rusqlite::OptionalExtension;
use rusqlite::params;
use serde::Serialize;

/// The closed receipt element-code enum (supervisor addition 2): the only
/// element codes `required_fields` may name. Mirrors the sections the
/// receipt renderer actually consumes (oz-hal `SalesReceipt` /
/// `ReceiptConfig`): store identity, tax registration, date, number,
/// items, money lines, payments. Writes are validated against this list;
/// unknown codes are rejected at the write boundary.
pub const RECEIPT_ELEMENT_CODES: &[&str] = &[
    "store_name",
    "store_address",
    "tax_id",
    "date",
    "receipt_number",
    "items",
    "subtotal",
    "tax",
    "total",
    "payments",
];

/// The TEN legacy org-global `settings` keys the read falls back to when
/// no scoped row exists — pinned verbatim by test
/// (`legacy_fallback_reads_exactly_the_pinned_keys`). Do not rename:
/// platform/core `keys.rs` owns the canonical spellings.
pub const LEGACY_RECEIPT_KEYS: &[&str] = &[
    "receipt.footer",
    "receipt.paper_width",
    "receipt.show_tax",
    "receipt.show_currency",
    "receipt.decimal_separator",
    "receipt.show_table_number",
    "receipt.margin_top",
    "receipt.margin_bottom",
    "receipt.margin_left",
    "receipt.margin_right",
];

/// Who answered for a receipt-format group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptSource {
    /// The legal entity's content row (statutory).
    Entity,
    /// The terminal's layout row (presentational, highest layout layer).
    Terminal,
    /// The workspace's layout row (presentational, terminal's fallback).
    Workspace,
    /// The legacy org-global `settings` keys.
    Legacy,
    /// Nothing configured — the renderer's built-in default applies.
    Unset,
}

impl ReceiptSource {
    /// Stable wire name, mirroring the serde representation.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Entity => "entity",
            Self::Terminal => "terminal",
            Self::Workspace => "workspace",
            Self::Legacy => "legacy",
            Self::Unset => "unset",
        }
    }
}

/// The statutory content half of the receipt format (legal-entity scope).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptContent {
    /// Which receipt elements are market-mandatory — every code is a member
    /// of [`RECEIPT_ELEMENT_CODES`] (validated at the write boundary).
    pub required_fields: Vec<String>,
    /// Footer text (empty = none; ≤ 500 chars, matching the legacy UI cap).
    pub footer_text: String,
    /// Whether the tax line prints.
    pub show_tax: bool,
    /// Whether amounts carry the currency symbol prefix.
    pub show_currency: bool,
    /// `dot` | `comma` | `none`.
    pub decimal_separator: String,
}

/// The presentational layout half (workspace/terminal scope). `None` fields
/// fall through to the next layer (terminal → workspace → legacy →
/// renderer default).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptLayout {
    /// Paper width in mm (20–120; DB-layer CHECK mirrors this).
    pub paper_width_mm: Option<i64>,
    /// Margins in mm (≥ 0).
    pub margin_top_mm: Option<i64>,
    /// Bottom margin in mm (≥ 0).
    pub margin_bottom_mm: Option<i64>,
    /// Left margin in mm (≥ 0).
    pub margin_left_mm: Option<i64>,
    /// Right margin in mm (≥ 0).
    pub margin_right_mm: Option<i64>,
    /// Whether the store logo prints.
    pub show_logo: Option<bool>,
    /// How many copies to print (≥ 0).
    pub print_copies: Option<i64>,
    /// Whether the table number line prints.
    pub show_table_number: Option<bool>,
    /// Optional presentational footer note (≤ 500 chars).
    pub footer_note: Option<String>,
}

/// The effective receipt format for one terminal: statutory content from
/// the store's primary legal entity as-is, layout deep-merged
/// terminal → workspace → legacy, with group-level provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveReceiptFormat {
    /// The market-mandated content, or `None` when neither a scoped row nor
    /// legacy keys exist.
    pub content: Option<ReceiptContent>,
    /// Who answered for the content group.
    pub content_source: ReceiptSource,
    /// The merged presentational layout.
    pub layout: ReceiptLayout,
    /// Who answered for the layout group (highest layer that set anything).
    pub layout_source: ReceiptSource,
}

fn parse_json_object(
    raw: &str,
    field: &'static str,
) -> Result<serde_json::Map<String, serde_json::Value>, CoreError> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|err| CoreError::Validation {
            field,
            message: format!("{field} must be a JSON object: {err}"),
        })?;
    let serde_json::Value::Object(map) = value else {
        return Err(CoreError::Validation {
            field,
            message: format!("{field} must be a JSON object"),
        });
    };
    Ok(map)
}

fn validate_content(content: &ReceiptContent) -> Result<(), CoreError> {
    let mut seen = std::collections::HashSet::new();
    for code in &content.required_fields {
        if !RECEIPT_ELEMENT_CODES.contains(&code.as_str()) {
            return Err(CoreError::Validation {
                field: "required_fields",
                message: format!(
                    "unknown receipt element code {code:?} — the closed enum is {RECEIPT_ELEMENT_CODES:?}"
                ),
            });
        }
        if !seen.insert(code.as_str()) {
            return Err(CoreError::Validation {
                field: "required_fields",
                message: format!("duplicate receipt element code {code:?}"),
            });
        }
    }
    if content.footer_text.chars().count() > 500 {
        return Err(CoreError::Validation {
            field: "footer_text",
            message: "footer_text must be at most 500 characters".into(),
        });
    }
    if !matches!(content.decimal_separator.as_str(), "dot" | "comma" | "none") {
        return Err(CoreError::Validation {
            field: "decimal_separator",
            message: "decimal_separator must be dot, comma, or none".into(),
        });
    }
    Ok(())
}

fn validate_layout(scope_type: &str, layout: &ReceiptLayout) -> Result<(), CoreError> {
    if scope_type != "workspace" && scope_type != "terminal" {
        return Err(CoreError::Validation {
            field: "scope_type",
            message: format!("layout scope must be workspace or terminal; got {scope_type:?}"),
        });
    }
    if let Some(width) = layout.paper_width_mm {
        if !(20..=120).contains(&width) {
            return Err(CoreError::Validation {
                field: "paper_width_mm",
                message: format!("paper_width_mm must be between 20 and 120; got {width}"),
            });
        }
    }
    for (name, mm) in [
        ("margin_top_mm", layout.margin_top_mm),
        ("margin_bottom_mm", layout.margin_bottom_mm),
        ("margin_left_mm", layout.margin_left_mm),
        ("margin_right_mm", layout.margin_right_mm),
    ] {
        if let Some(v) = mm {
            if v < 0 {
                return Err(CoreError::Validation {
                    field: name,
                    message: format!("{name} must not be negative"),
                });
            }
        }
    }
    if let Some(copies) = layout.print_copies {
        if copies < 0 {
            return Err(CoreError::Validation {
                field: "print_copies",
                message: "print_copies must not be negative".into(),
            });
        }
    }
    if let Some(note) = &layout.footer_note {
        if note.chars().count() > 500 {
            return Err(CoreError::Validation {
                field: "footer_note",
                message: "footer_note must be at most 500 characters".into(),
            });
        }
    }
    Ok(())
}

impl crate::db::Store<'_> {
    /// Replace the legal entity's statutory content record (upsert).
    ///
    /// Validates against the closed element enum before the transaction
    /// opens. There is exactly one content row per entity.
    pub fn set_receipt_content_for_entity(
        &self,
        entity_id: &str,
        content: &ReceiptContent,
        now: &str,
    ) -> Result<(), CoreError> {
        validate_content(content)?;
        let config = serde_json::json!({
            "required_fields": content.required_fields,
            "footer_text": content.footer_text,
            "show_tax": content.show_tax,
            "show_currency": content.show_currency,
            "decimal_separator": content.decimal_separator,
        });
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM receipt_formats WHERE scope_type = 'legal_entity' AND scope_id = ?1",
            params![entity_id],
        )?;
        tx.execute(
            "INSERT INTO receipt_formats
                 (id, tenant_id, scope_type, scope_id, config, paper_width_mm, created_at, updated_at)
             VALUES (?1, 'default', 'legal_entity', ?2, ?3, NULL, ?4, ?4)",
            params![uuid::Uuid::now_v7().to_string(), entity_id, config.to_string(), now],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Replace a workspace's or terminal's layout record (upsert).
    pub fn set_receipt_layout_for_scope(
        &self,
        scope_type: &str,
        scope_id: &str,
        layout: &ReceiptLayout,
        now: &str,
    ) -> Result<(), CoreError> {
        validate_layout(scope_type, layout)?;
        let config = serde_json::json!({
            "margin_top_mm": layout.margin_top_mm,
            "margin_bottom_mm": layout.margin_bottom_mm,
            "margin_left_mm": layout.margin_left_mm,
            "margin_right_mm": layout.margin_right_mm,
            "show_logo": layout.show_logo,
            "print_copies": layout.print_copies,
            "show_table_number": layout.show_table_number,
            "footer_note": layout.footer_note,
        });
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM receipt_formats WHERE scope_type = ?1 AND scope_id = ?2",
            params![scope_type, scope_id],
        )?;
        tx.execute(
            "INSERT INTO receipt_formats
                 (id, tenant_id, scope_type, scope_id, config, paper_width_mm, created_at, updated_at)
             VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                uuid::Uuid::now_v7().to_string(),
                scope_type,
                scope_id,
                config.to_string(),
                layout.paper_width_mm,
                now,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The effective receipt format: content from the store's primary legal
    /// entity as-is (statutory, never overridden downstream); layout merged
    /// terminal → workspace → legacy (each layer only fills fields the
    /// higher layer left unset). Legacy = the ten pinned org-global
    /// `settings` keys, consulted only for fields no scoped row supplied.
    ///
    /// `workspace_id` (when the caller already knows the workspace scope,
    /// e.g. the card that just wrote it) wins over the terminal binding and
    /// the primary-location fallbacks.
    pub fn effective_receipt_format(
        &self,
        terminal_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<EffectiveReceiptFormat, CoreError> {
        // ── content: the primary entity's row, or legacy, or unset ──
        let entity_id: Option<String> = self.conn
            .query_row(
                "SELECT legal_entity_id FROM locations WHERE is_primary = 1 AND legal_entity_id IS NOT NULL LIMIT 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let mut content = None;
        let mut content_source = ReceiptSource::Unset;
        if let Some(entity_id) = entity_id {
            let raw: Option<String> = self.conn
                .query_row(
                    "SELECT config FROM receipt_formats WHERE scope_type = 'legal_entity' AND scope_id = ?1",
                    params![entity_id],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(raw) = raw {
                let map = parse_json_object(&raw, "config")?;
                let get_bool = |key: &str| map.get(key).and_then(|v| v.as_bool());
                content = Some(ReceiptContent {
                    required_fields: map
                        .get("required_fields")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default(),
                    footer_text: map
                        .get("footer_text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    show_tax: get_bool("show_tax").unwrap_or(true),
                    show_currency: get_bool("show_currency").unwrap_or(false),
                    decimal_separator: map
                        .get("decimal_separator")
                        .and_then(|v| v.as_str())
                        .unwrap_or("dot")
                        .to_string(),
                });
                content_source = ReceiptSource::Entity;
            }
        }
        if content.is_none() {
            // Legacy fallback: the ten pinned org-global keys.
            let has_any = LEGACY_RECEIPT_KEYS.iter().any(|key| {
                platform_core::settings::Settings::get(&self.conn, key)
                    .map(|v| v.is_some())
                    .unwrap_or(false)
            });
            if has_any {
                content = Some(ReceiptContent {
                    required_fields: Vec::new(),
                    footer_text: platform_core::settings::Settings::get_receipt_footer(&self.conn)
                        .unwrap_or_default(),
                    show_tax: platform_core::settings::Settings::get_receipt_show_tax(&self.conn)
                        .unwrap_or(true),
                    show_currency: platform_core::settings::Settings::get_receipt_show_currency(
                        &self.conn,
                    )
                    .unwrap_or(false),
                    decimal_separator:
                        platform_core::settings::Settings::get_receipt_decimal_separator(&self.conn)
                            .unwrap_or_else(|_| "dot".into()),
                });
                content_source = ReceiptSource::Legacy;
            }
        }

        // ── layout: terminal → workspace → legacy (deep merge) ──
        let mut layout = ReceiptLayout {
            paper_width_mm: None,
            margin_top_mm: None,
            margin_bottom_mm: None,
            margin_left_mm: None,
            margin_right_mm: None,
            show_logo: None,
            print_copies: None,
            show_table_number: None,
            footer_note: None,
        };
        let mut layout_source = ReceiptSource::Unset;

        let load_layout = |scope_type: &str,
                           scope_id: &str|
         -> Result<Option<ReceiptLayout>, CoreError> {
            let row: Option<(Option<String>, Option<i64>)> = self.conn
                .query_row(
                    "SELECT config, paper_width_mm FROM receipt_formats WHERE scope_type = ?1 AND scope_id = ?2",
                    params![scope_type, scope_id],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<i64>>(1)?,
                        ))
                    },
                )
                .optional()?;
            let Some((raw, width)) = row else {
                return Ok(None);
            };
            let map = parse_json_object(raw.as_deref().unwrap_or("{}"), "config")?;
            let get_i64 = |key: &str| map.get(key).and_then(|v| v.as_i64());
            let get_bool = |key: &str| map.get(key).and_then(|v| v.as_bool());
            Ok(Some(ReceiptLayout {
                paper_width_mm: width,
                margin_top_mm: get_i64("margin_top_mm"),
                margin_bottom_mm: get_i64("margin_bottom_mm"),
                margin_left_mm: get_i64("margin_left_mm"),
                margin_right_mm: get_i64("margin_right_mm"),
                show_logo: get_bool("show_logo"),
                print_copies: get_i64("print_copies"),
                show_table_number: get_bool("show_table_number"),
                footer_note: map
                    .get("footer_note")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            }))
        };

        // Terminal layer (highest).
        if let Some(terminal_id) = terminal_id {
            if let Some(terminal) = load_layout("terminal", terminal_id)? {
                layout = terminal;
                layout_source = ReceiptSource::Terminal;
            }
        }
        // Workspace layer: the caller's explicit scope wins (the card that
        // just wrote it), then the terminal's bound location, then the
        // primary location.
        let mut resolved_workspace = workspace_id.map(str::to_string);
        if resolved_workspace.is_none() {
            if let Some(id) = terminal_id {
                resolved_workspace = self
                    .conn
                    .query_row(
                        "SELECT bound_location_id FROM terminals WHERE id = ?1",
                        params![id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()?
                    .flatten();
            }
        }
        if resolved_workspace.is_none() {
            resolved_workspace = self
                .conn
                .query_row(
                    "SELECT id FROM locations WHERE is_primary = 1 LIMIT 1",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
        }
        let workspace_id = resolved_workspace;
        if let Some(workspace_id) = workspace_id {
            if let Some(workspace) = load_layout("workspace", &workspace_id)? {
                // Deep merge: the terminal row only fills what it unset.
                if layout.paper_width_mm.is_none() {
                    layout.paper_width_mm = workspace.paper_width_mm;
                }
                if layout.margin_top_mm.is_none() {
                    layout.margin_top_mm = workspace.margin_top_mm;
                }
                if layout.margin_bottom_mm.is_none() {
                    layout.margin_bottom_mm = workspace.margin_bottom_mm;
                }
                if layout.margin_left_mm.is_none() {
                    layout.margin_left_mm = workspace.margin_left_mm;
                }
                if layout.margin_right_mm.is_none() {
                    layout.margin_right_mm = workspace.margin_right_mm;
                }
                if layout.show_logo.is_none() {
                    layout.show_logo = workspace.show_logo;
                }
                if layout.print_copies.is_none() {
                    layout.print_copies = workspace.print_copies;
                }
                if layout.show_table_number.is_none() {
                    layout.show_table_number = workspace.show_table_number;
                }
                if layout.footer_note.is_none() {
                    layout.footer_note = workspace.footer_note;
                }
                if layout_source == ReceiptSource::Unset {
                    layout_source = ReceiptSource::Workspace;
                }
            }
        }
        // Legacy layout keys fill whatever no scoped row supplied — but only
        // when a legacy key is ACTUALLY set; otherwise the values below are
        // the renderer's BUILT-IN defaults, and the honest source is Unset,
        // not Legacy (a default is not a configuration).
        let legacy_layout_keys_set = [
            platform_core::settings::keys::RECEIPT_PAPER_WIDTH,
            platform_core::settings::keys::RECEIPT_MARGIN_TOP,
            platform_core::settings::keys::RECEIPT_MARGIN_BOTTOM,
            platform_core::settings::keys::RECEIPT_MARGIN_LEFT,
            platform_core::settings::keys::RECEIPT_MARGIN_RIGHT,
            platform_core::settings::keys::RECEIPT_SHOW_TABLE_NUMBER,
        ]
        .iter()
        .any(|key| {
            platform_core::settings::Settings::get(&self.conn, key)
                .map(|v| v.is_some())
                .unwrap_or(false)
        });
        if layout.paper_width_mm.is_none() {
            let width = platform_core::settings::Settings::get_receipt_paper_width(&self.conn)
                .unwrap_or_else(|_| "standard".into());
            layout.paper_width_mm = match width.as_str() {
                "narrow" => Some(58),
                "standard" => Some(80),
                _ => None,
            };
        }
        if layout.margin_top_mm.is_none() {
            layout.margin_top_mm = Some(
                platform_core::settings::Settings::get_receipt_margin_top(&self.conn).unwrap_or(0),
            );
        }
        if layout.margin_bottom_mm.is_none() {
            layout.margin_bottom_mm = Some(
                platform_core::settings::Settings::get_receipt_margin_bottom(&self.conn)
                    .unwrap_or(0),
            );
        }
        if layout.margin_left_mm.is_none() {
            layout.margin_left_mm = Some(
                platform_core::settings::Settings::get_receipt_margin_left(&self.conn).unwrap_or(0),
            );
        }
        if layout.margin_right_mm.is_none() {
            layout.margin_right_mm = Some(
                platform_core::settings::Settings::get_receipt_margin_right(&self.conn)
                    .unwrap_or(0),
            );
        }
        if layout.show_table_number.is_none() {
            layout.show_table_number = Some(
                platform_core::settings::Settings::get_receipt_show_table_number(&self.conn)
                    .unwrap_or(false),
            );
        }
        if layout_source == ReceiptSource::Unset && legacy_layout_keys_set {
            layout_source = ReceiptSource::Legacy;
        }

        Ok(EffectiveReceiptFormat {
            content,
            content_source,
            layout,
            layout_source,
        })
    }
}

#[cfg(test)]
#[path = "receipt_formats_tests.rs"]
mod tests;
