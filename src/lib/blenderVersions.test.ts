import { describe, expect, it } from "vitest";
import { isBlenderLtsVersion } from "./blenderVersions";

describe("isBlenderLtsVersion", () => {
  it("recognizes versions from fetched Blender LTS release lines", () => {
    const ltsReleaseLines = ["3.6", "4.2", "4.5"];

    expect(isBlenderLtsVersion("3.6.18", ltsReleaseLines)).toBe(true);
    expect(isBlenderLtsVersion("4.2.3", ltsReleaseLines)).toBe(true);
    expect(isBlenderLtsVersion("4.5.0", ltsReleaseLines)).toBe(true);
  });

  it("rejects non-LTS release lines", () => {
    const ltsReleaseLines = ["4.2"];

    expect(isBlenderLtsVersion("4.1.1", ltsReleaseLines)).toBe(false);
    expect(isBlenderLtsVersion("4.4.0", ltsReleaseLines)).toBe(false);
  });

  it("handles empty or malformed values safely", () => {
    const ltsReleaseLines = ["4.2"];

    expect(isBlenderLtsVersion(null, ltsReleaseLines)).toBe(false);
    expect(isBlenderLtsVersion(undefined, ltsReleaseLines)).toBe(false);
    expect(isBlenderLtsVersion("daily-main", ltsReleaseLines)).toBe(false);
  });
});
