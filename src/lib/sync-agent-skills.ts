import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentConfig, UniversalAgents } from "#lib/config";

export interface AgentSkillSyncResult {
  added: string[];
  removed: string[];
  errors: { path: string; error: unknown }[];
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

// Resolve directory aliases (including dotfiles links), but allow absent paths.
function physicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!isMissing(error) || dirname(path) === path) throw error;
    let unresolvedLink = false;
    try {
      unresolvedLink = lstatSync(path).isSymbolicLink();
    } catch (statError) {
      if (!isMissing(statError)) throw statError;
    }
    if (unresolvedLink) throw error;
    return join(physicalPath(dirname(path)), basename(path));
  }
}

function linkTarget(directory: string, link: string): string {
  const target = resolve(directory, link);
  return join(physicalPath(dirname(target)), basename(target));
}

function agentDirectory(
  agent: AgentConfig,
  scope: "global" | "local",
  locations: { home: string; project: string },
): string {
  const path = agent[scope];
  return path.startsWith("~/")
    ? resolve(locations.home, path.slice(2))
    : resolve(scope === "global" ? locations.home : locations.project, path);
}

// Selection is persisted across scopes, so toggle synchronization covers User
// Scope and the current Project Scope. Only agent links change, never shared
// Skill Instances, locks, independent copies, or unrelated links.
export function syncAgentSkills(
  agent: AgentConfig,
  agents: AgentConfig[],
  selectedAgents: Set<string>,
  locations = { home: homedir(), project: process.cwd() },
  universalAgents: UniversalAgents = { both: new Set(), local: new Set() },
): AgentSkillSyncResult {
  const result: AgentSkillSyncResult = { added: [], removed: [], errors: [] };
  const enabled = selectedAgents.has(agent.name);

  for (const scope of ["global", "local"] as const) {
    // Shared-location discovery needs no agent links, even when the registry
    // also lists an agent-specific Skill Location. Skip before filesystem access.
    if (
      universalAgents.both.has(agent.name) ||
      (scope === "local" && universalAgents.local.has(agent.name))
    ) continue;
    const base = scope === "global" ? locations.home : locations.project;
    const shared = resolve(base, ".agents/skills");
    const directory = agentDirectory(agent, scope, locations);
    try {
      const physicalShared = physicalPath(shared);
      const physicalDirectory = physicalPath(directory);

      // Shared locations cannot be disabled without deleting other agents'
      // skills. Nor can a location still used by another selected agent.
      if (physicalDirectory === physicalShared) continue;
      if (!enabled && agents.some((other) =>
        other.name !== agent.name &&
        selectedAgents.has(other.name) &&
        physicalPath(agentDirectory(other, scope, locations)) === physicalDirectory
      )) continue;

      if (enabled) {
        let entries: string[];
        try {
          entries = readdirSync(shared);
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        for (const name of entries) {
          const target = join(shared, name);
          const linkPath = join(directory, name);
          try {
            if (!statSync(target).isDirectory()) continue;
            if (!statSync(join(target, "SKILL.md")).isFile()) continue;
            try {
              const existing = lstatSync(linkPath);
              if (
                existing.isSymbolicLink() &&
                linkTarget(physicalDirectory, readlinkSync(linkPath)) === join(physicalShared, name)
              ) continue;
              throw new Error("Skill Location already contains an independent entry; left unchanged");
            } catch (error) {
              if (!isMissing(error)) throw error;
            }
            mkdirSync(directory, { recursive: true });
            symlinkSync(resolve(target), linkPath);
            result.added.push(linkPath);
          } catch (error) {
            if (!isMissing(error)) result.errors.push({ path: linkPath, error });
          }
        }
      } else {
        let entries: string[];
        try {
          entries = readdirSync(directory);
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        for (const name of entries) {
          const path = join(directory, name);
          try {
            const before = lstatSync(path);
            if (!before.isSymbolicLink()) continue;
            const link = readlinkSync(path);
            if (linkTarget(physicalDirectory, link) !== join(physicalShared, name)) continue;
            const current = lstatSync(path);
            if (
              !current.isSymbolicLink() ||
              current.dev !== before.dev ||
              current.ino !== before.ino ||
              current.ctimeMs !== before.ctimeMs ||
              readlinkSync(path) !== link ||
              realpathSync(directory) !== physicalDirectory ||
              physicalPath(shared) !== physicalShared ||
              linkTarget(physicalDirectory, link) !== join(physicalShared, name)
            ) continue;
            unlinkSync(path);
            result.removed.push(path);
          } catch (error) {
            if (!isMissing(error)) result.errors.push({ path, error });
          }
        }
      }
    } catch (error) {
      result.errors.push({ path: directory, error });
    }
  }
  return result;
}
