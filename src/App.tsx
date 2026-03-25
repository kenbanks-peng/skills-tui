import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import { theme } from "./theme";
import { services, SERVICE_VIEW_BY_SKILL, SERVICE_VIEW_BY_REPO, SERVICE_FIND, SERVICE_CHECK, SERVICE_UPDATE } from "./services";
import { loadAgents, loadRepos, loadUniversalAgents, loadDisabledAgents, saveDisabledAgents } from "./config";
import type { AgentConfig, UniversalAgents, RepoSource } from "./config";
import { ServicesPanel } from "./ServicesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ViewBySkill } from "./services/ViewBySkill";
import { ViewByRepo } from "./services/ViewByRepo";
import { Find } from "./services/Find";
import { Check } from "./services/Check";
import { Update } from "./services/Update";

type FocusedColumn = "services" | "search" | "settings" | "content" | "content2";

export function App() {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();

  const [repos, setRepos] = useState<RepoSource[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<number>(SERVICE_VIEW_BY_REPO);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [universalAgents, setUniversalAgents] = useState<UniversalAgents>({ both: new Set(), local: new Set() });
  const [isGlobal, setIsGlobal] = useState(true);
  const [activeSettingIndex, setActiveSettingIndex] = useState(0);
  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>("services");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchFilter, setSearchFilter] = useState("");

  // Load repos, agents, universal config, and disabled state on mount
  useEffect(() => {
    Promise.all([loadAgents(), loadDisabledAgents()]).then(([agentList, disabled]) => {
      setAgents(agentList);
      setSelectedAgents(new Set(agentList.filter(a => !disabled.has(a.name)).map(a => a.name)));
    });
    loadRepos().then(setRepos);
    loadUniversalAgents().then(setUniversalAgents);
  }, []);

  const hasContent2 = selectedServiceId === SERVICE_VIEW_BY_REPO || selectedServiceId === SERVICE_FIND;
  const showSearch = selectedServiceId === SERVICE_VIEW_BY_REPO || selectedServiceId === SERVICE_VIEW_BY_SKILL;

  const navigateForward = () => {
    setFocusedColumn(prev => {
      if (prev === "services") return showSearch ? "search" : "content";
      if (prev === "search") return "content";
      if (prev === "content" && hasContent2) return "content2";
      if (prev === "content") return "settings";
      if (prev === "content2") return "settings";
      if (prev === "settings") return "services";
      return "services";
    });
  };

  const navigateBackward = () => {
    setFocusedColumn(prev => {
      if (prev === "services") return "settings";
      if (prev === "settings") {
        if (hasContent2) return "content2";
        return "content";
      }
      if (prev === "content2") return "content";
      if (prev === "content") return showSearch ? "search" : "services";
      if (prev === "search") return "services";
      return "services";
    });
  };

  useKeyboard((key) => {
    // Search field: capture typing, allow tab/arrow navigation
    if (focusedColumn === "search") {
      if (key.name === "tab" && !key.shift) { navigateForward(); return; }
      if (key.name === "tab" && key.shift) { navigateBackward(); return; }
      if (key.name === "right") { navigateForward(); return; }
      if (key.name === "left") { navigateBackward(); return; }
      if (key.name === "escape") {
        if (searchFilter) setSearchFilter("");
        else renderer.destroy();
        return;
      }
      if (key.ctrl && key.name === "c") { renderer.destroy(); return; }
      if (key.name === "backspace") { setSearchFilter(prev => prev.slice(0, -1)); return; }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence.charCodeAt(0) >= 32) {
        setSearchFilter(prev => prev + key.sequence);
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
    if (focusedColumn === "content" && selectedServiceId === SERVICE_FIND) return;

    // Output panels handle escape themselves
    if (focusedColumn === "content" && (selectedServiceId === SERVICE_CHECK || selectedServiceId === SERVICE_UPDATE)) {
      if (key.name === "escape") renderer.destroy();
      return;
    }
    if (focusedColumn === "content2" && selectedServiceId === SERVICE_FIND) {
      if (key.name === "escape") renderer.destroy();
      return;
    }

    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      return;
    }

    if (focusedColumn === "services" && key.name === "g") {
      setIsGlobal(prev => !prev);
      return;
    }
  });

  const col1Width = 28;
  const minWidth = 80;
  const minHeight = 20;

  if (width < minWidth || height < minHeight) {
    return (
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.base} justifyContent="center" alignItems="center">
        <ascii-font font="tiny" text="Skills" color={theme.mauve} />
        <text fg={theme.overlay1}>Terminal too small (min {minWidth}x{minHeight})</text>
      </box>
    );
  }

  const serviceSelectHeight = services.length || 10;

  const contentFocus = focusedColumn === "content";
  const content2Focus = focusedColumn === "content2";

  // Map service focus to the sub-column names each service expects
  const repoFocusedColumn = contentFocus ? "repos" as const : content2Focus ? "skills" as const : null;
  const findFocusedColumn = contentFocus ? "find" as const : content2Focus ? "output" as const : null;

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.base}>
      <box paddingTop={1} />

      <box flexDirection="row" flexGrow={1} gap={1} paddingTop={1} paddingBottom={1} paddingRight={1}>
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
              if (svc.id === SERVICE_VIEW_BY_SKILL || svc.id === SERVICE_VIEW_BY_REPO || svc.id === SERVICE_FIND || svc.id === SERVICE_CHECK || svc.id === SERVICE_UPDATE) {
                setFocusedColumn("content");
              }
            }}
          />

          <SettingsPanel
            focused={focusedColumn === "settings"}
            isGlobal={isGlobal}
            agents={agents}
            selectedAgents={selectedAgents}
            activeSettingIndex={activeSettingIndex}
            onToggleGlobal={() => setIsGlobal(prev => !prev)}
            onToggleAgent={(agent) => {
              setSelectedAgents(prev => {
                const newSet = new Set(prev);
                if (newSet.has(agent)) newSet.delete(agent);
                else newSet.add(agent);
                const disabled = new Set(agents.filter(a => !newSet.has(a.name)).map(a => a.name));
                saveDisabledAgents(disabled);
                return newSet;
              });
            }}
            onActiveIndexChange={setActiveSettingIndex}
          />
        </box>

        {/* Content area with optional search */}
        <box flexDirection="column" flexGrow={1}>
          {showSearch && (
            <box
              border
              borderStyle={focusedColumn === "search" ? "double" : "rounded"}
              borderColor={focusedColumn === "search" ? theme.lavender : theme.surface2}
              paddingLeft={1}
              paddingRight={1}
              height={3}
              flexShrink={0}
              title=" Filter "
            >
              <box flexDirection="row">
                <text fg={theme.overlay1}>{"\u203a "}</text>
                {searchFilter ? (
                  <text fg={theme.text}>{searchFilter}</text>
                ) : focusedColumn !== "search" ? (
                  <text fg={theme.overlay0}>Type to filter skills...</text>
                ) : null}
                {focusedColumn === "search" && (
                  <text fg={theme.lavender} attributes={TextAttributes.BOLD}>{"\u258e"}</text>
                )}
              </box>
            </box>
          )}

          <box flexDirection="row" flexGrow={1} gap={1}>
            {selectedServiceId === SERVICE_VIEW_BY_SKILL && (
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

            {selectedServiceId === SERVICE_VIEW_BY_REPO && (
              <ViewByRepo
                focusedColumn={repoFocusedColumn}
                repos={repos}
                isGlobal={isGlobal}
                agents={agents}
                selectedAgents={selectedAgents}
                onFocusSkills={() => setFocusedColumn("content2")}
                onInstallComplete={() => setRefreshKey(k => k + 1)}
                onError={(msg) => {
                  setErrorMessage(msg);
                  setTimeout(() => setErrorMessage(null), 5000);
                }}
                searchFilter={searchFilter}
              />
            )}

            {selectedServiceId === SERVICE_FIND && (
              <Find
                focusedColumn={findFocusedColumn}
                isGlobal={isGlobal}
                onFocusOutput={() => setFocusedColumn("content2")}
                onBack={() => setFocusedColumn("content")}
                onEscape={() => setFocusedColumn("services")}
                onExit={() => renderer.destroy()}
              />
            )}

            {selectedServiceId === SERVICE_CHECK && (
              <Check
                focused={contentFocus}
                isGlobal={isGlobal}
                selectedAgents={selectedAgents}
                onBack={() => setFocusedColumn("services")}
              />
            )}

            {selectedServiceId === SERVICE_UPDATE && (
              <Update
                focused={contentFocus}
                isGlobal={isGlobal}
                selectedAgents={selectedAgents}
                onBack={() => setFocusedColumn("services")}
              />
            )}
          </box>
        </box>
      </box>

      {/* Error notification */}
      {errorMessage && (
        <box paddingLeft={2} paddingRight={2}>
          <text fg={theme.red} attributes={TextAttributes.BOLD}>{errorMessage}</text>
        </box>
      )}

      {/* Footer */}
      <box paddingLeft={1} paddingRight={1} borderStyle="single" borderColor={theme.surface1} flexDirection="row" alignItems="center" justifyContent="space-between">
        <box flexDirection="column">
          <ascii-font font="tiny" text="Skills" color={theme.mauve} />
          <text>
            <span fg={theme.green}>{"   \u23bc\u23bc\u22b0"}</span><span fg={theme.red}>{"\u2985@"}</span>
          </text>
        </box>
        <text fg={theme.subtext0}>
          <span fg={theme.sapphire}>{"\u2190/\u2192"}</span><span fg={theme.overlay1}> or </span><span fg={theme.sapphire}>Tab</span><span fg={theme.overlay1}>: Switch  </span>
          <span fg={theme.sapphire}>{"\u2191/\u2193"}</span><span fg={theme.overlay1}>: Navigate  </span>
          {focusedColumn === "content2" && selectedServiceId === SERVICE_VIEW_BY_REPO ? (
            <>
              <span fg={theme.sapphire}>PgUp/PgDn</span><span fg={theme.overlay1}>: Jump  </span>
              <span fg={theme.sapphire}>Space</span><span fg={theme.overlay1}>: Toggle  </span>
              <span fg={theme.sapphire}>Enter</span><span fg={theme.overlay1}>: Install  </span>
            </>
          ) : (
            <>
              <span fg={theme.sapphire}>Enter</span><span fg={theme.overlay1}>: Select  </span>
              <span fg={theme.sapphire}>Space</span><span fg={theme.overlay1}>: Toggle  </span>
            </>
          )}
          <span fg={theme.sapphire}>Esc</span><span fg={theme.overlay1}>: Exit</span>
        </text>
      </box>
    </box>
  );
}
