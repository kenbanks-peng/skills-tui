// Centralized CLI interface for the skills CLI.
// Every invocation of `bunx skills` / `npx skills` goes through here.

import { collectStream, spawn } from "./compat";
import { ensureOpencode, getRunner, logCmd } from "./utils";

function base(...rest: string[]): string[] {
	return [getRunner(), "skills", ...rest];
}

interface RunResult {
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

// --- Executed commands (run and return results) ---

export async function listSkills(
	isGlobal: boolean,
	agents: Iterable<string>,
): Promise<string> {
	const args = base("list");
	if (isGlobal) args.push("-g");
	args.push("--agent", ...ensureOpencode(agents));
	const { stdout } = await run(args);
	return stdout;
}

export async function listRepoSkills(repo: string): Promise<string> {
	const { stdout } = await run(base("add", repo, "--list"));
	return stdout;
}

export async function addSkill(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill?: string,
): Promise<RunResult> {
	const args = base("add");
	if (isGlobal) args.push("-g");
	if (skill) args.push("--skill", skill);
	args.push("--agent", ...ensureOpencode(agents));
	args.push("-y", repo);
	return run(args);
}

export async function removeSkill(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill?: string,
): Promise<RunResult> {
	const args = base("remove");
	if (isGlobal) args.push("-g");
	if (skill) args.push("--skill", skill);
	args.push("--agent", ...ensureOpencode(agents));
	args.push("-y", repo);
	return run(args);
}

// --- Args for CommandOutput (streaming needed) ---

export function checkArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
): string[] {
	const args = base("check");
	if (isGlobal) args.push("-g");
	args.push("--agent", ...ensureOpencode(agents));
	return args;
}

export function updateArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
): string[] {
	const args = base("update");
	if (isGlobal) args.push("-g");
	args.push("--agent", ...ensureOpencode(agents));
	args.push("-y");
	return args;
}

export function findArgs(isGlobal: boolean, query: string): string[] {
	return base("find", ...(isGlobal ? ["-g"] : []), query);
}
