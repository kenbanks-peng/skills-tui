import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeSkillSyncErrors } from "./configured-skills";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("synchronization warnings summarize repeated conflicts without stack traces", () => {
	const errors = Array.from({ length: 23 }, (_, index) => ({
		path: `/agent/skills/conflict-${index}`,
		error: new Error("Unrelated entry; left unchanged"),
	}));
	const message = summarizeSkillSyncErrors(errors);
	expect(message).toBe(
		"Could not sync /agent/skills/conflict-0: Unrelated entry; left unchanged (+22 more)",
	);
	expect(message).not.toContain("at ");
	expect(summarizeSkillSyncErrors([])).toBeNull();
});

test("configured synchronization adopts, restores, and deselects local skills with agent links and portable copies", () => {
	const root = mkdtempSync(join(tmpdir(), "configured-skills-"));
	roots.push(root);
	const home = join(root, "home");
	const project = join(root, "project");
	const repo = join(root, "repository");
	const source = pathToFileURL(repo).href;
	const shared = join(home, ".agents", "skills");
	const config = join(home, ".config", "skills-tui", "config.toml");
	for (const path of [
		project,
		join(repo, "chosen"),
		join(shared, "chosen"),
		join(home, ".config", "skills-tui"),
	])
		mkdirSync(path, { recursive: true });
	writeFileSync(join(repo, "chosen", "SKILL.md"), "# Upstream");
	writeFileSync(join(shared, "chosen", "SKILL.md"), "# Old deployment");
	writeFileSync(
		config,
		`repos = [${JSON.stringify(source)}]
[agents]
enabled = []
[[custom-agents]]
name = "fixture-link"
global = "~/.fixture-link/skills"
local = ".fixture-link/skills"
[[custom-agents]]
name = "fixture-copy"
global = "~/.fixture-copy/skills"
local = ".fixture-copy/skills"
mode = "copy"
`,
	);
	const moduleUrl = pathToFileURL(
		resolve(import.meta.dir, "configured-skills.ts"),
	).href;
	function run(expression: string) {
		const child = spawnSync(
			process.execPath,
			[
				"--eval",
				`import { synchronizeConfiguredSkills, setConfiguredSkillSelection } from ${JSON.stringify(moduleUrl)};
       const result = await (${expression});
       if (result.errors.length) throw new Error(result.errors.map((e) => String(e.error)).join("; "));
      `,
			],
			{
				cwd: project,
				env: {
					...process.env,
					HOME: home,
					XDG_CONFIG_HOME: join(home, ".config"),
					XDG_STATE_HOME: join(home, ".local", "state"),
				},
				encoding: "utf8",
				timeout: 20_000,
			},
		);
		expect(child.stderr).toBe("");
		expect(child.status).toBe(0);
	}
	run("synchronizeConfiguredSkills({ refresh: true })");
	expect(readFileSync(join(shared, "chosen", "SKILL.md"), "utf8")).toBe(
		"# Upstream",
	);
	expect(readFileSync(config, "utf8")).toContain("chosen");
	expect(
		lstatSync(join(home, ".fixture-link", "skills", "chosen")).isSymbolicLink(),
	).toBe(true);
	expect(
		readFileSync(
			join(home, ".fixture-copy", "skills", "chosen", "SKILL.md"),
			"utf8",
		),
	).toBe("# Upstream");

	rmSync(shared, { recursive: true });
	run("synchronizeConfiguredSkills()");
	expect(existsSync(join(shared, "chosen", "SKILL.md"))).toBe(true);
	expect(
		existsSync(join(home, ".fixture-link", "skills", "chosen", "SKILL.md")),
	).toBe(true);

	run(
		`setConfiguredSkillSelection(${JSON.stringify(source)}, "chosen", true, false)`,
	);
	expect(existsSync(join(shared, "chosen"))).toBe(false);
	expect(existsSync(join(home, ".fixture-link", "skills", "chosen"))).toBe(
		false,
	);
	expect(existsSync(join(home, ".fixture-copy", "skills", "chosen"))).toBe(
		false,
	);
	run("synchronizeConfiguredSkills()");
	expect(existsSync(join(shared, "chosen"))).toBe(false);
});

test("remote inventory failures preserve deployments; explicit installs repair without CLI update tracking", () => {
	const root = mkdtempSync(join(tmpdir(), "remote-skills-"));
	roots.push(root);
	const home = join(root, "home");
	const project = join(root, "project");
	const bin = join(root, "bin");
	const shared = join(home, ".agents", "skills");
	const config = join(home, ".config", "skills-tui", "config.toml");
	const inventory = join(root, "inventory");
	const calls = join(root, "calls");
	for (const path of [
		project,
		bin,
		join(shared, "chosen"),
		join(shared, "aven"),
		join(home, ".config", "skills-tui"),
	])
		mkdirSync(path, { recursive: true });
	writeFileSync(join(shared, "chosen", "SKILL.md"), "old");
	writeFileSync(join(shared, "aven", "SKILL.md"), "obsolete");
	writeFileSync(config, 'repos = ["fixture/repo"]\n[agents]\nenabled = []\n');
	writeFileSync(
		join(bin, "bunx"),
		`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case " $* " in
  *" --list "*) cat "$INVENTORY"; exit 0 ;;
esac
name=""
scope="$PWD"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -g) scope="$HOME" ;;
    --skill) shift; name="$1" ;;
  esac
  shift
done
[ -n "$name" ] || exit 1
mkdir -p "$scope/.agents/skills/$name"
printf 'new content' > "$scope/.agents/skills/$name/SKILL.md"
`,
	);
	chmodSync(join(bin, "bunx"), 0o755);
	const moduleUrl = pathToFileURL(
		resolve(import.meta.dir, "configured-skills.ts"),
	).href;
	function synchronize() {
		const child = spawnSync(
			process.execPath,
			[
				"--eval",
				`
      import { synchronizeConfiguredSkills } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify(await synchronizeConfiguredSkills()));
    `,
			],
			{
				cwd: project,
				env: {
					...process.env,
					HOME: home,
					PATH: bin + ":" + process.env.PATH,
					INVENTORY: inventory,
					CALLS: calls,
					XDG_CONFIG_HOME: join(home, ".config"),
					XDG_STATE_HOME: join(home, ".state"),
				},
				encoding: "utf8",
				timeout: 20_000,
			},
		);
		expect(child.status).toBe(0);
		return JSON.parse(child.stdout) as { errors: unknown[] };
	}
	// A partial list must not be treated as a confirmed deletion.
	writeFileSync(
		inventory,
		"◇  Found 2 skills\n◇  Available Skills\n│    chosen\n└  Done\n",
	);
	expect(synchronize().errors).toHaveLength(1);
	expect(existsSync(join(shared, "aven"))).toBe(true);
	expect(readFileSync(config, "utf8")).not.toContain("[skills");

	// Plugin headings and one-word descriptions must not count as Skill names.
	writeFileSync(
		inventory,
		"◇  Found 1 skill\n◇  Available Skills\nEngineering\n│    chosen\n│      Description\n└  Done\n",
	);
	expect(synchronize().errors).toEqual([]);
	expect(existsSync(join(shared, "aven"))).toBe(false);
	expect(readFileSync(calls, "utf8")).not.toContain("--skill");
	rmSync(shared, { recursive: true });
	expect(synchronize().errors).toEqual([]);
	expect(readFileSync(join(shared, "chosen", "SKILL.md"), "utf8")).toBe(
		"new content",
	);
	expect(readFileSync(calls, "utf8")).toContain("--skill chosen");
	expect(readFileSync(calls, "utf8")).not.toContain("skills update");
});
