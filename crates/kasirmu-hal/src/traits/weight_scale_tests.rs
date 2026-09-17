use super::*;

#[test]
fn weight_reading_serde_roundtrip() {
    let reading = WeightReading {
        weight_grams: 250.5,
        stable: true,
    };
    let json = serde_json::to_string(&reading).unwrap();
    let back: WeightReading = serde_json::from_str(&json).unwrap();
    assert!((back.weight_grams - 250.5).abs() < 0.01);
    assert!(back.stable);
}

#[test]
fn weight_reading_unstable() {
    let reading = WeightReading {
        weight_grams: 0.0,
        stable: false,
    };
    let json = serde_json::to_value(&reading).unwrap();
    assert_eq!(json["weight_grams"], 0.0);
    assert!(!json["stable"].as_bool().unwrap());
}
