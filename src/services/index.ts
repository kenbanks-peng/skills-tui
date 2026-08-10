export const ServiceId = {
	VIEW_BY_REPO: 0,
	VIEW_BY_SKILL: 1,
	FIND: 2,
	UPDATE: 3,
} as const;
export type ServiceId = (typeof ServiceId)[keyof typeof ServiceId];

export interface Service {
	id: ServiceId;
	name: string;
	description: string;
}

export const services: Service[] = [
	{
		id: ServiceId.VIEW_BY_REPO,
		name: "View by repo",
		description: "Browse and install skills",
	},
	{
		id: ServiceId.VIEW_BY_SKILL,
		name: "View by skill",
		description: "List installed skills",
	},
	{ id: ServiceId.FIND, name: "Find", description: "Search for skills" },
	{
		id: ServiceId.UPDATE,
		name: "Updates",
		description: "Check and apply skill updates",
	},
];
