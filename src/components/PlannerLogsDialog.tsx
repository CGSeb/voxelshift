import { useEffect, useMemo, useRef } from "react";
import type { PlannerLogEntry, PlannerRunSummary } from "../types";

interface PlannerLogsDialogProps {
  open: boolean;
  run: PlannerRunSummary | null;
  logs: PlannerLogEntry[];
  onClose: () => void;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatRunName(run: PlannerRunSummary) {
  const segments = run.blendFilePath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? run.blendFilePath;
}

export function PlannerLogsDialog({ open, run, logs, onClose }: PlannerLogsDialogProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [logs, open]);

  const runName = useMemo(() => (run ? formatRunName(run) : null), [run]);

  if (!open || !run) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="blender-logs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planner-logs-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="blender-logs-dialog-header">
          <div className="blender-logs-dialog-copy">
            <p className="page-eyebrow">{run.status === "running" ? "Live Planner Logs" : "Planner Run Logs"}</p>
            <h2 id="planner-logs-dialog-title">{runName}</h2>
            <p className="blender-logs-dialog-description">
              {run.blenderTarget.displayName}
              {run.pid ? ` - PID ${run.pid}` : ""}
            </p>
          </div>
          <button className="card-action card-action-secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="blender-logs-stream" ref={streamRef} role="log" aria-live="polite" aria-label="Planner render logs">
          {logs.length > 0 ? (
            logs.map((entry) => (
              <div key={entry.id} className={`blender-log-line blender-log-line-${entry.source}`}>
                <span className="blender-log-time">{formatTimestamp(entry.timestamp)}</span>
                <span className="blender-log-source">{entry.source}</span>
                <span className="blender-log-message">{entry.message}</span>
              </div>
            ))
          ) : (
            <p className="blender-logs-empty-state">
              {run.status === "running" ? "Waiting for Blender to write render logs." : "No logs were captured for this planner run."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
