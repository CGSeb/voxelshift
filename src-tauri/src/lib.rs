use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const STATE_FILE_NAME: &str = "launcher-state.json";
const BLENDER_EXECUTABLE_NAME: &str = "blender.exe";
const BLENDER_RELEASE_INDEX_URL: &str = "https://download.blender.org/release/";
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

#[derive(Clone, Debug, Serialize)]
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

pub fn run() {
    tauri::Builder::default()
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
            get_blender_release_downloads
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
    let discovered = discover_versions(&stored.scan_roots);
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

fn discover_versions(scan_roots: &[String]) -> Vec<BlenderVersion> {
    let mut roots = default_scan_roots();

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

fn default_scan_roots() -> Vec<PathBuf> {
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
