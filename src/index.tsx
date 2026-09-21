import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDirectories, loadAgents } from "#lib/config";
import { reconcileSkillLinks } from "#lib/reconcile-skill-links";
import { App } from "./App";

ensureDirectories();
const reconciliation = reconcileSkillLinks(await loadAgents());
for (const { path, error } of reconciliation.errors) {
  console.warn(`Could not check skill links at ${path}:`, error);
}
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
