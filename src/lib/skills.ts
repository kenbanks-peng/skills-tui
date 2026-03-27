import {
	cpSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readTextFile, writeTextFile } from "#lib/compat";
import type { AgentConfig } from "#lib/config";
import { cacheDir } from "#lib/config";
import { listRepoSkills, listSkills } from "#lib/skills-cli";
import { fileUrlToPath, stripAnsi } from "#lib/utils";

// Installed skill info: skill name -> set of agent names
export interface InstalledSkillInfo {
	name: string;
	path: string;
	agents: Set<string>;
}

// Load installed skill names for a given repo from the lock file,
// verifying each skill actually exists on disk and pruning stale entries.
export async function loadInstalledSkills(
	repo: string,
	isGlobal: boolean,
): Promise<Set<string>> {
	try {
		const lockPaths = isGlobal
			? [join(homedir(), ".local", "state", "skills", ".skill-lock.json")]
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
				{ source?: string },
			][]) {
				if (!existsSync(join(baseDir, skillName))) {
					delete data.skills[skillName];
					pruned = true;
					continue;
				}
				if (info.source === repo) {
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

// Cache types
interface SkillCache {
	[repo: string]: {
		skills: string[];
		timestamp: number;
	};
}

// Get cache file path
function getCachePath(): string {
	return join(cacheDir, "skills-cache.json");
}

// Read cache from disk
async function readCache(): Promise<SkillCache> {
	try {
		const cachePath = getCachePath();
		const text = await readTextFile(cachePath);
		if (text === null) {
			return {};
		}
		return JSON.parse(text);
	} catch (err) {
		console.error("Failed to read cache:", err);
		return {};
	}
}

// Write cache to disk
async function writeCache(cache: SkillCache): Promise<void> {
	try {
		const cachePath = getCachePath();
		await writeTextFile(cachePath, JSON.stringify(cache, null, 2));
	} catch (err) {
		console.error("Failed to write cache:", err);
	}
}

// Check if cache entry is older than 24 hours
function isCacheStale(timestamp: number): boolean {
	const now = Date.now();
	const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
	return now - timestamp > twentyFourHours;
}

// Load available skills from a repository (with caching)
export async function loadSkillsFromRepo(repo: string): Promise<string[]> {
	try {
		// Check cache first
		const cache = await readCache();
		const cached = cache[repo];

		// Return cached data if it exists and is less than 24 hours old
		if (cached && !isCacheStale(cached.timestamp)) {
			return cached.skills;
		}

		// Fetch fresh data
		const text = await listRepoSkills(repo);

		// Parse skill names from the output
		const skills: string[] = [];
		const lines = text.split("\n");
		let inSkillsSection = false;

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.includes("Available Skills")) {
				inSkillsSection = true;
				continue;
			}
			if (inSkillsSection) {
				// Look for lines that start with │ followed by a skill name
				const match = trimmed.match(/^│\s+([a-z0-9-]+)$/);
				if (match?.[1]) {
					skills.push(match[1]);
				}
				// Stop at the closing line
				if (trimmed.startsWith("└")) {
					break;
				}
			}
		}

		// Update cache
		cache[repo] = {
			skills,
			timestamp: Date.now(),
		};
		await writeCache(cache);

		return skills;
	} catch (err) {
		console.error("Failed to load skills:", err);
		return [];
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
