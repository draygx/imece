//! No-op telemetry stub for İmece.
//!
//! All methods are intentional no-ops. PostHog and all external analytics
//! have been removed from this fork. The public interface is preserved so
//! call sites throughout the codebase require no changes.

pub mod device;

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;
use tauri::AppHandle;

// ── Public types (interface-compatible with upstream) ─────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelemetryConfig {
    pub enabled: bool,
    pub host: String,
    pub key: String,
}

#[derive(Debug, Clone)]
pub struct AccountIdentity {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub org_id: Option<String>,
    pub org_name: Option<String>,
    pub org_role: Option<String>,
    pub org_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrgIdentity {
    pub id: String,
    pub kind: &'static str,
    pub name: Option<String>,
    pub role: Option<String>,
}

// Internal no-op event type (only to satisfy mpsc::Receiver<QueuedEvent> return)
pub(crate) struct QueuedEvent;

// ── No-op TelemetryClient ─────────────────────────────────────────────────────

pub struct TelemetryClient;

impl TelemetryClient {
    pub(crate) fn new(
        _app: &AppHandle,
        _device_id: String,
        _enabled: bool,
    ) -> (Arc<Self>, Option<mpsc::Receiver<QueuedEvent>>) {
        (Arc::new(Self), None)
    }

    pub fn current_distinct_id(&self) -> String {
        String::new()
    }

    pub fn account_id(&self) -> Option<String> {
        None
    }

    pub fn is_enabled(&self) -> bool {
        false
    }

    pub fn config(&self) -> TelemetryConfig {
        TelemetryConfig::default()
    }

    pub fn set_enabled(&self, _on: bool) {}

    pub fn capture(&self, _event: &str, _properties: Value) {}

    pub fn identify_account(&self, _id: &AccountIdentity) {}

    pub fn set_active_org(&self, _org: Option<OrgIdentity>) {}

    pub fn reset_identity(&self) {}

    pub fn capture_signed_in(&self, _org_count: usize, _has_active_org: bool) {}

    pub fn capture_signed_out(&self) {}

    pub fn capture_panic_blocking(&self, _properties: Value) {}

    pub async fn capture_user_initiated(
        &self,
        _event: &str,
        _properties: Value,
    ) -> Result<(), String> {
        Ok(())
    }
}

// ── Utility functions ─────────────────────────────────────────────────────────

/// Truncate a message for safe logging. Kept functional (used in error paths).
pub fn redact_message(msg: &str, max_chars: usize) -> String {
    if msg.chars().count() <= max_chars {
        msg.to_string()
    } else {
        let truncated: String = msg.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

/// No-op flush loop. Returns immediately since there is nothing to flush.
pub async fn run_flush_loop(_client: Arc<TelemetryClient>, _rx: mpsc::Receiver<QueuedEvent>) {}
