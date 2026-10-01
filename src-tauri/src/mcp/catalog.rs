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

pub(super) fn dispatch(
    app: &AppHandle,
    name: &str,
    arguments: JsonObject,
) -> Result<Value, String> {
    let args = Value::Object(arguments);
    let string = |key: &str| args[key].as_str().unwrap_or_default().to_string();
    macro_rules! result {
        ($call:expr) => {
            serde_json::to_value($call?).map_err(|e| e.to_string())
        };
    }
    macro_rules! request {
        ($ty:ty) => {
            serde_json::from_value::<$ty>(args.clone()).map_err(|e| e.to_string())?
        };
    }
    let value = match name {
        "refresh_managed_blender_extensions" => {
            result!(refresh_managed_blender_extensions(app.clone()))
        }
        "remove_recent_project" => result!(remove_recent_project(app.clone(), string("filePath"))),
        "scan_for_blender_versions" => result!(scan_for_blender_versions(app.clone())),
        "register_blender_version" => result!(register_blender_version(
            app.clone(),
            request!(RegisterRequest)
        )),
        "set_default_blender_version" => {
            result!(set_default_blender_version(app.clone(), string("id")))
        }
        "remove_blender_version" => result!(remove_blender_version(app.clone(), string("id"))),
        "add_scan_root" => result!(add_scan_root(app.clone(), string("path"))),
        "remove_scan_root" => result!(remove_scan_root(app.clone(), string("path"))),
        "launch_blender" => result!(launch_blender(
            app.clone(),
            app.state(),
            request!(LaunchRequest)
        )),
        "stop_running_blender" => result!(stop_running_blender(
            app.clone(),
            app.state(),
            string("instanceId")
        )),
        "open_version_location" => result!(open_version_location(app.clone(), string("id"))),
        "get_blender_lts_release_lines" => result!(tauri::async_runtime::block_on(
            get_blender_lts_release_lines()
        )),
        "get_blender_release_downloads" => result!(tauri::async_runtime::block_on(
            get_blender_release_downloads()
        )),
        "install_blender_release" => result!(tauri::async_runtime::block_on(
            install_blender_release(app.clone(), app.state(), request!(InstallReleaseRequest))
        )),
        "cancel_blender_release_install" => result!(cancel_blender_release_install(
            app.clone(),
            app.state(),
            string("id")
        )),
        "get_install_migration_folders" => result!(get_install_migration_folders(
            app.clone(),
            string("versionId")
        )),
        "get_install_migration_links" => result!(tauri::async_runtime::block_on(
            get_install_migration_links(args["extensionsPath"].as_str().map(str::to_string))
        )),
        "get_blender_configs" => result!(get_blender_configs(app.clone())),
        "save_blender_config" => result!(save_blender_config(
            app.clone(),
            request!(SaveBlenderConfigRequest)
        )),
        "apply_blender_config" => result!(apply_blender_config(
            app.clone(),
            request!(ApplyBlenderConfigRequest)
        )),
        "remove_blender_config" => result!(remove_blender_config(app.clone(), string("configId"))),
        "get_planner_runs" => result!(get_planner_runs(app.state())),
        "get_planner_logs" => result!(get_planner_logs(app.state(), string("runId"))),
        "create_planner_run" => result!(create_planner_run(
            app.clone(),
            app.state(),
            request!(planner::CreatePlannerRunRequest)
        )),
        "update_planner_run" => result!(update_planner_run(
            app.clone(),
            app.state(),
            string("runId"),
            serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?
        )),
        "delete_planner_run" => result!(delete_planner_run(
            app.clone(),
            app.state(),
            string("runId")
        )),
        "pick_planner_blend_file" => result!(pick_planner_blend_file()),
        "pick_planner_blender_executable" => result!(pick_planner_blender_executable()),
        "pick_planner_output_folder" => result!(pick_planner_output_folder()),
        "pick_install_migration_folder" => result!(tauri::async_runtime::block_on(
            pick_install_migration_folder()
        )),
        _ => Err("Unknown app action.".into()),
    }?;
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
        let _ = app.emit("launcher-state-updated", &value);
    }
    if name == "remove_recent_project" {
        let _ = app.emit("recent-projects-updated", &value);
    }
    if matches!(name, "save_blender_config" | "remove_blender_config") {
        if let Ok(configs) = get_blender_configs(app.clone()) {
            let _ = app.emit("blender-configs-updated", configs);
        }
    }
    Ok(value)
}
