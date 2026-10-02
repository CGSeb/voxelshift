#[test]
fn queue_priority_respects_due_times_and_survives_restart_with_pause() {
    let now = current_timestamp();
    let mut first = test_run(Vec::new());
    first.id = "first".into();
    first.status = PlannerRunStatus::Pending;
    first.start_at = now - 10;
    let mut second = first.clone();
    second.id = "second".into();
    second.start_at = now - 5;
    let mut future = first.clone();
    future.id = "future".into();
    future.start_at = now + 3600;
    let registry = test_registry(vec![first, second, future]);
    {
        let mut state = registry.inner.lock().unwrap();
        reorder_queue_in_state(
            &mut state,
            vec!["future".into(), "second".into(), "first".into()],
        )
        .unwrap();
    }
    assert_eq!(next_due_run_to_start(&registry).as_deref(), Some("second"));
    assert_eq!(list_planner_runs(&registry).unwrap()[0].id, "future");
    registry.inner.lock().unwrap().queue.paused = true;
    assert!(next_due_run_to_start(&registry).is_none());
    let directory = test_temp_dir("queue-restart");
    let path = directory.join("planner-state.json");
    save_if_dirty_with(&registry, |stored| {
        save_planner_state_to_path(&path, stored)
    })
    .unwrap();
    let restored = PlannerRegistry::default();
    replace_planner_state(
        &mut restored.inner.lock().unwrap(),
        load_planner_state_from_path(&path).unwrap(),
        false,
    );
    assert!(get_planner_queue(&restored).unwrap().paused);
    assert!(next_due_run_to_start(&restored).is_none());
    restored.inner.lock().unwrap().queue.paused = false;
    assert_eq!(next_due_run_to_start(&restored).as_deref(), Some("second"));
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn queue_rejects_stale_duplicate_unknown_and_non_pending_ids_without_changing_order() {
    let mut pending = test_run(Vec::new());
    pending.id = "pending".into();
    pending.status = PlannerRunStatus::Pending;
    let mut terminal = pending.clone();
    terminal.id = "completed".into();
    terminal.status = PlannerRunStatus::Completed;
    let mut state = PlannerState {
        runs: vec![pending, terminal],
        ..PlannerState::default()
    };
    normalize_queue(&mut state);
    for ids in [
        vec![],
        vec!["pending", "pending"],
        vec!["unknown"],
        vec!["completed"],
    ] {
        assert!(
            reorder_queue_in_state(&mut state, ids.into_iter().map(String::from).collect())
                .is_err()
        );
        assert_eq!(state.queue.pending_run_ids, vec!["pending"]);
        assert!(!state.dirty);
    }
}

#[test]
fn legacy_state_restores_chronological_queue_and_removes_stale_ids() {
    let mut first = test_run(Vec::new());
    first.id = "first".into();
    first.status = PlannerRunStatus::Pending;
    first.start_at = 10;
    let mut second = first.clone();
    second.id = "second".into();
    second.start_at = 20;
    let legacy = serde_json::json!({ "runs": [second, first] });
    let stored: PlannerStoredState = serde_json::from_value(legacy).unwrap();
    let mut state = PlannerState::default();
    replace_planner_state(&mut state, stored, false);
    assert_eq!(state.queue.pending_run_ids, vec!["first", "second"]);
    state.queue.pending_run_ids = vec!["missing".into(), "second".into(), "second".into()];
    normalize_queue(&mut state);
    assert_eq!(state.queue.pending_run_ids, vec!["second", "first"]);
}

#[test]
fn retries_keep_history_reset_progress_and_have_unique_ids_even_within_one_second() {
    let mut original = test_run(Vec::new());
    original.id = "failed".into();
    original.status = PlannerRunStatus::Failed;
    original.shutdown_when_done = true;
    original.output_folder_path = Some("renders".into());
    append_log_to_run(&mut original, "system", "Original failure");
    let mut state = PlannerState {
        runs: vec![original],
        ..PlannerState::default()
    };
    let retry = retry_run_in_state(&mut state, "failed", 100).unwrap();
    let second_retry = retry_run_in_state(&mut state, "failed", 100).unwrap();
    assert_ne!(retry.id, second_retry.id);
    assert_eq!(state.runs[0].status, PlannerRunStatus::Failed);
    assert_eq!(state.runs[0].logs[0].message, "Original failure");
    assert_eq!(retry.status, PlannerRunStatus::Pending);
    assert_eq!(retry.start_at, 100);
    assert!(retry.shutdown_when_done);
    assert_eq!(retry.output_folder_path.as_deref(), Some("renders"));
    assert!(retry.pid.is_none());
    assert!(retry.current_frame.is_none());
    assert!(retry.started_at.is_none());
    assert!(retry.completed_at.is_none());
    assert_eq!(retry.rendered_frame_count, 0);
    assert!(state.runs[1].logs.is_empty());
    assert!(retry_run_in_state(&mut state, &retry.id, 101).is_err());
    assert!(retry_run_in_state(&mut state, "missing", 101).is_err());
    state.runs[0].status = PlannerRunStatus::Completed;
    assert!(retry_run_in_state(&mut state, "failed", 101).is_err());
    state.runs[0].status = PlannerRunStatus::Cancelled;
    assert!(retry_run_in_state(&mut state, "failed", 101).is_ok());
}

#[test]
fn cancelling_a_process_that_exits_successfully_never_completes_or_shuts_down() {
    let mut run = test_run(Vec::new());
    run.status = PlannerRunStatus::Cancelled;
    run.shutdown_when_done = true;
    run.completed_at = Some(90);
    run.pid = Some(123);
    let id = run.id.clone();
    let mut state = PlannerState {
        runs: vec![run],
        ..PlannerState::default()
    };
    let outcome = process_run_exit_in_state(&mut state, &id, 100, Some(0), true).unwrap();
    assert!(!outcome.should_shutdown);
    assert_eq!(state.runs[0].status, PlannerRunStatus::Cancelled);
    assert_eq!(state.runs[0].completed_at, Some(90));
    assert!(state.runs[0].pid.is_none());
}
