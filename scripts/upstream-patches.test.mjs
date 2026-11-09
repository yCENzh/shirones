import assert from "node:assert/strict";
import test from "node:test";
import { ensureMaterialUtilitiesNoExternal } from "./upstream-patches.mjs";

const misplaced = [
	"export default function integration({ updateConfig }) {",
	"\tupdateConfig({",
	"\t\tvite: {",
	"\t\t\tresolve: {",
	"\t\t\t\talias: createAliases(paths),",
	"\t\t\t\t// Layout.astro resolves the default color scheme at build",
	"\t\t\t\t// time; this package ships extensionless ESM imports that",
	"\t\t\t\t// Node cannot load when externalized, so Vite bundles it.",
	"\t\t\t\tnoExternal: [\"@material/material-color-utilities\"],",
	"\t\t\t},",
	"\t\t\tplugins: [],",
	"\t\t},",
	"\t});",
	"}",
].join("\n");

test("moves Material Color Utilities from resolve.noExternal to vite.ssr.noExternal", () => {
	const patched = ensureMaterialUtilitiesNoExternal(misplaced);

	assert.match(patched, /ssr: \{\n\t\t\t\t\/\/ Node cannot resolve this package's extensionless ESM imports when externalized\./);
	assert.match(patched, /ssr: \{[\s\S]*?noExternal: \["@material\/material-color-utilities"\]/);
	assert.match(patched, /resolve: \{\n\t\t\t\talias: createAliases\(paths\),\n\t\t\t\},/);
	assert.doesNotMatch(patched, /resolve: \{[\s\S]*?noExternal:/);
	assert.equal(ensureMaterialUtilitiesNoExternal(patched), patched, "patch is idempotent");
});

test("preserves an already-correct vite.ssr.noExternal setting", () => {
	const source = [
		"integration({ updateConfig }) {",
		"\tupdateConfig({",
		"\t\tvite: {",
		"\t\t\tssr: {",
		"\t\t\t\tnoExternal: [\"@material/material-color-utilities\"],",
		"\t\t\t},",
		"\t\t\tresolve: { alias: createAliases(paths) },",
		"\t\t\tplugins: [],",
		"\t\t},",
		"\t});",
		"}",
	].join("\n");

	assert.equal(ensureMaterialUtilitiesNoExternal(source), source);
});

test("removes a redundant misplaced key without duplicating a correct SSR setting", () => {
	const source = [
		"integration({ updateConfig }) {",
		"\tupdateConfig({",
		"\t\tvite: {",
		"\t\t\tssr: {",
		"\t\t\t\tnoExternal: [\"@material/material-color-utilities\"],",
		"\t\t\t},",
		"\t\t\tresolve: {",
		"\t\t\t\tnoExternal: [\"@material/material-color-utilities\"],",
		"\t\t\t},",
		"\t\t\tplugins: [],",
		"\t\t},",
		"\t});",
		"}",
	].join("\n");
	const patched = ensureMaterialUtilitiesNoExternal(source);

	assert.equal((patched.match(/ssr:\s*\{/g) ?? []).length, 1);
	assert.match(patched, /ssr: \{[\s\S]*?noExternal: \["@material\/material-color-utilities"\]/);
	assert.doesNotMatch(patched, /resolve: \{[\s\S]*?noExternal:/);
});

test("extends an existing vite.ssr.noExternal array without dropping entries", () => {
	const source = [
		"integration({ updateConfig }) {",
		"\tupdateConfig({",
		"\t\tvite: {",
		"\t\t\tssr: {",
		"\t\t\t\tnoExternal: [\"some-other-package\"],",
		"\t\t\t},",
		"\t\t\tplugins: [],",
		"\t\t},",
		"\t});",
		"}",
	].join("\n");
	const patched = ensureMaterialUtilitiesNoExternal(source);

	assert.match(patched, /noExternal: \["some-other-package", "@material\/material-color-utilities"\]/);
	assert.equal(ensureMaterialUtilitiesNoExternal(patched), patched);
});

test("adds vite.ssr when upstream has not configured SSR externalization", () => {
	const source = [
		"integration({ updateConfig }) {",
		"\tupdateConfig({",
		"\t\tvite: {",
		"\t\t\tresolve: { alias: createAliases(paths) },",
		"\t\t\tplugins: [],",
		"\t\t},",
		"\t});",
		"}",
	].join("\n");

	assert.match(ensureMaterialUtilitiesNoExternal(source), /ssr: \{[\s\S]*?noExternal: \["@material\/material-color-utilities"\]/);
});

test("fails closed when the upstream Vite config shape is unfamiliar", () => {
	assert.throws(
		() => ensureMaterialUtilitiesNoExternal("export default function integration() {}"),
		/upstream integration has no updateConfig/,
	);
});
