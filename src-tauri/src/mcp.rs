//! Embedded, opt-in Streamable HTTP MCP server. No Node runtime or sidecar.
use super::*;
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::{
    model::*,
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use tokio_util::sync::CancellationToken;
mod catalog;

type Dispatcher = Arc<dyn Fn(Operation) -> Result<serde_json::Value, String> + Send + Sync>;

pub(super) struct McpServerControl {
    shutdown: CancellationToken,
    runtime: tokio::sync::Mutex<Runtime>,
    path: PathBuf,
}

struct Runtime {
    settings: McpSettings,
    server: Option<RunningServer>,
    error: Option<String>,
}

struct RunningServer {
    cancel: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct McpSettings {
    enabled: bool,
    port: u16,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct McpSettingsStatus {
    #[serde(flatten)]
    settings: McpSettings,
    running: bool,
    error: Option<String>,
}

impl Runtime {
    fn status(&self) -> McpSettingsStatus {
        let running = self
            .server
            .as_ref()
            .is_some_and(|server| !server.task.inner().is_finished());
        McpSettingsStatus {
            settings: self.settings.clone(),
            running,
            error: self.error.clone().or_else(|| {
                (self.settings.enabled && !running)
                    .then(|| "MCP is not running. Save settings to retry.".into())
            }),
        }
    }
}

impl McpServerControl {
    pub(super) fn stop(&self) {
        self.shutdown.cancel();
    }
}

#[derive(Clone)]
struct EmbeddedServer {
    dispatch: Dispatcher,
    operation_lock: Arc<Mutex<()>>,
}

#[derive(Debug)]
enum Operation {
    AppAction(String, JsonObject),
    LauncherState,
    RecentProjects,
    RunningBlenders,
    Logs(LogsArgs),
    Launch(ProjectArgs),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogsArgs {
    instance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectArgs {
    id: String,
    project_path: String,
}

fn parse_operation(name: &str, arguments: JsonObject) -> Result<Operation, String> {
    let tool = tool_definitions()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or("Unknown tool.")?;
    catalog::validate(
        &serde_json::Value::Object((*tool.input_schema).clone()),
        &serde_json::Value::Object(arguments.clone()),
        "arguments",
    )?;
    if catalog::tools().iter().any(|tool| tool.name == name) {
        return Ok(Operation::AppAction(name.to_string(), arguments));
    }
    let args = serde_json::Value::Object(arguments);
    match name {
        "get_running_blender_logs" => serde_json::from_value(args)
            .map(Operation::Logs)
            .map_err(|_| "Expected instanceId.".into()),
        "launch_blender_project" => serde_json::from_value(args)
            .map(Operation::Launch)
            .map_err(|_| "Expected id and projectPath only.".into()),
        "get_launcher_state" | "get_recent_projects" | "get_running_blenders" => {
            if !args.as_object().unwrap().is_empty() {
                return Err("This tool takes no arguments.".into());
            }
            Ok(match name {
                "get_launcher_state" => Operation::LauncherState,
                "get_recent_projects" => Operation::RecentProjects,
                _ => Operation::RunningBlenders,
            })
        }
        _ => Err("Unknown tool.".into()),
    }
}

fn tool_definitions() -> Vec<Tool> {
    let definitions = [
        ("get_launcher_state", "List installed Blender versions, IDs, availability, and defaults.", vec![], true),
        ("get_recent_projects", "List recent Blender projects with file paths and version IDs.", vec![], true),
        ("get_running_blenders", "List Blender instances tracked by Voxel Shift.", vec![], true),
        ("get_running_blender_logs", "Read captured logs for a tracked Blender instance.", vec!["instanceId"], true),
        ("launch_blender_project", "Open an existing .blend file with an installed version. Resolve the version ID with get_launcher_state first. Launches a new process on every call; do not retry automatically. Blender files may execute scripts according to Blender settings.", vec!["id", "projectPath"], false),
    ];
    let mut tools: Vec<Tool> = definitions.into_iter().map(|(name, description, required, read_only)| {
        let properties: JsonObject = required.iter().map(|key| (key.to_string(), serde_json::json!({"type":"string", "minLength":1, "maxLength":4096}))).collect();
        let schema = serde_json::json!({"type":"object", "properties":properties, "required":required, "additionalProperties":false});
        let mut tool = Tool::new(name, description, schema.as_object().unwrap().clone());
        tool.annotations = Some(ToolAnnotations::new().read_only(read_only).destructive(!read_only).idempotent(read_only).open_world(!read_only));
        tool
    }).collect();
    tools.extend(catalog::tools());
    tools
}

impl ServerHandler for EmbeddedServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("voxelshift", env!("CARGO_PKG_VERSION")))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut result = ListToolsResult::default();
        result.tools = tool_definitions();
        Ok(result)
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        tool_definitions()
            .into_iter()
            .find(|tool| tool.name == name)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let operation = match parse_operation(&request.name, request.arguments.unwrap_or_default())
        {
            Ok(operation) => operation,
            Err(error) => return Ok(CallToolResult::error(vec![ContentBlock::text(error)]).into()),
        };
        let dispatch = self.dispatch.clone();
        let operation_lock = self.operation_lock.clone();
        // Filesystem/process work must not block the HTTP runtime. Keep MCP writes serialized.
        let result = tokio::task::spawn_blocking(move || {
            if matches!(&operation, Operation::AppAction(name, _) if catalog::independent(name)) {
                return dispatch(operation);
            }
            let _guard = operation_lock
                .lock()
                .map_err(|_| "MCP operation lock unavailable.".to_string())?;
            dispatch(operation)
        })
        .await;
        let result = match result {
            Ok(Ok(value)) => CallToolResult::structured(serde_json::json!({"result": value})),
            Ok(Err(error)) => CallToolResult::error(vec![ContentBlock::text(error)]),
            Err(_) => CallToolResult::error(vec![ContentBlock::text("MCP operation failed.")]),
        };
        Ok(result.into())
    }
}

async fn authenticate(
    State(expected): State<Arc<String>>,
    request: Request,
    next: Next,
) -> Response {
    if request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        != Some(expected.as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            "A valid MCP bearer token is required.",
        )
            .into_response();
    }
    next.run(request).await
}

fn router(token: String, port: u16, cancel: CancellationToken, dispatch: Dispatcher) -> Router {
    let mut config = StreamableHttpServerConfig::default().enforce_origin_validation();
    config.legacy_session_mode = false;
    config.json_response = true;
    config.max_request_body_bytes = 65_536;
    config.cancellation_token = cancel;
    config.allowed_hosts = vec![format!("127.0.0.1:{port}")];
    // Native clients omit Origin. Browser origins are intentionally not enabled.
    let server = EmbeddedServer {
        dispatch,
        operation_lock: Arc::new(Mutex::new(())),
    };
    let service = StreamableHttpService::new(
        move || Ok(server.clone()),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            Arc::new(format!("Bearer {token}")),
            authenticate,
        ))
}

fn settings(token: Option<String>, port: Option<String>) -> Result<Option<(String, u16)>, String> {
    let Some(token) = token else { return Ok(None) };
    if token.len() < 32 || !token.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(
            "VOXELSHIFT_MCP_TOKEN must contain at least 32 visible ASCII characters.".into(),
        );
    }
    let port = port
        .unwrap_or_else(|| "47831".into())
        .parse::<u16>()
        .map_err(|_| "Invalid VOXELSHIFT_MCP_PORT.".to_string())?;
    if port == 0 {
        return Err("VOXELSHIFT_MCP_PORT must be nonzero.".into());
    }
    Ok(Some((token, port)))
}

fn new_settings() -> Result<McpSettings, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Unable to generate MCP token: {e}"))?;
    Ok(McpSettings {
        enabled: false,
        port: 47831,
        token: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
    })
}

fn save_settings(path: &Path, settings: &McpSettings) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid MCP settings path.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&temporary, path).map_err(|e| format!("Unable to save MCP settings: {e}"))
}

fn load_settings(path: &Path) -> Result<McpSettings, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let saved: McpSettings =
                serde_json::from_slice(&bytes).map_err(|e| format!("Invalid MCP settings: {e}"))?;
            settings(Some(saved.token.clone()), Some(saved.port.to_string()))?;
            Ok(saved)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut saved = new_settings()?;
            // Import the previous environment-based setup once. UI settings win thereafter.
            if let Some((token, port)) = settings(
                std::env::var("VOXELSHIFT_MCP_TOKEN").ok(),
                std::env::var("VOXELSHIFT_MCP_PORT").ok(),
            )? {
                saved = McpSettings {
                    enabled: true,
                    port,
                    token,
                };
            }
            save_settings(path, &saved)?;
            Ok(saved)
        }
        Err(error) => Err(format!("Unable to read MCP settings: {error}")),
    }
}

fn bind(port: u16) -> Result<std::net::TcpListener, String> {
    if port == 0 {
        return Err("Choose a port from 1 to 65535.".into());
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Cannot use port {port}: {e}. Choose another port."))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(listener)
}

fn start(
    listener: std::net::TcpListener,
    saved: &McpSettings,
    shutdown: &CancellationToken,
    dispatch: Dispatcher,
) -> RunningServer {
    let cancel = shutdown.child_token();
    let task_cancel = cancel.clone();
    let token = saved.token.clone();
    let port = saved.port;
    let task = tauri::async_runtime::spawn(async move {
        let result = async {
            let listener = tokio::net::TcpListener::from_std(listener)?;
            axum::serve(listener, router(token, port, task_cancel.clone(), dispatch))
                .with_graceful_shutdown(task_cancel.cancelled_owned())
                .await
        }
        .await;
        if let Err(error) = result {
            eprintln!("MCP server stopped: {error}");
        }
    });
    RunningServer { cancel, task }
}

pub(super) fn initialize(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("mcp-settings.json");
    let saved = load_settings(&path)?;
    let shutdown = CancellationToken::new();
    let mut runtime = Runtime {
        settings: saved,
        server: None,
        error: None,
    };
    if runtime.settings.enabled {
        match bind(runtime.settings.port) {
            Ok(listener) => {
                let app = app.clone();
                runtime.server = Some(start(
                    listener,
                    &runtime.settings,
                    &shutdown,
                    Arc::new(move |op| dispatch(&app, op)),
                ));
            }
            Err(error) => runtime.error = Some(error),
        }
    }
    app.manage(McpServerControl {
        shutdown,
        runtime: tokio::sync::Mutex::new(runtime),
        path,
    });
    Ok(())
}

#[tauri::command]
pub(super) async fn get_mcp_settings(
    control: tauri::State<'_, McpServerControl>,
) -> Result<McpSettingsStatus, String> {
    Ok(control.runtime.lock().await.status())
}

async fn update(
    control: &McpServerControl,
    enabled: bool,
    port: u16,
    dispatch: Dispatcher,
) -> Result<McpSettingsStatus, String> {
    if port == 0 {
        return Err("Choose a port from 1 to 65535.".into());
    }
    let mut runtime = control.runtime.lock().await;
    let unchanged_server = enabled && port == runtime.settings.port && runtime.status().running;
    // Reserve the new port before altering saved settings or stopping a working server.
    let listener = if enabled && !unchanged_server {
        Some(bind(port)?)
    } else {
        None
    };
    let saved = McpSettings {
        enabled,
        port,
        token: runtime.settings.token.clone(),
    };
    save_settings(&control.path, &saved)?;
    if !unchanged_server {
        if let Some(mut server) = runtime.server.take() {
            server.cancel.cancel();
            if tokio::time::timeout(Duration::from_secs(2), &mut server.task)
                .await
                .is_err()
            {
                server.task.abort();
                let _ = server.task.await;
            }
        }
        if let Some(listener) = listener {
            runtime.server = Some(start(listener, &saved, &control.shutdown, dispatch));
        }
    }
    runtime.settings = saved;
    runtime.error = None;
    Ok(runtime.status())
}

#[tauri::command]
pub(super) async fn set_mcp_settings(
    app: AppHandle,
    control: tauri::State<'_, McpServerControl>,
    enabled: bool,
    port: u16,
) -> Result<McpSettingsStatus, String> {
    update(
        control.inner(),
        enabled,
        port,
        Arc::new(move |op| dispatch(&app, op)),
    )
    .await
}
fn dispatch(app: &AppHandle, operation: Operation) -> Result<serde_json::Value, String> {
    let result = match operation {
        Operation::AppAction(name, args) => return catalog::dispatch(app, &name, args),
        Operation::LauncherState => serde_json::to_value(get_launcher_state(app.clone())?),
        Operation::RecentProjects => serde_json::to_value(get_recent_projects(app.clone())?),
        Operation::RunningBlenders => serde_json::to_value(get_running_blenders(app.state())?),
        Operation::Logs(args) => {
            serde_json::to_value(get_running_blender_logs(app.state(), args.instance_id)?)
        }
        Operation::Launch(args) => {
            let state = launch_blender_project(
                app.clone(),
                app.state(),
                LaunchProjectRequest {
                    id: args.id,
                    project_path: args.project_path,
                },
            )?;
            let _ = app.emit("launcher-state-updated", &state);
            serde_json::to_value(state)
        }
    };
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn status_reports_disabled_stopped_and_failed_servers() {
        let mut runtime = Runtime {
            settings: new_settings().unwrap(),
            server: None,
            error: None,
        };
        assert!(!runtime.status().running);
        assert!(runtime.status().error.is_none());
        runtime.settings.enabled = true;
        assert_eq!(
            runtime.status().error.as_deref(),
            Some("MCP is not running. Save settings to retry.")
        );
        runtime.error = Some("Port occupied".into());
        assert_eq!(runtime.status().error.as_deref(), Some("Port occupied"));
        assert!(runtime.status().settings.enabled);
    }

    #[tokio::test]
    async fn zero_port_is_rejected_without_changing_settings_or_dispatching() {
        let saved = new_settings().unwrap();
        let control = McpServerControl {
            shutdown: CancellationToken::new(),
            path: std::env::temp_dir()
                .join(format!("voxelshift-invalid-port-{}", saved.token))
                .join("settings.json"),
            runtime: tokio::sync::Mutex::new(Runtime {
                settings: saved.clone(),
                server: None,
                error: None,
            }),
        };
        let dispatch: Dispatcher =
            Arc::new(|_| panic!("Invalid settings must not dispatch actions"));
        for enabled in [false, true] {
            let error = update(&control, enabled, 0, dispatch.clone())
                .await
                .err()
                .unwrap();
            assert_eq!(error, "Choose a port from 1 to 65535.");
            let status = control.runtime.lock().await.status();
            assert_eq!(status.settings.port, saved.port);
            assert_eq!(status.settings.token, saved.token);
            assert!(!status.settings.enabled);
            assert!(!control.path.exists());
        }
        assert_eq!(bind(0).unwrap_err(), "Choose a port from 1 to 65535.");
        control.stop();
        assert!(control.shutdown.is_cancelled());
    }

    #[test]
    fn rejects_corrupt_and_invalid_persisted_settings() {
        let saved = new_settings().unwrap();
        let directory =
            std::env::temp_dir().join(format!("voxelshift-corrupt-settings-{}", saved.token));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.json");
        for contents in [
            "{broken".to_string(),
            json!({"enabled":true,"port":47831}).to_string(),
        ] {
            fs::write(&path, contents).unwrap();
            assert!(load_settings(&path)
                .err()
                .unwrap()
                .starts_with("Invalid MCP settings:"));
        }
        for (token, port) in [("short".to_string(), 47831), (saved.token.clone(), 0)] {
            fs::write(
                &path,
                json!({"enabled":false,"port":port,"token":token}).to_string(),
            )
            .unwrap();
            assert!(load_settings(&path).is_err());
        }
        assert!(load_settings(&directory)
            .err()
            .unwrap()
            .starts_with("Unable to read MCP settings:"));
        // All paths are isolated in this test's newly created temporary directory.
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn resolves_read_only_operations_and_preserves_project_arguments() {
        assert!(matches!(
            parse_operation("get_recent_projects", JsonObject::new()).unwrap(),
            Operation::RecentProjects
        ));
        assert!(matches!(
            parse_operation("get_running_blenders", JsonObject::new()).unwrap(),
            Operation::RunningBlenders
        ));
        let args = json!({"id":"v1", "projectPath":"D:/Project files/é.blend"});
        match parse_operation("launch_blender_project", args.as_object().unwrap().clone()).unwrap()
        {
            Operation::Launch(project) => {
                assert_eq!(project.id, "v1");
                assert_eq!(project.project_path, "D:/Project files/é.blend");
            }
            other => panic!("Unexpected operation: {other:?}"),
        }
        let server = EmbeddedServer {
            dispatch: Arc::new(|_| Ok(json!([]))),
            operation_lock: Arc::new(Mutex::new(())),
        };
        assert!(server.get_tool("get_recent_projects").is_some());
        assert!(server.get_tool("unknown_tool").is_none());
    }

    #[test]
    fn exposes_every_app_command_except_transport_settings() {
        let source = include_str!("lib.rs");
        let commands = source
            .split(".invoke_handler(tauri::generate_handler![")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap();
        let names: BTreeSet<String> = tool_definitions()
            .iter()
            .map(|tool| tool.name.to_string())
            .collect();
        assert_eq!(names.len(), tool_definitions().len());
        for command in commands
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty() && !name.starts_with("mcp::"))
        {
            assert!(names.contains(command), "Missing MCP action: {command}");
        }
    }

    #[test]
    fn validates_nested_planner_and_migration_inputs() {
        let planner = json!({"blendFilePath":"D:/scene.blend","startFrame":1,"endFrame":20,"startAt":1790000000,"shutdownWhenDone":false,"blender":{"source":"library","versionId":"v1"}});
        let parsed =
            parse_operation("create_planner_run", planner.as_object().unwrap().clone()).unwrap();
        assert!(matches!(parsed, Operation::AppAction(_, _)));
        assert!(
            serde_json::from_value::<planner::CreatePlannerRunRequest>(planner.clone()).is_ok()
        );
        for (field, value) in [
            ("startFrame", json!(-1)),
            ("startAt", json!("tomorrow")),
            ("shutdownWhenDone", json!("false")),
            ("unknown", json!(true)),
        ] {
            let mut invalid = planner.clone();
            invalid[field] = value;
            assert!(
                parse_operation("create_planner_run", invalid.as_object().unwrap().clone())
                    .is_err()
            );
        }
        let mut nested = planner.clone();
        nested["blender"]["extraArgs"] = json!("--python foo.py");
        assert!(
            parse_operation("create_planner_run", nested.as_object().unwrap().clone()).is_err()
        );
        let update = json!({"runId":"run-1","request":planner});
        assert!(parse_operation("update_planner_run", update.as_object().unwrap().clone()).is_ok());
        let mut install = json!({"id":"r1","version":"5.2.1","fileName":"blender.zip","url":"https://download.blender.org/release/blender.zip","migration":{"extensionMode":"symlink","extensionsPath":"D:/extensions","extensionOverrides":[{"linkPath":"user_default/test","targetPath":"D:/test","mode":"copy"}]}});
        assert!(parse_operation(
            "install_blender_release",
            install.as_object().unwrap().clone()
        )
        .is_ok());
        assert!(serde_json::from_value::<InstallReleaseRequest>(install.clone()).is_ok());
        install["migration"]["extensionOverrides"][0]["mode"] = json!("invalid");
        assert!(parse_operation(
            "install_blender_release",
            install.as_object().unwrap().clone()
        )
        .is_err());
    }

    #[tokio::test]
    async fn cancellation_is_not_blocked_by_an_installation() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("http://127.0.0.1:{port}/mcp");
        let token = "x".repeat(32);
        let started = Arc::new(tokio::sync::Notify::new());
        let start_signal = started.clone();
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let dispatch_gate = gate.clone();
        let dispatch: Dispatcher = Arc::new(move |op| {
            if matches!(op, Operation::AppAction(ref name, _) if name == "install_blender_release")
            {
                start_signal.notify_one();
                let (lock, signal) = &*dispatch_gate;
                let _guard = signal
                    .wait_while(lock.lock().unwrap(), |released| !*released)
                    .unwrap();
            }
            Ok(json!({"ok":true}))
        });
        let cancel = CancellationToken::new();
        let shutdown = cancel.clone();
        let app = router(token.clone(), port, cancel.clone(), dispatch);
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
                .unwrap();
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap();
        let install_client = client.clone();
        let install_url = url.clone();
        let install_token = token.clone();
        let installation = tokio::spawn(async move {
            rpc(&install_client,&install_url,&install_token,json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"install_blender_release","arguments":{"id":"r1","version":"5.2.1","fileName":"blender.zip","url":"https://download.blender.org/release/blender.zip"}}})).await
        });
        let did_start = tokio::time::timeout(Duration::from_secs(3), started.notified()).await;
        let canceled = tokio::time::timeout(Duration::from_secs(3),rpc(&client,&url,&token,json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"cancel_blender_release_install","arguments":{"id":"r1"}}}))).await;
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        let installed = installation.await.unwrap();
        cancel.cancel();
        server.await.unwrap();
        assert!(did_start.is_ok());
        assert_eq!(
            canceled.expect("Cancellation was blocked").1["result"]["structuredContent"]["result"]
                ["ok"],
            true
        );
        assert_eq!(
            installed.1["result"]["structuredContent"]["result"]["ok"],
            true
        );
    }

    #[test]
    fn validates_settings_and_dispatch_arguments() {
        assert!(settings(None, None).unwrap().is_none());
        assert!(settings(Some("short".into()), None).is_err());
        assert!(settings(Some("x".repeat(32)), Some("0".into())).is_err());
        assert!(settings(Some(format!("{}\n", "x".repeat(32))), None).is_err());
        assert_eq!(
            settings(Some("x".repeat(32)), None).unwrap().unwrap().1,
            47831
        );
        assert!(parse_operation("launch_blender_project", JsonObject::new()).is_err());
        assert!(parse_operation("execute", JsonObject::new()).is_err());
        let extra = json!({"id":"v1", "projectPath":"a.blend", "extraArgs":"--python x.py"});
        assert!(
            parse_operation("launch_blender_project", extra.as_object().unwrap().clone()).is_err()
        );
    }

    async fn rpc(
        client: &reqwest::Client,
        url: &str,
        token: &str,
        body: Value,
    ) -> (reqwest::StatusCode, Value) {
        let response = client
            .post(url)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", "2025-11-25")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let status = response.status();
        let text = response.text().await.unwrap();
        let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        (status, value)
    }

    #[tokio::test]
    async fn settings_enable_rebind_disable_and_persist_without_losing_working_server() {
        let saved = new_settings().unwrap();
        let directory = std::env::temp_dir().join(format!("voxelshift-mcp-{}", saved.token));
        let path = directory.join("mcp-settings.json");
        save_settings(&path, &saved).unwrap();
        let mut control = McpServerControl {
            shutdown: CancellationToken::new(),
            runtime: tokio::sync::Mutex::new(Runtime {
                settings: saved,
                server: None,
                error: None,
            }),
            path: path.clone(),
        };
        let dispatch: Dispatcher = Arc::new(|_| Ok(json!([])));
        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        assert!(
            update(&control, true, port, dispatch.clone())
                .await
                .unwrap()
                .running
        );
        // Saving an unchanged port must reuse the existing listener.
        assert!(
            update(&control, true, port, dispatch.clone())
                .await
                .unwrap()
                .running
        );
        let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        assert!(update(&control, true, occupied_port, dispatch.clone())
            .await
            .is_err());
        assert!(control.runtime.lock().await.status().running);
        assert_eq!(load_settings(&path).unwrap().port, port);
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_ok());
        // A persistence failure must not stop the existing listener either.
        let blocked_path = directory.join("blocked");
        fs::create_dir(&blocked_path).unwrap();
        control.path = blocked_path;
        assert!(update(&control, false, port, dispatch.clone())
            .await
            .is_err());
        assert!(control.runtime.lock().await.status().running);
        control.path = path.clone();
        drop(occupied);
        assert!(
            update(&control, true, occupied_port, dispatch.clone())
                .await
                .unwrap()
                .running
        );
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
        assert!(
            !update(&control, false, occupied_port, dispatch)
                .await
                .unwrap()
                .running
        );
        assert!(std::net::TcpListener::bind(("127.0.0.1", occupied_port)).is_ok());
        let reloaded = load_settings(&path).unwrap();
        assert!(!reloaded.enabled);
        assert_eq!(reloaded.port, occupied_port);
        assert_eq!(reloaded.token, control.runtime.lock().await.settings.token);
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn http_mcp_auth_discovery_calls_and_shutdown() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("http://127.0.0.1:{port}/mcp");
        let token = "x".repeat(32);
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let dispatch: Dispatcher = Arc::new(move |operation| {
            calls.fetch_add(1, Ordering::SeqCst);
            match operation {
                Operation::LauncherState => Ok(json!({"versions":[]})),
                Operation::Launch(args) => {
                    Ok(json!({"id": args.id, "projectPath": args.project_path}))
                }
                Operation::Logs(_) => Err("Unknown Blender instance.".into()),
                _ => Ok(json!([])),
            }
        });
        let cancel = CancellationToken::new();
        let shutdown = cancel.clone();
        let app = router(token.clone(), port, cancel.clone(), dispatch);
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
                .unwrap();
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let initialize = json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
            "protocolVersion":"2025-11-25", "capabilities":{}, "clientInfo":{"name":"test","version":"1"}
        }});
        assert_eq!(
            rpc(&client, &url, "wrong", initialize.clone()).await.0,
            reqwest::StatusCode::UNAUTHORIZED
        );
        let (status, info) = rpc(&client, &url, &token, initialize).await;
        assert_eq!(status, reqwest::StatusCode::OK, "{info}");
        assert_eq!(info["result"]["serverInfo"]["name"], "voxelshift");
        let (status, _) = rpc(
            &client,
            &url,
            &token,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::ACCEPTED);
        let (_, tools) = rpc(
            &client,
            &url,
            &token,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .await;
        assert_eq!(
            tools["result"]["tools"].as_array().unwrap().len(),
            40,
            "{tools}"
        );
        let (_, result) = rpc(&client, &url, &token, json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_launcher_state","arguments":{}}})).await;
        assert_eq!(
            result["result"]["structuredContent"]["result"]["versions"],
            json!([]),
            "{result}"
        );
        let (_, invalid) = rpc(&client, &url, &token, json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"launch_blender_project","arguments":{"id":"v1"}}})).await;
        assert_eq!(invalid["result"]["isError"], true, "{invalid}");
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let (_, launched) = rpc(&client, &url, &token, json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"launch_blender_project","arguments":{"id":"v1","projectPath":"D:/scene.blend"}}})).await;
        assert_eq!(
            launched["result"]["structuredContent"]["result"]["id"], "v1",
            "{launched}"
        );
        let (_, error) = rpc(&client, &url, &token, json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_running_blender_logs","arguments":{"instanceId":"missing"}}})).await;
        assert_eq!(error["result"]["isError"], true, "{error}");
        for (header_name, value) in [
            ("Origin", "https://untrusted.example"),
            ("Host", "untrusted.example"),
        ] {
            let response = client
                .post(&url)
                .bearer_auth(&token)
                .header(header_name, value)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .body("{}")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
        }
        let response = client
            .post(&url)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(" ".repeat(65_537))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert!(client.post(&url).send().await.is_err());
    }
}
