import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSource } from "#lib/config";
import { synchronizeConfiguredSkills } from "#lib/configured-skills";
import { formatNewSkillsSummary } from "#lib/skills";
import { theme } from "#lib/theme";

interface UpdatesProps {
	focused: boolean;
	repos: RepoSource[];
	isGlobal: boolean;
	cacheExpiryMs: number;
	onBack: () => void;
	onUpdateComplete: () => void;
}

export function Updates({
	focused,
	repos,
	isGlobal,
	cacheExpiryMs,
	onBack,
	onUpdateComplete,
}: UpdatesProps) {
	const [output, setOutput] = useState("");
	const [running, setRunning] = useState(false);
	const busy = useRef(false);
	const complete = useRef(onUpdateComplete);
	complete.current = onUpdateComplete;
	const update = useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		setRunning(true);
		setOutput("Updating selected skills from configured repositories...");
		try {
			const result = await synchronizeConfiguredSkills({
				refresh: true,
				scopes: [isGlobal],
			});
			const errors = result.errors.map(
				({ path, error }) => `${path}: ${String(error)}`,
			);
			setOutput(
				(errors.length
					? errors.join("\n")
					: "Selected skills are synchronized.") +
					(await formatNewSkillsSummary(repos, isGlobal, cacheExpiryMs)),
			);
			complete.current();
		} catch (error) {
			setOutput(String(error));
		} finally {
			busy.current = false;
			setRunning(false);
		}
	}, [repos, isGlobal, cacheExpiryMs]);
	useEffect(() => {
		void update();
	}, [update]);
	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "r") void update();
		if (key.name === "escape" && !running) onBack();
	});
	return (
		<box flexDirection="column" flexGrow={1} gap={1}>
			<text fg={theme.text}>
				{running ? "Applying latest versions" : "Update complete"}
			</text>
			<text fg={theme.overlay1}>r: update again esc: back</text>
			<scrollbox flexGrow={1}>
				<text fg={theme.text}>{output}</text>
			</scrollbox>
		</box>
	);
}
