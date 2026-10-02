use std::sync::Condvar;
use std::time::Instant;

#[derive(Default)]
struct ObservedLifecycle {
    saved: Vec<Vec<PlannerRunRecord>>,
    events: Vec<Vec<PlannerRunSummary>>,
    logs: Vec<PlannerLogEventPayload>,
    shutdown_calls: usize,
    notifications: Vec<PlannerRunSummary>,
}

#[derive(Clone)]
struct RecordingHost {
    observed: Arc<(Mutex<ObservedLifecycle>, Condvar)>,
    state_file: PathBuf,
    shutdown_error: Option<String>,
}

impl RecordingHost {
    fn wait_for(&self, ready: impl Fn(&ObservedLifecycle) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        let (lock, signal) = &*self.observed;
        let mut observed = lock.lock().unwrap();
        while !ready(&observed) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "Timed out waiting for planner lifecycle events"
            );
            observed = signal.wait_timeout(observed, remaining).unwrap().0;
        }
    }
}

impl PlannerHost for RecordingHost {
    fn save(&self, planner: &PlannerRegistry) -> Result<(), String> {
        save_if_dirty_with(planner, |runs| {
            save_planner_state_to_path(&self.state_file, runs)?;
            self.observed.0.lock().unwrap().saved.push(runs.runs.clone());
            self.observed.1.notify_all();
            Ok(())
        })
    }

    fn runs_changed(&self, planner: &PlannerRegistry) {
        let runs = list_planner_runs(planner).unwrap();
        self.observed.0.lock().unwrap().events.push(runs);
        self.observed.1.notify_all();
    }

    fn log(&self, payload: PlannerLogEventPayload) {
        self.observed.0.lock().unwrap().logs.push(payload);
        self.observed.1.notify_all();
    }

    fn shutdown(&self) -> Result<(), String> {
        self.observed.0.lock().unwrap().shutdown_calls += 1;
        self.observed.1.notify_all();
        self.shutdown_error.clone().map_or(Ok(()), Err)
    }

    fn finished(&self, run: PlannerRunSummary) {
        self.observed.0.lock().unwrap().notifications.push(run);
        self.observed.1.notify_all();
    }
}

struct ProcessFixture {
    directory: PathBuf,
    planner: PlannerRegistry,
    host: RecordingHost,
}

#[test]
fn user_cancellation_stops_the_real_process_preserves_cancelled_status_and_skips_shutdown() {
    let fixture = ProcessFixture::new("wait");
    fixture.planner.inner.lock().unwrap().runs[0].shutdown_when_done = true;
    fixture.start();
    fixture.host.wait_for(|observed| observed.logs.iter().any(|log| log.entry.message.starts_with("Fra:")));
    let id = fixture.run_id();
    let child = fixture.planner.inner.lock().unwrap().active_processes[&id].clone();
    cancel_planner_run_with(&fixture.host, &fixture.planner, &id).unwrap();
    fixture.host.wait_for(|observed| observed.events.iter().any(|runs| runs.iter().any(|run| run.id == id && run.status == PlannerRunStatus::Cancelled && run.pid.is_none())));
    assert!(child.lock().unwrap().try_wait().unwrap().is_some());
    assert!(fixture.planner.inner.lock().unwrap().active_processes.is_empty());
    assert_eq!(fixture.host.observed.0.lock().unwrap().shutdown_calls, 0);
    assert!(fixture.host.observed.0.lock().unwrap().notifications.is_empty());
    let loaded = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    assert_eq!(loaded.runs[0].status, PlannerRunStatus::Cancelled);
    assert!(loaded.runs[0].logs.iter().any(|entry| entry.message == "Render cancelled by user."));
}

#[test]
fn cancelling_pending_work_never_launches_blender_and_removes_it_from_queue() {
    let fixture = ProcessFixture::new("success");
    let id = fixture.run_id();
    cancel_planner_run_with(&fixture.host, &fixture.planner, &id).unwrap();
    fixture.start();
    assert!(!fixture.directory.join("scene with spaces.args").exists());
    assert!(get_planner_queue(&fixture.planner).unwrap().pending_run_ids.is_empty());
    assert_eq!(load_planner_state_from_path(&fixture.host.state_file).unwrap().runs[0].status, PlannerRunStatus::Cancelled);
    assert!(cancel_planner_run_with(&fixture.host, &fixture.planner, &id).is_err());
    assert!(cancel_planner_run_with(&fixture.host, &fixture.planner, "missing").is_err());
}

#[test]
fn paused_queue_blocks_launch_but_does_not_interrupt_active_render() {
    let fixture = ProcessFixture::new("wait");
    fixture.planner.inner.lock().unwrap().queue.paused = true;
    fixture.start();
    assert!(fixture.planner.inner.lock().unwrap().active_processes.is_empty());
    assert!(!fixture.directory.join("scene with spaces.args").exists());
    fixture.planner.inner.lock().unwrap().queue.paused = false;
    fixture.start();
    fixture.planner.inner.lock().unwrap().queue.paused = true;
    assert_eq!(list_planner_runs(&fixture.planner).unwrap()[0].status, PlannerRunStatus::Running);
    fs::write(fixture.directory.join("scene with spaces.release"), "continue").unwrap();
    fixture.wait_for_exit(PlannerRunStatus::Completed);
    fixture.host.wait_for(|observed| observed.notifications.len() == 1);
    assert_eq!(fixture.host.observed.0.lock().unwrap().notifications[0].status, PlannerRunStatus::Completed);
}

#[test]
fn failures_notify_once_for_nonzero_exit_and_missing_input() {
    for mode in ["fail", "missing"] {
        let fixture = ProcessFixture::new(mode);
        if mode == "missing" {
            fs::remove_file(fixture.directory.join("scene with spaces.blend")).unwrap();
        }
        fixture.start();
        fixture.wait_for_exit(PlannerRunStatus::Failed);
        fixture.host.wait_for(|observed| observed.notifications.len() == 1);
        fixture.start();
        assert_eq!(fixture.host.observed.0.lock().unwrap().notifications.len(), 1);
        assert_eq!(fixture.host.observed.0.lock().unwrap().notifications[0].status, PlannerRunStatus::Failed);
    }
}

#[test]
fn launch_rechecks_queue_priority_and_schedule_after_scheduler_selection() {
    let fixture = ProcessFixture::new("success");
    let selected_id = fixture.run_id();
    let mut other = fixture.planner.inner.lock().unwrap().runs[0].clone();
    other.id = "new-priority".into();
    {
        let mut state = fixture.planner.inner.lock().unwrap();
        state.runs.push(other);
        reorder_queue_in_state(&mut state, vec!["new-priority".into(), selected_id.clone()]).unwrap();
    }
    fixture.start();
    assert!(!fixture.directory.join("scene with spaces.args").exists());
    assert_eq!(next_due_run_to_start(&fixture.planner).as_deref(), Some("new-priority"));
    {
        let mut state = fixture.planner.inner.lock().unwrap();
        state.runs[1].start_at = current_timestamp() + 3600;
        state.runs[0].start_at = current_timestamp() + 3600;
    }
    fixture.start();
    assert!(!fixture.directory.join("scene with spaces.args").exists());
}

impl ProcessFixture {
    fn new(mode: &str) -> Self {
        let directory = test_temp_dir("planner-process");
        let executable = directory.join(format!("fake-blender{}", std::env::consts::EXE_SUFFIX));
        let compilation = Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
            .arg("--edition=2021")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_blender.rs"))
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compilation.status.success(),
            "{}",
            String::from_utf8_lossy(&compilation.stderr)
        );
        let blend_file = directory.join("scene with spaces.blend");
        fs::write(&blend_file, mode).unwrap();
        let output = directory.join("render output");
        fs::create_dir(&output).unwrap();
        let run = planner_run_record(
            test_request(
                path_to_string(&blend_file),
                Some(path_to_string(&output)),
                path_to_string(&executable),
            ),
            1,
        );
        Self {
            host: RecordingHost {
                observed: Arc::new((Mutex::new(ObservedLifecycle::default()), Condvar::new())),
                state_file: directory.join("planner-state.json"),
                shutdown_error: None,
            },
            directory,
            planner: test_registry(vec![run]),
        }
    }

    fn run_id(&self) -> String {
        self.planner.inner.lock().unwrap().runs[0].id.clone()
    }

    fn start(&self) {
        start_due_run_with(&self.host, &self.planner, &self.run_id()).unwrap();
    }

    fn wait_for_exit(&self, status: PlannerRunStatus) {
        let id = self.run_id();
        self.host.wait_for(|observed| {
            observed
                .events
                .iter()
                .any(|runs| runs.iter().any(|run| run.id == id && run.status == status))
        });
    }
}

impl Drop for ProcessFixture {
    fn drop(&mut self) {
        let children: Vec<_> = self
            .planner
            .inner
            .lock()
            .unwrap()
            .active_processes
            .values()
            .cloned()
            .collect();
        for child in children {
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }
        // This directory is created exclusively by this fixture.
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn process_lifecycle_captures_arguments_logs_and_persists_completion() {
    let fixture = ProcessFixture::new("success");
    fixture.start();
    fixture.wait_for_exit(PlannerRunStatus::Completed);
    fixture.host.wait_for(|observed| {
        observed.logs.iter().any(|log| log.entry.source == "stderr")
            && observed
                .logs
                .iter()
                .any(|log| log.entry.message.starts_with("Fra:"))
    });
    let args = fs::read_to_string(fixture.directory.join("scene with spaces.args")).unwrap();
    assert_eq!(
        args.lines().collect::<Vec<_>>(),
        vec![
            "-b".to_string(),
            path_to_string(&fixture.directory.join("scene with spaces.blend")),
            "-s".into(),
            "3".into(),
            "-e".into(),
            "8".into(),
            "-o".into(),
            blender_output_path_argument(&path_to_string(&fixture.directory.join("render output"))),
            "-a".into(),
        ]
    );
    let observed = fixture.host.observed.0.lock().unwrap();
    assert!(observed
        .saved
        .iter()
        .any(|runs| runs[0].status == PlannerRunStatus::Running && runs[0].pid.is_some()));
    assert!(observed
        .logs
        .iter()
        .all(|log| log.run_id == fixture.run_id()));
    assert!(observed
        .logs
        .iter()
        .any(|log| log.entry.source == "stderr" && log.entry.message == "fixture stderr"));
    assert_eq!(observed.shutdown_calls, 0);
    drop(observed);
    let loaded = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    assert_eq!(loaded.runs[0].status, PlannerRunStatus::Completed);
    assert_eq!(loaded.runs[0].exit_code, Some(0));
    assert_eq!(loaded.runs[0].rendered_frame_count, 6);
    assert!(loaded.runs[0].pid.is_none());
    assert!(fixture
        .planner
        .inner
        .lock()
        .unwrap()
        .active_processes
        .is_empty());
}

#[test]
fn nonzero_process_exit_fails_the_run_without_shutdown() {
    let fixture = ProcessFixture::new("fail");
    fixture.planner.inner.lock().unwrap().runs[0].shutdown_when_done = true;
    fixture.start();
    fixture.wait_for_exit(PlannerRunStatus::Failed);
    let loaded = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    let run = &loaded.runs[0];
    assert_eq!(run.exit_code, Some(7));
    assert_eq!(
        run.last_error_message.as_deref(),
        Some("Render finished with exit code 7.")
    );
    assert!(run.pid.is_none());
    assert!(run.completed_at.is_some());
    assert_eq!(fixture.host.observed.0.lock().unwrap().shutdown_calls, 0);
}

#[test]
fn launch_errors_are_logged_persisted_and_emitted() {
    let fixture = ProcessFixture::new("success");
    let invalid_executable = fixture.directory.join("not-an-executable");
    fs::write(&invalid_executable, b"invalid binary").unwrap();
    fixture.planner.inner.lock().unwrap().runs[0]
        .blender_target
        .executable_path = path_to_string(&invalid_executable);
    fixture.start();
    fixture.wait_for_exit(PlannerRunStatus::Failed);
    let saved = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    assert!(saved.runs[0]
        .last_error_message
        .as_ref()
        .unwrap()
        .starts_with("Failed to launch Blender:"));
    assert!(saved.runs[0]
        .logs
        .iter()
        .any(|log| log.source == "system" && log.message.starts_with("Failed to launch Blender:")));
    assert!(fixture
        .planner
        .inner
        .lock()
        .unwrap()
        .active_processes
        .is_empty());
}

#[test]
fn scheduler_waits_for_the_process_and_completion_delay() {
    let fixture = ProcessFixture::new("wait");
    let mut second = fixture.planner.inner.lock().unwrap().runs[0].clone();
    second.id = "second-run".into();
    second.start_at += 1;
    fixture.planner.inner.lock().unwrap().runs.push(second);
    let id = fixture.run_id();
    assert_eq!(next_due_run_to_start(&fixture.planner), Some(id.clone()));
    fixture.start();
    fixture.host.wait_for(|observed| {
        observed
            .logs
            .iter()
            .any(|log| log.entry.message.starts_with("Fra:"))
    });
    assert!(next_due_run_to_start(&fixture.planner).is_none());
    assert_eq!(
        delete_planner_run_in_state(&mut fixture.planner.inner.lock().unwrap(), &id).unwrap_err(),
        "Running renders cannot be deleted."
    );
    fs::write(fixture.directory.join("scene with spaces.release"), b"go").unwrap();
    fixture.wait_for_exit(PlannerRunStatus::Completed);
    assert!(next_due_run_to_start(&fixture.planner).is_none());
    {
        let mut state = fixture.planner.inner.lock().unwrap();
        assert!(state.active_processes.is_empty());
        assert_eq!(
            state.next_scheduled_start_after,
            Some(state.runs[0].completed_at.unwrap() + PLANNER_NEXT_RUN_DELAY_SECONDS)
        );
        state.next_scheduled_start_after = Some(0);
    }
    assert_eq!(
        next_due_run_to_start(&fixture.planner),
        Some("second-run".into())
    );
}

#[test]
fn successful_exit_requests_shutdown_and_reports_shutdown_failures() {
    for error in [None, Some("Shutdown denied".to_string())] {
        let mut fixture = ProcessFixture::new("success");
        fixture.host.shutdown_error = error.clone();
        fixture.planner.inner.lock().unwrap().runs[0].shutdown_when_done = true;
        fixture.start();
        fixture.wait_for_exit(PlannerRunStatus::Completed);
        let observed = fixture.host.observed.0.lock().unwrap();
        assert_eq!(observed.shutdown_calls, 1);
        let expected = error.map_or_else(
            || format!("Computer shutdown scheduled in {PLANNER_SHUTDOWN_DELAY_SECONDS} seconds."),
            |error| format!("Could not schedule computer shutdown: {error}"),
        );
        assert!(observed
            .logs
            .iter()
            .any(|log| log.entry.message == expected));
    }
}

#[test]
fn interrupted_process_is_failed_and_removed_from_active_processes() {
    let fixture = ProcessFixture::new("wait");
    fixture.planner.inner.lock().unwrap().runs[0].shutdown_when_done = true;
    fixture.start();
    fixture.host.wait_for(|observed| {
        observed
            .logs
            .iter()
            .any(|log| log.entry.message.starts_with("Fra:"))
    });
    let id = fixture.run_id();
    let child = fixture.planner.inner.lock().unwrap().active_processes[&id].clone();
    child.lock().unwrap().kill().unwrap();
    fixture.wait_for_exit(PlannerRunStatus::Failed);
    let loaded = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    assert_ne!(loaded.runs[0].exit_code, Some(0));
    assert!(loaded.runs[0].pid.is_none());
    assert!(loaded.runs[0].last_error_message.is_some());
    assert!(fixture
        .planner
        .inner
        .lock()
        .unwrap()
        .active_processes
        .is_empty());
    assert_eq!(fixture.host.observed.0.lock().unwrap().shutdown_calls, 0);
}

#[test]
fn missing_input_fails_before_spawn_and_unknown_runs_do_not_emit_events() {
    let fixture = ProcessFixture::new("success");
    fs::remove_file(fixture.directory.join("scene with spaces.blend")).unwrap();
    fixture.start();
    fixture.wait_for_exit(PlannerRunStatus::Failed);
    assert!(!fixture.directory.join("scene with spaces.args").exists());
    assert!(fixture
        .planner
        .inner
        .lock()
        .unwrap()
        .active_processes
        .is_empty());
    let saved = load_planner_state_from_path(&fixture.host.state_file).unwrap();
    assert_eq!(
        saved.runs[0].last_error_message.as_deref(),
        Some("That file could not be found.")
    );
    let event_count = fixture.host.observed.0.lock().unwrap().events.len();
    assert_eq!(
        start_due_run_with(&fixture.host, &fixture.planner, "missing").unwrap_err(),
        "That planner run could not be found."
    );
    fixture.start(); // A failed job must not be relaunched by the scheduler.
    assert_eq!(
        fixture.host.observed.0.lock().unwrap().events.len(),
        event_count
    );
}

#[test]
fn process_uses_blend_output_settings_when_no_override_is_selected() {
    let fixture = ProcessFixture::new("success");
    fixture.planner.inner.lock().unwrap().runs[0].output_folder_path = None;
    fixture.start();
    fixture.wait_for_exit(PlannerRunStatus::Completed);
    let args = fs::read_to_string(fixture.directory.join("scene with spaces.args")).unwrap();
    assert_eq!(
        args.lines().collect::<Vec<_>>(),
        vec![
            "-b".to_string(),
            path_to_string(&fixture.directory.join("scene with spaces.blend")),
            "-s".into(),
            "3".into(),
            "-e".into(),
            "8".into(),
            "-a".into(),
        ]
    );
}
