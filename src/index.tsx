import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDirectories } from "#lib/config";
import { synchronizeConfiguredSkills } from "#lib/configured-skills";
import { App } from "./App";

ensureDirectories();
try {
	const result = await synchronizeConfiguredSkills({ refresh: true });
	for (const { path, error } of result.errors) {
		console.warn(`Could not synchronize skills at ${path}:`, error);
	}
} catch (error) {
	console.warn(
		"Could not synchronize skills; existing content is unchanged where checks failed:",
		error,
	);
}
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
