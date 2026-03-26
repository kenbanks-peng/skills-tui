import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { theme, CHECK_MARK } from "../theme";
import { viewportHeight } from "../utils";
import type { AgentConfig } from "../config";

interface SettingsPanelProps {
	focused: boolean;
	isGlobal: boolean;
	agents: AgentConfig[];
	selectedAgents: Set<string>;
	activeSettingIndex: number;
	onToggleGlobal: () => void;
	onToggleAgent: (agent: string) => void;
	onActiveIndexChange: (index: number) => void;
}

export function SettingsPanel({
	focused,
	isGlobal,
	agents,
	selectedAgents,
	activeSettingIndex,
	onToggleGlobal,
	onToggleAgent,
	onActiveIndexChange,
}: SettingsPanelProps) {
	const settingsCount = 1 + agents.length;
	const { height: termHeight } = useTerminalDimensions();
	const [scrollOffset, setScrollOffset] = useState(0);

	// Available inner height: termHeight - 8 (outer padding/footer) - 9 (services panel) - 1 (margin) - 4 (border/padding) - 2 (scope row + spacer)
	const maxAgentSlots = viewportHeight(termHeight, 24);

	const hasLess = scrollOffset > 0;
	const hasMore = scrollOffset + maxAgentSlots < agents.length;
	const visibleAgentCount =
		maxAgentSlots - (hasLess ? 1 : 0) - (hasMore ? 1 : 0);
	const visibleAgents = agents.slice(
		scrollOffset,
		scrollOffset + visibleAgentCount,
	);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "up") {
			const newIndex = Math.max(0, activeSettingIndex - 1);
			const newAgentIndex = newIndex - 1;
			if (newAgentIndex >= 0 && newAgentIndex < scrollOffset) {
				setScrollOffset(newAgentIndex);
			}
			onActiveIndexChange(newIndex);
			return;
		}
		if (key.name === "down") {
			const newIndex = Math.min(settingsCount - 1, activeSettingIndex + 1);
			const newAgentIndex = newIndex - 1;
			if (
				newAgentIndex >= 0 &&
				newAgentIndex >= scrollOffset + visibleAgentCount
			) {
				setScrollOffset((prev) => {
					const newOffset = prev + 1;
					const newHasMore = newOffset + maxAgentSlots < agents.length;
					const newVisible = maxAgentSlots - 1 - (newHasMore ? 1 : 0);
					if (newAgentIndex >= newOffset + newVisible) {
						return newAgentIndex - newVisible + 1;
					}
					return newOffset;
				});
			}
			onActiveIndexChange(newIndex);
			return;
		}
		if (key.name === "space") {
			if (activeSettingIndex === 0) {
				onToggleGlobal();
			} else {
				const agent = agents[activeSettingIndex - 1];
				if (agent) onToggleAgent(agent.name);
			}
		}
	});

	return (
		<box
			flexDirection="column"
			border
			borderStyle={focused ? "double" : "rounded"}
			borderColor={focused ? theme.lavender : theme.surface2}
			padding={1}
			marginTop={1}
			flexGrow={1}
			title=" Settings "
		>
			<box
				flexDirection="row"
				alignItems="center"
				justifyContent="space-between"
				backgroundColor={
					activeSettingIndex === 0 ? theme.surface1 : "transparent"
				}
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={activeSettingIndex === 0 ? theme.yellow : theme.subtext1}>
					{activeSettingIndex === 0 ? "▶ " : "  "}Scope:
				</text>
				<text
					fg={isGlobal ? theme.green : theme.peach}
					attributes={TextAttributes.BOLD}
				>
					{isGlobal ? "global" : "project"}
				</text>
			</box>
			<box height={1} />
			{hasLess && (
				<text fg={theme.overlay1} paddingLeft={2}>
					▲ {scrollOffset} more
				</text>
			)}
			{visibleAgents.map((agent, vi) => {
				const settingIndex = scrollOffset + vi + 1;
				const isActive = activeSettingIndex === settingIndex;
				const isChecked = selectedAgents.has(agent.name);
				return (
					<box
						key={agent.name}
						flexDirection="row"
						alignItems="center"
						backgroundColor={isActive ? theme.surface1 : "transparent"}
						paddingLeft={1}
						paddingRight={1}
					>
						<text
							fg={
								isActive
									? theme.yellow
									: isChecked
										? theme.green
										: theme.subtext1
							}
						>
							{isChecked ? `[${CHECK_MARK}] ` : "[ ] "}
							{agent.display}
						</text>
					</box>
				);
			})}
			{hasMore && (
				<text fg={theme.overlay1} paddingLeft={2}>
					▼ {agents.length - scrollOffset - visibleAgentCount} more
				</text>
			)}
		</box>
	);
}
