import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { SkillsList } from "#components/SkillsList";
import { useScrollableList } from "#hooks/useScrollableList";
import type { AgentConfig, RepoSource } from "#lib/config";
import {
	ensureAgentSymlinks,
	getInstalledLocalSkills,
	getSkillsOnDisk,
	installLocalSkill,
	listLocalSkills,
	loadInstalledSkills,
	loadSkillsFromRepo,
	removeLocalSkill,
	removeSkillFromDisk,
} from "#lib/skills";
import { addSkill, removeSkill } from "#lib/skills-cli";
import { theme } from "#lib/theme";
import { isFileRepo, repoDisplayName, viewportHeight } from "#lib/utils";

// Module-level in-flight dedup so concurrent callers share one promise per repo.
const inflightCache = new Map<string, Promise<string[]>>();

function fetchRepoSkills(
	repo: RepoSource,
	cacheExpiryMs: number,
): Promise<string[]> {
	const inflight = inflightCache.get(repo);
	if (inflight) return inflight;
	const promise = (async () => {
		const skills = isFileRepo(repo)
			? listLocalSkills(repo)
			: await loadSkillsFromRepo(repo, cacheExpiryMs);
		inflightCache.delete(repo);
		return skills;
	})();
	inflightCache.set(repo, promise);
	return promise;
}

interface ViewByRepoProps {
	focusedColumn: "repos" | "skills" | null;
	repos: RepoSource[];
	isGlobal: boolean;
	agents: AgentConfig[];
	selectedAgents: Set<string>;
	cacheExpiryMs: number;
	onFocusSkills: () => void;
	onInstallComplete: () => void;
	onError: (msg: string) => void;
	searchFilter: string;
}

export function ViewByRepo({
	focusedColumn,
	repos,
	isGlobal,
	agents,
	selectedAgents,
	cacheExpiryMs,
	onFocusSkills,
	onInstallComplete,
	onError,
	searchFilter,
}: ViewByRepoProps) {
	const { height } = useTerminalDimensions();
	const [selectedRepo, setSelectedRepo] = useState<RepoSource | null>(null);
	const [availableSkills, setAvailableSkills] = useState<string[]>([]);
	const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
	const [loadingSkills, setLoadingSkills] = useState(false);
	const [allRepoSkills, setAllRepoSkills] = useState<Map<string, string[]>>(
		new Map(),
	);

	// Preload all repos in the background (for search filtering).
	useEffect(() => {
		for (const repo of repos) {
			fetchRepoSkills(repo, cacheExpiryMs).then((skills) => {
				setAllRepoSkills((prev) => {
					if (prev.get(repo) === skills) return prev;
					return new Map(prev).set(repo, skills);
				});
			});
		}
	}, [repos, cacheExpiryMs]);

	// Filter repos based on search
	const lowerFilter = searchFilter.toLowerCase();
	const filteredRepos = searchFilter
		? repos.filter((repo) => {
				const skills = allRepoSkills.get(repo) || [];
				return skills.some((s) => s.toLowerCase().includes(lowerFilter));
			})
		: repos;

	// Filter skills within selected repo
	const filteredSkills = searchFilter
		? availableSkills.filter((s) => s.toLowerCase().includes(lowerFilter))
		: availableSkills;

	const showSkills = availableSkills.length > 0 || loadingSkills;
	const repoSelectHeight = viewportHeight(height, 15, 5);
	const repoOptions = filteredRepos.map((repo) => ({
		name: repoDisplayName(repo),
		description: "",
	}));

	// Skills scrollable list
	const totalVH = viewportHeight(height, 15, 5);
	const skillsList = useScrollableList(
		filteredSkills.length,
		Math.max(1, totalVH - 2),
	);

	const hasPrevious = skillsList.scrollOffset > 0;
	const indicatorLines = (hasPrevious ? 1 : 0) + 1;
	const adjustedVH = totalVH - indicatorLines;

	// Auto-select first repo
	useEffect(() => {
		if (
			filteredRepos.length > 0 &&
			(!selectedRepo || !filteredRepos.includes(selectedRepo))
		) {
			setSelectedRepo(filteredRepos[0]);
		}
	}, [filteredRepos.length, filteredRepos[0], selectedRepo]);

	// Load skills when repo changes
	useEffect(() => {
		if (!selectedRepo) return;
		skillsList.reset();

		if (isFileRepo(selectedRepo)) {
			const skills = listLocalSkills(selectedRepo);
			const installed = getInstalledLocalSkills(selectedRepo, isGlobal);
			setAllRepoSkills((prev) => new Map(prev).set(selectedRepo, skills));
			setAvailableSkills(skills);
			setSelectedSkills(installed);
			setLoadingSkills(false);
			return;
		}

		// loadSkillsFromRepo reads from disk cache (~/.cache/skills-tui/)
		// and resolves fast on cache hit. Only show "Loading..." if the
		// fetch takes long enough to indicate a real network call.
		setAvailableSkills([]);
		setSelectedSkills(new Set());
		const timer = setTimeout(() => setLoadingSkills(true), 50);

		Promise.all([
			fetchRepoSkills(selectedRepo, cacheExpiryMs),
			loadInstalledSkills(selectedRepo, isGlobal),
		]).then(([skills, installed]) => {
			clearTimeout(timer);
			const onDisk = getSkillsOnDisk(skills, isGlobal);
			for (const s of onDisk) installed.add(s);
			setAllRepoSkills((prev) => new Map(prev).set(selectedRepo, skills));
			setAvailableSkills(skills);
			setSelectedSkills(installed);
			setLoadingSkills(false);
		});
	}, [selectedRepo, isGlobal, cacheExpiryMs, skillsList.reset]);

	const runAction = (
		action: "add" | "remove",
		repoUrl: string,
		skill?: string,
	) => {
		const label = skill || repoUrl;
		const fn = action === "add" ? addSkill : removeSkill;
		fn(isGlobal, selectedAgents, repoUrl, skill)
			.then(({ code }) => {
				if (code !== 0) {
					onError(
						`ERROR while ${action === "add" ? "installing" : "removing"} ${label}`,
					);
				} else {
					if (action === "remove" && skill) {
						// The CLI may not remove from the shared .agents/skills/ path
						// if the skill was installed by a different agent.
						removeSkillFromDisk(skill, isGlobal);
					} else if (action === "add" && skill) {
						// The CLI may create relative symlinks for agent paths;
						// replace them with absolute symlinks.
						ensureAgentSymlinks(skill, isGlobal, agents, selectedAgents);
					}
					onInstallComplete();
				}
			})
			.catch(() => {
				onError(
					`ERROR while ${action === "add" ? "installing" : "removing"} ${label}`,
				);
			});
	};

	useKeyboard((key) => {
		// Repos: enter to navigate to skills or install whole repo
		if (key.name === "enter" && focusedColumn === "repos" && selectedRepo) {
			if (filteredSkills.length > 0) {
				onFocusSkills();
			} else if (!isFileRepo(selectedRepo)) {
				runAction("add", selectedRepo);
			}
			return;
		}

		// Skills keyboard
		if (focusedColumn !== "skills") return;

		// Navigation keys
		if (skillsList.handlers[key.name]) {
			skillsList.handlers[key.name]();
			return;
		}

		if (key.name === "space") {
			const skill = filteredSkills[skillsList.index];
			if (skill && selectedRepo) {
				const isSelected = selectedSkills.has(skill);
				if (isFileRepo(selectedRepo)) {
					try {
						if (isSelected) {
							removeLocalSkill(skill, isGlobal, agents, selectedAgents);
						} else {
							installLocalSkill(
								selectedRepo,
								skill,
								isGlobal,
								agents,
								selectedAgents,
							);
						}
						onInstallComplete();
					} catch (_err) {
						onError(
							`ERROR while ${isSelected ? "removing" : "installing"} ${skill}`,
						);
					}
				} else {
					if (isSelected) {
						runAction("remove", selectedRepo, skill);
					} else {
						runAction("add", selectedRepo, skill);
					}
				}
				setSelectedSkills((prev) => {
					const newSet = new Set(prev);
					if (newSet.has(skill)) newSet.delete(skill);
					else newSet.add(skill);
					return newSet;
				});
			}
		}
	});

	// Reset skill index when filter changes
	useEffect(() => {
		skillsList.reset();
	}, [skillsList.reset]);

	return (
		<>
			{/* Repos column */}
			<box
				flexDirection="column"
				width={40}
				border
				borderStyle={focusedColumn === "repos" ? "double" : "rounded"}
				borderColor={
					focusedColumn === "repos" ? theme.lavender : theme.surface2
				}
				padding={1}
				overflow="hidden"
				title=" Repositories "
			>
				{filteredRepos.length > 0 ? (
					<select
						options={repoOptions}
						focused={focusedColumn === "repos"}
						height={repoSelectHeight}
						showDescription={false}
						focusedBackgroundColor="transparent"
						selectedBackgroundColor={theme.surface1}
						selectedTextColor={theme.yellow}
						textColor={theme.text}
						onChange={(index) => setSelectedRepo(filteredRepos[index])}
						onSelect={(index) => {
							const repo = filteredRepos[index];
							setSelectedRepo(repo);
							if (availableSkills.length > 0) {
								onFocusSkills();
							} else if (!isFileRepo(repo)) {
								runAction("add", repo);
							}
						}}
					/>
				) : repos.length > 0 ? (
					<text fg={theme.overlay1}>No repos match filter</text>
				) : (
					<text fg={theme.overlay1}>No repos in config.toml</text>
				)}
			</box>

			{/* Skills column */}
			{showSkills && (
				<SkillsList
					focusedColumn={focusedColumn}
					filteredSkills={filteredSkills}
					selectedSkills={selectedSkills}
					loadingSkills={loadingSkills}
					searchFilter={searchFilter}
					scrollOffset={skillsList.scrollOffset}
					activeIndex={skillsList.index}
					adjustedVH={adjustedVH}
				/>
			)}
		</>
	);
}
