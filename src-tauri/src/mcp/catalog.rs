//! App actions exposed through MCP, with explicit schemas and backend validation.
use super::*;
use serde_json::{json, Value};

fn text() -> Value {
    json!({"type":"string","minLength":1,"maxLength":4096})
}
fn nullable(value: Value) -> Value {
    json!({"anyOf":[value,{"type":"null"}]})
}
fn object(fields: &[(&str, Value)], required: &[&str]) -> Value {
    let properties: JsonObject = fields
        .iter()
        .map(|(key, value)| (key.to_string(), value.clone()))
        .collect();
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn strings(names: &[&str]) -> Value {
    object(
        &names.iter().map(|name| (*name, text())).collect::<Vec<_>>(),
        names,
    )
}

pub(super) fn tools() -> Vec<Tool> {
    let mode = json!({"type":"string","enum":["copy","symlink"]});
    let migration = object(
        &[
            ("settingsPath", nullable(text())),
            ("extensionsPath", nullable(text())),
            ("addonsPath", nullable(text())),
            ("extensionMode", mode.clone()),
            (
                "extensionOverrides",
                json!({"type":"array","maxItems":1024,"items":object(&[("linkPath",text()),("targetPath",text()),("mode",nullable(mode))], &["linkPath","targetPath"])}),
            ),
        ],
        &["extensionMode"],
    );
    let frame = json!({"type":"integer","minimum":1,"maximum":4294967295u64});
    let planner = object(
        &[
            ("blendFilePath", text()),
            ("startFrame", frame.clone()),
            ("endFrame", frame),
            (
                "startAt",
                json!({"type":"integer","minimum":0,"maximum":9007199254740991u64,"description":"Scheduled start in Unix seconds, not milliseconds."}),
            ),
            ("outputFolderPath", nullable(text())),
            (
                "shutdownWhenDone",
                json!({"type":"boolean","description":"Only true when the user explicitly requests computer shutdown after rendering."}),
            ),
            (
                "blender",
                object(
                    &[
                        (
                            "source",
                            json!({"type":"string","enum":["library","custom"]}),
                        ),
                        ("versionId", nullable(text())),
                        ("executablePath", nullable(text())),
                    ],
                    &["source"],
                ),
            ),
        ],
        &[
            "blendFilePath",
            "startFrame",
            "endFrame",
            "startAt",
            "shutdownWhenDone",
            "blender",
        ],
    );
    let definitions = vec![
        ("refresh_managed_blender_extensions","Update bundled Voxel Shift extensions in managed installations.",strings(&[]),false,true,false),
        ("remove_recent_project","Remove a project from recent history without deleting its .blend file.",strings(&["filePath"]),false,true,false),
        ("scan_for_blender_versions","Scan configured discovery roots for installed Blender versions.",strings(&[]),true,false,false),
        ("register_blender_version","Register an existing Blender executable or installation directory.",object(&[("path",text()),("label",nullable(text()))], &["path"]),false,false,false),
        ("set_default_blender_version","Choose the default Blender using an ID from get_launcher_state.",strings(&["id"]),false,false,false),
        ("remove_blender_version","Delete a managed installation and its portable settings/extensions from disk. Confirm the intended version with the user before deleting.",strings(&["id"]),false,true,false),
        ("add_scan_root","Add an existing directory to Blender discovery roots.",strings(&["path"]),false,false,false),
        ("remove_scan_root","Remove a discovery directory without deleting files.",strings(&["path"]),false,false,false),
        ("launch_blender","Launch a new Blender session. extraArgs can execute scripts: use only user-requested arguments. Do not retry automatically.",object(&[("id",text()),("extraArgs",nullable(json!({"type":"string","maxLength":4096})))], &["id"]),false,true,true),
        ("stop_running_blender","Force-stop a tracked instance. Unsaved work can be lost; confirm the intended instance with the user.",strings(&["instanceId"]),false,true,false),
        ("open_version_location","Open an installed Blender directory in the system file browser.",strings(&["id"]),false,false,false),
        ("get_blender_lts_release_lines","Fetch official Blender LTS release lines from the internet.",strings(&[]),true,false,true),
        ("get_blender_release_downloads","Fetch releases for this computer. Use returned IDs, versions, filenames and URLs for installation.",strings(&[]),true,false,true),
        ("install_blender_release","Download/install an official release using fields from get_blender_release_downloads, with optional config migration. May take minutes; client timeouts do not cancel it. Cancel separately using the release ID; do not retry blindly.",object(&[("id",text()),("version",text()),("fileName",text()),("url",text()),("migration",nullable(migration))], &["id","version","fileName","url"]),false,true,true),
        ("cancel_blender_release_install","Request cancellation of an active installation by release ID.",strings(&["id"]),false,true,false),
        ("get_install_migration_folders","Inspect settings, extensions and add-on folders for an installed version.",strings(&["versionId"]),true,false,false),
        ("get_install_migration_links","Preview extension migration links for an existing extensions directory.",object(&[("extensionsPath",nullable(text()))], &[]),true,false,false),
        ("get_blender_configs","List saved portable configuration snapshots.",strings(&[]),true,false,false),
        ("save_blender_config","Save a named portable config snapshot. A matching snapshot may be replaced.",strings(&["versionId","name"]),false,true,false),
        ("apply_blender_config","Replace a version's startup file, preferences and theme with a saved snapshot. Confirm the target before overwriting.",strings(&["versionId","configId"]),false,true,false),
        ("remove_blender_config","Delete a saved configuration snapshot from disk.",strings(&["configId"]),false,true,false),
        ("get_planner_runs","List scheduled, running, completed and failed render jobs.",strings(&[]),true,false,false),
        ("get_planner_logs","Read captured logs for a render job.",strings(&["runId"]),true,false,false),
        ("create_planner_run","Schedule rendering. startAt is Unix seconds. Use a library versionId or custom executablePath. May overwrite outputs or execute Blender scripts. Set shutdownWhenDone false unless the user requests computer shutdown.",planner.clone(),false,true,true),
        ("update_planner_run","Replace the settings of a pending render job. Running jobs cannot be edited. shutdownWhenDone requires explicit user intent.",object(&[("runId",text()),("request",planner)], &["runId","request"]),false,true,true),
        ("delete_planner_run","Delete a pending/completed/failed job and its history. Removes pending jobs from the schedule. Cannot cancel or delete running renders.",strings(&["runId"]),false,true,false),
        ("pick_planner_blend_file","Show the native .blend picker and wait for the user. Returns null on cancel. Prefer a known path when available.",strings(&[]),false,false,false),
        ("pick_planner_blender_executable","Show the native Blender executable picker; waits for the user. Returns null on cancel.",strings(&[]),false,false,false),
        ("pick_planner_output_folder","Show the native render output folder picker; waits for the user. Returns null on cancel.",strings(&[]),false,false,false),
        ("pick_install_migration_folder","Show the native migration folder picker; waits for the user. Returns null on cancel.",strings(&[]),false,false,false),
    ];
    definitions
        .into_iter()
        .map(
            |(name, description, schema, read_only, destructive, open_world)| {
                let mut tool = Tool::new(name, description, schema.as_object().unwrap().clone());
                tool.annotations = Some(
                    ToolAnnotations::new()
                        .read_only(read_only)
                        .destructive(destructive)
                        .idempotent(read_only)
                        .open_world(open_world),
                );
                tool
            },
        )
        .collect()
}

/// Enforce the small schema vocabulary used above, including nested unknown fields.
pub(super) fn validate(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    if let Some(items) = schema["anyOf"].as_array() {
        return if items.iter().any(|item| validate(item, value, path).is_ok()) {
            Ok(())
        } else {
            Err(format!("Invalid value for {path}."))
        };
    }
    if let Some(items) = schema["enum"].as_array() {
        if !items.contains(value) {
            return Err(format!("Unsupported value for {path}."));
        }
    }
    let invalid = || format!("Invalid value for {path}.");
    match schema["type"].as_str() {
        Some("object") => {
            let values = value.as_object().ok_or_else(invalid)?;
            let properties = schema["properties"].as_object().ok_or_else(invalid)?;
            for key in schema["required"].as_array().ok_or_else(invalid)? {
                if !values.contains_key(key.as_str().unwrap()) {
                    return Err(format!("Missing {path}.{}.", key.as_str().unwrap()));
                }
            }
            for (key, value) in values {
                let field = properties
                    .get(key)
                    .ok_or_else(|| format!("Unknown field {path}.{key}."))?;
                validate(field, value, &format!("{path}.{key}"))?;
            }
        }
        Some("string") => {
            let length = value.as_str().ok_or_else(invalid)?.chars().count() as u64;
            if length < schema["minLength"].as_u64().unwrap_or(0)
                || length > schema["maxLength"].as_u64().unwrap_or(4096)
            {
                return Err(invalid());
            }
        }
        Some("integer") => {
            let n = value.as_u64().ok_or_else(invalid)?;
            if n < schema["minimum"].as_u64().unwrap_or(0)
                || n > schema["maximum"].as_u64().unwrap_or(u64::MAX)
            {
                return Err(invalid());
            }
        }
        Some("boolean") if value.is_boolean() => (),
        Some("null") if value.is_null() => (),
        Some("array") => {
            let values = value.as_array().ok_or_else(invalid)?;
            if values.len() as u64 > schema["maxItems"].as_u64().unwrap_or(1024) {
                return Err(invalid());
            }
            for value in values {
                validate(&schema["items"], value, path)?;
            }
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

pub(super) fn independent(name: &str) -> bool {
    matches!(
        name,
        "install_blender_release"
            | "get_blender_release_downloads"
            | "get_blender_lts_release_lines"
            | "get_install_migration_links"
            | "cancel_blender_release_install"
            | "pick_planner_blend_file"
            | "pick_planner_blender_executable"
            | "pick_planner_output_folder"
            | "pick_install_migration_folder"
    )
}

#[derive(Debug)]
enum AppAction {
    RefreshExtensions,
    RemoveRecentProject(String),
    ScanVersions,
    RegisterVersion(RegisterRequest),
    SetDefaultVersion(String),
    RemoveVersion(String),
    AddScanRoot(String),
    RemoveScanRoot(String),
    Launch(LaunchRequest),
    StopRunning(String),
    OpenLocation(String),
    LtsReleases,
    ReleaseDownloads,
    Install(InstallReleaseRequest),
    CancelInstall(String),
    MigrationFolders(String),
    MigrationLinks(Option<String>),
    Configs,
    SaveConfig(SaveBlenderConfigRequest),
    ApplyConfig(ApplyBlenderConfigRequest),
    RemoveConfig(String),
    PlannerRuns,
    PlannerLogs(String),
    CreateRun(planner::CreatePlannerRunRequest),
    UpdateRun(String, planner::CreatePlannerRunRequest),
    DeleteRun(String),
    PickBlendFile,
    PickBlender,
    PickOutput,
    PickMigration,
}

fn action(name: &str, arguments: JsonObject) -> Result<AppAction, String> {
    let args = Value::Object(arguments);
    let string = |key: &str| args[key].as_str().unwrap_or_default().to_string();
    macro_rules! request {
        ($ty:ty) => {
            serde_json::from_value::<$ty>(args.clone()).map_err(|e| e.to_string())?
        };
    }
    Ok(match name {
        "refresh_managed_blender_extensions" => AppAction::RefreshExtensions,
        "remove_recent_project" => AppAction::RemoveRecentProject(string("filePath")),
        "scan_for_blender_versions" => AppAction::ScanVersions,
        "register_blender_version" => AppAction::RegisterVersion(request!(RegisterRequest)),
        "set_default_blender_version" => AppAction::SetDefaultVersion(string("id")),
        "remove_blender_version" => AppAction::RemoveVersion(string("id")),
        "add_scan_root" => AppAction::AddScanRoot(string("path")),
        "remove_scan_root" => AppAction::RemoveScanRoot(string("path")),
        "launch_blender" => AppAction::Launch(request!(LaunchRequest)),
        "stop_running_blender" => AppAction::StopRunning(string("instanceId")),
        "open_version_location" => AppAction::OpenLocation(string("id")),
        "get_blender_lts_release_lines" => AppAction::LtsReleases,
        "get_blender_release_downloads" => AppAction::ReleaseDownloads,
        "install_blender_release" => AppAction::Install(request!(InstallReleaseRequest)),
        "cancel_blender_release_install" => AppAction::CancelInstall(string("id")),
        "get_install_migration_folders" => AppAction::MigrationFolders(string("versionId")),
        "get_install_migration_links" => {
            AppAction::MigrationLinks(args["extensionsPath"].as_str().map(str::to_string))
        }
        "get_blender_configs" => AppAction::Configs,
        "save_blender_config" => AppAction::SaveConfig(request!(SaveBlenderConfigRequest)),
        "apply_blender_config" => AppAction::ApplyConfig(request!(ApplyBlenderConfigRequest)),
        "remove_blender_config" => AppAction::RemoveConfig(string("configId")),
        "get_planner_runs" => AppAction::PlannerRuns,
        "get_planner_logs" => AppAction::PlannerLogs(string("runId")),
        "create_planner_run" => AppAction::CreateRun(request!(planner::CreatePlannerRunRequest)),
        "update_planner_run" => AppAction::UpdateRun(
            string("runId"),
            serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
        ),
        "delete_planner_run" => AppAction::DeleteRun(string("runId")),
        "pick_planner_blend_file" => AppAction::PickBlendFile,
        "pick_planner_blender_executable" => AppAction::PickBlender,
        "pick_planner_output_folder" => AppAction::PickOutput,
        "pick_install_migration_folder" => AppAction::PickMigration,
        _ => return Err("Unknown app action.".into()),
    })
}

trait ActionBackend {
    fn execute(&self, action: AppAction) -> Result<Value, String>;
    fn configs(&self) -> Result<Value, String>;
    fn emit(&self, event: &str, value: &Value);
}

impl ActionBackend for AppHandle {
    fn execute(&self, action: AppAction) -> Result<Value, String> {
        macro_rules! result {
            ($call:expr) => {
                serde_json::to_value($call?).map_err(|e| e.to_string())
            };
        }
        match action {
            AppAction::RefreshExtensions => {
                result!(refresh_managed_blender_extensions(self.clone()))
            }
            AppAction::RemoveRecentProject(path) => {
                result!(remove_recent_project(self.clone(), path))
            }
            AppAction::ScanVersions => result!(scan_for_blender_versions(self.clone())),
            AppAction::RegisterVersion(request) => {
                result!(register_blender_version(self.clone(), request))
            }
            AppAction::SetDefaultVersion(id) => {
                result!(set_default_blender_version(self.clone(), id))
            }
            AppAction::RemoveVersion(id) => result!(remove_blender_version(self.clone(), id)),
            AppAction::AddScanRoot(path) => result!(add_scan_root(self.clone(), path)),
            AppAction::RemoveScanRoot(path) => result!(remove_scan_root(self.clone(), path)),
            AppAction::Launch(request) => {
                result!(launch_blender(self.clone(), self.state(), request))
            }
            AppAction::StopRunning(id) => {
                result!(stop_running_blender(self.clone(), self.state(), id))
            }
            AppAction::OpenLocation(id) => result!(open_version_location(self.clone(), id)),
            AppAction::LtsReleases => result!(tauri::async_runtime::block_on(
                get_blender_lts_release_lines()
            )),
            AppAction::ReleaseDownloads => result!(tauri::async_runtime::block_on(
                get_blender_release_downloads()
            )),
            AppAction::Install(request) => result!(tauri::async_runtime::block_on(
                install_blender_release(self.clone(), self.state(), request)
            )),
            AppAction::CancelInstall(id) => result!(cancel_blender_release_install(
                self.clone(),
                self.state(),
                id
            )),
            AppAction::MigrationFolders(id) => {
                result!(get_install_migration_folders(self.clone(), id))
            }
            AppAction::MigrationLinks(path) => result!(tauri::async_runtime::block_on(
                get_install_migration_links(path)
            )),
            AppAction::Configs => self.configs(),
            AppAction::SaveConfig(request) => result!(save_blender_config(self.clone(), request)),
            AppAction::ApplyConfig(request) => result!(apply_blender_config(self.clone(), request)),
            AppAction::RemoveConfig(id) => result!(remove_blender_config(self.clone(), id)),
            AppAction::PlannerRuns => result!(get_planner_runs(self.state())),
            AppAction::PlannerLogs(id) => result!(get_planner_logs(self.state(), id)),
            AppAction::CreateRun(request) => {
                result!(create_planner_run(self.clone(), self.state(), request))
            }
            AppAction::UpdateRun(id, request) => {
                result!(update_planner_run(self.clone(), self.state(), id, request))
            }
            AppAction::DeleteRun(id) => result!(delete_planner_run(self.clone(), self.state(), id)),
            AppAction::PickBlendFile => result!(pick_planner_blend_file()),
            AppAction::PickBlender => result!(pick_planner_blender_executable()),
            AppAction::PickOutput => result!(pick_planner_output_folder()),
            AppAction::PickMigration => result!(tauri::async_runtime::block_on(
                pick_install_migration_folder()
            )),
        }
    }

    fn configs(&self) -> Result<Value, String> {
        serde_json::to_value(get_blender_configs(self.clone())?).map_err(|e| e.to_string())
    }

    fn emit(&self, event: &str, value: &Value) {
        let _ = Emitter::emit(self, event, value);
    }
}

pub(super) fn dispatch(
    app: &AppHandle,
    name: &str,
    arguments: JsonObject,
) -> Result<Value, String> {
    dispatch_with(app, name, arguments)
}

fn dispatch_with(
    backend: &impl ActionBackend,
    name: &str,
    arguments: JsonObject,
) -> Result<Value, String> {
    let value = backend.execute(action(name, arguments)?)?;
    if matches!(
        name,
        "scan_for_blender_versions"
            | "register_blender_version"
            | "set_default_blender_version"
            | "remove_blender_version"
            | "add_scan_root"
            | "remove_scan_root"
            | "launch_blender"
            | "install_blender_release"
    ) {
        backend.emit("launcher-state-updated", &value);
    }
    if name == "remove_recent_project" {
        backend.emit("recent-projects-updated", &value);
    }
    if matches!(name, "save_blender_config" | "remove_blender_config") {
        if let Ok(configs) = backend.configs() {
            backend.emit("blender-configs-updated", &configs);
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct RecordingBackend {
        calls: RefCell<Vec<AppAction>>,
        events: RefCell<Vec<(String, Value)>>,
        result: Result<Value, String>,
        configs: Result<Value, String>,
        config_reads: RefCell<usize>,
    }

    impl RecordingBackend {
        fn new() -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                events: RefCell::new(Vec::new()),
                result: Ok(json!({"saved":true})),
                configs: Ok(json!([{"id":"config-1"}])),
                config_reads: RefCell::new(0),
            }
        }

        fn dispatch(&self, name: &str, args: Value) -> Result<Value, String> {
            // Exercise the same schema validation and routing entry used by HTTP calls.
            let Operation::AppAction(name, args) = accepts(name, args)? else {
                panic!("Expected a catalog action");
            };
            dispatch_with(self, &name, args)
        }
    }

    impl ActionBackend for RecordingBackend {
        fn execute(&self, action: AppAction) -> Result<Value, String> {
            self.calls.borrow_mut().push(action);
            self.result.clone()
        }

        fn configs(&self) -> Result<Value, String> {
            *self.config_reads.borrow_mut() += 1;
            self.configs.clone()
        }

        fn emit(&self, event: &str, value: &Value) {
            assert!(
                !self.calls.borrow().is_empty(),
                "Events must follow execution"
            );
            self.events
                .borrow_mut()
                .push((event.to_string(), value.clone()));
        }
    }

    #[test]
    fn dispatches_simple_actions_with_the_correct_argument_fields() {
        let cases: Vec<(&str, Value, AppAction)> = vec![
            (
                "refresh_managed_blender_extensions",
                json!({}),
                AppAction::RefreshExtensions,
            ),
            (
                "remove_recent_project",
                json!({"filePath":"scene.blend"}),
                AppAction::RemoveRecentProject("scene.blend".into()),
            ),
            (
                "scan_for_blender_versions",
                json!({}),
                AppAction::ScanVersions,
            ),
            (
                "set_default_blender_version",
                json!({"id":"v1"}),
                AppAction::SetDefaultVersion("v1".into()),
            ),
            (
                "remove_blender_version",
                json!({"id":"v2"}),
                AppAction::RemoveVersion("v2".into()),
            ),
            (
                "add_scan_root",
                json!({"path":"D:/Tools"}),
                AppAction::AddScanRoot("D:/Tools".into()),
            ),
            (
                "remove_scan_root",
                json!({"path":"D:/Old"}),
                AppAction::RemoveScanRoot("D:/Old".into()),
            ),
            (
                "stop_running_blender",
                json!({"instanceId":"session-1"}),
                AppAction::StopRunning("session-1".into()),
            ),
            (
                "open_version_location",
                json!({"id":"v3"}),
                AppAction::OpenLocation("v3".into()),
            ),
            (
                "get_blender_lts_release_lines",
                json!({}),
                AppAction::LtsReleases,
            ),
            (
                "get_blender_release_downloads",
                json!({}),
                AppAction::ReleaseDownloads,
            ),
            (
                "cancel_blender_release_install",
                json!({"id":"release-1"}),
                AppAction::CancelInstall("release-1".into()),
            ),
            (
                "get_install_migration_folders",
                json!({"versionId":"v4"}),
                AppAction::MigrationFolders("v4".into()),
            ),
            (
                "get_install_migration_links",
                json!({"extensionsPath":"D:/Extensions"}),
                AppAction::MigrationLinks(Some("D:/Extensions".into())),
            ),
            (
                "get_install_migration_links",
                json!({"extensionsPath":null}),
                AppAction::MigrationLinks(None),
            ),
            ("get_blender_configs", json!({}), AppAction::Configs),
            (
                "remove_blender_config",
                json!({"configId":"config-2"}),
                AppAction::RemoveConfig("config-2".into()),
            ),
            ("get_planner_runs", json!({}), AppAction::PlannerRuns),
            (
                "get_planner_logs",
                json!({"runId":"render-1"}),
                AppAction::PlannerLogs("render-1".into()),
            ),
            (
                "delete_planner_run",
                json!({"runId":"render-2"}),
                AppAction::DeleteRun("render-2".into()),
            ),
            (
                "pick_planner_blend_file",
                json!({}),
                AppAction::PickBlendFile,
            ),
            (
                "pick_planner_blender_executable",
                json!({}),
                AppAction::PickBlender,
            ),
            (
                "pick_planner_output_folder",
                json!({}),
                AppAction::PickOutput,
            ),
            (
                "pick_install_migration_folder",
                json!({}),
                AppAction::PickMigration,
            ),
        ];
        for (name, args, expected) in cases {
            let backend = RecordingBackend::new();
            assert_eq!(backend.dispatch(name, args).unwrap(), json!({"saved":true}));
            let calls = backend.calls.borrow();
            assert_eq!(calls.len(), 1, "{name}");
            assert_eq!(format!("{:?}", calls[0]), format!("{expected:?}"), "{name}");
        }
    }

    #[test]
    fn dispatches_typed_requests_without_losing_optional_fields() {
        let backend = RecordingBackend::new();
        backend
            .dispatch(
                "register_blender_version",
                json!({"path":"D:/Blender", "label":"Studio"}),
            )
            .unwrap();
        backend
            .dispatch(
                "launch_blender",
                json!({"id":"v1", "extraArgs":"--factory-startup"}),
            )
            .unwrap();
        backend
            .dispatch(
                "save_blender_config",
                json!({"versionId":"v2", "name":"Work"}),
            )
            .unwrap();
        backend
            .dispatch(
                "apply_blender_config",
                json!({"versionId":"v3", "configId":"config-1"}),
            )
            .unwrap();
        let install = json!({"id":"r1", "version":"5.2.1", "fileName":"blender.zip", "url":"https://download.blender.org/blender.zip", "migration":{"extensionMode":"copy", "settingsPath":"D:/old/config"}});
        backend
            .dispatch("install_blender_release", install)
            .unwrap();
        let planner = json!({"blendFilePath":"D:/scene.blend", "startFrame":3, "endFrame":8, "startAt":42, "outputFolderPath":"D:/renders", "shutdownWhenDone":true, "blender":{"source":"custom", "executablePath":"D:/blender.exe"}});
        backend
            .dispatch("create_planner_run", planner.clone())
            .unwrap();
        backend
            .dispatch(
                "update_planner_run",
                json!({"runId":"render-1", "request":planner}),
            )
            .unwrap();
        let calls = backend.calls.borrow();
        assert!(
            matches!(&calls[0], AppAction::RegisterVersion(r) if r.path == "D:/Blender" && r.label.as_deref() == Some("Studio"))
        );
        assert!(
            matches!(&calls[1], AppAction::Launch(r) if r.id == "v1" && r.extra_args.as_deref() == Some("--factory-startup"))
        );
        assert!(
            matches!(&calls[2], AppAction::SaveConfig(r) if r.version_id == "v2" && r.name == "Work")
        );
        assert!(
            matches!(&calls[3], AppAction::ApplyConfig(r) if r.version_id == "v3" && r.config_id == "config-1")
        );
        assert!(
            matches!(&calls[4], AppAction::Install(r) if r.id == "r1" && r.version == "5.2.1" && r.file_name == "blender.zip" && r.url == "https://download.blender.org/blender.zip" && r.migration.as_ref().unwrap().settings_path.as_deref() == Some("D:/old/config"))
        );
        for call in &calls[5..] {
            let request = match call {
                AppAction::CreateRun(request) => request,
                AppAction::UpdateRun(id, request) => {
                    assert_eq!(id, "render-1");
                    request
                }
                other => panic!("Unexpected action: {other:?}"),
            };
            assert_eq!(request.blend_file_path, "D:/scene.blend");
            assert_eq!(
                (request.start_frame, request.end_frame, request.start_at),
                (3, 8, 42)
            );
            assert_eq!(request.output_folder_path.as_deref(), Some("D:/renders"));
            assert!(request.shutdown_when_done);
            assert_eq!(
                request.blender.source,
                planner::PlannerBlenderSource::Custom
            );
            assert_eq!(
                request.blender.executable_path.as_deref(),
                Some("D:/blender.exe")
            );
        }
    }

    #[test]
    fn emits_fresh_state_only_after_successful_mutations() {
        for (name, args, event) in [
            (
                "scan_for_blender_versions",
                json!({}),
                "launcher-state-updated",
            ),
            (
                "register_blender_version",
                json!({"path":"D:/Blender"}),
                "launcher-state-updated",
            ),
            (
                "set_default_blender_version",
                json!({"id":"v1"}),
                "launcher-state-updated",
            ),
            (
                "remove_blender_version",
                json!({"id":"v1"}),
                "launcher-state-updated",
            ),
            (
                "add_scan_root",
                json!({"path":"D:/Tools"}),
                "launcher-state-updated",
            ),
            (
                "remove_scan_root",
                json!({"path":"D:/Tools"}),
                "launcher-state-updated",
            ),
            (
                "launch_blender",
                json!({"id":"v1"}),
                "launcher-state-updated",
            ),
            (
                "install_blender_release",
                json!({"id":"r1", "version":"5.2.1", "fileName":"blender.zip", "url":"https://download.blender.org/blender.zip"}),
                "launcher-state-updated",
            ),
            (
                "remove_recent_project",
                json!({"filePath":"scene.blend"}),
                "recent-projects-updated",
            ),
            (
                "save_blender_config",
                json!({"versionId":"v1", "name":"Studio"}),
                "blender-configs-updated",
            ),
            (
                "remove_blender_config",
                json!({"configId":"config-1"}),
                "blender-configs-updated",
            ),
        ] {
            let backend = RecordingBackend::new();
            backend.dispatch(name, args.clone()).unwrap();
            let expected = if event == "blender-configs-updated" {
                json!([{"id":"config-1"}])
            } else {
                json!({"saved":true})
            };
            assert_eq!(
                *backend.events.borrow(),
                vec![(event.into(), expected)],
                "{name}"
            );
            let mut failed = RecordingBackend::new();
            failed.result = Err("Write failed".into());
            assert_eq!(failed.dispatch(name, args).unwrap_err(), "Write failed");
            assert!(failed.events.borrow().is_empty(), "{name}");
            assert_eq!(*failed.config_reads.borrow(), 0);
        }
        let mut backend = RecordingBackend::new();
        backend.configs = Err("Cannot refresh configs".into());
        assert!(backend
            .dispatch("remove_blender_config", json!({"configId":"config-1"}))
            .is_ok());
        assert!(backend.events.borrow().is_empty());
        backend
            .dispatch("get_planner_logs", json!({"runId":"render-1"}))
            .unwrap();
        assert!(backend.events.borrow().is_empty());
    }

    #[test]
    fn invalid_requests_never_reach_the_backend() {
        let backend = RecordingBackend::new();
        for (name, args) in [
            ("unknown_action", json!({})),
            ("launch_blender", json!({"id":"v1", "unexpected":true})),
            (
                "update_planner_run",
                json!({"runId":"render-1", "request":{}}),
            ),
        ] {
            assert!(backend.dispatch(name, args).is_err());
        }
        assert!(backend.calls.borrow().is_empty());
        assert!(backend.events.borrow().is_empty());
        assert_eq!(
            dispatch_with(&backend, "unknown_action", JsonObject::new()).unwrap_err(),
            "Unknown app action."
        );
        assert!(dispatch_with(&backend, "register_blender_version", JsonObject::new()).is_err());
        assert!(backend.calls.borrow().is_empty());
    }

    fn accepts(name: &str, arguments: Value) -> Result<Operation, String> {
        parse_operation(name, arguments.as_object().unwrap().clone())
    }

    #[test]
    fn validates_unicode_string_lengths_and_nullable_arguments() {
        // Limits count characters, not UTF-8 bytes.
        for path in ["é".to_string(), "é".repeat(4096)] {
            assert!(accepts("register_blender_version", json!({"path":path})).is_ok());
        }
        for path in [json!(""), json!("é".repeat(4097)), json!(42), Value::Null] {
            assert!(accepts("register_blender_version", json!({"path":path})).is_err());
        }
        for label in [Value::Null, json!("Studio")] {
            assert!(accepts(
                "register_blender_version",
                json!({"path":"blender", "label":label})
            )
            .is_ok());
        }
        assert!(accepts(
            "register_blender_version",
            json!({"path":"blender", "label":false})
        )
        .is_err());
        assert!(accepts("launch_blender", json!({"id":"v1", "extraArgs":""})).is_ok());
    }

    #[test]
    fn validates_planner_integer_boundaries_and_boolean_types() {
        let request = json!({
            "blendFilePath":"scene.blend", "startFrame":1, "endFrame":4294967295u64,
            "startAt":0, "shutdownWhenDone":false, "blender":{"source":"custom", "executablePath":"blender"}
        });
        assert!(accepts("create_planner_run", request.clone()).is_ok());
        for (key, invalid) in [
            ("startFrame", json!(0)),
            ("endFrame", json!(4294967296u64)),
            ("startFrame", json!(-1)),
            ("endFrame", json!(1.5)),
            ("startAt", json!(9007199254740992u64)),
            ("startAt", json!(-1)),
            ("shutdownWhenDone", json!("false")),
            ("shutdownWhenDone", Value::Null),
        ] {
            let mut changed = request.clone();
            changed[key] = invalid;
            assert!(accepts("create_planner_run", changed).is_err(), "{key}");
        }
        let mut maximum = request;
        maximum["startAt"] = json!(9007199254740991u64);
        maximum["shutdownWhenDone"] = json!(true);
        assert!(accepts("create_planner_run", maximum).is_ok());
    }

    #[test]
    fn validates_migration_array_limits_and_nested_fields() {
        let item =
            json!({"linkPath":"user_default/tool", "targetPath":"extensions/tool", "mode":null});
        let request = json!({
            "id":"r1", "version":"5.2.1", "fileName":"blender.zip", "url":"https://download.blender.org/blender.zip",
            "migration":{"extensionMode":"copy", "extensionOverrides":[]}
        });
        for items in [json!([]), json!(vec![item.clone(); 1024])] {
            let mut changed = request.clone();
            changed["migration"]["extensionOverrides"] = items;
            assert!(accepts("install_blender_release", changed).is_ok());
        }
        for items in [
            json!(vec![item; 1025]),
            json!({}),
            json!([null]),
            json!([{"linkPath":"tool"}]),
            json!([{"linkPath":"tool", "targetPath":"target", "unexpected":true}]),
        ] {
            let mut changed = request.clone();
            changed["migration"]["extensionOverrides"] = items;
            assert!(accepts("install_blender_release", changed).is_err());
        }
    }

    #[test]
    fn identifies_missing_and_unknown_arguments_with_their_paths() {
        assert_eq!(
            accepts("register_blender_version", json!({})).unwrap_err(),
            "Missing arguments.path."
        );
        assert_eq!(
            accepts("get_planner_runs", json!({"extra":true})).unwrap_err(),
            "Unknown field arguments.extra."
        );
        assert_eq!(
            accepts("unknown_tool", json!({})).unwrap_err(),
            "Unknown tool."
        );
        let invalid = json!({"runId":"run-1", "request":{
            "blendFilePath":"scene.blend", "startFrame":1, "endFrame":2,
            "startAt":0, "shutdownWhenDone":false, "blender":{"source":"library", "extra":true}
        }});
        assert_eq!(
            accepts("update_planner_run", invalid).unwrap_err(),
            "Unknown field arguments.request.blender.extra."
        );
    }
}
