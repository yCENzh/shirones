import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkIconPipeline } from "./icon-contract.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE = join(ROOT, "workspace", "src", "integration", "index.ts");

/**
 * A minimal integration source that satisfies the contract. Each case mutates
 * exactly one fact, so a failure names one contract term rather than a
 * combination.
 */
const GOOD = `export async function shirones() {
	updateConfig({
		vite: {
			plugins: [
				{ name: "other" },
				shironesIconRegeneration(paths, logger),
			],
		},
	});
}
const aliases = [
	{
		find: /^@iconify\\/svelte$/,
		replacement: join(src, "components/atoms/display/Icon.svelte"),
	},
];
export default shirones;
`;

test("a source that registers the plugin and redirects the specifier is fine", () => {
	assert.deepEqual(checkIconPipeline(GOOD), []);
});

test("the real theme source satisfies the contract", () => {
	// Guarded so a missing workspace reports as such rather than a silent pass.
	assert.ok(existsSync(WORKSPACE), `${WORKSPACE} is not synced`);
	const source = readFileSync(WORKSPACE, "utf8");
	assert.deepEqual(checkIconPipeline(source), []);
});

test("a plugin call outside vite.plugins[] is reported", () => {
	// The failure this test exists for: searching from `plugins: [` to the end
	// of the file accepted a call that is not in the array at all, which leaves
	// the icons unregenerated with the contract still green.
	const source = GOOD.replace(
		"shironesIconRegeneration(paths, logger),",
		""
	).replace(
		"const aliases = [",
		"const registered = shironesIconRegeneration(paths, logger);\nconst aliases = [",
	);
	const problems = checkIconPipeline(source);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /never registered in `vite\.plugins\[\]`/);
});

test("an empty vite.plugins[] is reported", () => {
	assert.match(
		checkIconPipeline(GOOD.replace(/plugins: \[[\s\S]*?\],/, "plugins: [],")).join(" "),
		/never registered in `vite\.plugins\[\]`/,
	);
});

test("no vite.plugins[] at all is reported", () => {
	assert.match(
		checkIconPipeline("export default 1;\n").join(" "),
		/no `vite\.plugins\[\]` array/,
	);
});

test("an alias with no replacement is reported", () => {
	assert.match(
		checkIconPipeline(GOOD.replace(/\t\{\n\t\tfind:[\s\S]*?\n\t\},/, "")).join(" "),
		/not aliased to the theme's Icon component/,
	);
});

test("an alias redirected to the upstream component is reported", () => {
	// `OfflineIcon.svelte` contains `Icon.svelte` as a substring, so the path
	// suffix is what tells them apart.
	const source = GOOD.replace(
		'components/atoms/display/Icon.svelte',
		'node_modules/@iconify/svelte/dist/OfflineIcon.svelte',
	);
	const problems = checkIconPipeline(source);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /redirected somewhere other than/);
});

