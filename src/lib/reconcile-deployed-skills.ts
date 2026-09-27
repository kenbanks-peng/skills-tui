import { lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoSource } from "#lib/config";

interface LockEntry {
  source?: string;
  sourceUrl?: string;
}

interface SkillLock {
  skills?: Record<string, LockEntry>;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function normalizeRepoSource(repo: string): string {
  return repo
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
}

function lockSources(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const { source, sourceUrl } = entry as LockEntry;
  return [source, sourceUrl].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function isImmediateEntry(name: string): boolean {
  return (
    name !== "." &&
    name !== ".." &&
    basename(name) === name &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function addConfiguredFileRepoSkills(
  repos: RepoSource[],
  enabled: Set<string>,
  errors: { path: string; error: unknown }[],
): void {
  for (const repo of repos) {
    if (!repo.startsWith("file://")) continue;
    let directory = repo;
    try {
      directory = fileURLToPath(repo);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          enabled.add(entry.name);
        }
      }
    } catch (error) {
      errors.push({ path: directory, error });
    }
  }
}

// Startup only. Keep only user-scoped skill directories enabled by the current
// repository configuration. Files and symlinks are not deployed skill folders.
export function reconcileDeployedSkills(
  repos: RepoSource[],
  locations = {
    home: homedir(),
    stateHome: process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
  },
): { removed: string[]; errors: { path: string; error: unknown }[] } {
  const result: ReturnType<typeof reconcileDeployedSkills> = {
    removed: [],
    errors: [],
  };
  const skillsDirectory = join(locations.home, ".agents", "skills");
  const lockPath = join(locations.stateHome, "skills", ".skill-lock.json");
  const configured = new Set(repos.map(normalizeRepoSource));
  const enabled = new Set<string>();

  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as SkillLock;
    for (const [name, entry] of Object.entries(lock.skills ?? {})) {
      if (
        isImmediateEntry(name) &&
        lockSources(entry).some((source) =>
          configured.has(normalizeRepoSource(source)),
        )
      ) {
        enabled.add(name);
      }
    }
  } catch (error) {
    if (!isMissing(error)) result.errors.push({ path: lockPath, error });
  }

  addConfiguredFileRepoSkills(repos, enabled, result.errors);

  let deployed: string[];
  try {
    deployed = readdirSync(skillsDirectory);
  } catch (error) {
    if (!isMissing(error)) result.errors.push({ path: skillsDirectory, error });
    return result;
  }

  for (const name of deployed) {
    if (!isImmediateEntry(name) || enabled.has(name)) continue;
    const path = join(skillsDirectory, name);
    try {
      const before = lstatSync(path);
      if (!before.isDirectory() || before.isSymbolicLink()) continue;

      const current = lstatSync(path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        current.ctimeMs !== before.ctimeMs
      )
        continue;

      rmSync(path, { recursive: true });
      result.removed.push(path);
    } catch (error) {
      if (!isMissing(error)) result.errors.push({ path, error });
    }
  }

  return result;
}
