use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const PLANNER_STATE_FILE_NAME: &str = "planner-state.json";
const PLANNER_RUNS_EVENT: &str = "planner-runs-updated";
const PLANNER_LOG_EVENT: &str = "planner-log";
const MAX_PLANNER_LOG_LINES: usize = 5_000;
const PLANNER_SCHEDULER_INTERVAL_MS: u64 = 1_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PlannerRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PlannerBlenderSource {
    Library,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerBlenderTarget {
    pub(crate) source: PlannerBlenderSource,
    pub(crate) version_id: Option<String>,
    pub(crate) display_name: String,
    pub(crate) executable_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatePlannerBlenderRequest {
    pub(crate) source: PlannerBlenderSource,
    pub(crate) version_id: Option<String>,
    pub(crate) executable_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatePlannerRunRequest {
    pub(crate) blend_file_path: String,
    pub(crate) start_frame: u32,
    pub(crate) end_frame: u32,
    pub(crate) start_at: u64,
    pub(crate) output_folder_path: Option<String>,
    pub(crate) blender: CreatePlannerBlenderRequest,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedPlannerRunRequest {
    pub(crate) blend_file_path: String,
    pub(crate) start_frame: u32,
    pub(crate) end_frame: u32,
    pub(crate) start_at: u64,
    pub(crate) output_folder_path: Option<String>,
    pub(crate) blender_target: PlannerBlenderTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerRunSummary {
    id: String,
    blend_file_path: String,
    start_frame: u32,
    end_frame: u32,
    start_at: u64,
    #[serde(default)]
    output_folder_path: Option<String>,
    created_at: u64,
    started_at: Option<u64>,
    completed_at: Option<u64>,
    status: PlannerRunStatus,
    blender_target: PlannerBlenderTarget,
    current_frame: Option<u32>,
    rendered_frame_count: u32,
    average_render_time_seconds: Option<f64>,
    estimated_remaining_seconds: Option<f64>,
    pid: Option<u32>,
    last_error_message: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerLogEntry {
    id: String,
    run_id: String,
    source: String,
    message: String,
    timestamp: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerLogEventPayload {
    run_id: String,
    entry: PlannerLogEntry,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannerRunRecord {
    id: String,
    blend_file_path: String,
    start_frame: u32,
    end_frame: u32,
    start_at: u64,
    #[serde(default)]
    output_folder_path: Option<String>,
    created_at: u64,
    started_at: Option<u64>,
    completed_at: Option<u64>,
    status: PlannerRunStatus,
    blender_target: PlannerBlenderTarget,
    current_frame: Option<u32>,
    #[serde(default)]
    current_frame_started_at: Option<u64>,
    rendered_frame_count: u32,
    pid: Option<u32>,
    last_error_message: Option<String>,
    exit_code: Option<i32>,
    next_log_index: u64,
    logs: Vec<PlannerLogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlannerStoredState {
    #[serde(default)]
    runs: Vec<PlannerRunRecord>,
}

#[derive(Default)]
struct PlannerState {
    runs: Vec<PlannerRunRecord>,
    active_processes: BTreeMap<String, Arc<Mutex<Child>>>,
    dirty: bool,
    scheduler_started: bool,
}

#[derive(Clone, Default)]
pub(crate) struct PlannerRegistry {
    inner: Arc<Mutex<PlannerState>>,
}

pub(crate) fn initialize<R: tauri::Runtime>(app: &AppHandle<R>, planner: &PlannerRegistry) -> Result<(), String> {
    let mut stored = load_planner_state(app)?;
    let restored_at = current_timestamp();
    let changed = restore_running_runs(&mut stored, restored_at);

    let should_start_scheduler = {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        replace_planner_state(&mut state, stored, changed)
    };

    if changed {
        save_if_dirty(app, planner)?;
    }

    emit_planner_runs_changed(app, planner);

    if should_start_scheduler {
        spawn_scheduler(app.clone(), planner.clone());
    }

    Ok(())
}

fn restore_running_runs(stored: &mut PlannerStoredState, restored_at: u64) -> bool {
    let mut changed = false;

    for run in &mut stored.runs {
        if run.status == PlannerRunStatus::Running {
            mark_run_failed(
                run,
                restored_at,
                "Voxel Shift closed before this render finished.",
            );
            append_log_to_run(run, "system", "Voxel Shift closed before this render finished.");
            changed = true;
        }
    }

    changed
}

fn replace_planner_state(state: &mut PlannerState, stored: PlannerStoredState, changed: bool) -> bool {
    state.runs = stored.runs;
    state.active_processes.clear();
    state.dirty = changed;

    if state.scheduler_started {
        false
    } else {
        state.scheduler_started = true;
        true
    }
}

pub(crate) fn get_planner_runs(
    planner: State<'_, PlannerRegistry>,
) -> Result<Vec<PlannerRunSummary>, String> {
    list_planner_runs(planner.inner())
}

pub(crate) fn get_planner_logs(
    planner: State<'_, PlannerRegistry>,
    run_id: String,
) -> Result<Vec<PlannerLogEntry>, String> {
    planner_logs(planner.inner(), &run_id)
}

pub(crate) fn delete_planner_run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    run_id: String,
) -> Result<(), String> {
    {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        delete_planner_run_in_state(&mut state, &run_id)?;
    }

    save_if_dirty(app, planner)?;
    emit_planner_runs_changed(app, planner);
    Ok(())
}

fn delete_planner_run_in_state(state: &mut PlannerState, run_id: &str) -> Result<(), String> {
    let Some(index) = state.runs.iter().position(|run| run.id == run_id) else {
        return Err("That planner run could not be found.".to_string());
    };

    if state.runs[index].status == PlannerRunStatus::Running || state.active_processes.contains_key(run_id) {
        return Err("Running renders cannot be deleted.".to_string());
    }

    state.runs.remove(index);
    state.dirty = true;
    Ok(())
}

pub(crate) fn update_planner_run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    run_id: String,
    request: ResolvedPlannerRunRequest,
) -> Result<PlannerRunSummary, String> {
    let updated_run = {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        update_planner_run_in_state(&mut state, &run_id, request, current_timestamp())?
    };

    save_if_dirty(app, planner)?;
    emit_planner_runs_changed(app, planner);
    Ok(updated_run)
}

fn update_planner_run_in_state(
    state: &mut PlannerState,
    run_id: &str,
    request: ResolvedPlannerRunRequest,
    now: u64,
) -> Result<PlannerRunSummary, String> {
    let index = state
        .runs
        .iter()
        .position(|run| run.id == run_id)
        .ok_or_else(|| "That planner run could not be found.".to_string())?;

    if state.runs[index].status != PlannerRunStatus::Pending {
        return Err("Only pending renders can be edited.".to_string());
    }

    {
        let run = &mut state.runs[index];
        run.blend_file_path = request.blend_file_path;
        run.start_frame = request.start_frame;
        run.end_frame = request.end_frame;
        run.start_at = request.start_at;
        run.output_folder_path = request.output_folder_path;
        run.blender_target = request.blender_target;
        run.started_at = None;
        run.completed_at = None;
        run.current_frame = None;
        run.current_frame_started_at = None;
        run.rendered_frame_count = 0;
        run.pid = None;
        run.last_error_message = None;
        run.exit_code = None;
        run.next_log_index = 0;
        run.logs.clear();
    }

    state.dirty = true;
    Ok(summarize_run(&state.runs[index], now))
}

pub(crate) fn create_planner_run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    request: ResolvedPlannerRunRequest,
) -> Result<PlannerRunSummary, String> {
    let created_run = {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        create_planner_run_in_state(&mut state, request, current_timestamp())
    };

    save_if_dirty(app, planner)?;
    emit_planner_runs_changed(app, planner);
    Ok(created_run)
}

fn create_planner_run_in_state(
    state: &mut PlannerState,
    request: ResolvedPlannerRunRequest,
    created_at: u64,
) -> PlannerRunSummary {
    let run = planner_run_record(request, created_at);
    let summary = summarize_run(&run, created_at);
    state.runs.push(run);
    state.dirty = true;
    summary
}

fn planner_run_record(request: ResolvedPlannerRunRequest, created_at: u64) -> PlannerRunRecord {
    let start_at = request.start_at;
    let run_id = make_planner_run_id(&request.blend_file_path, start_at, created_at);

    PlannerRunRecord {
        id: run_id,
        blend_file_path: request.blend_file_path,
        start_frame: request.start_frame,
        end_frame: request.end_frame,
        start_at,
        output_folder_path: request.output_folder_path,
        created_at,
        started_at: None,
        completed_at: None,
        status: PlannerRunStatus::Pending,
        blender_target: request.blender_target,
        current_frame: None,
        current_frame_started_at: None,
        rendered_frame_count: 0,
        pid: None,
        last_error_message: None,
        exit_code: None,
        next_log_index: 0,
        logs: Vec::new(),
    }
}

pub(crate) fn validate_blend_file_path(value: &str) -> Result<String, String> {
    let path = validate_existing_file_path(value, "Please choose a Blender .blend file.")?;

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("blend"))
        .unwrap_or(false)
    {
        return Err("Please choose a Blender .blend file.".to_string());
    }

    Ok(path_to_string(&path))
}

pub(crate) fn validate_frame_range(start_frame: u32, end_frame: u32) -> Result<(u32, u32), String> {
    if start_frame == 0 {
        return Err("The start frame must be 1 or higher.".to_string());
    }

    if end_frame < start_frame {
        return Err("The end frame must be greater than or equal to the start frame.".to_string());
    }

    Ok((start_frame, end_frame))
}

pub(crate) fn validate_output_folder_path(value: &str) -> Result<String, String> {
    let path = validate_existing_directory_path(value, "Please choose an output folder.")?;
    Ok(path_to_string(&path))
}

pub(crate) fn validate_custom_blender_target(value: &str) -> Result<PlannerBlenderTarget, String> {
    let executable_path = validate_existing_file_path(value, "Please choose a Blender executable.")?;
    let display_name = executable_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Custom Blender")
        .to_string();

    Ok(PlannerBlenderTarget {
        source: PlannerBlenderSource::Custom,
        version_id: None,
        display_name,
        executable_path: path_to_string(&executable_path),
    })
}

pub(crate) fn pick_planner_blend_file() -> Result<Option<String>, String> {
    pick_windows_file(
        "Select a Blender project",
        "Blender files (*.blend)|*.blend|All files (*.*)|*.*",
    )
}

pub(crate) fn pick_planner_blender_executable() -> Result<Option<String>, String> {
    pick_windows_file(
        "Select Blender executable",
        "Blender executable (blender.exe)|blender.exe|Executable files (*.exe)|*.exe|All files (*.*)|*.*",
    )
}

pub(crate) fn pick_planner_output_folder() -> Result<Option<String>, String> {
    pick_windows_folder("Select output folder")
}

fn list_planner_runs(planner: &PlannerRegistry) -> Result<Vec<PlannerRunSummary>, String> {
    let now = current_timestamp();
    let mut runs = planner
        .inner
        .lock()
        .map_err(|_| "Unable to access planner state.".to_string())?
        .runs
        .iter()
        .map(|run| summarize_run(run, now))
        .collect::<Vec<_>>();

    runs.sort_by(planner_run_summary_sort);
    Ok(runs)
}

fn planner_logs(planner: &PlannerRegistry, run_id: &str) -> Result<Vec<PlannerLogEntry>, String> {
    let state = planner
        .inner
        .lock()
        .map_err(|_| "Unable to access planner state.".to_string())?;
    let run = state
        .runs
        .iter()
        .find(|run| run.id == run_id)
        .ok_or_else(|| "That planner run could not be found.".to_string())?;

    Ok(run.logs.clone())
}

fn spawn_scheduler<R: tauri::Runtime>(app: AppHandle<R>, planner: PlannerRegistry) {
    thread::spawn(move || loop {
        let due_runs = collect_due_runs(&planner);

        for run_id in due_runs {
            if let Err(error) = start_due_run(&app, &planner, &run_id) {
                eprintln!("Unable to start planner run {run_id}: {error}");
            }
        }

        if has_pending_or_running_runs(&planner) {
            emit_planner_runs_changed(&app, &planner);
        }

        let _ = save_if_dirty(&app, &planner);
        thread::sleep(Duration::from_millis(PLANNER_SCHEDULER_INTERVAL_MS));
    });
}

fn collect_due_runs(planner: &PlannerRegistry) -> Vec<String> {
    let now = current_timestamp();
    let state = match planner.inner.lock() {
        Ok(state) => state,
        Err(_) => return Vec::new(),
    };

    state
        .runs
        .iter()
        .filter(|run| run.status == PlannerRunStatus::Pending && run.start_at <= now)
        .map(|run| run.id.clone())
        .collect()
}

fn has_pending_or_running_runs(planner: &PlannerRegistry) -> bool {
    let state = match planner.inner.lock() {
        Ok(state) => state,
        Err(_) => return false,
    };

    state.runs.iter().any(|run| {
        run.status == PlannerRunStatus::Pending || run.status == PlannerRunStatus::Running
    })
}

fn resolve_start_due_run_paths(
    run: &PlannerRunRecord,
) -> Result<(String, PathBuf, Option<String>), String> {
    let blend_file = validate_blend_file_path(&run.blend_file_path)?;
    let executable_path = validate_existing_file_path(
        &run.blender_target.executable_path,
        "The selected Blender executable is unavailable.",
    )?;
    let output_folder_path = match run.output_folder_path.as_deref() {
        Some(value) => Some(blender_output_path_argument(&validate_output_folder_path(value)?)),
        None => None,
    };

    Ok((blend_file, executable_path, output_folder_path))
}

fn start_due_run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    run_id: &str,
) -> Result<(), String> {
    let run = {
        let state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        state
            .runs
            .iter()
            .find(|run| run.id == run_id)
            .cloned()
            .ok_or_else(|| "That planner run could not be found.".to_string())?
    };

    if run.status != PlannerRunStatus::Pending {
        return Ok(());
    }

    let (blend_file, executable_path, output_folder_path) = match resolve_start_due_run_paths(&run) {
        Ok(paths) => paths,
        Err(error) => {
            fail_run_before_start(app, planner, run_id, &error)?;
            return Ok(());
        }
    };

    let mut args = vec![
        "-b".to_string(),
        blend_file,
        "-s".to_string(),
        run.start_frame.to_string(),
        "-e".to_string(),
        run.end_frame.to_string(),
    ];

    if let Some(output_folder_path) = output_folder_path {
        args.push("-o".to_string());
        args.push(output_folder_path);
    }

    args.push("-a".to_string());

    let mut command = Command::new(&executable_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            fail_run_before_start(
                app,
                planner,
                run_id,
                &format!("Failed to launch Blender: {error}"),
            )?;
            return Ok(());
        }
    };

    let pid = child.id();
    let started_at = current_timestamp();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        let Some(stored_run) = state.runs.iter_mut().find(|stored_run| stored_run.id == run_id) else {
            return Err("That planner run could not be found.".to_string());
        };

        stored_run.status = PlannerRunStatus::Running;
        stored_run.started_at = Some(started_at);
        stored_run.completed_at = None;
        stored_run.pid = Some(pid);
        stored_run.last_error_message = None;
        stored_run.exit_code = None;
        stored_run.current_frame = None;
        stored_run.current_frame_started_at = None;
        stored_run.rendered_frame_count = 0;
        state.active_processes.insert(run_id.to_string(), child.clone());
        state.dirty = true;
    }

    save_if_dirty(app, planner)?;
    emit_planner_runs_changed(app, planner);
    append_log_and_emit(app, planner, run_id, "system", "Scheduled render started.")?;
    spawn_log_reader(app.clone(), planner.clone(), run_id.to_string(), "stdout", stdout);
    spawn_log_reader(app.clone(), planner.clone(), run_id.to_string(), "stderr", stderr);
    spawn_process_monitor(app.clone(), planner.clone(), run_id.to_string(), child);
    Ok(())
}

fn fail_run_before_start<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    run_id: &str,
    message: &str,
) -> Result<(), String> {
    {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        let Some(run) = state.runs.iter_mut().find(|run| run.id == run_id) else {
            return Err("That planner run could not be found.".to_string());
        };

        mark_run_failed(run, current_timestamp(), message);
        state.dirty = true;
    }

    append_log_and_emit(app, planner, run_id, "system", message)?;
    save_if_dirty(app, planner)?;
    emit_planner_runs_changed(app, planner);
    Ok(())
}

fn spawn_log_reader<R: tauri::Runtime, S>(
    app: AppHandle<R>,
    planner: PlannerRegistry,
    run_id: String,
    source: &'static str,
    stream: Option<S>,
) where
    S: std::io::Read + Send + 'static,
{
    let Some(stream) = stream else {
        return;
    };

    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if let Err(error) = append_log_and_emit(&app, &planner, &run_id, source, &line) {
                        eprintln!("Unable to track planner logs: {error}");
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("Unable to read planner logs: {error}");
                    break;
                }
            }
        }
    });
}

fn finalize_run_after_exit(
    run: &mut PlannerRunRecord,
    completed_at: u64,
    exit_code: Option<i32>,
    succeeded: bool,
) -> String {
    let exit_message = match exit_code {
        Some(code) => format!("Render finished with exit code {code}."),
        None => "Render finished.".to_string(),
    };

    run.completed_at = Some(completed_at);
    run.exit_code = exit_code;
    run.pid = None;
    if succeeded {
        run.status = PlannerRunStatus::Completed;
        run.current_frame = Some(run.end_frame);
        run.current_frame_started_at = None;
        run.rendered_frame_count = total_frames(run);
        run.last_error_message = None;
    } else {
        mark_run_failed(run, completed_at, &exit_message);
    }

    exit_message
}

fn spawn_process_monitor<R: tauri::Runtime>(
    app: AppHandle<R>,
    planner: PlannerRegistry,
    run_id: String,
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
                    let message = format!("Unable to monitor Blender: {error}");
                    let _ = fail_run_before_start(&app, &planner, &run_id, &message);
                    break;
                }
            }
        };

        if let Some(status) = status {
            let completed_at = current_timestamp();
            let exit_message = {
                let mut state = match planner.inner.lock() {
                    Ok(state) => state,
                    Err(_) => break,
                };
                let Some(run) = state.runs.iter_mut().find(|run| run.id == run_id) else {
                    break;
                };

                let exit_message = finalize_run_after_exit(
                    run,
                    completed_at,
                    status.code(),
                    status.success(),
                );
                state.active_processes.remove(&run_id);
                state.dirty = true;
                exit_message
            };

            let _ = append_log_and_emit(&app, &planner, &run_id, "system", &exit_message);
            let _ = save_if_dirty(&app, &planner);
            emit_planner_runs_changed(&app, &planner);
            break;
        }

        thread::sleep(Duration::from_millis(500));
    });
}fn append_log_and_emit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    planner: &PlannerRegistry,
    run_id: &str,
    source: &str,
    message: &str,
) -> Result<(), String> {
    let trimmed = message.trim_end_matches(|character| character == '\r' || character == '\n');
    if trimmed.trim().is_empty() {
        return Ok(());
    }

    let entry = {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;
        let Some(run) = state.runs.iter_mut().find(|run| run.id == run_id) else {
            return Err("That planner run could not be found.".to_string());
        };

        let entry = append_log_to_run(run, source, trimmed);
        state.dirty = true;
        entry
    };

    let _ = app.emit(
        PLANNER_LOG_EVENT,
        PlannerLogEventPayload {
            run_id: run_id.to_string(),
            entry,
        },
    );

    Ok(())
}

fn append_log_to_run(run: &mut PlannerRunRecord, source: &str, message: &str) -> PlannerLogEntry {
    let log_timestamp = current_timestamp();

    if let Some(frame) = parse_frame_number(message) {
        if frame >= run.start_frame && frame <= run.end_frame {
            if run.current_frame.map_or(true, |current_frame| frame > current_frame) {
                run.current_frame = Some(frame);
                run.current_frame_started_at = Some(log_timestamp);
            }

            let completed_frames = frame.saturating_sub(run.start_frame);
            if completed_frames > run.rendered_frame_count {
                run.rendered_frame_count = completed_frames.min(total_frames(run));
            }
        }
    }

    let entry = PlannerLogEntry {
        id: format!("{}-{}", run.id, run.next_log_index),
        run_id: run.id.clone(),
        source: source.to_string(),
        message: message.to_string(),
        timestamp: log_timestamp,
    };
    run.next_log_index += 1;
    run.logs.push(entry.clone());
    while run.logs.len() > MAX_PLANNER_LOG_LINES {
        run.logs.remove(0);
    }
    entry
}

fn summarize_run(run: &PlannerRunRecord, now: u64) -> PlannerRunSummary {
    let average_render_time_seconds = average_render_time_seconds(run);
    let estimated_remaining_seconds = if run.status == PlannerRunStatus::Running {
        average_render_time_seconds.map(|average| {
            let remaining_frames = total_frames(run).saturating_sub(run.rendered_frame_count);
            if remaining_frames == 0 {
                return 0.0;
            }

            let elapsed_on_current_frame = run
                .current_frame_started_at
                .map(|started_at| now.saturating_sub(started_at) as f64)
                .unwrap_or(0.0);
            let current_frame_remaining = (average - elapsed_on_current_frame).max(0.0);
            let future_frames = remaining_frames.saturating_sub(1);
            average * future_frames as f64 + current_frame_remaining
        })
    } else {
        None
    };

    PlannerRunSummary {
        id: run.id.clone(),
        blend_file_path: run.blend_file_path.clone(),
        start_frame: run.start_frame,
        end_frame: run.end_frame,
        start_at: run.start_at,
        output_folder_path: run.output_folder_path.clone(),
        created_at: run.created_at,
        started_at: run.started_at,
        completed_at: run.completed_at,
        status: run.status.clone(),
        blender_target: run.blender_target.clone(),
        current_frame: run.current_frame,
        rendered_frame_count: run.rendered_frame_count,
        average_render_time_seconds,
        estimated_remaining_seconds,
        pid: run.pid,
        last_error_message: run.last_error_message.clone(),
        exit_code: run.exit_code,
    }
}

fn average_render_time_seconds(run: &PlannerRunRecord) -> Option<f64> {
    let mut total_seconds = 0.0;
    let mut sample_count = 0_u32;

    for log_entry in &run.logs {
        if let Some(render_time_seconds) = parse_render_time_seconds(&log_entry.message) {
            total_seconds += render_time_seconds;
            sample_count = sample_count.saturating_add(1);
        }
    }

    if sample_count == 0 {
        None
    } else {
        Some(total_seconds / f64::from(sample_count))
    }
}

fn total_frames(run: &PlannerRunRecord) -> u32 {
    run.end_frame.saturating_sub(run.start_frame).saturating_add(1)
}

fn planner_run_summary_sort(left: &PlannerRunSummary, right: &PlannerRunSummary) -> std::cmp::Ordering {
    planner_status_rank(&left.status)
        .cmp(&planner_status_rank(&right.status))
        .then_with(|| match left.status {
            PlannerRunStatus::Pending => left.start_at.cmp(&right.start_at),
            PlannerRunStatus::Running => right.started_at.unwrap_or(0).cmp(&left.started_at.unwrap_or(0)),
            PlannerRunStatus::Completed | PlannerRunStatus::Failed => {
                right.completed_at.unwrap_or(0).cmp(&left.completed_at.unwrap_or(0))
            }
        })
        .then_with(|| right.created_at.cmp(&left.created_at))
}

fn planner_status_rank(status: &PlannerRunStatus) -> u8 {
    match status {
        PlannerRunStatus::Running => 0,
        PlannerRunStatus::Pending => 1,
        PlannerRunStatus::Failed => 2,
        PlannerRunStatus::Completed => 3,
    }
}

fn emit_planner_runs_changed<R: tauri::Runtime>(app: &AppHandle<R>, planner: &PlannerRegistry) {
    if let Ok(runs) = list_planner_runs(planner) {
        let _ = app.emit(PLANNER_RUNS_EVENT, runs);
    }
}

fn take_dirty_runs(state: &mut PlannerState) -> Option<Vec<PlannerRunRecord>> {
    if !state.dirty {
        return None;
    }

    state.dirty = false;
    Some(state.runs.clone())
}

fn save_if_dirty<R: tauri::Runtime>(app: &AppHandle<R>, planner: &PlannerRegistry) -> Result<(), String> {
    let runs = {
        let mut state = planner
            .inner
            .lock()
            .map_err(|_| "Unable to access planner state.".to_string())?;

        match take_dirty_runs(&mut state) {
            Some(runs) => runs,
            None => return Ok(()),
        }
    };

    if let Err(error) = save_planner_state(app, &runs) {
        if let Ok(mut state) = planner.inner.lock() {
            state.dirty = true;
        }
        return Err(error);
    }

    Ok(())
}

fn load_planner_state_from_path(file_path: &Path) -> Result<PlannerStoredState, String> {
    if !file_path.exists() {
        return Ok(PlannerStoredState::default());
    }

    let contents = fs::read_to_string(file_path)
        .map_err(|error| format!("Unable to read planner state: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse planner state: {error}"))
}

fn load_planner_state<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PlannerStoredState, String> {
    let file_path = planner_state_file_path(app)?;
    load_planner_state_from_path(&file_path)
}

fn save_planner_state_to_path(file_path: &Path, runs: &[PlannerRunRecord]) -> Result<(), String> {
    let directory = file_path
        .parent()
        .ok_or_else(|| "Unable to access application data directory.".to_string())?;

    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to prepare planner data directory: {error}"))?;

    let state = PlannerStoredState {
        runs: runs.to_vec(),
    };
    let json = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Unable to serialize planner state: {error}"))?;

    fs::write(file_path, json).map_err(|error| format!("Unable to save planner state: {error}"))
}

fn save_planner_state<R: tauri::Runtime>(
    app: &AppHandle<R>,
    runs: &[PlannerRunRecord],
) -> Result<(), String> {
    let file_path = planner_state_file_path(app)?;
    save_planner_state_to_path(&file_path, runs)
}fn planner_state_file_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to find application data directory: {error}"))?;

    Ok(app_data_dir.join(PLANNER_STATE_FILE_NAME))
}

fn validate_existing_file_path(value: &str, empty_message: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(empty_message.to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() || !path.is_file() {
        return Err("That file could not be found.".to_string());
    }

    Ok(path)
}

fn validate_existing_directory_path(value: &str, empty_message: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(empty_message.to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() || !path.is_dir() {
        return Err("That folder could not be found.".to_string());
    }

    Ok(path)
}

fn mark_run_failed(run: &mut PlannerRunRecord, completed_at: u64, message: &str) {
    run.status = PlannerRunStatus::Failed;
    run.completed_at = Some(completed_at);
    run.current_frame_started_at = None;
    run.pid = None;
    run.last_error_message = Some(message.to_string());
}

fn parse_frame_number(message: &str) -> Option<u32> {
    if let Some(index) = message.find("Fra:") {
        let digits = message[index + 4..]
            .chars()
            .skip_while(|character| character.is_whitespace())
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>();
        if !digits.is_empty() {
            return digits.parse::<u32>().ok();
        }
    }

    if let Some(index) = message.find("Append frame ") {
        let digits = message[index + 13..]
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>();
        if !digits.is_empty() {
            return digits.parse::<u32>().ok();
        }
    }

    None
}

fn parse_render_time_seconds(message: &str) -> Option<f64> {
    let index = message.find("Time:")?;
    let duration = message[index + 5..]
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit() || matches!(character, ':' | '.'))
        .collect::<String>();

    if duration.is_empty() {
        return None;
    }

    parse_duration_seconds(&duration)
}

fn parse_duration_seconds(value: &str) -> Option<f64> {
    let segments = value.split(':').collect::<Vec<_>>();
    if !(2..=3).contains(&segments.len()) {
        return None;
    }

    let seconds = segments[segments.len() - 1].parse::<f64>().ok()?;
    let minutes = segments[segments.len() - 2].parse::<u64>().ok()?;
    let hours = if segments.len() == 3 {
        segments[0].parse::<u64>().ok()?
    } else {
        0
    };

    Some(hours as f64 * 3600.0 + minutes as f64 * 60.0 + seconds)
}

fn make_planner_run_id(blend_file_path: &str, start_at: u64, created_at: u64) -> String {
    let digest = blend_file_path
        .bytes()
        .fold(0_u64, |accumulator, value| accumulator.wrapping_mul(131).wrapping_add(u64::from(value)));
    format!("planner-{created_at}-{start_at}-{digest:x}")
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn blender_output_path_argument(value: &str) -> String {
    let mut path = value.trim().to_string();
    if !path.ends_with('\\') && !path.ends_with('/') {
        path.push(std::path::MAIN_SEPARATOR);
    }
    path
}

#[cfg(target_os = "windows")]
fn pick_windows_file(title: &str, filter: &str) -> Result<Option<String>, String> {
    let escaped_title = title.replace('\'', "''");
    let escaped_filter = filter.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms\n$dialog = New-Object System.Windows.Forms.OpenFileDialog\n$dialog.Title = '{escaped_title}'\n$dialog.Filter = '{escaped_filter}'\n$dialog.CheckFileExists = $true\n$dialog.Multiselect = $false\nif ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Write($dialog.FileName) }}"
    );

    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-STA", "-Command", &script]);
    command.creation_flags(0x08000000);

    let output = command
        .output()
        .map_err(|error| format!("Unable to open the file picker: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Unable to open the file picker.".to_string()
        } else {
            stderr
        });
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[cfg(target_os = "windows")]
fn pick_windows_folder(title: &str) -> Result<Option<String>, String> {
    let escaped_title = title.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms\n$dialog = New-Object System.Windows.Forms.FolderBrowserDialog\n$dialog.Description = '{escaped_title}'\n$dialog.ShowNewFolderButton = $true\nif ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Write($dialog.SelectedPath) }}"
    );

    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-STA", "-Command", &script]);
    command.creation_flags(0x08000000);

    let output = command
        .output()
        .map_err(|error| format!("Unable to open the folder picker: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Unable to open the folder picker.".to_string()
        } else {
            stderr
        });
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[cfg(not(target_os = "windows"))]
fn pick_windows_file(_title: &str, _filter: &str) -> Result<Option<String>, String> {
    Err("File picking is currently only available on Windows builds.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn pick_windows_folder(_title: &str) -> Result<Option<String>, String> {
    Err("Folder picking is currently only available on Windows builds.".to_string())
}








#[cfg(test)]
mod tests {
    use super::*;

    fn test_run(logs: Vec<PlannerLogEntry>) -> PlannerRunRecord {
        PlannerRunRecord {
            id: "planner-test".to_string(),
            blend_file_path: "D:\\Projects\\scene.blend".to_string(),
            start_frame: 1,
            end_frame: 10,
            start_at: 1,
            output_folder_path: None,
            created_at: 1,
            started_at: Some(2),
            completed_at: None,
            status: PlannerRunStatus::Running,
            blender_target: PlannerBlenderTarget {
                source: PlannerBlenderSource::Library,
                version_id: Some("5.1.0".to_string()),
                display_name: "Blender 5.1.0".to_string(),
                executable_path: "C:\\Blender\\blender.exe".to_string(),
            },
            current_frame: Some(3),
            current_frame_started_at: Some(100),
            rendered_frame_count: 2,
            pid: Some(42),
            last_error_message: None,
            exit_code: None,
            next_log_index: logs.len() as u64,
            logs,
        }
    }

    #[test]
    fn parses_render_time_from_blender_log_lines() {
        let seconds = parse_render_time_seconds("render           | Time: 00:13.90 (Saving: 00:00.10)");
        assert_eq!(seconds, Some(13.9));
    }

    #[test]
    fn parses_hour_minute_second_render_durations() {
        let seconds = parse_render_time_seconds("render | Time: 01:02:03.45 (Saving: 00:00.10)");
        assert_eq!(seconds, Some(3723.45));
    }

    #[test]
    fn calculates_average_from_render_time_log_entries() {
        let run = test_run(vec![
            PlannerLogEntry {
                id: "log-1".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "render           | Time: 00:10.00 (Saving: 00:00.10)".to_string(),
                timestamp: 10,
            },
            PlannerLogEntry {
                id: "log-2".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "Fra:3 Mem:30.00M".to_string(),
                timestamp: 11,
            },
            PlannerLogEntry {
                id: "log-3".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "render           | Time: 00:14.00 (Saving: 00:00.12)".to_string(),
                timestamp: 12,
            },
        ]);

        assert_eq!(average_render_time_seconds(&run), Some(12.0));
    }

    #[test]
    fn counts_down_eta_during_the_current_frame() {
        let mut run = test_run(vec![
            PlannerLogEntry {
                id: "log-1".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "render           | Time: 00:22.00 (Saving: 00:00.10)".to_string(),
                timestamp: 10,
            },
            PlannerLogEntry {
                id: "log-2".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "render           | Time: 00:22.00 (Saving: 00:00.10)".to_string(),
                timestamp: 11,
            },
            PlannerLogEntry {
                id: "log-3".to_string(),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: "render           | Time: 00:22.00 (Saving: 00:00.10)".to_string(),
                timestamp: 12,
            },
        ]);
        run.start_frame = 1;
        run.end_frame = 5;
        run.current_frame = Some(4);
        run.current_frame_started_at = Some(100);
        run.rendered_frame_count = 3;

        let summary = summarize_run(&run, 110);
        assert_eq!(summary.estimated_remaining_seconds, Some(34.0));

        let summary = summarize_run(&run, 130);
        assert_eq!(summary.estimated_remaining_seconds, Some(22.0));
    }

    fn test_temp_dir(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("voxel-shift-{label}-{unique}"));
        fs::create_dir_all(&directory).expect("test temp directory should be created");
        directory
    }

    #[test]
    fn validates_planner_paths_and_custom_blender_targets() {
        let sandbox = test_temp_dir("planner-paths");
        let blend_file = sandbox.join("scene.blend");
        let other_file = sandbox.join("notes.txt");
        let output_dir = sandbox.join("renders");
        let blender_executable = sandbox.join("custom blender.exe");

        fs::write(&blend_file, b"blend").unwrap();
        fs::write(&other_file, b"notes").unwrap();
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(&blender_executable, b"binary").unwrap();

        assert_eq!(validate_blend_file_path(blend_file.to_string_lossy().as_ref()).unwrap(), path_to_string(&blend_file));
        assert_eq!(
            validate_blend_file_path(other_file.to_string_lossy().as_ref()),
            Err("Please choose a Blender .blend file.".to_string())
        );
        assert_eq!(
            validate_blend_file_path("   "),
            Err("Please choose a Blender .blend file.".to_string())
        );
        assert_eq!(
            validate_output_folder_path(output_dir.to_string_lossy().as_ref()).unwrap(),
            path_to_string(&output_dir)
        );
        assert_eq!(
            validate_output_folder_path("   "),
            Err("Please choose an output folder.".to_string())
        );

        let blender_target = validate_custom_blender_target(blender_executable.to_string_lossy().as_ref()).unwrap();
        assert_eq!(blender_target.source, PlannerBlenderSource::Custom);
        assert_eq!(blender_target.version_id, None);
        assert_eq!(blender_target.display_name, "custom blender");
        assert_eq!(blender_target.executable_path, path_to_string(&blender_executable));
    }

    #[test]
    fn parses_frame_numbers_and_updates_progress_from_log_lines() {
        assert_eq!(parse_frame_number("Fra:42 Mem:10.00M"), Some(42));
        assert_eq!(parse_frame_number("Append frame 314"), Some(314));
        assert_eq!(parse_frame_number("Fra: not-a-frame"), None);
        assert_eq!(parse_duration_seconds("00:15.50"), Some(15.5));
        assert_eq!(parse_duration_seconds("01:02:03.25"), Some(3723.25));
        assert_eq!(parse_duration_seconds("bad-value"), None);

        let mut run = test_run(Vec::new());
        run.start_frame = 10;
        run.end_frame = 12;
        run.current_frame = None;
        run.current_frame_started_at = None;
        run.rendered_frame_count = 0;

        let first = append_log_to_run(&mut run, "stdout", "Fra:11 Mem:20.00M");
        assert_eq!(first.id, "planner-test-0");
        assert_eq!(run.current_frame, Some(11));
        assert_eq!(run.rendered_frame_count, 1);

        let second = append_log_to_run(&mut run, "stdout", "Append frame 12");
        assert_eq!(second.id, "planner-test-1");
        assert_eq!(run.current_frame, Some(12));
        assert_eq!(run.rendered_frame_count, 2);
        assert_eq!(run.logs.len(), 2);
    }

    #[test]
    fn validates_frame_ranges_and_planner_sorting_helpers() {
        assert_eq!(validate_frame_range(1, 5), Ok((1, 5)));
        assert_eq!(
            validate_frame_range(0, 5),
            Err("The start frame must be 1 or higher.".to_string())
        );
        assert_eq!(
            validate_frame_range(5, 4),
            Err("The end frame must be greater than or equal to the start frame.".to_string())
        );

        let blender_target = test_run(Vec::new()).blender_target.clone();
        let running = PlannerRunSummary {
            id: "running".to_string(),
            blend_file_path: "a.blend".to_string(),
            start_frame: 1,
            end_frame: 10,
            start_at: 5,
            output_folder_path: None,
            created_at: 5,
            started_at: Some(20),
            completed_at: None,
            status: PlannerRunStatus::Running,
            blender_target: blender_target.clone(),
            current_frame: Some(4),
            rendered_frame_count: 3,
            average_render_time_seconds: Some(2.0),
            estimated_remaining_seconds: Some(8.0),
            pid: Some(99),
            last_error_message: None,
            exit_code: None,
        };
        let pending = PlannerRunSummary { status: PlannerRunStatus::Pending, start_at: 10, ..running.clone() };
        let failed = PlannerRunSummary { status: PlannerRunStatus::Failed, completed_at: Some(40), ..running.clone() };
        let completed = PlannerRunSummary { status: PlannerRunStatus::Completed, completed_at: Some(30), ..running.clone() };

        let mut runs = vec![completed, failed, pending, running];
        runs.sort_by(planner_run_summary_sort);
        assert_eq!(
            runs.iter().map(|run| run.status.clone()).collect::<Vec<_>>(),
            vec![
                PlannerRunStatus::Running,
                PlannerRunStatus::Pending,
                PlannerRunStatus::Failed,
                PlannerRunStatus::Completed,
            ]
        );
    }

    #[test]
    fn failure_and_output_helpers_reset_state_consistently() {
        let mut run = test_run(Vec::new());
        run.pid = Some(44);
        run.current_frame_started_at = Some(77);

        mark_run_failed(&mut run, 123, "Render stopped unexpectedly.");
        assert_eq!(run.status, PlannerRunStatus::Failed);
        assert_eq!(run.completed_at, Some(123));
        assert_eq!(run.pid, None);
        assert_eq!(run.current_frame_started_at, None);
        assert_eq!(run.last_error_message.as_deref(), Some("Render stopped unexpectedly."));
        assert_eq!(total_frames(&run), 10);
        assert_eq!(blender_output_path_argument("D:\\Renders\\Shot_010"), format!("D:\\Renders\\Shot_010{}", std::path::MAIN_SEPARATOR));
    }

    fn test_registry(runs: Vec<PlannerRunRecord>) -> PlannerRegistry {
        let registry = PlannerRegistry::default();
        {
            let mut state = registry.inner.lock().unwrap();
            state.runs = runs;
        }
        registry
    }

    #[test]
    fn registry_helpers_list_runs_logs_and_due_work() {
        let mut pending_due = test_run(Vec::new());
        pending_due.id = "pending-due".to_string();
        pending_due.status = PlannerRunStatus::Pending;
        pending_due.start_at = current_timestamp().saturating_sub(5);
        pending_due.started_at = None;
        pending_due.pid = None;
        pending_due.logs = vec![PlannerLogEntry {
            id: "log-1".to_string(),
            run_id: pending_due.id.clone(),
            source: "system".to_string(),
            message: "Queued".to_string(),
            timestamp: 1,
        }];

        let mut pending_future = test_run(Vec::new());
        pending_future.id = "pending-future".to_string();
        pending_future.status = PlannerRunStatus::Pending;
        pending_future.start_at = current_timestamp().saturating_add(60);
        pending_future.started_at = None;
        pending_future.pid = None;

        let mut running = test_run(Vec::new());
        running.id = "running".to_string();
        running.status = PlannerRunStatus::Running;
        running.started_at = Some(current_timestamp().saturating_sub(10));

        let registry = test_registry(vec![pending_future.clone(), pending_due.clone(), running.clone()]);

        let listed = list_planner_runs(&registry).unwrap();
        assert_eq!(listed[0].id, "running");
        assert_eq!(listed[1].id, "pending-due");
        assert_eq!(listed[2].id, "pending-future");
        assert_eq!(planner_logs(&registry, "pending-due").unwrap().len(), 1);
        assert_eq!(collect_due_runs(&registry), vec!["pending-due".to_string()]);
        assert!(has_pending_or_running_runs(&registry));
    }

    #[test]
    fn summary_helpers_handle_missing_samples_and_completed_runs() {
        let mut run = test_run(Vec::new());
        run.status = PlannerRunStatus::Completed;
        run.completed_at = Some(200);
        run.current_frame = Some(run.end_frame);
        run.current_frame_started_at = None;
        run.rendered_frame_count = total_frames(&run);
        run.pid = None;

        assert_eq!(average_render_time_seconds(&run), None);

        let summary = summarize_run(&run, 250);
        assert_eq!(summary.average_render_time_seconds, None);
        assert_eq!(summary.estimated_remaining_seconds, None);
        assert_eq!(summary.status, PlannerRunStatus::Completed);
    }

    #[test]
    fn append_log_to_run_trims_the_oldest_entries_once_the_buffer_is_full() {
        let logs = (0..MAX_PLANNER_LOG_LINES)
            .map(|index| PlannerLogEntry {
                id: format!("existing-{index}"),
                run_id: "planner-test".to_string(),
                source: "stdout".to_string(),
                message: format!("line {index}"),
                timestamp: index as u64,
            })
            .collect::<Vec<_>>();

        let mut run = test_run(logs);
        run.next_log_index = MAX_PLANNER_LOG_LINES as u64;

        let appended = append_log_to_run(&mut run, "stderr", "latest line");
        assert_eq!(appended.id, format!("planner-test-{}", MAX_PLANNER_LOG_LINES));
        assert_eq!(run.logs.len(), MAX_PLANNER_LOG_LINES);
        assert_eq!(run.logs.first().unwrap().id, "existing-1");
        assert_eq!(run.logs.last().unwrap().message, "latest line");
    }

    #[test]
    fn planner_logs_reports_missing_runs_and_output_paths_keep_existing_separators() {
        let registry = test_registry(vec![test_run(Vec::new())]);
        assert!(matches!(
            planner_logs(&registry, "missing"),
            Err(message) if message == "That planner run could not be found."
        ));
        assert_eq!(blender_output_path_argument("D:\\Renders\\Shot_010\\"), "D:\\Renders\\Shot_010\\".to_string());
        assert!(make_planner_run_id("D:\\Projects\\scene.blend", 10, 20).starts_with("planner-20-10-"));
    }

    #[test]
    fn append_log_to_run_ignores_out_of_range_and_repeated_frames() {
        let mut run = test_run(Vec::new());
        run.start_frame = 10;
        run.end_frame = 12;
        run.current_frame = Some(11);
        run.current_frame_started_at = Some(99);
        run.rendered_frame_count = 1;

        append_log_to_run(&mut run, "stdout", "Fra:9 Mem:20.00M");
        append_log_to_run(&mut run, "stdout", "Append frame 10");
        append_log_to_run(&mut run, "stdout", "Append frame 99");

        assert_eq!(run.current_frame, Some(11));
        assert_eq!(run.current_frame_started_at, Some(99));
        assert_eq!(run.rendered_frame_count, 1);
        assert_eq!(run.logs.len(), 3);
    }

    #[test]
    fn parser_helpers_reject_invalid_formats() {
        assert_eq!(parse_frame_number("Append frame "), None);
        assert_eq!(parse_render_time_seconds("render | Time:"), None);
        assert_eq!(parse_duration_seconds("1:2:3:4"), None);
        assert_eq!(parse_duration_seconds("not-a-duration"), None);
    }

    #[test]
    fn planner_path_validation_and_sorting_cover_missing_cases() {
        let sandbox = test_temp_dir("planner-missing-paths");
        let missing_file = sandbox.join("missing.blend");
        let missing_dir = sandbox.join("missing-folder");

        assert_eq!(
            validate_existing_file_path(missing_file.to_string_lossy().as_ref(), "Choose a file"),
            Err("That file could not be found.".to_string())
        );
        assert_eq!(
            validate_existing_directory_path(missing_dir.to_string_lossy().as_ref(), "Choose a folder"),
            Err("That folder could not be found.".to_string())
        );
        assert_eq!(parse_render_time_seconds("render | Time:"), None);

        let blender_target = test_run(Vec::new()).blender_target.clone();
        let make_summary = |id: &str,
                            status: PlannerRunStatus,
                            started_at: Option<u64>,
                            completed_at: Option<u64>,
                            created_at: u64| PlannerRunSummary {
            id: id.to_string(),
            blend_file_path: "scene.blend".to_string(),
            start_frame: 1,
            end_frame: 10,
            start_at: 1,
            output_folder_path: None,
            created_at,
            started_at,
            completed_at,
            status,
            blender_target: blender_target.clone(),
            current_frame: None,
            rendered_frame_count: 0,
            average_render_time_seconds: None,
            estimated_remaining_seconds: None,
            pid: None,
            last_error_message: None,
            exit_code: None,
        };

        let mut running = vec![
            make_summary("running-older", PlannerRunStatus::Running, Some(20), None, 1),
            make_summary("running-newer", PlannerRunStatus::Running, Some(30), None, 2),
        ];
        running.sort_by(planner_run_summary_sort);
        assert_eq!(running[0].id, "running-newer");

        let mut completed = vec![
            make_summary("completed-older", PlannerRunStatus::Completed, Some(10), Some(40), 1),
            make_summary("completed-newer", PlannerRunStatus::Completed, Some(10), Some(50), 2),
        ];
        completed.sort_by(planner_run_summary_sort);
        assert_eq!(completed[0].id, "completed-newer");
    }

    fn test_request(
        blend_file_path: String,
        output_folder_path: Option<String>,
        executable_path: String,
    ) -> ResolvedPlannerRunRequest {
        ResolvedPlannerRunRequest {
            blend_file_path,
            start_frame: 3,
            end_frame: 8,
            start_at: 42,
            output_folder_path,
            blender_target: PlannerBlenderTarget {
                source: PlannerBlenderSource::Custom,
                version_id: None,
                display_name: "Custom Blender".to_string(),
                executable_path,
            },
        }
    }

    #[test]
    fn restore_and_replace_helpers_handle_scheduler_state() {
        let mut stored = PlannerStoredState {
            runs: vec![test_run(Vec::new())],
        };

        assert!(restore_running_runs(&mut stored, 500));
        assert_eq!(stored.runs[0].status, PlannerRunStatus::Failed);
        assert_eq!(
            stored.runs[0].last_error_message.as_deref(),
            Some("Voxel Shift closed before this render finished.")
        );
        assert_eq!(
            stored.runs[0].logs.last().unwrap().message,
            "Voxel Shift closed before this render finished."
        );

        let mut state = PlannerState::default();
        assert!(replace_planner_state(&mut state, stored.clone(), true));
        assert!(state.scheduler_started);
        assert!(state.dirty);
        assert_eq!(state.runs.len(), 1);

        assert!(!replace_planner_state(&mut state, PlannerStoredState::default(), false));
        assert!(state.scheduler_started);
        assert!(state.runs.is_empty());
        assert!(!state.dirty);
    }

    #[test]
    fn state_mutation_helpers_create_update_delete_and_take_dirty_runs() {
        let sandbox = test_temp_dir("planner-state-mutations");
        let blend_file = sandbox.join("scene.blend");
        let output_dir = sandbox.join("renders");
        let blender_executable = sandbox.join("blender.exe");
        fs::write(&blend_file, b"blend").unwrap();
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(&blender_executable, b"binary").unwrap();

        let mut state = PlannerState::default();
        let created = create_planner_run_in_state(
            &mut state,
            test_request(
                path_to_string(&blend_file),
                Some(path_to_string(&output_dir)),
                path_to_string(&blender_executable),
            ),
            100,
        );
        assert_eq!(created.status, PlannerRunStatus::Pending);
        assert_eq!(state.runs.len(), 1);
        assert!(state.dirty);
        assert_eq!(take_dirty_runs(&mut state).unwrap().len(), 1);
        assert!(!state.dirty);
        assert!(take_dirty_runs(&mut state).is_none());

        let updated = update_planner_run_in_state(
            &mut state,
            &created.id,
            test_request(
                path_to_string(&blend_file),
                None,
                path_to_string(&blender_executable),
            ),
            200,
        )
        .unwrap();
        assert_eq!(updated.output_folder_path, None);
        assert!(state.dirty);
        state.runs[0].status = PlannerRunStatus::Completed;
        assert!(matches!(
            update_planner_run_in_state(
                &mut state,
                &created.id,
                test_request(
                    path_to_string(&blend_file),
                    None,
                    path_to_string(&blender_executable),
                ),
                300,
            ),
            Err(message) if message == "Only pending renders can be edited."
        ));
        assert!(matches!(
            delete_planner_run_in_state(&mut state, "missing"),
            Err(message) if message == "That planner run could not be found."
        ));
        assert!(matches!(
            delete_planner_run_in_state(&mut state, &created.id),
            Ok(())
        ));
        assert!(state.runs.is_empty());
    }

    #[test]
    fn persistence_launch_and_exit_helpers_cover_remaining_branches() {
        let sandbox = test_temp_dir("planner-persistence");
        let blend_file = sandbox.join("scene.blend");
        let output_dir = sandbox.join("renders");
        let blender_executable = sandbox.join("blender.exe");
        let state_file = sandbox.join("planner-state.json");
        fs::write(&blend_file, b"blend").unwrap();
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(&blender_executable, b"binary").unwrap();

        let request = test_request(
            path_to_string(&blend_file),
            Some(path_to_string(&output_dir)),
            path_to_string(&blender_executable),
        );
        let run = planner_run_record(request, 123);
        save_planner_state_to_path(&state_file, &[run.clone()]).unwrap();
        let loaded = load_planner_state_from_path(&state_file).unwrap();
        assert_eq!(loaded.runs.len(), 1);
        assert_eq!(loaded.runs[0].id, run.id);
        assert!(load_planner_state_from_path(&sandbox.join("missing.json")).unwrap().runs.is_empty());
        fs::write(&state_file, "{bad json").unwrap();
        assert!(load_planner_state_from_path(&state_file)
            .unwrap_err()
            .contains("Unable to parse planner state"));

        let (blend_path, executable_path, output_path) = resolve_start_due_run_paths(&run).unwrap();
        assert_eq!(blend_path, path_to_string(&blend_file));
        assert_eq!(executable_path, blender_executable);
        assert_eq!(
            output_path,
            Some(format!("{}{}", path_to_string(&output_dir), std::path::MAIN_SEPARATOR))
        );

        let mut succeeded = test_run(Vec::new());
        succeeded.status = PlannerRunStatus::Running;
        let success_message = finalize_run_after_exit(&mut succeeded, 600, Some(0), true);
        assert_eq!(success_message, "Render finished with exit code 0.");
        assert_eq!(succeeded.status, PlannerRunStatus::Completed);
        assert_eq!(succeeded.current_frame, Some(succeeded.end_frame));
        assert_eq!(succeeded.rendered_frame_count, total_frames(&succeeded));
        assert_eq!(succeeded.last_error_message, None);

        let mut failed = test_run(Vec::new());
        failed.status = PlannerRunStatus::Running;
        let failure_message = finalize_run_after_exit(&mut failed, 601, Some(9), false);
        assert_eq!(failure_message, "Render finished with exit code 9.");
        assert_eq!(failed.status, PlannerRunStatus::Failed);
        assert_eq!(failed.last_error_message.as_deref(), Some("Render finished with exit code 9."));
    }
}


