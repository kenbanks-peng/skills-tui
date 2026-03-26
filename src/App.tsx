import { TextAttributes } from "@opentui/core";
import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import { useEffect, useState } from "react";
import { Footer } from "./components/Footer";
import { SearchFilter } from "./components/SearchFilter";
import { ServicesPanel } from "./components/ServicesPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import type { AgentConfig, RepoSource, UniversalAgents } from "./lib/config";
import {
	loadAgents,
	loadDisabledAgents,
	loadRepos,
	loadUniversalAgents,
	saveDisabledAgents,
} from "./lib/config";
import { checkArgs, updateArgs } from "./lib/skills-cli";
import { theme } from "./lib/theme";
import { ServiceId, services } from "./services";
import { CommandService } from "./services/CommandService";
import { Find } from "./services/Find";
import { ViewByRepo } from "./services/ViewByRepo";
import { ViewBySkill } from "./services/ViewBySkill";

type FocusedColumn =
	| "services"
	| "search"
	| "settings"
	| "content"
	| "content2";

export function App() {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();

	const [repos, setRepos] = useState<RepoSource[]>([]);
	const [selectedServiceId, setSelectedServiceId] = useState<ServiceId>(
		ServiceId.VIEW_BY_REPO,
	);
	const [agents, setAgents] = useState<AgentConfig[]>([]);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
	const [universalAgents, setUniversalAgents] = useState<UniversalAgents>({
		both: new Set(),
		local: new Set(),
	});
	const [isGlobal, setIsGlobal] = useState(true);
	const [activeSettingIndex, setActiveSettingIndex] = useState(0);
	const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>("services");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [searchFilter, setSearchFilter] = useState("");

	// Load repos, agents, universal config, and disabled state on mount
	useEffect(() => {
		Promise.all([loadAgents(), loadDisabledAgents()]).then(
			([agentList, disabled]) => {
				setAgents(agentList);
				setSelectedAgents(
					new Set(
						agentList.filter((a) => !disabled.has(a.name)).map((a) => a.name),
					),
				);
			},
		);
		loadRepos().then(setRepos);
		loadUniversalAgents().then(setUniversalAgents);
	}, []);

	const hasContent2 =
		selectedServiceId === ServiceId.VIEW_BY_REPO ||
		selectedServiceId === ServiceId.FIND;
	const showSearch =
		selectedServiceId === ServiceId.VIEW_BY_REPO ||
		selectedServiceId === ServiceId.VIEW_BY_SKILL;

	const navigateForward = () => {
		setFocusedColumn((prev: FocusedColumn) => {
			if (prev === "services") return "content";
			if (prev === "content" && hasContent2) return "content2";
			if (prev === "content") return showSearch ? "search" : "settings";
			if (prev === "content2") return showSearch ? "search" : "settings";
			if (prev === "search") return "settings";
			if (prev === "settings") return "services";
			return "services";
		});
	};

	const navigateBackward = () => {
		setFocusedColumn((prev: FocusedColumn) => {
			if (prev === "services") return "settings";
			if (prev === "settings")
				return showSearch ? "search" : hasContent2 ? "content2" : "content";
			if (prev === "search") return hasContent2 ? "content2" : "content";
			if (prev === "content2") return "content";
			if (prev === "content") return "services";
			return "services";
		});
	};

	useKeyboard((key) => {
		// Search field: capture typing, allow tab/arrow navigation
		if (focusedColumn === "search") {
			if (key.name === "tab" && !key.shift) {
				navigateForward();
				return;
			}
			if (key.name === "tab" && key.shift) {
				navigateBackward();
				return;
			}
			if (key.name === "right") {
				navigateForward();
				return;
			}
			if (key.name === "left") {
				navigateBackward();
				return;
			}
			if (key.name === "escape") {
				if (searchFilter) setSearchFilter("");
				else renderer.destroy();
				return;
			}
			if (key.ctrl && key.name === "c") {
				renderer.destroy();
				return;
			}
			if (key.name === "backspace") {
				setSearchFilter((prev: string) => prev.slice(0, -1));
				return;
			}
			if (
				key.sequence &&
				key.sequence.length === 1 &&
				!key.ctrl &&
				!key.meta &&
				key.sequence.charCodeAt(0) >= 32
			) {
				setSearchFilter((prev: string) => prev + key.sequence);
				return;
			}
			return;
		}

		if ((key.name === "tab" && !key.shift) || key.name === "right") {
			navigateForward();
			return;
		}
		if ((key.name === "tab" && key.shift) || key.name === "left") {
			navigateBackward();
			return;
		}

		// Find panel handles its own keys
		if (focusedColumn === "content" && selectedServiceId === ServiceId.FIND)
			return;

		// Output panels handle escape themselves
		if (
			focusedColumn === "content" &&
			(selectedServiceId === ServiceId.CHECK ||
				selectedServiceId === ServiceId.UPDATE)
		) {
			if (key.name === "escape") renderer.destroy();
			return;
		}
		if (focusedColumn === "content2" && selectedServiceId === ServiceId.FIND) {
			if (key.name === "escape") renderer.destroy();
			return;
		}

		if (key.name === "escape" || (key.ctrl && key.name === "c")) {
			renderer.destroy();
			return;
		}

		if (focusedColumn === "services" && key.name === "g") {
			setIsGlobal((prev: boolean) => !prev);
			return;
		}
	});

	const col1Width = 28;
	const minWidth = 80;
	const minHeight = 20;

	if (width < minWidth || height < minHeight) {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				backgroundColor={theme.base}
				justifyContent="center"
				alignItems="center"
			>
				<ascii-font font="tiny" text="Skills" color={theme.mauve} />
				<text fg={theme.overlay1}>
					Terminal too small (min {minWidth}x{minHeight})
				</text>
			</box>
		);
	}

	const serviceSelectHeight = services.length || 10;

	const contentFocus = focusedColumn === "content";
	const content2Focus = focusedColumn === "content2";

	// Map service focus to the sub-column names each service expects
	const repoFocusedColumn = contentFocus
		? ("repos" as const)
		: content2Focus
			? ("skills" as const)
			: null;
	const findFocusedColumn = contentFocus
		? ("find" as const)
		: content2Focus
			? ("output" as const)
			: null;

	return (
		<box flexDirection="column" flexGrow={1} backgroundColor={theme.base}>
			<box paddingTop={1} />

			<box
				flexDirection="row"
				flexGrow={1}
				gap={1}
				paddingTop={1}
				paddingBottom={1}
				paddingRight={1}
			>
				{/* Column 1: Services + Settings */}
				<box flexDirection="column" width={col1Width}>
					<ServicesPanel
						focused={focusedColumn === "services"}
						services={services}
						selectedServiceId={selectedServiceId}
						serviceSelectHeight={serviceSelectHeight}
						onServiceChange={(svc) => setSelectedServiceId(svc.id)}
						onServiceSelect={(svc) => {
							setSelectedServiceId(svc.id);
							setFocusedColumn("content");
						}}
					/>

					<SettingsPanel
						focused={focusedColumn === "settings"}
						isGlobal={isGlobal}
						agents={agents}
						selectedAgents={selectedAgents}
						activeSettingIndex={activeSettingIndex}
						onToggleGlobal={() => setIsGlobal((prev: boolean) => !prev)}
						onToggleAgent={(agent) => {
							setSelectedAgents((prev: Set<string>) => {
								const newSet = new Set(prev);
								if (newSet.has(agent)) newSet.delete(agent);
								else newSet.add(agent);
								const disabled = new Set(
									agents
										.filter((a: AgentConfig) => !newSet.has(a.name))
										.map((a: AgentConfig) => a.name),
								);
								saveDisabledAgents(disabled);
								return newSet;
							});
						}}
						onActiveIndexChange={setActiveSettingIndex}
					/>
				</box>

				{/* Content area with optional search */}
				<box flexDirection="column" flexGrow={1}>
					<box flexDirection="row" flexGrow={1} gap={1}>
						{selectedServiceId === ServiceId.VIEW_BY_SKILL && (
							<ViewBySkill
								focused={contentFocus}
								isGlobal={isGlobal}
								agents={agents}
								selectedAgents={selectedAgents}
								universalAgents={universalAgents}
								refreshKey={refreshKey}
								searchFilter={searchFilter}
							/>
						)}

						{selectedServiceId === ServiceId.VIEW_BY_REPO && (
							<ViewByRepo
								focusedColumn={repoFocusedColumn}
								repos={repos}
								isGlobal={isGlobal}
								agents={agents}
								selectedAgents={selectedAgents}
								onFocusSkills={() => setFocusedColumn("content2")}
								onInstallComplete={() => setRefreshKey((k) => k + 1)}
								onError={(msg) => {
									setErrorMessage(msg);
									setTimeout(() => setErrorMessage(null), 5000);
								}}
								searchFilter={searchFilter}
							/>
						)}

						{selectedServiceId === ServiceId.FIND && (
							<Find
								focusedColumn={findFocusedColumn}
								isGlobal={isGlobal}
								onFocusOutput={() => setFocusedColumn("content2")}
								onBack={() => setFocusedColumn("content")}
								onEscape={() => setFocusedColumn("services")}
								onExit={() => renderer.destroy()}
							/>
						)}

						{selectedServiceId === ServiceId.CHECK && (
							<CommandService
								focused={contentFocus}
								argsBuilder={() => checkArgs(isGlobal, selectedAgents)}
								onBack={() => setFocusedColumn("services")}
							/>
						)}

						{selectedServiceId === ServiceId.UPDATE && (
							<CommandService
								focused={contentFocus}
								argsBuilder={() => updateArgs(isGlobal, selectedAgents)}
								onBack={() => setFocusedColumn("services")}
							/>
						)}
					</box>

					{showSearch && (
						<SearchFilter
							focused={focusedColumn === "search"}
							searchFilter={searchFilter}
						/>
					)}
				</box>
			</box>

			{/* Error notification */}
			{errorMessage && (
				<box paddingLeft={2} paddingRight={2}>
					<text fg={theme.red} attributes={TextAttributes.BOLD}>
						{errorMessage}
					</text>
				</box>
			)}

			<Footer
				focusedColumn={focusedColumn}
				selectedServiceId={selectedServiceId}
			/>
		</box>
	);
}
