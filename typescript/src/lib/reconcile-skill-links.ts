import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { AgentConfig } from "#lib/config";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

// Canonicalize existing ancestors even when the skill itself is gone.
// This also makes aliases such as /var and /private/var comparable.
function physicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!isMissing(error) || dirname(path) === path) throw error;
    // Do not guess through an unresolved symlink.
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

function targetIsMissing(path: string): boolean {
  try {
    statSync(path);
    return false;
  } catch (error) {
    // Permission errors, loops, and other failures do not prove absence.
    if (!isMissing(error)) throw error;
    return true;
  }
}

// Startup only. Both scopes are checked, independent of agent selection.
// Inspect immediate entries only; never recurse into skill content.
export function reconcileSkillLinks(
  agents: AgentConfig[],
  locations = { home: homedir(), project: process.cwd() },
): { removed: string[]; errors: { path: string; error: unknown }[] } {
  const result: ReturnType<typeof reconcileSkillLinks> = {
    removed: [],
    errors: [],
  };
  for (const scope of ["global", "local"] as const) {
    const base = scope === "global" ? locations.home : locations.project;
    const shared = resolve(base, ".agents/skills");
    const directories = new Set(
      agents.map((agent) => {
        const path = agent[scope];
        return path.startsWith("~/")
          ? resolve(locations.home, path.slice(2))
          : resolve(base, path);
      }),
    );
    for (const directory of directories) {
      let entries: string[];
      let physicalDirectory: string;
      let physicalShared: string;
      try {
        entries = readdirSync(directory);
        physicalDirectory = realpathSync(directory);
        physicalShared = physicalPath(shared);
      } catch (error) {
        if (!isMissing(error)) result.errors.push({ path: directory, error });
        continue;
      }
      for (const entry of entries) {
        const path = join(directory, entry);
        try {
          const before = lstatSync(path);
          if (!before.isSymbolicLink()) continue;
          const link = readlinkSync(path);
          const target = physicalPath(resolve(physicalDirectory, link));
          if (!isInside(physicalShared, target) || !targetIsMissing(path))
            continue;

          // Recheck the link and its target before unlinking. Never use recursive removal.
          const current = lstatSync(path);
          if (
            !current.isSymbolicLink() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            current.ctimeMs !== before.ctimeMs ||
            readlinkSync(path) !== link ||
            realpathSync(directory) !== physicalDirectory ||
            physicalPath(shared) !== physicalShared ||
            physicalPath(resolve(physicalDirectory, link)) !== target ||
            !targetIsMissing(path)
          )
            continue;
          unlinkSync(path);
          result.removed.push(path);
        } catch (error) {
          if (!isMissing(error)) result.errors.push({ path, error });
        }
      }
    }
  }
  return result;
}
