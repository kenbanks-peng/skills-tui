import {
	cpSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readTextFile, writeTextFile } from "#lib/compat";
import type { AgentConfig, RepoSource } from "#lib/config";
import { cacheDir } from "#lib/config";
import { listRepoSkills, listSkills } from "#lib/skills-cli";
import {
	fileUrlToPath,
	isFileRepo,
	repoDisplayName,
	stripAnsi,
} from "#lib/utils";

// Installed skill info: skill name -> set of agent names
export interface InstalledSkillInfo {
	name: string;
	path: string;
	agents: Set<string>;
}

function normalizeRepoSource(repo: string): string {
	return repo
		.replace(/^https:\/\/github\.com\//, "")
		.replace(/\.git\/?$/, "")
		.replace(/\/$/, "");
}

function repoMatchesLockSource(repo: string, source?: string, sourceUrl?: string) {
	const normalizedRepo = normalizeRepoSource(repo);
	return [source, sourceUrl]
		.filter((value): value is string => Boolean(value))
		.some((value) => normalizeRepoSource(value) === normalizedRepo);
}

// Load installed skill names for a given repo from the lock file,
// verifying each skill actually exists on disk and pruning stale entries.
export async function loadInstalledSkills(
	repo: string,
	isGlobal: boolean,
): Promise<Set<string>> {
	try {
		const xdgStateHome =
			process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
		const lockPaths = isGlobal
			? [join(xdgStateHome, "skills", ".skill-lock.json")]
			: ["skills-lock.json"];
		const baseDir = agentsSkillsDir(isGlobal);
		const installed = new Set<string>();
		for (const lockPath of lockPaths) {
			const text = await readTextFile(lockPath);
			if (text === null) continue;
			const data = JSON.parse(text);
			if (!data.skills) continue;
			let pruned = false;
			for (const [skillName, info] of Object.entries(data.skills) as [
				string,
				{ source?: string; sourceUrl?: string },
			][]) {
				if (!existsSync(join(baseDir, skillName))) {
					delete data.skills[skillName];
					pruned = true;
					continue;
				}
				if (repoMatchesLockSource(repo, info.source, info.sourceUrl)) {
					installed.add(skillName);
				}
			}
			if (pruned) {
				await writeTextFile(lockPath, JSON.stringify(data, null, 2));
			}
		}
		return installed;
	} catch {
		return new Set();
	}
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

// Remove a skill directory from .agents/skills/ if it exists on disk.
// Used when the skills CLI doesn't fully clean up the shared path.
export function removeSkillFromDisk(
	skillName: string,
	isGlobal: boolean,
): void {
	const dest = join(agentsSkillsDir(isGlobal), skillName);
	if (existsSync(dest)) rmSync(dest, { recursive: true });
}

// Parse `skills list` output into structured data
export async function parseInstalledSkills(
	isGlobal: boolean,
	agentNames: string[],
): Promise<InstalledSkillInfo[]> {
	try {
		const text = await listSkills(isGlobal, agentNames);

		// Strip ANSI codes
		const clean = stripAnsi(text);
		const lines = clean.split("\n");

		const skills: InstalledSkillInfo[] = [];
		let currentSkill: string | null = null;
		let currentPath = "";

		for (const line of lines) {
			const trimmed = line.trim();
			// Skill name line: starts with skill name followed by path (e.g. "brainstorming ~/.agents/skills/brainstorming")
			const skillMatch = trimmed.match(/^([a-z0-9_-]+)\s+(~?\S+)/);
			if (skillMatch) {
				currentSkill = skillMatch[1];
				currentPath = skillMatch[2];
				continue;
			}
			// Agents line: "Agents: Claude Code, Pi" or "Agents: not linked"
			if (currentSkill && trimmed.startsWith("Agents:")) {
				const agentsPart = trimmed.replace("Agents:", "").trim();
				const agentSet = new Set<string>();
				if (agentsPart !== "not linked") {
					for (const a of agentsPart.split(",")) {
						agentSet.add(a.trim());
					}
				}
				skills.push({
					name: currentSkill,
					path: currentPath,
					agents: agentSet,
				});
				currentSkill = null;
				currentPath = "";
			}
		}

		return skills;
	} catch {
		return [];
	}
}

// Parse the skills CLI table without depending on its border characters.
export function parseSkillsCliOutput(text: string): string[] {
	const skills = new Set<string>();
	let inSkillsSection = false;

	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (/available skills/i.test(trimmed)) {
			inSkillsSection = true;
			continue;
		}
		if (!inSkillsSection) continue;
		if (/^[└+]/.test(trimmed)) break;

		// Support the CLI's Unicode table and a plain-text fallback. A skill name
		// is deliberately constrained to directory-safe names used by the CLI.
		const match = trimmed.match(/^(?:[│|]\s*)?([a-z0-9][a-z0-9_-]*)\s*$/i);
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
}

// Discover skills directly when the external CLI cannot list a GitHub repo.
// This keeps repository browsing useful even if the user's skills executable is
// missing or incompatible.
async function listGithubRepoSkills(repo: string): Promise<string[]> {
	const path = githubRepoPath(repo);
	if (!path) return [];

	try {
		const response = await fetch(
			`https://api.github.com/repos/${path}/git/trees/HEAD?recursive=1`,
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!response.ok) return [];
		const data = (await response.json()) as GithubTreeResponse;
		const skills = new Set<string>();
		for (const entry of data.tree ?? []) {
			if (entry.type !== "blob" || !entry.path?.endsWith("/SKILL.md")) continue;
			const skill = entry.path.slice(0, -"/SKILL.md".length).split("/").pop();
			if (skill) skills.add(skill);
		}
		return [...skills].sort();
	} catch {
		return [];
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

// Load available skills from a repository (with per-repo caching)
export async function loadSkillsFromRepo(
	repo: string,
	cacheExpiryMs: number,
	options: { forceRefresh?: boolean } = {},
): Promise<string[]> {
	try {
		// Check cache first
		const cached = options.forceRefresh ? null : await readRepoCache(repo);

		if (cached && Date.now() - cached.timestamp <= cacheExpiryMs) {
			return cached.skills;
		}

		// Fetch fresh data. The skills CLI is the primary source because it also
		// supports non-GitHub repositories. When it is unavailable or changes its
		// display format, discover SKILL.md files directly from GitHub instead.
		const text = await listRepoSkills(repo);
		let skills = parseSkillsCliOutput(text);
		if (skills.length === 0) skills = await listGithubRepoSkills(repo);

		// Write per-repo cache file (no shared state, no race)
		await writeRepoCache(repo, { version: 2, skills, timestamp: Date.now() });

		return skills;
	} catch (err) {
		console.error("Failed to load skills:", err);
		return [];
	}
}

export interface RepoNewSkillsInfo {
	repo: RepoSource;
	newSkills: string[];
}

// Check configured repos that already have at least one installed skill and
// report skills that exist upstream but are not installed locally/globally.
// The skills CLI's check/update commands only compare lock-tracked skill hashes;
// they intentionally do not report newly added skills in the same repo.
export async function findNewSkillsInTrackedRepos(
	repos: RepoSource[],
	isGlobal: boolean,
	cacheExpiryMs: number,
): Promise<RepoNewSkillsInfo[]> {
	const results: RepoNewSkillsInfo[] = [];

	for (const repo of repos) {
		const installed = isFileRepo(repo)
			? getInstalledLocalSkills(repo, isGlobal)
			: await loadInstalledSkills(repo, isGlobal);

		// Avoid reporting every skill from every configured repo. Only repos with at
		// least one installed skill are relevant to Check/Update.
		if (installed.size === 0) continue;

		const skills = isFileRepo(repo)
			? listLocalSkills(repo)
			: await loadSkillsFromRepo(repo, cacheExpiryMs, { forceRefresh: true });

		// Treat matching skill directories on disk as installed even if they are not
		// represented in the skills CLI lock file (for example symlinked/shared skills).
		for (const skill of getSkillsOnDisk(skills, isGlobal)) {
			installed.add(skill);
		}

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
	const infos = await findNewSkillsInTrackedRepos(repos, isGlobal, cacheExpiryMs);
	if (infos.length === 0) {
		return "\n✓ No new skills found in installed repositories.\n";
	}

	const lines = ["", "New skills available in installed repositories:"];
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

// Resolve ~ in a path
function expandHome(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

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

// Check which skills from a file:// repo are currently installed
export function getInstalledLocalSkills(
	repoUrl: string,
	isGlobal: boolean,
): Set<string> {
	const baseDir = agentsSkillsDir(isGlobal);
	const available = listLocalSkills(repoUrl);
	const installed = new Set<string>();
	for (const skill of available) {
		const dest = join(baseDir, skill);
		if (existsSync(dest)) installed.add(skill);
	}
	return installed;
}

// Ensure absolute symlinks from each non-universal agent's skill path to .agents/skills/<skill>.
// The skills CLI may create relative symlinks which break across directory structures.
export function ensureAgentSymlinks(
	skillName: string,
	isGlobal: boolean,
	agents: AgentConfig[],
	selectedAgents: Set<string>,
): void {
	const baseDir = agentsSkillsDir(isGlobal);
	const destDir = join(baseDir, skillName);
	if (!existsSync(destDir)) return;

	for (const agent of agents) {
		if (!selectedAgents.has(agent.name)) continue;
		const agentPath = isGlobal ? agent.global : agent.local;
		// Skip agents that already use the standard .agents/skills/ path
		if (agentPath === ".agents/skills/" || agentPath === "~/.agents/skills/")
			continue;
		const agentSkillsDir = expandHome(
			isGlobal ? agentPath : join(process.cwd(), agentPath),
		);
		const agentSkillDir = join(agentSkillsDir, skillName);
		mkdirSync(agentSkillsDir, { recursive: true });
		// Use lstatSync to detect broken symlinks (existsSync follows symlinks
		// and returns false for broken ones, leaving them in place).
		try {
			lstatSync(agentSkillDir);
			rmSync(agentSkillDir, { recursive: true });
		} catch {
			/* doesn't exist */
		}
		symlinkSync(resolve(destDir), agentSkillDir);
	}
}

// Install a skill from a file:// repo: copy into .agents/skills/ and symlink to agent paths
export function installLocalSkill(
	repoUrl: string,
	skillName: string,
	isGlobal: boolean,
	agents: AgentConfig[],
	selectedAgents: Set<string>,
): void {
	const srcDir = join(fileUrlToPath(repoUrl), skillName);
	const baseDir = agentsSkillsDir(isGlobal);
	const destDir = join(baseDir, skillName);

	// Copy skill into .agents/skills/<skill>
	mkdirSync(baseDir, { recursive: true });
	if (existsSync(destDir)) rmSync(destDir, { recursive: true });
	cpSync(srcDir, destDir, { recursive: true });

	ensureAgentSymlinks(skillName, isGlobal, agents, selectedAgents);
}

// Remove a skill installed from a file:// repo
export function removeLocalSkill(
	skillName: string,
	isGlobal: boolean,
	agents: AgentConfig[],
	selectedAgents: Set<string>,
): void {
	const baseDir = agentsSkillsDir(isGlobal);
	const destDir = join(baseDir, skillName);

	// Remove from .agents/skills/
	if (existsSync(destDir)) rmSync(destDir, { recursive: true });

	// Remove symlinks from agent paths
	for (const agent of agents) {
		if (!selectedAgents.has(agent.name)) continue;
		const agentPath = isGlobal ? agent.global : agent.local;
		if (agentPath === ".agents/skills/" || agentPath === "~/.agents/skills/")
			continue;
		const agentSkillDir = join(
			expandHome(isGlobal ? agentPath : join(process.cwd(), agentPath)),
			skillName,
		);
		try {
			if (
				lstatSync(agentSkillDir).isSymbolicLink() ||
				existsSync(agentSkillDir)
			) {
				rmSync(agentSkillDir, { recursive: true });
			}
		} catch {
			/* already gone */
		}
	}
}
