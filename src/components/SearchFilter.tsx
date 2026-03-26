import { TextAttributes } from "@opentui/core";
import { theme } from "../lib/theme";

interface SearchFilterProps {
	focused: boolean;
	searchFilter: string;
}

export function SearchFilter({ focused, searchFilter }: SearchFilterProps) {
	return (
		<box
			border
			borderStyle={focused ? "double" : "rounded"}
			borderColor={focused ? theme.lavender : theme.surface2}
			paddingLeft={1}
			paddingRight={1}
			height={3}
			flexShrink={0}
			title=" Filter "
		>
			<box flexDirection="row">
				<text fg={theme.overlay1}>{"\u203a "}</text>
				{searchFilter ? (
					<text fg={theme.text}>{searchFilter}</text>
				) : !focused ? (
					<text fg={theme.overlay0}>Type to filter skills...</text>
				) : null}
				{focused && (
					<text fg={theme.lavender} attributes={TextAttributes.BOLD}>
						{"\u258e"}
					</text>
				)}
			</box>
		</box>
	);
}
