import { useState } from "react";
import { CommandOutput } from "#components/CommandOutput";

interface CommandServiceProps {
	focused: boolean;
	argsBuilder: () => string[];
	onBack: () => void;
	afterCommandBuilder?: () => () => Promise<string>;
}

export function CommandService({
	focused,
	argsBuilder,
	onBack,
	afterCommandBuilder,
}: CommandServiceProps) {
	const [args] = useState(argsBuilder);
	const [afterCommand] = useState(() => afterCommandBuilder?.());

	return (
		<CommandOutput
			args={args}
			focused={focused}
			onBack={onBack}
			afterCommand={afterCommand}
		/>
	);
}
