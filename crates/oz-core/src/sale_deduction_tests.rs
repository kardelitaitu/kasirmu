use super::*;

#[test]
fn complete_sale_result_serde_roundtrip() {
    let result = CompleteSaleResult {
        sale_id: "sale-1".into(),
        status: SaleStatus::Completed,
        receipt_number: "REC-001".into(),
        statutory_number: Some("INV/2026-09/0001".into()),
        deduct_tx_id: InventoryTransactionId::from("tx-1"),
    };
    let json = serde_json::to_string(&result).unwrap();
    let back: CompleteSaleResult = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sale_id, "sale-1");
    assert_eq!(back.status, SaleStatus::Completed);
    assert_eq!(back.receipt_number, "REC-001");
    assert_eq!(back.deduct_tx_id.as_str(), "tx-1");
}

#[test]
fn partial_stock_result_serde_roundtrip() {
    let shortfall = Shortfall {
        sku: "CHO-001".into(),
        product_name: "Choco Bar".into(),
        requested_qty: 20,
        primary_qty_available: 5,
        deficit: 15,
        primary_location_id: LocationId::from("loc-store"),
        alternatives: vec![LocationStock {
            location_id: LocationId::from("loc-wh-a"),
            location_name: "Warehouse A".into(),
            qty_available: 500,
        }],
    };
    let result = PartialStockResult::single(shortfall);
    let json = serde_json::to_string(&result).unwrap();
    let back: PartialStockResult = serde_json::from_str(&json).unwrap();
    assert!(back.requires_resolution);
    assert_eq!(back.shortfalls.len(), 1);
    assert_eq!(back.shortfalls[0].sku, "CHO-001");
    assert_eq!(back.shortfalls[0].deficit, 15);
    assert_eq!(back.shortfalls[0].alternatives.len(), 1);
}

#[test]
fn partial_stock_result_multiple_constructor() {
    let a = Shortfall {
        sku: "A".into(),
        product_name: "Item A".into(),
        requested_qty: 10,
        primary_qty_available: 0,
        deficit: 10,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    let b = Shortfall {
        sku: "B".into(),
        product_name: "Item B".into(),
        requested_qty: 5,
        primary_qty_available: 2,
        deficit: 3,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    let result = PartialStockResult::multiple(vec![a, b]);
    assert_eq!(result.shortfalls.len(), 2);
}

#[test]
fn location_stock_serde_camel_case() {
    let ls = LocationStock {
        location_id: LocationId::from("loc-wh-a"),
        location_name: "Warehouse A".into(),
        qty_available: 250,
    };
    let json = serde_json::to_string(&ls).unwrap();
    assert!(json.contains("locationId"));
    assert!(json.contains("locationName"));
    assert!(json.contains("qtyAvailable"));
}

#[test]
fn resolved_shortfall_serde_roundtrip() {
    let rs = ResolvedShortfall {
        sku: "CHO-001".into(),
        allocations: vec![
            LocationAllocation {
                location_id: LocationId::from("loc-store"),
                qty: 2,
            },
            LocationAllocation {
                location_id: LocationId::from("loc-wh-a"),
                qty: 3,
            },
        ],
    };
    let json = serde_json::to_string(&rs).unwrap();
    let back: ResolvedShortfall = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, "CHO-001");
    assert_eq!(back.allocations.len(), 2);
    assert_eq!(back.allocations[0].location_id.as_str(), "loc-store");
    assert_eq!(back.allocations[0].qty, 2);
    assert_eq!(back.allocations[1].location_id.as_str(), "loc-wh-a");
    assert_eq!(back.allocations[1].qty, 3);
    // Verify camelCase naming in JSON
    assert!(json.contains("locationId"));
    assert!(json.contains("\"qty\":"));
}

#[test]
fn location_allocation_serde_roundtrip() {
    let la = LocationAllocation {
        location_id: LocationId::from("loc-wh-b"),
        qty: 10,
    };
    let json = serde_json::to_string(&la).unwrap();
    let back: LocationAllocation = serde_json::from_str(&json).unwrap();
    assert_eq!(back.location_id.as_str(), "loc-wh-b");
    assert_eq!(back.qty, 10);
    assert!(json.contains("locationId"));
}

#[test]
fn stock_deduction_serde_roundtrip() {
    let sd = StockDeduction {
        sku: "CHO-001".into(),
        location_id: LocationId::from("loc-store"),
        delta: -5,
    };
    let json = serde_json::to_string(&sd).unwrap();
    let back: StockDeduction = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, "CHO-001");
    assert_eq!(back.location_id.as_str(), "loc-store");
    assert_eq!(back.delta, -5);
    assert!(json.contains("locationId"));
    assert!(json.contains("\"delta\":-5"));
}

#[test]
fn resolved_shortfall_empty_allocations() {
    let rs = ResolvedShortfall {
        sku: "EMPTY-SKU".into(),
        allocations: vec![],
    };
    let json = serde_json::to_string(&rs).unwrap();
    let back: ResolvedShortfall = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, "EMPTY-SKU");
    assert!(back.allocations.is_empty());
}

#[test]
fn topology_allocation_fills_locations_in_route_order() {
    let locations = vec![
        LocationStock {
            location_id: LocationId::from("warehouse-a"),
            location_name: "Warehouse A".into(),
            qty_available: 3,
        },
        LocationStock {
            location_id: LocationId::from("warehouse-b"),
            location_name: "Warehouse B".into(),
            qty_available: 10,
        },
    ];

    let allocations = allocate_stock_in_route_order(8, &locations).unwrap();

    assert_eq!(
        allocations,
        vec![
            LocationAllocation {
                location_id: LocationId::from("warehouse-a"),
                qty: 3,
            },
            LocationAllocation {
                location_id: LocationId::from("warehouse-b"),
                qty: 5,
            },
        ]
    );
}

#[test]
fn topology_allocation_rejects_when_routes_cannot_fulfill_quantity() {
    let locations = vec![LocationStock {
        location_id: LocationId::from("warehouse-a"),
        location_name: "Warehouse A".into(),
        qty_available: 3,
    }];

    assert_eq!(allocate_stock_in_route_order(4, &locations), None);
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────────

// ── allocate_stock_in_route_order edge cases ──────────────────────────

#[test]
fn allocate_negative_qty_returns_none() {
    let locations = vec![LocationStock {
        location_id: LocationId::from("loc-1"),
        location_name: "Main".into(),
        qty_available: 100,
    }];
    assert_eq!(allocate_stock_in_route_order(-1, &locations), None);
}

#[test]
fn allocate_zero_qty_returns_empty() {
    let locations = vec![LocationStock {
        location_id: LocationId::from("loc-1"),
        location_name: "Main".into(),
        qty_available: 100,
    }];
    let result = allocate_stock_in_route_order(0, &locations).unwrap();
    assert!(result.is_empty());
}

#[test]
fn allocate_empty_locations_returns_none() {
    let locations: Vec<LocationStock> = vec![];
    assert_eq!(allocate_stock_in_route_order(5, &locations), None);
}

#[test]
fn allocate_all_zero_stock_returns_none() {
    let locations = vec![
        LocationStock {
            location_id: LocationId::from("loc-1"),
            location_name: "A".into(),
            qty_available: 0,
        },
        LocationStock {
            location_id: LocationId::from("loc-2"),
            location_name: "B".into(),
            qty_available: 0,
        },
    ];
    assert_eq!(allocate_stock_in_route_order(1, &locations), None);
}

#[test]
fn allocate_zero_stock_locations_are_skipped() {
    let locations = vec![
        LocationStock {
            location_id: LocationId::from("loc-empty"),
            location_name: "Empty".into(),
            qty_available: 0,
        },
        LocationStock {
            location_id: LocationId::from("loc-full"),
            location_name: "Full".into(),
            qty_available: 10,
        },
    ];
    let allocations = allocate_stock_in_route_order(5, &locations).unwrap();
    assert_eq!(allocations.len(), 1);
    assert_eq!(allocations[0].location_id.as_str(), "loc-full");
    assert_eq!(allocations[0].qty, 5);
}

#[test]
fn allocate_exact_match_fills_all_locations() {
    let locations = vec![
        LocationStock {
            location_id: LocationId::from("loc-1"),
            location_name: "A".into(),
            qty_available: 3,
        },
        LocationStock {
            location_id: LocationId::from("loc-2"),
            location_name: "B".into(),
            qty_available: 7,
        },
    ];
    let allocations = allocate_stock_in_route_order(10, &locations).unwrap();
    assert_eq!(allocations.len(), 2);
    assert_eq!(allocations[0].qty, 3);
    assert_eq!(allocations[1].qty, 7);
}

#[test]
fn allocate_single_location_exact() {
    let locations = vec![LocationStock {
        location_id: LocationId::from("loc-1"),
        location_name: "Solo".into(),
        qty_available: 5,
    }];
    let allocations = allocate_stock_in_route_order(5, &locations).unwrap();
    assert_eq!(allocations.len(), 1);
    assert_eq!(allocations[0].qty, 5);
}

#[test]
fn allocate_single_location_insufficient() {
    let locations = vec![LocationStock {
        location_id: LocationId::from("loc-1"),
        location_name: "Solo".into(),
        qty_available: 3,
    }];
    assert_eq!(allocate_stock_in_route_order(5, &locations), None);
}

#[test]
fn allocate_route_order_prefers_first_location() {
    // First location should be filled before moving to the next.
    let locations = vec![
        LocationStock {
            location_id: LocationId::from("primary"),
            location_name: "Primary".into(),
            qty_available: 2,
        },
        LocationStock {
            location_id: LocationId::from("backup"),
            location_name: "Backup".into(),
            qty_available: 100,
        },
    ];
    let allocations = allocate_stock_in_route_order(5, &locations).unwrap();
    assert_eq!(allocations[0].location_id.as_str(), "primary");
    assert_eq!(allocations[0].qty, 2);
    assert_eq!(allocations[1].location_id.as_str(), "backup");
    assert_eq!(allocations[1].qty, 3);
}

#[test]
fn allocate_total_qty_across_many_locations() {
    let locations: Vec<LocationStock> = (0..10)
        .map(|i| LocationStock {
            location_id: LocationId::from(format!("loc-{i}")),
            location_name: format!("Location {i}"),
            qty_available: 1,
        })
        .collect();
    let allocations = allocate_stock_in_route_order(5, &locations).unwrap();
    assert_eq!(allocations.len(), 5);
    for a in &allocations {
        assert_eq!(a.qty, 1);
    }
}

// ── Shortfall deficit invariant ───────────────────────────────────────

#[test]
fn shortfall_deficit_equals_requested_minus_available() {
    let shortfall = Shortfall {
        sku: "TEST".into(),
        product_name: "Test Product".into(),
        requested_qty: 20,
        primary_qty_available: 5,
        deficit: 15,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    assert_eq!(
        shortfall.deficit,
        shortfall.requested_qty - shortfall.primary_qty_available
    );
}

#[test]
fn shortfall_deficit_at_least_one() {
    // Deficit must be >= 1 (otherwise it's not a shortfall).
    let shortfall = Shortfall {
        sku: "TEST".into(),
        product_name: "Test".into(),
        requested_qty: 10,
        primary_qty_available: 9,
        deficit: 1,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    assert!(shortfall.deficit >= 1);
}

#[test]
fn shortfall_no_alternatives() {
    let shortfall = Shortfall {
        sku: "NO-ALT".into(),
        product_name: "No Alt".into(),
        requested_qty: 5,
        primary_qty_available: 0,
        deficit: 5,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    assert!(shortfall.alternatives.is_empty());
}

#[test]
fn shortfall_with_multiple_alternatives() {
    let shortfall = Shortfall {
        sku: "MULTI".into(),
        product_name: "Multi Alt".into(),
        requested_qty: 100,
        primary_qty_available: 10,
        deficit: 90,
        primary_location_id: LocationId::from("loc-primary"),
        alternatives: vec![
            LocationStock {
                location_id: LocationId::from("loc-a"),
                location_name: "Warehouse A".into(),
                qty_available: 50,
            },
            LocationStock {
                location_id: LocationId::from("loc-b"),
                location_name: "Warehouse B".into(),
                qty_available: 40,
            },
            LocationStock {
                location_id: LocationId::from("loc-c"),
                location_name: "Warehouse C".into(),
                qty_available: 200,
            },
        ],
    };
    assert_eq!(shortfall.alternatives.len(), 3);
    assert_eq!(shortfall.deficit, 90);
}

// ── StockDeduction edge cases ─────────────────────────────────────────

#[test]
fn stock_deduction_positive_delta_is_credit() {
    let sd = StockDeduction {
        sku: "CREDIT".into(),
        location_id: LocationId::from("loc-1"),
        delta: 10, // positive = credit
    };
    assert!(sd.delta > 0);
}

#[test]
fn stock_deduction_zero_delta_is_noop() {
    let sd = StockDeduction {
        sku: "NOOP".into(),
        location_id: LocationId::from("loc-1"),
        delta: 0,
    };
    assert_eq!(sd.delta, 0);
}

#[test]
fn stock_deduction_negative_delta_is_deduction() {
    let sd = StockDeduction {
        sku: "DEDUCT".into(),
        location_id: LocationId::from("loc-1"),
        delta: -5,
    };
    assert!(sd.delta < 0);
}

// ── PartialStockResult sentinel ───────────────────────────────────────

#[test]
fn partial_stock_result_requires_resolution_is_always_true() {
    let result = PartialStockResult::single(Shortfall {
        sku: "X".into(),
        product_name: "X".into(),
        requested_qty: 1,
        primary_qty_available: 0,
        deficit: 1,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    });
    assert!(result.requires_resolution);
}

#[test]
fn partial_stock_result_multiple_also_requires_resolution() {
    let result = PartialStockResult::multiple(vec![]);
    assert!(result.requires_resolution);
}

// ── CompleteSaleResult status ─────────────────────────────────────────

#[test]
fn complete_sale_result_status_is_completed() {
    let result = CompleteSaleResult {
        sale_id: "s1".into(),
        status: SaleStatus::Completed,
        receipt_number: "R1".into(),
        statutory_number: None,
        deduct_tx_id: InventoryTransactionId::from("tx-1"),
    };
    assert_eq!(result.status, SaleStatus::Completed);
}

// ── Debug output ──────────────────────────────────────────────────────

#[test]
fn complete_sale_result_debug() {
    let result = CompleteSaleResult {
        sale_id: "sale-debug".into(),
        status: SaleStatus::Completed,
        receipt_number: "REC-DBG".into(),
        statutory_number: None,
        deduct_tx_id: InventoryTransactionId::from("tx-dbg"),
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("sale-debug"));
    assert!(debug.contains("REC-DBG"));
}

#[test]
fn shortfall_debug() {
    let shortfall = Shortfall {
        sku: "DBG-SKU".into(),
        product_name: "Debug Product".into(),
        requested_qty: 10,
        primary_qty_available: 3,
        deficit: 7,
        primary_location_id: LocationId::from("loc-dbg"),
        alternatives: vec![],
    };
    let debug = format!("{shortfall:?}");
    assert!(debug.contains("DBG-SKU"));
    assert!(debug.contains("Debug Product"));
}

// ── Clone ─────────────────────────────────────────────────────────────

#[test]
fn complete_sale_result_clone() {
    let result = CompleteSaleResult {
        sale_id: "s1".into(),
        status: SaleStatus::Completed,
        receipt_number: "R1".into(),
        statutory_number: None,
        deduct_tx_id: InventoryTransactionId::from("tx-1"),
    };
    let cloned = result.clone();
    assert_eq!(cloned.sale_id, result.sale_id);
    assert_eq!(cloned.receipt_number, result.receipt_number);
}

#[test]
fn partial_stock_result_clone() {
    let result = PartialStockResult::single(Shortfall {
        sku: "X".into(),
        product_name: "X".into(),
        requested_qty: 1,
        primary_qty_available: 0,
        deficit: 1,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    });
    let cloned = result.clone();
    assert_eq!(cloned.shortfalls.len(), 1);
    assert!(cloned.requires_resolution);
}

// ── LocationStock edge cases ──────────────────────────────────────────

#[test]
fn location_stock_zero_qty() {
    let ls = LocationStock {
        location_id: LocationId::from("loc-zero"),
        location_name: "Zero Stock".into(),
        qty_available: 0,
    };
    assert_eq!(ls.qty_available, 0);
}

#[test]
fn location_stock_large_qty() {
    let ls = LocationStock {
        location_id: LocationId::from("loc-large"),
        location_name: "Large Stock".into(),
        qty_available: i64::MAX,
    };
    assert_eq!(ls.qty_available, i64::MAX);
}

// ── ResolvedShortfall many allocations ────────────────────────────────

#[test]
fn resolved_shortfall_many_allocations() {
    let allocations: Vec<LocationAllocation> = (0..20)
        .map(|i| LocationAllocation {
            location_id: LocationId::from(format!("loc-{i}")),
            qty: (i + 1) as i64,
        })
        .collect();
    let rs = ResolvedShortfall {
        sku: "BULK".into(),
        allocations,
    };
    let json = serde_json::to_string(&rs).unwrap();
    let back: ResolvedShortfall = serde_json::from_str(&json).unwrap();
    assert_eq!(back.allocations.len(), 20);
}

// ── serde camelCase for all types ─────────────────────────────────────

#[test]
fn stock_deduction_camel_case() {
    let sd = StockDeduction {
        sku: "SKU".into(),
        location_id: LocationId::from("loc-1"),
        delta: -5,
    };
    let json = serde_json::to_value(&sd).unwrap();
    assert!(
        json.get("locationId").is_some(),
        "expected camelCase locationId"
    );
}

#[test]
fn shortfall_camel_case() {
    let shortfall = Shortfall {
        sku: "S".into(),
        product_name: "P".into(),
        requested_qty: 10,
        primary_qty_available: 5,
        deficit: 5,
        primary_location_id: LocationId::from("loc-1"),
        alternatives: vec![],
    };
    let json = serde_json::to_value(&shortfall).unwrap();
    assert!(json.get("sku").is_some());
    assert!(
        json.get("productName").is_some(),
        "expected camelCase productName"
    );
    assert!(
        json.get("requestedQty").is_some(),
        "expected camelCase requestedQty"
    );
    assert!(
        json.get("primaryQtyAvailable").is_some(),
        "expected camelCase primaryQtyAvailable"
    );
    assert!(
        json.get("primaryLocationId").is_some(),
        "expected camelCase primaryLocationId"
    );
}
