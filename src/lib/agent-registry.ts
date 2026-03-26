import type { AgentConfig } from "./config";

// Standard agent skills paths (used as defaults when local/global not specified)
const STD_LOCAL = ".agents/skills/";
const STD_GLOBAL = "~/.config/agents/skills/";

interface RegistryEntry {
  name: string;
  display: string;
  local?: string;
  global?: string;
}

const registry: RegistryEntry[] = [
  { name: "adal", display: "AdaL", local: ".adal/skills/", global: "~/.adal/skills/" },
  { name: "amp", display: "Amp" },
  { name: "antigravity", display: "Antigravity", local: ".agent/skills/", global: "~/.gemini/antigravity/skills/" },
  { name: "augment", display: "Augment", local: ".augment/skills/", global: "~/.augment/skills/" },
  { name: "claude-code", display: "Claude Code", local: ".claude/skills/", global: "~/.claude/skills/" },
  { name: "cline", display: "Cline", global: "~/.agents/skills/" },
  { name: "codebuddy", display: "CodeBuddy", local: ".codebuddy/skills/", global: "~/.codebuddy/skills/" },
  { name: "codex", display: "Codex", global: "~/.codex/skills/" },
  { name: "command-code", display: "Command Code", local: ".commandcode/skills/", global: "~/.commandcode/skills/" },
  { name: "continue", display: "Continue", local: ".continue/skills/", global: "~/.continue/skills/" },
  { name: "github-copilot", display: "GitHub Copilot", global: "~/.copilot/skills/" },
  { name: "cortex", display: "Cortex Code", local: ".cortex/skills/", global: "~/.snowflake/cortex/skills/" },
  { name: "crush", display: "Crush", local: ".crush/skills/", global: "~/.config/crush/skills/" },
  { name: "cursor", display: "Cursor", global: "~/.cursor/skills/" },
  { name: "droid", display: "Droid", local: ".factory/skills/", global: "~/.factory/skills/" },
  { name: "gemini-cli", display: "Gemini CLI", global: "~/.gemini/skills/" },
  { name: "goose", display: "Goose", local: ".goose/skills/", global: "~/.config/goose/skills/" },
  { name: "iflow-cli", display: "iFlow CLI", local: ".iflow/skills/", global: "~/.iflow/skills/" },
  { name: "junie", display: "Junie", local: ".junie/skills/", global: "~/.junie/skills/" },
  { name: "kilo", display: "Kilo Code", local: ".kilocode/skills/", global: "~/.kilocode/skills/" },
  { name: "kimi-cli", display: "Kimi Code CLI" },
  { name: "kiro-cli", display: "Kiro CLI", local: ".kiro/skills/", global: "~/.kiro/skills/" },
  { name: "kode", display: "Kode", local: ".kode/skills/", global: "~/.kode/skills/" },
  { name: "mcpjam", display: "MCPJam", local: ".mcpjam/skills/", global: "~/.mcpjam/skills/" },
  { name: "mistral-vibe", display: "Mistral Vibe", local: ".vibe/skills/", global: "~/.vibe/skills/" },
  { name: "mux", display: "Mux", local: ".mux/skills/", global: "~/.mux/skills/" },
  { name: "neovate", display: "Neovate", local: ".neovate/skills/", global: "~/.neovate/skills/" },
  { name: "openclaw", display: "OpenClaw", local: "skills/", global: "~/.openclaw/skills/" },
  { name: "opencode", display: "OpenCode", global: "~/.config/opencode/skills/" },
  { name: "openhands", display: "OpenHands", local: ".openhands/skills/", global: "~/.openhands/skills/" },
  { name: "pi", display: "Pi", local: ".pi/skills/", global: "~/.pi/agent/skills/" },
  { name: "pochi", display: "Pochi", local: ".pochi/skills/", global: "~/.pochi/skills/" },
  { name: "qoder", display: "Qoder", local: ".qoder/skills/", global: "~/.qoder/skills/" },
  { name: "qwen-code", display: "Qwen Code", local: ".qwen/skills/", global: "~/.qwen/skills/" },
  { name: "replit", display: "Replit" },
  { name: "roo", display: "Roo Code", local: ".roo/skills/", global: "~/.roo/skills/" },
  { name: "trae", display: "Trae", local: ".trae/skills/", global: "~/.trae/skills/" },
  { name: "trae-cn", display: "Trae CN", local: ".trae/skills/", global: "~/.trae-cn/skills/" },
  { name: "windsurf", display: "Windsurf", local: ".windsurf/skills/", global: "~/.codeium/windsurf/skills/" },
  { name: "zencoder", display: "Zencoder", local: ".zencoder/skills/", global: "~/.zencoder/skills/" },
];

// Build a lookup map for quick access by name
const registryMap = new Map<string, RegistryEntry>(
  registry.map(e => [e.name, e])
);

// Resolve an agent name (or config override) to a full AgentConfig.
// Config overrides take precedence over the builtin registry.
export function resolveAgent(entry: string | { name: string; display?: string; local?: string; global?: string }): AgentConfig {
  const name = typeof entry === "string" ? entry : entry.name;
  const overrides = typeof entry === "string" ? {} : entry;
  const builtin = registryMap.get(name);

  const display = overrides.display ?? builtin?.display
    ?? name.charAt(0).toUpperCase() + name.slice(1);
  const local = overrides.local ?? builtin?.local ?? STD_LOCAL;
  const global = overrides.global ?? builtin?.global ?? STD_GLOBAL;

  return { name, display, local, global };
}

// Get all builtin agent configs
export function getBuiltinAgents(): AgentConfig[] {
  return registry.map(e => resolveAgent(e.name));
}
