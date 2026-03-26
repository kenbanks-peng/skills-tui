// Cross-runtime compatibility layer (Node.js + Bun)
// Uses only Node.js standard APIs, which Bun also supports.

import { spawn as cpSpawn, spawnSync as cpSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { parse as parseToml } from "smol-toml";

export { existsSync, parseToml };

export interface ProcessHandle {
	stdout: NodeJS.ReadableStream | null;
	stderr: NodeJS.ReadableStream | null;
	stdin: NodeJS.WritableStream | null;
	kill(): void;
	exited: Promise<number>;
}

export function spawn(
	args: string[],
	opts?: {
		stdin?: "pipe" | "ignore";
		stdout?: "pipe" | "ignore";
		stderr?: "pipe" | "ignore";
		env?: Record<string, string | undefined>;
	},
): ProcessHandle {
	const [cmd, ...rest] = args;
	const proc = cpSpawn(cmd, rest, {
		stdio: [
			opts?.stdin ?? "ignore",
			opts?.stdout ?? "ignore",
			opts?.stderr ?? "ignore",
		],
		env: opts?.env as NodeJS.ProcessEnv,
	});

	return {
		stdout: proc.stdout,
		stderr: proc.stderr,
		stdin: proc.stdin,
		kill: () => proc.kill(),
		exited: new Promise<number>((resolve) => {
			proc.on("exit", (code) => resolve(code ?? 1));
		}),
	};
}

export function spawnSync(
	args: string[],
	opts?: { stdout?: "pipe"; stderr?: "pipe" },
): { exitCode: number } {
	const [cmd, ...rest] = args;
	const result = cpSpawnSync(cmd, rest, {
		stdio: [
			"ignore",
			opts?.stdout === "pipe" ? "pipe" : "ignore",
			opts?.stderr === "pipe" ? "pipe" : "ignore",
		],
	});
	return { exitCode: result.status ?? 1 };
}

export async function readTextFile(path: string): Promise<string | null> {
	try {
		if (!existsSync(path)) return null;
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}

export async function writeTextFile(
	path: string,
	content: string,
): Promise<void> {
	await writeFile(path, content, "utf-8");
}

export function collectStream(
	stream: NodeJS.ReadableStream | null,
): Promise<string> {
	if (!stream) return Promise.resolve("");
	return new Promise((resolve, reject) => {
		let result = "";
		stream.on("data", (chunk: Buffer) => {
			result += chunk.toString();
		});
		stream.on("end", () => resolve(result));
		stream.on("error", reject);
	});
}
