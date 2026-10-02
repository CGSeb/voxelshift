# Embedded Voxel Shift MCP

Voxel Shift serves MCP directly from its Rust backend at
`http://127.0.0.1:47831/mcp` using Streamable HTTP and the official Rust MCP SDK.
The packaged app needs no Node installation, adapter process, or separate server.
The endpoint runs while Voxel Shift is open and stops when the app exits.

## Available tools

The server exposes 40 tools using the same backend operations and validation as
the app. Changes update the launcher, recent projects, config library, running
sessions, install progress, and planner UI.

| Area | Tools |
| --- | --- |
| Blender library | `get_launcher_state`, `scan_for_blender_versions`, `register_blender_version`, `set_default_blender_version`, `remove_blender_version`, `add_scan_root`, `remove_scan_root`, `open_version_location` |
| Projects and sessions | `get_recent_projects`, `remove_recent_project`, `launch_blender`, `launch_blender_project`, `get_running_blenders`, `get_running_blender_logs`, `stop_running_blender` |
| Releases and installation | `get_blender_lts_release_lines`, `get_blender_release_downloads`, `install_blender_release`, `cancel_blender_release_install`, `get_install_migration_folders`, `get_install_migration_links`, `refresh_managed_blender_extensions` |
| Portable configurations | `get_blender_configs`, `save_blender_config`, `apply_blender_config`, `remove_blender_config` |
| Render planner | `get_planner_runs`, `get_planner_logs`, `create_planner_run`, `update_planner_run`, `delete_planner_run`, `get_planner_queue`, `set_planner_queue_paused`, `reorder_planner_queue`, `cancel_planner_run`, `retry_planner_run` |
| Native file pickers | `pick_planner_blend_file`, `pick_planner_blender_executable`, `pick_planner_output_folder`, `pick_install_migration_folder` |

MCP connection settings and the access token remain local to the settings modal.
App updates and UI-only preferences such as favorites/navigation are not MCP tools.
`cancel_planner_run` stops a pending or running job and keeps its history and outputs
already written. `retry_planner_run` creates a new attempt from a failed/cancelled job,
starting from its first frame now with the same settings. It may overwrite outputs;
if the original job has `shutdownWhenDone: true`, confirm that behavior before retrying.
Deleting a running job is rejected; cancel it first and wait for its process to stop.

`get_planner_queue` returns `paused` and ordered `pendingRunIds`.
`set_planner_queue_paused` accepts `{ "paused": true }` (or `false` to resume); the
current render continues. `reorder_planner_queue` accepts `{ "runIds": [...] }`,
including every pending ID exactly once. Refresh the queue before reordering; stale,
duplicate or missing IDs are rejected. Queue order and pause state persist across
restarts. Among jobs whose scheduled time has arrived, queue priority determines
the next render; a future job never blocks due jobs.

### Tool arguments

Clients discover the complete input schemas through `tools/list`. Most arguments
are passed directly at the top level, using camelCase field names. For example,
`launch_blender` accepts `id` and optional `extraArgs`; `get_planner_logs` accepts
`runId`. Obtain IDs from the corresponding list tools instead of inventing them.

`create_planner_run` accepts:

```json
{
  "blendFilePath": "D:/Projects/scene.blend",
  "startFrame": 1,
  "endFrame": 120,
  "startAt": 1790884800,
  "outputFolderPath": "D:/Renders",
  "shutdownWhenDone": false,
  "blender": { "source": "library", "versionId": "<installed-version-id>" }
}
```

`startAt` is a Unix timestamp in **seconds**, not milliseconds; replace the example
with the intended schedule. For a custom executable, use `source: "custom"` and
`executablePath` instead of `versionId`. `update_planner_run` takes `runId` and a
`request` object containing the complete replacement fields shown above.

For installations, pass the `id`, `version`, `fileName`, and `url` returned by
`get_blender_release_downloads`. Optional `migration` supports the app's settings,
add-on and extension folders, copy/symlink mode, and per-extension overrides.
Use the migration inspection tools to discover the available folders and links.

Installation can take several minutes. Increase the client's tool timeout for
`install_blender_release` if supported. Cancellation requests can run concurrently
with installation. A timeout does not cancel the operation: inspect installed
versions or the app's progress before retrying. Native picker tools wait for the
user to choose a path or cancel; prefer passing a known path when possible.

## Enable the endpoint

Click **MCP** beside the update status in the bottom bar to open its settings. The status circle is black when disabled, green when running, and red when the server is unavailable or has an error. Then:

1. Turn on **Enable MCP server**.
2. Choose a port (default `47831`, valid range `1–65535`).
3. Click **Save settings**.
4. Copy the **Connection URL** and **Access token** into your MCP client.

Changes start, stop, or rebind the server immediately; no app restart is needed.
If the selected port is occupied, the previous server and settings remain intact.
Closing the modal without saving discards edits. Disabling the server stops new
connections; operations already accepted may finish.

Settings and a generated random token are stored in `mcp-settings.json` in the
user's Tauri app-data directory and restored on the next launch. The token is
stored locally in plaintext, so treat that file as a credential. It is masked in
the modal and can be copied using **Copy access token**.

For existing environment-based installations, `VOXELSHIFT_MCP_TOKEN` and
`VOXELSHIFT_MCP_PORT` are imported only when no settings file exists. Saved UI
settings take precedence afterward. New installations start disabled.

## Connect an MCP client

Voxel Shift works with MCP clients that support **Streamable HTTP**, can reach
this computer's loopback interface, and can send a bearer token or custom
`Authorization` header. The connection settings are the same regardless of the
client; configuration file formats and field names vary between clients.

### Connection settings

| Setting | Value |
| --- | --- |
| Server name | `Voxel Shift` (or a name of your choice) |
| Transport | **Streamable HTTP** (sometimes labeled **HTTP**) |
| Server URL | Copy **Connection URL** from Voxel Shift Settings; default: `http://127.0.0.1:47831/mcp` |
| Authentication | **Bearer token**, using the **Access token** from Settings |
| Custom header alternative | Header name: `Authorization`; value: `Bearer <access-token>` |

1. Open Voxel Shift and enable its MCP server in **Settings**.
2. In your client's MCP settings, add an HTTP server using the URL above.
3. Paste the access token into the client's bearer-token field. If it only offers
   custom headers, add the `Authorization` header instead.
4. Save the connection and reconnect or refresh the client's MCP tools.
5. Ask the assistant to list installed Blender versions to verify the connection.

For a dedicated bearer-token field, enter only the token. For a custom header,
include the `Bearer ` prefix, including the space:

```http
Authorization: Bearer <access-token-copied-from-voxel-shift>
```

Prefer the client's secret store or environment-variable support when available.
Keep the token out of committed configuration files and prompts. Voxel Shift
already saves its token; you do not need to set environment variables in the app.
If your client reads its token from an environment variable, restart that client
after changing its launch environment.

### Client compatibility

- **Local desktop and CLI clients:** connect directly when they support Streamable
  HTTP and bearer authentication. Use the exact `127.0.0.1` URL shown in Settings.
- **Clients that only support stdio:** cannot connect directly. They need a separate
  Streamable HTTP-to-stdio adapter that forwards the bearer token; Voxel Shift
  does not bundle one. Do not configure the app executable as a stdio MCP command.
- **Legacy SSE clients:** the older HTTP+SSE transport is not the same as Streamable
  HTTP. Select Streamable HTTP or use a compatible adapter.
- **Browser and cloud-hosted clients:** cannot generally use this local endpoint
  directly. Browser-origin requests are rejected, and a cloud service's
  `127.0.0.1` points to its own environment. They require a compatible local
  connector or gateway; remote access is not provided by Voxel Shift.
- **Clients requiring OAuth:** this endpoint uses a pre-shared bearer token and
  does not provide an OAuth sign-in flow.

No Node installation or separate server process is needed for a client that can
connect directly. Keep Voxel Shift open while using its tools.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Connection refused | Voxel Shift is open, the server status is **Running**, and the client URL matches the saved port. |
| Unauthorized / HTTP 401 | Copy the current access token again. Check whether the client expects a bare token or a complete `Bearer …` header value. |
| Forbidden / HTTP 403 | Use `127.0.0.1`, not `localhost` or another hostname. Browser-origin requests are not supported. |
| Port already in use | Choose another port in Settings, save, and update the client URL. |
| No tools appear | Check the transport selection, then reconnect or refresh the client's tool list. |
| Connection stops after changing settings | Reconnect after enabling the server or changing its port. |

## Behavior and testing

A timeout does not cancel a Blender launch: check running instances before retrying.
Opening a `.blend` file uses Blender's normal script execution settings. The token
grants access to all advertised tools; it is not a per-tool permission system. Removal, config replacement, and force-stop tools can delete data or lose unsaved work. Render jobs can overwrite output files, and shutdownWhenDone can shut down the computer. Tool annotations identify these side effects for the client.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib mcp
```

Tests use a real ephemeral localhost HTTP endpoint to verify authentication,
initialization, discovery, tool arguments/results/errors, Host/Origin validation,
request size limits, and shutdown. Backend dispatch is substituted in the protocol
test; live launching still requires an installed Blender and a `.blend` file.
The existing Rust CI coverage step includes these tests.




