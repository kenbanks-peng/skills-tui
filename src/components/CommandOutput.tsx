import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { type ProcessHandle, spawn, spawnSync } from "../lib/compat";
import { theme } from "../lib/theme";
import { stripAnsi } from "../lib/utils";

// Check once at startup whether a clipboard command is available.
const clipboardCmd = ((): string | null => {
	for (const cmd of ["pbcopy", "xclip", "xsel"]) {
		try {
			if (
				spawnSync(["which", cmd], { stdout: "pipe", stderr: "pipe" })
					.exitCode === 0
			) {
				return cmd;
			}
		} catch {}
	}
	return null;
})();

interface CommandOutputProps {
	args: string[] | null;
	focused: boolean;
	onBack: () => void;
}

export function CommandOutput({ args, focused, onBack }: CommandOutputProps) {
	useTerminalDimensions();
	const [isRunning, setIsRunning] = useState(false);
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [hasOutput, setHasOutput] = useState(false);
	const [output, setOutput] = useState<string>("");
	const [copied, setCopied] = useState(false);
	const procRef = useRef<ProcessHandle | null>(null);

	useKeyboard((key) => {
		if (!focused) return;

		// Don't handle left/right arrows - let parent handle navigation
		if (key.name === "left" || key.name === "right") {
			return;
		}

		// Allow Escape to kill running command or go back
		if (key.name === "escape") {
			if (isRunning && procRef.current) {
				procRef.current.kill();
			} else {
				onBack();
			}
			return;
		}

		// Ctrl+C to kill process
		if (key.ctrl && key.name === "c" && isRunning && procRef.current) {
			procRef.current.kill();
		}

		// 'c' to copy output to clipboard (when not running)
		if (key.name === "c" && !isRunning && output && clipboardCmd) {
			const cleanOutput = stripAnsi(output);
			const proc = spawn([clipboardCmd], { stdin: "pipe" });
			proc.stdin?.write(cleanOutput);
			(proc.stdin as NodeJS.WritableStream | null)?.end();
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	});

	useEffect(() => {
		if (!args) {
			setHasOutput(false);
			setIsRunning(false);
			setExitCode(null);
			setOutput("");
			return;
		}

		const runCommand = async () => {
			setIsRunning(true);
			setExitCode(null);
			setHasOutput(false);
			setOutput("");

			try {
				const proc = spawn(args, {
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" },
				});

				procRef.current = proc;

				const pipeStream = (stream: NodeJS.ReadableStream | null) => {
					if (!stream) return Promise.resolve();
					return new Promise<void>((resolve) => {
						stream.on("data", (chunk: Buffer) => {
							setOutput((prev) => prev + chunk.toString());
							setHasOutput(true);
						});
						stream.on("end", resolve);
						stream.on("error", resolve);
					});
				};

				// Read both streams concurrently
				await Promise.all([pipeStream(proc.stdout), pipeStream(proc.stderr)]);

				// Wait for process to exit
				const code = await proc.exited;
				setExitCode(code);
				setIsRunning(false);
				procRef.current = null;
			} catch (err) {
				setOutput((prev) => `${prev}Error running command: ${err}\n`);
				setHasOutput(true);
				setExitCode(1);
				setIsRunning(false);
				procRef.current = null;
			}
		};

		runCommand();

		// Cleanup on unmount
		return () => {
			if (procRef.current) {
				procRef.current.kill();
			}
		};
	}, [args]);

	const cleanOutput = stripAnsi(output);

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			border
			borderStyle={focused ? "double" : "rounded"}
			borderColor={focused ? theme.green : theme.surface2}
			padding={1}
			title=" Output "
		>
			{!args ? (
				<box flexGrow={1} justifyContent="center" alignItems="center">
					<text fg={theme.overlay1}>Select a command to run</text>
				</box>
			) : (
				<box flexDirection="column" flexGrow={1}>
					{hasOutput && (
						<box flexGrow={1} overflow="hidden">
							<text fg={theme.text}>{cleanOutput}</text>
						</box>
					)}
					{!isRunning && exitCode !== null && (
						<box
							marginTop={1}
							paddingLeft={1}
							flexDirection="row"
							justifyContent="space-between"
							paddingRight={1}
						>
							<text fg={exitCode === 0 ? theme.green : theme.red}>
								{exitCode === 0 ? "✓ " : "✗ "}
								Command exited with code {exitCode}
							</text>
							<text fg={copied ? theme.green : theme.overlay1}>
								{copied ? "Copied!" : "c: copy"}
							</text>
						</box>
					)}
					{isRunning && !hasOutput && (
						<box marginTop={1} paddingLeft={1}>
							<text fg={theme.overlay1}>Waiting for output...</text>
						</box>
					)}
				</box>
			)}
		</box>
	);
}
