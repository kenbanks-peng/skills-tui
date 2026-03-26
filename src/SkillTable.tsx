import { TextAttributes } from "@opentui/core";
import { theme, CHECK_MARK } from "./theme";
import type { InstalledSkillInfo } from "./skills";
import type { AgentConfig } from "./config";

interface SkillTableProps {
	filteredSkills: InstalledSkillInfo[];
	visibleAgents: AgentConfig[];
	focused: boolean;
	scrollOffset: number;
	activeIndex: number;
	viewportHeight: number;
	isLinked: (skill: InstalledSkillInfo, agent: AgentConfig) => boolean;
}

export function SkillTable({
	filteredSkills,
	visibleAgents,
	focused,
	scrollOffset,
	activeIndex,
	viewportHeight: vh,
	isLinked,
}: SkillTableProps) {
	const nameColWidth =
		Math.max(12, ...filteredSkills.map((s) => s.name.length)) + 2;
	const agentColWidth =
		Math.max(...visibleAgents.map((a) => a.display.length), 6) + 2;
	const centerPad = (text: string, width: number) => {
		const pad = Math.max(0, width - text.length);
		const left = Math.floor(pad / 2);
		return " ".repeat(left) + text + " ".repeat(pad - left);
	};
	const totalRowWidth = nameColWidth + agentColWidth * visibleAgents.length;
	const header =
		"Skill".padEnd(nameColWidth) +
		visibleAgents.map((a) => centerPad(a.display, agentColWidth)).join("");
	const separator = "\u2500".repeat(totalRowWidth);

	const hasPrevious = scrollOffset > 0;
	const visibleSkills = filteredSkills.slice(scrollOffset, scrollOffset + vh);
	const hasMore = scrollOffset + vh < filteredSkills.length;

	return (
		<>
			<box flexDirection="column" flexShrink={0}>
				<text fg={theme.lavender} attributes={TextAttributes.BOLD}>
					{header}
				</text>
				<text fg={theme.surface2}>{separator}</text>
			</box>
			{hasPrevious && (
				<box height={1} flexShrink={0}>
					<text fg={theme.overlay1}>
						{" "}
						{"\u2191"} {scrollOffset} more above
					</text>
				</box>
			)}
			<box flexDirection="column" height={vh} overflow="hidden">
				{visibleSkills.map((skill, visibleIdx) => {
					const idx = scrollOffset + visibleIdx;
					const isHighlighted = focused && idx === activeIndex;
					return (
						<box
							key={skill.name}
							width={totalRowWidth}
							backgroundColor={isHighlighted ? theme.surface1 : "transparent"}
						>
							<text>
								<span
									fg={isHighlighted ? theme.yellow : theme.text}
									attributes={isHighlighted ? TextAttributes.BOLD : undefined}
								>
									{skill.name.padEnd(nameColWidth)}
								</span>
								{visibleAgents.map((a) => {
									const linked = isLinked(skill, a);
									return (
										<span
											key={a.name}
											fg={linked ? theme.green : theme.overlay0}
										>
											{centerPad(linked ? CHECK_MARK : "\u00b7", agentColWidth)}
										</span>
									);
								})}
							</text>
						</box>
					);
				})}
			</box>
			{hasMore && (
				<box height={1} flexShrink={0}>
					<text fg={theme.overlay1}>
						{" "}
						{"\u2193"} {filteredSkills.length - scrollOffset - vh} more below
					</text>
				</box>
			)}
		</>
	);
}
