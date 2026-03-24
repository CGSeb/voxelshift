import { useEffect } from "react";
import type { BlenderConfigProfile, BlenderVersion } from "../../types";

type ReleaseConfigDialogMode = "save" | "apply";

interface ReleaseConfigDialogProps {
  open: boolean;
  mode: ReleaseConfigDialogMode;
  version: BlenderVersion | null;
  configs: BlenderConfigProfile[];
  configName: string;
  isLoading: boolean;
  isSaving: boolean;
  applyingConfigId: string | null;
  deletingConfigId: string | null;
  errorMessage?: string | null;
  noticeMessage?: string | null;
  onConfigNameChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onApply: (config: BlenderConfigProfile) => void | Promise<void>;
  onRequestRemove: (config: BlenderConfigProfile) => void;
  onClose: () => void;
}

export function ReleaseConfigDialog({
  open,
  mode,
  version,
  configs,
  configName,
  isLoading,
  isSaving,
  applyingConfigId,
  deletingConfigId,
  errorMessage = null,
  noticeMessage = null,
  onConfigNameChange,
  onSave,
  onApply,
  onRequestRemove,
  onClose,
}: ReleaseConfigDialogProps) {
  const isBusy = isSaving || applyingConfigId !== null || deletingConfigId !== null;
  const versionLabel = version?.version ?? version?.displayName ?? "this Blender version";
  const isSaveMode = mode === "save";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
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
  }, [isBusy, onClose, open]);

  if (!open || !version) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={isBusy ? undefined : onClose}>
      <section
        className="release-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-config-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="release-config-dialog-copy">
          <p className="section-kicker">Portable Configs</p>
          <h2 id="release-config-dialog-title">Blender {versionLabel}</h2>
          <p className="release-config-dialog-description">
            {isSaveMode
              ? "Save the current config for this version. It will save the startup file, the preferences and the theme."
              : "Applying a saved config will replace the current statup file, preferences and theme."}
          </p>
        </div>

        {isSaveMode ? (
          <div className="release-config-dialog-section">
            <div className="release-config-dialog-section-copy">
              <h3>Save current config</h3>
              <p>Name this snapshot before saving it to your Voxel Shift config library.</p>
            </div>

            <label className="release-config-field" htmlFor="release-config-name">
              <span>Config name</span>
              <input
                id="release-config-name"
                className="release-config-input"
                type="text"
                value={configName}
                onChange={(event) => onConfigNameChange(event.target.value)}
                disabled={isBusy}
                placeholder={versionLabel}
              />
            </label>

            <button className="card-action card-action-link" type="button" onClick={() => void onSave()} disabled={isBusy}>
              {isSaving ? "Saving..." : "Save current config"}
            </button>
          </div>
        ) : (
          <div className="release-config-dialog-section">
            <div className="release-config-dialog-section-copy">
              <h3>Apply existing config</h3>
              <p>Choose one of your saved configs to replace this version&apos;s current startup file, preferences and theme.</p>
            </div>

            {isLoading ? (
              <p className="release-config-empty-state">Loading saved configs...</p>
            ) : configs.length === 0 ? (
              <p className="release-config-empty-state">No saved configs yet.</p>
            ) : (
              <div className="release-config-list" role="list" aria-label="Saved Blender configs">
                {configs.map((config) => {
                  const isApplying = applyingConfigId === config.id;
                  const isDeleting = deletingConfigId === config.id;

                  return (
                    <article key={config.id} className="release-config-card" role="listitem">
                      <div className="release-config-card-copy">
                        <strong>{config.name}</strong>
                        <span>{config.path}</span>
                      </div>
                      <div className="release-config-card-actions">
                        <button
                          className="card-action card-action-secondary"
                          type="button"
                          onClick={() => void onApply(config)}
                          disabled={isBusy}
                        >
                          {isApplying ? "Applying..." : "Apply"}
                        </button>
                        <button
                          className="card-action card-action-danger"
                          type="button"
                          onClick={() => onRequestRemove(config)}
                          disabled={isBusy}
                        >
                          {isDeleting ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {noticeMessage ? <p className="release-config-notice">{noticeMessage}</p> : null}
        {errorMessage ? <p className="confirm-dialog-error">{errorMessage}</p> : null}

        <div className="confirm-dialog-actions">
          <button className="card-action card-action-secondary" type="button" onClick={onClose} disabled={isBusy}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
