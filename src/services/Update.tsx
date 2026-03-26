import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { updateArgs } from "../skills-cli";

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
	const [args] = useState(() => updateArgs(isGlobal, selectedAgents));

	return <CommandOutput args={args} focused={focused} onBack={onBack} />;
}
