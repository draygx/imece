//! In-app auto-updater — the IPC surface, plus platform dispatch.
//!
//! İmece is Linux-only and has no in-app updater: the macOS implementation
//! (mount a DMG, `codesign`/`spctl` verification, swap an `.app` bundle) was
//! removed together with macOS support, and `updater_stub.rs` is a no-op that
//! keeps the same signatures so the IPC surface below stays stable.
//!
//! The four `#[tauri::command]` verbs and the DTOs they return are declared
//! **here, once**, per the "IPC verbs grouped into a single
//! `commands/<domain>.rs`" convention in CONTRIBUTING.md.

use serde::Serialize;
use tauri::{AppHandle, State};

#[path = "updater_stub.rs"]
mod imp;

/// Opaque per-platform updater state, `manage`d in `lib.rs`.
pub use imp::UpdaterState;

// Lifecycle hooks driven by `lib.rs`. These aren't IPC verbs, so they
// re-export directly rather than going through a wrapper.
pub use imp::{apply_on_exit, check_in_background, init_on_startup, spawn_periodic};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: String,
}

/// UI-hydration snapshot (Settings / titlebar on mount).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSnapshot {
    /// "idle" | "downloading" | "ready"
    pub phase: String,
    pub version: Option<String>,
    pub current_version: String,
}

/// Manual "Check for updates" — bypasses the auto_update / ignored gates (an
/// explicit user action). Triggers the background download when newer.
#[tauri::command]
pub async fn update_check_now(app: AppHandle) -> Result<UpdateStatus, String> {
    imp::update_check_now(app).await
}

/// Current updater state for UI hydration on mount.
#[tauri::command]
pub fn update_state(app: AppHandle, state: State<'_, UpdaterState>) -> UpdaterSnapshot {
    imp::update_state(app, state)
}

/// Persist a "don't prompt for this version again" choice.
#[tauri::command]
pub async fn update_ignore(version: String, app: AppHandle) -> Result<(), String> {
    imp::update_ignore(version, app).await
}

/// "Restart now": swap the staged `.app` over the running install and relaunch.
#[tauri::command]
pub async fn update_apply(app: AppHandle) -> Result<(), String> {
    imp::update_apply(app).await
}
