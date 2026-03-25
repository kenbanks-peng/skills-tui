import { useState } from "react";
import { CommandOutput } from "../CommandOutput";
import { ensureOpencode } from "../utils";

interface CheckProps {
  focused: boolean;
  isGlobal: boolean;
  selectedAgents: Set<string>;
  onBack: () => void;
}

export function Check({ focused, isGlobal, selectedAgents, onBack }: CheckProps) {
  const [command] = useState(() => {
    const globalFlag = isGlobal ? "-g " : "";
    return `skills check ${globalFlag}--agent ${ensureOpencode(selectedAgents).join(" ")}`.trim();
  });

  return (
    <CommandOutput
      command={command}
      focused={focused}
      onBack={onBack}
    />
  );
}
