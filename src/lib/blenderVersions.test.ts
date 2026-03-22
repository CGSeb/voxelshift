import { describe, expect, it } from "vitest";
import { isBlenderLtsVersion } from "./blenderVersions";

describe("isBlenderLtsVersion", () => {
  it("recognizes current Blender LTS release lines", () => {
    expect(isBlenderLtsVersion("3.6.18")).toBe(true);
    expect(isBlenderLtsVersion("4.2.3")).toBe(true);
    expect(isBlenderLtsVersion("4.5.0")).toBe(true);
  });

  it("rejects non-LTS release lines", () => {
    expect(isBlenderLtsVersion("4.1.1")).toBe(false);
    expect(isBlenderLtsVersion("4.4.0")).toBe(false);
  });

  it("handles empty or malformed values safely", () => {
    expect(isBlenderLtsVersion(null)).toBe(false);
    expect(isBlenderLtsVersion(undefined)).toBe(false);
    expect(isBlenderLtsVersion("daily-main")).toBe(false);
  });
});
