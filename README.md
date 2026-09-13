# Voxel Shift

[![Coverage Status](https://coveralls.io/repos/github/CGSeb/voxelshift/badge.svg?branch=main&id=3)](https://coveralls.io/github/CGSeb/voxelshift?branch=main)
[![Latest Version](https://img.shields.io/github/v/release/CGSeb/voxelshift?display_name=tag&id=1)](https://github.com/CGSeb/voxelshift/releases/latest)

Voxel Shift is an open source desktop launcher for Blender, built with Tauri, React, TypeScript, and Rust.

![VoxelShift home](/img/voxelshift-home.jpg)

It is aimed at artists and technical users who keep multiple Blender installs around and want one place to:

- browse official Blender downloads
- install managed Blender builds
- launch the right Blender version quickly
- keep favorite versions close at hand
- reopen recent projects with the Blender build they came from


![VoxelShift releases](/img/voxelshift-release.jpg)

## App Overview

### Home

- recent projects with thumbnail fallback handling
- favorite Blender versions with launch shortcuts
- version status badges such as `Default` and `LTS`

### Installing a version

The install dialog lets you transfer a previous Blender setup or install fresh. Settings and legacy add-ons from the selected version are copied automatically when available. **Copy** automatically uses the selected previous version's extensions folder without showing a folder control. **Symlink** provides a separate editable folder for each installed extension. Symlink folder choices persist while toggling modes; switching the previous version resets them. Files go into the new installation's `portable/config`, `portable/extensions`, and `portable/scripts/addons` folders.

In Advanced options, choose **Copy** or **Symlink** for each extension, or change the default toggle to reset all extensions to one method. Copies always use the previous version's extension folder; linked extensions can each use a custom source folder. Settings and legacy add-ons are always copied, and Voxel Shift's bundled extension stays independent. Linked extensions require their source folders to remain available, so keep those folders when uninstalling the previous version. Windows may require Developer Mode or administrator rights to create symlinks. Use **Copy** if symlink creation is unavailable.

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust backend for filesystem, process launching, install management, and release parsing

## Local Development

### Prerequisites

- Node.js and npm
- Rust toolchain
- Tauri system prerequisites for your OS

### Run The App

```powershell
npm install
npm run tauri dev
```

### Frontend Build

```powershell
npm run build
```

### Desktop Build

```powershell
npm run tauri build
```

## Release notes

Before pushing a version tag, add a short `release-notes/<version>.md` file (for example, `release-notes/1.5.0.md`) and commit it with the version bump. Use a few short paragraphs or `-` bullet points; the app displays the notes as plain text.

The release workflow uses this file for both the GitHub release description and the updater's `latest.json` notes. The update popup shows them under **What's new**, with scrolling for longer notes. Missing or empty notes stop the release build. Review the notes before tagging, then publish the draft release after its builds finish.

Editing only the GitHub release description afterward does not update the popup: it reads the notes bundled into `latest.json` during the release build.

## Repository Layout

- `src/` - React UI, page composition, styling, and Tauri API client calls
- `src-tauri/` - Rust backend commands, Blender discovery, release parsing, download/install logic, and desktop packaging
- `resources/` - bundled Blender extension resources used during managed installs

## Roadmap

Some of the next high-value improvements are:

- test coverage for release parsing and launcher flows
- packaging and release automation

## Contributing

Issues and pull requests are welcome.

If you open a bug report, it helps to include:

- operating system
- Blender version involved
- reproduction steps

## License

Voxel Shift is licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
