export const SERVICE_VIEW_BY_REPO = 0;
export const SERVICE_VIEW_BY_SKILL = 1;
export const SERVICE_FIND = 2;
export const SERVICE_CHECK = 3;
export const SERVICE_UPDATE = 4;

export interface Service {
  id: number;
  name: string;
  description: string;
}

export const services: Service[] = [
  { id: SERVICE_VIEW_BY_REPO, name: "View by repo", description: "Browse and install skills" },
  { id: SERVICE_VIEW_BY_SKILL, name: "View by skill", description: "List installed skills" },
  { id: SERVICE_FIND, name: "Find", description: "Search for skills" },
  { id: SERVICE_CHECK, name: "Check", description: "Check for updates" },
  { id: SERVICE_UPDATE, name: "Update", description: "Update skills" },
];
