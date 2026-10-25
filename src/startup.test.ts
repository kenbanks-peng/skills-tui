import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function run(source: string) {
	const root = mkdtempSync(join(tmpdir(), "skills-tui-startup-"));
	roots.push(root);
	const home = join(root, "home");
	const config = join(home, ".config", "skills-tui");
	mkdirSync(config, { recursive: true });
	writeFileSync(
		join(config, "config.toml"),
		"repos = []\n[agents]\nenabled = []\n",
	);
	const result = spawnSync(process.execPath, ["--eval", source], {
		cwd: root,
		env: {
			...process.env,
			HOME: home,
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_STATE_HOME: join(home, ".state"),
		},
		encoding: "utf8",
		timeout: 5_000,
	});
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}
const entry = pathToFileURL(join(import.meta.dir, "index.tsx")).href;
const app = pathToFileURL(join(import.meta.dir, "App.tsx")).href;
const sync = pathToFileURL(
	join(import.meta.dir, "lib/configured-skills.ts"),
).href;

test("the entrypoint opens the UI without waiting for synchronization", () => {
	run(`
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    let rendered = false;
    mock.module(${JSON.stringify(import.meta.resolve("@opentui/core"))}, () => ({ createCliRenderer: async () => ({}) }));
    mock.module(${JSON.stringify(import.meta.resolve("@opentui/react"))}, () => ({ createRoot: () => ({ render: () => { rendered = true; } }) }));
    mock.module(${JSON.stringify(app)}, () => ({ App: () => null }));
    mock.module(${JSON.stringify(sync)}, () => ({ synchronizeConfiguredSkills: () => new Promise(() => {}) }));
    let timer;
    try {
      await Promise.race([
        import(${JSON.stringify(entry)}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("UI was blocked by synchronization")), 1000); }),
      ]);
      assert.equal(rendered, true);
    } finally { clearTimeout(timer); }
  `);
});

test("the rendered App starts non-refresh synchronization in the background", () => {
	run(`
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    import { createElement, act } from ${JSON.stringify(import.meta.resolve("react"))};
    import { testRender } from ${JSON.stringify(import.meta.resolve("@opentui/react/test-utils"))};
    let started = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    mock.module(${JSON.stringify(sync)}, () => ({
      synchronizeConfiguredSkills: async (options) => {
        assert.notEqual(options?.refresh, true, "Startup must not reinstall intact skills");
        started = true;
        return gate;
      },
      setConfiguredSkillSelection: async () => { throw new Error("No selections in this test"); },
      summarizeSkillSyncErrors: () => null,
    }));
    const { App } = await import(${JSON.stringify(app)});
    const setup = await testRender(createElement(App), { width: 140, height: 40 });
    try {
      await setup.renderOnce();
      assert.equal(started, true, "Startup synchronization was not started");
      assert.match(setup.captureCharFrame(), /Repositories/);
    } finally {
      await act(async () => setup.renderer.destroy());
      release({ added: [], removed: [], errors: [] });
    }
  `);
});
