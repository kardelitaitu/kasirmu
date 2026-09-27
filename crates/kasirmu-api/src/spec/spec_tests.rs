use super::*;

/// Walk every string in `v` shaped like `#/components/...` and collect
/// the JSON pointer it implies.
fn collect_refs(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            for child in map.values() {
                collect_refs(child, out);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_refs(child, out);
            }
        }
        Value::String(s) if s.starts_with("#/components/") => {
            out.push(s.clone());
        }
        _ => {}
    }
}

/// Resolve a `#/components/schemas/Foo/bar` pointer against the spec.
fn ref_resolves(spec: &Value, pointer: &str) -> bool {
    let mut cur = spec;
    for seg in pointer.trim_start_matches("#/").split('/') {
        match cur.get(seg) {
            Some(next) => cur = next,
            None => return false,
        }
    }
    true
}

#[test]
fn base_spec_is_well_formed() {
    let spec = base_spec();
    assert_eq!(spec["openapi"], "3.1.0");
    assert!(spec["info"]["title"].is_string());
    assert!(!spec["paths"].as_object().unwrap().is_empty());
    assert!(spec["components"]["securitySchemes"]["bearerAuth"].is_object());
    // Round-trips through JSON without panic.
    let _ = serde_json::to_string(&spec).unwrap();
}

#[test]
fn every_base_operation_is_scoped_both() {
    let spec = base_spec();
    let paths = spec["paths"].as_object().unwrap();
    let mut count = 0usize;
    for (path, item) in paths {
        for (verb, op) in item.as_object().unwrap() {
            if !is_operation_key(verb) {
                continue;
            }
            count += 1;
            assert_eq!(
                op["x-oz-scope"],
                json!(SCOPE_BOTH),
                "{verb} {path} must carry x-oz-scope=both in the base document"
            );
        }
    }
    // Sanity floor: the shared surface is ~30 operations; a wholesale
    // annotate failure must fail loudly.
    assert!(count >= 25, "only {count} operations found — broken?");
}

#[test]
fn base_paths_are_the_shared_surface_only() {
    let spec = base_spec();
    let paths = spec["paths"].as_object().unwrap();
    for path in paths.keys() {
        assert!(
            path.starts_with("/api/v1/") || path == "/api/openapi.json",
            "base spec leaked cloud-only path {path}"
        );
    }
    // The self-documenting path is part of the shared surface.
    assert!(paths.contains_key("/api/openapi.json"));
}

#[test]
fn every_base_ref_resolves() {
    let spec = base_spec();
    let mut refs = Vec::new();
    collect_refs(&spec["paths"], &mut refs);
    collect_refs(&spec["components"]["schemas"], &mut refs);
    assert!(!refs.is_empty(), "no refs found — walker broken?");
    for pointer in &refs {
        assert!(
            ref_resolves(&spec, pointer),
            "dangling $ref {pointer} — schema moved out of the base document?"
        );
    }
}

#[test]
fn local_spec_injects_loopback_server_and_title() {
    let spec = local_spec(3099);
    assert_eq!(spec["info"]["title"], "kasir.mu Local Terminal API");
    assert_eq!(spec["servers"][0]["url"], "http://127.0.0.1:3099");
    // Same shared path set as the base document.
    let base = base_spec();
    assert_eq!(
        spec["paths"].as_object().unwrap().len(),
        base["paths"].as_object().unwrap().len()
    );
}

#[test]
fn annotate_scope_skips_non_operation_keys() {
    let mut paths = json!({
        "/x": {
            "parameters": [{ "name": "p" }],
            "get": { "summary": "s" },
            "summary": "item summary"
        }
    });
    annotate_scope(&mut paths, "cloud");
    assert_eq!(paths["/x"]["get"]["x-oz-scope"], json!("cloud"));
    assert!(paths["/x"]["parameters"].get("x-oz-scope").is_none());
    assert!(paths["/x"]["summary"].get("x-oz-scope").is_none());
}

#[test]
fn pagination_parameters_live_in_components_parameters() {
    let spec = base_spec();
    // Parameter Objects must not sit under components/schemas — they
    // are not Schema Objects (review LOW-9).
    assert!(
        spec["components"]["schemas"]
            .get("PaginationParams")
            .is_none()
    );
    for name in [
        "PaginationLimit",
        "PaginationOffset",
        "PaginationSort",
        "PaginationOrder",
        "PaginationQ",
    ] {
        let p = &spec["components"]["parameters"][name];
        assert_eq!(p["in"], "query", "{name} must be a query Parameter Object");
        assert!(p["name"].is_string(), "{name} must carry its name");
    }
    // Every path-level $ref resolves — including the new pointers.
    let mut refs = Vec::new();
    collect_refs(&spec["paths"], &mut refs);
    assert!(
        refs.iter()
            .any(|r| r == "#/components/parameters/PaginationLimit"),
        "pagination refs were not moved: {refs:?}"
    );
    for r in &refs {
        assert!(ref_resolves(&spec, r), "unresolved {r}");
    }
}

#[test]
fn local_spec_has_no_dev_mode_affordance() {
    // Canary first: the shared document does mention dev mode, so the
    // strip has a target and a wording rename cannot pass silently.
    let base = serde_json::to_string(&base_spec()).unwrap();
    assert!(base.contains("open in dev mode"));
    let local = serde_json::to_string(&local_spec(3099)).unwrap();
    assert!(
        !local.contains("open in dev mode"),
        "desktop doc must not advertise open-in-dev minting"
    );
}

// ── Schema-vs-struct field correspondence ────────────────────────────
//
// This pins the class of drift that let `UserResponse` omit `pin_hash` while
// the handler returned the full `User`, and that separately let `CategoryDto`
// declare a `created_at` the struct does not have and `TaxRateResponse`
// declare a `tenant_id` it does not have. Review cannot catch this reliably —
// a schema and a struct live in different files and neither references the
// other — so the correspondence is asserted here against the TYPES.

/// Serialized field names of a value, sorted.
fn field_names<T: serde::Serialize>(value: &T) -> Vec<String> {
    let v = serde_json::to_value(value).expect("serialize");
    let mut names: Vec<String> = v
        .as_object()
        .expect("struct serializes to an object")
        .keys()
        .cloned()
        .collect();
    names.sort();
    names
}

/// Declared property names of a component schema, sorted.
fn schema_field_names(schema: &str) -> Vec<String> {
    let spec = base_spec();
    let mut names: Vec<String> = spec["components"]["schemas"][schema]["properties"]
        .as_object()
        .unwrap_or_else(|| panic!("schema {schema} has no properties"))
        .keys()
        .cloned()
        .collect();
    names.sort();
    names
}

/// A `Category` must serialize exactly the fields `CategoryDto` declares.
/// The schema previously named a `created_at` the struct does not have while
/// omitting the `icon` it does — drift in BOTH directions at once.
#[test]
fn category_dto_matches_the_struct() {
    let category = kasirmu_core::Category {
        id: "cat-1".into(),
        name: "Drinks".into(),
        colour: "#06b6d4".into(),
        icon: "cup".into(),
    };
    assert_eq!(
        schema_field_names("CategoryDto"),
        field_names(&category),
        "CategoryDto must declare exactly the fields Category serializes"
    );
}

/// A `TaxRate` must serialize exactly the fields `TaxRateResponse` declares.
/// The schema previously named a `tenant_id` the struct does not have while
/// omitting the `updated_at` it does.
#[test]
fn tax_rate_response_matches_the_struct() {
    let rate = kasirmu_core::tax_rate::TaxRate {
        id: "tax-1".into(),
        name: "VAT 10%".into(),
        rate_bps: 1000,
        is_default: true,
        is_inclusive: false,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-02T00:00:00Z".into(),
    };
    assert_eq!(
        schema_field_names("TaxRateResponse"),
        field_names(&rate),
        "TaxRateResponse must declare exactly the fields TaxRate serializes"
    );
}

/// Every schema property must be declared required, for the components whose
/// source struct has no optional members. A partial `required` list is how a
/// schema silently stops describing its own response.
#[test]
fn fully_populated_schemas_declare_every_property_required() {
    for schema in ["CategoryDto", "TaxRateResponse"] {
        let spec = base_spec();
        let props = schema_field_names(schema);
        let mut required: Vec<String> = spec["components"]["schemas"][schema]["required"]
            .as_array()
            .unwrap_or_else(|| panic!("schema {schema} declares no required list"))
            .iter()
            .map(|v| v.as_str().expect("required entries are strings").to_owned())
            .collect();
        required.sort();
        assert_eq!(
            required, props,
            "{schema}: every property must be required, since its source struct has no optional fields"
        );
    }
}
