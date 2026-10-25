import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readTextFile, writeTextFile } from "#lib/compat";
import type { RepoSource } from "#lib/config";
import { cacheDir, configPath } from "#lib/config";
import { SkillSelectionStore } from "#lib/skill-management";
import { inspectRepoSkills, listRepoSkills } from "#lib/skills-cli";
import {
	fileUrlToPath,
	isFileRepo,
	repoDisplayName,
	stripAnsi,
} from "#lib/utils";

// Concrete shared Skill Instances, independent of saved selection intent.
export interface InstalledSkillInfo {
	name: string;
	path: string;
}

// Selection state belongs to Skills TUI config, never to another tool's state.
export async function loadSelectedSkills(
	repo: string,
	isGlobal: boolean,
): Promise<Set<string>> {
	const selections = new SkillSelectionStore(configPath).read(
		isGlobal,
		process.cwd(),
	);
	if (selections === null) {
		const names = isFileRepo(repo)
			? listLocalSkills(repo)
			: await loadSkillsFromRepo(repo, 24 * 60 * 60 * 1000);
		return getSkillsOnDisk(names, isGlobal);
	}
	return new Set(selections.filter((s) => s.repo === repo).map((s) => s.name));
}

// Check which skills from a list exist on disk in .agents/skills/.
// This catches skills installed by other agents that share the universal path.
export function getSkillsOnDisk(
	skillNames: string[],
	isGlobal: boolean,
): Set<string> {
	const baseDir = agentsSkillsDir(isGlobal);
	const onDisk = new Set<string>();
	for (const name of skillNames) {
		if (existsSync(join(baseDir, name))) {
			onDisk.add(name);
		}
	}
	return onDisk;
}

// Inspect shared Skill Instances directly. Agent Visibility is determined by
// the caller from configured locations, not from the skills CLI's state.
export async function listInstalledSkills(
	isGlobal: boolean,
): Promise<InstalledSkillInfo[]> {
	const directory = agentsSkillsDir(isGlobal);
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => existsSync(join(directory, name, "SKILL.md")))
		.map((name) => ({
			name,
			path: isGlobal ? `~/.agents/skills/${name}` : `.agents/skills/${name}`,
		}));
}

// Parse the skills CLI table without depending on its border characters.
export function parseSkillsCliOutput(text: string): string[] {
	const section = stripAnsi(text).split(/available skills/i)[1];
	if (!section) return [];
	const lines = section.split("\n");
	const bordered = lines.some((line) => /^[│|]/.test(line));
	const skills = new Set<string>();
	for (const line of lines) {
		if (/^[└+]/.test(line.trim())) break;
		// Clack prints names with four spaces after the bar and descriptions
		// with six. Bare plugin headings and single-word descriptions are not names.
		const match = bordered
			? line.match(/^[│|] {1,4}([a-z0-9][a-z0-9_-]*)\s*$/i)
			: line.match(/^\s*([a-z0-9][a-z0-9_-]*)\s*$/i);
		if (match?.[1]) skills.add(match[1]);
	}
	return [...skills].sort();
}

function githubRepoPath(repo: string): string | null {
	if (/^[^/\s]+\/[^/\s]+$/.test(repo)) return repo;
	const match = repo.match(
		/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/,
	);
	return match?.[1] ?? null;
}

interface GithubTreeResponse {
	tree?: { path?: string; type?: string }[];
	truncated?: boolean;
}

// Discover skills directly when the external CLI cannot list a GitHub repo.
// This keeps repository browsing useful even if the user's skills executable is
// missing or incompatible.
async function listGithubRepoSkills(repo: string): Promise<string[] | null> {
	const path = githubRepoPath(repo);
	if (!path) return null;

	try {
		const response = await fetch(
			`https://api.github.com/repos/${path}/git/trees/HEAD?recursive=1`,
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!response.ok) return null;
		const data = (await response.json()) as GithubTreeResponse;
		if (data.truncated || !Array.isArray(data.tree)) return null;
		const skills = new Set<string>();
		for (const entry of data.tree) {
			if (entry.type !== "blob" || !entry.path?.endsWith("/SKILL.md")) continue;
			const skill = entry.path.slice(0, -"/SKILL.md".length).split("/").pop();
			if (skill) skills.add(skill);
		}
		return [...skills].sort();
	} catch {
		return null;
	}
}

export async function discoverRepoSkills(
	repo: string,
	options: { authoritative?: boolean } = {},
): Promise<string[] | null> {
	try {
		if (options.authoritative) {
			const result = await inspectRepoSkills(repo);
			const text = stripAnsi(result.stdout + "\n" + result.stderr);
			if (result.code !== 0) {
				// This exact CLI result means discovery completed, but no Skill
				// definitions exist. Other failures are never an empty inventory.
				return text.includes(
					"No valid skills found. Skills require a SKILL.md with name and description.",
				)
					? []
					: null;
			}
			const names = parseSkillsCliOutput(text);
			const count = text.match(/Found (\d+) skills?\b/);
			// Human output is accepted for cleanup only if its advertised count
			// agrees with the parsed list. Browsing fallbacks are not deletion proof.
			if (!count || names.length !== Number(count[1])) return null;
			return names;
		}
		const text = await listRepoSkills(repo);
		const skills = parseSkillsCliOutput(stripAnsi(text));
		if (skills.length > 0) return skills;

		// An empty GitHub repository result is valid. A failed GitHub request is
		// not: callers must retain the previous cache when the source is unknown.
		return githubRepoPath(repo) ? await listGithubRepoSkills(repo) : [];
	} catch {
		return null;
	}
}

// Per-repo cache entry
interface RepoCacheEntry {
	version: 2;
	skills: string[];
	timestamp: number;
}

// Convert a repo identifier to a safe filename
function repoCacheFile(repo: string): string {
	const safe = repo.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(cacheDir, `repo_${safe}.json`);
}

// Read a single repo's cache from disk
async function readRepoCache(repo: string): Promise<RepoCacheEntry | null> {
	try {
		const text = await readTextFile(repoCacheFile(repo));
		if (text === null) return null;
		const entry = JSON.parse(text) as Partial<RepoCacheEntry>;
		// Version 1 cached empty results whenever the skills CLI failed. Ignore
		// those entries so existing users recover automatically after upgrading.
		if (entry.version !== 2 || !Array.isArray(entry.skills)) return null;
		return entry as RepoCacheEntry;
	} catch {
		return null;
	}
}

// Write a single repo's cache to disk
async function writeRepoCache(
	repo: string,
	entry: RepoCacheEntry,
): Promise<void> {
	try {
		await writeTextFile(repoCacheFile(repo), JSON.stringify(entry));
	} catch {
		/* best effort */
	}
}

export async function cacheRepositorySkills(
	repo: string,
	skills: string[],
): Promise<void> {
	await writeRepoCache(repo, { version: 2, skills, timestamp: Date.now() });
}

// Load available skills from a repository (with per-repo caching)
export async function loadSkillsFromRepo(
	repo: string,
	cacheExpiryMs: number,
	options: { forceRefresh?: boolean } = {},
): Promise<string[]> {
	try {
		const cached = await readRepoCache(repo);

		if (
			!options.forceRefresh &&
			cached &&
			Date.now() - cached.timestamp <= cacheExpiryMs
		) {
			return cached.skills;
		}

		const skills = await discoverRepoSkills(repo);
		if (skills === null) return cached?.skills ?? [];

		await writeRepoCache(repo, { version: 2, skills, timestamp: Date.now() });
		return skills;
	} catch (err) {
		console.error("Failed to load skills:", err);
		return [];
	}
}

export interface ReconciledRepoSkills {
	skills: string[];
	removed: string[];
}

// Keep source skills and installed cached skills. Cached skills that satisfy
// neither condition are no longer useful and must be removed.
export function reconcileRepoSkillNames(
	cached: string[],
	source: string[],
	installed: Set<string>,
): ReconciledRepoSkills {
	const sourceSkills = new Set(source);
	const skills = new Set(source);
	const removed: string[] = [];

	for (const skill of cached) {
		if (sourceSkills.has(skill) || installed.has(skill)) skills.add(skill);
		else removed.push(skill);
	}

	return { skills: [...skills].sort(), removed: removed.sort() };
}

export interface RepoCacheReconciliation {
	repo: RepoSource;
	removed: string[];
}

// Refresh existing repository caches in the background at startup. A source
// failure leaves its cache unchanged. Installed skills stay visible so the user
// can still remove them after their source repository deletes them.
export async function reconcileRepoCaches(
	repos: RepoSource[],
): Promise<RepoCacheReconciliation[]> {
	const results = await Promise.all(
		repos.map(async (repo): Promise<RepoCacheReconciliation | null> => {
			if (isFileRepo(repo)) return null;
			const cached = await readRepoCache(repo);
			if (!cached) return null;

			const source = await discoverRepoSkills(repo);
			if (source === null) return null;

			const [globalInstalled, projectInstalled] = await Promise.all([
				loadSelectedSkills(repo, true),
				loadSelectedSkills(repo, false),
			]);
			const installed = new Set([...globalInstalled, ...projectInstalled]);
			for (const skill of getSkillsOnDisk(cached.skills, true))
				installed.add(skill);
			for (const skill of getSkillsOnDisk(cached.skills, false))
				installed.add(skill);

			const reconciled = reconcileRepoSkillNames(
				cached.skills,
				source,
				installed,
			);
			await writeRepoCache(repo, {
				version: 2,
				skills: reconciled.skills,
				timestamp: Date.now(),
			});
			return { repo, removed: reconciled.removed };
		}),
	);

	return results.filter(
		(result): result is RepoCacheReconciliation => result !== null,
	);
}

export interface RepoNewSkillsInfo {
	repo: RepoSource;
	newSkills: string[];
}

// Check configured repos that already have at least one selected skill and
// report skills that exist upstream but are not installed locally/globally.
// New repository skills are not selected automatically.
export async function findNewSkillsInTrackedRepos(
	repos: RepoSource[],
	isGlobal: boolean,
	cacheExpiryMs: number,
): Promise<RepoNewSkillsInfo[]> {
	const results: RepoNewSkillsInfo[] = [];

	for (const repo of repos) {
		const installed = await loadSelectedSkills(repo, isGlobal);

		// Avoid reporting every skill from every configured repo. Only repos with at
		// least one installed skill are relevant to Check/Update.
		if (installed.size === 0) continue;

		const skills = isFileRepo(repo)
			? listLocalSkills(repo)
			: await loadSkillsFromRepo(repo, cacheExpiryMs, { forceRefresh: true });

		const newSkills = skills.filter((skill) => !installed.has(skill));
		if (newSkills.length > 0) {
			results.push({ repo, newSkills });
		}
	}

	return results;
}

export async function formatNewSkillsSummary(
	repos: RepoSource[],
	isGlobal: boolean,
	cacheExpiryMs: number,
): Promise<string> {
	const infos = await findNewSkillsInTrackedRepos(
		repos,
		isGlobal,
		cacheExpiryMs,
	);
	if (infos.length === 0) {
		return "\n✓ No new skills found in selected repositories.\n";
	}

	const lines = ["", "New skills available in selected repositories:"];
	for (const info of infos) {
		lines.push(`\n${repoDisplayName(info.repo)} (${info.newSkills.length})`);
		for (const skill of info.newSkills) {
			lines.push(`  • ${skill}`);
		}
	}
	lines.push("", "Install them from View by Repo, or run:");
	for (const info of infos) {
		for (const skill of info.newSkills) {
			const globalFlag = isGlobal ? " -g" : "";
			lines.push(
				`  npx skills add ${info.repo} --skill ${skill}${globalFlag} -y`,
			);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

// Remove cache files for repos not in the current list and stale entries.
export function pruneCache(repos: RepoSource[], cacheExpiryMs: number): void {
	const validFiles = new Set(repos.map((r) => repoCacheFile(r)));
	try {
		const entries = readdirSync(cacheDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.startsWith("repo_")) continue;
			const filePath = join(cacheDir, entry.name);
			// Remove if repo no longer in list
			if (!validFiles.has(filePath)) {
				unlinkSync(filePath);
				continue;
			}
			// Remove if stale
			try {
				const raw = readFileSync(filePath, "utf-8");
				const data: RepoCacheEntry = JSON.parse(raw);
				if (Date.now() - data.timestamp > cacheExpiryMs) {
					unlinkSync(filePath);
				}
			} catch {
				unlinkSync(filePath);
			}
		}
	} catch {
		/* cache dir may not exist yet */
	}
}

// --- file:// repo support ---

// Get the .agents/skills base dir (local or global)
function agentsSkillsDir(isGlobal: boolean): string {
	return isGlobal
		? join(homedir(), ".agents", "skills")
		: join(process.cwd(), ".agents", "skills");
}

// List skill directories inside a file:// repo path
export function listLocalSkills(repoUrl: string): string[] {
	const dir = fileUrlToPath(repoUrl);
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory() && !d.name.startsWith("."))
			.map((d) => d.name)
			.sort();
	} catch {
		return [];
	}
}
