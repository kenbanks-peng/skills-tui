import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	configPath,
	loadAgents,
	loadDisabledAgents,
	loadUniversalAgents,
} from "#lib/config";
import { syncCopyAgents } from "#lib/copy-agent-skills";
import { reconcileSkillLinks } from "#lib/reconcile-skill-links";
import { SkillManager, type SkillReconciliation } from "#lib/skill-management";
import { cacheRepositorySkills, discoverRepoSkills } from "#lib/skills";
import { addSkill } from "#lib/skills-cli";
import { syncAgentSkills } from "#lib/sync-agent-skills";

async function discover(repo: string): Promise<string[]> {
	if (repo.startsWith("file://")) {
		const directory = fileURLToPath(repo);
		return readdirSync(directory, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() &&
					!entry.name.startsWith(".") &&
					statSync(join(directory, entry.name, "SKILL.md"), {
						throwIfNoEntry: false,
					})?.isFile(),
			)
			.map((entry) => entry.name)
			.sort();
	}
	const names = await discoverRepoSkills(repo, { authoritative: true });
	if (names === null)
		throw new Error("Could not read repository; its selections are unchanged");
	await cacheRepositorySkills(repo, names);
	return names;
}

async function install(
	repo: string,
	name: string,
	isGlobal: boolean,
): Promise<void> {
	if (!repo.startsWith("file://")) {
		// Explicit add restores missing content independently of CLI update tracking.
		// Only the shared location is requested; Skills TUI manages agent deployment.
		const result = await addSkill(isGlobal, ["opencode"], repo, name);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout);
		return;
	}
	const shared = join(
		isGlobal ? homedir() : process.cwd(),
		".agents",
		"skills",
	);
	mkdirSync(shared, { recursive: true });
	const staging = mkdtempSync(join(dirname(shared), ".skills-tui-"));
	const destination = join(shared, name);
	const backup = join(staging, "old");
	let committed = false;
	try {
		cpSync(join(fileURLToPath(repo), name), join(staging, "new"), {
			recursive: true,
			dereference: true,
		});
		if (existsSync(destination)) renameSync(destination, backup);
		try {
			renameSync(join(staging, "new"), destination);
			committed = true;
		} catch (error) {
			if (existsSync(backup)) renameSync(backup, destination);
			throw error;
		}
	} finally {
		// Keep a recoverable backup if restoring the previous deployment failed.
		if (committed || !existsSync(backup))
			rmSync(staging, { recursive: true, force: true });
	}
}

const manager = new SkillManager({
	configPath,
	home: homedir(),
	project: process.cwd(),
	discover,
	install,
});
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
	const next = pending.then(action);
	pending = next.catch(() => {});
	return next;
}

async function synchronizeAgents(
	result: SkillReconciliation,
): Promise<SkillReconciliation> {
	const [agents, disabled, universal] = await Promise.all([
		loadAgents(),
		loadDisabledAgents(),
		loadUniversalAgents(),
	]);
	const selected = new Set(
		agents.filter((a) => !disabled.has(a.name)).map((a) => a.name),
	);
	const links = reconcileSkillLinks(agents);
	result.removed.push(...links.removed);
	result.errors.push(...links.errors);
	for (const agent of agents) {
		if (agent.mode === "copy") continue;
		const sync = syncAgentSkills(agent, agents, selected, undefined, universal);
		result.added.push(...sync.added);
		result.removed.push(...sync.removed);
		result.errors.push(...sync.errors);
	}
	const copies = syncCopyAgents(agents, selected);
	result.added.push(...copies.added);
	result.removed.push(...copies.removed);
	result.errors.push(...copies.errors);
	return result;
}

export function synchronizeConfiguredSkills(
	options: { refresh?: boolean; scopes?: boolean[] } = {},
): Promise<SkillReconciliation> {
	return serialize(async () =>
		synchronizeAgents(await manager.reconcile(options)),
	);
}

export function setConfiguredSkillSelection(
	repo: string,
	name: string,
	isGlobal: boolean,
	selected: boolean,
): Promise<SkillReconciliation> {
	return serialize(async () =>
		synchronizeAgents(await manager.select(repo, name, isGlobal, selected)),
	);
}
