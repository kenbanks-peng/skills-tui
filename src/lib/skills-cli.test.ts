import { describe, expect, test } from "bun:test";
import { updateArgs } from "./skills-cli";

describe("skills CLI update arguments", () => {
	test("selects User Scope explicitly", () => {
		expect(updateArgs(true).slice(1)).toEqual([
		"skills",
		"update",
		"-g",
		"-y",
	]);
	});

	test("selects Project Scope explicitly", () => {
		expect(updateArgs(false).slice(1)).toEqual([
		"skills",
		"update",
		"-p",
		"-y",
	]);
	});
});
