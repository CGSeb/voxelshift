export interface RecentProject {
  id: string;
  name: string;
  version: string;
  updated: string;
  accent: "sand" | "teal" | "ember";
}

export interface FavoriteVersion {
  id: string;
  name: string;
  channel: string;
  path: string;
}

export const recentProjects: RecentProject[] = [
  {
    id: "dust-lab",
    name: "Dust Lab",
    version: "Blender 4.2 LTS",
    updated: "Edited 2 hours ago",
    accent: "sand",
  },
  {
    id: "courtyard-study",
    name: "Courtyard Study",
    version: "Blender 3.6 LTS",
    updated: "Edited yesterday",
    accent: "teal",
  },
  {
    id: "relay-bike",
    name: "Relay Bike",
    version: "Blender 4.1",
    updated: "Edited 4 days ago",
    accent: "ember",
  },
];

export const favoriteVersions: FavoriteVersion[] = [
  {
    id: "blender-4-2",
    name: "Blender 4.2 LTS",
    channel: "Stable favorite",
    path: "Documents/VoxelShift/stable/blender-4.2",
  },
  {
    id: "blender-4-1",
    name: "Blender 4.1",
    channel: "Portable build",
    path: "Documents/VoxelShift/stable/blender-4.1",
  },
  {
    id: "blender-3-6",
    name: "Blender 3.6 LTS",
    channel: "Legacy project support",
    path: "Documents/VoxelShift/stable/blender-3.6",
  },
];
