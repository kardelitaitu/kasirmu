//! Postgres backend for the scheduled report-sender email loop.
//!
//! Phase 1.5 of `docs/archived/2026-08-15-unify-auth-and-sync.md`: the SQLite loop in [`crate::email`]
//! reads its config from the synchronous `rusqlite` `Store`; this module is
//! the parallel async Postgres implementation used on the cloud branch. It
//! covers the exact surface the loop touches:
//!
//! - the `settings` table (`smtp_config`, `report_schedule`,
//!   `last_report_sent_at`, `store.name`) — read per tenant via scoped
//!   `{key}:{tenant}` keys with bare-key fallback (see §11.5 of
//!   `docs/archived/2026-08-15-unify-auth-and-sync.md`)
//! - the analytics bundle (`export_analytics_bundle_pg`) — the ten report
//!   queries ported from `kasirmu_core::db::reports` / `kasirmu_core::db::popularity`,
//!   every one tenant-filtered (`AND s.tenant_id = $n` / `AND p.tenant_id = $n`)
//!
//! The loop walks the active tenants (union of `tenant_plans` /
//! `offline_queue` / `sync_terminals`, plus `default` always, processed
//! first) and serializes each tenant's cycle across instances with a
//! session advisory lock keyed on the tenant id.
//!
//! The pure-Rust scheduling / filtering / formatting logic is reused from
//! `kasirmu_core` (`should_send_scheduled_with_last_sent`,
//! `filter_analytics_bundle`, `ReportEmailBuilder::build`) so the SQLite and
//! Postgres loops can never drift apart in cadence, dedup, or layout.
//!
//! # Date handling
//!
//! Both schemas store `created_at` as ISO-8601 UTC text. Postgres casts that
//! text directly (`created_at::date`, `created_at::timestamp`) and reuses the
//! same `YYYY-MM-DD` / `YYYY-MM` string shapes the SQLite queries produced.
//!
//! # Decomposition (13-09-26)
//!
//! The 1,590-line monolith split into submodules along its real seams:
//! [`queue_worker`] (loop, per-tenant cycle, advisory-lock guard, tenant
//! enumeration, period claim), [`settings_store`] (scoped KV access and
//! typed loaders), [`analytics`] (bundle + revenue/product/heatmap/stock
//! queries) and [`popularity`] (popularity/trend/forecast queries). This
//! file keeps only the module wiring and the re-exports callers and the
//! test module resolve through it — no logic lives here.

mod analytics;
mod popularity;
mod queue_worker;
mod settings_store;

pub use queue_worker::start_report_sender_loop_pg;

// Everything below exists for `email_pg_tests.rs`, which is wired as a child
// of this module and resolves its subjects through `use super::*`. They are
// compiled out of the release build entirely.
#[cfg(test)]
pub(crate) use analytics::{daily_revenue_pg, export_analytics_bundle_pg};
#[cfg(test)]
pub(crate) use queue_worker::{
    AdvisoryLockGuard, active_tenants_pg, claim_period_pg, period_for_schedule, release_period_pg,
    try_send_scheduled_for_tenant_pg, try_send_scheduled_tenant_inner_pg,
};
#[cfg(test)]
pub(crate) use settings_store::{
    get_report_schedule_pg, get_setting_pg, get_smtp_config_pg, get_store_name_pg, scoped_key,
    set_setting_pg, set_setting_scoped_pg,
};
#[cfg(test)]
pub(crate) use {
    chrono::Utc,
    kasirmu_core::export::REPORT_SCHEDULE_SETTINGS_KEY,
    kasirmu_core::export::email_report::SmtpConfig,
    kasirmu_core::export::email_sender::{LAST_SENT_KEY, resolve_now_in_timezone},
    kasirmu_core::export::{ExportConfig, ReportScheduleConfig},
};

#[cfg(test)]
#[path = "email_pg_tests.rs"]
mod tests;
