import { CheckCircle2, Download, LoaderCircle, X } from "lucide-react";
import type { AppUpdateInfo } from "../lib/updater";

interface AppUpdateToastProps {
  phase: "checking" | "idle" | "available" | "downloading" | "installing" | "completed" | "failed" | "unavailable";
  updateInfo: AppUpdateInfo | null;
  errorMessage: string | null;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  actionLabel: string | null;
  canDismiss: boolean;
  onInstallUpdate: (() => void) | null;
  onClose: () => void;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatUpdateDate(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function formatBytes(value: number) {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const normalized = value / 1024 ** exponent;
  const digits = normalized >= 100 || exponent === 0 ? 0 : normalized >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits)} ${units[exponent]}`;
}

export function AppUpdateToast({
  phase,
  updateInfo,
  errorMessage,
  progressPercent,
  downloadedBytes,
  totalBytes,
  actionLabel,
  canDismiss,
  onInstallUpdate,
  onClose,
}: AppUpdateToastProps) {
  const versionLabel = updateInfo ? `v${updateInfo.currentVersion} -> v${updateInfo.version}` : null;
  const releaseDateLabel = formatUpdateDate(updateInfo?.date);
  const showProgress = phase === "downloading" || phase === "installing" || phase === "completed";
  const isIndeterminate = phase === "installing" || (phase === "downloading" && progressPercent === null);
  const progressValue = phase === "completed" ? 100 : progressPercent;
  const releaseNotes = updateInfo?.body?.trim() ?? "";

  let title = "Voxel Shift update";
  let message = "A new update is ready to install.";

  switch (phase) {
    case "available":
      title = updateInfo ? `Voxel Shift ${updateInfo.version} is ready` : "Voxel Shift update ready";
      message = "Install the latest build to get the newest fixes and improvements.";
      break;
    case "downloading":
      title = updateInfo ? `Downloading Voxel Shift ${updateInfo.version}` : "Downloading update";
      message = totalBytes
        ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)} downloaded.`
        : "Downloading the update package.";
      break;
    case "installing":
      title = updateInfo ? `Installing Voxel Shift ${updateInfo.version}` : "Installing update";
      message = "Applying the downloaded update package.";
      break;
    case "completed":
      title = updateInfo ? `Voxel Shift ${updateInfo.version} installed` : "Update installed";
      message = "The update was installed successfully. Restart Voxel Shift if the new build does not open automatically.";
      break;
    case "failed":
      title = updateInfo ? `Voxel Shift ${updateInfo.version} could not update` : "Update failed";
      message = errorMessage ?? "The updater could not finish the installation.";
      break;
    default:
      break;
  }

  return (
    <div className="app-toast-stack" aria-live={phase === "failed" ? "assertive" : "polite"}>
      <aside className={`app-toast app-toast-${phase}`} role={phase === "failed" ? "alert" : "status"}>
        <div className="app-toast-header">
          <div className="app-toast-heading">
            <p className="app-toast-eyebrow">Voxel Shift update</p>
            <h3>{title}</h3>
          </div>

          {canDismiss ? (
            <button className="app-toast-close" type="button" onClick={onClose} aria-label="Dismiss update toast">
              <X size={16} strokeWidth={2} />
            </button>
          ) : (
            <span className="app-toast-lock" aria-hidden="true">
              <LoaderCircle className="app-spinner" size={16} strokeWidth={2} />
            </span>
          )}
        </div>

        <div className="app-toast-body">
          {versionLabel || releaseDateLabel ? (
            <p className="app-toast-meta">
              {versionLabel}
              {versionLabel && releaseDateLabel ? " • " : ""}
              {releaseDateLabel}
            </p>
          ) : null}

          <p className={phase === "failed" ? "app-toast-message app-toast-message-error" : "app-toast-message"}>{message}</p>

          {releaseNotes && phase !== "failed" && phase !== "downloading" && phase !== "installing" ? (
            <p className="app-toast-notes">{releaseNotes}</p>
          ) : null}

          {showProgress ? (
            <div className="app-toast-progress-block">
              <div className="app-toast-progress-track" aria-hidden="true">
                <span
                  className={isIndeterminate ? "app-toast-progress-bar app-toast-progress-bar-indeterminate" : "app-toast-progress-bar"}
                  style={isIndeterminate ? undefined : { width: `${Math.max(4, progressValue ?? 0)}%` }}
                />
              </div>
              <div className="app-toast-progress-meta">
                <span>
                  {phase === "completed"
                    ? "Update package applied"
                    : phase === "installing"
                      ? "Installing update"
                      : progressValue !== null
                        ? `${Math.round(progressValue)}% downloaded`
                        : "Downloading update"}
                </span>
                <span>{totalBytes ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes)}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="app-toast-actions">
          {actionLabel && onInstallUpdate ? (
            <button className="card-action app-toast-primary" type="button" onClick={onInstallUpdate}>
              <Download size={16} strokeWidth={2} />
              <span>{actionLabel}</span>
            </button>
          ) : null}

          {canDismiss ? (
            <button className="card-action card-action-secondary app-toast-secondary" type="button" onClick={onClose}>
              {phase === "available" ? "Later" : "Close"}
            </button>
          ) : null}

          {phase === "completed" ? (
            <span className="app-toast-success">
              <CheckCircle2 size={16} strokeWidth={2} />
              <span>Installed</span>
            </span>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
