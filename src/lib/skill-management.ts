import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";

export interface SkillSelection {
	repo: string;
	name: string;
}
interface Config extends Record<string, unknown> {
	repos?: unknown;
	skills?: { user?: unknown; projects?: Record<string, unknown> };
}

function readConfig(path: string): Config {
	return parse(readFileSync(path, "utf8")) as Config;
}

// Only Skills TUI state records intent. An absent scope means first-run adoption;
// an empty list means the user has deliberately selected no skills.
export class SkillSelectionStore {
	constructor(readonly path: string) {}
	private readState(): Config {
		try {
			return readConfig(this.path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
	}

	read(isGlobal: boolean, project: string): SkillSelection[] | null {
		const config = this.readState();
		const values = isGlobal
			? config.skills?.user
			: config.skills?.projects?.[resolve(project)];
		if (values === undefined) return null;
		if (
			!Array.isArray(values) ||
			values.some(
				(v) =>
					!v ||
					typeof v.repo !== "string" ||
					typeof v.name !== "string" ||
					!/^[a-z0-9][a-z0-9_-]*$/i.test(v.name),
			)
		)
			throw new Error("Invalid Skills TUI skill selections");
		if (new Set(values.map((v) => v.name)).size !== values.length) {
			throw new Error(
				"A scope cannot select the same skill name more than once",
			);
		}
		return values.map(({ repo, name }) => ({ repo, name }));
	}
	write(
		isGlobal: boolean,
		project: string,
		selections: SkillSelection[],
	): void {
		const config = this.readState();
		config.skills ??= {};
		if (isGlobal) config.skills.user = selections;
		else {
			config.skills.projects ??= {};
			config.skills.projects[resolve(project)] = selections;
		}
		const updated = stringify({ skills: config.skills });
		try {
			if (readFileSync(this.path, "utf8") === updated) return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		mkdirSync(dirname(this.path), { recursive: true });
		const target = statSync(this.path, { throwIfNoEntry: false })
			? realpathSync(this.path)
			: this.path;
		const temporary = mkdtempSync(join(dirname(target), ".skills-tui-state-"));
		try {
			const temp = join(temporary, "skill-selections.toml");
			writeFileSync(temp, updated, { mode: 0o600 });
			renameSync(temp, target);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}
}

interface ManagementOptions {
	configPath: string;
	selectionsPath: string;
	home: string;
	project: string;
	discover: (repo: string) => Promise<string[]>;
	install: (repo: string, name: string, isGlobal: boolean) => Promise<void>;
}
export interface SkillReconciliation {
	added: string[];
	removed: string[];
	errors: { path: string; error: unknown }[];
}
export class SkillManager {
	readonly store: SkillSelectionStore;
	constructor(readonly options: ManagementOptions) {
		this.store = new SkillSelectionStore(options.selectionsPath);
	}
	private pending: Promise<unknown> = Promise.resolve();
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.pending.then(operation);
		this.pending = next.catch(() => {});
		return next;
	}
	reconcile(
		options: { refresh?: boolean; scopes?: boolean[] } = {},
	): Promise<SkillReconciliation> {
		return this.enqueue(() => this.reconcileNow(options));
	}
	select(
		repo: string,
		name: string,
		isGlobal: boolean,
		selected: boolean,
	): Promise<SkillReconciliation> {
		return this.enqueue(async () => {
			if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name))
				throw new Error("Invalid skill name");
			if (this.store.read(isGlobal, this.options.project) === null) {
				await this.reconcileNow({ scopes: [isGlobal] });
			}
			const selections = this.store.read(isGlobal, this.options.project);
			if (selections === null)
				throw new Error(
					"Could not adopt existing selections; retry when repositories are available",
				);
			const repos = readConfig(this.options.configPath).repos;
			if (selected && (!Array.isArray(repos) || !repos.includes(repo)))
				throw new Error("Repository is not configured");
			const conflict = selections.find(
				(s) => s.name === name && s.repo !== repo,
			);
			if (selected && conflict)
				throw new Error(
					"Another selected repository has a skill with this name",
				);
			const next = selections.filter(
				(s) => !(s.repo === repo && s.name === name),
			);
			if (selected) next.push({ repo, name });
			this.store.write(isGlobal, this.options.project, next);
			return this.reconcileNow({ scopes: [isGlobal] });
		});
	}
	private async reconcileNow(options: {
		refresh?: boolean;
		scopes?: boolean[];
	}): Promise<SkillReconciliation> {
		const result: SkillReconciliation = { added: [], removed: [], errors: [] };
		const original = readFileSync(this.options.configPath, "utf8");
		const repos = readConfig(this.options.configPath).repos;
		if (
			!Array.isArray(repos) ||
			repos.some((repo) => typeof repo !== "string")
		) {
			throw new Error("Invalid configured repositories; no skills changed");
		}
		const scopes = options.scopes ?? [true, false];
		// Validate both scopes before making any filesystem changes.
		for (const scope of scopes) this.store.read(scope, this.options.project);
		const sources = new Map<string, string[]>();
		await Promise.all(
			repos.map(async (repo) => {
				try {
					const names = await this.options.discover(repo);
					if (names.some((name) => !/^[a-z0-9][a-z0-9_-]*$/i.test(name))) {
						throw new Error("Repository returned an unsafe skill name");
					}
					sources.set(repo, names);
				} catch (error) {
					result.errors.push({ path: repo, error });
				}
			}),
		);
		if (readFileSync(this.options.configPath, "utf8") !== original) {
			throw new Error(
				"Configuration changed during repository checks; retry synchronization",
			);
		}
		for (const isGlobal of scopes) {
			try {
				const directory = join(
					isGlobal ? this.options.home : this.options.project,
					".agents",
					"skills",
				);
				let installed: string[];
				try {
					installed = readdirSync(directory);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					installed = [];
				}
				let selections = this.store.read(isGlobal, this.options.project);
				if (selections === null) {
					if (sources.size !== new Set(repos).size) continue;
					selections = [];
					let ambiguous = false;
					for (const name of installed) {
						try {
							if (
								!statSync(join(directory, name), {
									throwIfNoEntry: false,
								})?.isDirectory()
							)
								continue;
							if (
								!statSync(join(directory, name, "SKILL.md"), {
									throwIfNoEntry: false,
								})?.isFile()
							)
								continue;
							const matches = [...new Set(repos)].filter((repo) =>
								sources.get(repo)?.includes(name),
							);
							if (matches.length > 1) {
								ambiguous = true;
								result.errors.push({
									path: join(directory, name),
									error: new Error(
										"Choose a repository for this skill in the skill selection state before adoption",
									),
								});
							} else if (matches[0])
								selections.push({ repo: matches[0], name });
						} catch (error) {
							ambiguous = true;
							result.errors.push({ path: join(directory, name), error });
						}
					}
					if (ambiguous) continue;
				}
				selections = selections.filter(
					({ repo, name }) =>
						repos.includes(repo) &&
						(!sources.has(repo) || sources.get(repo)!.includes(name)),
				);
				this.store.write(isGlobal, this.options.project, selections);
				const desired = new Set(selections.map(({ name }) => name));
				for (const name of installed) {
					const path = join(directory, name);
					try {
						const entry = lstatSync(path);
						if (
							!desired.has(name) &&
							(entry.isDirectory() || entry.isSymbolicLink())
						) {
							const current = lstatSync(path);
							if (
								entry.dev !== current.dev ||
								entry.ino !== current.ino ||
								entry.ctimeMs !== current.ctimeMs
							)
								continue;
							rmSync(path, { recursive: entry.isDirectory() });
							result.removed.push(path);
						}
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT")
							result.errors.push({ path, error });
					}
				}
				for (const { repo, name } of selections) {
					if (!sources.has(repo)) continue;
					const path = join(directory, name);
					try {
						if (
							options.refresh ||
							!statSync(join(path, "SKILL.md"), {
								throwIfNoEntry: false,
							})?.isFile()
						) {
							await this.options.install(repo, name, isGlobal);
							if (
								!statSync(join(path, "SKILL.md"), {
									throwIfNoEntry: false,
								})?.isFile()
							) {
								throw new Error("Install did not produce a Skill Instance");
							}
							result.added.push(path);
						}
					} catch (error) {
						result.errors.push({ path, error });
					}
				}
			} catch (error) {
				result.errors.push({
					path: isGlobal ? this.options.home : this.options.project,
					error,
				});
			}
		}
		return result;
	}
}
