import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => {
  class FakeResource {
    rid: number;

    constructor(rid: number) {
      this.rid = rid;
    }
  }

  class FakeChannel<T> {
    onmessage?: (event: T) => void;
  }

  return {
    invoke: vi.fn(),
    Resource: FakeResource,
    Channel: FakeChannel,
  };
});

vi.mock("@tauri-apps/api/core", () => coreMocks);

import { AppUpdate, checkForAppUpdate } from "./updater";

describe("updater helpers", () => {
  beforeEach(() => {
    coreMocks.invoke.mockReset();
  });

  it("wraps updater metadata into an AppUpdate resource", async () => {
    coreMocks.invoke.mockResolvedValue({
      rid: 12,
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-23",
      body: "Bug fixes",
      rawJson: { notes: true },
    });

    const update = await checkForAppUpdate();

    expect(update).toBeInstanceOf(AppUpdate);
    expect(update).toMatchObject({
      rid: 12,
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-03-23",
      body: "Bug fixes",
      rawJson: { notes: true },
    });
    expect(coreMocks.invoke).toHaveBeenCalledWith("plugin:updater|check");
  });

  it("returns null when no app update is available", async () => {
    coreMocks.invoke.mockResolvedValue(null);

    await expect(checkForAppUpdate()).resolves.toBeNull();
  });

  it("downloads and installs updates with an event channel", async () => {
    coreMocks.invoke.mockResolvedValue(undefined);

    const update = new AppUpdate({
      rid: 21,
      currentVersion: "1.0.0",
      version: "1.2.0",
      rawJson: {},
    });
    const onEvent = vi.fn();

    await update.downloadAndInstall(onEvent);

    const [command, payload] = coreMocks.invoke.mock.calls[0];
    expect(command).toBe("plugin:updater|download_and_install");
    expect(payload.rid).toBe(21);
    expect(payload.onEvent).toBeInstanceOf(coreMocks.Channel);

    payload.onEvent.onmessage?.({ event: "Progress", data: { chunkLength: 64 } });
    expect(onEvent).toHaveBeenCalledWith({ event: "Progress", data: { chunkLength: 64 } });
  });

  it("downloads and installs updates without wiring a progress callback", async () => {
    coreMocks.invoke.mockResolvedValue(undefined);

    const update = new AppUpdate({
      rid: 34,
      currentVersion: "1.0.0",
      version: "1.3.0",
      rawJson: {},
    });

    await update.downloadAndInstall();

    const [command, payload] = coreMocks.invoke.mock.calls[0];
    expect(command).toBe("plugin:updater|download_and_install");
    expect(payload.rid).toBe(34);
    expect(payload.onEvent).toBeInstanceOf(coreMocks.Channel);
    expect(payload.onEvent.onmessage).toBeUndefined();
  });
});
