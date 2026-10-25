import { describe, expect, test } from "bun:test";
import { addArgs } from "./skills-cli";

describe("explicit skill installation", () => {
	test("supplies repository and skill for User Scope without an update command", () => {
		expect(
			addArgs(true, ["opencode"], "owner/repo", "chosen").slice(1),
		).toEqual([
			"skills",
			"add",
			"-g",
			"--full-depth",
			"--skill",
			"chosen",
			"--agent",
			"opencode",
			"-y",
			"owner/repo",
		]);
	});
	test("uses Project Scope when the user flag is absent", () => {
		expect(
			addArgs(false, ["opencode"], "owner/repo", "chosen").slice(1),
		).toEqual([
			"skills",
			"add",
			"--full-depth",
			"--skill",
			"chosen",
			"--agent",
			"opencode",
			"-y",
			"owner/repo",
		]);
	});
});
