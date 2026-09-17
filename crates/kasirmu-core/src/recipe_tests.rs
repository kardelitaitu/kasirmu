use super::*;

#[test]
fn recipe_item_creation() {
    let item = RecipeItem {
        id: "r1".into(),
        parent_product_id: "burger".into(),
        ingredient_product_id: "bun".into(),
        quantity_required: 1,
        unit: "pcs".into(),
    };
    assert_eq!(item.parent_product_id, "burger");
    assert_eq!(item.ingredient_product_id, "bun");
    assert_eq!(item.quantity_required, 1);
}

#[test]
fn recipe_item_large_quantity() {
    let item = RecipeItem {
        id: "r2".into(),
        parent_product_id: "pasta".into(),
        ingredient_product_id: "flour".into(),
        quantity_required: 200,
        unit: "g".into(),
    };
    assert_eq!(item.quantity_required, 200);
    assert_eq!(item.unit, "g");
}

#[test]
fn recipe_item_serde_roundtrip() {
    let item = RecipeItem {
        id: "r3".into(),
        parent_product_id: "smoothie".into(),
        ingredient_product_id: "banana".into(),
        quantity_required: 2,
        unit: "pcs".into(),
    };
    let json = serde_json::to_string(&item).unwrap();
    let back: RecipeItem = serde_json::from_str(&json).unwrap();
    assert_eq!(back, item);
}

#[test]
fn recipe_item_debug() {
    let item = RecipeItem {
        id: "r4".into(),
        parent_product_id: "p".into(),
        ingredient_product_id: "i".into(),
        quantity_required: 3,
        unit: "pcs".into(),
    };
    let debug = format!("{item:?}");
    assert!(debug.contains("p"));
    assert!(debug.contains("i"));
}
