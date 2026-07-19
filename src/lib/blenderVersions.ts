// Blender designates LTS support per major.minor release line.
function getBlenderReleaseLine(version: string) {
  const match = version.trim().match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function isBlenderLtsVersion(version: string | null | undefined, ltsReleaseLines: readonly string[]) {
  if (!version) {
    return false;
  }

  const releaseLine = getBlenderReleaseLine(version);
  return releaseLine ? ltsReleaseLines.includes(releaseLine) : false;
}
