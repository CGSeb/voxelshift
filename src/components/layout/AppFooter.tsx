import { CheckCircle2, Download, LoaderCircle } from "lucide-react";
import { Tooltip } from "../Tooltip";

interface AppFooterProps {
  appVersion: string | null;
  updateSummary: string;
  updateTone: "neutral" | "success" | "warning" | "danger";
  updateVersion: string | null;
  detailsLabel: string | null;
  updateActionLabel: string | null;
  isCheckingForUpdates: boolean;
  isUpdating: boolean;
  onInstallUpdate: (() => void) | null;
  onShowUpdateDetails: (() => void) | null;
}

export function AppFooter({
  appVersion,
  updateSummary,
  updateTone,
  updateVersion,
  detailsLabel,
  updateActionLabel,
  isCheckingForUpdates,
  isUpdating,
  onInstallUpdate,
  onShowUpdateDetails,
}: AppFooterProps) {
  const isUpToDate = !isCheckingForUpdates && updateSummary === "You're up to date";

  return (
    <footer className="app-footer" aria-label="Voxel Shift status bar">
      <div className="app-footer-copy">
        <span className="app-footer-label">Voxel Shift</span>
        <span className="app-footer-version">{appVersion ? `v${appVersion}` : "Version unavailable"}</span>
        {isUpToDate ? (
          <Tooltip content="Up to date">
            <span className="app-footer-up-to-date" aria-label="Up to date" tabIndex={0}>
              <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            </span>
          </Tooltip>
        ) : null}
      </div>

      {!isUpToDate ? (
        <div className="app-footer-status-row">
          <span className={`app-footer-status app-footer-status-${updateTone}`}>
            {isCheckingForUpdates ? (
              <>
                <LoaderCircle className="app-footer-status-icon app-spinner" size={14} strokeWidth={2} />
                <span>{updateSummary}</span>
              </>
            ) : (
              <span>{updateSummary}</span>
            )}
          </span>
          {updateVersion ? <span className="app-footer-target">Latest v{updateVersion}</span> : null}
        </div>
      ) : (
        <div className="app-footer-status-row" />
      )}

      <div className="app-footer-actions">
        {detailsLabel && onShowUpdateDetails ? (
          <button className="app-footer-link" type="button" onClick={onShowUpdateDetails}>
            {detailsLabel}
          </button>
        ) : null}

        {updateActionLabel && onInstallUpdate ? (
          <button
            className="card-action app-footer-update-button"
            type="button"
            onClick={onInstallUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <>
                <LoaderCircle className="app-spinner" size={16} strokeWidth={2} />
                <span>Updating...</span>
              </>
            ) : (
              <>
                <Download size={16} strokeWidth={2} />
                <span>{updateActionLabel}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </footer>
  );
}
