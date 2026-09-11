//! Relocated legal-entity command tests (Wave-F test relocation: moved out
//! of `apps/desktop-client/src/commands/legal_entities_tests.rs`).
//!
//! Mounted at the foot of `legal_entities.rs` with `#[cfg(test)] #[path]`,
//! so `use super::*` resolves `LegalEntityDto` and `CreateLegalEntityArgs`
//! (defined in this module) exactly as the desktop re-export did. Pure
//! serde wire-shape cases: no context, no harness, assertions unchanged.

use super::*;

#[test]
fn legal_entity_dto_uses_camel_case_wire_fields() {
    let dto = LegalEntityDto {
        id: "entity-1".into(),
        tenant_id: "default".into(),
        name: "Main Entity".into(),
        legal_name: "Main Entity LLC".into(),
        registration_number: "REG-1".into(),
        tax_id: "TAX-1".into(),
        status: "active".into(),
        created_at: "2026-09-06T00:00:00Z".into(),
        updated_at: "2026-09-06T00:00:00Z".into(),
    };
    let json = serde_json::to_value(dto).unwrap();
    assert_eq!(json["tenantId"], "default");
    assert_eq!(json["legalName"], "Main Entity LLC");
    assert_eq!(json["registrationNumber"], "REG-1");
    assert!(json.get("tenant_id").is_none());
}

#[test]
fn create_args_deserialize_camel_case_fields() {
    let args: CreateLegalEntityArgs = serde_json::from_value(serde_json::json!({
        "id": "entity-2",
        "name": "Second Entity",
        "legalName": "Second Entity LLC",
        "registrationNumber": "REG-2",
        "taxId": "TAX-2",
        "status": "active"
    }))
    .unwrap();
    assert_eq!(args.legal_name, "Second Entity LLC");
    assert_eq!(args.registration_number, "REG-2");
    assert_eq!(args.tax_id, "TAX-2");
}
