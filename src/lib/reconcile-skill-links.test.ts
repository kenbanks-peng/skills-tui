import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { AgentConfig } from "#lib/config";
import { reconcileSkillLinks } from "./reconcile-skill-links";

let root: string;
let locations: { home: string; project: string };
let agents: AgentConfig[];
let globalDir: string;
let localDir: string;
let shared: string;

function link(path: string, target: string): string {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-reconcile-"));
  locations = { home: join(root, "home"), project: join(root, "project") };
  agents = [
    {
      name: "pi",
      display: "Pi",
      global: "~/.pi/agent/skills/",
      local: ".pi/skills/",
    },
  ];
  globalDir = join(locations.home, ".pi/agent/skills");
  localDir = join(locations.project, ".pi/skills");
  shared = join(locations.home, ".agents/skills");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("startup skill link reconciliation", () => {
  test("removes absolute and relative dead links in both scopes", () => {
    const global = link(join(globalDir, "gone"), join(shared, "gone"));
    const localTarget = join(locations.project, ".agents/skills/gone");
    const local = link(join(localDir, "gone"), relative(localDir, localTarget));
    expect(reconcileSkillLinks(agents, locations)).toEqual({
      removed: [global, local],
      errors: [],
    });
    expect(() => lstatSync(global)).toThrow();
    expect(() => lstatSync(local)).toThrow();
    expect(reconcileSkillLinks(agents, locations).removed).toEqual([]);
  });

  test("preserves live links, regular files, directories, and nested links", () => {
    mkdirSync(join(shared, "live"), { recursive: true });
    const live = link(join(globalDir, "live"), join(shared, "live"));
    const file = join(globalDir, "file");
    writeFileSync(file, "keep");
    const nested = link(
      join(globalDir, "directory/nested"),
      join(shared, "gone"),
    );
    expect(reconcileSkillLinks(agents, locations).removed).toEqual([]);
    expect(lstatSync(live).isSymbolicLink()).toBe(true);
    expect(lstatSync(file).isFile()).toBe(true);
    expect(lstatSync(dirname(nested)).isDirectory()).toBe(true);
    expect(lstatSync(nested).isSymbolicLink()).toBe(true);
  });

  test("preserves unrelated targets, prefix collisions, traversal, root links, and other scopes", () => {
    const targets = [
      join(locations.home, "library/gone"),
      `${shared}-backup/gone`,
      `${shared}/../elsewhere/gone`,
      shared,
      join(locations.project, ".agents/skills/gone"),
    ];
    const links = targets.map((target, i) =>
      link(join(globalDir, String(i)), target),
    );
    expect(reconcileSkillLinks(agents, locations).removed).toEqual([]);
    for (const [i, path] of links.entries())
      expect(readlinkSync(path)).toBe(targets[i]);
  });

  test("checks all configured agents and deduplicates shared locations", () => {
    const secondDir = join(locations.home, "custom/skills");
    agents.push({
      name: "custom",
      display: "Custom",
      global: secondDir,
      local: ".custom/skills",
    });
    agents.push({ ...agents[0]!, name: "duplicate" });
    const first = link(join(globalDir, "gone"), join(shared, "gone"));
    const second = link(join(secondDir, "gone"), join(shared, "gone"));
    expect(reconcileSkillLinks(agents, locations)).toEqual({
      removed: [first, second],
      errors: [],
    });
  });

  test("missing locations are harmless and are not created", () => {
    expect(reconcileSkillLinks(agents, locations)).toEqual({
      removed: [],
      errors: [],
    });
    expect(() => lstatSync(globalDir)).toThrow();
  });

  test("does not treat a symlink loop as a missing target", () => {
    link(join(shared, "loop"), join(shared, "loop"));
    const path = link(join(globalDir, "loop"), join(shared, "loop"));
    const result = reconcileSkillLinks(agents, locations);
    expect(result.removed).toEqual([]);
    expect(result.errors.map((entry) => entry.path)).toEqual([path]);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  test("continues after a location error without removing that location", () => {
    mkdirSync(dirname(globalDir), { recursive: true });
    writeFileSync(globalDir, "not a directory");
    const local = link(
      join(localDir, "gone"),
      join(locations.project, ".agents/skills/gone"),
    );
    const result = reconcileSkillLinks(agents, locations);
    expect(result.removed).toEqual([local]);
    expect(result.errors.map((entry) => entry.path)).toEqual([globalDir]);
    expect(lstatSync(globalDir).isFile()).toBe(true);
  });
});
