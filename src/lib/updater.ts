import { Channel, Resource, invoke } from "@tauri-apps/api/core";

export interface AppUpdateInfo {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

export type AppUpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

interface UpdateMetadata extends AppUpdateInfo {
  rid: number;
}

export class AppUpdate extends Resource implements AppUpdateInfo {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;

  constructor(metadata: UpdateMetadata) {
    super(metadata.rid);
    this.currentVersion = metadata.currentVersion;
    this.version = metadata.version;
    this.date = metadata.date;
    this.body = metadata.body;
    this.rawJson = metadata.rawJson;
  }

  async downloadAndInstall(onEvent?: (event: AppUpdateDownloadEvent) => void) {
    const channel = new Channel<AppUpdateDownloadEvent>();

    if (onEvent) {
      channel.onmessage = onEvent;
    }

    await invoke("plugin:updater|download_and_install", {
      onEvent: channel,
      rid: this.rid,
    });
  }
}

export async function checkForAppUpdate() {
  const metadata = await invoke<UpdateMetadata | null>("plugin:updater|check");
  return metadata ? new AppUpdate(metadata) : null;
}
