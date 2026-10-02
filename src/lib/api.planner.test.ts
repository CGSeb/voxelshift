import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  cancelPlannerRun,
  createPlannerRun,
  deletePlannerRun,
  getPlannerLogs,
  getPlannerRuns,
  getPlannerQueue,
  reorderPlannerQueue,
  retryPlannerRun,
  setPlannerQueuePaused,
  pickPlannerBlenderExecutable,
  pickPlannerBlendFile,
  pickPlannerOutputFolder,
  updatePlannerRun,
} from "./api";

describe("planner api wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("preserves queue order, pause state, and retry results across the Tauri boundary", async () => {
    const queue = { paused: true, pendingRunIds: ["second", "first"] };
    const retry = { id: "retry-1", status: "pending" };
    invokeMock.mockResolvedValueOnce(queue).mockResolvedValueOnce(queue)
      .mockResolvedValueOnce(queue).mockResolvedValueOnce(undefined).mockResolvedValueOnce(retry);
    await expect(getPlannerQueue()).resolves.toEqual(queue);
    await expect(setPlannerQueuePaused(true)).resolves.toEqual(queue);
    await expect(reorderPlannerQueue(queue.pendingRunIds)).resolves.toEqual(queue);
    await expect(cancelPlannerRun("active-1")).resolves.toBeUndefined();
    await expect(retryPlannerRun("failed-1")).resolves.toEqual(retry);
    expect(invokeMock.mock.calls).toEqual([
      ["get_planner_queue"],
      ["set_planner_queue_paused", { paused: true }],
      ["reorder_planner_queue", { runIds: ["second", "first"] }],
      ["cancel_planner_run", { runId: "active-1" }],
      ["retry_planner_run", { runId: "failed-1" }],
    ]);
  });

  it("propagates rejected controls without substituting a successful result", async () => {
    const error = new Error("Queue changed. Refresh.");
    for (const operation of [
      () => getPlannerQueue(), () => setPlannerQueuePaused(false),
      () => reorderPlannerQueue([]), () => cancelPlannerRun("missing"), () => retryPlannerRun("running"),
    ]) {
      invokeMock.mockRejectedValueOnce(error);
      await expect(operation()).rejects.toBe(error);
    }
  });

  it("calls invoke with the expected planner command names and payloads", async () => {
    const plannerPayload = {
      blendFilePath: "D:\\scene.blend",
      startFrame: 1,
      endFrame: 120,
      startAt: 1_775_688_000,
      outputFolderPath: "D:\\renders",
      shutdownWhenDone: true,
      blender: {
        source: "library" as const,
        versionId: "version-1",
        executablePath: null,
      },
    };

    await getPlannerRuns();
    await getPlannerLogs("planner-1");
    await deletePlannerRun("planner-1");
    await updatePlannerRun("planner-1", plannerPayload);
    await createPlannerRun(plannerPayload);
    await pickPlannerBlendFile();
    await pickPlannerBlenderExecutable();
    await pickPlannerOutputFolder();

    expect(invokeMock.mock.calls).toEqual([
      ["get_planner_runs"],
      ["get_planner_logs", { runId: "planner-1" }],
      ["delete_planner_run", { runId: "planner-1" }],
      ["update_planner_run", { runId: "planner-1", request: plannerPayload }],
      ["create_planner_run", { request: plannerPayload }],
      ["pick_planner_blend_file"],
      ["pick_planner_blender_executable"],
      ["pick_planner_output_folder"],
    ]);
  });
});
