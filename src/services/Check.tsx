import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { checkCmd } from "../skills-cli";

interface CheckProps {
	focused: boolean;
	isGlobal: boolean;
	selectedAgents: Set<string>;
	onBack: () => void;
}

export function Check({
	focused,
	isGlobal,
	selectedAgents,
	onBack,
}: CheckProps) {
	const [command] = useState(() => checkCmd(isGlobal, selectedAgents));

	return <CommandOutput command={command} focused={focused} onBack={onBack} />;
}
