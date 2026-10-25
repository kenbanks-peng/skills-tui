import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentSkillDirectory } from "#lib/copy-agent-skills";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { SkillTable } from "#components/SkillTable";
import { useScrollableList } from "#hooks/useScrollableList";
import type { AgentConfig, UniversalAgents } from "#lib/config";
import type { InstalledSkillInfo } from "#lib/skills";
import { listInstalledSkills } from "#lib/skills";
import { theme } from "#lib/theme";
import { viewportHeight } from "#lib/utils";

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
		let active = true;
		setLoading(true);
		listInstalledSkills(isGlobal)
			.then((skills) => {
				if (active) setInstalledSkills(skills);
			})
			.catch(() => {
				if (active) setInstalledSkills([]);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [isGlobal, refreshKey]);

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
	}, [scrollList.reset]);

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

	// Check if an agent has a skill linked (directly or via shared universal path)
	const isLinked = (skill: InstalledSkillInfo, agent: AgentConfig): boolean => {
		if (agent.mode === "copy")
			return existsSync(
				join(
					agentSkillDirectory(agent, isGlobal ? "global" : "local"),
					skill.name,
					"SKILL.md",
				),
			);
		if (
			existsSync(
				join(
					agentSkillDirectory(agent, isGlobal ? "global" : "local"),
					skill.name,
					"SKILL.md",
				),
			)
		)
			return true;

		// Universal agents read directly from .agents/skills paths,
		// so any skill located there is visible to them regardless of
		// which agent name the CLI reports.
		if (isGlobal && isUniversalGlobalAgent(agent.name)) {
			if (skill.path.startsWith("~/.agents/skills")) return true;
		} else if (!isGlobal && isUniversalAgent(agent.name)) {
			if (skill.path.startsWith(".agents/skills")) return true;
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
