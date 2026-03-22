const blenderLtsReleaseLines = new Set(["2.83", "2.93", "3.3", "3.6", "4.2", "4.5"]);

// Blender designates LTS support per major.minor release line.
function getBlenderReleaseLine(version: string) {
  const match = version.trim().match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function isBlenderLtsVersion(version: string | null | undefined) {
  if (!version) {
    return false;
  }

  const releaseLine = getBlenderReleaseLine(version);
  return releaseLine ? blenderLtsReleaseLines.has(releaseLine) : false;
}
