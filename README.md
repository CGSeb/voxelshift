# Voxel Shift

Voxel Shift is a Tauri + React desktop launcher for managing Blender installs and opening projects with the Blender version they were created in.

## Product Direction

The intended launcher flow is:

- Home page
  - Show recent projects with a thumbnail and project name.
  - Clicking a recent project should launch the Blender version the project was created in.
  - Show a second section for favorite Blender versions so common builds can be launched quickly.
- Installed versions page
  - Show every Blender version installed locally.
  - Allow each version to be launched, marked as favorite, or deleted.
- Available versions page
  - Show Blender builds available to install from the official release mirror.
  - Installing a version should download the portable archive and unzip it into `Documents/VoxelShift/stable`.
  - The same Blender version must not be installable twice.

## Current Scope

Only the home page layout is implemented right now.

- Recent projects are shown as static placeholder cards.
- Favorite Blender versions are shown as static placeholder cards.
- Installed versions management, downloads, deletion, favorites persistence, project detection, and Blender launching are not implemented yet.

## Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust backend for native launcher capabilities

## Local Development

```powershell
npm.cmd install
npm.cmd run tauri dev
```

## Build

```powershell
npm.cmd install
npm.cmd run tauri build
```
