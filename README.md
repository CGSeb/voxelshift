# Voxel Shift

[![Coverage Status](https://coveralls.io/repos/github/CGSeb/voxelshift/badge.svg?branch=main)](https://coveralls.io/github/CGSeb/voxelshift?branch=main)
[![Latest Version](https://img.shields.io/github/v/release/CGSeb/voxelshift?display_name=tag)](https://github.com/CGSeb/voxelshift/releases/latest)

Voxel Shift is an open source desktop launcher for Blender, built with Tauri, React, TypeScript, and Rust.

It is aimed at artists and technical users who keep multiple Blender installs around and want one place to:

- browse official Blender downloads
- install managed Blender builds
- launch the right Blender version quickly
- keep favorite versions close at hand
- reopen recent projects with the Blender build they came from

## App Overview

### Home

- recent projects with thumbnail fallback handling
- favorite Blender versions with launch shortcuts
- version status badges such as `Default` and `LTS`

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
