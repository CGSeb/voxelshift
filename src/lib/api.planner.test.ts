import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  createPlannerRun,
  deletePlannerRun,
  getPlannerLogs,
  getPlannerRuns,
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

  it("calls invoke with the expected planner command names and payloads", async () => {
    const plannerPayload = {
      blendFilePath: "D:\\scene.blend",
      startFrame: 1,
      endFrame: 120,
      startAt: 1_775_688_000,
      outputFolderPath: "D:\\renders",
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
