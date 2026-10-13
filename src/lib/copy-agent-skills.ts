import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadAgents, loadDisabledAgents, type AgentConfig } from "#lib/config";

const marker = ".skills-tui-copy.json";
export interface CopySyncResult {
  added: string[];
  removed: string[];
  errors: { path: string; error: unknown }[];
}

export function agentSkillDirectory(
  agent: AgentConfig,
  scope: "global" | "local",
  locations = { home: homedir(), project: process.cwd() },
): string {
  const path = agent[scope];
  return path.startsWith("~/")
    ? resolve(locations.home, path.slice(2))
    : resolve(scope === "global" ? locations.home : locations.project, path);
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function physicalPath(path: string): string {
  try { return realpathSync(path); } catch (error) {
    if (!missing(error) || dirname(path) === path) throw error;
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error("Unresolved Skill Location symlink");
    } catch (error) { if (!missing(error)) throw error; }
    return join(physicalPath(dirname(path)), basename(path));
  }
}

function inside(root: string, target: string): boolean {
  const distance = relative(root, target);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

function owned(path: string, source: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const metadata = JSON.parse(readFileSync(join(path, marker), "utf8"));
    return metadata.version === 1 && metadata.source === source;
  } catch (error) {
    if (missing(error) || error instanceof SyntaxError) return false;
    throw error;
  }
}

// Copy only managed Skill Instances. Unrelated files/directories are conflicts,
// not overwrite targets. Dereference content links so the deployment is portable.
export function syncCopiedSkills(
  agent: AgentConfig,
  scope: "global" | "local",
  enabled: boolean,
  locations = { home: homedir(), project: process.cwd() },
): CopySyncResult {
  const result: CopySyncResult = { added: [], removed: [], errors: [] };
  const shared = resolve(scope === "global" ? locations.home : locations.project, ".agents/skills");
  const directory = agentSkillDirectory(agent, scope, locations);
  let sourceRoot = shared;
  try {
    sourceRoot = physicalPath(shared);
    const targetRoot = physicalPath(directory);
    if (inside(sourceRoot, targetRoot)) {
      throw new Error("Copy Skill Location must not be inside the shared Skill Location");
    }
    if (inside(targetRoot, sourceRoot)) {
      throw new Error("Copy Skill Location must not contain the shared Skill Location");
    }

    // An unavailable source is not proof that portable deployments are stale.
    if (enabled && !existsSync(shared)) return result;
    const names = new Set<string>();
    const present = new Set<string>();
    if (enabled) {
      for (const name of readdirSync(shared)) {
        if (name.startsWith(".")) continue;
        present.add(name);
        const source = join(sourceRoot, name);
        try {
          if (statSync(join(source, "SKILL.md")).isFile() && statSync(source).isDirectory()) names.add(name);
        } catch (error) {
          // Existing but unavailable/invalid entries are not confirmed removals.
          result.errors.push({ path: source, error });
        }
      }
    }
    for (const name of names) {
      const source = join(sourceRoot, name);
      const destination = join(directory, name);
      let staging: string | undefined;
      let backup: string | undefined;
      try {
        let exists = false;
        let managedLink = false;
        try {
          const stat = lstatSync(destination);
          exists = true;
          managedLink = stat.isSymbolicLink() && realpathSync(destination) === realpathSync(source);
        } catch (error) {
          if (!missing(error)) throw error;
          // A dangling link is still an independent entry.
          try { lstatSync(destination); exists = true; } catch (error) { if (!missing(error)) throw error; }
        }
        if (exists && !managedLink && !owned(destination, join(shared, name))) {
          throw new Error("Skill Location already contains an independent entry; left unchanged");
        }
        mkdirSync(directory, { recursive: true });
        staging = mkdtempSync(join(directory, ".skills-tui-stage-"));
        const stagedSkill = join(staging, "skill");
        cpSync(source, stagedSkill, { recursive: true, dereference: true });
        writeFileSync(join(stagedSkill, marker), JSON.stringify({ version: 1, source: join(shared, name) }));
        if (exists) {
          backup = join(staging, "previous");
          renameSync(destination, backup);
        }
        renameSync(stagedSkill, destination);
        result.added.push(destination);
      } catch (error) {
        if (backup && existsSync(backup) && !existsSync(destination)) {
          try { renameSync(backup, destination); } catch (restoreError) {
            result.errors.push({ path: backup, error: restoreError });
            // Preserve the backup if rollback itself failed.
            staging = undefined;
          }
        }
        result.errors.push({ path: destination, error });
      } finally {
        if (staging) rmSync(staging, { recursive: true, force: true });
      }
    }
    if (existsSync(directory)) {
      for (const name of readdirSync(directory)) {
        if (name.startsWith(".") || present.has(name)) continue;
        const destination = join(directory, name);
        try {
          if (!owned(destination, join(shared, name))) continue;
          rmSync(destination, { recursive: true });
          result.removed.push(destination);
        } catch (error) {
          result.errors.push({ path: destination, error });
        }
      }
    }
  } catch (error) {
    result.errors.push({ path: directory, error });
  }
  return result;
}

export function syncCopyAgents(
  agents: AgentConfig[],
  selectedAgents: Set<string>,
  locations = { home: homedir(), project: process.cwd() },
): CopySyncResult {
  const result: CopySyncResult = { added: [], removed: [], errors: [] };
  for (const agent of agents.filter((agent) => agent.mode === "copy")) {
    for (const scope of ["global", "local"] as const) {
      const directory = agentSkillDirectory(agent, scope, locations);
      // Never remove content still used by another selected entry.
      try {
        if (!selectedAgents.has(agent.name) && agents.some((other) =>
          other.name !== agent.name && selectedAgents.has(other.name) &&
          physicalPath(agentSkillDirectory(other, scope, locations)) === physicalPath(directory)
        )) continue;
      } catch (error) {
        result.errors.push({ path: directory, error });
        continue;
      }
      const synced = syncCopiedSkills(agent, scope, selectedAgents.has(agent.name), locations);
      result.added.push(...synced.added);
      result.removed.push(...synced.removed);
      result.errors.push(...synced.errors);
    }
  }
  return result;
}

// Stable callback for streaming CLI services (updates and interactive find).
export async function refreshConfiguredCopies(): Promise<string> {
  const [agents, disabled] = await Promise.all([loadAgents(), loadDisabledAgents()]);
  const selected = new Set(agents.filter((agent) => !disabled.has(agent.name)).map((agent) => agent.name));
  const result = syncCopyAgents(agents, selected);
  return result.errors.map(({ path, error }) => `\nCould not sync copied skills at ${path}: ${String(error)}\n`).join("");
}
