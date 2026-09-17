use super::*;

fn make_lua() -> Lua {
    Lua::new()
}

#[test]
fn new_bridge_is_empty() {
    let bridge = LuaEventBridge::new();
    assert_eq!(bridge.event_count(), 0);
    assert_eq!(bridge.callback_count(), 0);
    assert!(!bridge.has_callbacks("sale.completed"));
}

#[test]
fn default_bridge_is_empty() {
    let bridge = LuaEventBridge::default();
    assert_eq!(bridge.event_count(), 0);
}

#[test]
fn register_single_callback() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let func = lua.create_function(|_, ()| Ok(())).unwrap();
    bridge.register(&lua, "test.event".into(), func).unwrap();

    assert_eq!(bridge.event_count(), 1);
    assert_eq!(bridge.callback_count(), 1);
    assert!(bridge.has_callbacks("test.event"));
    assert!(!bridge.has_callbacks("other.event"));
}

#[test]
fn register_multiple_callbacks_same_event() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua.create_function(|_, ()| Ok(())).unwrap();
    let f2 = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge.register(&lua, "evt".into(), f1).unwrap();
    bridge.register(&lua, "evt".into(), f2).unwrap();

    assert_eq!(bridge.event_count(), 1);
    assert_eq!(bridge.callback_count(), 2);
}

#[test]
fn fire_unregistered_event_is_ok() {
    let lua = make_lua();
    let bridge = LuaEventBridge::new();

    let result = bridge.fire(&lua, "nonexistent", Value::Nil);
    assert!(result.is_ok());
}

#[test]
fn fire_invokes_callback() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let globals = lua.globals();
    globals.set("called", false).unwrap();

    let func = lua
        .create_function(|lua, ()| {
            lua.globals().set("called", true)?;
            Ok(())
        })
        .unwrap();

    bridge.register(&lua, "test.event".into(), func).unwrap();
    bridge.fire(&lua, "test.event", Value::Nil).unwrap();

    let called: bool = globals.get("called").unwrap();
    assert!(called, "callback should have set 'called' to true");
}

#[test]
fn fire_passes_arguments() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let globals = lua.globals();
    globals.set("received_val", 0i64).unwrap();

    let func = lua
        .create_function(move |lua, args: Value| {
            if let Value::Table(tbl) = args {
                let val: i64 = tbl.get("amount")?;
                lua.globals().set("received_val", val)?;
            }
            Ok(())
        })
        .unwrap();

    bridge.register(&lua, "test.event".into(), func).unwrap();

    let args = lua.create_table().unwrap();
    args.set("amount", 42i64).unwrap();

    bridge.fire(&lua, "test.event", Value::Table(args)).unwrap();

    let received: i64 = globals.get("received_val").unwrap();
    assert_eq!(received, 42);
}

#[test]
fn fire_handles_callback_error() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let func = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("deliberate fail".into())))
        .unwrap();

    bridge.register(&lua, "test.event".into(), func).unwrap();

    let result = bridge.fire(&lua, "test.event", Value::Nil);
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("deliberate fail"),
        "error should contain inner Lua error message, got: {err_msg}"
    );
}

#[test]
fn fire_partial_success_clears_error() {
    // Failure BEFORE success must still return Ok (documented contract).
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f_bad = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail 1".into())))
        .unwrap();
    let f_good = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge.register(&lua, "bad.event".into(), f_bad).unwrap();
    bridge.register(&lua, "bad.event".into(), f_good).unwrap();

    let result = bridge.fire(&lua, "bad.event", Value::Nil);
    assert!(
        result.is_ok(),
        "if at least one callback succeeds, fire should return Ok"
    );
}

#[test]
fn fire_success_then_failure_is_still_ok() {
    // PLG-05 regression: success-then-failure previously returned Err
    // because the error was cleared on success and re-set on the later
    // failure — order-dependent and contrary to the documented contract.
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f_good = lua.create_function(|_, ()| Ok(())).unwrap();
    let f_bad = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail 2".into())))
        .unwrap();

    bridge.register(&lua, "order.event".into(), f_good).unwrap();
    bridge.register(&lua, "order.event".into(), f_bad).unwrap();

    let result = bridge.fire(&lua, "order.event", Value::Nil);
    assert!(
        result.is_ok(),
        "success-then-failure must still be Ok (at least one succeeded)"
    );
}

#[test]
fn fire_all_fail_returns_aggregated_error() {
    // PLG-05: when EVERY callback fails, fire must return Err with the
    // individual errors joined, regardless of order.
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail A".into())))
        .unwrap();
    let f2 = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail B".into())))
        .unwrap();

    bridge.register(&lua, "allfail.event".into(), f1).unwrap();
    bridge.register(&lua, "allfail.event".into(), f2).unwrap();

    let result = bridge.fire(&lua, "allfail.event", Value::Nil);
    assert!(result.is_err(), "all-failed must return Err");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("fail A") && err_msg.contains("fail B"),
        "aggregated error should contain every callback failure, got: {err_msg}"
    );
    assert!(
        err_msg.contains("all 2 callbacks"),
        "error should report the count, got: {err_msg}"
    );
}

#[test]
fn fire_all_fail_returns_err_in_reverse_order_too() {
    // Order independence: all-failed must be Err in any registration order.
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail X".into())))
        .unwrap();
    let f2 = lua
        .create_function(|_, ()| Err::<(), _>(mlua::Error::RuntimeError("fail Y".into())))
        .unwrap();

    bridge.register(&lua, "rev.event".into(), f2).unwrap();
    bridge.register(&lua, "rev.event".into(), f1).unwrap();

    let result = bridge.fire(&lua, "rev.event", Value::Nil);
    assert!(
        result.is_err(),
        "all-failed must be Err regardless of order"
    );
}

#[test]
fn fire_zero_callbacks_is_ok() {
    let lua = make_lua();
    let bridge = LuaEventBridge::new();
    let result = bridge.fire(&lua, "none.event", Value::Nil);
    assert!(result.is_ok());
}

#[test]
fn remove_owner_removes_only_that_plugins_callbacks() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f_a = lua.create_function(|_, ()| Ok(())).unwrap();
    let f_b = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge
        .register_for("plugin-a".into(), &lua, "evt".into(), f_a)
        .unwrap();
    bridge
        .register_for("plugin-b".into(), &lua, "evt".into(), f_b)
        .unwrap();

    assert_eq!(bridge.callback_count(), 2);
    bridge.remove_owner("plugin-a");

    assert_eq!(bridge.callback_count(), 1);
    assert!(bridge.has_callbacks("evt"));
}

#[test]
fn remove_owner_across_multiple_events() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua.create_function(|_, ()| Ok(())).unwrap();
    let f2 = lua.create_function(|_, ()| Ok(())).unwrap();
    let f3 = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge
        .register_for("p1".into(), &lua, "e1".into(), f1)
        .unwrap();
    bridge
        .register_for("p1".into(), &lua, "e2".into(), f2)
        .unwrap();
    bridge
        .register_for("p2".into(), &lua, "e2".into(), f3)
        .unwrap();

    assert_eq!(bridge.event_count(), 2);
    bridge.remove_owner("p1");

    // e1 is now empty and should be dropped; e2 keeps only p2's callback.
    assert_eq!(bridge.event_count(), 1);
    assert!(!bridge.has_callbacks("e1"));
    assert!(bridge.has_callbacks("e2"));
    assert_eq!(bridge.callback_count(), 1);
}

#[test]
fn remove_owner_with_empty_owner_is_noop() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();
    let f = lua.create_function(|_, ()| Ok(())).unwrap();
    bridge.register(&lua, "evt".into(), f).unwrap();

    // System callbacks (empty owner) are never removed by owner cleanup.
    bridge.remove_owner("");
    assert_eq!(bridge.callback_count(), 1);
}

#[test]
fn register_for_and_fire_with_owner() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let globals = lua.globals();
    globals.set("owner_called", false).unwrap();
    let f = lua
        .create_function(|lua, ()| {
            lua.globals().set("owner_called", true)?;
            Ok(())
        })
        .unwrap();
    bridge
        .register_for("plug".into(), &lua, "evt".into(), f)
        .unwrap();

    bridge.fire(&lua, "evt", Value::Nil).unwrap();
    let called: bool = globals.get("owner_called").unwrap();
    assert!(called);
}

#[test]
fn off_removes_callbacks_for_event() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua.create_function(|_, ()| Ok(())).unwrap();
    let f2 = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge.register(&lua, "evt1".into(), f1).unwrap();
    bridge.register(&lua, "evt2".into(), f2).unwrap();

    assert_eq!(bridge.event_count(), 2);

    bridge.off("evt1");

    assert_eq!(bridge.event_count(), 1);
    assert!(!bridge.has_callbacks("evt1"));
    assert!(bridge.has_callbacks("evt2"));
}

#[test]
fn clear_removes_all_callbacks() {
    let lua = make_lua();
    let mut bridge = LuaEventBridge::new();

    let f1 = lua.create_function(|_, ()| Ok(())).unwrap();
    let f2 = lua.create_function(|_, ()| Ok(())).unwrap();

    bridge.register(&lua, "evt1".into(), f1).unwrap();
    bridge.register(&lua, "evt2".into(), f2).unwrap();

    bridge.clear();

    assert_eq!(bridge.event_count(), 0);
    assert_eq!(bridge.callback_count(), 0);
}
