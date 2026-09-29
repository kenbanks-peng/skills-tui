import { describe, expect, test } from "bun:test";
import { autoUpdateSkills } from "./auto-update";
import type { RunResult } from "./skills-cli";

const success: RunResult = { code: 0, stdout: "", stderr: "" };

describe("automatic skill updates", () => {
	test("updates User Scope and Project Scope in order", async () => {
		const scopes: boolean[] = [];

		const failures = await autoUpdateSkills(async (isGlobal) => {
			scopes.push(isGlobal);
			return success;
		});

		expect(scopes).toEqual([true, false]);
		expect(failures).toEqual([]);
	});

	test("continues after a scope fails", async () => {
		const scopes: boolean[] = [];

		const failures = await autoUpdateSkills(async (isGlobal) => {
			scopes.push(isGlobal);
			if (isGlobal) return { code: 1, stdout: "", stderr: "offline" };
			throw new Error("invalid lock");
		});

		expect(scopes).toEqual([true, false]);
		expect(failures).toHaveLength(2);
		expect(failures[0]).toEqual({ scope: "User Scope", error: "offline" });
		expect(failures[1]?.scope).toBe("Project Scope");
		expect(failures[1]?.error).toBeInstanceOf(Error);
	});
});
