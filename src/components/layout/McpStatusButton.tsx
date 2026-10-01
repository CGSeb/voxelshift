import { useEffect, useState } from "react";
import { getMcpSettings } from "../../lib/api";
import { Tooltip } from "../Tooltip";

export function McpStatusButton({ onClick, revision }: { onClick: () => void; revision: number }) {
  const [status, setStatus] = useState<"disabled" | "running" | "error" | "loading">("loading");
  const [detail, setDetail] = useState("Checking MCP server status");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const value = await getMcpSettings();
        if (disposed) return;
        setStatus(value.running ? "running" : value.enabled || value.error ? "error" : "disabled");
        setDetail(value.running ? `MCP running on port ${value.port}` : value.error ?? (value.enabled ? "MCP server is not running" : "MCP disabled"));
      } catch {
        if (disposed) return;
        setStatus("error");
        setDetail("Unable to read MCP server status");
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 5000);
      }
    }
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [revision]);

  return (
    <Tooltip content={`${detail}. Open MCP settings`}>
      <button type="button" className="mcp-status-button" onClick={onClick}
        aria-label={`MCP: ${status === "loading" ? "checking status" : status}. Open settings`}>
        <span className={`running-blender-tray-dot mcp-status-dot-${status}`} aria-hidden="true" />
        <span>MCP</span>
      </button>
    </Tooltip>
  );
}
