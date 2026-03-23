import { describe, expect, it } from "vitest";
import { favoriteVersions, recentProjects } from "./homeContent";

describe("homeContent fixtures", () => {
  it("exposes sample recent projects and favorite versions", () => {
    expect(recentProjects).toHaveLength(3);
    expect(recentProjects[0]).toMatchObject({
      id: "dust-lab",
      accent: "sand",
    });

    expect(favoriteVersions).toHaveLength(3);
    expect(favoriteVersions.map((version) => version.path)).toEqual([
      "Documents/VoxelShift/stable/blender-4.2",
      "Documents/VoxelShift/stable/blender-4.1",
      "Documents/VoxelShift/stable/blender-3.6",
    ]);
  });
});
