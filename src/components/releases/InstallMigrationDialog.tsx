import { useEffect, useRef, useState } from "react";
import { ModalSelect } from "../ModalSelect";
import { getInstallMigrationFolders, getInstallMigrationLinks, pickInstallMigrationFolder } from "../../lib/api";
import type { BlenderReleaseDownload, BlenderVersion, InstallMigration, InstallMigrationFolders, InstallMigrationLink } from "../../types";

interface Props {
  download: BlenderReleaseDownload;
  versions: BlenderVersion[];
  onInstall: (migration?: InstallMigration) => void;
  onClose: () => void;
}

const emptyFolders: InstallMigrationFolders = { settingsPath: null, extensionsPath: null, addonsPath: null };

export function InstallMigrationDialog({ download, versions, onInstall, onClose }: Props) {
  const sources = versions.filter((version) => version.available && version.version !== download.version)
    .sort((a, b) => (b.version ?? b.displayName).localeCompare(a.version ?? a.displayName, undefined, { numeric: true }));
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [folders, setFolders] = useState<InstallMigrationFolders>(emptyFolders);
  const [extensions, setExtensions] = useState<InstallMigrationLink[]>([]);
  const [extensionPaths, setExtensionPaths] = useState<Record<string, string>>({});
  const [extensionModes, setExtensionModes] = useState<Record<string, "copy" | "symlink">>({});
  const [copyExtensions, setCopyExtensions] = useState(true);
  const [extensionMode, setExtensionMode] = useState<"copy" | "symlink">("copy");
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(Boolean(sourceId));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const sourceGeneration = useRef(0);

  useEffect(() => {
    const generation = ++sourceGeneration.current;
    setFolders(emptyFolders);
    setExtensions([]);
    setExtensionPaths({});
    setExtensionModes({});
    setError(null);
    if (!sourceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getInstallMigrationFolders(sourceId).then(async (value) => {
      if (sourceGeneration.current !== generation) return;
      setFolders(value);
      const entries = value.extensionsPath ? await getInstallMigrationLinks(value.extensionsPath) : [];
      if (sourceGeneration.current === generation) setExtensions(entries);
    }).catch((reason: unknown) => {
      if (sourceGeneration.current === generation) setError(String(reason));
    }).finally(() => {
      if (sourceGeneration.current === generation) setLoading(false);
    });
    return () => { sourceGeneration.current++; };
  }, [sourceId]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  async function browseExtension(linkPath: string) {
    const generation = sourceGeneration.current;
    setPicking(true);
    try {
      const path = await pickInstallMigrationFolder();
      if (path && generation === sourceGeneration.current) {
        setExtensionPaths((current) => ({ ...current, [linkPath]: path }));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPicking(false);
    }
  }

  const extensionLinks = extensions.map((extension) => ({
    ...extension,
    mode: extensionModes[extension.linkPath] ?? extensionMode,
    targetPath: (extensionModes[extension.linkPath] ?? extensionMode) === "symlink"
      ? (extensionPaths[extension.linkPath] ?? extension.targetPath).trim() : extension.targetPath,
  }));
  const extensionOverrides = extensionLinks.flatMap((extension, index) =>
    extension.targetPath !== extensions[index].targetPath || extension.mode !== extensionMode
      ? [{ linkPath: extension.linkPath, targetPath: extension.targetPath, mode: extension.mode }] : []);
  const hasSymlinks = copyExtensions && extensionLinks.some((extension) => extension.mode === "symlink");
  const hasEmptyExtensionPath = copyExtensions && extensionLinks.some((extension) => extension.mode === "symlink" && !extension.targetPath);
  const migration: InstallMigration = {
    settingsPath: folders.settingsPath?.trim() || null,
    extensionsPath: copyExtensions ? folders.extensionsPath?.trim() || null : null,
    addonsPath: folders.addonsPath?.trim() || null,
    extensionMode,
    ...(copyExtensions && extensionOverrides.length ? { extensionOverrides } : {}),
  };
  const hasSelection = Boolean(migration.settingsPath || migration.extensionsPath || migration.addonsPath);

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={picking ? undefined : onClose}>
      <section className="release-config-dialog install-migration-dialog" role="dialog" aria-modal="true"
        aria-labelledby="install-migration-title" ref={dialogRef} tabIndex={-1}
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === "Escape" && !picking) onClose();
          if (event.key !== "Tab") return;
          const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(":is(button, input, select):not(:disabled)") ?? []);
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}>
        <div className="release-config-dialog-copy">
          <p className="section-kicker">Install Blender {download.version}</p>
          <h2 id="install-migration-title">Bring your setup with you</h2>
          <p className="release-config-dialog-description">Copy settings and extensions from a previous version, or start with a fresh setup.</p>
        </div>
        {sources.length > 0 ? <div className="release-config-field">
          <span>Previous version</span>
          <ModalSelect label="Previous version" value={sourceId} disabled={picking} onChange={setSourceId}
            options={sources.map((version) => ({ value: version.id, label: version.version ?? version.displayName }))} />
        </div> : null}
        {loading ? <p role="status">Finding settings and extensions...</p> : null}
        {!sources.length ? <p className="release-config-empty-state">No previous installation found. Install fresh to get started.</p> : null}
        <div className="release-config-dialog-section">
          <p>Settings and legacy add-ons from the previous version are copied automatically when available.</p>
          <label className="planner-checkbox-field">
            <span className="planner-checkbox-row">
              <input className="planner-checkbox-input" type="checkbox" aria-label="Transfer extensions"
                checked={copyExtensions} onChange={(event) => setCopyExtensions(event.target.checked)} />
              <span>Transfer extensions</span>
            </span>
          </label>
        </div>
        <button className="card-action card-action-secondary" type="button" aria-expanded={advanced} aria-controls="migration-folders" onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide advanced options" : "Advanced: choose folders"}
        </button>
        {advanced ? <div id="migration-folders" className="release-config-dialog-section">
          {copyExtensions ? <div className="release-config-field">
            <span>Default extension transfer method</span>
            <div className="release-tab-bar release-tab-bar-secondary" role="group" aria-label="Extension transfer method">
              <button type="button" className={extensionMode === "copy" ? "release-tab release-tab-active" : "release-tab"}
                aria-pressed={extensionMode === "copy"} onClick={() => { setExtensionMode("copy"); setExtensionModes({}); }}>Copy</button>
              <button type="button" className={extensionMode === "symlink" ? "release-tab release-tab-active" : "release-tab"}
                aria-pressed={extensionMode === "symlink"} onClick={() => { setExtensionMode("symlink"); setExtensionModes({}); }}>Symlink</button>
            </div>
          </div> : null}
          {hasSymlinks ? <p className="release-config-notice">Linked extensions share changes with the source. Keep the source folders available, including when removing the previous version. On Windows, symlinks may require Developer Mode or administrator rights.</p> : null}
          {copyExtensions ? (extensions.length > 0 ? <div className="release-config-dialog-section">
            <p>Choose Copy or Symlink for each extension. Copies always use the previous version. Changing the default above resets all extension choices.</p>
            {extensionLinks.map((extension, index) => <div className="release-config-field" key={extension.linkPath}>
              {extension.mode === "symlink" ? <label htmlFor={`migration-extension-${index}`}>{extension.name}</label> : <span>{extension.name}</span>}
              <div className="release-tab-bar release-tab-bar-secondary" role="group" aria-label={`${extension.name} transfer method`}>
                {(["copy", "symlink"] as const).map((mode) => <button key={mode} type="button"
                  className={extension.mode === mode ? "release-tab release-tab-active" : "release-tab"}
                  aria-label={`${mode === "copy" ? "Copy" : "Symlink"} ${extension.name}`} aria-pressed={extension.mode === mode}
                  disabled={loading || picking}
                  onClick={() => setExtensionModes((current) => ({ ...current, [extension.linkPath]: mode }))}>
                  {mode === "copy" ? "Copy" : "Symlink"}
                </button>)}
              </div>
              {extension.mode === "symlink" ? <><div className="migration-folder-input">
                <input id={`migration-extension-${index}`} className="release-config-input" value={extensionPaths[extension.linkPath] ?? extension.targetPath}
                  disabled={loading || picking || !copyExtensions} placeholder="Choose this extension’s folder"
                  onChange={(event) => setExtensionPaths((current) => ({ ...current, [extension.linkPath]: event.target.value }))} />
                <button className="card-action card-action-secondary" type="button" aria-label={`Browse ${extension.name} folder`}
                  disabled={loading || picking || !copyExtensions} onClick={() => void browseExtension(extension.linkPath)}>Browse</button>
              </div>
              <small>Destination: {extension.linkPath}</small></> : null}
            </div>)}
          </div> : !loading ? <p>No extensions found in the selected previous version.</p> : null) : null}
          {hasEmptyExtensionPath ? <p className="confirm-dialog-error">Choose a source folder for every extension.</p> : null}
        </div> : null}
        {!loading && !hasSelection ? <p className="release-config-empty-state">No setup found to transfer. Choose another previous version or install fresh.</p> : null}
        {error ? <p className="confirm-dialog-error" role="alert">{error}</p> : null}
        <div className="confirm-dialog-actions">
          <button className="card-action card-action-secondary" type="button" onClick={onClose} disabled={picking}>Cancel</button>
          <button className="card-action card-action-secondary" type="button" onClick={() => onInstall()} disabled={picking}>Install fresh</button>
          <button className="card-action card-action-link" type="button" onClick={() => onInstall(migration)} disabled={loading || picking || !hasSelection || hasEmptyExtensionPath}>Install with selected setup</button>
        </div>
      </section>
    </div>
  );
}
