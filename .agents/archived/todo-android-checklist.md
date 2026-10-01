# only rough plan, need to be audited first
# TAURI V2 ANDROID OPTIMIZATION PLAN (DEDICATED POS TERMINALS, 4GB RAM MINIMUM)

## PHASE 1: FRONTEND LAYER (REACT & WEBVIEW OVERHEAD REDUCTION)
*   [ ] DOM Virtualization: Forbid standard `.map()` for inventory grids and sales history. Enforce `@tanstack/react-virtual` or `react-window` so only visible UI nodes reside in memory.
*   [ ] Pagination & Lazy Loading: Paginate all SQLite inventory fetches down the IPC bridge using SQL `LIMIT` and `OFFSET` in batches of 50-100 items maximum.
*   [ ] State Disconnect: Strip large data models out of React state engines (Context/Redux). Keep raw arrays in local memory scopes and only reactive UI states in global variables.
*   [ ] Image Optimization: Compress all product catalog images to WebP format. Ensure local images do not exceed a maximum resolution of 400x400 pixels to prevent WebView GPU crashes.

## PHASE 2: BACKEND LAYER (RUST CORE & IPC STREAMLINING)
*   [ ] Compute Offloading: Keep React strictly as a "dumb presentation layer." Migrate all inventory algorithms, tax brackets, search filters, and sync conflict resolutions to Rust commands.
*   [ ] IPC Payload Minimization: Instead of passing massive nested JSON objects over the Tauri IPC bridge, return trimmed, localized payloads tailored specifically to the active viewport.
*   [ ] Connection Pooling: Ensure `rusqlite` utilizes an optimized single-connection lock or a lightweight thread-safe pool (`r2d2`) to prevent memory leaks during background sync tasks.

## PHASE 3: MOBILE INTERFACE & RESPONSIVENESS
*   [ ] Viewport Refactoring: Use Tailwind CSS responsive utility breakpoints (`sm:`, `md:`, `lg:`) to cleanly map the Windows desktop layout onto 10-inch tablets and 6-inch handheld POS devices.
*   [ ] Virtual Keyboard Mitigation: Force input fields to handle layout shifts cleanly. Add `resizeToAvoidBottomInset` settings or flex layouts so cashiers aren't blocked when typing numbers.
*   [ ] Touch-Target Standardization: Enforce an absolute minimum click-target size of 48x48dp for all checkout buttons, item grid selectors, and menu icons to account for rapid finger-tapping.

## PHASE 4: NATIVE ANDROID SYSTEM TUNING
*   [ ] WakeLock Configuration: Inject a basic native Kotlin plugin using Tauri v2’s mobile plugin layer to hold an Android `WakeLock`. This stops the OS from putting the process to sleep.
*   [ ] Foreground Service Registration: Elevate the app’s synchronization thread into a persistent Android Foreground Service to shield it from the Low Memory Killer (LMK).
*   [ ] WebView Anchoring: Lock the fleet terminals to a uniform, tested Android System WebView release version via the Google Play console. Disable background browser updates to ensure total stability.

## PHASE 5: MIGRATION SAFEGUARDS (FUTURE KOTLIN HANDOFF)
*   [ ] OpenAPI/JSON Contract Archival: Document every IPC `invoke()` call. Map out explicit JSON schemas for all request/response actions so a future team can copy them 1:1.
*   [ ] Database Schema Freeze: Keep raw `.sql` schemas and migrations pristine in an isolated folder. This provides an exact roadmap for future Kotlin Room `@Entity` data classes.

Pre-Release Checklist (The Final Safety Gate)Before handing the APK/AAB to your first store location, complete these tests using Android Studio's Profiler or ADB:The 8-Hour Idle Test: Leave the app running overnight on the terminal with the screen on to ensure the Rust sync loops do not have slow memory accumulation.The Rapid Checkout Stress Test: Tap through 30 mock sales in quick succession while scanning barcodes to confirm the React state resets memory properly after each transaction.Offline Drop Test: Cut Wi-Fi mid-transaction to verify that local rusqlite writes cleanly without unhandled JavaScript exceptions hanging the WebView thread.
