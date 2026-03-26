import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { checkArgs } from "../skills-cli";

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
	const [args] = useState(() => checkArgs(isGlobal, selectedAgents));

	return <CommandOutput args={args} focused={focused} onBack={onBack} />;
}
