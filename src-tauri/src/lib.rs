use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const STATE_FILE_NAME: &str = "launcher-state.json";
const BLENDER_EXECUTABLE_NAME: &str = "blender.exe";
const BLENDER_RELEASE_INDEX_URL: &str = "https://download.blender.org/release/";
const RELEASE_INSTALL_EVENT: &str = "release-install-progress";
const VOXELSHIFT_DIR_NAME: &str = "VoxelShift";
const STABLE_INSTALL_DIR_NAME: &str = "stable";
const TEMP_INSTALL_DIR_NAME: &str = ".tmp";
const DOWNLOAD_PROGRESS_WEIGHT: f64 = 95.0;
const INSTALL_CANCELED_MESSAGE: &str = "Installation canceled.";
const MAX_SCAN_DEPTH: usize = 5;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum VersionSource {
    Discovered,
    Manual,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlenderVersion {
    id: String,
    display_name: String,
    version: Option<String>,
    executable_path: String,
    install_dir: String,
    source: VersionSource,
    available: bool,
    is_default: bool,
    last_launched_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    versions: Vec<BlenderVersion>,
    scan_roots: Vec<String>,
    detected_at: u64,
}

#[derive(Clone, Debug)]
struct ReleasePlatform {
    file_suffix: &'static str,
    label: &'static str,
}

#[derive(Clone, Debug)]
struct BlenderReleaseChannel {
    name: String,
    version: String,
    url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlenderReleaseDownload {
    id: String,
    channel: String,
    version: String,
    file_name: String,
    release_date: String,
    url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderReleaseListing {
    platform_label: String,
    downloads: Vec<BlenderReleaseDownload>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredState {
    default_id: Option<String>,
    scan_roots: Vec<String>,
    tracked_versions: Vec<TrackedVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackedVersion {
    id: String,
    executable_path: String,
    display_name: Option<String>,
    source: VersionSource,
    last_launched_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest {
    path: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchRequest {
    id: String,
    extra_args: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallReleaseRequest {
    id: String,
    version: String,
    file_name: String,
    url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseInstallProgress {
    release_id: String,
    phase: String,
    progress_percent: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_second: Option<f64>,
    install_dir: Option<String>,
    message: String,
}

#[derive(Clone, Default)]
struct ReleaseInstallControl {
    active_ids: Arc<Mutex<HashSet<String>>>,
    canceled_ids: Arc<Mutex<HashSet<String>>>,
}

impl ReleaseInstallControl {
    fn begin(&self, release_id: &str) -> Result<(), String> {
        let mut active_ids = self
            .active_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?;
        if active_ids.contains(release_id) {
            return Err("That release is already being installed.".to_string());
        }
        active_ids.insert(release_id.to_string());
        drop(active_ids);
        self.canceled_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .remove(release_id);
        Ok(())
    }

    fn request_cancel(&self, release_id: &str) -> Result<bool, String> {
        let is_active = self
            .active_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .contains(release_id);
        if !is_active {
            return Ok(false);
        }
        self.canceled_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .insert(release_id.to_string());
        Ok(true)
    }

    fn is_cancel_requested(&self, release_id: &str) -> Result<bool, String> {
        Ok(self
            .canceled_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .contains(release_id))
    }

    fn finish(&self, release_id: &str) -> Result<(), String> {
        self.active_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .remove(release_id);
        self.canceled_ids
            .lock()
            .map_err(|_| "Unable to access install state.".to_string())?
            .remove(release_id);
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(ReleaseInstallControl::default())
        .setup(|app| {
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                window.set_icon(icon)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_launcher_state,
            scan_for_blender_versions,
            register_blender_version,
            remove_blender_version,
            set_default_blender_version,
            add_scan_root,
            remove_scan_root,
            launch_blender,
            open_version_location,
            get_blender_release_downloads,
            install_blender_release,
            cancel_blender_release_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running Voxel Shift");
}

#[tauri::command]
fn get_launcher_state(app: AppHandle) -> Result<LauncherState, String> {
    build_launcher_state(&app)
}

#[tauri::command]
fn scan_for_blender_versions(app: AppHandle) -> Result<LauncherState, String> {
    build_launcher_state(&app)
}

#[tauri::command]
async fn get_blender_release_downloads() -> Result<BlenderReleaseListing, String> {
    let platform = current_release_platform().ok_or_else(|| {
        format!(
            "This platform is not supported for release downloads: {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;

    let client = reqwest::Client::new();
    let root_body = fetch_text(&client, BLENDER_RELEASE_INDEX_URL).await?;
    let channels = parse_blender_release_channels(&root_body);
    let mut downloads = Vec::new();

    for channel in channels {
        let folder_body = match fetch_text(&client, &channel.url).await {
            Ok(body) => body,
            Err(_) => continue,
        };

        downloads.extend(parse_release_downloads(
            &folder_body,
            &channel,
            platform.file_suffix,
        ));
    }

    downloads.sort_by(|left, right| {
        compare_version_values(&right.version, &left.version)
            .then_with(|| right.channel.cmp(&left.channel))
    });

    if downloads.is_empty() {
        return Err(format!(
            "No stable Blender downloads ending with {} were found.",
            platform.file_suffix
        ));
    }

    Ok(BlenderReleaseListing {
        platform_label: platform.label.to_string(),
        downloads,
    })
}

#[tauri::command]
async fn install_blender_release(
    app: AppHandle,
    control: tauri::State<'_, ReleaseInstallControl>,
    request: InstallReleaseRequest,
) -> Result<LauncherState, String> {
    validate_install_request(&request)?;

    let existing_state = build_launcher_state(&app)?;
    if existing_state
        .versions
        .iter()
        .any(|version| version.available && version.version.as_deref() == Some(request.version.as_str()))
    {
        return Err(format!("Blender {} is already installed.", request.version));
    }

    control.begin(&request.id)?;

    let install_result = async {
        let stable_dir = stable_install_dir(&app)?;
        let temp_dir = temp_install_root(&app)?.join(&request.id);

        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)
                .map_err(|error| format!("Unable to clear a previous install attempt: {error}"))?;
        }

        fs::create_dir_all(&stable_dir)
            .map_err(|error| format!("Unable to prepare the stable install directory: {error}"))?;
        fs::create_dir_all(&temp_dir)
            .map_err(|error| format!("Unable to prepare the temporary install directory: {error}"))?;

        let archive_path = temp_dir.join(&request.file_name);

        emit_release_install_progress(
            &app,
            ReleaseInstallProgress {
                release_id: request.id.clone(),
                phase: "starting".to_string(),
                progress_percent: Some(0.0),
                downloaded_bytes: 0,
                total_bytes: None,
                speed_bytes_per_second: None,
                install_dir: None,
                message: format!("Preparing Blender {} for install", request.version),
            },
        );

        if let Err(error) = download_release_archive(&app, control.inner(), &request, &archive_path).await {
            let _ = fs::remove_dir_all(&temp_dir);
            let phase = if error == INSTALL_CANCELED_MESSAGE {
                "canceled"
            } else {
                "failed"
            };
            emit_release_install_progress(
                &app,
                ReleaseInstallProgress {
                    release_id: request.id.clone(),
                    phase: phase.to_string(),
                    progress_percent: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    speed_bytes_per_second: None,
                    install_dir: None,
                    message: error.clone(),
                },
            );
            return Err(error);
        }

        let final_install_dir = match extract_release_archive(
            &app,
            control.inner().clone(),
            &request,
            &archive_path,
            &stable_dir,
            &temp_dir,
        )
        .await
        {
            Ok(path) => path,
            Err(error) => {
                let _ = fs::remove_dir_all(&temp_dir);
                let phase = if error == INSTALL_CANCELED_MESSAGE {
                    "canceled"
                } else {
                    "failed"
                };
                emit_release_install_progress(
                    &app,
                    ReleaseInstallProgress {
                        release_id: request.id.clone(),
                        phase: phase.to_string(),
                        progress_percent: None,
                        downloaded_bytes: 0,
                        total_bytes: None,
                        speed_bytes_per_second: None,
                        install_dir: None,
                        message: error.clone(),
                    },
                );
                return Err(error);
            }
        };

        let _ = fs::remove_file(&archive_path);
        let _ = fs::remove_dir_all(&temp_dir);

        let launcher_state = build_launcher_state(&app)?;

        emit_release_install_progress(
            &app,
            ReleaseInstallProgress {
                release_id: request.id.clone(),
                phase: "completed".to_string(),
                progress_percent: Some(100.0),
                downloaded_bytes: 0,
                total_bytes: None,
                speed_bytes_per_second: None,
                install_dir: Some(path_to_string(&final_install_dir)),
                message: format!("Blender {} is ready to launch.", request.version),
            },
        );

        Ok(launcher_state)
    }
    .await;

    let _ = control.finish(&request.id);
    install_result
}

#[tauri::command]
fn cancel_blender_release_install(
    app: AppHandle,
    control: tauri::State<'_, ReleaseInstallControl>,
    id: String,
) -> Result<(), String> {
    if control.request_cancel(&id)? {
        emit_release_install_progress(
            &app,
            ReleaseInstallProgress {
                release_id: id,
                phase: "canceling".to_string(),
                progress_percent: None,
                downloaded_bytes: 0,
                total_bytes: None,
                speed_bytes_per_second: None,
                install_dir: None,
                message: "Canceling installation...".to_string(),
            },
        );
    }

    Ok(())
}

#[tauri::command]
fn register_blender_version(
    app: AppHandle,
    request: RegisterRequest,
) -> Result<LauncherState, String> {
    let executable = normalize_blender_path(&request.path)?;
    let executable_string = path_to_string(&executable);
    let id = make_version_id(&executable);
    let mut stored = load_stored_state(&app)?;

    if let Some(entry) = stored
        .tracked_versions
        .iter_mut()
        .find(|tracked| tracked.id == id)
    {
        entry.executable_path = executable_string;
        entry.display_name = request.label.and_then(trim_to_option);
        entry.source = VersionSource::Manual;
    } else {
        stored.tracked_versions.push(TrackedVersion {
            id,
            executable_path: executable_string,
            display_name: request.label.and_then(trim_to_option),
            source: VersionSource::Manual,
            last_launched_at: None,
        });
    }

    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn remove_blender_version(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let state = build_launcher_state(&app)?;
    let version = state
        .versions
        .iter()
        .find(|version| version.id == id)
        .cloned()
        .ok_or_else(|| "That Blender version is no longer available.".to_string())?;

    remove_managed_install_dir(&app, &version)?;

    let mut stored = load_stored_state(&app)?;
    stored.tracked_versions.retain(|tracked| tracked.id != id);

    if stored.default_id.as_deref() == Some(id.as_str()) {
        stored.default_id = None;
    }

    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn set_default_blender_version(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let state = build_launcher_state(&app)?;

    if !state.versions.iter().any(|version| version.id == id) {
        return Err("That Blender version is no longer available.".to_string());
    }

    let mut stored = load_stored_state(&app)?;
    stored.default_id = Some(id);
    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn add_scan_root(app: AppHandle, path: String) -> Result<LauncherState, String> {
    let normalized = normalize_root_path(&path)?;
    let normalized_string = path_to_string(&normalized);
    let mut stored = load_stored_state(&app)?;

    if !stored
        .scan_roots
        .iter()
        .any(|root| eq_ignore_case(root, &normalized_string))
    {
        stored.scan_roots.push(normalized_string);
        stored.scan_roots.sort_by_key(|root| root.to_lowercase());
    }

    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn remove_scan_root(app: AppHandle, path: String) -> Result<LauncherState, String> {
    let mut stored = load_stored_state(&app)?;
    stored
        .scan_roots
        .retain(|root| !eq_ignore_case(root, &path));
    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn launch_blender(app: AppHandle, request: LaunchRequest) -> Result<LauncherState, String> {
    let mut stored = load_stored_state(&app)?;
    let state = build_launcher_state(&app)?;
    let version = state
        .versions
        .iter()
        .find(|version| version.id == request.id)
        .ok_or_else(|| "Could not find that Blender version.".to_string())?;

    if !version.available {
        return Err("That Blender executable is missing.".to_string());
    }

    let args = request
        .extra_args
        .as_deref()
        .map(split_command_line)
        .unwrap_or_default();

    std::process::Command::new(&version.executable_path)
        .args(args)
        .spawn()
        .map_err(|error| format!("Failed to launch Blender: {error}"))?;

    let launched_at = current_timestamp();

    if let Some(entry) = stored
        .tracked_versions
        .iter_mut()
        .find(|tracked| tracked.id == version.id)
    {
        entry.last_launched_at = Some(launched_at);
    } else {
        stored.tracked_versions.push(TrackedVersion {
            id: version.id.clone(),
            executable_path: version.executable_path.clone(),
            display_name: None,
            source: version.source.clone(),
            last_launched_at: Some(launched_at),
        });
    }

    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn open_version_location(app: AppHandle, id: String) -> Result<(), String> {
    let state = build_launcher_state(&app)?;
    let version = state
        .versions
        .into_iter()
        .find(|version| version.id == id)
        .ok_or_else(|| "Could not find that Blender version.".to_string())?;

    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", version.executable_path))
        .spawn()
        .map_err(|error| format!("Failed to open Explorer: {error}"))?;

    Ok(())
}

fn build_launcher_state(app: &AppHandle) -> Result<LauncherState, String> {
    let stored = load_stored_state(app)?;
    let discovered = discover_versions(app, &stored.scan_roots);
    let mut merged = BTreeMap::<String, BlenderVersion>::new();

    for version in discovered {
        merged.insert(version.id.clone(), version);
    }

    for tracked in &stored.tracked_versions {
        let executable = PathBuf::from(&tracked.executable_path);
        let install_dir = executable
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| executable.clone());
        let fallback_name = tracked
            .display_name
            .clone()
            .and_then(trim_to_option)
            .unwrap_or_else(|| default_display_name(&executable));
        let version_number = infer_version_from_path(&executable);

        let entry = merged
            .entry(tracked.id.clone())
            .or_insert_with(|| BlenderVersion {
                id: tracked.id.clone(),
                display_name: fallback_name.clone(),
                version: version_number.clone(),
                executable_path: tracked.executable_path.clone(),
                install_dir: path_to_string(&install_dir),
                source: tracked.source.clone(),
                available: executable.exists(),
                is_default: false,
                last_launched_at: tracked.last_launched_at,
            });

        entry.executable_path = tracked.executable_path.clone();
        entry.install_dir = path_to_string(&install_dir);
        entry.available = executable.exists();
        entry.last_launched_at = tracked.last_launched_at.or(entry.last_launched_at);

        if let Some(display_name) = tracked.display_name.clone().and_then(trim_to_option) {
            entry.display_name = display_name;
        }

        if tracked.source == VersionSource::Manual {
            entry.source = VersionSource::Manual;
        }
    }

    let mut versions: Vec<BlenderVersion> = merged
        .into_values()
        .map(|mut version| {
            version.is_default = stored.default_id.as_deref() == Some(version.id.as_str());
            version
        })
        .collect();

    versions.sort_by(version_sort);

    Ok(LauncherState {
        versions,
        scan_roots: stored.scan_roots,
        detected_at: current_timestamp(),
    })
}

fn discover_versions(app: &AppHandle, scan_roots: &[String]) -> Vec<BlenderVersion> {
    let mut roots = default_scan_roots(app);

    for root in scan_roots {
        let custom_root = PathBuf::from(root);
        if custom_root.exists() {
            roots.push(custom_root);
        }
    }

    let mut discovered = BTreeMap::<String, BlenderVersion>::new();

    for root in roots {
        for executable in scan_for_blender_executables(&root, MAX_SCAN_DEPTH) {
            let version = BlenderVersion {
                id: make_version_id(&executable),
                display_name: default_display_name(&executable),
                version: infer_version_from_path(&executable),
                install_dir: executable
                    .parent()
                    .map(path_to_string)
                    .unwrap_or_else(|| path_to_string(&executable)),
                executable_path: path_to_string(&executable),
                source: VersionSource::Discovered,
                available: executable.exists(),
                is_default: false,
                last_launched_at: None,
            };

            discovered.entry(version.id.clone()).or_insert(version);
        }
    }

    discovered.into_values().collect()
}

fn scan_for_blender_executables(root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut results = Vec::new();
    visit_dir(root, depth, &mut results);
    results
}

fn visit_dir(path: &Path, depth: usize, results: &mut Vec<PathBuf>) {
    if depth == 0 || !path.exists() {
        return;
    }

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let child = entry.path();

        if child.is_file() {
            if child
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(BLENDER_EXECUTABLE_NAME))
                .unwrap_or(false)
            {
                results.push(child);
            }
            continue;
        }

        if child.is_dir() {
            visit_dir(&child, depth - 1, results);
        }
    }
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("The request to {url} returned an unexpected status: {status}"));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Could not read {url}: {error}"))
}

fn parse_blender_release_channels(body: &str) -> Vec<BlenderReleaseChannel> {
    let mut releases = BTreeMap::<String, BlenderReleaseChannel>::new();
    let mut remainder = body;

    while let Some(start) = remainder.find("href=\"") {
        let after_marker = &remainder[start + 6..];
        let Some(end) = after_marker.find('"') else {
            break;
        };
        let href = &after_marker[..end];

        if let Some(channel) = parse_release_channel_href(href) {
            releases.entry(channel.version.clone()).or_insert(channel);
        }

        remainder = &after_marker[end + 1..];
    }

    let mut channels: Vec<BlenderReleaseChannel> = releases.into_values().collect();
    channels.sort_by(|left, right| compare_version_values(&right.version, &left.version));
    channels
}

fn parse_release_channel_href(href: &str) -> Option<BlenderReleaseChannel> {
    let trimmed = href.trim();

    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('?') {
        return None;
    }

    let candidate = trimmed
        .trim_start_matches("./")
        .trim_start_matches(BLENDER_RELEASE_INDEX_URL)
        .trim_start_matches("https://download.blender.org/")
        .trim_start_matches('/');
    let folder = candidate.strip_prefix("release/").unwrap_or(candidate);
    let folder = folder.strip_suffix('/')?;
    let version = folder.strip_prefix("Blender")?;

    if !is_major_minor_release(version) || !is_version_at_least(version, 3, 0) {
        return None;
    }

    Some(BlenderReleaseChannel {
        name: folder.to_string(),
        version: version.to_string(),
        url: format!("{BLENDER_RELEASE_INDEX_URL}{folder}/"),
    })
}

fn parse_release_downloads(
    body: &str,
    channel: &BlenderReleaseChannel,
    file_suffix: &str,
) -> Vec<BlenderReleaseDownload> {
    let mut downloads = BTreeMap::<String, BlenderReleaseDownload>::new();

    for line in body.lines() {
        let Some((href, release_date)) = parse_directory_listing_line(line) else {
            continue;
        };

        if let Some(download) = parse_release_download_href(href, channel, file_suffix, &release_date) {
            downloads.entry(download.id.clone()).or_insert(download);
        }
    }

    downloads.into_values().collect()
}

fn parse_directory_listing_line(line: &str) -> Option<(&str, String)> {
    let href_start = line.find("href=\"")?;
    let after_href = &line[href_start + 6..];
    let href_end = after_href.find('"')?;
    let href = &after_href[..href_end];

    let anchor_end = line.find("</a>")?;
    let date = line[anchor_end + 4..].split_whitespace().next()?;

    if date.is_empty() {
        None
    } else {
        Some((href, date.to_string()))
    }
}

fn parse_release_download_href(
    href: &str,
    channel: &BlenderReleaseChannel,
    file_suffix: &str,
    release_date: &str,
) -> Option<BlenderReleaseDownload> {
    let trimmed = href.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('?') {
        return None;
    }

    let file_name = trimmed.trim_start_matches("./").split('/').next_back()?;
    if !file_name.ends_with(file_suffix) {
        return None;
    }

    let version = file_name.strip_prefix("blender-")?.strip_suffix(file_suffix)?;
    if !is_patch_release(version) {
        return None;
    }

    let expected_prefix = format!("{}.", channel.version);
    if !version.starts_with(&expected_prefix) {
        return None;
    }

    let url = format!("{}{}", channel.url, file_name);

    Some(BlenderReleaseDownload {
        id: make_release_id(&url),
        channel: channel.name.clone(),
        version: version.to_string(),
        file_name: file_name.to_string(),
        release_date: release_date.to_string(),
        url,
    })
}

fn current_release_platform() -> Option<ReleasePlatform> {
    match std::env::consts::OS {
        "windows" => Some(ReleasePlatform {
            file_suffix: "-windows-x64.zip",
            label: "Windows x64",
        }),
        "linux" => Some(ReleasePlatform {
            file_suffix: "-linux-x64.tar.xz",
            label: "Linux x64",
        }),
        "macos" if std::env::consts::ARCH == "aarch64" => Some(ReleasePlatform {
            file_suffix: "-macos-arm64.dmg",
            label: "macOS Apple Silicon",
        }),
        "macos" => Some(ReleasePlatform {
            file_suffix: "-macos-x64.dmg",
            label: "macOS Intel",
        }),
        _ => None,
    }
}

fn is_major_minor_release(version: &str) -> bool {
    let mut segments = version.split('.');
    let Some(major) = segments.next() else {
        return false;
    };
    let Some(minor) = segments.next() else {
        return false;
    };

    segments.next().is_none()
        && !major.is_empty()
        && !minor.is_empty()
        && major.chars().all(|character| character.is_ascii_digit())
        && minor.chars().all(|character| character.is_ascii_digit())
}

fn is_patch_release(version: &str) -> bool {
    let mut segments = version.split('.');
    let Some(major) = segments.next() else {
        return false;
    };
    let Some(minor) = segments.next() else {
        return false;
    };
    let Some(patch) = segments.next() else {
        return false;
    };

    segments.next().is_none()
        && [major, minor, patch]
            .into_iter()
            .all(|segment| !segment.is_empty() && segment.chars().all(|character| character.is_ascii_digit()))
}

fn is_version_at_least(version: &str, min_major: u32, min_minor: u32) -> bool {
    let mut segments = version.split('.');
    let major = segments
        .next()
        .and_then(|segment| segment.parse::<u32>().ok())
        .unwrap_or_default();
    let minor = segments
        .next()
        .and_then(|segment| segment.parse::<u32>().ok())
        .unwrap_or_default();

    (major, minor) >= (min_major, min_minor)
}

fn normalize_blender_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path.trim());

    if raw.as_os_str().is_empty() {
        return Err("Please provide a Blender executable path.".to_string());
    }

    let candidate = if raw.is_dir() {
        raw.join(BLENDER_EXECUTABLE_NAME)
    } else {
        raw
    };

    if !candidate.exists() {
        return Err("The supplied Blender executable path does not exist.".to_string());
    }

    if candidate
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| !name.eq_ignore_ascii_case(BLENDER_EXECUTABLE_NAME))
        .unwrap_or(true)
    {
        return Err("Please point to blender.exe or a Blender install folder.".to_string());
    }

    candidate
        .canonicalize()
        .map_err(|error| format!("Unable to resolve Blender path: {error}"))
}

fn normalize_root_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path.trim());

    if raw.as_os_str().is_empty() {
        return Err("Please provide a scan root path.".to_string());
    }

    if !raw.exists() {
        return Err("That scan root does not exist.".to_string());
    }

    if !raw.is_dir() {
        return Err("Scan roots must be folders.".to_string());
    }

    raw.canonicalize()
        .map_err(|error| format!("Unable to resolve scan root: {error}"))
}

fn default_display_name(executable: &Path) -> String {
    match infer_version_from_path(executable) {
        Some(version) => format!("Blender {version}"),
        None => executable
            .parent()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("Blender")
            .to_string(),
    }
}

fn infer_version_from_path(path: &Path) -> Option<String> {
    let mut candidates = Vec::new();

    if let Some(parent) = path.parent() {
        if let Some(name) = parent.file_name() {
            candidates.push(name.to_string_lossy().to_string());
        }

        if let Some(grand_parent) = parent.parent().and_then(|value| value.file_name()) {
            candidates.push(grand_parent.to_string_lossy().to_string());
        }
    }

    if let Some(stem) = path.file_stem() {
        candidates.push(stem.to_string_lossy().to_string());
    }

    candidates
        .into_iter()
        .find_map(|candidate| extract_version_like_segment(&candidate))
}

fn extract_version_like_segment(value: &str) -> Option<String> {
    let mut current = String::new();
    let mut seen_digit = false;

    for character in value.chars() {
        if character.is_ascii_digit() {
            current.push(character);
            seen_digit = true;
            continue;
        }

        if seen_digit && character == '.' {
            current.push(character);
            continue;
        }

        if seen_digit {
            break;
        }
    }

    let trimmed = current.trim_matches('.');

    if trimmed.is_empty() || !trimmed.contains('.') {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn validate_install_request(request: &InstallReleaseRequest) -> Result<(), String> {
    let platform = current_release_platform().ok_or_else(|| {
        format!(
            "This platform is not supported for automatic installs: {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;

    if request.url.trim().is_empty() {
        return Err("The release download URL is missing.".to_string());
    }

    if request.file_name.trim().is_empty() {
        return Err("The release file name is missing.".to_string());
    }

    if !request.url.starts_with(BLENDER_RELEASE_INDEX_URL) {
        return Err("Only official Blender release downloads can be installed automatically.".to_string());
    }

    if !request.file_name.ends_with(platform.file_suffix) {
        return Err(format!(
            "This release does not match the current platform: {}.",
            platform.label
        ));
    }

    if !request.file_name.ends_with(".zip") {
        return Err("Automatic installs currently support zip-based Blender releases only.".to_string());
    }

    Ok(())
}

async fn download_release_archive(
    app: &AppHandle,
    control: &ReleaseInstallControl,
    request: &InstallReleaseRequest,
    archive_path: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .get(request.url.trim())
        .send()
        .await
        .map_err(|error| format!("Could not start the Blender download: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "The Blender download returned an unexpected status: {status}"
        ));
    }

    let total_bytes = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(archive_path)
        .map_err(|error| format!("Unable to create the temporary download file: {error}"))?;
    let started_at = Instant::now();
    let mut last_emit = Instant::now() - Duration::from_millis(250);
    let mut downloaded_bytes = 0_u64;

    emit_release_install_progress(
        app,
        ReleaseInstallProgress {
            release_id: request.id.clone(),
            phase: "downloading".to_string(),
            progress_percent: Some(0.0),
            downloaded_bytes: 0,
            total_bytes,
            speed_bytes_per_second: Some(0.0),
            install_dir: None,
            message: format!("Downloading {}", request.file_name),
        },
    );

    while let Some(chunk_result) = stream.next().await {
        if control.is_cancel_requested(&request.id)? {
            return Err(INSTALL_CANCELED_MESSAGE.to_string());
        }

        let chunk = chunk_result
            .map_err(|error| format!("The Blender download was interrupted: {error}"))?;

        file.write_all(&chunk)
            .map_err(|error| format!("Unable to write the Blender download to disk: {error}"))?;

        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(180) {
            let elapsed_seconds = started_at.elapsed().as_secs_f64().max(0.001);
            let speed_bytes_per_second = downloaded_bytes as f64 / elapsed_seconds;
            let progress_percent = total_bytes.map(|total| {
                ((downloaded_bytes as f64 / total as f64).clamp(0.0, 1.0)) * DOWNLOAD_PROGRESS_WEIGHT
            });

            emit_release_install_progress(
                app,
                ReleaseInstallProgress {
                    release_id: request.id.clone(),
                    phase: "downloading".to_string(),
                    progress_percent,
                    downloaded_bytes,
                    total_bytes,
                    speed_bytes_per_second: Some(speed_bytes_per_second),
                    install_dir: None,
                    message: format!("Downloading {}", request.file_name),
                },
            );

            last_emit = Instant::now();
        }
    }

    file.flush()
        .map_err(|error| format!("Unable to finalize the downloaded archive: {error}"))?;

    if control.is_cancel_requested(&request.id)? {
        return Err(INSTALL_CANCELED_MESSAGE.to_string());
    }

    let elapsed_seconds = started_at.elapsed().as_secs_f64().max(0.001);
    emit_release_install_progress(
        app,
        ReleaseInstallProgress {
            release_id: request.id.clone(),
            phase: "downloading".to_string(),
            progress_percent: Some(DOWNLOAD_PROGRESS_WEIGHT),
            downloaded_bytes,
            total_bytes,
            speed_bytes_per_second: Some(downloaded_bytes as f64 / elapsed_seconds),
            install_dir: None,
            message: format!("Download finished for {}", request.file_name),
        },
    );

    Ok(())
}

async fn extract_release_archive(
    app: &AppHandle,
    control: ReleaseInstallControl,
    request: &InstallReleaseRequest,
    archive_path: &Path,
    stable_dir: &Path,
    temp_dir: &Path,
) -> Result<PathBuf, String> {
    let app = app.clone();
    let control = control.clone();
    let request = request.clone();
    let archive_path = archive_path.to_path_buf();
    let stable_dir = stable_dir.to_path_buf();
    let temp_dir = temp_dir.to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        let extraction_dir = temp_dir.join("extract");
        if extraction_dir.exists() {
            fs::remove_dir_all(&extraction_dir)
                .map_err(|error| format!("Unable to clear the extraction folder: {error}"))?;
        }

        fs::create_dir_all(&extraction_dir)
            .map_err(|error| format!("Unable to create the extraction folder: {error}"))?;

        let archive_file = fs::File::open(&archive_path)
            .map_err(|error| format!("Unable to open the downloaded Blender archive: {error}"))?;
        let mut archive = zip::ZipArchive::new(archive_file)
            .map_err(|error| format!("Unable to read the downloaded Blender archive: {error}"))?;
        let total_entries = archive.len().max(1);

        for index in 0..archive.len() {
            if control.is_cancel_requested(&request.id)? {
                return Err(INSTALL_CANCELED_MESSAGE.to_string());
            }

            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Unable to read an archive entry: {error}"))?;
            let relative_path = entry.enclosed_name().map(Path::to_path_buf).ok_or_else(|| {
                format!("The archive entry '{}' has an invalid path.", entry.name())
            })?;
            let output_path = extraction_dir.join(relative_path);

            if entry.is_dir() {
                fs::create_dir_all(&output_path)
                    .map_err(|error| format!("Unable to create an extracted folder: {error}"))?;
            } else {
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("Unable to prepare an extracted folder: {error}"))?;
                }

                let mut output = fs::File::create(&output_path)
                    .map_err(|error| format!("Unable to create an extracted file: {error}"))?;
                std::io::copy(&mut entry, &mut output)
                    .map_err(|error| format!("Unable to extract a Blender file: {error}"))?;
            }

            let extract_ratio = (index + 1) as f64 / total_entries as f64;
            emit_release_install_progress(
                &app,
                ReleaseInstallProgress {
                    release_id: request.id.clone(),
                    phase: "extracting".to_string(),
                    progress_percent: Some(
                        DOWNLOAD_PROGRESS_WEIGHT
                            + extract_ratio * (100.0 - DOWNLOAD_PROGRESS_WEIGHT),
                    ),
                    downloaded_bytes: 0,
                    total_bytes: None,
                    speed_bytes_per_second: None,
                    install_dir: None,
                    message: format!("Extracting {}", request.file_name),
                },
            );
        }

        if control.is_cancel_requested(&request.id)? {
            return Err(INSTALL_CANCELED_MESSAGE.to_string());
        }

        finalize_extracted_release(&request, &extraction_dir, &stable_dir)
    })
    .await
    .map_err(|error| format!("Failed to finish the Blender install: {error}"))?
}
fn finalize_extracted_release(
    request: &InstallReleaseRequest,
    extraction_dir: &Path,
    stable_dir: &Path,
) -> Result<PathBuf, String> {
    let mut top_level_entries = fs::read_dir(extraction_dir)
        .map_err(|error| format!("Unable to read the extracted files: {error}"))?
        .flatten()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();

    top_level_entries.sort();

    let archive_root = if top_level_entries.len() == 1 && top_level_entries[0].is_dir() {
        top_level_entries.remove(0)
    } else {
        extraction_dir.to_path_buf()
    };

    let final_dir_name = archive_root
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| release_folder_name(&request.file_name));
    let final_install_dir = stable_dir.join(final_dir_name);

    if final_install_dir.exists() {
        return Err(format!(
            "The install folder already exists: {}",
            path_to_string(&final_install_dir)
        ));
    }

    if archive_root == extraction_dir {
        fs::rename(extraction_dir, &final_install_dir)
            .map_err(|error| format!("Unable to move the installed Blender files into place: {error}"))?;
    } else {
        fs::rename(&archive_root, &final_install_dir)
            .map_err(|error| format!("Unable to move the installed Blender folder into place: {error}"))?;
    }

    let executable = scan_for_blender_executables(&final_install_dir, MAX_SCAN_DEPTH)
        .into_iter()
        .next()
        .ok_or_else(|| "The downloaded archive did not contain blender.exe.".to_string())?;

    if !executable.exists() {
        return Err("The extracted Blender executable could not be found.".to_string());
    }

    Ok(final_install_dir)
}

fn emit_release_install_progress(app: &AppHandle, progress: ReleaseInstallProgress) {
    let _ = app.emit(RELEASE_INSTALL_EVENT, progress);
}

fn release_folder_name(file_name: &str) -> String {
    file_name.trim_end_matches(".zip").trim().to_string()
}

fn voxelshift_documents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let documents_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Unable to find the Documents directory: {error}"))?;

    Ok(documents_dir.join(VOXELSHIFT_DIR_NAME))
}

fn stable_install_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(voxelshift_documents_dir(app)?.join(STABLE_INSTALL_DIR_NAME))
}

fn remove_managed_install_dir(app: &AppHandle, version: &BlenderVersion) -> Result<(), String> {
    let stable_dir = stable_install_dir(app)?;
    let install_dir = PathBuf::from(&version.install_dir);

    if install_dir == stable_dir || !install_dir.starts_with(&stable_dir) || !install_dir.exists() {
        return Ok(());
    }

    fs::remove_dir_all(&install_dir).map_err(|error| {
        format!(
            "Unable to remove {}: {error}",
            version
                .version
                .as_deref()
                .map(|value| format!("Blender {value}"))
                .unwrap_or_else(|| version.display_name.clone())
        )
    })
}

fn temp_install_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(voxelshift_documents_dir(app)?
        .join(TEMP_INSTALL_DIR_NAME)
        .join("release-installs"))
}

fn load_stored_state(app: &AppHandle) -> Result<StoredState, String> {
    let file_path = state_file_path(app)?;

    if !file_path.exists() {
        return Ok(StoredState::default());
    }

    let contents =
        fs::read_to_string(&file_path).map_err(|error| format!("Unable to read state: {error}"))?;

    serde_json::from_str(&contents).map_err(|error| format!("Unable to parse state file: {error}"))
}

fn save_stored_state(app: &AppHandle, state: &StoredState) -> Result<(), String> {
    let file_path = state_file_path(app)?;
    let directory = file_path
        .parent()
        .ok_or_else(|| "Unable to access application data directory.".to_string())?;

    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to prepare application data directory: {error}"))?;

    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Unable to serialize launcher state: {error}"))?;

    fs::write(file_path, json).map_err(|error| format!("Unable to save launcher state: {error}"))
}

fn state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to find application data directory: {error}"))?;

    Ok(app_data_dir.join(STATE_FILE_NAME))
}

fn default_scan_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        roots.push(PathBuf::from(program_files).join("Blender Foundation"));
    }

    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        roots.push(PathBuf::from(program_files_x86).join("Blender Foundation"));
    }

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        roots.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Blender Foundation"),
        );
    }

    roots.push(PathBuf::from(r"D:\Blender"));
    roots.push(PathBuf::from(r"D:\Apps\Blender"));

    if let Ok(stable_dir) = stable_install_dir(app) {
        roots.push(stable_dir);
    }

    roots.into_iter().filter(|path| path.exists()).collect()
}

fn version_sort(left: &BlenderVersion, right: &BlenderVersion) -> Ordering {
    if left.is_default != right.is_default {
        return right.is_default.cmp(&left.is_default);
    }

    if left.available != right.available {
        return right.available.cmp(&left.available);
    }

    let left_key = version_key(left.version.as_deref());
    let right_key = version_key(right.version.as_deref());

    right_key.cmp(&left_key).then_with(|| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
    })
}

fn compare_version_values(left: &str, right: &str) -> Ordering {
    version_key(Some(left)).cmp(&version_key(Some(right)))
}

fn version_key(version: Option<&str>) -> Vec<u32> {
    version
        .unwrap_or_default()
        .split('.')
        .filter_map(|segment| segment.parse::<u32>().ok())
        .collect()
}

fn make_version_id(path: &Path) -> String {
    let normalized = path_to_string(path).to_lowercase();
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    format!("blender-{:016x}", hasher.finish())
}

fn make_release_id(url: &str) -> String {
    let mut hasher = DefaultHasher::new();
    url.to_lowercase().hash(&mut hasher);
    format!("release-{:016x}", hasher.finish())
}

fn split_command_line(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for character in value.chars() {
        match character {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(character),
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn trim_to_option(value: String) -> Option<String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn eq_ignore_case(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

