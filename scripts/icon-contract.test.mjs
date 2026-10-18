import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkIconPipeline } from "./icon-contract.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE = join(ROOT, "workspace", "src", "integration", "index.ts");
const PLUGIN_CALL = "shironesIconRegeneration(paths, logger),";

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
	const source = GOOD.replace(PLUGIN_CALL, "").replace(
		"const aliases = [",
		"const registered = shironesIconRegeneration(paths, logger);\nconst aliases = [",
	);
	const message = checkIconPipeline(source).join(" ");
	assert.ok(message.includes("never registered in `vite.plugins[]`"));
});

test("only the direct updateConfig().vite.plugins[] path satisfies registration", () => {
	const fakeSources = [
		`updateConfig({});\nconst outside = { vite: { plugins: [${PLUGIN_CALL}] } };`,
		`updateConfig({ unrelated: { vite: { plugins: [${PLUGIN_CALL}] } } });`,
		`updateConfig({ vite: { unrelated: { plugins: [${PLUGIN_CALL}] } } });`,
	];
	for (const source of fakeSources) {
		const problems = checkIconPipeline(source);
		assert.ok(
			problems.some((problem) =>
				/no `vite\.plugins\[\]` array|never registered in `vite\.plugins\[\]`/.test(problem),
			),
			source,
		);
	}
});

test("comments, strings, regexes, and templates cannot fake plugin registration", () => {
	const nonCode = [
		"/* ] shironesIconRegeneration(paths, logger) */",
		'"shironesIconRegeneration("',
		String.raw`/shironesIconRegeneration\(/`,
		"`] shironesIconRegeneration(paths, logger)`",
	];
	for (const fakeCall of nonCode) {
		const source = GOOD.replace(PLUGIN_CALL, `${fakeCall},`);
		assert.ok(
			checkIconPipeline(source)
				.join(" ")
				.includes("never registered in `vite.plugins[]`"),
			fakeCall,
		);
	}
});

test("commented alias text does not satisfy the alias contract", () => {
	const aliasStart = GOOD.indexOf("\t\tfind:");
	const aliasEnd = GOOD.indexOf("\n\t},", aliasStart);
	assert.notEqual(aliasStart, -1);
	assert.notEqual(aliasEnd, -1);
	const aliasText = GOOD.slice(aliasStart, aliasEnd);
	const source = GOOD.replace(aliasText, `/*\n${aliasText}\n*/`);
	assert.ok(
		checkIconPipeline(source)
			.join(" ")
			.includes("not aliased to the theme's Icon component"),
	);
});

test("string literals cannot fake the alias contract", () => {
	const source = GOOD.replace(
		/const aliases = \[[\s\S]*?\];/,
		'const fakeFind = "find: @iconify/svelte";\nconst fakeReplacement = "replacement: display/Icon.svelte";',
	);
	assert.ok(
		checkIconPipeline(source)
			.join(" ")
			.includes("not aliased to the theme's Icon component"),
	);
});

test("a quoted icon specifier and replacement satisfy the alias contract", () => {
	const source = GOOD.replace(/find: [^\n]*/, 'find: "@iconify/svelte",').replace(
		/replacement: [^\n]*/,
		'replacement: "components/atoms/display/Icon.svelte",',
	);
	assert.deepEqual(checkIconPipeline(source), []);
});

test("an unterminated vite.plugins[] array gets a distinct diagnostic", () => {
	const source = GOOD.replace("\t\t\t],\n\t\t},", "\t\t\t\n\t\t},");
	assert.ok(checkIconPipeline(source).join(" ").includes("`vite.plugins[` is never closed"));
});

test("an empty vite.plugins[] is reported", () => {
	const source = GOOD.replace(/plugins: \[[\s\S]*?\],/, "plugins: [],");
	assert.ok(
		checkIconPipeline(source)
			.join(" ")
			.includes("never registered in `vite.plugins[]`"),
	);
});

test("no vite.plugins[] at all is reported", () => {
	assert.ok(
		checkIconPipeline("export default 1;\n")
			.join(" ")
			.includes("no `vite.plugins[]` array"),
	);
});

test("an alias with no replacement is reported", () => {
	const source = GOOD.replace(/\t\treplacement:[^\n]*\n/, "");
	assert.ok(
		checkIconPipeline(source)
			.join(" ")
			.includes("not aliased to the theme's Icon component"),
	);
});

test("an alias redirected to the upstream component is reported", () => {
	// `OfflineIcon.svelte` contains `Icon.svelte` as a substring, so the path
	// suffix is what tells them apart.
	const source = GOOD.replace(
		"components/atoms/display/Icon.svelte",
		"node_modules/@iconify/svelte/dist/OfflineIcon.svelte",
	);
	assert.ok(
		checkIconPipeline(source)
			.join(" ")
			.includes("redirected somewhere other than"),
	);
});
