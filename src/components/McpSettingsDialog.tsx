import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getMcpSettings, setMcpSettings, type McpSettingsStatus } from "../lib/api";

export function McpSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState<McpSettingsStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState("47831");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    void getMcpSettings().then((value) => {
      if (disposed) return;
      setSettings(value); setEnabled(value.enabled); setPort(String(value.port));
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => {
      disposed = true;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
    }
    if (event.key === "Tab") {
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
        event.preventDefault(); first.focus();
      }
    }
  }

  const validPort = /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
  async function save() {
    if (!validPort || busy || !settings) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = await setMcpSettings(enabled, Number(port));
      setSettings(value); setEnabled(value.enabled); setPort(String(value.port));
      onSaved?.();
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function copyToken() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.token);
      setNotice("Access token copied.");
    } catch { setError("Could not copy the access token. Select and copy it from the field."); }
  }

  return (
    <div className="confirm-dialog-backdrop" onClick={busy ? undefined : onClose}>
      <section className="confirm-dialog mcp-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-settings-title"
        ref={panel} tabIndex={-1} onKeyDown={handleKeys} onClick={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-copy">
          <p className="section-kicker">Settings</p>
          <h2 id="mcp-settings-title">MCP connection</h2>
          <p className="confirm-dialog-description">Let AI assistants connect to Voxel Shift on this computer.</p>
        </div>
        {!settings && !error ? <p role="status">Loading settings…</p> : null}
        {settings ? <>
          <label className="mcp-toggle-row">
            <span><strong>Enable MCP server</strong><small>Changes apply when you save. Voxel Shift must stay open.</small></span>
            <input type="checkbox" role="switch" aria-label="Enable MCP server" checked={enabled} disabled={busy}
              onChange={(event) => { setEnabled(event.target.checked); setNotice(null); }} />
          </label>
          <label className="release-config-field" htmlFor="mcp-port">
            <span>Port</span>
            <input className="release-config-input" id="mcp-port" type="number" min="1" max="65535" step="1"
              value={port} disabled={busy} aria-invalid={!validPort} aria-describedby={!validPort ? "mcp-port-error" : undefined}
              onChange={(event) => { setPort(event.target.value); setNotice(null); }} />
          </label>
          {!validPort ? <p id="mcp-port-error" className="confirm-dialog-error">Choose a whole number from 1 to 65535.</p> : null}
          <div className="mcp-connection-details">
            <p role="status">Server: <strong>{settings.running ? "Running" : "Stopped"}</strong></p>
            <label className="release-config-field" htmlFor="mcp-url"><span>Connection URL</span>
              <input className="release-config-input" id="mcp-url" readOnly value={validPort ? `http://127.0.0.1:${Number(port)}/mcp` : ""} placeholder="Enter a valid port" />
            </label>
            {validPort && Number(port) !== settings.port ? <p className="confirm-dialog-description">Save settings to use this URL.</p> : null}
            <label className="release-config-field" htmlFor="mcp-token"><span>Access token</span>
              <input className="release-config-input" id="mcp-token" type="password" readOnly value={settings.token} />
            </label>
            <button className="card-action card-action-secondary" type="button" onClick={() => void copyToken()}>Copy access token</button>
            <p className="confirm-dialog-description">Use this token as the bearer token in your MCP client.</p>
          </div>
          {settings.error ? <p role="alert" className="confirm-dialog-error">{settings.error}</p> : null}
        </> : null}
        {error ? <p role="alert" className="confirm-dialog-error">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="confirm-dialog-actions">
          <button className="card-action card-action-secondary" type="button" disabled={busy} onClick={onClose}>Close</button>
          <button className="card-action" type="button" disabled={!settings || !validPort || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </section>
    </div>
  );
}
