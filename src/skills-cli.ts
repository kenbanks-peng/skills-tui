// Centralized CLI command builders for the skills CLI.
// Every invocation of `bunx skills` / `npx skills` goes through here.

import { ensureOpencode,getRunner } from "./utils";

function base(...rest: string[]): string[] {
	return [getRunner(), "skills", ...rest];
}

export function listArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
): string[] {
	const args = base("list");
	if (isGlobal) args.push("-g");
	args.push("--agent", ...ensureOpencode(agents));
	return args;
}

export function addListArgs(repo: string): string[] {
	return base("add", repo, "--list");
}

export function addArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill?: string,
): string[] {
	const args = base("add");
	if (isGlobal) args.push("-g");
	if (skill) args.push("--skill", skill);
	args.push("--agent", ...ensureOpencode(agents));
	args.push("-y", repo);
	return args;
}

export function removeArgs(
	isGlobal: boolean,
	agents: Iterable<string>,
	repo: string,
	skill?: string,
): string[] {
	const args = base("remove");
	if (isGlobal) args.push("-g");
	if (skill) args.push("--skill", skill);
	args.push("--agent", ...ensureOpencode(agents));
	args.push("-y", repo);
	return args;
}

export function checkCmd(isGlobal: boolean, agents: Iterable<string>): string {
	return base(
		"check",
		...(isGlobal ? ["-g"] : []),
		"--agent",
		...ensureOpencode(agents),
	).join(" ");
}

export function updateCmd(isGlobal: boolean, agents: Iterable<string>): string {
	return base(
		"update",
		...(isGlobal ? ["-g"] : []),
		"--agent",
		...ensureOpencode(agents),
		"-y",
	).join(" ");
}

export function findCmd(isGlobal: boolean, query: string): string {
	return base("find", ...(isGlobal ? ["-g"] : []), query).join(" ");
}
