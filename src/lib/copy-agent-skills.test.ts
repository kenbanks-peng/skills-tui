import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgent } from "./agent-registry";
import { syncCopiedSkills, syncCopyAgents } from "./copy-agent-skills";
import { syncAgentSkills } from "./sync-agent-skills";
import { ensureOpencode } from "./utils";

let root: string;
let locations: { home: string; project: string };
let agent: ReturnType<typeof resolveAgent>;
let shared: string;
let destination: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-copy-"));
  locations = { home: join(root, "home"), project: join(root, "project") };
  mkdirSync(locations.project, { recursive: true });
  shared = join(locations.home, ".agents/skills");
  mkdirSync(join(shared, "example"), { recursive: true });
  writeFileSync(join(shared, "example/SKILL.md"), "version one");
  agent = resolveAgent({ name: "pi-linux", local: ".pi-linux/skills/", global: "~/.config/linux/pi/agent/skills/", mode: "copy" });
  destination = join(locations.home, ".config/linux/pi/agent/skills/example");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("config preserves copy mode; custom names are excluded from CLI arguments", () => {
  expect(agent.mode).toBe("copy");
  expect(resolveAgent("pi").mode).toBeUndefined();
  expect(ensureOpencode(["pi", "pi-linux"])).toEqual(["pi", "opencode"]);
});

test("standalone copies dereference nested links and survive loss of shared skills", () => {
  writeFileSync(join(root, "asset"), "portable content");
  symlinkSync(join(root, "asset"), join(shared, "example/asset"));
  const result = syncCopiedSkills(agent, "global", true, locations);
  expect(result.errors).toEqual([]);
  expect(lstatSync(destination).isSymbolicLink()).toBe(false);
  expect(lstatSync(join(destination, "asset")).isSymbolicLink()).toBe(false);
  rmSync(shared, { recursive: true });
  rmSync(join(root, "asset"));
  expect(readFileSync(join(destination, "asset"), "utf8")).toBe("portable content");
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("version one");
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toEqual([]);
  expect(existsSync(destination)).toBe(true);
});

test("refreshes managed copies and removes stale skills only", () => {
  syncCopiedSkills(agent, "global", true, locations);
  writeFileSync(join(shared, "example/SKILL.md"), "version two");
  writeFileSync(join(destination, "obsolete"), "old");
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toEqual([]);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("version two");
  expect(existsSync(join(destination, "obsolete"))).toBe(false);
  const independent = join(destination, "../independent");
  mkdirSync(independent);
  writeFileSync(join(independent, "SKILL.md"), "mine");
  rmSync(join(shared, "example"), { recursive: true });
  expect(syncCopiedSkills(agent, "global", true, locations).removed).toEqual([destination]);
  expect(existsSync(independent)).toBe(true);
});

test("checkbox enable/disable handles both scopes without removing shared content", () => {
  mkdirSync(join(locations.project, ".agents/skills/local"), { recursive: true });
  writeFileSync(join(locations.project, ".agents/skills/local/SKILL.md"), "local");
  expect(syncAgentSkills(agent, [agent], new Set([agent.name]), locations).errors).toEqual([]);
  expect(existsSync(destination)).toBe(true);
  expect(syncCopyAgents([agent], new Set(), locations).removed).toHaveLength(2);
  expect(existsSync(destination)).toBe(false);
  expect(existsSync(join(shared, "example/SKILL.md"))).toBe(true);
});

test("independent directories and dangling links are not overwritten", () => {
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "SKILL.md"), "mine");
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toHaveLength(1);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("mine");
  rmSync(destination, { recursive: true });
  symlinkSync(join(root, "missing"), destination);
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toHaveLength(1);
  expect(lstatSync(destination).isSymbolicLink()).toBe(true);
});

test("migrates a shared skill link to a copy", () => {
  mkdirSync(join(destination, ".."), { recursive: true });
  symlinkSync(join(shared, "example"), destination);
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toEqual([]);
  expect(lstatSync(destination).isDirectory()).toBe(true);
});

test("failed staging preserves the previous deployment and cleans temporary content", () => {
  syncCopiedSkills(agent, "global", true, locations);
  symlinkSync(join(root, "missing"), join(shared, "example/broken"));
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toHaveLength(1);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("version one");
  expect(readdirSync(join(destination, "..")).filter((name) => name.startsWith(".skills-tui-stage"))).toEqual([]);
});

test("rejects overlapping shared and copy locations", () => {
  for (const global of ["~/.agents/skills/", "~/.agents/skills/nested/", "~/.agents/"]) {
    expect(syncCopiedSkills({ ...agent, global }, "global", true, locations).errors).toHaveLength(1);
  }
  expect(existsSync(join(shared, "example/SKILL.md"))).toBe(true);
});

test("does not disable a directory still selected through another entry", () => {
  syncCopiedSkills(agent, "global", true, locations);
  const other = { ...agent, name: "other" };
  expect(syncCopyAgents([agent, other], new Set(["other"]), locations).errors).toEqual([]);
  expect(existsSync(destination)).toBe(true);
});
