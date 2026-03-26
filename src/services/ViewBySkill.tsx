import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import { theme } from "../theme";
import { viewportHeight } from "../utils";
import { parseInstalledSkills } from "../skills";
import type { InstalledSkillInfo } from "../skills";
import type { AgentConfig, UniversalAgents } from "../config";
import { useScrollableList } from "../useScrollableList";
import { SkillTable } from "../SkillTable";

interface ViewBySkillProps {
	focused: boolean;
	isGlobal: boolean;
	agents: AgentConfig[];
	selectedAgents: Set<string>;
	universalAgents: UniversalAgents;
	refreshKey: number;
	searchFilter: string;
}

export function ViewBySkill({
	focused,
	isGlobal,
	agents,
	selectedAgents,
	universalAgents,
	refreshKey,
	searchFilter,
}: ViewBySkillProps) {
	const { height } = useTerminalDimensions();
	const [installedSkills, setInstalledSkills] = useState<InstalledSkillInfo[]>(
		[],
	);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (agents.length > 0) {
			setLoading(true);
			const agentNames = agents
				.filter((a) => selectedAgents.has(a.name))
				.map((a) => a.name);
			parseInstalledSkills(isGlobal, agentNames).then((skills) => {
				setInstalledSkills(skills);
				setLoading(false);
			});
		}
	}, [isGlobal, selectedAgents, agents, refreshKey]);

	const lowerFilter = searchFilter.toLowerCase();
	const filteredSkills = searchFilter
		? installedSkills.filter((s) => s.name.toLowerCase().includes(lowerFilter))
		: installedSkills;

	// Use a rough viewport estimate for the hook (indicator lines are at most 2)
	const baseVH = viewportHeight(height, 19);
	const scrollList = useScrollableList(
		filteredSkills.length,
		Math.max(1, baseVH - 2),
	);

	const hasPrevIndicator = scrollList.scrollOffset > 0;
	const overflows = filteredSkills.length > baseVH;
	const indicatorLines = (hasPrevIndicator ? 1 : 0) + (overflows ? 1 : 0);
	const vh = Math.max(1, baseVH - indicatorLines);

	// Reset when filter changes
	useEffect(() => {
		scrollList.reset();
	}, [searchFilter]);

	useKeyboard((key) => {
		if (!focused || filteredSkills.length === 0) return;
		scrollList.handlers[key.name]?.();
	});

	const visibleAgents = agents.filter((a) => selectedAgents.has(a.name));

	// Build display-name sets for universal agents (from config)
	const isUniversalAgent = (name: string) =>
		universalAgents.both.has(name) || universalAgents.local.has(name);
	const isUniversalGlobalAgent = (name: string) =>
		universalAgents.both.has(name);

	const universalDisplayNames = new Set(
		visibleAgents.filter((a) => isUniversalAgent(a.name)).map((a) => a.display),
	);
	const universalGlobalDisplayNames = new Set(
		visibleAgents
			.filter((a) => isUniversalGlobalAgent(a.name))
			.map((a) => a.display),
	);

	// Check if an agent has a skill linked (directly or via shared universal path)
	const isLinked = (skill: InstalledSkillInfo, agent: AgentConfig): boolean => {
		if (skill.agents.has(agent.display)) return true;

		// Universal agents share installed skills through .agents/skills paths
		if (isGlobal && isUniversalGlobalAgent(agent.name)) {
			for (const name of universalGlobalDisplayNames) {
				if (skill.agents.has(name)) return true;
			}
		} else if (!isGlobal && isUniversalAgent(agent.name)) {
			for (const name of universalDisplayNames) {
				if (skill.agents.has(name)) return true;
			}
		}
		return false;
	};

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			border
			borderStyle={focused ? "double" : "rounded"}
			borderColor={focused ? theme.lavender : theme.surface2}
			padding={1}
			title=" Installed "
		>
			{loading ? (
				<text fg={theme.overlay1}>Loading...</text>
			) : filteredSkills.length === 0 ? (
				<text fg={theme.overlay1}>
					{searchFilter ? "No skills match filter" : "No skills installed"}
				</text>
			) : (
				<box flexDirection="column" flexGrow={1}>
					<SkillTable
						filteredSkills={filteredSkills}
						visibleAgents={visibleAgents}
						focused={focused}
						scrollOffset={scrollList.scrollOffset}
						activeIndex={scrollList.index}
						viewportHeight={vh}
						isLinked={isLinked}
					/>
				</box>
			)}
		</box>
	);
}
