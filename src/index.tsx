import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDirectories, loadAgents, loadRepos } from "#lib/config";
import { reconcileDeployedSkills } from "#lib/reconcile-deployed-skills";
import { reconcileSkillLinks } from "#lib/reconcile-skill-links";
import { App } from "./App";

ensureDirectories();
const [agents, repos] = await Promise.all([loadAgents(), loadRepos()]);
const deployedReconciliation = reconcileDeployedSkills(repos);
for (const { path, error } of deployedReconciliation.errors) {
  console.warn(`Could not reconcile deployed skills at ${path}:`, error);
}
const linkReconciliation = reconcileSkillLinks(agents);
for (const { path, error } of linkReconciliation.errors) {
  console.warn(`Could not check skill links at ${path}:`, error);
}
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
