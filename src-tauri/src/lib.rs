use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
#[cfg(target_os = "linux")]
use std::io::Read;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    path::BaseDirectory, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position,
    Size, WebviewWindow, Window, WindowEvent,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod planner;

const STATE_FILE_NAME: &str = "launcher-state.json";
const WINDOW_STATE_FILE_NAME: &str = "window-state.json";
const MINIMIZED_WINDOW_SENTINEL: i32 = -32000;
#[cfg(target_os = "windows")]
const BLENDER_EXECUTABLE_NAME: &str = "blender.exe";
#[cfg(target_os = "linux")]
const BLENDER_EXECUTABLE_NAME: &str = "blender";
const BLENDER_RELEASE_INDEX_URL: &str = "https://download.blender.org/release/";
const BLENDER_DAILY_BUILDS_URL: &str = "https://builder.blender.org/download/daily/";
const BLENDER_BUILDER_CDN_URL: &str = "https://cdn.builder.blender.org/";
const RELEASE_INSTALL_EVENT: &str = "release-install-progress";
const RUNNING_BLENDERS_EVENT: &str = "running-blenders-updated";
const RUNNING_BLENDER_LOG_EVENT: &str = "running-blender-log";
const VOXELSHIFT_DIR_NAME: &str = "VoxelShift";
const STABLE_INSTALL_DIR_NAME: &str = "stable";
const CONFIGS_DIR_NAME: &str = "configs";
const TEMP_INSTALL_DIR_NAME: &str = ".tmp";
const BLENDER_EXTENSION_DIR: &str = "portable/extensions/user_default/voxel_shift";
const BLENDER_EXTENSION_INIT_FILE: &str = "__init__.py";
const BLENDER_EXTENSION_MANIFEST_FILE: &str = "blender_manifest.toml";
const BLENDER_EXTENSION_STATE_FILE: &str = "VoxelShift.json";
const BLENDER_EXTENSION_MODULE: &str = "bl_ext.user_default.voxel_shift";
const BUNDLED_EXTENSION_RESOURCE_DIR: &str = "resources";
const BLENDER_EXTENSION_ENABLE_SCRIPT: &str =
    "import bpy;bpy.ops.preferences.addon_enable(module='bl_ext.user_default.voxel_shift');bpy.ops.wm.save_userpref();";
const DOWNLOAD_PROGRESS_WEIGHT: f64 = 95.0;
const INSTALL_CANCELED_MESSAGE: &str = "Installation canceled.";
const MAX_SCAN_DEPTH: usize = 5;
const MAX_RUNNING_BLENDER_LOG_LINES: usize = 2_000;
const BLENDER_PROCESS_POLL_INTERVAL_MS: u64 = 500;

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentProject {
    id: String,
    name: String,
    file_path: String,
    thumbnail_path: Option<String>,
    blender_id: String,
    blender_display_name: String,
    blender_version: Option<String>,
    saved_at: String,
    exists: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VoxelShiftState {
    #[serde(default)]
    last_open: Option<String>,
    #[serde(default)]
    blender_projects: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
struct ReleasePlatform {
    file_suffix: &'static str,
    label: &'static str,
    os_tokens: &'static [&'static str],
    arch_tokens: &'static [&'static str],
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
struct BlenderExperimentalReleaseGroup {
    platform_key: String,
    platform_label: String,
    downloads: Vec<BlenderReleaseDownload>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderReleaseListing {
    platform_label: String,
    stable_downloads: Vec<BlenderReleaseDownload>,
    experimental_groups: Vec<BlenderExperimentalReleaseGroup>,
    experimental_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredState {
    default_id: Option<String>,
    scan_roots: Vec<String>,
    tracked_versions: Vec<TrackedVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct StoredWindowState {
    position: Option<StoredWindowPosition>,
    size: Option<StoredWindowSize>,
    is_maximized: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredWindowPosition {
    x: i32,
    y: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredWindowSize {
    width: u32,
    height: u32,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchProjectRequest {
    id: String,
    project_path: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderConfigProfile {
    id: String,
    name: String,
    path: String,
    updated_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBlenderConfigRequest {
    version_id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyBlenderConfigRequest {
    version_id: String,
    config_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningBlenderProcess {
    instance_id: String,
    blender_id: String,
    blender_display_name: String,
    blender_version: Option<String>,
    pid: u32,
    started_at: u64,
    project_path: Option<String>,
    is_stopping: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderLogEntry {
    id: String,
    instance_id: String,
    source: String,
    message: String,
    timestamp: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderLogEventPayload {
    instance_id: String,
    entry: BlenderLogEntry,
}

struct ManagedBlenderProcess {
    info: RunningBlenderProcess,
    child: Arc<Mutex<Child>>,
    logs: VecDeque<BlenderLogEntry>,
    next_log_index: u64,
}

#[derive(Clone, Default)]
struct RunningBlenderRegistry {
    processes: Arc<Mutex<BTreeMap<String, Arc<Mutex<ManagedBlenderProcess>>>>>,
}

impl RunningBlenderRegistry {
    fn insert(&self, process: ManagedBlenderProcess) -> Result<(), String> {
        let instance_id = process.info.instance_id.clone();
        self.processes
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?
            .insert(instance_id, Arc::new(Mutex::new(process)));
        Ok(())
    }

    fn get(&self, instance_id: &str) -> Result<Option<Arc<Mutex<ManagedBlenderProcess>>>, String> {
        Ok(self
            .processes
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?
            .get(instance_id)
            .cloned())
    }

    fn list(&self) -> Result<Vec<RunningBlenderProcess>, String> {
        let processes = self
            .processes
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?
            .values()
            .cloned()
            .collect::<Vec<_>>();

        let mut infos = Vec::with_capacity(processes.len());
        for process in processes {
            infos.push(
                process
                    .lock()
                    .map_err(|_| "Unable to access Blender process state.".to_string())?
                    .info
                    .clone(),
            );
        }

        infos.sort_by(|left, right| {
            right
                .started_at
                .cmp(&left.started_at)
                .then_with(|| left.pid.cmp(&right.pid))
        });

        Ok(infos)
    }

    fn logs(&self, instance_id: &str) -> Result<Vec<BlenderLogEntry>, String> {
        let process = self
            .get(instance_id)?
            .ok_or_else(|| "That Blender session is no longer running.".to_string())?;

        let process = process
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?;
        let logs = process.logs.iter().cloned().collect();
        Ok(logs)
    }

    fn set_stopping(&self, instance_id: &str, is_stopping: bool) -> Result<bool, String> {
        let Some(process) = self.get(instance_id)? else {
            return Ok(false);
        };

        process
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?
            .info
            .is_stopping = is_stopping;
        Ok(true)
    }

    fn append_log(
        &self,
        instance_id: &str,
        source: &str,
        message: &str,
    ) -> Result<Option<BlenderLogEntry>, String> {
        let trimmed = message.trim_end_matches(|character| character == '\r' || character == '\n');
        if trimmed.trim().is_empty() {
            return Ok(None);
        }

        let Some(process) = self.get(instance_id)? else {
            return Ok(None);
        };

        let mut process = process
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?;
        let entry = BlenderLogEntry {
            id: format!("{}-{}", instance_id, process.next_log_index),
            instance_id: instance_id.to_string(),
            source: source.to_string(),
            message: trimmed.to_string(),
            timestamp: current_timestamp(),
        };
        process.next_log_index += 1;
        process.logs.push_back(entry.clone());
        while process.logs.len() > MAX_RUNNING_BLENDER_LOG_LINES {
            process.logs.pop_front();
        }

        Ok(Some(entry))
    }

    fn remove(&self, instance_id: &str) -> Result<bool, String> {
        Ok(self
            .processes
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?
            .remove(instance_id)
            .is_some())
    }
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
        .manage(RunningBlenderRegistry::default())
        .manage(planner::PlannerRegistry::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon().cloned() {
                    window.set_icon(icon)?;
                }

                if let Err(error) = restore_window_state(&window) {
                    eprintln!("Unable to restore window state: {error}");
                }
            }

            if let Err(error) = refresh_managed_blender_extensions_internal(&app.handle()) {
                eprintln!("Unable to refresh managed Blender extensions: {error}");
            }

            if let Err(error) = planner::initialize(
                &app.handle(),
                app.state::<planner::PlannerRegistry>().inner(),
            ) {
                eprintln!("Unable to initialize planner state: {error}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if let Err(error) = save_window_state_for(window) {
                        eprintln!("Unable to save window state: {error}");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_launcher_state,
            get_recent_projects,
            refresh_managed_blender_extensions,
            remove_recent_project,
            get_blender_configs,
            save_blender_config,
            apply_blender_config,
            remove_blender_config,
            scan_for_blender_versions,
            register_blender_version,
            remove_blender_version,
            set_default_blender_version,
            add_scan_root,
            remove_scan_root,
            launch_blender,
            launch_blender_project,
            get_running_blenders,
            get_running_blender_logs,
            stop_running_blender,
            get_planner_runs,
            get_planner_logs,
            delete_planner_run,
            update_planner_run,
            create_planner_run,
            pick_planner_blend_file,
            pick_planner_blender_executable,
            pick_planner_output_folder,
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
fn get_recent_projects(app: AppHandle) -> Result<Vec<RecentProject>, String> {
    let state = build_launcher_state(&app)?;
    Ok(collect_recent_projects(&state.versions))
}

#[tauri::command]
fn remove_recent_project(app: AppHandle, file_path: String) -> Result<Vec<RecentProject>, String> {
    let state = build_launcher_state(&app)?;
    remove_recent_project_entries(&state.versions, &file_path)?;
    Ok(collect_recent_projects(&state.versions))
}

#[tauri::command]
fn refresh_managed_blender_extensions(app: AppHandle) -> Result<usize, String> {
    refresh_managed_blender_extensions_internal(&app)
}

#[tauri::command]
fn get_running_blenders(
    running_blenders: tauri::State<'_, RunningBlenderRegistry>,
) -> Result<Vec<RunningBlenderProcess>, String> {
    running_blenders.list()
}

#[tauri::command]
fn get_running_blender_logs(
    running_blenders: tauri::State<'_, RunningBlenderRegistry>,
    instance_id: String,
) -> Result<Vec<BlenderLogEntry>, String> {
    running_blenders.logs(&instance_id)
}

#[tauri::command]
fn get_planner_runs(
    planner: tauri::State<'_, planner::PlannerRegistry>,
) -> Result<Vec<planner::PlannerRunSummary>, String> {
    planner::get_planner_runs(planner)
}

#[tauri::command]
fn get_planner_logs(
    planner: tauri::State<'_, planner::PlannerRegistry>,
    run_id: String,
) -> Result<Vec<planner::PlannerLogEntry>, String> {
    planner::get_planner_logs(planner, run_id)
}

#[tauri::command]
fn delete_planner_run(
    app: AppHandle,
    planner_state: tauri::State<'_, planner::PlannerRegistry>,
    run_id: String,
) -> Result<(), String> {
    planner::delete_planner_run(&app, planner_state.inner(), run_id)
}

fn resolve_planner_run_request(
    app: &AppHandle,
    request: planner::CreatePlannerRunRequest,
) -> Result<planner::ResolvedPlannerRunRequest, String> {
    let blend_file_path = planner::validate_blend_file_path(&request.blend_file_path)?;
    let (start_frame, end_frame) =
        planner::validate_frame_range(request.start_frame, request.end_frame)?;
    let output_folder_path = request
        .output_folder_path
        .as_deref()
        .map(planner::validate_output_folder_path)
        .transpose()?;

    let blender_target = match request.blender.source {
        planner::PlannerBlenderSource::Library => {
            let version_id = request
                .blender
                .version_id
                .clone()
                .ok_or_else(|| "Please choose a Blender from the library.".to_string())?;
            let state = build_launcher_state(app)?;
            let version = resolve_launch_version(&state.versions, &version_id)?;

            planner::PlannerBlenderTarget {
                source: planner::PlannerBlenderSource::Library,
                version_id: Some(version.id.clone()),
                display_name: version.display_name.clone(),
                executable_path: version.executable_path.clone(),
            }
        }
        planner::PlannerBlenderSource::Custom => {
            let executable_path = request
                .blender
                .executable_path
                .as_deref()
                .ok_or_else(|| "Please choose a Blender executable.".to_string())?;
            planner::validate_custom_blender_target(executable_path)?
        }
    };

    Ok(planner::ResolvedPlannerRunRequest {
        blend_file_path,
        start_frame,
        end_frame,
        start_at: request.start_at,
        output_folder_path,
        shutdown_when_done: request.shutdown_when_done,
        blender_target,
    })
}

#[tauri::command]
fn update_planner_run(
    app: AppHandle,
    planner_state: tauri::State<'_, planner::PlannerRegistry>,
    run_id: String,
    request: planner::CreatePlannerRunRequest,
) -> Result<planner::PlannerRunSummary, String> {
    let resolved_request = resolve_planner_run_request(&app, request)?;
    planner::update_planner_run(&app, planner_state.inner(), run_id, resolved_request)
}

#[tauri::command]
fn create_planner_run(
    app: AppHandle,
    planner_state: tauri::State<'_, planner::PlannerRegistry>,
    request: planner::CreatePlannerRunRequest,
) -> Result<planner::PlannerRunSummary, String> {
    let resolved_request = resolve_planner_run_request(&app, request)?;
    planner::create_planner_run(&app, planner_state.inner(), resolved_request)
}
#[tauri::command]
fn pick_planner_blend_file() -> Result<Option<String>, String> {
    planner::pick_planner_blend_file()
}

#[tauri::command]
fn pick_planner_blender_executable() -> Result<Option<String>, String> {
    planner::pick_planner_blender_executable()
}

#[tauri::command]
fn pick_planner_output_folder() -> Result<Option<String>, String> {
    planner::pick_planner_output_folder()
}

#[tauri::command]
fn stop_running_blender(
    app: AppHandle,
    running_blenders: tauri::State<'_, RunningBlenderRegistry>,
    instance_id: String,
) -> Result<(), String> {
    let process = running_blenders
        .get(&instance_id)?
        .ok_or_else(|| "That Blender session is no longer running.".to_string())?;

    running_blenders.set_stopping(&instance_id, true)?;
    emit_running_blenders_changed(&app, running_blenders.inner());

    let child = process
        .lock()
        .map_err(|_| "Unable to access Blender process state.".to_string())?
        .child
        .clone();

    let kill_result = {
        let mut child = child
            .lock()
            .map_err(|_| "Unable to access Blender process state.".to_string())?;
        child.kill()
    };

    match kill_result {
        Ok(_) => Ok(()),
        Err(error)
            if error.kind() == std::io::ErrorKind::InvalidInput
                || error.kind() == std::io::ErrorKind::NotFound =>
        {
            Ok(())
        }
        Err(error) => {
            let _ = running_blenders.set_stopping(&instance_id, false);
            emit_running_blenders_changed(&app, running_blenders.inner());
            Err(format!("Failed to stop Blender: {error}"))
        }
    }
}

#[tauri::command]
fn get_blender_configs(app: AppHandle) -> Result<Vec<BlenderConfigProfile>, String> {
    list_blender_configs(&configs_dir(&app)?)
}

#[tauri::command]
fn save_blender_config(
    app: AppHandle,
    request: SaveBlenderConfigRequest,
) -> Result<BlenderConfigProfile, String> {
    let state = build_launcher_state(&app)?;
    let version = resolve_launch_version(&state.versions, &request.version_id)?;
    let source_dir = portable_config_dir(Path::new(&version.install_dir));
    let default_name = default_blender_config_name(version);
    let config_name = normalize_blender_config_name(&request.name, &default_name)?;

    save_blender_config_snapshot(&source_dir, &configs_dir(&app)?, &config_name)
}

#[tauri::command]
fn apply_blender_config(app: AppHandle, request: ApplyBlenderConfigRequest) -> Result<(), String> {
    let state = build_launcher_state(&app)?;
    let version = resolve_launch_version(&state.versions, &request.version_id)?;
    let library_dir = configs_dir(&app)?;
    let config_dir = resolve_blender_config_path(&library_dir, &request.config_id)?;
    let target_dir = portable_config_dir(Path::new(&version.install_dir));

    apply_blender_config_snapshot(&config_dir, &target_dir)
}

#[tauri::command]
fn remove_blender_config(app: AppHandle, config_id: String) -> Result<(), String> {
    remove_blender_config_snapshot(&configs_dir(&app)?, &config_id)
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
    let mut stable_downloads = Vec::new();

    for channel in channels {
        let folder_body = match fetch_text(&client, &channel.url).await {
            Ok(body) => body,
            Err(_) => continue,
        };

        stable_downloads.extend(parse_release_downloads(
            &folder_body,
            &channel,
            platform.file_suffix,
        ));
    }

    sort_release_downloads(&mut stable_downloads);

    if stable_downloads.is_empty() {
        return Err(format!(
            "No stable Blender downloads ending with {} were found.",
            platform.file_suffix
        ));
    }

    let (experimental_groups, experimental_error) =
        match fetch_experimental_release_groups(&client).await {
            Ok(groups) => (groups, None),
            Err(error) => (Vec::new(), Some(error)),
        };

    Ok(BlenderReleaseListing {
        platform_label: platform.label.to_string(),
        stable_downloads,
        experimental_groups,
        experimental_error,
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
    if existing_state.versions.iter().any(|version| {
        version.available && version.version.as_deref() == Some(request.version.as_str())
    }) {
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
        fs::create_dir_all(&temp_dir).map_err(|error| {
            format!("Unable to prepare the temporary install directory: {error}")
        })?;

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

        if let Err(error) =
            download_release_archive(&app, control.inner(), &request, &archive_path).await
        {
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

        install_voxel_shift_extension(&app, &final_install_dir)?;

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

    add_scan_root_value(&mut stored.scan_roots, normalized_string);

    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn remove_scan_root(app: AppHandle, path: String) -> Result<LauncherState, String> {
    let mut stored = load_stored_state(&app)?;
    remove_scan_root_value(&mut stored.scan_roots, &path);
    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn launch_blender(
    app: AppHandle,
    running_blenders: tauri::State<'_, RunningBlenderRegistry>,
    request: LaunchRequest,
) -> Result<LauncherState, String> {
    let mut stored = load_stored_state(&app)?;
    let state = build_launcher_state(&app)?;
    let version = resolve_launch_version(&state.versions, &request.id)?;

    let args = request
        .extra_args
        .as_deref()
        .map(split_command_line)
        .unwrap_or_default();

    launch_managed_blender_process(&app, running_blenders.inner().clone(), version, args, None)?;

    remember_launched_version(&mut stored, version);
    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

#[tauri::command]
fn launch_blender_project(
    app: AppHandle,
    running_blenders: tauri::State<'_, RunningBlenderRegistry>,
    request: LaunchProjectRequest,
) -> Result<LauncherState, String> {
    let mut stored = load_stored_state(&app)?;
    let state = build_launcher_state(&app)?;
    let version = resolve_launch_version(&state.versions, &request.id)?;
    let project_path = validate_project_launch_path(&request.project_path)?;
    let project_path_string = path_to_string(&project_path);

    launch_managed_blender_process(
        &app,
        running_blenders.inner().clone(),
        version,
        vec![project_path_string.clone()],
        Some(project_path_string),
    )?;

    remember_launched_version(&mut stored, version);
    save_stored_state(&app, &stored)?;
    build_launcher_state(&app)
}

fn launch_managed_blender_process(
    app: &AppHandle,
    running_blenders: RunningBlenderRegistry,
    version: &BlenderVersion,
    args: Vec<String>,
    project_path: Option<String>,
) -> Result<(), String> {
    let mut command = Command::new(&version.executable_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to launch Blender: {error}"))?;
    let pid = child.id();
    let started_at = current_timestamp();
    let instance_id = make_running_blender_instance_id(&version.id, pid, started_at);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    running_blenders.insert(ManagedBlenderProcess {
        info: RunningBlenderProcess {
            instance_id: instance_id.clone(),
            blender_id: version.id.clone(),
            blender_display_name: version.display_name.clone(),
            blender_version: version.version.clone(),
            pid,
            started_at,
            project_path,
            is_stopping: false,
        },
        child: child.clone(),
        logs: VecDeque::new(),
        next_log_index: 0,
    })?;

    emit_running_blenders_changed(app, &running_blenders);
    spawn_blender_log_reader(
        app.clone(),
        running_blenders.clone(),
        instance_id.clone(),
        "stdout",
        stdout,
    );
    spawn_blender_log_reader(
        app.clone(),
        running_blenders.clone(),
        instance_id.clone(),
        "stderr",
        stderr,
    );
    spawn_blender_process_monitor(app.clone(), running_blenders, instance_id, child);
    Ok(())
}

fn spawn_blender_log_reader<R>(
    app: AppHandle,
    running_blenders: RunningBlenderRegistry,
    instance_id: String,
    source: &'static str,
    stream: Option<R>,
) where
    R: std::io::Read + Send + 'static,
{
    let Some(stream) = stream else {
        return;
    };

    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if let Err(error) = append_blender_log_and_emit(
                        &app,
                        &running_blenders,
                        &instance_id,
                        source,
                        &line,
                    ) {
                        eprintln!("Unable to track Blender logs: {error}");
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("Unable to read Blender logs: {error}");
                    break;
                }
            }
        }
    });
}

fn spawn_blender_process_monitor(
    app: AppHandle,
    running_blenders: RunningBlenderRegistry,
    instance_id: String,
    child: Arc<Mutex<Child>>,
) {
    thread::spawn(move || loop {
        let status = {
            let mut child = match child.lock() {
                Ok(child) => child,
                Err(_) => break,
            };

            match child.try_wait() {
                Ok(status) => status,
                Err(error) => {
                    let _ = append_blender_log_and_emit(
                        &app,
                        &running_blenders,
                        &instance_id,
                        "system",
                        &format!("Unable to monitor Blender: {error}"),
                    );
                    let _ = running_blenders.remove(&instance_id);
                    emit_running_blenders_changed(&app, &running_blenders);
                    break;
                }
            }
        };

        if let Some(status) = status {
            let exit_message = match status.code() {
                Some(code) => format!("Blender exited with code {code}."),
                None => "Blender exited.".to_string(),
            };
            let _ = append_blender_log_and_emit(
                &app,
                &running_blenders,
                &instance_id,
                "system",
                &exit_message,
            );
            let _ = running_blenders.remove(&instance_id);
            emit_running_blenders_changed(&app, &running_blenders);
            break;
        }

        thread::sleep(Duration::from_millis(BLENDER_PROCESS_POLL_INTERVAL_MS));
    });
}

fn append_blender_log_and_emit(
    app: &AppHandle,
    running_blenders: &RunningBlenderRegistry,
    instance_id: &str,
    source: &str,
    message: &str,
) -> Result<(), String> {
    if let Some(entry) = running_blenders.append_log(instance_id, source, message)? {
        let _ = app.emit(
            RUNNING_BLENDER_LOG_EVENT,
            BlenderLogEventPayload {
                instance_id: instance_id.to_string(),
                entry,
            },
        );
    }

    Ok(())
}

fn emit_running_blenders_changed(app: &AppHandle, running_blenders: &RunningBlenderRegistry) {
    if let Ok(processes) = running_blenders.list() {
        let _ = app.emit(RUNNING_BLENDERS_EVENT, processes);
    }
}

fn make_running_blender_instance_id(blender_id: &str, pid: u32, started_at: u64) -> String {
    format!("{}-{}-{}", blender_id, pid, started_at)
}

fn remember_launched_version(stored: &mut StoredState, version: &BlenderVersion) {
    let launched_at = current_timestamp();

    if let Some(entry) = stored
        .tracked_versions
        .iter_mut()
        .find(|tracked| tracked.id == version.id)
    {
        entry.last_launched_at = Some(launched_at);
        return;
    }

    stored.tracked_versions.push(TrackedVersion {
        id: version.id.clone(),
        executable_path: version.executable_path.clone(),
        display_name: trim_to_option(version.display_name.clone()),
        source: version.source.clone(),
        last_launched_at: Some(launched_at),
    });
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
    Ok(merge_launcher_state(
        &stored,
        discovered,
        current_timestamp(),
    ))
}

fn merge_launcher_state(
    stored: &StoredState,
    discovered: Vec<BlenderVersion>,
    detected_at: u64,
) -> LauncherState {
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

    LauncherState {
        versions,
        scan_roots: stored.scan_roots.clone(),
        detected_at,
    }
}

fn collect_recent_projects(versions: &[BlenderVersion]) -> Vec<RecentProject> {
    let mut projects_by_path = BTreeMap::<String, RecentProject>::new();

    for version in versions.iter().filter(|version| version.available) {
        let extension_dir = PathBuf::from(&version.install_dir).join(BLENDER_EXTENSION_DIR);
        let config_path = extension_dir.join(BLENDER_EXTENSION_STATE_FILE);
        let state = match read_voxelshift_state(&config_path) {
            Some(state) => state,
            None => continue,
        };

        let _ = state.last_open.as_deref();

        for (file_path, saved_at) in state.blender_projects {
            let trimmed_file_path = file_path.trim();
            let trimmed_saved_at = saved_at.trim();

            if trimmed_file_path.is_empty() || trimmed_saved_at.is_empty() {
                continue;
            }

            let project_name = Path::new(trimmed_file_path)
                .file_stem()
                .and_then(|value| value.to_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(trimmed_file_path)
                .to_string();

            let project = RecentProject {
                id: make_recent_project_id(trimmed_file_path),
                name: project_name.clone(),
                file_path: trimmed_file_path.to_string(),
                thumbnail_path: recent_project_thumbnail_path(&extension_dir, &project_name),
                blender_id: version.id.clone(),
                blender_display_name: version.display_name.clone(),
                blender_version: version.version.clone(),
                saved_at: trimmed_saved_at.to_string(),
                exists: Path::new(trimmed_file_path).exists(),
            };

            let key = normalize_recent_project_path_key(trimmed_file_path);

            match projects_by_path.get(&key) {
                Some(existing) if existing.saved_at >= project.saved_at => {}
                _ => {
                    projects_by_path.insert(key, project);
                }
            }
        }
    }

    let mut projects = projects_by_path.into_values().collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        right
            .saved_at
            .cmp(&left.saved_at)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    projects.truncate(12);
    projects
}

fn normalize_recent_project_path_key(value: &str) -> String {
    value.trim().replace('\\', "/").to_lowercase()
}

fn read_voxelshift_state(path: &Path) -> Option<VoxelShiftState> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str::<VoxelShiftState>(&contents).ok()
}

fn write_voxelshift_state(path: &Path, state: &VoxelShiftState) -> Result<(), String> {
    let contents = serde_json::to_string(state)
        .map_err(|error| format!("Unable to serialize Voxel Shift state: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("Unable to save Voxel Shift state: {error}"))
}

fn remove_recent_project_entries(
    versions: &[BlenderVersion],
    file_path: &str,
) -> Result<(), String> {
    let target_key = normalize_recent_project_path_key(file_path);
    if target_key.is_empty() {
        return Err("Please provide a recent project path.".to_string());
    }

    let mut removed_any = false;

    for version in versions {
        let extension_dir = PathBuf::from(&version.install_dir).join(BLENDER_EXTENSION_DIR);
        let config_path = extension_dir.join(BLENDER_EXTENSION_STATE_FILE);
        let Some(mut state) = read_voxelshift_state(&config_path) else {
            continue;
        };

        let previous_len = state.blender_projects.len();
        state
            .blender_projects
            .retain(|stored_path, _| normalize_recent_project_path_key(stored_path) != target_key);

        if state.blender_projects.len() == previous_len {
            continue;
        }

        write_voxelshift_state(&config_path, &state)?;
        removed_any = true;
    }

    if removed_any {
        Ok(())
    } else {
        Err("That recent project is no longer in the launcher history.".to_string())
    }
}

fn recent_project_thumbnail_path(extension_dir: &Path, project_name: &str) -> Option<String> {
    let thumbnail_path = extension_dir.join(format!("VS_THUMB_{project_name}.jpg"));

    if thumbnail_path.exists() {
        Some(path_to_string(&thumbnail_path))
    } else {
        None
    }
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
        return Err(format!(
            "The request to {url} returned an unexpected status: {status}"
        ));
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

        if let Some(download) =
            parse_release_download_href(href, channel, file_suffix, &release_date)
        {
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

    let version = file_name
        .strip_prefix("blender-")?
        .strip_suffix(file_suffix)?;
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

async fn fetch_experimental_release_groups(
    client: &reqwest::Client,
) -> Result<Vec<BlenderExperimentalReleaseGroup>, String> {
    let body = fetch_text(client, BLENDER_DAILY_BUILDS_URL).await?;
    let groups = parse_experimental_release_groups(&body);

    if groups.is_empty() {
        return Err(
            "No x64 experimental daily builds were found on builder.blender.org.".to_string(),
        );
    }

    Ok(groups)
}

fn parse_experimental_release_groups(body: &str) -> Vec<BlenderExperimentalReleaseGroup> {
    let lines = extract_html_text_lines_with_downloads(body);
    let mut grouped_downloads =
        BTreeMap::<String, (String, BTreeMap<String, BlenderReleaseDownload>)>::new();
    let mut pending_version: Option<String> = None;
    let mut pending_channel: Option<String> = None;
    let mut pending_release_date: Option<String> = None;
    let mut pending_platform_key: Option<String> = None;
    let mut pending_platform_label: Option<String> = None;

    for line in lines {
        if let Some((version, channel)) = parse_daily_release_heading(&line) {
            pending_version = Some(version);
            pending_channel = Some(channel);
            pending_release_date = None;
            pending_platform_key = None;
            pending_platform_label = None;
            continue;
        }

        if pending_version.is_none() {
            continue;
        }

        if pending_release_date.is_none() {
            if is_daily_release_date_line(&line) {
                pending_release_date = Some(line);
            }
            continue;
        }

        if pending_platform_key.is_none() {
            if let Some((platform_key, platform_label)) = parse_experimental_platform_line(&line) {
                pending_platform_key = Some(platform_key.to_string());
                pending_platform_label = Some(platform_label.to_string());
            }
            continue;
        }

        let Some(url) = line.strip_prefix("DOWNLOAD_URL::") else {
            continue;
        };

        let version = match pending_version.take() {
            Some(value) => value,
            None => continue,
        };
        let channel = match pending_channel.take() {
            Some(value) => value,
            None => continue,
        };
        let release_date = pending_release_date.take().unwrap_or_default();
        let platform_key = match pending_platform_key.take() {
            Some(value) => value,
            None => continue,
        };
        let platform_label = match pending_platform_label.take() {
            Some(value) => value,
            None => continue,
        };

        if channel.eq_ignore_ascii_case("stable") {
            continue;
        }

        let Some(download) =
            make_experimental_release_download(&version, &channel, &release_date, url)
        else {
            continue;
        };

        let (_, downloads) = grouped_downloads
            .entry(platform_key)
            .or_insert_with(|| (platform_label, BTreeMap::new()));
        downloads.entry(download.id.clone()).or_insert(download);
    }

    let mut groups = grouped_downloads
        .into_iter()
        .map(|(platform_key, (platform_label, downloads))| {
            let mut downloads: Vec<_> = downloads.into_values().collect();
            sort_release_downloads(&mut downloads);
            BlenderExperimentalReleaseGroup {
                platform_key,
                platform_label,
                downloads,
            }
        })
        .collect::<Vec<_>>();

    groups.sort_by(|left, right| {
        experimental_platform_rank(&left.platform_key)
            .cmp(&experimental_platform_rank(&right.platform_key))
            .then_with(|| left.platform_label.cmp(&right.platform_label))
    });

    groups
}

fn make_experimental_release_download(
    version: &str,
    channel: &str,
    release_date: &str,
    url: &str,
) -> Option<BlenderReleaseDownload> {
    let file_name = url.split('?').next()?.split('/').next_back()?.trim();

    if file_name.is_empty() || !is_supported_release_archive(file_name) {
        return None;
    }

    Some(BlenderReleaseDownload {
        id: make_release_id(url),
        channel: channel.to_string(),
        version: version.to_string(),
        file_name: file_name.to_string(),
        release_date: release_date.to_string(),
        url: url.to_string(),
    })
}

fn parse_daily_release_heading(line: &str) -> Option<(String, String)> {
    let normalized = normalize_whitespace(line);
    let mut parts = normalized.split_whitespace();

    if parts.next()? != "Blender" {
        return None;
    }

    let version = parts.next()?.to_string();
    let mut channel_parts = Vec::new();

    for token in parts {
        if token.eq_ignore_ascii_case("SHA") {
            break;
        }

        if looks_like_reference_hash(token) && !channel_parts.is_empty() {
            break;
        }

        channel_parts.push(token);
    }

    if channel_parts.is_empty() {
        return None;
    }

    Some((version, channel_parts.join(" ")))
}

fn parse_experimental_platform_line(line: &str) -> Option<(&'static str, &'static str)> {
    let normalized = line.to_ascii_lowercase();

    if normalized.contains("windows") && normalized.contains("x64") {
        Some(("windows", "Windows x64"))
    } else if normalized.contains("linux") && normalized.contains("x64") {
        Some(("linux", "Linux x64"))
    } else if normalized.contains("macos")
        && (normalized.contains("intel") || normalized.contains("x64"))
    {
        Some(("macos", "macOS x64"))
    } else {
        None
    }
}

fn experimental_platform_rank(platform_key: &str) -> usize {
    match platform_key {
        "windows" => 0,
        "linux" => 1,
        "macos" => 2,
        _ => 99,
    }
}

fn is_daily_release_date_line(line: &str) -> bool {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    parts.len() >= 2
        && parts[0].chars().all(|character| character.is_ascii_digit())
        && is_month_token(parts[1])
}

fn is_month_token(token: &str) -> bool {
    matches!(
        token,
        "Jan"
            | "Feb"
            | "Mar"
            | "Apr"
            | "May"
            | "Jun"
            | "Jul"
            | "Aug"
            | "Sep"
            | "Oct"
            | "Nov"
            | "Dec"
    )
}

fn looks_like_reference_hash(token: &str) -> bool {
    token.len() >= 7 && token.chars().all(|character| character.is_ascii_hexdigit())
}

fn extract_html_text_lines_with_downloads(body: &str) -> Vec<String> {
    let lower = body.to_ascii_lowercase();
    let mut output = String::new();
    let mut index = 0usize;
    let mut ignored_tag: Option<String> = None;
    let mut anchor_href: Option<String> = None;
    let mut anchor_text = String::new();

    while index < body.len() {
        let rest = &body[index..];

        if rest.starts_with('<') {
            let Some(tag_end) = rest.find('>') else {
                break;
            };
            let tag_inner = &body[index + 1..index + tag_end];
            let tag_inner_lower = &lower[index + 1..index + tag_end];
            let trimmed_original = tag_inner.trim();
            let trimmed_lower = tag_inner_lower.trim();
            let is_end_tag = trimmed_lower.starts_with('/');
            let tag_name = parse_html_tag_name(trimmed_lower);

            if let Some(ignored) = ignored_tag.as_deref() {
                if is_end_tag && tag_name == ignored {
                    ignored_tag = None;
                    if is_line_break_tag(tag_name) {
                        output.push('\n');
                    }
                }
                index += tag_end + 1;
                continue;
            }

            if !is_end_tag && matches!(tag_name, "script" | "style") {
                ignored_tag = Some(tag_name.to_string());
                index += tag_end + 1;
                continue;
            }

            if !is_end_tag && tag_name == "a" {
                anchor_href = extract_href_attribute(trimmed_original);
                anchor_text.clear();
            } else if is_end_tag && tag_name == "a" {
                let text = normalize_whitespace(&anchor_text);
                if !text.is_empty() {
                    if text.eq_ignore_ascii_case("Download") {
                        if let Some(href) = anchor_href.as_deref() {
                            if let Some(url) = resolve_download_url(href) {
                                output.push('\n');
                                output.push_str("DOWNLOAD_URL::");
                                output.push_str(&url);
                                output.push('\n');
                            }
                        }
                    } else {
                        if output
                            .chars()
                            .last()
                            .map(|character| !character.is_whitespace())
                            .unwrap_or(false)
                        {
                            output.push(' ');
                        }
                        output.push_str(&text);
                        output.push(' ');
                    }
                }
                anchor_href = None;
                anchor_text.clear();
            }

            if is_line_break_tag(tag_name) {
                output.push('\n');
            }

            index += tag_end + 1;
            continue;
        }

        let next_tag = rest
            .find('<')
            .map(|offset| index + offset)
            .unwrap_or(body.len());
        let fragment = decode_html_entities(&body[index..next_tag]);

        if anchor_href.is_some() {
            anchor_text.push_str(&fragment);
        } else {
            output.push_str(&fragment);
        }

        index = next_tag;
    }

    output
        .lines()
        .map(normalize_whitespace)
        .filter(|line| !line.is_empty())
        .collect()
}

fn parse_html_tag_name(tag_content: &str) -> &str {
    tag_content
        .trim_start_matches('/')
        .split(|character: char| character.is_whitespace() || character == '/')
        .next()
        .unwrap_or_default()
}

fn is_line_break_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "article"
            | "aside"
            | "br"
            | "div"
            | "footer"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "li"
            | "main"
            | "nav"
            | "p"
            | "section"
            | "table"
            | "tbody"
            | "td"
            | "th"
            | "thead"
            | "tr"
            | "ul"
    )
}

fn extract_href_attribute(tag_content: &str) -> Option<String> {
    let lower = tag_content.to_ascii_lowercase();
    let href_start = lower.find("href=")? + 5;
    let raw = &tag_content[href_start..].trim_start();
    let quote = raw.chars().next()?;

    if quote == '"' || quote == '\'' {
        let value = &raw[1..];
        let value_end = value.find(quote)?;
        Some(value[..value_end].to_string())
    } else {
        let value_end = raw
            .find(|character: char| character.is_whitespace() || character == '>')
            .unwrap_or(raw.len());
        Some(raw[..value_end].to_string())
    }
}

fn resolve_download_url(href: &str) -> Option<String> {
    let trimmed = href.trim();

    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('?') {
        return None;
    }

    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        Some(trimmed.to_string())
    } else if trimmed.starts_with("//") {
        Some(format!("https:{trimmed}"))
    } else if trimmed.starts_with('/') {
        Some(format!("https://builder.blender.org{trimmed}"))
    } else {
        Some(format!(
            "{BLENDER_DAILY_BUILDS_URL}{}",
            trimmed.trim_start_matches("./")
        ))
    }
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sort_release_downloads(downloads: &mut [BlenderReleaseDownload]) {
    downloads.sort_by(|left, right| {
        compare_version_values(&right.version, &left.version)
            .then_with(|| right.channel.cmp(&left.channel))
            .then_with(|| right.release_date.cmp(&left.release_date))
    });
}

fn current_release_platform() -> Option<ReleasePlatform> {
    match std::env::consts::OS {
        "windows" => Some(ReleasePlatform {
            file_suffix: "-windows-x64.zip",
            label: "Windows x64",
            os_tokens: &["windows"],
            arch_tokens: &["x64", "amd64", "x86_64"],
        }),
        "linux" => Some(ReleasePlatform {
            file_suffix: "-linux-x64.tar.xz",
            label: "Linux x64",
            os_tokens: &["linux"],
            arch_tokens: &["x64", "amd64", "x86_64"],
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
        && [major, minor, patch].into_iter().all(|segment| {
            !segment.is_empty() && segment.chars().all(|character| character.is_ascii_digit())
        })
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
        return Err(
            "Please point to the Blender executable or a Blender install folder.".to_string(),
        );
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

fn is_zip_archive(file_name: &str) -> bool {
    file_name.ends_with(".zip")
}

fn is_tar_xz_archive(file_name: &str) -> bool {
    file_name.ends_with(".tar.xz")
}

fn is_supported_release_archive(file_name: &str) -> bool {
    is_zip_archive(file_name) || is_tar_xz_archive(file_name)
}

fn is_official_blender_download_url(url: &str) -> bool {
    url.starts_with(BLENDER_RELEASE_INDEX_URL)
        || url.starts_with(BLENDER_DAILY_BUILDS_URL)
        || url.starts_with(BLENDER_BUILDER_CDN_URL)
}

fn file_name_matches_platform(file_name: &str, platform: &ReleasePlatform) -> bool {
    let normalized = file_name.to_ascii_lowercase();
    let matches_os = platform
        .os_tokens
        .iter()
        .any(|token| normalized.contains(token));
    let matches_arch = platform
        .arch_tokens
        .iter()
        .any(|token| normalized.contains(token));

    matches_os && matches_arch && is_supported_release_archive(file_name)
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

    if !is_official_blender_download_url(request.url.trim()) {
        return Err(
            "Only official Blender downloads from blender.org can be installed automatically."
                .to_string(),
        );
    }

    if !file_name_matches_platform(&request.file_name, &platform) {
        return Err(format!(
            "This release does not match the current platform: {}.",
            platform.label
        ));
    }

    if !is_supported_release_archive(&request.file_name) {
        return Err(
            "Automatic installs currently support .zip and .tar.xz Blender releases only."
                .to_string(),
        );
    }

    Ok(())
}

trait ReleaseInstallProgressEmitter: Clone + Send + Sync + 'static {
    fn emit_release_install_progress(&self, progress: ReleaseInstallProgress);
}

impl<R: tauri::Runtime> ReleaseInstallProgressEmitter for AppHandle<R> {
    fn emit_release_install_progress(&self, progress: ReleaseInstallProgress) {
        let _ = self.emit(RELEASE_INSTALL_EVENT, progress);
    }
}
async fn download_release_archive<E: ReleaseInstallProgressEmitter>(
    app: &E,
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
                ((downloaded_bytes as f64 / total as f64).clamp(0.0, 1.0))
                    * DOWNLOAD_PROGRESS_WEIGHT
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

async fn extract_release_archive<E: ReleaseInstallProgressEmitter>(
    app: &E,
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

        if is_zip_archive(&request.file_name) {
            extract_zip_release_archive(&app, &control, &request, &archive_path, &extraction_dir)?;
        } else if is_tar_xz_archive(&request.file_name) {
            extract_tar_xz_release_archive(
                &app,
                &control,
                &request,
                &archive_path,
                &extraction_dir,
            )?;
        } else {
            return Err(
                "Automatic installs currently support .zip and .tar.xz Blender releases only."
                    .to_string(),
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

fn extract_zip_release_archive<E: ReleaseInstallProgressEmitter>(
    app: &E,
    control: &ReleaseInstallControl,
    request: &InstallReleaseRequest,
    archive_path: &Path,
    extraction_dir: &Path,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
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
        let relative_path = entry
            .enclosed_name()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("The archive entry '{}' has an invalid path.", entry.name()))?;
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
            app,
            ReleaseInstallProgress {
                release_id: request.id.clone(),
                phase: "extracting".to_string(),
                progress_percent: Some(
                    DOWNLOAD_PROGRESS_WEIGHT + extract_ratio * (100.0 - DOWNLOAD_PROGRESS_WEIGHT),
                ),
                downloaded_bytes: 0,
                total_bytes: None,
                speed_bytes_per_second: None,
                install_dir: None,
                message: format!("Extracting {}", request.file_name),
            },
        );
    }

    Ok(())
}

fn extract_tar_xz_release_archive<E: ReleaseInstallProgressEmitter>(
    app: &E,
    control: &ReleaseInstallControl,
    request: &InstallReleaseRequest,
    archive_path: &Path,
    extraction_dir: &Path,
) -> Result<(), String> {
    emit_release_install_progress(
        app,
        ReleaseInstallProgress {
            release_id: request.id.clone(),
            phase: "extracting".to_string(),
            progress_percent: None,
            downloaded_bytes: 0,
            total_bytes: None,
            speed_bytes_per_second: None,
            install_dir: None,
            message: format!("Extracting {}", request.file_name),
        },
    );

    #[cfg(target_os = "linux")]
    {
        let mut child = Command::new("tar");
        child
            .arg("-xJf")
            .arg(archive_path)
            .arg("-C")
            .arg(extraction_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        let mut child = child
            .spawn()
            .map_err(|error| format!("Unable to start tar for {}: {error}", request.file_name))?;

        loop {
            if control.is_cancel_requested(&request.id)? {
                let _ = child.kill();
                let _ = child.wait();
                return Err(INSTALL_CANCELED_MESSAGE.to_string());
            }

            if let Some(status) = child.try_wait().map_err(|error| {
                format!(
                    "Unable to monitor tar while extracting {}: {error}",
                    request.file_name
                )
            })? {
                let mut stderr_output = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let mut buffer = Vec::new();
                    stderr.read_to_end(&mut buffer).map_err(|error| {
                        format!(
                            "Unable to read tar output for {}: {error}",
                            request.file_name
                        )
                    })?;
                    stderr_output = String::from_utf8_lossy(&buffer).trim().to_string();
                }

                if status.success() {
                    return Ok(());
                }

                let detail = if stderr_output.is_empty() {
                    format!("tar exited with status {}.", status)
                } else {
                    stderr_output
                };

                return Err(format!(
                    "Unable to extract {} with tar: {}",
                    request.file_name, detail
                ));
            }

            std::thread::sleep(Duration::from_millis(150));
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (control, archive_path, extraction_dir);
        Err("Linux tar.xz release extraction is only supported on Linux builds.".to_string())
    }
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
        fs::rename(extraction_dir, &final_install_dir).map_err(|error| {
            format!("Unable to move the installed Blender files into place: {error}")
        })?;
    } else {
        fs::rename(&archive_root, &final_install_dir).map_err(|error| {
            format!("Unable to move the installed Blender folder into place: {error}")
        })?;
    }

    let executable = scan_for_blender_executables(&final_install_dir, MAX_SCAN_DEPTH)
        .into_iter()
        .next()
        .ok_or_else(|| {
            "The downloaded archive did not contain the Blender executable.".to_string()
        })?;

    if !executable.exists() {
        return Err("The extracted Blender executable could not be found.".to_string());
    }

    Ok(final_install_dir)
}

fn emit_release_install_progress<E: ReleaseInstallProgressEmitter>(
    app: &E,
    progress: ReleaseInstallProgress,
) {
    app.emit_release_install_progress(progress);
}

fn install_voxel_shift_extension<R: tauri::Runtime>(
    app: &AppHandle<R>,
    blender_install_dir: &Path,
) -> Result<(), String> {
    let resources = resolve_extension_resource_paths(app)?;
    sync_voxel_shift_extension_resources(blender_install_dir, &resources)?;
    enable_voxel_shift_extension(blender_install_dir)?;
    Ok(())
}

fn resolve_extension_resource_paths<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<(&'static str, PathBuf)>, String> {
    [BLENDER_EXTENSION_INIT_FILE, BLENDER_EXTENSION_MANIFEST_FILE]
        .into_iter()
        .map(|file_name| Ok((file_name, resolve_extension_resource_path(app, file_name)?)))
        .collect()
}

fn sync_voxel_shift_extension_resources(
    blender_install_dir: &Path,
    resources: &[(&'static str, PathBuf)],
) -> Result<bool, String> {
    let extension_dir = blender_install_dir.join(BLENDER_EXTENSION_DIR);
    fs::create_dir_all(&extension_dir).map_err(|error| {
        format!(
            "Unable to create the Voxel Shift extension folder in {}: {error}",
            path_to_string(&extension_dir)
        )
    })?;

    let mut changed = false;

    for (file_name, source_path) in resources {
        let destination_path = extension_dir.join(file_name);
        if extension_resource_matches(source_path, &destination_path)? {
            continue;
        }

        fs::copy(source_path, &destination_path).map_err(|error| {
            format!(
                "Unable to copy {} into {}: {error}",
                path_to_string(source_path),
                path_to_string(&destination_path)
            )
        })?;
        changed = true;
    }

    Ok(changed)
}

fn extension_resource_matches(source_path: &Path, destination_path: &Path) -> Result<bool, String> {
    if !destination_path.exists() {
        return Ok(false);
    }

    let source_contents = fs::read(source_path).map_err(|error| {
        format!(
            "Unable to read the Voxel Shift extension resource {}: {error}",
            path_to_string(source_path)
        )
    })?;
    let destination_contents = fs::read(destination_path).map_err(|error| {
        format!(
            "Unable to read the Voxel Shift extension file {}: {error}",
            path_to_string(destination_path)
        )
    })?;

    Ok(source_contents == destination_contents)
}

fn refresh_managed_blender_extensions_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<usize, String> {
    let stable_dir = stable_install_dir(app)?;
    if !stable_dir.exists() {
        return Ok(0);
    }

    let resources = resolve_extension_resource_paths(app)?;
    let mut refreshed = 0;

    for entry in fs::read_dir(&stable_dir)
        .map_err(|error| format!("Unable to read the managed Blender install directory: {error}"))?
    {
        let install_dir = entry
            .map_err(|error| format!("Unable to inspect a managed Blender install: {error}"))?
            .path();

        if !install_dir.is_dir() {
            continue;
        }

        match sync_voxel_shift_extension_resources(&install_dir, &resources) {
            Ok(true) => match enable_voxel_shift_extension(&install_dir) {
                Ok(()) => refreshed += 1,
                Err(error) => eprintln!(
                    "Unable to enable the refreshed Voxel Shift extension in {}: {error}",
                    path_to_string(&install_dir)
                ),
            },
            Ok(false) => {}
            Err(error) => eprintln!(
                "Unable to refresh the Voxel Shift extension in {}: {error}",
                path_to_string(&install_dir)
            ),
        }
    }

    Ok(refreshed)
}

fn enable_voxel_shift_extension(blender_install_dir: &Path) -> Result<(), String> {
    let executable = scan_for_blender_executables(blender_install_dir, MAX_SCAN_DEPTH)
        .into_iter()
        .next()
        .ok_or_else(|| "The installed Blender executable could not be found.".to_string())?;
    let mut command = Command::new(&executable);
    command
        .arg("-b")
        .arg("--python-expr")
        .arg(BLENDER_EXTENSION_ENABLE_SCRIPT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let output = command.output().map_err(|error| {
        format!(
            "Unable to enable the Voxel Shift Blender extension in {}: {error}",
            path_to_string(&executable)
        )
    })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() {
        format!("Blender exited with status {}.", output.status)
    } else {
        stderr
    };

    Err(format!(
        "Blender installed successfully, but enabling {} failed: {}",
        BLENDER_EXTENSION_MODULE, detail
    ))
}

fn resolve_extension_resource_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_name: &str,
) -> Result<PathBuf, String> {
    for bundled_relative_path in bundled_extension_resource_candidates(file_name) {
        let bundled_path = app
            .path()
            .resolve(&bundled_relative_path, BaseDirectory::Resource)
            .map_err(|error| {
                format!(
                    "Unable to locate bundled resource {}: {error}",
                    bundled_relative_path.display()
                )
            })?;

        if bundled_path.exists() {
            return Ok(bundled_path);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join(file_name);

    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "Unable to find the Voxel Shift extension resource {}.",
        file_name
    ))
}

fn bundled_extension_resource_candidates(file_name: &str) -> [PathBuf; 3] {
    [
        PathBuf::from("_up_")
            .join(BUNDLED_EXTENSION_RESOURCE_DIR)
            .join(file_name),
        PathBuf::from(BUNDLED_EXTENSION_RESOURCE_DIR).join(file_name),
        PathBuf::from(file_name),
    ]
}

fn release_folder_name(file_name: &str) -> String {
    let trimmed = file_name.trim();

    trimmed
        .trim_end_matches(".tar.xz")
        .trim_end_matches(".zip")
        .to_string()
}

fn voxelshift_documents_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let documents_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Unable to find the Documents directory: {error}"))?;

    Ok(documents_dir.join(VOXELSHIFT_DIR_NAME))
}

fn stable_install_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(voxelshift_documents_dir(app)?.join(STABLE_INSTALL_DIR_NAME))
}

fn configs_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(voxelshift_documents_dir(app)?.join(CONFIGS_DIR_NAME))
}

fn portable_config_dir(blender_install_dir: &Path) -> PathBuf {
    blender_install_dir.join("portable").join("config")
}

fn default_blender_config_name(version: &BlenderVersion) -> String {
    version
        .version
        .clone()
        .unwrap_or_else(|| version.display_name.trim().to_string())
}

fn normalize_blender_config_name(value: &str, default_name: &str) -> Result<String, String> {
    let requested =
        trim_to_option(value.to_string()).unwrap_or_else(|| default_name.trim().to_string());
    let sanitized = sanitize_blender_config_folder_name(&requested);

    if sanitized.is_empty() {
        return Err("Please provide a valid config name.".to_string());
    }

    Ok(sanitized)
}

fn sanitize_blender_config_folder_name(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect::<String>();

    sanitized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|character| character == '.' || character == ' ')
        .to_string()
}

fn list_blender_configs(configs_dir: &Path) -> Result<Vec<BlenderConfigProfile>, String> {
    if !configs_dir.exists() {
        return Ok(Vec::new());
    }

    let mut configs = Vec::new();
    let entries = fs::read_dir(configs_dir)
        .map_err(|error| format!("Unable to read the saved configs directory: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        configs.push(build_blender_config_profile(&path)?);
    }

    configs.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(configs)
}

fn build_blender_config_profile(config_dir: &Path) -> Result<BlenderConfigProfile, String> {
    let name = config_dir
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "The saved config folder name is invalid: {}",
                path_to_string(config_dir)
            )
        })?;

    Ok(BlenderConfigProfile {
        id: name.clone(),
        name,
        path: path_to_string(config_dir),
        updated_at: directory_modified_timestamp(config_dir),
    })
}

fn directory_modified_timestamp(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn save_blender_config_snapshot(
    source_dir: &Path,
    configs_dir: &Path,
    config_name: &str,
) -> Result<BlenderConfigProfile, String> {
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(
            "No portable config folder was found for this Blender install yet.".to_string(),
        );
    }

    fs::create_dir_all(configs_dir)
        .map_err(|error| format!("Unable to prepare the saved configs directory: {error}"))?;

    let target_dir = configs_dir.join(config_name);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|error| {
            format!("Unable to replace the saved config {config_name}: {error}")
        })?;
    }

    copy_directory_contents(source_dir, &target_dir)?;
    build_blender_config_profile(&target_dir)
}

fn apply_blender_config_snapshot(config_dir: &Path, target_dir: &Path) -> Result<(), String> {
    if !config_dir.exists() || !config_dir.is_dir() {
        return Err("That saved config could not be found.".to_string());
    }

    if target_dir.exists() {
        fs::remove_dir_all(target_dir)
            .map_err(|error| format!("Unable to clear the Blender config folder: {error}"))?;
    }

    if let Some(parent) = target_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to prepare the Blender portable folder: {error}"))?;
    }

    copy_directory_contents(config_dir, target_dir)
}

fn remove_blender_config_snapshot(configs_dir: &Path, config_id: &str) -> Result<(), String> {
    let config_dir = resolve_blender_config_path(configs_dir, config_id)?;

    fs::remove_dir_all(&config_dir).map_err(|error| {
        format!(
            "Unable to remove the saved config {}: {error}",
            config_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(config_id)
        )
    })
}

fn resolve_blender_config_path(configs_dir: &Path, config_id: &str) -> Result<PathBuf, String> {
    let trimmed = config_id.trim();
    if trimmed.is_empty() {
        return Err("The saved config is missing.".to_string());
    }

    if !configs_dir.exists() {
        return Err("That saved config could not be found.".to_string());
    }

    let entries = fs::read_dir(configs_dir)
        .map_err(|error| format!("Unable to read the saved configs directory: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if name == trimmed || eq_ignore_case(name, trimmed) {
            return Ok(path);
        }
    }

    Err("That saved config could not be found.".to_string())
}

fn copy_directory_contents(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!(
            "The config source directory is missing: {}",
            path_to_string(source_dir)
        ));
    }

    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Unable to create the target config directory: {error}"))?;

    let entries = fs::read_dir(source_dir)
        .map_err(|error| format!("Unable to read the config directory: {error}"))?;

    for entry in entries.flatten() {
        let source_path = entry.path();
        let target_path = target_dir.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_contents(&source_path, &target_path)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to prepare the config directory tree: {error}"))?;
        }

        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "Unable to copy {} into {}: {error}",
                path_to_string(&source_path),
                path_to_string(&target_path)
            )
        })?;
    }

    Ok(())
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

fn load_window_state(app: &AppHandle) -> Result<Option<StoredWindowState>, String> {
    let file_path = window_state_file_path(app)?;

    if !file_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&file_path)
        .map_err(|error| format!("Unable to read window state: {error}"))?;

    let state = serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse window state file: {error}"))?;

    Ok(Some(state))
}

fn save_window_state(app: &AppHandle, state: &StoredWindowState) -> Result<(), String> {
    let file_path = window_state_file_path(app)?;
    let directory = file_path
        .parent()
        .ok_or_else(|| "Unable to access application data directory.".to_string())?;

    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to prepare application data directory: {error}"))?;

    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Unable to serialize window state: {error}"))?;

    fs::write(file_path, json).map_err(|error| format!("Unable to save window state: {error}"))
}

fn save_window_state_for(window: &Window) -> Result<(), String> {
    if window
        .is_minimized()
        .map_err(|error| format!("Unable to read window minimized state: {error}"))?
    {
        return Ok(());
    }

    let app = window.app_handle();
    let mut state = load_window_state(&app)?.unwrap_or_default();

    state.is_maximized = window
        .is_maximized()
        .map_err(|error| format!("Unable to read window maximized state: {error}"))?;

    if !state.is_maximized {
        let position = window
            .outer_position()
            .map_err(|error| format!("Unable to read window position: {error}"))?;
        let size = window
            .outer_size()
            .map_err(|error| format!("Unable to read window size: {error}"))?;

        state.position = Some(StoredWindowPosition {
            x: position.x,
            y: position.y,
        });
        state.size = Some(StoredWindowSize {
            width: size.width,
            height: size.height,
        });
    }

    save_window_state(&app, &state)
}

fn restore_window_state(window: &WebviewWindow) -> Result<(), String> {
    let Some(state) = load_window_state(&window.app_handle())? else {
        return Ok(());
    };

    if let Some(size) = state.size {
        window
            .set_size(Size::Physical(PhysicalSize::new(size.width, size.height)))
            .map_err(|error| format!("Unable to restore window size: {error}"))?;
    }

    let had_saved_position = state.position.is_some();

    if let Some(position) = restorable_window_position(state.position) {
        window
            .set_position(Position::Physical(PhysicalPosition::new(
                position.x, position.y,
            )))
            .map_err(|error| format!("Unable to restore window position: {error}"))?;
    } else if had_saved_position {
        window
            .center()
            .map_err(|error| format!("Unable to center restored window: {error}"))?;
    }

    if state.is_maximized {
        window
            .maximize()
            .map_err(|error| format!("Unable to restore maximized window state: {error}"))?;
    }

    Ok(())
}

fn restorable_window_position(
    position: Option<StoredWindowPosition>,
) -> Option<StoredWindowPosition> {
    let position = position?;

    if position.x == MINIMIZED_WINDOW_SENTINEL && position.y == MINIMIZED_WINDOW_SENTINEL {
        None
    } else {
        Some(position)
    }
}

fn window_state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to find application data directory: {error}"))?;

    Ok(app_data_dir.join(WINDOW_STATE_FILE_NAME))
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

fn make_recent_project_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_lowercase().hash(&mut hasher);
    format!("project-{:016x}", hasher.finish())
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

fn add_scan_root_value(scan_roots: &mut Vec<String>, root: String) -> bool {
    if scan_roots
        .iter()
        .any(|current| eq_ignore_case(current, &root))
    {
        return false;
    }

    scan_roots.push(root);
    scan_roots.sort_by_key(|value| value.to_lowercase());
    true
}

fn remove_scan_root_value(scan_roots: &mut Vec<String>, root: &str) -> bool {
    let initial_len = scan_roots.len();
    scan_roots.retain(|current| !eq_ignore_case(current, root));
    scan_roots.len() != initial_len
}

fn resolve_launch_version<'a>(
    versions: &'a [BlenderVersion],
    id: &str,
) -> Result<&'a BlenderVersion, String> {
    let version = versions
        .iter()
        .find(|version| version.id == id)
        .ok_or_else(|| "Could not find that Blender version.".to_string())?;

    if !version.available {
        return Err("That Blender executable is missing.".to_string());
    }

    Ok(version)
}

fn validate_project_launch_path(project_path: &str) -> Result<PathBuf, String> {
    if project_path.trim().is_empty() {
        return Err("The Blender project path is missing.".to_string());
    }

    let path = PathBuf::from(project_path.trim());
    if !path.exists() {
        return Err("That Blender project file could not be found.".to_string());
    }

    Ok(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = env::temp_dir().join(format!("voxel-shift-{prefix}-{unique}"));
            fs::create_dir_all(&path).expect("test temp dir should be created");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn make_version(
        display_name: &str,
        version: Option<&str>,
        available: bool,
        is_default: bool,
    ) -> BlenderVersion {
        BlenderVersion {
            id: format!("id-{display_name}"),
            display_name: display_name.to_string(),
            version: version.map(|value| value.to_string()),
            executable_path: format!("/apps/{display_name}/blender"),
            install_dir: format!("/apps/{display_name}"),
            source: VersionSource::Manual,
            available,
            is_default,
            last_launched_at: None,
        }
    }

    fn make_installed_version(
        id: &str,
        display_name: &str,
        version: Option<&str>,
        install_dir: &Path,
        available: bool,
    ) -> BlenderVersion {
        BlenderVersion {
            id: id.to_string(),
            display_name: display_name.to_string(),
            version: version.map(|value| value.to_string()),
            executable_path: path_to_string(&install_dir.join(BLENDER_EXECUTABLE_NAME)),
            install_dir: path_to_string(install_dir),
            source: VersionSource::Manual,
            available,
            is_default: false,
            last_launched_at: None,
        }
    }

    #[test]
    fn identifies_major_minor_versions() {
        assert!(is_major_minor_release("4.2"));
        assert!(!is_major_minor_release("4.2.1"));
        assert!(!is_major_minor_release("daily"));
    }

    #[test]
    fn identifies_patch_versions() {
        assert!(is_patch_release("4.2.3"));
        assert!(!is_patch_release("4.2"));
        assert!(!is_patch_release("4.2.beta"));
    }

    #[test]
    fn parses_release_channels_from_relative_and_absolute_urls() {
        let body = r#"
            <a href="Blender4.1/">Blender 4.1</a>
            <a href="./Blender4.2/">Blender 4.2</a>
            <a href="https://download.blender.org/release/Blender4.2/">duplicate</a>
            <a href="Blender2.93/">legacy</a>
        "#;

        let channels = parse_blender_release_channels(body);
        let versions = channels
            .iter()
            .map(|channel| channel.version.as_str())
            .collect::<Vec<_>>();

        assert_eq!(versions, vec!["4.2", "4.1"]);
        assert_eq!(
            channels[0].url,
            "https://download.blender.org/release/Blender4.2/"
        );
        assert!(parse_release_channel_href("#ignored").is_none());
    }

    #[test]
    fn parses_release_downloads_and_sorts_latest_versions_first() {
        let channel = BlenderReleaseChannel {
            name: "Blender4.2".to_string(),
            version: "4.2".to_string(),
            url: "https://download.blender.org/release/Blender4.2/".to_string(),
        };
        let body = r#"
            <a href="blender-4.2.3-windows-x64.zip">ok</a> 2026-03-20
            <a href="blender-4.2.10-windows-x64.zip">ok</a> 2026-03-22
            <a href="blender-4.2-windows-x64.zip">bad</a> 2026-03-19
            <a href="blender-4.3.0-windows-x64.zip">wrong channel</a> 2026-03-21
            <a href="blender-4.2.10-windows-x64.zip">duplicate</a> 2026-03-22
        "#;

        let mut downloads = parse_release_downloads(body, &channel, "-windows-x64.zip");
        sort_release_downloads(&mut downloads);

        assert_eq!(downloads.len(), 2);
        assert_eq!(downloads[0].version, "4.2.10");
        assert_eq!(downloads[1].version, "4.2.3");
        assert_eq!(downloads[0].id, make_release_id(&downloads[0].url));
        assert_eq!(
            parse_directory_listing_line(
                r#"<a href="./blender-4.2.3-windows-x64.zip">zip</a> 2026-03-20 12:00"#
            ),
            Some(("./blender-4.2.3-windows-x64.zip", "2026-03-20".to_string()))
        );
        assert!(parse_release_download_href(
            "?ignored",
            &channel,
            "-windows-x64.zip",
            "2026-03-20"
        )
        .is_none());
    }

    #[test]
    fn extracts_experimental_release_groups_from_html() {
        let body = r#"
            <section>
              <h3>Blender 4.4.0 Alpha 1a2b3c4</h3>
              <p>12 Mar 2026</p>
              <p>Windows x64</p>
              <a href="/download/daily/blender-4.4.0-alpha.1a2b3c4-windows-x64.zip">Download</a>
              <h3>Blender 4.4.0 Alpha 1a2b3c4</h3>
              <p>12 Mar 2026</p>
              <p>Linux x64</p>
              <a href="https://builder.blender.org/download/daily/blender-4.4.0-alpha.1a2b3c4-linux-x64.tar.xz">Download</a>
              <h3>Blender 4.4.0 Stable 1a2b3c4</h3>
              <p>12 Mar 2026</p>
              <p>Windows x64</p>
              <a href="/download/daily/blender-4.4.0-stable.1a2b3c4-windows-x64.zip">Download</a>
            </section>
        "#;

        let groups = parse_experimental_release_groups(body);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].platform_key, "windows");
        assert_eq!(groups[0].downloads[0].channel, "Alpha");
        assert!(groups[0].downloads[0].url.contains("windows-x64.zip"));
        assert_eq!(groups[1].platform_key, "linux");
        assert!(groups[1].downloads[0].url.contains("linux-x64.tar.xz"));
        assert_eq!(
            make_experimental_release_download(
                "4.4.0",
                "Alpha",
                "12 Mar 2026",
                "https://builder.blender.org/download/daily/blender-4.4.0-alpha-windows-x64.zip?x=1"
            )
            .unwrap()
            .file_name,
            "blender-4.4.0-alpha-windows-x64.zip"
        );
        assert!(make_experimental_release_download(
            "4.4.0",
            "Alpha",
            "12 Mar 2026",
            "https://builder.blender.org/download/daily/blender-4.4.0-alpha-windows-x64.dmg"
        )
        .is_none());
    }

    #[test]
    fn parses_daily_build_and_html_helpers() {
        assert_eq!(
            parse_daily_release_heading("Blender 4.4.0 Alpha 1a2b3c4"),
            Some(("4.4.0".to_string(), "Alpha".to_string()))
        );
        assert_eq!(
            parse_daily_release_heading("Blender 4.4.0 Beta SHA 1a2b3c4"),
            Some(("4.4.0".to_string(), "Beta".to_string()))
        );
        assert_eq!(
            parse_experimental_platform_line("macOS Intel x64"),
            Some(("macos", "macOS x64"))
        );
        assert!(is_daily_release_date_line("12 Mar 2026"));
        assert!(!is_daily_release_date_line("Mar 12 2026"));
        assert!(is_month_token("Mar"));
        assert!(looks_like_reference_hash("1a2b3c4"));
        assert_eq!(parse_html_tag_name("div class=\"panel\""), "div");
        assert!(is_line_break_tag("section"));
        assert_eq!(
            extract_href_attribute("a href=\"/download/daily/file.zip\" class=\"download\""),
            Some("/download/daily/file.zip".to_string())
        );
        assert_eq!(
            resolve_download_url("//cdn.builder.blender.org/file.zip"),
            Some("https://cdn.builder.blender.org/file.zip".to_string())
        );
        assert_eq!(
            resolve_download_url("relative/file.zip"),
            Some("https://builder.blender.org/download/daily/relative/file.zip".to_string())
        );
        assert_eq!(
            decode_html_entities("A&nbsp;&amp;&nbsp;B"),
            "A & B".to_string()
        );
        assert_eq!(
            normalize_whitespace(" Blender\n  4.4.0 \t Alpha "),
            "Blender 4.4.0 Alpha"
        );

        let lines = extract_html_text_lines_with_downloads(
            r#"
                <style>.skip { color: red; }</style>
                <script>ignored()</script>
                <section>
                  <p>Blender&nbsp;4.4.0 &amp; More</p>
                  <a href="/download/daily/file.zip">Download</a>
                </section>
            "#,
        );

        assert!(lines.contains(&"Blender 4.4.0 & More".to_string()));
        assert!(lines.iter().any(
            |line| line == "DOWNLOAD_URL::https://builder.blender.org/download/daily/file.zip"
        ));
    }

    #[test]
    fn extracts_versions_from_paths_and_labels() {
        assert_eq!(
            extract_version_like_segment("blender-4.2.3-windows-x64"),
            Some("4.2.3".to_string())
        );
        assert_eq!(
            infer_version_from_path(Path::new("/apps/Blender 3.6/blender")),
            Some("3.6".to_string())
        );
        assert_eq!(
            default_display_name(Path::new("/apps/Custom Build/blender")),
            "Custom Build".to_string()
        );
    }

    #[test]
    fn scans_for_blender_executables_respecting_depth() {
        let sandbox = TestDir::new("scan-executables");
        let shallow_dir = sandbox.path().join("Blender 4.2");
        let deep_dir = sandbox
            .path()
            .join("nested")
            .join("deeper")
            .join("too-deep");
        fs::create_dir_all(&shallow_dir).unwrap();
        fs::create_dir_all(&deep_dir).unwrap();
        fs::write(shallow_dir.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();
        fs::write(deep_dir.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();

        let executables = scan_for_blender_executables(sandbox.path(), 3);
        let paths = executables
            .iter()
            .map(|path| path_to_string(path))
            .collect::<Vec<_>>();

        assert_eq!(executables.len(), 1);
        assert!(paths[0].contains("Blender 4.2"));
    }

    #[test]
    fn normalizes_paths_for_blender_installs_and_scan_roots() {
        let sandbox = TestDir::new("normalize-paths");
        let install_dir = sandbox.path().join("Custom Build");
        fs::create_dir_all(&install_dir).unwrap();
        let executable_path = install_dir.join(BLENDER_EXECUTABLE_NAME);
        let other_file = install_dir.join("notes.txt");
        fs::write(&executable_path, b"").unwrap();
        fs::write(&other_file, b"notes").unwrap();

        assert_eq!(
            normalize_blender_path("   "),
            Err("Please provide a Blender executable path.".to_string())
        );
        assert_eq!(
            normalize_blender_path(other_file.to_str().unwrap()),
            Err("Please point to the Blender executable or a Blender install folder.".to_string())
        );
        assert_eq!(
            normalize_root_path(other_file.to_str().unwrap()),
            Err("Scan roots must be folders.".to_string())
        );

        assert_eq!(
            normalize_blender_path(install_dir.to_str().unwrap()).unwrap(),
            executable_path.canonicalize().unwrap()
        );
        assert_eq!(
            normalize_root_path(install_dir.to_str().unwrap()).unwrap(),
            install_dir.canonicalize().unwrap()
        );
    }

    #[test]
    fn collects_recent_projects_deduplicates_and_limits_results() {
        let sandbox = TestDir::new("recent-projects");
        let install_one = sandbox.path().join("Blender 4.2");
        let install_two = sandbox.path().join("Blender 4.3");
        let extension_one = install_one.join(BLENDER_EXTENSION_DIR);
        let extension_two = install_two.join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&extension_one).unwrap();
        fs::create_dir_all(&extension_two).unwrap();

        let shared_project = sandbox.path().join("shared.blend");
        let recent_project = sandbox.path().join("recent.blend");
        let missing_project = sandbox.path().join("missing.blend");
        fs::write(&shared_project, b"").unwrap();
        fs::write(&recent_project, b"").unwrap();
        fs::write(extension_two.join("VS_THUMB_shared.jpg"), b"thumb").unwrap();

        let mut projects_one = serde_json::Map::new();
        projects_one.insert(
            path_to_string(&shared_project),
            serde_json::Value::String("2026-03-20 10:00:00".to_string()),
        );
        projects_one.insert(
            path_to_string(&recent_project),
            serde_json::Value::String("2026-03-21 09:00:00".to_string()),
        );
        projects_one.insert(
            " ".to_string(),
            serde_json::Value::String("2026-03-19 00:00:00".to_string()),
        );

        let mut projects_two = serde_json::Map::new();
        projects_two.insert(
            path_to_string(&shared_project),
            serde_json::Value::String("2026-03-22 08:00:00".to_string()),
        );
        projects_two.insert(
            path_to_string(&missing_project),
            serde_json::Value::String("2026-03-23 08:00:00".to_string()),
        );

        fs::write(
            extension_one.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({ "lastOpen": null, "blenderProjects": projects_one }).to_string(),
        )
        .unwrap();
        fs::write(
            extension_two.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({ "lastOpen": null, "blenderProjects": projects_two }).to_string(),
        )
        .unwrap();

        let unavailable_install = sandbox.path().join("Unavailable");
        let unavailable_extension = unavailable_install.join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&unavailable_extension).unwrap();
        fs::write(
            unavailable_extension.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({
                "blenderProjects": {
                    path_to_string(&sandbox.path().join("ignored.blend")): "2026-03-24 09:00:00"
                }
            })
            .to_string(),
        )
        .unwrap();

        let projects = collect_recent_projects(&[
            make_installed_version(
                "version-42",
                "Blender 4.2",
                Some("4.2.3"),
                &install_one,
                true,
            ),
            make_installed_version(
                "version-43",
                "Blender 4.3",
                Some("4.3.0"),
                &install_two,
                true,
            ),
            make_installed_version(
                "version-unavailable",
                "Blender 3.6",
                Some("3.6.0"),
                &unavailable_install,
                false,
            ),
        ]);

        assert_eq!(projects.len(), 3);
        assert_eq!(projects[0].file_path, path_to_string(&missing_project));
        assert!(!projects[0].exists);
        assert_eq!(projects[1].file_path, path_to_string(&shared_project));
        assert_eq!(projects[1].blender_id, "version-43");
        assert_eq!(
            projects[1].thumbnail_path,
            Some(path_to_string(&extension_two.join("VS_THUMB_shared.jpg")))
        );
        assert_eq!(projects[2].file_path, path_to_string(&recent_project));

        let limited_install = sandbox.path().join("Blender 4.5");
        let limited_extension = limited_install.join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&limited_extension).unwrap();
        let mut many_projects = serde_json::Map::new();
        for index in 0..13 {
            let project_path = sandbox.path().join(format!("project-{index}.blend"));
            fs::write(&project_path, b"").unwrap();
            many_projects.insert(
                path_to_string(&project_path),
                serde_json::Value::String(format!("2026-03-{index:02} 10:00:00")),
            );
        }
        fs::write(
            limited_extension.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({ "blenderProjects": many_projects }).to_string(),
        )
        .unwrap();

        let limited_projects = collect_recent_projects(&[make_installed_version(
            "version-45",
            "Blender 4.5",
            Some("4.5.0"),
            &limited_install,
            true,
        )]);
        assert_eq!(limited_projects.len(), 12);
    }

    #[test]
    fn removes_recent_projects_from_all_matching_states() {
        let sandbox = TestDir::new("remove-recent-projects");
        let install_one = sandbox.path().join("Blender 4.2");
        let install_two = sandbox.path().join("Blender 4.3");
        let extension_one = install_one.join(BLENDER_EXTENSION_DIR);
        let extension_two = install_two.join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&extension_one).unwrap();
        fs::create_dir_all(&extension_two).unwrap();

        let missing_project = sandbox.path().join("missing.blend");
        let other_project = sandbox.path().join("other.blend");
        fs::write(&other_project, b"").unwrap();

        fs::write(
            extension_one.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({
                "blenderProjects": {
                    path_to_string(&missing_project): "2026-03-20 10:00:00",
                    path_to_string(&other_project): "2026-03-19 09:00:00"
                }
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            extension_two.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({
                "blenderProjects": {
                    path_to_string(&missing_project).replace('\\', "/"): "2026-03-21 11:00:00"
                }
            })
            .to_string(),
        )
        .unwrap();

        let versions = vec![
            make_installed_version(
                "version-42",
                "Blender 4.2",
                Some("4.2.3"),
                &install_one,
                true,
            ),
            make_installed_version(
                "version-43",
                "Blender 4.3",
                Some("4.3.0"),
                &install_two,
                true,
            ),
        ];

        remove_recent_project_entries(&versions, &path_to_string(&missing_project)).unwrap();

        let state_one =
            read_voxelshift_state(&extension_one.join(BLENDER_EXTENSION_STATE_FILE)).unwrap();
        let state_two =
            read_voxelshift_state(&extension_two.join(BLENDER_EXTENSION_STATE_FILE)).unwrap();

        assert_eq!(state_one.blender_projects.len(), 1);
        assert!(state_one
            .blender_projects
            .contains_key(&path_to_string(&other_project)));
        assert!(state_two.blender_projects.is_empty());

        let projects = collect_recent_projects(&versions);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].file_path, path_to_string(&other_project));
    }

    #[test]
    fn rejects_removing_unknown_recent_project_paths() {
        let sandbox = TestDir::new("remove-missing-recent-project");
        let install_dir = sandbox.path().join("Blender 4.2");
        let extension_dir = install_dir.join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&extension_dir).unwrap();
        fs::write(
            extension_dir.join(BLENDER_EXTENSION_STATE_FILE),
            serde_json::json!({
                "blenderProjects": {
                    path_to_string(&sandbox.path().join("known.blend")): "2026-03-20 10:00:00"
                }
            })
            .to_string(),
        )
        .unwrap();

        let versions = vec![make_installed_version(
            "version-42",
            "Blender 4.2",
            Some("4.2.3"),
            &install_dir,
            true,
        )];

        assert_eq!(
            remove_recent_project_entries(
                &versions,
                &path_to_string(&sandbox.path().join("unknown.blend"))
            ),
            Err("That recent project is no longer in the launcher history.".to_string())
        );
    }

    #[test]
    fn syncs_voxel_shift_extension_resources_only_when_files_change() {
        let sandbox = TestDir::new("sync-extension-resources");
        let install_dir = sandbox.path().join("Blender 4.2");
        let resource_dir = sandbox.path().join("resources");
        fs::create_dir_all(&resource_dir).unwrap();

        let init_path = resource_dir.join(BLENDER_EXTENSION_INIT_FILE);
        let manifest_path = resource_dir.join(BLENDER_EXTENSION_MANIFEST_FILE);
        fs::write(&init_path, "print('v1')").unwrap();
        fs::write(&manifest_path, "manifest-v1").unwrap();

        let resources = vec![
            (BLENDER_EXTENSION_INIT_FILE, init_path.clone()),
            (BLENDER_EXTENSION_MANIFEST_FILE, manifest_path.clone()),
        ];

        assert!(sync_voxel_shift_extension_resources(&install_dir, &resources).unwrap());
        assert_eq!(
            fs::read_to_string(
                install_dir
                    .join(BLENDER_EXTENSION_DIR)
                    .join(BLENDER_EXTENSION_INIT_FILE)
            )
            .unwrap(),
            "print('v1')"
        );
        assert!(!sync_voxel_shift_extension_resources(&install_dir, &resources).unwrap());

        fs::write(&manifest_path, "manifest-v2").unwrap();
        assert!(sync_voxel_shift_extension_resources(&install_dir, &resources).unwrap());
        assert_eq!(
            fs::read_to_string(
                install_dir
                    .join(BLENDER_EXTENSION_DIR)
                    .join(BLENDER_EXTENSION_MANIFEST_FILE)
            )
            .unwrap(),
            "manifest-v2"
        );
    }

    #[test]
    fn bundled_extension_resource_candidates_include_updater_layout_first() {
        let candidates = bundled_extension_resource_candidates(BLENDER_EXTENSION_INIT_FILE);

        assert_eq!(
            candidates[0],
            PathBuf::from("_up_")
                .join(BUNDLED_EXTENSION_RESOURCE_DIR)
                .join(BLENDER_EXTENSION_INIT_FILE)
        );
        assert_eq!(
            candidates[1],
            PathBuf::from(BUNDLED_EXTENSION_RESOURCE_DIR).join(BLENDER_EXTENSION_INIT_FILE)
        );
        assert_eq!(candidates[2], PathBuf::from(BLENDER_EXTENSION_INIT_FILE));
    }

    #[test]
    fn reads_voxelshift_state_and_thumbnail_paths_safely() {
        let sandbox = TestDir::new("voxelshift-state");
        let extension_dir = sandbox.path().join(BLENDER_EXTENSION_DIR);
        fs::create_dir_all(&extension_dir).unwrap();
        let state_path = extension_dir.join(BLENDER_EXTENSION_STATE_FILE);

        fs::write(&state_path, "not-json").unwrap();
        assert!(read_voxelshift_state(&state_path).is_none());

        fs::write(
            &state_path,
            serde_json::json!({
                "lastOpen": "scene.blend",
                "blenderProjects": { "scene.blend": "2026-03-20 10:00:00" }
            })
            .to_string(),
        )
        .unwrap();
        assert!(read_voxelshift_state(&state_path).is_some());
        assert!(recent_project_thumbnail_path(&extension_dir, "scene").is_none());

        let thumb_path = extension_dir.join("VS_THUMB_scene.jpg");
        fs::write(&thumb_path, b"thumb").unwrap();
        assert_eq!(
            recent_project_thumbnail_path(&extension_dir, "scene"),
            Some(path_to_string(&thumb_path))
        );
    }

    #[test]
    fn compares_versions_using_numeric_segments() {
        assert_eq!(compare_version_values("4.2.10", "4.2.9"), Ordering::Greater);
        assert_eq!(compare_version_values("3.6.0", "4.0.0"), Ordering::Less);
        assert_eq!(version_key(Some("4.2.beta")), vec![4, 2]);
        assert!(is_version_at_least("4.2", 4, 2));
    }

    #[test]
    fn validates_install_requests_for_the_current_platform() {
        let platform =
            current_release_platform().expect("current platform should be supported in tests");
        let request = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!("blender-4.2.3{}", platform.file_suffix),
            url: format!(
                "https://download.blender.org/release/Blender4.2/blender-4.2.3{}",
                platform.file_suffix
            ),
        };

        assert!(validate_install_request(&request).is_ok());
        assert!(file_name_matches_platform(&request.file_name, &platform));
        assert!(is_official_blender_download_url(&request.url));
        assert!(is_supported_release_archive(&request.file_name));
    }

    #[test]
    fn rejects_invalid_install_requests() {
        let platform =
            current_release_platform().expect("current platform should be supported in tests");
        let wrong_suffix = if platform.file_suffix.ends_with(".zip") {
            "-linux-x64.tar.xz"
        } else {
            "-windows-x64.zip"
        };

        let missing_url = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!("blender-4.2.3{}", platform.file_suffix),
            url: String::new(),
        };
        assert_eq!(
            validate_install_request(&missing_url),
            Err("The release download URL is missing.".to_string())
        );

        let missing_file_name = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: String::new(),
            url: "https://download.blender.org/release/Blender4.2/blender.zip".to_string(),
        };
        assert_eq!(
            validate_install_request(&missing_file_name),
            Err("The release file name is missing.".to_string())
        );

        let unofficial = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!("blender-4.2.3{}", platform.file_suffix),
            url: "https://example.com/blender-4.2.3.zip".to_string(),
        };
        assert_eq!(
            validate_install_request(&unofficial),
            Err(
                "Only official Blender downloads from blender.org can be installed automatically."
                    .to_string()
            )
        );

        let wrong_platform = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!("blender-4.2.3{wrong_suffix}"),
            url: format!(
                "https://download.blender.org/release/Blender4.2/blender-4.2.3{wrong_suffix}"
            ),
        };
        assert!(matches!(
            validate_install_request(&wrong_platform),
            Err(message) if message.contains("does not match the current platform")
        ));
        assert!(!file_name_matches_platform(
            &wrong_platform.file_name,
            &platform
        ));
        assert!(is_zip_archive("file.zip"));
        assert!(is_tar_xz_archive("file.tar.xz"));
        assert!(!is_supported_release_archive("file.dmg"));
    }

    #[test]
    fn sorts_versions_by_priority_before_name() {
        let mut versions = vec![
            make_version("Blender 4.0", Some("4.0.0"), true, false),
            make_version("Blender 4.2", Some("4.2.0"), true, true),
            make_version("Blender 4.1", Some("4.1.0"), false, false),
        ];

        versions.sort_by(version_sort);

        assert_eq!(versions[0].display_name, "Blender 4.2");
        assert_eq!(versions[1].display_name, "Blender 4.0");
        assert_eq!(versions[2].display_name, "Blender 4.1");
    }

    #[test]
    fn generates_case_insensitive_ids_for_paths_and_urls() {
        assert_eq!(
            make_release_id("HTTPS://DOWNLOAD.BLENDER.ORG/RELEASE/BLENDER4.2/FILE.ZIP"),
            make_release_id("https://download.blender.org/release/blender4.2/file.zip")
        );
        assert_eq!(
            make_recent_project_id("D:/Projects/Shot.blend"),
            make_recent_project_id("d:/projects/shot.blend")
        );
        assert_eq!(
            make_version_id(Path::new("D:/Apps/Blender/blender.exe")),
            make_version_id(Path::new("d:/apps/blender/BLENDER.EXE"))
        );
    }

    #[test]
    fn splits_command_lines_while_preserving_quoted_segments() {
        assert_eq!(
            split_command_line("\"C:\\Program Files\\Blender\\blender.exe\" --factory-startup"),
            vec![
                "C:\\Program Files\\Blender\\blender.exe".to_string(),
                "--factory-startup".to_string()
            ]
        );
        assert_eq!(
            split_command_line("--background   scene.blend"),
            vec!["--background", "scene.blend"]
        );
    }

    #[test]
    fn tracks_active_and_canceled_release_installs() {
        let control = ReleaseInstallControl::default();

        assert!(control.begin("release-1").is_ok());
        assert_eq!(
            control.begin("release-1"),
            Err("That release is already being installed.".to_string())
        );
        assert_eq!(control.request_cancel("release-1").unwrap(), true);
        assert!(control.is_cancel_requested("release-1").unwrap());
        assert!(control.finish("release-1").is_ok());
        assert_eq!(control.request_cancel("release-1").unwrap(), false);
    }

    #[test]
    fn trims_values_and_normalizes_release_folder_names() {
        assert_eq!(
            trim_to_option("  Blender  ".to_string()),
            Some("Blender".to_string())
        );
        assert_eq!(trim_to_option("   ".to_string()), None);
        assert_eq!(
            release_folder_name(" blender-4.2.3-windows-x64.zip "),
            "blender-4.2.3-windows-x64"
        );
        assert!(eq_ignore_case("VoxelShift", "voxelshift"));
        assert!(current_timestamp() > 0);
        assert_eq!(
            path_to_string(Path::new("test/scene.blend")),
            "test/scene.blend".to_string()
        );
        assert_eq!(experimental_platform_rank("windows"), 0);
    }
    #[test]
    fn remembers_launched_versions_for_existing_and_new_entries() {
        let version = make_version("Blender 4.2", Some("4.2.0"), true, false);
        let mut stored = StoredState {
            default_id: None,
            scan_roots: vec![],
            tracked_versions: vec![TrackedVersion {
                id: version.id.clone(),
                executable_path: version.executable_path.clone(),
                display_name: Some(version.display_name.clone()),
                source: version.source.clone(),
                last_launched_at: None,
            }],
        };

        remember_launched_version(&mut stored, &version);
        assert!(stored.tracked_versions[0].last_launched_at.is_some());

        let new_version = BlenderVersion {
            id: "version-new".to_string(),
            display_name: " Blender Nightly ".to_string(),
            version: Some("4.3.0".to_string()),
            executable_path: "/apps/nightly/blender".to_string(),
            install_dir: "/apps/nightly".to_string(),
            source: VersionSource::Discovered,
            available: true,
            is_default: false,
            last_launched_at: None,
        };

        remember_launched_version(&mut stored, &new_version);

        let added = stored
            .tracked_versions
            .iter()
            .find(|tracked| tracked.id == "version-new")
            .unwrap();
        assert_eq!(added.display_name.as_deref(), Some("Blender Nightly"));
        assert!(added.last_launched_at.is_some());
    }

    #[test]
    fn finalizes_extracted_releases_from_root_and_nested_archives() {
        let sandbox = TestDir::new("finalize-release");
        let stable_dir = sandbox.path().join("stable");
        fs::create_dir_all(&stable_dir).unwrap();

        let extraction_dir = sandbox.path().join("extract-root");
        fs::create_dir_all(&extraction_dir).unwrap();
        fs::write(extraction_dir.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();

        let request = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!(
                "blender-4.2.3{}",
                current_release_platform().unwrap().file_suffix
            ),
            url: "https://download.blender.org/release/Blender4.2/blender.zip".to_string(),
        };

        let final_dir = finalize_extracted_release(&request, &extraction_dir, &stable_dir).unwrap();
        assert!(final_dir.exists());
        assert!(final_dir.join(BLENDER_EXECUTABLE_NAME).exists());

        let nested_extraction = sandbox.path().join("extract-nested");
        let nested_root = nested_extraction.join("blender-4.3.0");
        fs::create_dir_all(&nested_root).unwrap();
        fs::write(nested_root.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();

        let nested_request = InstallReleaseRequest {
            id: "release-2".to_string(),
            version: "4.3.0".to_string(),
            file_name: format!(
                "blender-4.3.0{}",
                current_release_platform().unwrap().file_suffix
            ),
            url: "https://download.blender.org/release/Blender4.3/blender.zip".to_string(),
        };

        let nested_final_dir =
            finalize_extracted_release(&nested_request, &nested_extraction, &stable_dir).unwrap();
        assert_eq!(
            nested_final_dir
                .file_name()
                .and_then(|value| value.to_str()),
            Some("blender-4.3.0")
        );
    }

    #[test]
    fn rejects_invalid_finalized_release_layouts() {
        let sandbox = TestDir::new("finalize-release-errors");
        let stable_dir = sandbox.path().join("stable");
        fs::create_dir_all(&stable_dir).unwrap();

        let request = InstallReleaseRequest {
            id: "release-1".to_string(),
            version: "4.2.3".to_string(),
            file_name: format!(
                "blender-4.2.3{}",
                current_release_platform().unwrap().file_suffix
            ),
            url: "https://download.blender.org/release/Blender4.2/blender.zip".to_string(),
        };

        let missing_exec_dir = sandbox.path().join("missing-exec");
        fs::create_dir_all(&missing_exec_dir).unwrap();
        assert_eq!(
            finalize_extracted_release(&request, &missing_exec_dir, &stable_dir),
            Err("The downloaded archive did not contain the Blender executable.".to_string())
        );

        let conflicting_extract_dir = sandbox.path().join("conflict");
        fs::create_dir_all(&conflicting_extract_dir).unwrap();
        fs::write(conflicting_extract_dir.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();
        fs::create_dir_all(stable_dir.join("conflict")).unwrap();
        assert!(matches!(
            finalize_extracted_release(&request, &conflicting_extract_dir, &stable_dir),
            Err(message) if message.contains("The install folder already exists")
        ));
    }
    #[test]
    fn merges_launcher_state_with_manual_overrides_and_defaults() {
        let sandbox = TestDir::new("merge-launcher-state");
        let discovered_dir = sandbox.path().join("Discovered 4.2");
        let tracked_only_dir = sandbox.path().join("Tracked Only");
        fs::create_dir_all(&discovered_dir).unwrap();
        fs::write(discovered_dir.join(BLENDER_EXECUTABLE_NAME), b"").unwrap();

        let discovered_path = discovered_dir.join(BLENDER_EXECUTABLE_NAME);
        let tracked_missing_path = tracked_only_dir.join(BLENDER_EXECUTABLE_NAME);
        let discovered_id = make_version_id(&discovered_path);
        let tracked_only_id = make_version_id(&tracked_missing_path);

        let stored = StoredState {
            default_id: Some(discovered_id.clone()),
            scan_roots: vec!["D:/Custom".to_string()],
            tracked_versions: vec![
                TrackedVersion {
                    id: discovered_id.clone(),
                    executable_path: path_to_string(&discovered_path),
                    display_name: Some("  Manual Name  ".to_string()),
                    source: VersionSource::Manual,
                    last_launched_at: Some(44),
                },
                TrackedVersion {
                    id: tracked_only_id.clone(),
                    executable_path: path_to_string(&tracked_missing_path),
                    display_name: None,
                    source: VersionSource::Manual,
                    last_launched_at: Some(12),
                },
            ],
        };

        let discovered = vec![BlenderVersion {
            id: discovered_id.clone(),
            display_name: "Discovered Name".to_string(),
            version: Some("4.2.3".to_string()),
            executable_path: path_to_string(&discovered_path),
            install_dir: path_to_string(&discovered_dir),
            source: VersionSource::Discovered,
            available: true,
            is_default: false,
            last_launched_at: None,
        }];

        let state = merge_launcher_state(&stored, discovered, 99);
        assert_eq!(state.detected_at, 99);
        assert_eq!(state.scan_roots, vec!["D:/Custom".to_string()]);
        assert_eq!(state.versions.len(), 2);

        let default_version = state
            .versions
            .iter()
            .find(|version| version.id == discovered_id)
            .unwrap();
        assert_eq!(default_version.display_name, "Manual Name");
        assert_eq!(default_version.source, VersionSource::Manual);
        assert!(default_version.available);
        assert!(default_version.is_default);
        assert_eq!(default_version.last_launched_at, Some(44));

        let tracked_only_version = state
            .versions
            .iter()
            .find(|version| version.id == tracked_only_id)
            .unwrap();
        assert!(!tracked_only_version.available);
        assert_eq!(tracked_only_version.version, None);
        assert_eq!(tracked_only_version.last_launched_at, Some(12));
    }

    #[test]
    fn mutates_scan_roots_case_insensitively() {
        let mut scan_roots = vec!["D:/Beta".to_string(), "D:/alpha".to_string()];

        assert!(!add_scan_root_value(
            &mut scan_roots,
            "d:/ALPHA".to_string()
        ));
        assert!(add_scan_root_value(&mut scan_roots, "D:/Gamma".to_string()));
        assert_eq!(
            scan_roots,
            vec![
                "D:/alpha".to_string(),
                "D:/Beta".to_string(),
                "D:/Gamma".to_string()
            ]
        );
        assert!(remove_scan_root_value(&mut scan_roots, "d:/beta"));
        assert!(!remove_scan_root_value(&mut scan_roots, "d:/missing"));
        assert_eq!(
            scan_roots,
            vec!["D:/alpha".to_string(), "D:/Gamma".to_string()]
        );
    }

    #[test]
    fn resolves_launch_versions_and_project_paths() {
        let sandbox = TestDir::new("launch-validation");
        let project_path = sandbox.path().join("scene.blend");
        fs::write(&project_path, b"").unwrap();

        let available = make_version("Blender 4.2", Some("4.2.0"), true, false);
        let unavailable = make_version("Blender 4.1", Some("4.1.0"), false, false);

        assert_eq!(
            resolve_launch_version(&[available.clone()], &available.id)
                .unwrap()
                .id,
            available.id
        );
        assert_eq!(
            resolve_launch_version(&[unavailable], "id-Blender 4.1").unwrap_err(),
            "That Blender executable is missing.".to_string()
        );
        assert_eq!(
            resolve_launch_version(&[available], "missing").unwrap_err(),
            "Could not find that Blender version.".to_string()
        );

        assert_eq!(
            validate_project_launch_path("   "),
            Err("The Blender project path is missing.".to_string())
        );
        assert_eq!(
            validate_project_launch_path(sandbox.path().join("missing.blend").to_str().unwrap()),
            Err("That Blender project file could not be found.".to_string())
        );
        assert_eq!(
            validate_project_launch_path(project_path.to_str().unwrap()).unwrap(),
            project_path
        );
    }
    #[test]
    fn normalizes_and_resolves_blender_config_names() {
        assert_eq!(
            normalize_blender_config_name("  Blender:4.2?  ", "4.2.3").unwrap(),
            "Blender-4.2-".to_string()
        );
        assert_eq!(
            normalize_blender_config_name("   ", "4.2.3").unwrap(),
            "4.2.3".to_string()
        );

        let sandbox = TestDir::new("config-resolve");
        let configs_dir = sandbox.path().join("configs");
        let config_dir = configs_dir.join("Studio Config");
        fs::create_dir_all(&config_dir).unwrap();

        assert_eq!(
            resolve_blender_config_path(&configs_dir, "studio config").unwrap(),
            config_dir
        );
    }

    #[test]
    fn saves_lists_and_applies_blender_configs() {
        let sandbox = TestDir::new("blender-configs");
        let source_dir = sandbox
            .path()
            .join("Blender 4.2")
            .join("portable")
            .join("config");
        fs::create_dir_all(source_dir.join("scripts").join("startup")).unwrap();
        fs::write(source_dir.join("userpref.blend"), b"userpref").unwrap();
        fs::write(
            source_dir.join("scripts").join("startup").join("theme.py"),
            b"theme",
        )
        .unwrap();

        let configs_dir = sandbox.path().join("configs");
        let config_name = normalize_blender_config_name("  Blender:4.2?  ", "4.2.3").unwrap();
        let saved = save_blender_config_snapshot(&source_dir, &configs_dir, &config_name).unwrap();
        assert_eq!(saved.name, config_name.as_str());

        let listed = list_blender_configs(&configs_dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);

        let target_dir = sandbox
            .path()
            .join("Blender 4.3")
            .join("portable")
            .join("config");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("old.txt"), b"old").unwrap();

        apply_blender_config_snapshot(&configs_dir.join(&config_name), &target_dir).unwrap();

        assert_eq!(
            fs::read(target_dir.join("userpref.blend")).unwrap(),
            b"userpref"
        );
        assert_eq!(
            fs::read(target_dir.join("scripts").join("startup").join("theme.py")).unwrap(),
            b"theme"
        );
        assert!(!target_dir.join("old.txt").exists());
        assert!(matches!(
            save_blender_config_snapshot(&sandbox.path().join("missing"), &configs_dir, "4.2"),
            Err(message) if message == "No portable config folder was found for this Blender install yet."
        ));
    }

    #[test]
    fn removes_saved_blender_configs() {
        let sandbox = TestDir::new("remove-blender-config");
        let configs_dir = sandbox.path().join("configs");
        let config_dir = configs_dir.join("Studio");
        fs::create_dir_all(config_dir.join("scripts")).unwrap();
        fs::write(config_dir.join("userpref.blend"), b"userpref").unwrap();

        remove_blender_config_snapshot(&configs_dir, "studio").unwrap();
        assert!(!config_dir.exists());
        assert!(matches!(
            remove_blender_config_snapshot(&configs_dir, "missing"),
            Err(message) if message == "That saved config could not be found."
        ));
    }
    #[test]
    fn config_name_helpers_and_profiles_cover_edge_cases() {
        let version = make_version(" Blender Daily ", None, true, false);
        assert_eq!(default_blender_config_name(&version), "Blender Daily");
        assert_eq!(
            sanitize_blender_config_folder_name(" .. Studio/Config* .. "),
            "Studio-Config-".to_string()
        );
        assert_eq!(
            normalize_blender_config_name(" .. ", "   "),
            Err("Please provide a valid config name.".to_string())
        );
        assert!(matches!(
            build_blender_config_profile(Path::new("")),
            Err(message) if message.contains("invalid")
        ));
        assert_eq!(directory_modified_timestamp(Path::new("missing-config")), 0);
    }

    #[test]
    fn config_listing_and_resolution_ignore_files_and_sort_newest_first() {
        let sandbox = TestDir::new("config-listing");
        let configs_dir = sandbox.path().join("configs");
        fs::create_dir_all(&configs_dir).unwrap();
        fs::write(configs_dir.join("README.txt"), b"note").unwrap();

        let older_dir = configs_dir.join("Alpha");
        fs::create_dir_all(&older_dir).unwrap();
        std::thread::sleep(Duration::from_millis(1100));
        let newer_dir = configs_dir.join("Beta");
        fs::create_dir_all(&newer_dir).unwrap();

        let listed = list_blender_configs(&configs_dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "Beta");
        assert_eq!(listed[1].id, "Alpha");
        assert!(list_blender_configs(&sandbox.path().join("missing"))
            .unwrap()
            .is_empty());
        assert_eq!(
            resolve_blender_config_path(&configs_dir, "beta").unwrap(),
            newer_dir
        );
        assert_eq!(
            resolve_blender_config_path(&configs_dir, "README.txt"),
            Err("That saved config could not be found.".to_string())
        );
    }

    #[test]
    fn config_snapshot_helpers_replace_existing_targets_and_validate_inputs() {
        let sandbox = TestDir::new("config-snapshot-helpers");
        let source_dir = sandbox
            .path()
            .join("source")
            .join("portable")
            .join("config");
        fs::create_dir_all(source_dir.join("scripts").join("startup")).unwrap();
        fs::write(source_dir.join("userpref.blend"), b"userpref").unwrap();
        fs::write(
            source_dir.join("scripts").join("startup").join("theme.py"),
            b"theme",
        )
        .unwrap();

        let configs_dir = sandbox.path().join("configs");
        let existing_dir = configs_dir.join("Studio");
        fs::create_dir_all(&existing_dir).unwrap();
        fs::write(existing_dir.join("old.txt"), b"old").unwrap();

        let saved = save_blender_config_snapshot(&source_dir, &configs_dir, "Studio").unwrap();
        assert_eq!(saved.id, "Studio");
        assert!(!existing_dir.join("old.txt").exists());

        let applied_target = sandbox
            .path()
            .join("target")
            .join("portable")
            .join("config");
        apply_blender_config_snapshot(&configs_dir.join("Studio"), &applied_target).unwrap();
        assert_eq!(
            fs::read(applied_target.join("userpref.blend")).unwrap(),
            b"userpref"
        );
        assert_eq!(
            fs::read(
                applied_target
                    .join("scripts")
                    .join("startup")
                    .join("theme.py")
            )
            .unwrap(),
            b"theme"
        );
        assert_eq!(
            apply_blender_config_snapshot(&sandbox.path().join("missing"), &applied_target),
            Err("That saved config could not be found.".to_string())
        );
        assert_eq!(
            resolve_blender_config_path(&configs_dir, "   "),
            Err("The saved config is missing.".to_string())
        );
        assert!(matches!(
            copy_directory_contents(&sandbox.path().join("missing-source"), &applied_target),
            Err(message) if message.contains("The config source directory is missing")
        ));
    }

    fn spawn_finished_child() -> Child {
        #[cfg(target_os = "windows")]
        let mut child = Command::new("cmd")
            .args(["/C", "exit 0"])
            .spawn()
            .expect("test child process should spawn");

        #[cfg(not(target_os = "windows"))]
        let mut child = Command::new("sh")
            .args(["-c", "true"])
            .spawn()
            .expect("test child process should spawn");

        child
            .wait()
            .expect("test child process should exit cleanly");
        child
    }

    fn make_running_process(
        instance_id: &str,
        pid: u32,
        started_at: u64,
        is_stopping: bool,
    ) -> ManagedBlenderProcess {
        ManagedBlenderProcess {
            info: RunningBlenderProcess {
                instance_id: instance_id.to_string(),
                blender_id: format!("blender-{instance_id}"),
                blender_display_name: format!("Blender {instance_id}"),
                blender_version: Some("4.2.3".to_string()),
                pid,
                started_at,
                project_path: Some(format!("D:/Projects/{instance_id}.blend")),
                is_stopping,
            },
            child: Arc::new(Mutex::new(spawn_finished_child())),
            logs: VecDeque::new(),
            next_log_index: 0,
        }
    }

    #[test]
    fn running_blender_registry_tracks_process_lifecycle_and_sorting() {
        let registry = RunningBlenderRegistry::default();
        registry
            .insert(make_running_process("older", 300, 10, false))
            .unwrap();
        registry
            .insert(make_running_process("newer", 200, 30, false))
            .unwrap();
        registry
            .insert(make_running_process("same-time", 100, 30, false))
            .unwrap();

        let stored = registry
            .get("older")
            .unwrap()
            .expect("process should be stored");
        assert_eq!(stored.lock().unwrap().info.blender_id, "blender-older");
        assert!(registry.get("missing").unwrap().is_none());

        let listed = registry.list().unwrap();
        let instance_ids = listed
            .iter()
            .map(|process| process.instance_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(instance_ids, vec!["same-time", "newer", "older"]);

        assert_eq!(registry.set_stopping("older", true).unwrap(), true);
        assert!(
            registry
                .get("older")
                .unwrap()
                .unwrap()
                .lock()
                .unwrap()
                .info
                .is_stopping
        );
        assert_eq!(registry.set_stopping("missing", true).unwrap(), false);

        assert_eq!(registry.remove("older").unwrap(), true);
        assert!(registry.get("older").unwrap().is_none());
        assert_eq!(registry.remove("older").unwrap(), false);
    }

    #[test]
    fn running_blender_registry_logs_trim_messages_and_handle_missing_processes() {
        let registry = RunningBlenderRegistry::default();
        registry
            .insert(make_running_process("session-1", 101, 42, false))
            .unwrap();

        assert!(registry
            .append_log("session-1", "stdout", " \r\n")
            .unwrap()
            .is_none());
        assert!(registry
            .append_log("missing", "stdout", "hello")
            .unwrap()
            .is_none());

        let first = registry
            .append_log("session-1", "stdout", "hello world\r\n")
            .unwrap()
            .expect("non-empty log should be appended");
        assert_eq!(first.id, "session-1-0");
        assert_eq!(first.message, "hello world");

        let second = registry
            .append_log("session-1", "stderr", "second line\n")
            .unwrap()
            .expect("second log should be appended");
        assert_eq!(second.id, "session-1-1");

        let logs = registry.logs("session-1").unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].source, "stdout");
        assert_eq!(logs[1].source, "stderr");
        assert!(matches!(
            registry.logs("missing"),
            Err(message) if message == "That Blender session is no longer running."
        ));
    }

    #[test]
    fn running_blender_registry_discards_oldest_logs_after_limit() {
        let registry = RunningBlenderRegistry::default();
        registry
            .insert(make_running_process("buffered", 202, 77, false))
            .unwrap();

        for index in 0..(MAX_RUNNING_BLENDER_LOG_LINES + 2) {
            registry
                .append_log("buffered", "stdout", &format!("line {index}\n"))
                .unwrap();
        }

        let logs = registry.logs("buffered").unwrap();
        assert_eq!(logs.len(), MAX_RUNNING_BLENDER_LOG_LINES);
        assert_eq!(logs.first().unwrap().message, "line 2");
        assert_eq!(logs.first().unwrap().id, "buffered-2");
        assert_eq!(
            logs.last().unwrap().message,
            format!("line {}", MAX_RUNNING_BLENDER_LOG_LINES + 1)
        );
    }

    #[test]
    fn restorable_window_position_skips_minimized_window_sentinel() {
        assert_eq!(
            restorable_window_position(Some(StoredWindowPosition { x: 140, y: 80 })),
            Some(StoredWindowPosition { x: 140, y: 80 })
        );
        assert_eq!(
            restorable_window_position(Some(StoredWindowPosition {
                x: MINIMIZED_WINDOW_SENTINEL,
                y: MINIMIZED_WINDOW_SENTINEL,
            })),
            None
        );
        assert_eq!(restorable_window_position(None), None);
    }

    #[test]
    fn copy_directory_contents_copies_nested_files_and_overwrites_existing_targets() {
        let sandbox = TestDir::new("copy-directory-contents");
        let source_dir = sandbox.path().join("source");
        let target_dir = sandbox.path().join("target");

        fs::create_dir_all(source_dir.join("scripts").join("startup")).unwrap();
        fs::write(source_dir.join("userpref.blend"), b"fresh-userpref").unwrap();
        fs::write(
            source_dir.join("scripts").join("startup").join("theme.py"),
            b"fresh-theme",
        )
        .unwrap();

        fs::create_dir_all(target_dir.join("scripts")).unwrap();
        fs::write(target_dir.join("userpref.blend"), b"stale-userpref").unwrap();
        fs::write(target_dir.join("scripts").join("keep.py"), b"keep").unwrap();

        copy_directory_contents(&source_dir, &target_dir).unwrap();

        assert_eq!(
            fs::read(target_dir.join("userpref.blend")).unwrap(),
            b"fresh-userpref"
        );
        assert_eq!(
            fs::read(target_dir.join("scripts").join("startup").join("theme.py")).unwrap(),
            b"fresh-theme"
        );
        assert_eq!(
            fs::read(target_dir.join("scripts").join("keep.py")).unwrap(),
            b"keep"
        );
        assert!(matches!(
            copy_directory_contents(&source_dir.join("userpref.blend"), &target_dir),
            Err(message) if message.contains("The config source directory is missing")
        ));
    }

    fn start_test_http_server(
        status_line: &str,
        body: &[u8],
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("test HTTP server should bind to a local port");
        let address = listener
            .local_addr()
            .expect("test HTTP server should expose its address");
        let status_line = status_line.to_string();
        let body = body.to_vec();

        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("test HTTP server should accept a request");
            let mut request = [0_u8; 1024];
            let _ = std::io::Read::read(&mut stream, &mut request);

            let headers = format!(
                "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(headers.as_bytes())
                .expect("test HTTP server should write response headers");
            stream
                .write_all(&body)
                .expect("test HTTP server should write response body");
        });

        (format!("http://{address}/download"), handle)
    }

    fn make_install_request(id: &str, file_name: &str, url: &str) -> InstallReleaseRequest {
        InstallReleaseRequest {
            id: id.to_string(),
            version: "4.2.3".to_string(),
            file_name: file_name.to_string(),
            url: url.to_string(),
        }
    }

    #[derive(Clone, Default)]
    struct TestProgressEmitter;

    impl ReleaseInstallProgressEmitter for TestProgressEmitter {
        fn emit_release_install_progress(&self, _progress: ReleaseInstallProgress) {}
    }
    fn write_zip_archive(entries: &[(String, Option<&[u8]>)], archive_path: &Path) {
        let archive_file = fs::File::create(archive_path).expect("zip archive should be created");
        let mut archive = zip::ZipWriter::new(archive_file);
        let options = zip::write::FileOptions::default();

        for (path, contents) in entries {
            match contents {
                Some(contents) => {
                    archive
                        .start_file(path.clone(), options)
                        .expect("zip archive should include a file entry");
                    archive
                        .write_all(contents)
                        .expect("zip archive file entry should be written");
                }
                None => {
                    archive
                        .add_directory(path.clone(), options)
                        .expect("zip archive should include a directory entry");
                }
            }
        }

        archive
            .finish()
            .expect("zip archive should finalize cleanly");
    }

    #[test]
    fn fetch_text_reads_success_bodies_and_reports_http_errors() {
        let client = reqwest::Client::new();
        let (ok_url, ok_server) = start_test_http_server("200 OK", b"hello from voxel shift");
        let ok_body = tauri::async_runtime::block_on(fetch_text(&client, &ok_url))
            .expect("successful response body should be returned");
        ok_server.join().unwrap();
        assert_eq!(ok_body, "hello from voxel shift");

        let (error_url, error_server) = start_test_http_server("500 Internal Server Error", b"");
        let error = tauri::async_runtime::block_on(fetch_text(&client, &error_url))
            .expect_err("non-success status should be reported as an error");
        error_server.join().unwrap();
        assert!(error.contains("unexpected status: 500 Internal Server Error"));
    }

    #[test]
    fn download_release_archive_writes_response_bytes_to_disk() {
        let app = TestProgressEmitter::default();
        let request_body = b"downloaded-blender-archive";
        let (url, server) = start_test_http_server("200 OK", request_body);
        let request =
            make_install_request("download-success", "blender-4.2.3-windows-x64.zip", &url);
        let control = ReleaseInstallControl::default();
        let sandbox = TestDir::new("download-release-archive");
        let archive_path = sandbox.path().join("download.zip");

        tauri::async_runtime::block_on(download_release_archive(
            &app,
            &control,
            &request,
            &archive_path,
        ))
        .expect("download helper should write a successful response to disk");
        server.join().unwrap();

        assert_eq!(fs::read(&archive_path).unwrap(), request_body);
    }

    #[test]
    fn extract_release_archive_installs_zip_releases() {
        let app = TestProgressEmitter::default();
        let sandbox = TestDir::new("extract-release-archive-success");
        let archive_path = sandbox.path().join("blender-4.2.3-windows-x64.zip");
        write_zip_archive(
            &[
                ("blender-4.2.3-windows-x64/".to_string(), None),
                (
                    format!("blender-4.2.3-windows-x64/{BLENDER_EXECUTABLE_NAME}"),
                    Some(b"binary"),
                ),
                (
                    "blender-4.2.3-windows-x64/scripts/startup/theme.py".to_string(),
                    Some(b"theme"),
                ),
            ],
            &archive_path,
        );

        let control = ReleaseInstallControl::default();
        let request = make_install_request(
            "extract-success",
            "blender-4.2.3-windows-x64.zip",
            "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
        );
        let stable_dir = sandbox.path().join("stable");
        let temp_dir = sandbox.path().join("temp");
        fs::create_dir_all(&stable_dir).unwrap();
        fs::create_dir_all(temp_dir.join("extract")).unwrap();
        fs::write(temp_dir.join("extract").join("stale.txt"), b"stale").unwrap();

        let final_dir = tauri::async_runtime::block_on(extract_release_archive(
            &app,
            control,
            &request,
            &archive_path,
            &stable_dir,
            &temp_dir,
        ))
        .expect("zip extraction helper should install the release into the stable directory");

        assert_eq!(final_dir, stable_dir.join("blender-4.2.3-windows-x64"));
        assert_eq!(
            fs::read(final_dir.join(BLENDER_EXECUTABLE_NAME)).unwrap(),
            b"binary"
        );
        assert_eq!(
            fs::read(final_dir.join("scripts").join("startup").join("theme.py")).unwrap(),
            b"theme"
        );
        assert!(!temp_dir.join("extract").join("stale.txt").exists());
    }

    #[test]
    fn extract_release_archive_rejects_unsupported_archive_types() {
        let app = TestProgressEmitter::default();
        let sandbox = TestDir::new("extract-release-archive-unsupported");
        let archive_path = sandbox.path().join("blender-4.2.3.dmg");
        fs::write(&archive_path, b"not-a-supported-archive").unwrap();

        let error = tauri::async_runtime::block_on(extract_release_archive(
            &app,
            ReleaseInstallControl::default(),
            &make_install_request(
                "extract-unsupported",
                "blender-4.2.3.dmg",
                "https://download.blender.org/release/Blender4.2/blender-4.2.3.dmg",
            ),
            &archive_path,
            &sandbox.path().join("stable"),
            &sandbox.path().join("temp"),
        ))
        .expect_err("unsupported archive extensions should be rejected");

        assert_eq!(
            error,
            "Automatic installs currently support .zip and .tar.xz Blender releases only."
        );
    }

    #[test]
    fn extract_zip_release_archive_rejects_invalid_entry_paths() {
        let app = TestProgressEmitter::default();
        let sandbox = TestDir::new("extract-zip-invalid-entry");
        let archive_path = sandbox.path().join("invalid.zip");
        write_zip_archive(&[("../evil.txt".to_string(), Some(b"evil"))], &archive_path);

        let error = extract_zip_release_archive(
            &app,
            &ReleaseInstallControl::default(),
            &make_install_request(
                "zip-invalid-path",
                "blender-4.2.3-windows-x64.zip",
                "https://download.blender.org/release/Blender4.2/blender-4.2.3-windows-x64.zip",
            ),
            &archive_path,
            &sandbox.path().join("extract"),
        )
        .expect_err("zip entries with parent traversal should be rejected");

        assert!(error.contains("has an invalid path"));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn extract_tar_xz_release_archive_reports_platform_limit() {
        let app = TestProgressEmitter::default();
        let sandbox = TestDir::new("extract-tar-xz-platform-limit");

        let error = extract_tar_xz_release_archive(
            &app,
            &ReleaseInstallControl::default(),
            &make_install_request(
                "tar-platform-limit",
                "blender-4.2.3-linux-x64.tar.xz",
                "https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz",
            ),
            &sandbox.path().join("archive.tar.xz"),
            &sandbox.path().join("extract"),
        )
        .expect_err("non-Linux builds should reject tar.xz extraction");

        assert_eq!(
            error,
            "Linux tar.xz release extraction is only supported on Linux builds."
        );
    }
}
