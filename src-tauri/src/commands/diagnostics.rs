//! Start-up diagnostics for an external agent.
//!
//! Every "Codex never starts" report used to arrive empty-handed: the shipped
//! app had no log file, the npm log lived in a hidden cache directory, and the
//! install directory's state was invisible. This command gathers all of it into
//! one plain-text blob the stalled-start affordance can copy, so the next
//! report carries the phase that stalled instead of a screenshot of a timer.
//!
//! Nothing here is user content: log lines are Atlas's own tracing output, the
//! npm log is npm's, and the paths are Atlas's install locations.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager as _};

/// How many trailing lines of each log to include.
const LOG_TAIL_LINES: usize = 200;
const NPM_TAIL_LINES: usize = 60;

#[tauri::command]
pub async fn agents_start_diagnostics(plugin_id: String, app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    tokio::task::spawn_blocking(move || gather(&plugin_id, &data_dir))
        .await
        .map_err(|e| e.to_string())
}

fn gather(plugin_id: &str, data_dir: &Path) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "İmece {} — start diagnostics for `{plugin_id}` at {}\n",
        env!("CARGO_PKG_VERSION"),
        chrono::Local::now().to_rfc3339()
    ));
    out.push_str(&format!("os: {} {}\n\n", std::env::consts::OS, std::env::consts::ARCH));

    // 1. The agent's install directory.
    let install_dir = data_dir
        .join("external-agents")
        .join("registry")
        .join("npx")
        .join(plugin_id);
    out.push_str(&format!("## install dir: {}\n", install_dir.display()));
    if install_dir.is_dir() {
        for name in ["package.json", ".atlas-wanted"] {
            match std::fs::read_to_string(install_dir.join(name)) {
                Ok(s) => out.push_str(&format!("{name}: {}\n", s.trim())),
                Err(e) => out.push_str(&format!("{name}: <{e}>\n")),
            }
        }
        let node_modules = install_dir.join("node_modules");
        out.push_str(&format!("node_modules present: {}\n", node_modules.is_dir()));
    } else {
        out.push_str("(missing — the package has never been installed)\n");
    }

    // 2. The managed Node runtime.
    let node_root = data_dir.join("node");
    out.push_str(&format!("\n## managed node: {}\n", node_root.display()));
    let mut node_dirs: Vec<PathBuf> = std::fs::read_dir(&node_root)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    node_dirs.sort();
    if node_dirs.is_empty() {
        out.push_str("(not installed)\n");
    }
    for dir in &node_dirs {
        let bin = dir.join("bin").join("node");
        out.push_str(&format!("{}: node binary present: {}\n", dir.display(), bin.is_file()));
    }

    // 3. The most recent npm log.
    let npm_log = node_dirs
        .iter()
        .filter_map(|dir| newest_file(&dir.join("cache").join("_logs")))
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    out.push_str("\n## last npm log\n");
    match npm_log {
        Some(path) => {
            out.push_str(&format!("{}\n", path.display()));
            out.push_str(&tail(&path, NPM_TAIL_LINES, |line| !line.contains(" silly ")));
        }
        None => out.push_str("(none)\n"),
    }

    // 4. Atlas's own log, filtered to agent lifecycle lines.
    out.push_str("\n## atlas log (agent lines)\n");
    match crate::logging::log_dir().and_then(|dir| newest_file(&dir)) {
        Some(path) => {
            out.push_str(&format!("{}\n", path.display()));
            let needle = plugin_id.to_string();
            out.push_str(&tail(&path, LOG_TAIL_LINES, move |line| {
                line.contains(&needle)
                    || line.contains("agent")
                    || line.contains("session/")
                    || line.contains("npm")
                    || line.contains("Node")
            }));
        }
        None => out.push_str("(no log file — launched from a terminal?)\n"),
    }

    out
}

fn newest_file(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

fn tail(path: &Path, lines: usize, keep: impl Fn(&str) -> bool) -> String {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return "(unreadable)\n".to_string();
    };
    let kept: Vec<&str> = contents.lines().filter(|l| keep(l)).collect();
    let start = kept.len().saturating_sub(lines);
    let mut s = kept[start..].join("\n");
    s.push('\n');
    s
}
