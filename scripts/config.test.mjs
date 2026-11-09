import assert from "node:assert/strict";
import test from "node:test";
import { EXTRA_DEPENDENCIES, resolvePeerDependencies } from "./config.mjs";

test("widens only exact SemVer pins", () => {
	assert.deepEqual(
		resolvePeerDependencies({
			astro: "7.4.5",
			svelte: "^5.57.3",
			"@astrojs/svelte": "9.1.2",
			sharp: "^0.35.5",
			"@astrojs/check": "0.9.12",
			typescript: "6.0.3",
		}),
		{
			astro: "^7.4.5",
			svelte: "^5.57.3",
			"@astrojs/svelte": "^9.1.2",
			sharp: "^0.35.5",
			"@astrojs/check": "^0.9.12",
			typescript: "^6.0.3",
		},
	);
});

test("preserves comparator sets, unions, tags, and workspace ranges verbatim", () => {
	assert.deepEqual(
		resolvePeerDependencies({
			astro: ">=7.4.0 <8.0.0",
			svelte: "^7.0.0 || ^8.0.0",
			"@astrojs/svelte": "workspace:*",
			sharp: "latest",
		}),
		{
			astro: ">=7.4.0 <8.0.0",
			svelte: "^7.0.0 || ^8.0.0",
			"@astrojs/svelte": "workspace:*",
			sharp: "latest",
		},
	);
});

test("does not turn an upper bound into a lower bound", () => {
	assert.equal(resolvePeerDependencies({ astro: "<8.0.0" }).astro, "<8.0.0");
});

test("uses the documented fallbacks only when upstream omits a peer", () => {
	const peers = resolvePeerDependencies({});
	assert.equal(peers.astro, "^7.0.0");
	assert.equal(peers.svelte, "^5.0.0");
	assert.equal(peers.sharp, "^0.34.5");
	assert.equal(Object.hasOwn(peers, "typescript"), false);
});

test("the configured package manifest includes the CLI's JSONC runtime parser", () => {
	assert.equal(EXTRA_DEPENDENCIES["jsonc-parser"], "^3.3.1");
});
