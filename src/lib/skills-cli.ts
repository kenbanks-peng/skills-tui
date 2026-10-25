// All skills CLI invocations go through this module. Skills TUI supplies explicit
// repositories and skill names; selection state belongs to Skills TUI config.
import { collectStream, spawn } from "#lib/compat";
import { ensureOpencode, getRunner, logCmd } from "#lib/utils";

function base(...rest: string[]): string[] {
	return [getRunner(), "skills", ...rest];
}
export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}
async function run(args: string[]): Promise<RunResult> {
	logCmd("run", args);
	const proc = spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	const [stdout, stderr, code] = await Promise.all([
		collectStream(proc.stdout),
		collectStream(proc.stderr),
		proc.exited,
	]);
	logCmd("done", args, code, stdout, stderr);
	return { code, stdout, stderr };
}
export function inspectRepoSkills(repo: string): Promise<RunResult> {
	return run(base("add", repo, "--list", "--full-depth"));
}
export async function listRepoSkills(repo: string): Promise<string> {
	const result = await inspectRepoSkills(repo);
	if (result.code !== 0) throw new Error(result.stderr || result.stdout);
	return result.stdout;
}
export function addArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill: string,
): string[] {
	return base(
		"add",
		...(isGlobal ? ["-g"] : []),
		"--full-depth",
		"--skill",
		skill,
		"--agent",
		...ensureOpencode(agents),
		"-y",
		repo,
	);
}
export function addSkill(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill: string,
): Promise<RunResult> {
	return run(addArgs(isGlobal, agents, repo, skill));
}
export function findArgs(isGlobal: boolean, query: string): string[] {
	return base("find", ...(isGlobal ? ["-g"] : []), query);
}
