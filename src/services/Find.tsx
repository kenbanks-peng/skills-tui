import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { CommandOutput } from "../components/CommandOutput";
import { findArgs } from "../lib/skills-cli";
import { theme } from "../lib/theme";

interface FindProps {
	focusedColumn: "find" | "output" | null;
	isGlobal: boolean;
	onFocusOutput: () => void;
	onBack: () => void;
	onEscape: () => void;
	onExit: () => void;
}

export function Find({
	focusedColumn,
	isGlobal,
	onFocusOutput,
	onBack,
	onEscape,
	onExit,
}: FindProps) {
	const [query, setQuery] = useState("");
	const [currentArgs, setCurrentArgs] = useState<string[] | null>(null);

	useKeyboard((key) => {
		if (focusedColumn !== "find") return;
		if (key.name === "escape") {
			onEscape();
			return;
		}
		if (key.ctrl && key.name === "c") {
			onExit();
			return;
		}
		if ((key.name === "enter" || key.name === "return") && query.trim()) {
			setCurrentArgs(findArgs(isGlobal, query.trim()));
			onFocusOutput();
			return;
		}
		if (key.name === "enter" || key.name === "return") return;
		if (key.name === "backspace") {
			setQuery((prev) => prev.slice(0, -1));
			return;
		}
		if (
			key.sequence &&
			key.sequence.length === 1 &&
			!key.ctrl &&
			!key.meta &&
			key.sequence.charCodeAt(0) >= 32
		) {
			setQuery((prev) => prev + key.sequence);
		}
	});

	return (
		<>
			<box
				flexDirection="column"
				width={40}
				border
				borderStyle={focusedColumn === "find" ? "double" : "rounded"}
				borderColor={focusedColumn === "find" ? theme.lavender : theme.surface2}
				padding={1}
				title=" Search Query "
			>
				<box flexDirection="row">
					<text fg={theme.overlay1}>{"\u203a "}</text>
					<text fg={theme.text}>{query}</text>
					{focusedColumn === "find" && (
						<text fg={theme.lavender} attributes={TextAttributes.BOLD}>
							{"\u258e"}
						</text>
					)}
				</box>
				<box marginTop={1}>
					<text fg={theme.overlay0} attributes={TextAttributes.ITALIC}>
						Type a query and press Enter
					</text>
				</box>
			</box>
			<CommandOutput
				args={currentArgs}
				focused={focusedColumn === "output"}
				onBack={() => {
					setCurrentArgs(null);
					onBack();
				}}
			/>
		</>
	);
}
