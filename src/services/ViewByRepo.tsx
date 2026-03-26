import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import { theme } from "../theme";
import {
	loadInstalledSkills,
	loadSkillsFromRepo,
	listLocalSkills,
	getInstalledLocalSkills,
	installLocalSkill,
	removeLocalSkill,
} from "../skills";
import { truncateText, isFileRepo, repoDisplayName } from "../utils";
import { addSkill, removeSkill } from "../skills-cli";
import type { AgentConfig, RepoSource } from "../config";

interface ViewByRepoProps {
	focusedColumn: "repos" | "skills" | null;
	repos: RepoSource[];
	isGlobal: boolean;
	agents: AgentConfig[];
	selectedAgents: Set<string>;
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
	onFocusSkills,
	onInstallComplete,
	onError,
	searchFilter,
}: ViewByRepoProps) {
	const { height } = useTerminalDimensions();
	const [selectedRepo, setSelectedRepo] = useState<RepoSource | null>(null);
	const [availableSkills, setAvailableSkills] = useState<string[]>([]);
	const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
	const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
	const [skillScrollOffset, setSkillScrollOffset] = useState(0);
	const [loadingSkills, setLoadingSkills] = useState(false);
	const [allRepoSkills, setAllRepoSkills] = useState<Map<string, string[]>>(
		new Map(),
	);

	// Preload skills for all repos (for search filtering)
	useEffect(() => {
		if (repos.length === 0) return;
		const loadAll = async () => {
			const map = new Map<string, string[]>();
			await Promise.all(
				repos.map(async (repo) => {
					const skills = isFileRepo(repo)
						? listLocalSkills(repo)
						: await loadSkillsFromRepo(repo);
					map.set(repo, skills);
				}),
			);
			setAllRepoSkills(map);
		};
		loadAll();
	}, [repos]);

	// Filter repos based on search
	const lowerFilter = searchFilter.toLowerCase();
	const filteredRepos = searchFilter
		? repos.filter((repo) => {
				const skills = allRepoSkills.get(repo) || [];
				return skills.some((s) => s.toLowerCase().includes(lowerFilter));
			})
		: repos;

	// Auto-select first repo
	useEffect(() => {
		if (
			filteredRepos.length > 0 &&
			(!selectedRepo || !filteredRepos.includes(selectedRepo))
		) {
			setSelectedRepo(filteredRepos[0]);
		}
	}, [filteredRepos.length, searchFilter]);

	// Load skills when repo changes
	useEffect(() => {
		if (selectedRepo) {
			setLoadingSkills(true);
			setAvailableSkills([]);
			setSelectedSkills(new Set());
			setSelectedSkillIndex(0);
			setSkillScrollOffset(0);
			if (isFileRepo(selectedRepo)) {
				const skills = listLocalSkills(selectedRepo);
				const installed = getInstalledLocalSkills(selectedRepo, isGlobal);
				setAvailableSkills(skills);
				setSelectedSkills(installed);
				setLoadingSkills(false);
			} else {
				Promise.all([
					loadSkillsFromRepo(selectedRepo),
					loadInstalledSkills(selectedRepo, isGlobal),
				]).then(([skills, installed]) => {
					setAvailableSkills(skills);
					setSelectedSkills(installed);
					setLoadingSkills(false);
				});
			}
		}
	}, [selectedRepo]);

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
					onInstallComplete();
				}
			})
			.catch(() => {
				onError(
					`ERROR while ${action === "add" ? "installing" : "removing"} ${label}`,
				);
			});
	};

	// Filter skills within selected repo
	const filteredSkills = searchFilter
		? availableSkills.filter((s) => s.toLowerCase().includes(lowerFilter))
		: availableSkills;

	const showSkills = availableSkills.length > 0;
	const repoSelectHeight = Math.max(5, height - 15);
	const repoOptions = filteredRepos.map((repo) => ({
		name: repoDisplayName(repo),
	}));

	// Skills keyboard handling
	const totalViewportHeight = Math.max(5, height - 15);
	const hasPrevious = skillScrollOffset > 0;
	const indicatorLines = (hasPrevious ? 1 : 0) + 1;
	const adjustedViewportHeight = totalViewportHeight - indicatorLines;

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
		if (key.name === "up") {
			const newIndex = Math.max(0, selectedSkillIndex - 1);
			if (newIndex < skillScrollOffset) setSkillScrollOffset(newIndex);
			setSelectedSkillIndex(newIndex);
			return;
		}
		if (key.name === "down") {
			const newIndex = Math.min(
				filteredSkills.length - 1,
				selectedSkillIndex + 1,
			);
			if (newIndex >= skillScrollOffset + adjustedViewportHeight) {
				setSkillScrollOffset(newIndex - adjustedViewportHeight + 1);
			}
			setSelectedSkillIndex(newIndex);
			return;
		}
		if (key.name === "pageup") {
			const newIndex = Math.max(0, selectedSkillIndex - adjustedViewportHeight);
			setSkillScrollOffset(Math.max(0, newIndex));
			setSelectedSkillIndex(newIndex);
			return;
		}
		if (key.name === "pagedown") {
			const newIndex = Math.min(
				filteredSkills.length - 1,
				selectedSkillIndex + adjustedViewportHeight,
			);
			const maxOffset = Math.max(
				0,
				filteredSkills.length - adjustedViewportHeight,
			);
			setSkillScrollOffset(Math.min(maxOffset, newIndex));
			setSelectedSkillIndex(newIndex);
			return;
		}
		if (key.name === "home") {
			setSelectedSkillIndex(0);
			setSkillScrollOffset(0);
			return;
		}
		if (key.name === "end") {
			const lastIndex = filteredSkills.length - 1;
			setSelectedSkillIndex(lastIndex);
			setSkillScrollOffset(
				Math.max(0, filteredSkills.length - adjustedViewportHeight),
			);
			return;
		}
		if (key.name === "space") {
			const skill = filteredSkills[selectedSkillIndex];
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
					} catch (err) {
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
		setSelectedSkillIndex(0);
		setSkillScrollOffset(0);
	}, [searchFilter]);

	const visibleSkills = filteredSkills.slice(
		skillScrollOffset,
		skillScrollOffset + adjustedViewportHeight,
	);
	const hasMore =
		skillScrollOffset + adjustedViewportHeight < filteredSkills.length;

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
								runSilently(buildArgs("add", repo));
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
				<box
					flexDirection="column"
					width={40}
					flexGrow={1}
					border
					borderStyle={focusedColumn === "skills" ? "double" : "rounded"}
					borderColor={
						focusedColumn === "skills" ? theme.lavender : theme.surface2
					}
					padding={1}
					overflow="hidden"
					title=" Skills (Space to select) "
				>
					{loadingSkills ? (
						<text fg={theme.overlay1}>Loading skills...</text>
					) : filteredSkills.length > 0 ? (
						<>
							{hasPrevious && (
								<box paddingLeft={1} marginBottom={1}>
									<text fg={theme.overlay1}>
										{"\u2191"} {skillScrollOffset} more above
									</text>
								</box>
							)}
							<box
								flexDirection="column"
								gap={0}
								overflow="hidden"
								flexGrow={1}
							>
								{visibleSkills.map((skill, visibleIndex) => {
									const idx = skillScrollOffset + visibleIndex;
									const isHighlighted = idx === selectedSkillIndex;
									const isSelected = selectedSkills.has(skill);
									const checkbox = isSelected ? "[\u2713] " : "[ ] ";
									const displayName = truncateText(skill, 31);
									return (
										<box
											key={skill}
											paddingLeft={1}
											backgroundColor={
												isHighlighted ? theme.surface1 : "transparent"
											}
										>
											<text
												fg={
													isSelected
														? theme.green
														: isHighlighted
															? theme.yellow
															: theme.subtext1
												}
												attributes={
													isHighlighted ? TextAttributes.BOLD : undefined
												}
											>
												{checkbox}
												{displayName}
											</text>
										</box>
									);
								})}
							</box>
							{hasMore && (
								<box paddingLeft={1}>
									<text fg={theme.overlay1}>
										{"\u2193"}{" "}
										{filteredSkills.length -
											skillScrollOffset -
											adjustedViewportHeight}{" "}
										more below
									</text>
								</box>
							)}
						</>
					) : searchFilter ? (
						<text fg={theme.overlay1}>No skills match filter</text>
					) : (
						<text fg={theme.overlay1}>No skills available</text>
					)}
				</box>
			)}
		</>
	);
}
