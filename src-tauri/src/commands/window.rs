//! Native window controls that Tauri's cross-platform API doesn't cover.

/// Kept so the frontend's titlebar double-click handler still has a command to
/// call. It was the macOS-only AppKit `performZoom:`; on Linux the webview's own
/// maximize handling applies, so this is a no-op.
#[tauri::command]
pub fn window_zoom(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window;
    Ok(())
}

/// Set the native window title. The frontend drives this from the active
/// project so the OS shows `projectName - Atlas` (visible on minimize /
/// window-menu / hover), falling back to plain `Atlas` when no project is
/// open. Tauri's JS `setTitle` exists, but routing it through a command
/// keeps the title an effect of Rust-owned project state.
#[tauri::command]
pub fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}
