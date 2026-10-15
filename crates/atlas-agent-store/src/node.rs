//! The managed Node runtime.
//!
//! Ported from `zed-ref/crates/node_runtime/src/node_runtime.rs` (its
//! `ManagedNodeRuntime`, `read_package_executable`, `npm_command_env`) and used
//! for exactly the two things Zed uses it for: running an npx-distributed agent,
//! and satisfying a binary target whose `cmd` is `"node"`.
//!
//! DECIDED, research §D12-8: managed only. Zed can fall back to a system Node;
//! Atlas does not, and this is what retires `node_setup.rs`'s nvm flow. The
//! reason is the one Zed gives implicitly by requiring `cmd == "node"` and
//! supplying its own runtime — an agent that works on the developer's machine
//! and not on the user's because their Node is three majors old is a support
//! burden with no upside.
//!
//! Nothing here is on a spawn ladder: this runtime is never *searched for*, it
//! is downloaded to a known path and used from there.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context as _, Result};
use semver::Version;
use tokio::sync::watch;

use crate::archive::{install_archive, registry_archive_kind_for_url};
use crate::http::HttpClient;

const NODE_VERSION: &str = "v24.11.0";
const NODE_CA_CERTS_ENV_VAR: &str = "NODE_EXTRA_CA_CERTS";

/// How long one `npm <subcommand>` may run before it is killed. npm's own
/// fetch timeouts (see [`npm_command_args`]) bound each registry request; this
/// bounds the whole invocation, so a 290 MB install on a slow link still fits
/// but a wedged one cannot hold a "Starting …" bubble forever.
const NPM_TIMEOUT: Duration = Duration::from_secs(600);

/// How long the Node tarball download + extract may take while holding the
/// install lock. Past this, every agent waiting on Node fails with a clear
/// error instead of queueing behind a stalled socket.
const NODE_INSTALL_TIMEOUT: Duration = Duration::from_secs(900);

/// What the managed user-level npmrc pins. `update-notifier=false` stops npm
/// making a `GET registry.npmjs.org/npm` on every run just to advertise a
/// newer npm — one fewer network round-trip on the agent start path.
const USER_NPMRC: &str = "update-notifier=false\n";

/// A loading-status channel, as the store hands it out (`Some(text)` while
/// something is in flight, `None` when the agent is ready).
pub type LoadingStatus = watch::Sender<Option<String>>;

pub(crate) const NODE_PATH: &str = "bin/node";

// `bin/npm` in the distribution is a symlink to npm's CLI entry point, so
// `node bin/npm …` runs npm without a shell.
const NPM_PATH: &str = "bin/npm";

#[derive(Clone)]
pub struct NodeRuntime(Arc<Inner>);

enum Inner {
    Managed {
        containing_dir: PathBuf,
        http: Arc<dyn HttpClient>,
        /// Serialises installation: two agents resolving at once must not both
        /// download Node over the top of each other.
        install: tokio::sync::Mutex<Option<PathBuf>>,
    },
    Unavailable(String),
}

impl NodeRuntime {
    /// A runtime that installs itself under `<data_dir>/node` on first use.
    pub fn managed(data_dir: &Path, http: Arc<dyn HttpClient>) -> Self {
        Self(Arc::new(Inner::Managed {
            containing_dir: data_dir.join("node"),
            http,
            install: tokio::sync::Mutex::new(None),
        }))
    }

    /// A runtime that fails with `reason` when anything asks for it. Zed's
    /// `NodeRuntime::unavailable()`; here it is how a test builds a store whose
    /// agents never need Node.
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self(Arc::new(Inner::Unavailable(reason.into())))
    }

    pub async fn binary_path(&self) -> Result<PathBuf> {
        Ok(self.install_if_needed(None).await?.join(NODE_PATH))
    }

    /// Install Node if it is missing, reporting a download to `loading_status`.
    ///
    /// Callers that will go on to run npm call this first, so the user sees
    /// "Downloading Node.js…" during the one step that can take minutes rather
    /// than a bare "Starting …". When Node is already present nothing is sent.
    pub async fn ensure_installed(&self, loading_status: Option<&LoadingStatus>) -> Result<PathBuf> {
        self.install_if_needed(loading_status).await
    }

    /// Run `npm <subcommand> <args>`, retrying once.
    ///
    /// The retry is Zed's (`node_runtime.rs:764-800`) and is not superstition:
    /// npm's first run after an install can fail while it populates its cache.
    pub async fn run_npm_subcommand(
        &self,
        directory: Option<&Path>,
        subcommand: &str,
        args: &[&str],
    ) -> Result<Output> {
        let node_dir = self.install_if_needed(None).await?;

        let mut output = self.npm_attempt(&node_dir, directory, subcommand, args).await;
        // Retry spawn/IO failures only. A timeout already waited ten minutes;
        // doing it again would double the hang the deadline exists to end.
        if output
            .as_ref()
            .is_err_and(|error| !error.is::<NpmTimedOut>())
        {
            output = self.npm_attempt(&node_dir, directory, subcommand, args).await;
        }
        let output = output.with_context(|| format!("launching npm {subcommand}"))?;

        anyhow::ensure!(
            output.status.success(),
            "failed to execute npm {subcommand} subcommand:\nstdout: {:?}\nstderr: {:?}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        Ok(output)
    }

    async fn npm_attempt(
        &self,
        node_dir: &Path,
        directory: Option<&Path>,
        subcommand: &str,
        args: &[&str],
    ) -> Result<Output> {
        let node_binary = node_dir.join(NODE_PATH);
        let npm_file = node_dir.join(NPM_PATH);
        anyhow::ensure!(
            tokio::fs::metadata(&node_binary).await.is_ok(),
            "missing node binary file"
        );
        anyhow::ensure!(
            tokio::fs::metadata(&npm_file).await.is_ok(),
            "missing npm file"
        );

        let mut command = tokio::process::Command::new(&node_binary);
        command.args(npm_command_args(&npm_file, node_dir, directory, subcommand, args));
        command.envs(npm_command_env(&node_binary));
        if let Some(directory) = directory {
            command.current_dir(directory);
        }
        // Dropping the future on timeout must take the npm process with it,
        // or the next attempt races an orphan over the same `node_modules`.
        command.kill_on_drop(true);

        match tokio::time::timeout(NPM_TIMEOUT, command.output()).await {
            Ok(output) => Ok(output?),
            Err(_elapsed) => Err(NpmTimedOut {
                subcommand: subcommand.to_owned(),
                timeout: NPM_TIMEOUT,
            }
            .into()),
        }
    }

    // The `install` guard is held across the download and extract on purpose:
    // it is a double-checked install lock, and the whole point is that a second
    // caller waits rather than racing a `remove_dir_all(containing_dir)` against
    // an extraction already in flight. That is what `tokio::sync::Mutex` is for.
    #[expect(
        clippy::await_holding_invalid_type,
        reason = "the install lock must span the download so concurrent callers do not race the extract"
    )]
    async fn install_if_needed(&self, loading_status: Option<&LoadingStatus>) -> Result<PathBuf> {
        let (containing_dir, http, install) = match &*self.0 {
            Inner::Unavailable(reason) => bail!("Node.js is unavailable: {reason}"),
            Inner::Managed {
                containing_dir,
                http,
                install,
            } => (containing_dir, http, install),
        };

        let mut install = install.lock().await;
        if let Some(node_dir) = install.as_ref() {
            return Ok(node_dir.clone());
        }

        let (os, arch) = node_platform()?;
        let node_dir = containing_dir.join(format!("node-{NODE_VERSION}-{os}-{arch}"));

        if !node_install_works(&node_dir).await {
            // Not just the version directory: Zed wipes the whole containing
            // directory (`node_runtime.rs:680-683`) so an abandoned install of
            // another version does not accumulate.
            let _ = tokio::fs::remove_dir_all(containing_dir).await;

            let extension = if cfg!(windows) { "zip" } else { "tar.gz" };
            let url = format!(
                "https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-{os}-{arch}.{extension}"
            );
            tracing::info!(url, "downloading the managed Node.js runtime");
            if let Some(tx) = loading_status {
                tx.send(Some("Downloading Node.js…".to_owned())).ok();
            }

            // The tarball's single top-level directory is the version directory,
            // so extracting it *into* the containing dir produces `node_dir`.
            let kind = registry_archive_kind_for_url(&url)?;
            // Bounded, because the install lock is held across this: a stalled
            // nodejs.org socket would otherwise block every agent for good.
            // A timeout leaves `install` as `None`, so the next caller retries.
            tokio::time::timeout(
                NODE_INSTALL_TIMEOUT,
                install_archive(&**http, &url, None, containing_dir, &kind),
            )
            .await
            .map_err(|_elapsed| {
                anyhow::anyhow!(
                    "the Node.js runtime download from {url} did not finish within {} minutes \
                     (nodejs.org may be unreachable)",
                    NODE_INSTALL_TIMEOUT.as_secs() / 60
                )
            })?
            .context("installing the managed Node.js runtime")?;

            anyhow::ensure!(
                node_install_works(&node_dir).await,
                "the downloaded Node.js runtime at {node_dir:?} does not run"
            );

            // A fresh runtime starts with a fresh npm cache. This is the only
            // place the cache is wiped: keeping it across launches is what lets
            // `--prefer-offline` answer an already-installed package without a
            // registry round-trip.
            let _ = tokio::fs::remove_dir_all(node_dir.join("cache")).await;
        }

        // Outside the install branch on purpose, so an installation from an
        // earlier Atlas version gets these too.
        let _ = tokio::fs::create_dir_all(node_dir.join("cache")).await;
        let _ = tokio::fs::write(node_dir.join("blank_user_npmrc"), USER_NPMRC).await;
        let _ = tokio::fs::write(node_dir.join("blank_global_npmrc"), []).await;

        *install = Some(node_dir.clone());
        Ok(node_dir)
    }
}

/// `npm <subcommand>` outlived [`NPM_TIMEOUT`] and was killed.
///
/// Its own type so [`NodeRuntime::run_npm_subcommand`] can tell it apart from
/// a spawn failure and skip the retry.
#[derive(Debug)]
struct NpmTimedOut {
    subcommand: String,
    timeout: Duration,
}

impl std::fmt::Display for NpmTimedOut {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "npm {} did not finish within {} minutes (the npm registry may be unreachable)",
            self.subcommand,
            self.timeout.as_secs() / 60
        )
    }
}

impl std::error::Error for NpmTimedOut {}

/// Whether the Node at `node_dir` actually runs.
///
/// Zed checks by running npm rather than by checking the file exists
/// (`node_runtime.rs:641-676`): a half-extracted or wrong-architecture install
/// has the file and fails at the worst possible moment otherwise.
async fn node_install_works(node_dir: &Path) -> bool {
    let node_binary = node_dir.join(NODE_PATH);
    if tokio::fs::metadata(&node_binary).await.is_err() {
        return false;
    }

    let npm_file = node_dir.join(NPM_PATH);
    let result = tokio::process::Command::new(&node_binary)
        .env(
            NODE_CA_CERTS_ENV_VAR,
            std::env::var(NODE_CA_CERTS_ENV_VAR).unwrap_or_default(),
        )
        .arg(&npm_file)
        .arg("--version")
        .args(["--cache".into(), node_dir.join("cache")])
        .args(["--userconfig".into(), node_dir.join("blank_user_npmrc")])
        .args(["--globalconfig".into(), node_dir.join("blank_global_npmrc")])
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            tracing::warn!(
                node = %node_binary.display(),
                stderr = %String::from_utf8_lossy(&output.stderr),
                "the managed Node.js binary failed its check"
            );
            false
        }
        Err(error) => {
            tracing::warn!(
                node = %node_binary.display(),
                %error,
                "the managed Node.js binary could not be run"
            );
            false
        }
    }
}

fn node_platform() -> Result<(&'static str, &'static str)> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "win",
        other => bail!("running on unsupported os: {other}"),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => bail!("running on unsupported architecture: {other}"),
    };
    Ok((os, arch))
}

/// The fetch policy every managed npm run gets. Zed's
/// (`node_runtime.rs:1140-1150`) is `--fetch-timeout 5000` with retries of
/// 2000/5000 ms, tuned for a language server; an ACP agent install can be
/// 290 MB, so the per-request timeout is a minute and the retry ceiling ten
/// seconds. `--prefer-offline` makes a warm cache skip the registry entirely,
/// and audit/fund are two more round-trips that answer nothing we act on.
const NPM_FETCH_ARGS: &[&str] = &[
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    "--fetch-timeout",
    "60000",
    "--fetch-retries",
    "2",
    "--fetch-retry-mintimeout",
    "2000",
    "--fetch-retry-maxtimeout",
    "10000",
];

/// Ported from `build_npm_command_args` (`node_runtime.rs:1124-1158`). Every
/// path is pinned at the managed install so npm never reads the user's npmrc or
/// writes their global cache.
fn npm_command_args(
    npm_file: &Path,
    node_dir: &Path,
    prefix_dir: Option<&Path>,
    subcommand: &str,
    args: &[&str],
) -> Vec<String> {
    let mut command_args = vec![npm_file.to_string_lossy().into_owned()];
    if let Some(prefix_dir) = prefix_dir {
        command_args.push("--prefix".into());
        command_args.push(prefix_dir.to_string_lossy().into_owned());
    }
    command_args.push(subcommand.to_string());
    command_args.push(format!("--cache={}", node_dir.join("cache").display()));
    command_args.push("--userconfig".into());
    command_args.push(node_dir.join("blank_user_npmrc").to_string_lossy().into_owned());
    command_args.push("--globalconfig".into());
    command_args.push(
        node_dir
            .join("blank_global_npmrc")
            .to_string_lossy()
            .into_owned(),
    );
    command_args.extend(NPM_FETCH_ARGS.iter().map(std::string::ToString::to_string));
    command_args.extend(args.iter().map(std::string::ToString::to_string));
    command_args
}

/// The environment an npx-distributed agent needs: the managed Node first on
/// `PATH`, so a package that shells out to `node` gets ours rather than
/// whatever the user has (`node_runtime.rs:1160-1190`).
pub fn npm_command_env(node_binary: &Path) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Some(path) = path_with_node_binary_prepended(node_binary) {
        env.insert("PATH".to_string(), path);
    }

    if let Ok(node_ca_certs) = std::env::var(NODE_CA_CERTS_ENV_VAR) {
        if !node_ca_certs.is_empty() {
            env.insert(NODE_CA_CERTS_ENV_VAR.to_string(), node_ca_certs);
        }
    }

    env
}

fn path_with_node_binary_prepended(node_binary: &Path) -> Option<String> {
    let node_bin_dir = node_binary.parent()?;
    let existing = std::env::var_os("PATH");
    let joined = match &existing {
        Some(existing) => std::env::join_paths(
            std::iter::once(node_bin_dir.to_path_buf())
                .chain(std::env::split_paths(existing)),
        )
        .ok()?,
        None => node_bin_dir.as_os_str().to_owned(),
    };
    Some(joined.to_string_lossy().into_owned())
}

/// The executable an npm package declares, resolved out of its `package.json`.
/// Ported from `node_runtime.rs:1019-1064`.
pub async fn read_package_executable(node_modules_dir: &Path, name: &str) -> Result<PathBuf> {
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Bin {
        Path(String),
        Named(HashMap<String, String>),
    }

    #[derive(serde::Deserialize)]
    struct PackageJson {
        bin: Option<Bin>,
    }

    let package_directory = node_modules_dir.join(name);
    let package_json_path = package_directory.join("package.json");
    let contents = tokio::fs::read_to_string(&package_json_path)
        .await
        .with_context(|| format!("opening {}", package_json_path.display()))?;
    let package_json: PackageJson = serde_json::from_str(&contents)
        .with_context(|| format!("parsing {}", package_json_path.display()))?;

    let relative_path = match package_json.bin {
        Some(Bin::Path(path)) => path,
        Some(Bin::Named(bins)) => {
            let unscoped_name = name.rsplit('/').next().unwrap_or(name);
            let path = if bins.len() == 1 {
                bins.values().next()
            } else {
                bins.get(unscoped_name)
            };
            path.with_context(|| {
                format!("npm package {name} declares no executable named {unscoped_name}")
            })?
            .clone()
        }
        None => bail!("npm package {name} declares no executable"),
    };

    Ok(package_directory.join(relative_path))
}

/// Turn `pkg@1.2.3` into `("pkg", "pkg@0.0.0 - 1.2.3")` — a version *ceiling*,
/// not a pin.
///
/// Ported verbatim, comment and all, from `agent_server_store.rs:1436-1477`:
///
/// > People are using min-release-age more frequently. Which means a fresh
/// > registry will likely have new package versions than the user can install.
/// > We set the version to now be a ceiling and not an exact pin instead. This
/// > allows npm to resolve the latest version it can find that satisfies the
/// > constraint. […] This is a best-effort attempt to install a version that
/// > works without overriding the user's security settings.
/// >
/// > We use npm's hyphen-range syntax (`0.0.0 - <version>`, equivalent to
/// > `<=<version>`) instead of the more compact `<=<version>` form because on
/// > Windows, `npm` is `npm.cmd` (a batch file run by cmd.exe), and the quotes
/// > our shell builder emits are PowerShell string-literal syntax that PS strips
/// > during parsing. […] so `package@<=0.25.3` reaches cmd.exe bare and the
/// > unquoted `<` is interpreted as input redirection. See
/// > zed-industries/zed#55921.
pub fn bounded_npm_package_spec(package_spec: &str) -> (&str, String) {
    let Some((package_name, version)) = package_spec.rsplit_once('@') else {
        return (package_spec, package_spec.to_string());
    };
    if package_name.is_empty() {
        return (package_spec, package_spec.to_string());
    }
    if Version::parse(version).is_err() {
        return (package_name, package_spec.to_string());
    }

    (package_name, format!("{package_name}@0.0.0 - {version}"))
}

/// The version ceiling a package spec implies, if it names a parseable one.
///
/// Same split as [`bounded_npm_package_spec`]: `pkg@1.2.3` → `1.2.3`;
/// `pkg`, `pkg@latest` and a bare scoped name → `None`.
fn package_spec_ceiling(package_spec: &str) -> Option<Version> {
    let (package_name, version) = package_spec.rsplit_once('@')?;
    if package_name.is_empty() {
        return None;
    }
    Version::parse(version).ok()
}

/// Whether an already-installed package satisfies `wanted_spec`, so the
/// `npm install` can be skipped.
///
/// The bounded spec is a ceiling (`0.0.0 - <version>`), so "satisfies" is
/// `installed <= ceiling`. A spec with no parseable version (`pkg`,
/// `pkg@latest`) has no ceiling to check, so any installed copy counts; the
/// caller still requires the package to exist and declare an executable.
pub fn installed_version_satisfies(installed: &str, wanted_spec: &str) -> bool {
    let Some(ceiling) = package_spec_ceiling(wanted_spec) else {
        return true;
    };
    match Version::parse(installed.trim()) {
        Ok(installed) => installed <= ceiling,
        Err(_) => false,
    }
}

/// The `version` an installed npm package declares, or `None` when it is not
/// installed or its `package.json` does not parse.
pub async fn installed_package_version(node_modules_dir: &Path, name: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct PackageJson {
        version: Option<String>,
    }

    let package_json_path = node_modules_dir.join(name).join("package.json");
    let contents = tokio::fs::read_to_string(&package_json_path).await.ok()?;
    let package_json: PackageJson = serde_json::from_str(&contents).ok()?;
    Some(package_json.version.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_version_is_a_ceiling_check() {
        assert!(installed_version_satisfies("1.2.3", "pkg@1.2.3"));
        assert!(installed_version_satisfies("1.0.0", "pkg@1.2.3"));
        assert!(installed_version_satisfies("0.0.1", "@scope/pkg@1.2.3"));
        assert!(!installed_version_satisfies("1.2.4", "pkg@1.2.3"));
        assert!(!installed_version_satisfies("2.0.0", "@scope/pkg@1.2.3"));

        // Prereleases order below their release, as semver says.
        assert!(installed_version_satisfies("1.2.3-beta.1", "pkg@1.2.3"));
        assert!(!installed_version_satisfies("1.2.3", "pkg@1.2.3-beta.1"));
    }

    #[test]
    fn unparseable_installed_version_forces_a_reinstall() {
        assert!(!installed_version_satisfies("", "pkg@1.2.3"));
        assert!(!installed_version_satisfies("garbage", "pkg@1.2.3"));
    }

    #[test]
    fn a_spec_without_a_ceiling_accepts_any_installed_copy() {
        assert!(installed_version_satisfies("9.9.9", "pkg"));
        assert!(installed_version_satisfies("9.9.9", "@scope/pkg"));
        assert!(installed_version_satisfies("9.9.9", "pkg@latest"));
        assert!(installed_version_satisfies("", "pkg@latest"));
    }

    #[test]
    fn npm_args_pin_config_and_bound_fetches() {
        let node_dir = Path::new("/opt/atlas/node/node-v24");
        let npm = node_dir.join("bin/npm");
        let args = npm_command_args(
            &npm,
            node_dir,
            Some(Path::new("/opt/atlas/npx/codex")),
            "install",
            &["codex-acp@0.0.0 - 1.0.0", "--save-exact"],
        );

        let joined = args.join(" ");
        assert!(joined.starts_with(&format!(
            "{} --prefix /opt/atlas/npx/codex install --cache=/opt/atlas/node/node-v24/cache \
             --userconfig /opt/atlas/node/node-v24/blank_user_npmrc \
             --globalconfig /opt/atlas/node/node-v24/blank_global_npmrc ",
            npm.display()
        )), "got {joined}");
        assert!(joined.contains(
            "--no-audit --no-fund --prefer-offline --fetch-timeout 60000 --fetch-retries 2 \
             --fetch-retry-mintimeout 2000 --fetch-retry-maxtimeout 10000"
        ), "got {joined}");
        // The caller's own args come last.
        assert_eq!(&args[args.len() - 2..], ["codex-acp@0.0.0 - 1.0.0", "--save-exact"]);
    }

    #[test]
    fn npm_timeout_error_names_the_phase() {
        let error: anyhow::Error = NpmTimedOut {
            subcommand: "install".into(),
            timeout: NPM_TIMEOUT,
        }
        .into();
        assert!(error.is::<NpmTimedOut>());
        assert_eq!(
            error.to_string(),
            "npm install did not finish within 10 minutes (the npm registry may be unreachable)"
        );
    }
}
