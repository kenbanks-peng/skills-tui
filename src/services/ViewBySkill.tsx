import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import { theme } from "../theme";
import { parseInstalledSkills } from "../skills";
import type { InstalledSkillInfo } from "../skills";
import type { AgentConfig, UniversalAgents } from "../config";

interface ViewBySkillProps {
  focused: boolean;
  isGlobal: boolean;
  agents: AgentConfig[];
  selectedAgents: Set<string>;
  universalAgents: UniversalAgents;
  refreshKey: number;
  searchFilter: string;
}

export function ViewBySkill({ focused, isGlobal, agents, selectedAgents, universalAgents, refreshKey, searchFilter }: ViewBySkillProps) {
  const { height } = useTerminalDimensions();
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    if (agents.length > 0) {
      setLoading(true);
      setIndex(0);
      setScrollOffset(0);
      const agentNames = agents.filter(a => selectedAgents.has(a.name)).map(a => a.name);
      parseInstalledSkills(isGlobal, agentNames).then(skills => {
        setInstalledSkills(skills);
        setLoading(false);
      });
    }
  }, [isGlobal, selectedAgents, agents, refreshKey]);

  const lowerFilter = searchFilter.toLowerCase();
  const filteredSkills = searchFilter
    ? installedSkills.filter(s => s.name.toLowerCase().includes(lowerFilter))
    : installedSkills;

  // Reset index when filter changes
  useEffect(() => {
    setIndex(0);
    setScrollOffset(0);
  }, [searchFilter]);

  const baseVH = Math.max(3, height - 19);
  const hasPrevIndicator = scrollOffset > 0;
  const overflows = filteredSkills.length > baseVH;
  const indicatorLines = (hasPrevIndicator ? 1 : 0) + (overflows ? 1 : 0);
  const viewportHeight = Math.max(1, baseVH - indicatorLines);

  useKeyboard((key) => {
    if (!focused || filteredSkills.length === 0) return;
    if (key.name === "up") {
      const newIndex = Math.max(0, index - 1);
      if (newIndex < scrollOffset) setScrollOffset(newIndex);
      setIndex(newIndex);
      return;
    }
    if (key.name === "down") {
      const newIndex = Math.min(filteredSkills.length - 1, index + 1);
      if (newIndex >= scrollOffset + viewportHeight) {
        let newOffset = newIndex - viewportHeight + 1;
        if (newOffset > 0 && scrollOffset === 0) newOffset += 1;
        setScrollOffset(newOffset);
      }
      setIndex(newIndex);
      return;
    }
    if (key.name === "pageup") {
      const newIndex = Math.max(0, index - viewportHeight);
      setScrollOffset(Math.max(0, newIndex));
      setIndex(newIndex);
      return;
    }
    if (key.name === "pagedown") {
      const newIndex = Math.min(filteredSkills.length - 1, index + viewportHeight);
      const maxOffset = Math.max(0, filteredSkills.length - viewportHeight);
      setScrollOffset(Math.min(maxOffset, newIndex));
      setIndex(newIndex);
      return;
    }
    if (key.name === "home") {
      setIndex(0);
      setScrollOffset(0);
      return;
    }
    if (key.name === "end") {
      const lastIndex = filteredSkills.length - 1;
      setIndex(lastIndex);
      setScrollOffset(Math.max(0, filteredSkills.length - viewportHeight));
    }
  });

  const visibleAgents = agents.filter(a => selectedAgents.has(a.name));

  // Build display-name sets for universal agents (from config)
  const isUniversalAgent = (name: string) =>
    universalAgents.both.has(name) || universalAgents.local.has(name);
  const isUniversalGlobalAgent = (name: string) =>
    universalAgents.both.has(name);

  const universalDisplayNames = new Set(
    visibleAgents.filter(a => isUniversalAgent(a.name)).map(a => a.display)
  );
  const universalGlobalDisplayNames = new Set(
    visibleAgents.filter(a => isUniversalGlobalAgent(a.name)).map(a => a.display)
  );

  // Check if an agent has a skill linked (directly or via shared universal path)
  const isLinked = (skill: InstalledSkillInfo, agent: AgentConfig): boolean => {
    if (skill.agents.has(agent.display)) return true;

    // Universal agents share installed skills through .agents/skills paths
    if (isGlobal && isUniversalGlobalAgent(agent.name)) {
      // In global mode, agents supporting both paths share ~/.agents/skills
      for (const name of universalGlobalDisplayNames) {
        if (skill.agents.has(name)) return true;
      }
    } else if (!isGlobal && isUniversalAgent(agent.name)) {
      // In local mode, all universal agents share .agents/skills
      for (const name of universalDisplayNames) {
        if (skill.agents.has(name)) return true;
      }
    }
    return false;
  };

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle={focused ? "double" : "rounded"}
      borderColor={focused ? theme.lavender : theme.surface2}
      padding={1}
      title=" Installed "
    >
      {loading ? (
        <text fg={theme.overlay1}>Loading...</text>
      ) : filteredSkills.length === 0 ? (
        <text fg={theme.overlay1}>{searchFilter ? "No skills match filter" : "No skills installed"}</text>
      ) : (
        <box flexDirection="column" flexGrow={1}>
          {(() => {
            const nameColWidth = Math.max(12, ...filteredSkills.map(s => s.name.length)) + 2;
            const agentColWidth = Math.max(...visibleAgents.map(a => a.display.length), 6) + 2;
            const centerPad = (text: string, width: number) => {
              const pad = Math.max(0, width - text.length);
              const left = Math.floor(pad / 2);
              return " ".repeat(left) + text + " ".repeat(pad - left);
            };
            const totalRowWidth = nameColWidth + agentColWidth * visibleAgents.length;
            const header = "Skill".padEnd(nameColWidth) + visibleAgents.map(a => centerPad(a.display, agentColWidth)).join("");
            const separator = "\u2500".repeat(totalRowWidth);

            const hasPrevious = scrollOffset > 0;
            const visibleSkills = filteredSkills.slice(scrollOffset, scrollOffset + viewportHeight);
            const hasMore = scrollOffset + viewportHeight < filteredSkills.length;

            return (
              <>
                <box flexDirection="column" flexShrink={0}>
                  <text fg={theme.lavender} attributes={TextAttributes.BOLD}>{header}</text>
                  <text fg={theme.surface2}>{separator}</text>
                </box>
                {hasPrevious && (
                  <box height={1} flexShrink={0}>
                    <text fg={theme.overlay1}>  {"\u2191"} {scrollOffset} more above</text>
                  </box>
                )}
                <box flexDirection="column" height={viewportHeight} overflow="hidden">
                  {visibleSkills.map((skill, visibleIdx) => {
                    const idx = scrollOffset + visibleIdx;
                    const isHighlighted = focused && idx === index;
                    return (
                      <box
                        key={skill.name}
                        width={totalRowWidth}
                        backgroundColor={isHighlighted ? theme.surface1 : "transparent"}
                      >
                        <text>
                          <span fg={isHighlighted ? theme.yellow : theme.text} attributes={isHighlighted ? TextAttributes.BOLD : undefined}>
                            {skill.name.padEnd(nameColWidth)}
                          </span>
                          {visibleAgents.map(a => {
                            const linked = isLinked(skill, a);
                            return (
                              <span key={a.name} fg={linked ? theme.green : theme.overlay0}>
                                {centerPad(linked ? "\u2713" : "\u00b7", agentColWidth)}
                              </span>
                            );
                          })}
                        </text>
                      </box>
                    );
                  })}
                </box>
                {hasMore && (
                  <box height={1} flexShrink={0}>
                    <text fg={theme.overlay1}>  {"\u2193"} {filteredSkills.length - scrollOffset - viewportHeight} more below</text>
                  </box>
                )}
              </>
            );
          })()}
        </box>
      )}
    </box>
  );
}
