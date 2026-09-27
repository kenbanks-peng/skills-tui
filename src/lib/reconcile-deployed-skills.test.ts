import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { reconcileDeployedSkills } from "./reconcile-deployed-skills";

let root: string;
let locations: { home: string; stateHome: string };
let skillsDirectory: string;
let lockPath: string;

function writeLock(
  skills: Record<string, { source?: string; sourceUrl?: string }>,
): void {
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ version: 1, skills }));
}

function deploy(name: string): string {
  const path = join(skillsDirectory, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `# ${name}`);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deployed-skills-reconcile-"));
  locations = {
    home: join(root, "home"),
    stateHome: join(root, "state"),
  };
  skillsDirectory = join(locations.home, ".agents", "skills");
  lockPath = join(locations.stateHome, "skills", ".skill-lock.json");
  mkdirSync(skillsDirectory, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("startup deployed skill reconciliation", () => {
  test("removes every folder not enabled by a configured repository", () => {
    const removedSource = deploy("removed-source");
    const untracked = deploy("untracked");
    const malformed = deploy("malformed");
    const kept = deploy("kept");
    writeLock({
      "removed-source": { source: "old-owner/old-repo" },
      malformed: { source: 42 } as unknown as { source: string },
      kept: { source: "current-owner/current-repo" },
    });

    const result = reconcileDeployedSkills(
      ["current-owner/current-repo"],
      locations,
    );
    expect(result.errors).toEqual([]);
    expect(new Set(result.removed)).toEqual(
      new Set([malformed, removedSource, untracked]),
    );
    expect(lstatSync(kept).isDirectory()).toBe(true);
    for (const path of [removedSource, untracked, malformed]) {
      expect(() => lstatSync(path)).toThrow();
    }
  });

  test("matches GitHub shorthand and URL lock sources", () => {
    const first = deploy("first");
    const second = deploy("second");
    writeLock({
      first: {
        source: "owner/repo",
        sourceUrl: "https://github.com/owner/repo.git",
      },
      second: { sourceUrl: "https://github.com/owner/repo.git" },
    });

    expect(
      reconcileDeployedSkills(["https://github.com/owner/repo"], locations),
    ).toEqual({ removed: [], errors: [] });
    expect(lstatSync(first).isDirectory()).toBe(true);
    expect(lstatSync(second).isDirectory()).toBe(true);
  });

  test("keeps skills supplied by configured file repositories", () => {
    const repo = join(root, "local-skills");
    mkdirSync(join(repo, "local-skill"), { recursive: true });
    const kept = deploy("local-skill");
    const removed = deploy("other-skill");

    expect(
      reconcileDeployedSkills([pathToFileURL(repo).href], locations),
    ).toEqual({ removed: [removed], errors: [] });
    expect(lstatSync(kept).isDirectory()).toBe(true);
  });

  test("preserves files and symlinks because they are not skill folders", () => {
    const file = join(skillsDirectory, "file");
    const external = join(root, "external");
    const linked = join(skillsDirectory, "linked");
    writeFileSync(file, "keep");
    mkdirSync(external);
    symlinkSync(external, linked);

    expect(reconcileDeployedSkills([], locations).removed).toEqual([]);
    expect(lstatSync(file).isFile()).toBe(true);
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
  });

  test("does not use lock skill names as paths", () => {
    const outside = join(locations.home, ".agents", "outside");
    mkdirSync(outside, { recursive: true });
    writeLock({ "../outside": { source: "configured/repo" } });

    expect(
      reconcileDeployedSkills(["configured/repo"], locations).removed,
    ).toEqual([]);
    expect(lstatSync(outside).isDirectory()).toBe(true);
  });

  test("leaves the lock unchanged", () => {
    deploy("removed");
    writeLock({ removed: { source: "removed/repo" } });
    const before = readFileSync(lockPath, "utf8");

    reconcileDeployedSkills([], locations);

    expect(readFileSync(lockPath, "utf8")).toBe(before);
  });

  test("treats a missing or malformed lock as no enabled skills", () => {
    const withoutLock = deploy("without-lock");
    expect(reconcileDeployedSkills([], locations)).toEqual({
      removed: [withoutLock],
      errors: [],
    });

    const malformed = deploy("malformed-lock");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, "not json");
    const result = reconcileDeployedSkills([], locations);
    expect(result.removed).toEqual([malformed]);
    expect(result.errors.map((entry) => entry.path)).toEqual([lockPath]);
  });

  test("reports a deployed skill location that cannot be read", () => {
    writeLock({ removed: { source: "removed/repo" } });
    rmSync(skillsDirectory, { recursive: true });
    writeFileSync(skillsDirectory, "not a directory");

    const result = reconcileDeployedSkills([], locations);

    expect(result.removed).toEqual([]);
    expect(result.errors.map((entry) => entry.path)).toEqual([skillsDirectory]);
  });
});
