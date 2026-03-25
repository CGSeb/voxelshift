import { ChevronDown, ChevronUp, FileCode, SquareStop } from "lucide-react";
import type { BlenderSession } from "../../types";
import { Tooltip } from "../Tooltip";

interface RunningBlenderTrayProps {
  processes: BlenderSession[];
  isOpen: boolean;
  onToggle: () => void;
  onOpenLogs: (process: BlenderSession) => void;
  onStop: (process: BlenderSession) => void;
}

function formatStartedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatSessionLabel(process: BlenderSession) {
  if (!process.projectPath) {
    return "Empty session";
  }

  const segments = process.projectPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? process.projectPath;
}

function formatTrayLabel(processes: BlenderSession[]) {
  const runningCount = processes.filter((process) => process.isRunning).length;
  const recentCount = processes.length - runningCount;

  if (recentCount === 0) {
    return runningCount === 1 ? "1 running" : `${runningCount} running`;
  }

  if (runningCount === 0) {
    return recentCount === 1 ? "1 recent session" : `${recentCount} recent sessions`;
  }

  return `${runningCount} running, ${recentCount} recent`;
}

export function RunningBlenderTray({ processes, isOpen, onToggle, onOpenLogs, onStop }: RunningBlenderTrayProps) {
  const trayLabel = formatTrayLabel(processes);
  const runningCount = processes.filter((process) => process.isRunning).length;

  return (
    <section className={`running-blender-tray${isOpen ? " running-blender-tray-open" : ""}`} aria-label="Running Blender sessions">
      <div className="running-blender-tray-header">
        <div className="running-blender-tray-copy">
          <span className={`running-blender-tray-dot${runningCount === 0 ? " running-blender-tray-dot-idle" : ""}`} aria-hidden="true" />
          <strong>{trayLabel}</strong>
        </div>
        <button
          className="running-blender-tray-toggle"
          type="button"
          aria-expanded={isOpen}
          aria-controls="running-blender-tray-list"
          aria-label={isOpen ? "Collapse Blender tray" : "Open Blender tray"}
          onClick={onToggle}
        >
          {isOpen ? <ChevronDown size={16} strokeWidth={2.4} aria-hidden="true" /> : <ChevronUp size={16} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      </div>

      {isOpen ? (
        <div className="running-blender-tray-list" id="running-blender-tray-list">
          <div className="release-list running-blender-release-list" role="table" aria-label="Running Blender sessions table">
            <div className="release-row release-list-header running-blender-release-row" role="row">
              <span className="running-blender-release-session-heading" role="columnheader">
                Session
              </span>
              <span role="columnheader">Version</span>
              <span role="columnheader">Started</span>
              <span role="columnheader">PID</span>
              <span role="columnheader">Status</span>
              <span className="release-actions-heading" role="columnheader">
                Actions
              </span>
            </div>

            {processes.map((process) => {
              const statusLabel = !process.isRunning ? "Closed" : process.isStopping ? "Stopping" : "Running";
              const logsLabel = process.isRunning ? "View live logs" : "View logs";
              const isMutedStatus = !process.isRunning || process.isStopping;

              return (
                <article key={process.instanceId} className="release-row release-row-item running-blender-release-row" role="row">
                  <div className="release-version-cell release-primary running-blender-row-session" role="cell">
                    <div className="release-version-meta">
                      <strong>{formatSessionLabel(process)}</strong>
                    </div>
                  </div>
                  <div className="running-blender-row-value" role="cell">
                    {process.blenderVersion ? `Blender ${process.blenderVersion}` : process.blenderDisplayName}
                  </div>
                  <div className="running-blender-row-value release-package" role="cell">
                    {formatStartedAt(process.startedAt)}
                  </div>
                  <div className="running-blender-row-value release-package" role="cell">
                    {process.pid}
                  </div>
                  <div className="running-blender-row-status" role="cell">
                    <span className={`home-card-status${isMutedStatus ? " home-card-status-missing" : ""}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="release-actions running-blender-row-actions" role="cell">
                    <Tooltip content={logsLabel}>
                      <button
                        className="running-blender-action-button"
                        type="button"
                        onClick={() => onOpenLogs(process)}
                        aria-label={logsLabel}
                      >
                        <FileCode className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                      </button>
                    </Tooltip>
                    {process.isRunning ? (
                      <Tooltip content={process.isStopping ? "Stopping Blender" : "Stop Blender"}>
                        <button
                          className="running-blender-action-button running-blender-action-button-danger"
                          type="button"
                          onClick={() => onStop(process)}
                          disabled={process.isStopping}
                          aria-label="Stop Blender"
                        >
                          <SquareStop className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} fill="currentColor" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}