# Skills TUI

Skills TUI helps users inspect, compare, and manage agent skills across repositories, filesystem locations, and agent sessions.

## Language

**User**:
A person who configures Skills TUI and owns user-scoped Skill Locations.
_Avoid_: Operator, developer

**Agent**:
A coding assistant or agent runtime that can discover, install, or activate Skills from its supported Skill Locations.
_Avoid_: User, client

**Agent Visibility**:
The relationship that an Installed Skill has to an Agent when that Agent can discover or load it from a supported Skill Location.
_Avoid_: Agent ownership, agent installation

**Agent Session**:
A single running interaction with an Agent in which a specific set of Skills may be active.
_Avoid_: User, Agent

**Skill**:
A named package of agent capability content, usually represented by a directory containing a `SKILL.md` definition and any supporting references or assets. A Skill name groups related Skill Instances, but does not collapse them into a single concrete copy.
_Avoid_: SKILL.md when referring to the whole package

**Skill Instance**:
A concrete occurrence of a Skill at a specific Skill Location, with its own content, provenance, install status, and active status.
_Avoid_: Skill when location-specific state matters

**Skill Location**:
A filesystem or repository place where skills can be found, installed, or loaded from. When the same Skill name appears in multiple locations, each location has a distinct Skill Instance; the active session instance is preferred for display, followed by installed instances, then repository instances.
_Avoid_: Skill source when install destinations are included, skill root when individual files are included

**Discoverable Skill**:
A skill that exists at a known Skill Location and can be found by Skills TUI.
_Avoid_: Available skill, installed skill when session availability is meant

**Install Scope**:
The visibility boundary of an Installed Skill: User Scope for user-wide installs, or Project Scope for repository-local installs.
_Avoid_: Local/global when domain meaning is needed

**Installed Skill**:
A skill that has been copied, linked, or otherwise placed into an agent-readable filesystem location for a User Scope or Project Scope.
_Avoid_: Discoverable skill, active skill

**Active Skill**:
A discoverable or installed Skill that an Agent has injected into a specific Agent Session and made available for use.
_Avoid_: Discoverable skill, installed skill
