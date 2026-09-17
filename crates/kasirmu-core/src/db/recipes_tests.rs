use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn seed_products(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('burger', 'BURGER', 'Cheeseburger', 500, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('bun', 'BUN', 'Burger Bun', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('patty', 'PATTY', 'Beef Patty', 200, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('cheese', 'CHEESE', 'Cheese Slice', 50, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('salad', 'SALAD', 'Side Salad', 150, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    ).unwrap();
}

fn seed_recipe(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r1', 'burger', 'bun', 1, 'pcs'),
            ('r2', 'burger', 'patty', 1, 'pcs'),
            ('r3', 'burger', 'cheese', 2, 'pcs');",
    ).unwrap();
}

// ── Get recipe ingredients ──────────────────────────────────────

#[test]
fn get_recipe_ingredients_for_composite_product() {
    let conn = fresh();
    seed_products(&conn);
    seed_recipe(&conn);

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();

    assert_eq!(ingredients.len(), 3);

    // Order should be by id ASC: r1, r2, r3
    assert_eq!(ingredients[0].ingredient_product_id, "bun");
    assert_eq!(ingredients[0].quantity_required, 1);
    assert_eq!(ingredients[1].ingredient_product_id, "patty");
    assert_eq!(ingredients[1].quantity_required, 1);
    assert_eq!(ingredients[2].ingredient_product_id, "cheese");
    assert_eq!(ingredients[2].quantity_required, 2);
}

#[test]
fn get_recipe_ingredients_returns_empty_for_simple_product() {
    let conn = fresh();
    seed_products(&conn);

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("salad").unwrap();

    assert!(ingredients.is_empty());
}

#[test]
fn get_recipe_ingredients_returns_empty_for_unknown_product() {
    let conn = fresh();
    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("nonexistent").unwrap();

    assert!(ingredients.is_empty());
}

#[test]
fn get_recipe_ingredients_multiple_products() {
    let conn = fresh();
    seed_products(&conn);
    seed_recipe(&conn);

    // Add a recipe for salad
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r4', 'salad', 'bun', 1, 'pcs');",
    ).unwrap();

    let store = Store::new(&conn);
    let burger_ings = store.get_recipe_ingredients("burger").unwrap();
    let salad_ings = store.get_recipe_ingredients("salad").unwrap();

    assert_eq!(burger_ings.len(), 3);
    assert_eq!(salad_ings.len(), 1);
    assert_eq!(salad_ings[0].ingredient_product_id, "bun");
}

// ── FK cascade tests ───────────────────────────────────────────

#[test]
fn get_recipe_ingredients_cascade_on_parent_delete() {
    let conn = fresh();
    seed_products(&conn);
    seed_recipe(&conn);

    // Delete the parent product; recipe rows should cascade delete
    conn.execute("DELETE FROM products WHERE id = 'burger'", [])
        .unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert!(ingredients.is_empty());
}

#[test]
fn get_recipe_ingredients_cascade_on_ingredient_delete() {
    let conn = fresh();
    seed_products(&conn);
    seed_recipe(&conn);

    // Delete an ingredient product; recipe rows referencing it should cascade
    conn.execute("DELETE FROM products WHERE id = 'cheese'", [])
        .unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    // Only bun and patty remain (cheese row cascade-deleted)
    assert_eq!(ingredients.len(), 2);
    assert_eq!(ingredients[0].ingredient_product_id, "bun");
    assert_eq!(ingredients[1].ingredient_product_id, "patty");
}

// ── Shared ingredient across multiple recipes ──────────────────

#[test]
fn get_recipe_ingredients_shared_ingredient() {
    let conn = fresh();
    seed_products(&conn);
    seed_recipe(&conn);

    // Both burger and salad use 'bun'
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r4', 'salad', 'bun', 1, 'pcs');",
    ).unwrap();

    let store = Store::new(&conn);
    let burger_ings = store.get_recipe_ingredients("burger").unwrap();
    let salad_ings = store.get_recipe_ingredients("salad").unwrap();

    // Both recipes reference bun
    assert!(burger_ings.iter().any(|i| i.ingredient_product_id == "bun"));
    assert!(salad_ings.iter().any(|i| i.ingredient_product_id == "bun"));
}

// ── Large quantity ─────────────────────────────────────────────

#[test]
fn get_recipe_ingredients_large_quantity() {
    let conn = fresh();
    seed_products(&conn);
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r10', 'burger', 'bun', 9999, 'pcs');",
    ).unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 1);
    assert_eq!(ingredients[0].quantity_required, 9999);
}

// ── Default unit ───────────────────────────────────────────────

#[test]
fn get_recipe_ingredients_default_unit() {
    let conn = fresh();
    seed_products(&conn);
    // Insert without specifying unit (should default to 'pcs')
    conn.execute(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required) VALUES
            ('r20', 'burger', 'bun', 1)",
        [],
    ).unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 1);
    assert_eq!(ingredients[0].unit, "pcs");
}

// ── Update quantity_required after insert ──────────────────────

#[test]
fn get_recipe_ingredients_updated_quantity_reflects() {
    let conn = fresh();
    seed_products(&conn);
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r30', 'burger', 'bun', 1, 'pcs');",
    ).unwrap();

    // Update the quantity
    conn.execute(
        "UPDATE product_recipes SET quantity_required = 3 WHERE id = 'r30'",
        [],
    )
    .unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 1);
    assert_eq!(ingredients[0].quantity_required, 3);
}

// ── Many ingredients (10+) ─────────────────────────────────────

#[test]
fn get_recipe_ingredients_many_ingredients() {
    let conn = fresh();
    seed_products(&conn);

    // Add 10 extra products as ingredients
    for i in 0..10 {
        let pid = format!("ing_{}", i);
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
             (?1, ?1, ?1, 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![pid],
        ).unwrap();
        conn.execute(
            "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
             (?1, 'burger', ?2, 1, 'pcs')",
            params![format!("r_many_{}", i), pid],
        ).unwrap();
    }

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 10);
    // Verify order is by id ASC
    assert_eq!(ingredients[0].ingredient_product_id, "ing_0");
    assert_eq!(ingredients[9].ingredient_product_id, "ing_9");
}

// ── Varied units ───────────────────────────────────────────────

#[test]
fn get_recipe_ingredients_varied_units() {
    let conn = fresh();
    seed_products(&conn);

    // Add more products to be ingredients
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('flour', 'FLOUR', 'Wheat Flour', 50, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('milk', 'MILK', 'Whole Milk', 80, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('salt', 'SALT', 'Table Salt', 10, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    ).unwrap();

    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r40', 'burger', 'bun', 1, 'pcs'),
            ('r41', 'burger', 'flour', 200, 'g'),
            ('r42', 'burger', 'milk', 50, 'ml'),
            ('r43', 'burger', 'salt', 1, 'tsp');",
    ).unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 4);

    let units: Vec<&str> = ingredients.iter().map(|i| i.unit.as_str()).collect();
    assert!(units.contains(&"pcs"));
    assert!(units.contains(&"g"));
    assert!(units.contains(&"ml"));
    assert!(units.contains(&"tsp"));
}

// ── Unique constraint violation ────────────────────────────────

#[test]
fn get_recipe_ingredients_unique_constraint_rejects_duplicate() {
    let conn = fresh();
    seed_products(&conn);

    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r50', 'burger', 'bun', 1, 'pcs');",
    ).unwrap();

    // Inserting same parent + ingredient should fail
    let result = conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r51', 'burger', 'bun', 2, 'pcs');",
    );
    assert!(result.is_err());
}

// ── CHECK constraint: quantity_required > 0 ────────────────────

#[test]
fn get_recipe_ingredients_check_constraint_rejects_zero_quantity() {
    let conn = fresh();
    seed_products(&conn);

    let result = conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r60', 'burger', 'bun', 0, 'pcs');",
    );
    assert!(result.is_err());
}

#[test]
fn get_recipe_ingredients_check_constraint_rejects_negative_quantity() {
    let conn = fresh();
    seed_products(&conn);

    let result = conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r61', 'burger', 'bun', -1, 'pcs');",
    );
    assert!(result.is_err());
}

// ── Order preservation with non-sequential IDs ─────────────────

#[test]
fn get_recipe_ingredients_order_by_id_asc() {
    let conn = fresh();
    seed_products(&conn);

    // Insert out of alphabetical ingredient order
    conn.execute_batch(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
            ('r_c', 'burger', 'cheese', 1, 'pcs'),
            ('r_a', 'burger', 'bun', 1, 'pcs'),
            ('r_b', 'burger', 'patty', 1, 'pcs');",
    ).unwrap();

    let store = Store::new(&conn);
    let ingredients = store.get_recipe_ingredients("burger").unwrap();
    assert_eq!(ingredients.len(), 3);
    // Order should be by id ASC: r_a, r_b, r_c
    assert_eq!(ingredients[0].id, "r_a");
    assert_eq!(ingredients[1].id, "r_b");
    assert_eq!(ingredients[2].id, "r_c");
}
