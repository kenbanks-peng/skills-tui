import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { resolveAgent } from "./agent-registry";

// XDG-style paths
export const configDir = join(homedir(), ".config", "skills-tui");
export const cacheDir = join(homedir(), ".cache", "skills-tui");
export const stateDir = join(homedir(), ".local", "state", "skills-tui");
export const configPath = join(configDir, "config.toml");
export const disabledAgentsPath = join(stateDir, "disabled-agents.json");

export interface AgentConfig {
  name: string;
  display: string;
  local: string;
  global: string;
}

// Repo source — just a url string.
// GitHub repos: "owner/repo", remote: "https://...", local: "file:///path"
export type RepoSource = string;

// Which standard .agents/skills paths an agent supports
export interface UniversalAgents {
  both: Set<string>;  // supports both .agents/skills (local) and ~/.agents/skills (global)
  local: Set<string>; // supports .agents/skills (local) only
}

const defaultConfig = `# skills-tui configuration

# GitHub: "owner/repo", remote: "https://...", local: "file:///path/to/skills"
repos = [
  "vercel-labs/skills",
  "anthropics/skills",
  "huggingface/skills",
  "openai/skills",
  "msmps/opentui-skill",
  "vercel-labs/agent-skills",
  "kepano/obsidian-skills",
  "obra/superpowers",
  "sickn33/antigravity-awesome-skills",
]

[agents]
enabled = [
  "adal",
  "amp",
  "antigravity",
  "augment",
  "claude-code",
  "cline",
  "codebuddy",
  "codex",
  "command-code",
  "continue",
  "github-copilot",
  "cortex",
  "crush",
  "cursor",
  "droid",
  "gemini-cli",
  "goose",
  "iflow-cli",
  "junie",
  "kilo",
  "kimi-cli",
  "kiro-cli",
  "kode",
  "mcpjam",
  "mistral-vibe",
  "mux",
  "neovate",
  "openclaw",
  "opencode",
  "openhands",
  "pi",
  "pochi",
  "qoder",
  "qwen-code",
  "replit",
  "roo",
  "trae",
  "trae-cn",
  "windsurf",
  "zencoder",
]

# Agents that discover skills from the standard .agents/skills paths.
# These agents will see any skill installed by the skills CLI.
# "both" = reads .agents/skills (local) and ~/.agents/skills (global)
# "local" = reads .agents/skills (local) only
[agents.universal]
both = [
  "augment",
  "codex",
  "gemini-cli",
  "kimi-cli",
  "mux",
  "opencode",
  "openhands",
  "pi",
  "roo",
  "windsurf",
]
local = [
  "amp",
  "antigravity",
  "command-code",
  "cursor",
  "goose",
  "replit",
]

# To add a custom agent or override builtin paths:
# [[custom-agents]]
# name = "my-agent"
# display = "My Agent"
# local = ".my-agent/skills/"
# global = "~/.my-agent/skills/"
`;

// Ensure config, cache, and state directories exist, seed default config if missing
export function ensureDirectories() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, defaultConfig);
  }
}

// Load disabled agents from state file
export async function loadDisabledAgents(): Promise<Set<string>> {
  try {
    const file = Bun.file(disabledAgentsPath);
    if (!(await file.exists())) return new Set();
    const data: unknown = JSON.parse(await file.text());
    if (Array.isArray(data)) return new Set(data);
    return new Set();
  } catch {
    return new Set();
  }
}

// Save disabled agents to state file
export async function saveDisabledAgents(disabled: Set<string>): Promise<void> {
  mkdirSync(stateDir, { recursive: true });
  await Bun.write(disabledAgentsPath, JSON.stringify([...disabled]));
}

// Load agents from config.toml
export async function loadAgents(): Promise<AgentConfig[]> {
  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) return [];
    const config: any = Bun.TOML.parse(await file.text());

    // [agents] enabled = ["claude-code", "cursor", ...] — resolve from builtin registry
    const agentNames: string[] = Array.isArray(config?.agents?.enabled) ? config.agents.enabled : [];
    const agents = new Map<string, AgentConfig>(
      agentNames.map(name => [name, resolveAgent(name)])
    );

    // [[custom-agents]] — always enabled, overrides builtins
    const customAgents: any[] = Array.isArray(config?.["custom-agents"]) ? config["custom-agents"] : [];
    for (const entry of customAgents) {
      const resolved = resolveAgent(entry);
      agents.set(resolved.name, resolved);
    }

    return Array.from(agents.values());
  } catch {
    return [];
  }
}

// Load universal agents config from config.toml
export async function loadUniversalAgents(): Promise<UniversalAgents> {
  const empty: UniversalAgents = { both: new Set(), local: new Set() };
  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) return empty;
    const config: any = Bun.TOML.parse(await file.text());
    const universal = config?.agents?.universal;
    if (!universal) return empty;
    return {
      both: new Set(Array.isArray(universal.both) ? universal.both : []),
      local: new Set(Array.isArray(universal.local) ? universal.local : []),
    };
  } catch {
    return empty;
  }
}

// Load repos from config.toml
export async function loadRepos(): Promise<RepoSource[]> {
  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) return [];
    const config: any = Bun.TOML.parse(await file.text());
    const repos = config?.repos;
    if (!Array.isArray(repos)) return [];
    return repos.filter((r: any) => typeof r === "string");
  } catch {
    return [];
  }
}
