import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { CommandOutput } from "#components/CommandOutput";
import type { RepoSource } from "#lib/config";
import { formatNewSkillsSummary } from "#lib/skills";
import { checkArgs, updateArgs } from "#lib/skills-cli";
import { theme } from "#lib/theme";

interface UpdatesProps {
	focused: boolean;
	repos: RepoSource[];
	isGlobal: boolean;
	cacheExpiryMs: number;
	onBack: () => void;
}

export function Updates({
	focused,
	repos,
	isGlobal,
	cacheExpiryMs,
	onBack,
}: UpdatesProps) {
	const [args, setArgs] = useState(() => checkArgs(isGlobal));
	const [mode, setMode] = useState<"check" | "update">("check");
	const [afterCommand] = useState(
		() => () => formatNewSkillsSummary(repos, isGlobal, cacheExpiryMs),
	);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "u") {
			setMode("update");
			setArgs(updateArgs(isGlobal));
		}
		if (key.name === "r") {
			setMode("check");
			setArgs(checkArgs(isGlobal));
		}
	});

	return (
		<box flexDirection="column" flexGrow={1} gap={1}>
			<box
				border
				borderStyle="rounded"
				borderColor={focused ? theme.green : theme.surface2}
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={theme.text}>
					{mode === "check" ? "Checking for updates" : "Applying updates"}
				</text>
				<text fg={theme.overlay1}>
					{"  "}u: apply updates  r: re-check  esc: back
				</text>
			</box>
			<CommandOutput
				args={args}
				focused={focused}
				onBack={onBack}
				afterCommand={afterCommand}
			/>
		</box>
	);
}
