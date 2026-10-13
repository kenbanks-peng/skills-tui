import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncCopiedSkills } from "./copy-agent-skills";
import type { AgentConfig } from "./config";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const home = mkdtempSync(join(tmpdir(), "copy-source-"));
  roots.push(home);
  const shared = join(home, ".agents/skills");
  mkdirSync(join(shared, "example"), { recursive: true });
  writeFileSync(join(shared, "example/SKILL.md"), "one");
  const agent: AgentConfig = { name: "custom", display: "Custom", local: ".custom/skills", global: "~/.custom/skills", mode: "copy" };
  const locations = { home, project: join(home, "project") };
  const destination = join(home, ".custom/skills/example");
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toEqual([]);
  return { home, shared, agent, locations, destination };
}

test("preserves deployed copies when an individual source becomes unavailable", () => {
  const { home, shared, agent, locations, destination } = setup();
  rmSync(join(shared, "example"), { recursive: true });
  symlinkSync(join(home, "offline"), join(shared, "example"));
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toHaveLength(1);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("one");
});

test("preserves copies when source SKILL.md is temporarily absent", () => {
  const { shared, agent, locations, destination } = setup();
  unlinkSync(join(shared, "example/SKILL.md"));
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toHaveLength(1);
  expect(existsSync(destination)).toBe(true);
});

test("stable ownership survives repointing the shared source symlink", () => {
  const { home, shared, agent, locations, destination } = setup();
  const previous = join(home, "previous");
  renameSync(shared, previous);
  const next = join(home, "next");
  mkdirSync(join(next, "example"), { recursive: true });
  writeFileSync(join(next, "example/SKILL.md"), "two");
  symlinkSync(next, shared);
  expect(syncCopiedSkills(agent, "global", true, locations).errors).toEqual([]);
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("two");
  expect(syncCopiedSkills(agent, "global", false, locations).removed).toEqual([destination]);
});
