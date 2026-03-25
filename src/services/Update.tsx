import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { ensureOpencode } from "../utils";

interface UpdateProps {
  focused: boolean;
  isGlobal: boolean;
  selectedAgents: Set<string>;
  onBack: () => void;
}

export function Update({ focused, isGlobal, selectedAgents, onBack }: UpdateProps) {
  const [command] = useState(() => {
    const globalFlag = isGlobal ? "-g " : "";
    return `skills update ${globalFlag}--agent ${ensureOpencode(selectedAgents).join(" ")} -y`.trim();
  });

  return (
    <CommandOutput
      command={command}
      focused={focused}
      onBack={onBack}
    />
  );
}
