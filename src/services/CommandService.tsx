import { useState } from "react";
import { CommandOutput } from "#components/CommandOutput";

interface CommandServiceProps {
	focused: boolean;
	argsBuilder: () => string[];
	onBack: () => void;
}

export function CommandService({
	focused,
	argsBuilder,
	onBack,
}: CommandServiceProps) {
	const [args] = useState(argsBuilder);

	return <CommandOutput args={args} focused={focused} onBack={onBack} />;
}
