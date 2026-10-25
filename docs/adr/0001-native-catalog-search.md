# ADR-0001: Native skills.sh search and explicit installation

Status: Accepted

## Decision

Use the same public backend as [skills find](https://github.com/vercel-labs/skills/blob/main/src/find.ts):
`GET https://skills.sh/api/search?q=...&limit=20`. Honor `SKILLS_API_URL` when
an alternate backend is needed. The Rust HTTP client encodes queries, checks
HTTP status and JSON, limits response size, and applies connection and request
timeouts. Search does not send installation telemetry.

Keep search separate from the serialized installation manager. Requests run in
background threads. Canceling or replacing a search drops its reply receiver,
so late results cannot replace a newer search. HTTP work already in progress
ends at completion or the request timeout; cancellation does not abort its socket.

Show structured results, install counts, repository identity, Install Scope,
and saved selection status instead of raw subprocess output. Do not run a
JavaScript runtime or the external skills CLI.

Treat catalog data as untrusted. Only safe Skill names and GitHub repository
identifiers can become install actions. The manager checks repository content
before saving the Skill Selection. An absent or invalid Skill must not change
config, selections, or installed content.

An explicit Find install can add its repository to config. Preserve config
comments and settings. This is different from routine synchronization, which
must not rewrite config. Skill Selections remain in the separate state file.
Repeated installation of a selected Skill must not remove it.

View by skill is a read-only table of Installed Skills and Agent Visibility,
not an install/remove interface.

## Consequences

The catalog requires network access, but opening and navigating the TUI do not
wait for search. Failed searches are distinct from empty results. Repository
checks and deployment retain the existing Git, filesystem safety, Install
Scope, and Agent Visibility rules.
