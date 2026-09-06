import assert from "node:assert/strict";
import test from "node:test";
import {
	applyRewrites,
	CONFIG_REWRITES,
	CONTENT_REWRITES,
	DATA_REWRITES,
} from "./template-rewrites.mjs";

test("rewrites config imports and the anime snapshot path", () => {
	const source = [
		'import { tracks } from "../data/music.ts";',
		'import type { Font } from "../types/font.ts";',
		'const cache = "src/data/anime-snapshots";',
	].join("\n");

	assert.equal(
		applyRewrites(source, CONFIG_REWRITES),
		[
			'import { tracks } from "./data/music.ts";',
			'import type { Font } from "@/types/font.ts";',
			'const cache = "shirones/config/data/anime-snapshots";',
		].join("\n"),
	);
});

test("rewrites data imports without changing legal sibling paths", () => {
	const source = [
		'import { site } from "../config/siteConfig.ts";',
		'import { icons } from "../utils/icons.ts";',
		'import { local } from "../local.ts";',
	].join("\n");

	assert.equal(
		applyRewrites(source, DATA_REWRITES),
		[
			'import { site } from "../siteConfig.ts";',
			'import { icons } from "@/utils/icons.ts";',
			'import { local } from "../local.ts";',
		].join("\n"),
	);
});

test("rewrites the two supported Markdown project paths", () => {
	assert.equal(
		applyRewrites(
			"[config](/src/config)\nsrc/content/snippets/example.md",
			CONTENT_REWRITES,
		),
		"[config](/shirones/config)\nshirones/content/snippets/example.md",
	);
});
