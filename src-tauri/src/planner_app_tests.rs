use tauri::Listener;

struct AppFixture {
    app: tauri::App<tauri::test::MockRuntime>,
    directory: PathBuf,
    events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

impl AppFixture {
    fn new() -> Self {
        static NEXT_FIXTURE: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(0);
        let sequence = NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        context.config_mut().identifier = format!(
            "com.voxelshift.planner-test-{}-{unique}-{sequence}",
            std::process::id()
        );
        let app = tauri::test::mock_builder()
            .manage(PlannerRegistry::default())
            .build(context)
            .unwrap();
        let directory = app.path().app_data_dir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        for name in [
            PLANNER_RUNS_EVENT,
            "planner-queue-updated",
            PLANNER_LOG_EVENT,
        ] {
            let recorded = events.clone();
            app.listen(name, move |event| {
                recorded.lock().unwrap().push((
                    name.to_string(),
                    serde_json::from_str(event.payload()).unwrap(),
                ));
            });
        }
        Self {
            app,
            directory,
            events,
        }
    }

    fn planner(&self) -> State<'_, PlannerRegistry> {
        self.app.state::<PlannerRegistry>()
    }

    fn saved(&self) -> PlannerStoredState {
        load_planner_state(self.app.handle()).unwrap()
    }
}

impl Drop for AppFixture {
    fn drop(&mut self) {
        // The identifier is unique to this fixture; production data is never used.
        if self.directory.exists() {
            fs::remove_dir_all(&self.directory).unwrap();
        }
    }
}

#[test]
fn app_controls_persist_order_pause_and_publish_matching_snapshots() {
    let fixture = AppFixture::new();
    let planner = fixture.planner();
    let first = create_planner_run(
        fixture.app.handle(),
        &planner,
        test_request("first.blend".into(), None, "blender".into()),
    )
    .unwrap();
    let second = create_planner_run(
        fixture.app.handle(),
        &planner,
        test_request("second.blend".into(), None, "blender".into()),
    )
    .unwrap();
    let order = vec![second.id.clone(), first.id.clone()];
    assert_eq!(
        reorder_planner_queue(fixture.app.handle(), &planner, order.clone())
            .unwrap()
            .pending_run_ids,
        order
    );
    assert!(
        set_planner_queue_paused(fixture.app.handle(), &planner, true)
            .unwrap()
            .paused
    );
    assert!(next_due_run_to_start(&planner).is_none());
    assert_eq!(fixture.saved().queue.pending_run_ids, order);
    assert!(fixture.saved().queue.paused);
    let events = fixture.events.lock().unwrap();
    let (_, last_queue) = events
        .iter()
        .rev()
        .find(|(name, _)| name == "planner-queue-updated")
        .unwrap();
    assert_eq!(last_queue["pendingRunIds"], serde_json::json!(order));
    assert_eq!(last_queue["paused"], true);
    let (_, last_runs) = events
        .iter()
        .rev()
        .find(|(name, _)| name == PLANNER_RUNS_EVENT)
        .unwrap();
    assert_eq!(last_runs[0]["id"], second.id);
    drop(events);
    let count = fixture.events.lock().unwrap().len();
    assert!(reorder_planner_queue(fixture.app.handle(), &planner, vec![first.id]).is_err());
    assert_eq!(fixture.events.lock().unwrap().len(), count);
    assert_eq!(fixture.saved().queue.pending_run_ids, order);
    assert!(
        !set_planner_queue_paused(fixture.app.handle(), &planner, false)
            .unwrap()
            .paused
    );
    assert!(!fixture.saved().queue.paused);
}

#[test]
fn app_cancel_retry_edit_and_delete_preserve_history_and_disk_state() {
    let fixture = AppFixture::new();
    let planner = fixture.planner();
    let request = test_request(
        "scene.blend".into(),
        Some("renders".into()),
        "blender".into(),
    );
    let original = create_planner_run(fixture.app.handle(), &planner, request).unwrap();
    cancel_planner_run(fixture.app.handle(), &planner, original.id.clone()).unwrap();
    let logs = get_planner_logs(fixture.planner(), original.id.clone()).unwrap();
    assert_eq!(logs.last().unwrap().message, "Render cancelled by user.");
    let retry = retry_planner_run(fixture.app.handle(), &planner, original.id.clone()).unwrap();
    assert_ne!(retry.id, original.id);
    assert_eq!(retry.start_frame, original.start_frame);
    assert!(fixture
        .saved()
        .runs
        .iter()
        .any(|run| run.id == original.id && run.status == PlannerRunStatus::Cancelled));
    assert_eq!(
        fixture.saved().queue.pending_run_ids,
        vec![retry.id.clone()]
    );
    let mut edit = test_request("edited.blend".into(), None, "other-blender".into());
    edit.end_frame = 99;
    let edited =
        update_planner_run(fixture.app.handle(), &planner, retry.id.clone(), edit).unwrap();
    assert_eq!(edited.end_frame, 99);
    assert_eq!(
        fixture
            .saved()
            .runs
            .iter()
            .find(|run| run.id == retry.id)
            .unwrap()
            .blend_file_path,
        "edited.blend"
    );
    delete_planner_run(fixture.app.handle(), &planner, retry.id.clone()).unwrap();
    assert!(fixture.saved().queue.pending_run_ids.is_empty());
    let runs = get_planner_runs(fixture.planner()).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, original.id);
    assert!(retry_planner_run(fixture.app.handle(), &planner, "missing".into()).is_err());
    assert!(delete_planner_run(fixture.app.handle(), &planner, "missing".into()).is_err());
    assert!(update_planner_run(
        fixture.app.handle(),
        &planner,
        original.id,
        test_request("invalid".into(), None, "blender".into())
    )
    .is_err());
}

#[test]
fn initialize_restores_interrupted_runs_and_paused_queue_without_starting_another_scheduler() {
    let fixture = AppFixture::new();
    let planner = fixture.planner();
    let mut running = test_run(Vec::new());
    running.id = "interrupted".into();
    let mut pending = running.clone();
    pending.id = "pending".into();
    pending.status = PlannerRunStatus::Pending;
    save_planner_state(
        fixture.app.handle(),
        &PlannerStoredState {
            runs: vec![running, pending],
            queue: PlannerQueueState {
                paused: true,
                pending_run_ids: vec!["pending".into()],
            },
        },
    )
    .unwrap();
    planner.inner.lock().unwrap().scheduler_started = true;
    initialize(fixture.app.handle(), &planner).unwrap();
    let restored = fixture.saved();
    assert_eq!(restored.runs[0].status, PlannerRunStatus::Failed);
    assert!(restored.runs[0].pid.is_none());
    assert_eq!(
        restored.runs[0].logs.last().unwrap().message,
        "Voxel Shift closed before this render finished."
    );
    assert!(restored.queue.paused);
    assert!(next_due_run_to_start(&planner).is_none());
    assert!(fixture
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|(name, _)| name == PLANNER_RUNS_EVENT));
    initialize(fixture.app.handle(), &planner).unwrap();
    assert_eq!(fixture.saved().runs[0].logs.len(), 1);
}

#[test]
fn persistence_errors_are_reported_and_can_be_retried_without_losing_queue_changes() {
    let fixture = AppFixture::new();
    let planner = fixture.planner();
    fs::create_dir_all(&fixture.directory).unwrap();
    let state_file = planner_state_file_path(fixture.app.handle()).unwrap();
    fs::create_dir(&state_file).unwrap();
    let error = set_planner_queue_paused(fixture.app.handle(), &planner, true).unwrap_err();
    assert!(error.starts_with("Unable to save planner state:"));
    assert!(planner.inner.lock().unwrap().dirty);
    assert!(fixture.events.lock().unwrap().is_empty());
    fs::remove_dir(&state_file).unwrap();
    save_if_dirty(fixture.app.handle(), &planner).unwrap();
    assert!(fixture.saved().queue.paused);
    assert!(!planner.inner.lock().unwrap().dirty);
}
