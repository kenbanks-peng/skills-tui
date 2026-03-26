import { appendFileSync } from "node:fs";
import { spawnSync } from "./compat";

const logPath = "/tmp/skills-tui.log";

// Resolve the package runner: prefer bunx, fall back to npx.
let _runner: string | undefined;
export function getRunner(): string {
	if (_runner) return _runner;
	try {
		const result = spawnSync(["which", "bunx"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode === 0) {
			_runner = "bunx";
			return _runner;
		}
	} catch {}
	_runner = "npx";
	return _runner;
}

export function logCmd(
	label: string,
	args: string[],
	exitCode?: number,
	stdout?: string,
	stderr?: string,
) {
	const ts = new Date().toISOString();
	let msg = `[${ts}] ${label}: ${args.join(" ")}`;
	if (exitCode !== undefined) msg += `\n  exit=${exitCode}`;
	if (stdout) msg += `\n  stdout: ${stdout.slice(0, 2000)}`;
	if (stderr) msg += `\n  stderr: ${stderr.slice(0, 2000)}`;
	appendFileSync(logPath, `${msg}\n\n`);
}

// Ensure "opencode" is always in the agent list passed to the skills CLI.
// opencode uses the standard .agents/skills path, so including it guarantees
// the skills CLI writes to .agents/ (the universal location).
export function ensureOpencode(agents: Iterable<string>): string[] {
	const list = Array.from(agents);
	if (!list.includes("opencode")) list.push("opencode");
	return list;
}

// Check if a repo URL is a local file:// path
export function isFileRepo(url: string): boolean {
	return url.startsWith("file://");
}

// Convert file:// URL to a filesystem path
export function fileUrlToPath(url: string): string {
	return url.replace(/^file:\/\//, "");
}

// Display name for a repo: file:// URLs become "local: last/two/segments"
export function repoDisplayName(repo: string): string {
	if (!isFileRepo(repo)) return repo;
	const parts = fileUrlToPath(repo).replace(/\/+$/, "").split("/");
	return `local: ${parts.slice(-2).join("/")}`;
}

export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

export function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control characters
	return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

export function viewportHeight(
	termHeight: number,
	reservedLines: number,
	minHeight = 3,
): number {
	return Math.max(minHeight, termHeight - reservedLines);
}
