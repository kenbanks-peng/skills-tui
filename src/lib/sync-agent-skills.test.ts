import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { AgentConfig, UniversalAgents } from "./config";
import { resolveAgent } from "./agent-registry";
import { syncAgentSkills } from "./sync-agent-skills";

describe("agent toggle synchronization", () => {
  let root: string;
  let locations: { home: string; project: string };
  let claude: AgentConfig;
  let pi: AgentConfig;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "skills-agent-sync-"));
    locations = { home: join(root, "home"), project: join(root, "project") };
    mkdirSync(locations.home);
    mkdirSync(locations.project);
    claude = {
      name: "claude-code", display: "Claude Code",
      global: "~/.claude/skills/", local: ".claude/skills/",
    };
    pi = {
      name: "pi", display: "Pi",
      global: "~/.pi/agent/skills/", local: ".pi/skills/",
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function install(base: string, name = "example") {
    const path = join(base, ".agents/skills", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "SKILL.md"), "# Example");
    return path;
  }
  function run(
    selected: string[],
    agent = claude,
    agents = [claude, pi],
    universal: UniversalAgents = { both: new Set(), local: new Set() },
  ) {
    return syncAgentSkills(agent, agents, new Set(selected), locations, universal);
  }

  test("OpenCode skips both scopes even with an independent agent path", () => {
    const opencode = resolveAgent("opencode");
    install(locations.home);
    install(locations.project);
    const directory = join(locations.home, ".config/opencode/skills");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "example"), "independent content");
    const universal = { both: new Set(["opencode"]), local: new Set<string>() };
    expect(run(["opencode"], opencode, [opencode], universal)).toEqual({
      added: [], removed: [], errors: [],
    });
    rmSync(join(directory, "example"));
    symlinkSync(join(locations.home, ".agents/skills/example"), join(directory, "example"));
    expect(run([], opencode, [opencode], universal)).toEqual({
      added: [], removed: [], errors: [],
    });
    expect(lstatSync(join(directory, "example")).isSymbolicLink()).toBe(true);
  });

  test("agents with shared Project Scope skip only that scope", () => {
    install(locations.home);
    install(locations.project);
    const universal = { both: new Set<string>(), local: new Set(["claude-code"]) };
    const result = run(["claude-code"], claude, [claude], universal);
    expect(result.errors).toEqual([]);
    expect(result.added).toEqual([join(locations.home, ".claude/skills/example")]);
    expect(existsSync(join(locations.project, ".claude"))).toBe(false);
    expect(run([], claude, [claude], universal).removed).toHaveLength(1);
  });

  test("enable backfills both scopes; repeated sync is idempotent", () => {
    const global = install(locations.home);
    const local = install(locations.project);
    const result = run(["claude-code", "pi"]);
    expect(result.errors).toEqual([]);
    expect(result.added).toHaveLength(2);
    expect(readlinkSync(join(locations.home, ".claude/skills/example"))).toBe(global);
    expect(readlinkSync(join(locations.project, ".claude/skills/example"))).toBe(local);
    expect(run(["claude-code", "pi"]).added).toEqual([]);
  });

  test("disable removes only this agent's links, preserving shared skills and Pi", () => {
    install(locations.home);
    install(locations.project);
    run(["pi"], pi);
    run(["claude-code", "pi"]);
    const result = run(["pi"]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toHaveLength(2);
    expect(existsSync(join(locations.home, ".pi/agent/skills/example/SKILL.md"))).toBe(true);
    expect(existsSync(join(locations.project, ".agents/skills/example/SKILL.md"))).toBe(true);
    expect(existsSync(join(locations.home, ".claude/skills/example"))).toBe(false);
    expect(run(["pi"]).removed).toEqual([]);
  });

  test("independent copies and unrelated links are preserved and conflicts reported", () => {
    install(locations.home);
    const directory = join(locations.home, ".claude/skills");
    mkdirSync(join(directory, "example"), { recursive: true });
    writeFileSync(join(directory, "example/keep"), "keep");
    symlinkSync(locations.project, join(directory, "unrelated"));
    expect(run(["claude-code"]).errors).toHaveLength(1);
    expect(run([]).removed).toEqual([]);
    expect(existsSync(join(directory, "example/keep"))).toBe(true);
    expect(lstatSync(join(directory, "unrelated")).isSymbolicLink()).toBe(true);
  });

  test("missing scopes and non-skill folders do not cause errors", () => {
    expect(run(["claude-code"]).errors).toEqual([]);
    mkdirSync(join(locations.home, ".agents/skills/not-a-skill"), { recursive: true });
    expect(run(["claude-code"]).added).toEqual([]);
    expect(run([]).errors).toEqual([]);
  });

  test("shared-path agents never remove the shared Skill Instances", () => {
    const skill = install(locations.home);
    const shared = { ...claude, global: "~/.agents/skills/", local: ".agents/skills/" };
    expect(run(["claude-code"], shared).added).toEqual([]);
    expect(run([], shared).removed).toEqual([]);
    expect(existsSync(skill)).toBe(true);
  });

  test("preserves locations also used by another enabled agent", () => {
    install(locations.home);
    run(["claude-code"]);
    const other = { ...claude, name: "other" };
    expect(run(["other"], claude, [claude, other]).removed).toEqual([]);
    expect(existsSync(join(locations.home, ".claude/skills/example"))).toBe(true);
  });

  test("handles relative links and agent directories aliased into dotfiles", () => {
    const skill = install(locations.home);
    const directory = join(root, "dotfiles/claude-skills");
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(locations.home, ".claude"), { recursive: true });
    symlinkSync(directory, join(locations.home, ".claude/skills"));
    symlinkSync(relative(directory, skill), join(directory, "example"));
    expect(run(["claude-code"]).errors).toEqual([]);
    expect(run(["claude-code"]).added).toEqual([]);
    expect(run([]).removed).toHaveLength(1);
    expect(existsSync(skill)).toBe(true);
  });

  test("disable cleans managed dead links without deleting unrelated dead links", () => {
    const directory = join(locations.home, ".claude/skills");
    mkdirSync(directory, { recursive: true });
    symlinkSync(resolve(locations.home, ".agents/skills/gone"), join(directory, "gone"));
    symlinkSync(join(root, "elsewhere"), join(directory, "unrelated"));
    expect(run([]).removed).toEqual([join(directory, "gone")]);
    expect(lstatSync(join(directory, "unrelated")).isSymbolicLink()).toBe(true);
  });

  test("shared directory aliases remain idempotent and removable", () => {
    const shared = join(root, "shared-skills");
    mkdirSync(join(shared, "example"), { recursive: true });
    writeFileSync(join(shared, "example/SKILL.md"), "# Example");
    mkdirSync(join(locations.home, ".agents"));
    symlinkSync(shared, join(locations.home, ".agents/skills"));
    expect(run(["claude-code"]).added).toHaveLength(1);
    expect(run(["claude-code"]).errors).toEqual([]);
    expect(run(["claude-code"]).added).toEqual([]);
    expect(run([]).removed).toHaveLength(1);
    expect(existsSync(join(shared, "example/SKILL.md"))).toBe(true);
  });

  test("supports custom absolute Skill Locations", () => {
    install(locations.home);
    const custom = { ...claude, global: join(root, "custom-skills") };
    expect(run(["claude-code"], custom).errors).toEqual([]);
    expect(existsSync(join(custom.global, "example/SKILL.md"))).toBe(true);
    expect(run([], custom).removed).toHaveLength(1);
  });

  test("reports a failed scope and continues syncing the other scope", () => {
    install(locations.home);
    install(locations.project);
    writeFileSync(join(locations.home, ".claude"), "not a directory");
    const result = run(["claude-code"]);
    expect(result.errors).toHaveLength(1);
    expect(result.added).toEqual([join(locations.project, ".claude/skills/example")]);
  });

  test("enable after disable restores visibility without touching content", () => {
    const skill = install(locations.home);
    run(["claude-code"]);
    run([]);
    expect(run(["claude-code"]).added).toHaveLength(1);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  });
});
