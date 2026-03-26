import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { updateCmd } from "../skills-cli";

interface UpdateProps {
	focused: boolean;
	isGlobal: boolean;
	selectedAgents: Set<string>;
	onBack: () => void;
}

export function Update({
	focused,
	isGlobal,
	selectedAgents,
	onBack,
}: UpdateProps) {
	const [command] = useState(() => updateCmd(isGlobal, selectedAgents));

	return <CommandOutput command={command} focused={focused} onBack={onBack} />;
}
