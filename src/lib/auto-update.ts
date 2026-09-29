import { type RunResult, updateSkills } from "#lib/skills-cli";

export type UpdateScope = "User Scope" | "Project Scope";

export interface UpdateFailure {
	scope: UpdateScope;
	error: unknown;
}

type Update = (isGlobal: boolean) => Promise<RunResult>;

// Skills TUI follows the latest upstream revision. Update both install scopes
// before the interface opens so every agent link sees the refreshed canonical
// skill copy. A failure in one scope must not prevent the other scope or the TUI.
export async function autoUpdateSkills(
	update: Update = updateSkills,
): Promise<UpdateFailure[]> {
	const failures: UpdateFailure[] = [];
	for (const [scope, isGlobal] of [
		["User Scope", true],
		["Project Scope", false],
	] as const) {
		try {
			const result = await update(isGlobal);
			if (result.code !== 0) {
				failures.push({ scope, error: result.stderr || result.stdout });
			}
		} catch (error) {
			failures.push({ scope, error });
		}
	}
	return failures;
}
