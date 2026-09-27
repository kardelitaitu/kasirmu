# this is a rough idea, need to be reviewed properly
# ARCHITECTURAL SPECIFICATION AND WHITE-PAPER
## System Title: High-Throughput Offline-First Multi-Location POS & Warehousing Engine
## Target Frameworks: Tauri v2 (IPC Bridge) & Rusqlite (Native Storage)
## Status: Production-Grade Design Specification

---

## 1. Executive Summary & Design Goals
This document is idea to be reviewed, its defines the core architecture for a multi-location, offline-first Point of Sale (POS) and warehousing software platform. The principal goal is to guarantee **zero UI stuttering (60 FPS)**, absolute data integrity during network partitions, and efficient data processing on low-spec client hardware. 

The architecture decouples the UI layer (agnostic runtime shell running on Android, iOS, Windows, macOS, or Linux) from the data execution engine using a **Command-Driven Actor Pattern** written in Rust, communicating via an asynchronous IPC (Inter-Process Communication) bridge.

---

## 2. Architectural Structure Diagram

+---------------------------------------------------------------------------------+

|                                APPLICATION FRONTEND LAYER                       |
|               (Agile UI Runtime: React / TypeScript / HTML5 Webview)            |
+---------------------------------------------------------------------------------+
                                       │
                                       │ Asynchronous IPC Bridge
                                       ▼ (Serialized JSON / Binary Packets)
+---------------------------------------------------------------------------------+

|                                 TAURI v2 BRIDGE LAYER                           |
|                      - Asynchronous Command Router (Tokio Workers)              |
|                      - State Storage: Thread-Safe `DbClient` MPSC Handle        |
+---------------------------------------------------------------------------------+
                                       │
                                       │ Thread-Safe Crossbeam / std MPSC Channel
                                       ▼ (Non-blocking Message passing)
+---------------------------------------------------------------------------------+

|                           SYNCHRONOUS ACTOR LAYER (DEDICATED OS THREAD)         |
|                      - Long-lived database worker loop                          |
|                      - Processes read/write instructions sequentially          |
+---------------------------------------------------------------------------------+
                                       │
                                       │ Zero Object-Relational Impedance Overhead
                                       ▼ (Raw SQL Engine Execution)
+---------------------------------------------------------------------------------+

|                            PERSISTENCE ENGINE: SQLite (WAL MODE)                |
|           - Cache Tables (Disposable)   - Outbox Tables (Sacred Append-Only)    |
+---------------------------------------------------------------------------------+

---

## 3. Storage Architecture: SQLite Optimizations
To support heavy offline syncing routines without deadlocks or locking out local reads from POS cash registers, the persistence engine is configured explicitly under **Write-Ahead Logging (WAL)** rules:

1. **PRAGMA journal_mode = WAL;**
   Enables simultaneous read and write operations. Multiple threads can read data safely from the log while a dedicated background sync process updates local inventories.
2. **PRAGMA synchronous = NORMAL;**
   Removes blocking physical disk flushes at every transaction checkpoint, deferring syncing to safe cycles without risking system corruption.
3. **Data Classification Matrix:**

| Schema Domain | Data Classification | Primary Authority | Synchronization Rule |
| :--- | :--- | :--- | :--- |
| **Cache Tables** (`products`, `prices`, `locations`) | Ephemeral Stock Snapshot | Cloud Server Instance | **Disposable.** Can be wiped and completely rebuilt from server payloads during network recovery. |
| **Outbox Tables** (`sales_log`, `stock_audits`) | Hard Transactional Ledger | Local Terminal Hardware | **Sacred.** Append-only logs capturing local employee activity. Cannot be overwritten or deleted until a verified up-sync ACK is returned. |

---

## 4. System Implementation Code (Rust Core & Data Logic)

Below is the definitive, production-ready system file (`src-tauri/src/lib.rs`) validating this actor architecture.

```rust
use rusqlite::{Connection, Transaction};
use std::sync::mpsc;
use std::thread;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use serde::{Serialize, Deserialize};

/// 1. DATA STRUCTURE DEFINITIONS (Strongly-typed IPC contracts)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Product {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub stock: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OfflineSale {
    pub receipt_id: String,
    pub sku: String,
    pub quantity: i32,
    pub timestamp: u64,
}

/// 2. ACTOR MESSAGE CONTRACTS (Exhaustive enum ensuring rigid API design boundaries)
pub enum DbMessage {
    GetProductBySku {
        sku: String,
        respond_to: mpsc::Sender<Result<Product, String>>,
    },
    BulkSyncInventory {
        items: Vec<Product>,
        respond_to: mpsc::Sender<Result<(), String>>,
    },
    QueueOfflineSale {
        sale: OfflineSale,
        respond_to: mpsc::Sender<Result<(), String>>,
    },
}

/// 3. TAURI MANAGED STATE INJECTION HANDLE
/// Holds the non-blocking sender pipeline clone to communicate with the background OS thread.
pub struct DbClient {
    pub sender: mpsc::Sender<DbMessage>,
}

/// 4. ASYNCHRONOUS COMMAND ROUTERS (Executed inside Tauri's Tokio pool)
#[tauri::command]
pub async fn get_product_by_sku(sku: String, db: State<'_, DbClient>) -> Result<Product, String> {
    let (tx, rx) = mpsc::channel();
    
    db.sender
        .send(DbMessage::GetProductBySku { sku, respond_to: tx })
        .map_err(|_| "Target Database Actor Thread is unreachable".to_string())?;

    // Offloads waiting response to an isolated thread pool, avoiding async blockades
    tokio::task::spawn_blocking(move || rx.recv().map_err(|_| "Channel disconnected".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bulk_sync_inventory(items: Vec<Product>, db: State<'_, DbClient>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    
    db.sender
        .send(DbMessage::BulkSyncInventory { items, respond_to: tx })
        .map_err(|_| "Target Database Actor Thread is unreachable".to_string())?;

    tokio::task::spawn_blocking(move || rx.recv().map_err(|_| "Channel disconnected".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn queue_offline_sale(sale: OfflineSale, db: State<'_, DbClient>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    
    db.sender
        .send(DbMessage::QueueOfflineSale { sale, respond_to: tx })
        .map_err(|_| "Target Database Actor Thread is unreachable".to_string())?;

    tokio::task::spawn_blocking(move || rx.recv().map_err(|_| "Channel disconnected".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

/// 5. MAIN NATIVE CONTEXT LIFECYCLE INITIALIZER
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve deterministic application folder path across operating systems
            let app_dir = app.path().app_data_dir().expect("Critical Error: Core AppData Dir is missing");
            std::fs::create_dir_all(&app_dir).unwrap();
            let db_path = app_dir.join("enterprise_warehouse.db");

            // Establish physical synchronous connection instance
            let mut conn = Connection::open(db_path).expect("Critical Error: Database initialization aborted");
            
            // Inject High-Performance Storage Configurations via Batch Execution
            conn.execute_batch("
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA foreign_keys = ON;
                
                CREATE TABLE IF NOT EXISTS inventory (
                    id TEXT PRIMARY KEY,
                    sku TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    stock INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS outbox_sales (
                    receipt_id TEXT PRIMARY KEY,
                    sku TEXT NOT NULL,
                    quantity INTEGER NOT NULL,
                    timestamp INTEGER NOT NULL,
                    synced_status INTEGER DEFAULT 0
                );
            ").expect("Critical Error: Schema compilation failed");

            // Construct cross-boundary communication channels
            let (tx, rx) = mpsc::channel::<DbMessage>();

            // 6. SPAWN DEDICATED ACTOR THREAD (Isolated synchronous execution loop)
            thread::spawn(move || {
                while let Ok(message) = rx.recv() {
                    match message {
                        DbMessage::GetProductBySku { sku, respond_to } => {
                            let mut stmt = conn.prepare("SELECT id, sku, name, stock FROM inventory WHERE sku = ?1");
                            let res = stmt.and_then(|mut s| s.query_row([sku], |row| {
                                Ok(Product {
                                    id: row.get(0)?,
                                    sku: row.get(1)?,
                                    name: row.get(2)?,
                                    stock: row.get(3)?,
                                })
                            })).map_err(|e| e.to_string());
                            let _ = respond_to.send(res);
                        }
            // Run heavy cloud writes inside an explicit transaction block to prevent fragmentation

            let res = conn.transaction().and_then(|tx| {{let mut stmt = tx.prepare("INSERT OR REPLACE INTO inventory (id, sku, name, stock) VALUES (?1, ?2, ?3, ?4)")?;for item in items {stmt.execute([item.id, item.sku, item.name, item.stock.to_string()])?;}}tx.commit()}).map_err(|e| e.to_string());let _ = respond_to.send(res);}DbMessage::QueueOfflineSale { sale, respond_to } => {let res = conn.execute("INSERT INTO outbox_sales (receipt_id, sku, quantity, timestamp) VALUES (?1, ?2, ?3, ?4)",[sale.receipt_id, sale.sku, sale.quantity.to_string(), sale.timestamp.to_string()]).map(|_| ()).map_err(|e| e.to_string());let _ = respond_to.send(res);}}}});
            // Register global dependency container reference within Tauri's engine core
            app.manage(DbClient { sender: tx });Ok(())}).invoke_handler(tauri::generate_handler![get_product_by_sku,
                bulk_sync_inventory,
                queue_offline_sale]).run(tauri::generate_context!())
                .expect("Runtime Error: Core instance crashed unexpected");}```        
