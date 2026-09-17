use super::*;

#[test]
fn brand_settings_debug() {
    let dto = BrandSettingsDto {
        primary_colour: "#10b981".into(),
        logo_path: Some("/logo.png".into()),
        store_name: "My Store".into(),
    };
    let debug = format!("{:?}", dto);
    assert!(debug.contains("My Store"));
}

#[test]
fn brand_settings_serialize() {
    let dto = BrandSettingsDto {
        primary_colour: "#ff0000".into(),
        logo_path: Some("/logo.png".into()),
        store_name: "Test".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["primary_colour"], "#ff0000");
    assert_eq!(json["logo_path"], "/logo.png");
}

#[test]
fn brand_settings_no_logo_path() {
    let dto = BrandSettingsDto {
        primary_colour: "#000000".into(),
        logo_path: None,
        store_name: "NoLogo".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert!(json["logo_path"].is_null());
}

#[test]
fn brand_settings_deserialize_no_logo() {
    let json = r##"{"primary_colour":"#10b981","logo_path":null,"store_name":"Store"}"##;
    let dto: BrandSettingsDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.primary_colour, "#10b981");
    assert!(dto.logo_path.is_none());
}
