use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ExtensionMode {
    Copy,
    Symlink,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallMigration {
    pub settings_path: Option<String>,
    pub extensions_path: Option<String>,
    pub addons_path: Option<String>,
    pub extension_mode: ExtensionMode,
    #[serde(default)]
    pub extension_overrides: Vec<ExtensionOverride>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionOverride {
    pub link_path: String,
    pub target_path: String,
    pub mode: Option<ExtensionMode>,
}

#[derive(Debug)]
struct ResolvedExtensionOverride {
    source: PathBuf,
    mode: ExtensionMode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationFolders {
    settings_path: Option<String>,
    extensions_path: Option<String>,
    addons_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationLink {
    name: String,
    link_path: String,
    target_path: String,
}

// Mirror the install layout without creating any files or links.
pub(crate) fn preview_links(extensions_path: Option<&str>) -> Result<Vec<MigrationLink>, String> {
    let mut links = Vec::new();
    if let Some(source) = preview_source(extensions_path)? {
        for repository in entries(&source)? {
            if is_extension_repository(&repository) {
                collect_links(
                    &repository.path(),
                    &Path::new("portable/extensions").join(repository.file_name()),
                    repository.file_name() == "user_default",
                    &mut links,
                )?;
            }
        }
    }
    links.sort_by(|left, right| left.link_path.cmp(&right.link_path));
    Ok(links)
}

fn preview_source(value: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!(
            "Choose an existing absolute source folder: {}",
            path.display()
        ));
    }
    path.canonicalize()
        .map(Some)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))
}

fn is_linked_extension(name: &std::ffi::OsStr, user_default: bool) -> bool {
    !name.to_string_lossy().starts_with('.') && !(user_default && name == "voxel_shift")
}

fn is_extension_repository(entry: &fs::DirEntry) -> bool {
    entry.path().is_dir() && !entry.file_name().to_string_lossy().starts_with('.')
}

fn collect_links(
    source: &Path,
    destination: &Path,
    user_default: bool,
    links: &mut Vec<MigrationLink>,
) -> Result<(), String> {
    for entry in entries(source)? {
        let name = entry.file_name();
        if !entry.path().is_dir() || !is_linked_extension(&name, user_default) {
            continue;
        }
        let target = entry
            .path()
            .canonicalize()
            .map_err(|error| format!("Unable to resolve {}: {error}", entry.path().display()))?;
        links.push(MigrationLink {
            name: name.to_string_lossy().into_owned(),
            link_path: destination.join(name).to_string_lossy().replace('\\', "/"),
            target_path: super::path_to_string(&target),
        });
    }
    Ok(())
}

pub(crate) fn discover(install_dir: &Path, version: Option<&str>) -> MigrationFolders {
    let version_line = version.and_then(|value| {
        let parts = value.split('.').take(2).collect::<Vec<_>>();
        (parts.len() == 2
            && parts
                .iter()
                .all(|part| part.chars().all(|c| c.is_ascii_digit())))
        .then(|| parts.join("."))
    });
    let portable = install_dir.join("portable");
    let legacy = version_line.as_ref().map(|line| install_dir.join(line));
    let user_root = version_line.and_then(|line| {
        #[cfg(target_os = "windows")]
        let base = std::env::var_os("APPDATA")
            .map(|path| PathBuf::from(path).join("Blender Foundation/Blender"));
        #[cfg(not(target_os = "windows"))]
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|path| PathBuf::from(path).join(".config")))
            .map(|path| path.join("blender"));
        base.map(|path| path.join(line))
    });
    let root = if portable.is_dir() {
        Some(portable)
    } else if legacy
        .as_ref()
        .is_some_and(|path| path.join("config").is_dir())
    {
        legacy
    } else {
        user_root
    };
    let existing = |relative: &str| {
        root.as_ref()
            .map(|path| path.join(relative))
            .filter(|path| path.is_dir())
            .map(|path| super::path_to_string(&path))
    };
    MigrationFolders {
        settings_path: existing("config"),
        extensions_path: existing("extensions"),
        addons_path: existing("scripts/addons"),
    }
}

impl InstallMigration {
    fn resolved_extension_overrides(
        &self,
    ) -> Result<BTreeMap<String, ResolvedExtensionOverride>, String> {
        let mut resolved = BTreeMap::new();
        if self.extension_overrides.is_empty() {
            return Ok(resolved);
        }
        let installed = preview_links(self.extensions_path.as_deref())?
            .into_iter()
            .map(|entry| (entry.link_path, entry.target_path))
            .collect::<BTreeMap<_, _>>();
        for entry in &self.extension_overrides {
            let original = installed.get(&entry.link_path).ok_or_else(|| {
                format!(
                    "The extension is not installed in the selected source: {}",
                    entry.link_path
                )
            })?;
            let mode = entry.mode.as_ref().unwrap_or(&self.extension_mode).clone();
            let target_path = match mode {
                ExtensionMode::Copy => original,
                ExtensionMode::Symlink => &entry.target_path,
            };
            let source = preview_source(Some(target_path))?
                .ok_or_else(|| "Choose a source folder for every extension.".to_string())?;
            if resolved
                .insert(
                    entry.link_path.clone(),
                    ResolvedExtensionOverride { source, mode },
                )
                .is_some()
            {
                return Err(format!(
                    "Duplicate extension folder override: {}",
                    entry.link_path
                ));
            }
        }
        Ok(resolved)
    }

    // Resolve before downloading: bad custom paths should fail immediately, and
    // links must use absolute targets after the staged install has been moved.
    pub(crate) fn validate(&mut self) -> Result<(), String> {
        for value in [
            &mut self.settings_path,
            &mut self.extensions_path,
            &mut self.addons_path,
        ] {
            let Some(raw) = value.as_ref() else { continue };
            let path = Path::new(raw.trim());
            if !path.is_absolute() || !path.is_dir() {
                return Err(format!(
                    "Choose an existing absolute source folder: {}",
                    path.display()
                ));
            }
            let resolved = path
                .canonicalize()
                .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
            *value = Some(super::path_to_string(&resolved));
        }
        let overrides = self.resolved_extension_overrides()?;
        for entry in &mut self.extension_overrides {
            entry.target_path = super::path_to_string(&overrides[&entry.link_path].source);
        }
        Ok(())
    }

    #[cfg(test)]
    fn apply(&self, install_dir: &Path) -> Result<(), String> {
        self.apply_checked(install_dir, &|| Ok(()))
    }

    pub(crate) fn apply_checked(
        &self,
        install_dir: &Path,
        check_canceled: &dyn Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        check_canceled()?;
        let root = install_dir
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let overrides = self
            .resolved_extension_overrides()?
            .into_iter()
            .map(|(destination, source)| (root.join(destination), source))
            .collect::<BTreeMap<_, _>>();
        for entry in overrides.values() {
            let source = &entry.source;
            if root.starts_with(source) || source.starts_with(&root) {
                return Err(
                    "Extension source folders must be outside the new installation.".to_string(),
                );
            }
        }
        // Refuse overlapping source/staging trees, including through symlinks.
        for source in [
            &self.settings_path,
            &self.extensions_path,
            &self.addons_path,
        ]
        .into_iter()
        .flatten()
        {
            let source = Path::new(source)
                .canonicalize()
                .map_err(|error| format!("Unable to read migration source {source}: {error}"))?;
            if root.starts_with(&source) || source.starts_with(&root) {
                return Err(
                    "Migration source folders must be outside the new installation.".to_string(),
                );
            }
        }
        let portable = root.join("portable");
        if let Some(source) = &self.settings_path {
            copy_tree(
                Path::new(source),
                &portable.join("config"),
                &mut HashSet::new(),
                check_canceled,
            )?;
        }
        if let Some(source) = &self.extensions_path {
            transfer_extensions(
                Path::new(source),
                &portable.join("extensions"),
                &self.extension_mode,
                check_canceled,
                &overrides,
            )?;
        }
        if let Some(source) = &self.addons_path {
            transfer_entries(
                Path::new(source),
                &portable.join("scripts/addons"),
                &ExtensionMode::Copy,
                false,
                check_canceled,
                &BTreeMap::new(),
            )?;
        }
        Ok(())
    }
}

fn entries(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    fs::read_dir(path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn make_dir(path: &Path) -> Result<(), String> {
    // Never write through links supplied by an archive or an existing target.
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(format!(
                "Migration destination is a symbolic link: {}",
                ancestor.display()
            ));
        }
    }
    fs::create_dir_all(path)
        .map_err(|error| format!("Unable to create {}: {error}", path.display()))
}

fn copy_tree(
    source: &Path,
    target: &Path,
    ancestors: &mut HashSet<PathBuf>,
    check_canceled: &dyn Fn() -> Result<(), String>,
) -> Result<(), String> {
    check_canceled()?;
    let resolved = source
        .canonicalize()
        .map_err(|error| format!("Unable to read {}: {error}", source.display()))?;
    if source.is_dir() {
        if !ancestors.insert(resolved.clone()) {
            return Err(format!(
                "A circular symbolic link was found in {}.",
                source.display()
            ));
        }
        make_dir(target)?;
        for entry in entries(source)? {
            copy_tree(
                &entry.path(),
                &target.join(entry.file_name()),
                ancestors,
                check_canceled,
            )?;
        }
        ancestors.remove(&resolved);
    } else if source.is_file() {
        if fs::symlink_metadata(target).is_ok() {
            return Err(format!(
                "Migration destination already exists: {}",
                target.display()
            ));
        }
        if let Some(parent) = target.parent() {
            make_dir(parent)?;
        }
        fs::copy(source, target)
            .map_err(|error| format!("Unable to copy {}: {error}", source.display()))?;
    } else {
        return Err(format!(
            "Unsupported migration source: {}",
            source.display()
        ));
    }
    Ok(())
}

fn transfer_extensions(
    source: &Path,
    target: &Path,
    mode: &ExtensionMode,
    check_canceled: &dyn Fn() -> Result<(), String>,
    overrides: &BTreeMap<PathBuf, ResolvedExtensionOverride>,
) -> Result<(), String> {
    make_dir(target)?;
    for repository in entries(source)? {
        let destination = target.join(repository.file_name());
        if is_extension_repository(&repository) {
            transfer_entries(
                &repository.path(),
                &destination,
                mode,
                repository.file_name() == "user_default",
                check_canceled,
                overrides,
            )?;
        } else {
            copy_tree(
                &repository.path(),
                &destination,
                &mut HashSet::new(),
                check_canceled,
            )?;
        }
    }
    Ok(())
}

fn transfer_entries(
    source: &Path,
    target: &Path,
    mode: &ExtensionMode,
    user_default: bool,
    check_canceled: &dyn Fn() -> Result<(), String>,
    overrides: &BTreeMap<PathBuf, ResolvedExtensionOverride>,
) -> Result<(), String> {
    make_dir(target)?;
    for entry in entries(source)? {
        check_canceled()?;
        let name = entry.file_name();
        // The bundled extension also stores installation-specific project data.
        if user_default && name == "voxel_shift" {
            continue;
        }
        let destination = target.join(&name);
        let original = entry.path();
        let (source, mode) = overrides
            .get(&destination)
            .map(|entry| (&entry.source, &entry.mode))
            .unwrap_or((&original, mode));
        if matches!(mode, ExtensionMode::Symlink)
            && source.is_dir()
            && is_linked_extension(&name, user_default)
        {
            link_entry(&source, &destination)?;
        } else {
            copy_tree(&source, &destination, &mut HashSet::new(), check_canceled)?;
        }
    }
    Ok(())
}

fn link_entry(source: &Path, target: &Path) -> Result<(), String> {
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let result = if source.is_dir() {
        std::os::windows::fs::symlink_dir(&source, target)
    } else {
        std::os::windows::fs::symlink_file(&source, target)
    };
    #[cfg(not(target_os = "windows"))]
    let result = std::os::unix::fs::symlink(&source, target);
    result.map_err(|error| format!(
        "Unable to create extension symlink {}: {error}. On Windows, enable Developer Mode or run with administrator rights, or choose Copy.", target.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "voxelshift-migration-{}-{}-{}",
                std::process::id(),
                super::super::current_timestamp(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn write(&self, relative: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }
        fn request(&self, mode: ExtensionMode) -> InstallMigration {
            InstallMigration {
                extension_overrides: Vec::new(),
                settings_path: Some(
                    self.0
                        .join("old/portable/config")
                        .to_string_lossy()
                        .into_owned(),
                ),
                extensions_path: Some(
                    self.0
                        .join("old/portable/extensions")
                        .to_string_lossy()
                        .into_owned(),
                ),
                addons_path: Some(
                    self.0
                        .join("old/portable/scripts/addons")
                        .to_string_lossy()
                        .into_owned(),
                ),
                extension_mode: mode,
            }
        }
        fn populate(&self) {
            self.write("old/portable/config/userpref.blend", b"preferences");
            self.write("old/portable/config/startup.blend", b"startup");
            self.write(
                "old/portable/extensions/blender_org/tool/__init__.py",
                b"tool",
            );
            self.write(
                "old/portable/extensions/user_default/custom/__init__.py",
                b"custom",
            );
            self.write(
                "old/portable/extensions/user_default/voxel_shift/VoxelShift.json",
                b"old projects",
            );
            self.write("old/portable/scripts/addons/legacy.py", b"legacy");
            fs::create_dir(self.0.join("new")).unwrap();
        }
        fn symlinks_available(&self) -> bool {
            let target = self.0.join("symlink-probe");
            #[cfg(target_os = "windows")]
            let result = std::os::windows::fs::symlink_dir(self.0.join("old"), &target);
            #[cfg(not(target_os = "windows"))]
            let result = std::os::unix::fs::symlink(self.0.join("old"), &target);
            match result {
                Ok(()) => true,
                #[cfg(target_os = "windows")]
                Err(error) if error.raw_os_error() == Some(1314) => {
                    eprintln!("Symlink success assertions skipped: Windows Developer Mode or symlink privilege is required.");
                    false
                }
                Err(error) => panic!("Unable to prepare symlink test: {error}"),
            }
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_setup_without_sharing_files_or_old_launcher_state() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.validate().unwrap();
        request.apply(&sandbox.0.join("new")).unwrap();
        assert_eq!(
            fs::read(sandbox.0.join("new/portable/config/startup.blend")).unwrap(),
            b"startup"
        );
        assert_eq!(
            fs::read(sandbox.0.join("new/portable/scripts/addons/legacy.py")).unwrap(),
            b"legacy"
        );
        assert!(!sandbox
            .0
            .join("new/portable/extensions/user_default/voxel_shift")
            .exists());
        sandbox.write(
            "new/portable/extensions/blender_org/tool/__init__.py",
            b"changed",
        );
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("old/portable/extensions/blender_org/tool/__init__.py")
            )
            .unwrap(),
            b"tool"
        );
    }

    #[test]
    fn links_extensions_but_copies_settings_and_keeps_bundled_extension_independent() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Symlink);
        request.validate().unwrap();
        if !sandbox.symlinks_available() {
            let error = request.apply(&sandbox.0.join("new")).unwrap_err();
            assert!(error.contains("Developer Mode"));
            assert!(error.contains("choose Copy"));
            assert_eq!(
                fs::read(
                    sandbox
                        .0
                        .join("old/portable/extensions/blender_org/tool/__init__.py")
                )
                .unwrap(),
                b"tool"
            );
            return;
        }
        request.apply(&sandbox.0.join("new")).unwrap();
        let linked = sandbox.0.join("new/portable/extensions/blender_org/tool");
        assert!(fs::symlink_metadata(&linked)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!fs::symlink_metadata(sandbox.0.join("new/portable/config"))
            .unwrap()
            .file_type()
            .is_symlink());
        sandbox.write(
            "new/portable/extensions/blender_org/tool/__init__.py",
            b"shared change",
        );
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("old/portable/extensions/blender_org/tool/__init__.py")
            )
            .unwrap(),
            b"shared change"
        );
        sandbox.write(
            "new/portable/extensions/user_default/voxel_shift/__init__.py",
            b"new launcher",
        );
        assert!(!sandbox
            .0
            .join("old/portable/extensions/user_default/voxel_shift/__init__.py")
            .exists());
        fs::remove_dir_all(sandbox.0.join("new")).unwrap();
        assert!(sandbox
            .0
            .join("old/portable/extensions/blender_org/tool/__init__.py")
            .exists());
        assert!(sandbox
            .0
            .join("old/portable/scripts/addons/legacy.py")
            .exists());
    }

    #[test]
    fn validates_sources_and_rejects_overlap_and_existing_destination_files() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.settings_path = Some("relative/config".to_string());
        assert!(request
            .validate()
            .unwrap_err()
            .contains("absolute source folder"));
        request.settings_path = Some(sandbox.0.join("missing").to_string_lossy().into_owned());
        assert!(request.validate().is_err());
        request.settings_path = Some(sandbox.0.to_string_lossy().into_owned());
        assert!(request
            .apply(&sandbox.0.join("new"))
            .unwrap_err()
            .contains("outside"));
        request = sandbox.request(ExtensionMode::Copy);
        sandbox.write("new/portable/config/userpref.blend", b"existing");
        assert!(request
            .apply(&sandbox.0.join("new"))
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(
            fs::read(sandbox.0.join("new/portable/config/userpref.blend")).unwrap(),
            b"existing"
        );
    }

    #[test]
    fn detects_portable_and_legacy_folders_and_can_skip_settings() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let found = discover(&sandbox.0.join("old"), Some("4.5.3"));
        assert!(found.settings_path.unwrap().ends_with("config"));
        assert!(found.extensions_path.is_some());
        assert!(found.addons_path.is_some());
        sandbox.write("legacy/3.6/config/userpref.blend", b"legacy");
        let found = discover(&sandbox.0.join("legacy"), Some("3.6.2"));
        assert!(found.settings_path.is_some());
        assert!(found.extensions_path.is_none());
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.settings_path = None;
        request.apply(&sandbox.0.join("new")).unwrap();
        assert!(!sandbox.0.join("new/portable/config").exists());
    }

    #[test]
    fn rejects_circular_source_links_and_linked_destinations() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Copy);
        if !sandbox.symlinks_available() {
            return;
        }
        link_entry(
            &sandbox.0.join("old/portable/config"),
            &sandbox.0.join("old/portable/config/loop"),
        )
        .unwrap();
        assert!(request
            .apply(&sandbox.0.join("new"))
            .unwrap_err()
            .contains("circular"));
        request.settings_path = None;
        request.extensions_path = None;
        link_entry(
            &sandbox.0.join("old/portable/scripts"),
            &sandbox.0.join("new/portable/scripts"),
        )
        .unwrap();
        assert!(request
            .apply(&sandbox.0.join("new"))
            .unwrap_err()
            .contains("destination is a symbolic link"));
    }

    #[test]
    fn cancellation_stops_a_transfer_between_entries() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let request = sandbox.request(ExtensionMode::Copy);
        let calls = std::cell::Cell::new(0);
        let result = request.apply_checked(&sandbox.0.join("new"), &|| {
            calls.set(calls.get() + 1);
            if calls.get() > 3 {
                Err("Installation canceled.".to_string())
            } else {
                Ok(())
            }
        });
        assert_eq!(result, Err("Installation canceled.".to_string()));
        assert!(!sandbox.0.join("new/portable/extensions").exists());
        assert_eq!(
            fs::read(sandbox.0.join("old/portable/config/userpref.blend")).unwrap(),
            b"preferences"
        );
    }

    #[test]
    fn previews_extension_links_without_writing_and_excludes_copied_metadata() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        sandbox.write(
            "old/portable/extensions/blender_org/.blender_ext/index.json",
            b"metadata",
        );
        sandbox.write("old/portable/extensions/repositories.json", b"repositories");
        let request = sandbox.request(ExtensionMode::Symlink);
        let links = preview_links(request.extensions_path.as_deref()).unwrap();
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].link_path, "portable/extensions/blender_org/tool");
        assert_eq!(links[0].name, "tool");
        assert_eq!(
            links[0].target_path,
            super::super::path_to_string(
                &sandbox
                    .0
                    .join("old/portable/extensions/blender_org/tool")
                    .canonicalize()
                    .unwrap()
            )
        );
        assert_eq!(
            links[1].link_path,
            "portable/extensions/user_default/custom"
        );
        assert_eq!(fs::read_dir(sandbox.0.join("new")).unwrap().count(), 0);
        assert!(sandbox
            .0
            .join("old/portable/extensions/user_default/voxel_shift/VoxelShift.json")
            .exists());
    }

    #[test]
    fn preview_handles_empty_sources_and_reports_invalid_folders() {
        assert!(preview_links(None).unwrap().is_empty());
        assert!(preview_links(Some("  ")).unwrap().is_empty());
        assert!(preview_links(Some("relative/path"))
            .unwrap_err()
            .contains("absolute source folder"));
        let sandbox = Sandbox::new();
        assert!(preview_links(Some(&sandbox.0.join("missing").to_string_lossy())).is_err());
        assert!(preview_links(Some(&sandbox.0.to_string_lossy()))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn symlink_mode_always_copies_settings_and_legacy_addons() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Symlink);
        request.extensions_path = None;
        request.apply(&sandbox.0.join("new")).unwrap();
        let addon = sandbox.0.join("new/portable/scripts/addons/legacy.py");
        assert!(!fs::symlink_metadata(&addon)
            .unwrap()
            .file_type()
            .is_symlink());
        sandbox.write("new/portable/scripts/addons/legacy.py", b"changed");
        sandbox.write("new/portable/config/userpref.blend", b"changed");
        assert_eq!(
            fs::read(sandbox.0.join("old/portable/scripts/addons/legacy.py")).unwrap(),
            b"legacy"
        );
        assert_eq!(
            fs::read(sandbox.0.join("old/portable/config/userpref.blend")).unwrap(),
            b"preferences"
        );
    }

    #[test]
    fn extension_override_changes_only_the_requested_extension() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        sandbox.write("shared/tool/__init__.py", b"shared tool");
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.extension_overrides.push(ExtensionOverride {
            link_path: "portable/extensions/blender_org/tool".to_string(),
            target_path: sandbox.0.join("shared/tool").to_string_lossy().into_owned(),
            mode: Some(ExtensionMode::Symlink),
        });
        request.validate().unwrap();
        if !sandbox.symlinks_available() {
            assert!(request
                .apply(&sandbox.0.join("new"))
                .unwrap_err()
                .contains("Developer Mode"));
            return;
        }
        request.apply(&sandbox.0.join("new")).unwrap();
        assert!(
            fs::symlink_metadata(sandbox.0.join("new/portable/extensions/blender_org/tool"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(!fs::symlink_metadata(
            sandbox
                .0
                .join("new/portable/extensions/user_default/custom")
        )
        .unwrap()
        .file_type()
        .is_symlink());
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("new/portable/extensions/blender_org/tool/__init__.py")
            )
            .unwrap(),
            b"shared tool"
        );
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("new/portable/extensions/user_default/custom/__init__.py")
            )
            .unwrap(),
            b"custom"
        );
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("old/portable/extensions/blender_org/tool/__init__.py")
            )
            .unwrap(),
            b"tool"
        );
        assert_eq!(
            fs::read(sandbox.0.join("new/portable/scripts/addons/legacy.py")).unwrap(),
            b"legacy"
        );
        assert!(!sandbox
            .0
            .join("new/portable/extensions/user_default/voxel_shift")
            .exists());
    }

    #[test]
    fn extension_overrides_reject_unknown_destinations_and_invalid_sources() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.extension_overrides.push(ExtensionOverride {
            link_path: "../outside".to_string(),
            target_path: sandbox.0.join("old").to_string_lossy().into_owned(),
            mode: Some(ExtensionMode::Symlink),
        });
        assert!(request.validate().unwrap_err().contains("not installed"));
        request.extension_overrides[0].link_path =
            "portable/extensions/blender_org/tool".to_string();
        request.extension_overrides[0].target_path = "relative/tool".to_string();
        assert!(request
            .validate()
            .unwrap_err()
            .contains("absolute source folder"));
        request.extension_overrides[0].target_path =
            sandbox.0.join("new").to_string_lossy().into_owned();
        assert!(request
            .apply(&sandbox.0.join("new"))
            .unwrap_err()
            .contains("outside"));
        request.extension_overrides[0].target_path =
            sandbox.0.join("old").to_string_lossy().into_owned();
        request
            .extension_overrides
            .push(request.extension_overrides[0].clone());
        assert!(request.validate().unwrap_err().contains("Duplicate"));
        assert_eq!(fs::read_dir(sandbox.0.join("new")).unwrap().count(), 0);
    }

    #[test]
    fn per_extension_copy_overrides_symlink_default_and_uses_previous_source() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Symlink);
        request.extension_overrides = preview_links(request.extensions_path.as_deref())
            .unwrap()
            .into_iter()
            .map(|entry| ExtensionOverride {
                link_path: entry.link_path,
                target_path: "ignored/custom/path".to_string(),
                mode: Some(ExtensionMode::Copy),
            })
            .collect();
        request.validate().unwrap();
        request.apply(&sandbox.0.join("new")).unwrap();
        for (relative, contents) in [
            ("blender_org/tool", b"tool".as_slice()),
            ("user_default/custom", b"custom".as_slice()),
        ] {
            let destination = sandbox.0.join("new/portable/extensions").join(relative);
            assert!(!fs::symlink_metadata(&destination)
                .unwrap()
                .file_type()
                .is_symlink());
            assert_eq!(fs::read(destination.join("__init__.py")).unwrap(), contents);
            fs::write(destination.join("__init__.py"), b"changed").unwrap();
            assert_eq!(
                fs::read(
                    sandbox
                        .0
                        .join("old/portable/extensions")
                        .join(relative)
                        .join("__init__.py")
                )
                .unwrap(),
                contents
            );
        }
    }

    #[test]
    fn migration_payload_defaults_modes_and_rejects_invalid_transfer_methods() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let root = sandbox.0.join("old/portable/extensions");
        let mut payload = serde_json::json!({
            "settingsPath": null,
            "extensionsPath": root,
            "addonsPath": null,
            "extensionMode": "copy"
        });
        let request: InstallMigration = serde_json::from_value(payload.clone()).unwrap();
        assert!(request.extension_overrides.is_empty());
        payload["extensionOverrides"] = serde_json::json!([{
            "linkPath": "portable/extensions/blender_org/tool",
            "targetPath": "ignored when copying"
        }]);
        let mut request: InstallMigration = serde_json::from_value(payload.clone()).unwrap();
        request.validate().unwrap();
        request.apply(&sandbox.0.join("new")).unwrap();
        assert_eq!(fs::read(sandbox.0.join("new/portable/extensions/blender_org/tool/__init__.py")).unwrap(), b"tool");
        payload["extensionOverrides"][0]["mode"] = serde_json::json!("move");
        assert!(serde_json::from_value::<InstallMigration>(payload).is_err());
    }

    #[test]
    fn migration_revalidates_sources_and_rejects_empty_symlink_targets() {
        let sandbox = Sandbox::new();
        sandbox.populate();
        let mut request = sandbox.request(ExtensionMode::Copy);
        request.extension_overrides.push(ExtensionOverride {
            link_path: "portable/extensions/blender_org/tool".to_string(),
            target_path: "  ".to_string(),
            mode: Some(ExtensionMode::Symlink),
        });
        assert!(request.validate().unwrap_err().contains("Choose a source folder"));
        request.extension_overrides[0].target_path = sandbox.write("shared/tool/__init__.py", b"shared").parent().unwrap().to_string_lossy().into_owned();
        request.validate().unwrap();
        // A source can disappear while the new version is downloading.
        fs::rename(sandbox.0.join("shared/tool"), sandbox.0.join("shared/moved")).unwrap();
        assert!(request.apply(&sandbox.0.join("new")).unwrap_err().contains("existing absolute source folder"));
        assert_eq!(fs::read_dir(sandbox.0.join("new")).unwrap().count(), 0);
        assert_eq!(fs::read(sandbox.0.join("old/portable/extensions/blender_org/tool/__init__.py")).unwrap(), b"tool");
    }

    #[test]
    fn symlink_mode_copies_cache_and_metadata_without_symlink_privileges() {
        let sandbox = Sandbox::new();
        sandbox.write("old/portable/extensions/.cache/compat.dat", b"cache");
        sandbox.write(
            "old/portable/extensions/.cache/nested/data.bin",
            b"nested cache",
        );
        sandbox.write(
            "old/portable/extensions/blender_org/repository.json",
            b"repository metadata",
        );
        sandbox.write(
            "old/portable/extensions/blender_org/.blender_ext/index.json",
            b"index",
        );
        fs::create_dir(sandbox.0.join("new")).unwrap();
        let mut request = sandbox.request(ExtensionMode::Symlink);
        request.settings_path = None;
        request.addons_path = None;
        request.validate().unwrap();
        assert!(preview_links(request.extensions_path.as_deref())
            .unwrap()
            .is_empty());
        request.apply(&sandbox.0.join("new")).unwrap();
        for (path, contents) in [
            (".cache/compat.dat", b"cache".as_slice()),
            (".cache/nested/data.bin", b"nested cache".as_slice()),
            (
                "blender_org/repository.json",
                b"repository metadata".as_slice(),
            ),
            ("blender_org/.blender_ext/index.json", b"index".as_slice()),
        ] {
            let target = sandbox.0.join("new/portable/extensions").join(path);
            assert_eq!(fs::read(&target).unwrap(), contents);
            assert!(!fs::symlink_metadata(&target)
                .unwrap()
                .file_type()
                .is_symlink());
        }
        assert!(
            !fs::symlink_metadata(sandbox.0.join("new/portable/extensions/.cache/nested"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}
