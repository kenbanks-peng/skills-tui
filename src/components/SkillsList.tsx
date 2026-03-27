import { TextAttributes } from "@opentui/core";
import { CHECK_MARK, theme } from "#lib/theme";
import { truncateText } from "#lib/utils";

interface SkillsListProps {
	focusedColumn: "repos" | "skills" | null;
	filteredSkills: string[];
	selectedSkills: Set<string>;
	loadingSkills: boolean;
	searchFilter: string;
	scrollOffset: number;
	activeIndex: number;
	adjustedVH: number;
}

export function SkillsList({
	focusedColumn,
	filteredSkills,
	selectedSkills,
	loadingSkills,
	searchFilter,
	scrollOffset,
	activeIndex,
	adjustedVH,
}: SkillsListProps) {
	const hasPrevious = scrollOffset > 0;
	const visibleSkills = filteredSkills.slice(
		scrollOffset,
		scrollOffset + adjustedVH,
	);
	const hasMore = scrollOffset + adjustedVH < filteredSkills.length;

	return (
		<box
			flexDirection="column"
			width={40}
			flexGrow={1}
			border
			borderStyle={focusedColumn === "skills" ? "double" : "rounded"}
			borderColor={focusedColumn === "skills" ? theme.lavender : theme.surface2}
			padding={1}
			overflow="hidden"
			title=" Skills (Space to select) "
		>
			{loadingSkills ? (
				<box flexGrow={1} justifyContent="center" alignItems="center">
					<text fg={theme.overlay1}>Loading...</text>
				</box>
			) : filteredSkills.length > 0 ? (
				<>
					{hasPrevious && (
						<box paddingLeft={1} marginBottom={1}>
							<text fg={theme.overlay1}>
								{"\u2191"} {scrollOffset} more above
							</text>
						</box>
					)}
					<box flexDirection="column" gap={0} overflow="hidden" flexGrow={1}>
						{visibleSkills.map((skill, visibleIndex) => {
							const idx = scrollOffset + visibleIndex;
							const isHighlighted = idx === activeIndex;
							const isSelected = selectedSkills.has(skill);
							const checkbox = isSelected ? `[${CHECK_MARK}] ` : "[ ] ";
							const displayName = truncateText(skill, 31);
							return (
								<box
									key={skill}
									paddingLeft={1}
									backgroundColor={
										isHighlighted ? theme.surface1 : "transparent"
									}
								>
									<text
										fg={
											isSelected
												? theme.green
												: isHighlighted
													? theme.yellow
													: theme.subtext1
										}
										attributes={isHighlighted ? TextAttributes.BOLD : undefined}
									>
										{checkbox}
										{displayName}
									</text>
								</box>
							);
						})}
					</box>
					{hasMore && (
						<box paddingLeft={1}>
							<text fg={theme.overlay1}>
								{"\u2193"} {filteredSkills.length - scrollOffset - adjustedVH}{" "}
								more below
							</text>
						</box>
					)}
				</>
			) : searchFilter ? (
				<text fg={theme.overlay1}>No skills match filter</text>
			) : (
				<text fg={theme.overlay1}>No skills available</text>
			)}
		</box>
	);
}
