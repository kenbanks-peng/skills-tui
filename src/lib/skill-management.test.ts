import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	symlinkSync,
	lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillManager, SkillSelectionStore } from "./skill-management";

let root: string;
let config: string;
let shared: string;
let state: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "skills-tui-selection-"));
	config = join(root, "config.toml");
	state = join(root, "state", "skill-selections.toml");
	shared = join(root, "home", ".agents", "skills");
	writeFileSync(config, 'repos = ["owner/repo"]\n');
	mkdirSync(shared, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deploy(name: string) {
	mkdirSync(join(shared, name), { recursive: true });
	writeFileSync(join(shared, name, "SKILL.md"), "# " + name);
}

test("adopts existing installed selections into state without changing config", async () => {
	deploy("kept");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => ["kept", "not-selected"],
		install: async () => {
			throw new Error("Existing content needs no repair");
		},
	});
	expect((await manager.reconcile()).errors).toEqual([]);
	expect(
		new SkillSelectionStore(state).read(true, join(root, "project")),
	).toEqual([{ repo: "owner/repo", name: "kept" }]);
	expect(existsSync(join(shared, "not-selected"))).toBe(false);
	expect(readFileSync(config, "utf8")).toBe('repos = ["owner/repo"]\n');
});

test("repairs missing selections and removes only confirmed obsolete or deselected content", async () => {
	const project = join(root, "project");
	const store = new SkillSelectionStore(state);
	store.write(true, project, [
		{ repo: "owner/repo", name: "missing" },
		{ repo: "owner/repo", name: "aven" },
	]);
	deploy("aven");
	deploy("deselected");
	const installed: string[] = [];
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project,
		discover: async () => ["missing", "not-selected"],
		install: async (_repo, name) => {
			installed.push(name);
			deploy(name);
		},
	});
	const result = await manager.reconcile();
	expect(result.errors).toEqual([]);
	expect(installed).toEqual(["missing"]);
	expect(existsSync(join(shared, "missing", "SKILL.md"))).toBe(true);
	expect(existsSync(join(shared, "aven"))).toBe(false);
	expect(existsSync(join(shared, "deselected"))).toBe(false);
	expect(store.read(true, project)).toEqual([
		{ repo: "owner/repo", name: "missing" },
	]);
});

test("a failed repository check preserves its selections and content while other sources reconcile", async () => {
	writeFileSync(config, 'repos = ["offline/repo", "owner/repo"]\n');
	const project = join(root, "project");
	const store = new SkillSelectionStore(state);
	store.write(true, project, [
		{ repo: "offline/repo", name: "keep-offline" },
		{ repo: "owner/repo", name: "deleted" },
	]);
	deploy("keep-offline");
	deploy("deleted");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project,
		discover: async (repo) => {
			if (repo === "offline/repo") throw new Error("Network unavailable");
			return [];
		},
		install: async () => {
			throw new Error("Must not install");
		},
	});
	expect((await manager.reconcile()).errors.length).toBeGreaterThan(0);
	expect(existsSync(join(shared, "keep-offline"))).toBe(true);
	expect(existsSync(join(shared, "deleted"))).toBe(false);
	expect(store.read(true, project)).toEqual([
		{ repo: "offline/repo", name: "keep-offline" },
	]);
});

test("TUI changes persist and remain independent across scopes and manager restarts", async () => {
	const project = join(root, "project");
	const installs: string[] = [];
	const options = {
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project,
		discover: async () => ["chosen"],
		install: async (_repo: string, name: string, isGlobal: boolean) => {
			const target = join(
				isGlobal ? join(root, "home") : project,
				".agents",
				"skills",
				name,
			);
			mkdirSync(target, { recursive: true });
			writeFileSync(join(target, "SKILL.md"), "latest");
			installs.push(target);
		},
	};
	const manager = new SkillManager(options);
	await manager.reconcile();
	await manager.select("owner/repo", "chosen", true, true);
	await manager.select("owner/repo", "chosen", false, true);
	await manager.select("owner/repo", "chosen", true, false);
	expect(new SkillSelectionStore(state).read(true, project)).toEqual([]);
	expect(new SkillSelectionStore(state).read(false, project)).toEqual([
		{ repo: "owner/repo", name: "chosen" },
	]);
	await new SkillManager(options).reconcile();
	expect(existsSync(join(shared, "chosen"))).toBe(false);
	expect(
		existsSync(join(project, ".agents", "skills", "chosen", "SKILL.md")),
	).toBe(true);
	expect(installs).toHaveLength(2);
});

test("startup refresh installs selected skills even when content exists and keeps config comments", async () => {
	writeFileSync(
		config,
		'# My repositories\nrepos = ["owner/repo"]\n\n[agents]\n# My agent choices\nenabled = ["pi"]\n',
	);
	deploy("chosen");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => ["chosen", "not-selected"],
		install: async (_repo, name) => {
			writeFileSync(join(shared, name, "SKILL.md"), "upstream version");
		},
	});
	expect((await manager.reconcile({ refresh: true })).errors).toEqual([]);
	expect(readFileSync(join(shared, "chosen", "SKILL.md"), "utf8")).toBe(
		"upstream version",
	);
	expect(readFileSync(config, "utf8")).toContain("# My agent choices");
});

test("ambiguous first-run names are not assigned to an arbitrary repository", async () => {
	writeFileSync(config, 'repos = ["one/repo", "two/repo"]\n');
	deploy("shared-name");
	deploy("unknown");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => ["shared-name"],
		install: async () => {
			throw new Error("Must not install");
		},
	});
	const result = await manager.reconcile();
	expect(result.errors.length).toBeGreaterThan(0);
	expect(existsSync(join(shared, "shared-name"))).toBe(true);
	expect(existsSync(join(shared, "unknown"))).toBe(true);
	expect(
		new SkillSelectionStore(state).read(true, join(root, "project")),
	).toBeNull();
});

test("first-run repository failure changes neither content nor selection state", async () => {
	deploy("existing");
	const before = readFileSync(config, "utf8");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => {
			throw new Error("Offline");
		},
		install: async () => {
			throw new Error("Must not install");
		},
	});
	expect((await manager.reconcile()).errors).toHaveLength(1);
	expect(readFileSync(config, "utf8")).toBe(before);
	expect(existsSync(join(shared, "existing", "SKILL.md"))).toBe(true);
});

test("failed installation remains selected and is repaired on the next pass", async () => {
	const project = join(root, "project");
	new SkillSelectionStore(state).write(true, project, [
		{ repo: "owner/repo", name: "retry" },
	]);
	let offline = true;
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project,
		discover: async () => ["retry"],
		install: async (_repo, name) => {
			if (offline) throw new Error("Failed download");
			deploy(name);
		},
	});
	expect((await manager.reconcile()).errors).toHaveLength(1);
	expect(new SkillSelectionStore(state).read(true, project)).toEqual([
		{ repo: "owner/repo", name: "retry" },
	]);
	offline = false;
	expect((await manager.reconcile()).errors).toEqual([]);
	expect(existsSync(join(shared, "retry", "SKILL.md"))).toBe(true);
});

test("configuration edits during discovery prevent changes based on an old snapshot", async () => {
	deploy("existing");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => {
			writeFileSync(config, 'repos = ["another/repo"]\n');
			return [];
		},
		install: async () => {
			throw new Error("Must not install");
		},
	});
	await expect(manager.reconcile()).rejects.toThrow("Configuration changed");
	expect(existsSync(join(shared, "existing"))).toBe(true);
});

test("invalid selections never trigger cleanup", async () => {
	deploy("existing");
	mkdirSync(join(root, "state"));
	writeFileSync(
		state,
		'[skills]\nuser = [{ repo = "owner/repo", name = "../outside" }]\n',
	);
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => [],
		install: async () => {
			throw new Error("Must not install");
		},
	});
	await expect(manager.reconcile()).rejects.toThrow("Invalid Skills TUI");
	expect(existsSync(join(shared, "existing"))).toBe(true);
});

test("saving selections leaves a symlinked config and its target unchanged", () => {
	const target = join(root, "dotfiles.toml");
	const original = readFileSync(config, "utf8");
	writeFileSync(target, original);
	rmSync(config);
	symlinkSync(target, config);
	const store = new SkillSelectionStore(state);
	store.write(true, join(root, "project"), [
		{ repo: "owner/repo", name: "kept" },
	]);
	expect(lstatSync(config).isSymbolicLink()).toBe(true);
	expect(readFileSync(target, "utf8")).toBe(original);
	expect(store.read(true, join(root, "project"))).toEqual([
		{ repo: "owner/repo", name: "kept" },
	]);
});

test("ordinary files do not prevent adoption and remain unchanged", async () => {
	deploy("kept");
	writeFileSync(join(shared, "notes.txt"), "independent file");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project: join(root, "project"),
		discover: async () => ["kept"],
		install: async () => {
			throw new Error("Must not install");
		},
	});
	expect((await manager.reconcile()).errors).toEqual([]);
	expect(readFileSync(join(shared, "notes.txt"), "utf8")).toBe(
		"independent file",
	);
	expect(
		new SkillSelectionStore(state).read(true, join(root, "project")),
	).toEqual([{ repo: "owner/repo", name: "kept" }]);
});

test("removing a repository removes its selection without depending on that repository", async () => {
	const project = join(root, "project");
	new SkillSelectionStore(state).write(true, project, [
		{ repo: "removed/repo", name: "removed" },
	]);
	deploy("removed");
	const manager = new SkillManager({
		configPath: config,
		selectionsPath: state,
		home: join(root, "home"),
		project,
		discover: async (repo) => {
			expect(repo).toBe("owner/repo");
			return [];
		},
		install: async () => {
			throw new Error("Must not install");
		},
	});
	expect((await manager.reconcile()).errors).toEqual([]);
	expect(existsSync(join(shared, "removed"))).toBe(false);
	expect(new SkillSelectionStore(state).read(true, project)).toEqual([]);
});
