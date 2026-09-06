import { CONTENT_ROOT } from "./config.mjs";

export const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

/** Rewrite imports from copied config modules into the user project layout. */
export const CONFIG_REWRITES = [
	[/(["'])\.\.\/data\//g, "$1./data/"],
	[/src\/data\/anime-snapshots/g, `${CONTENT_ROOT}/config/data/anime-snapshots`],
	[/(["'])\.\.\/(types|utils|constants|i18n|generated|components|layouts|styles|assets|plugins)\//g, "$1@/$2/"],
];

/** Rewrite imports from copied data modules into the user project layout. */
export const DATA_REWRITES = [
	[/(["'])\.\.\/(types|utils|constants|i18n|generated|components|layouts|styles|assets|plugins)\//g, "$1@/$2/"],
	[/(["'])\.\.\/config\//g, "$1../"],
];

/** Rewrite paths embedded in copied Markdown content. */
export const CONTENT_REWRITES = [
	[/\]\(\/src\/config\)/g, `](/${CONTENT_ROOT}/config)`],
	[/src\/content\/snippets\//g, `${CONTENT_ROOT}/content/snippets/`],
];

export function applyRewrites(source, rules) {
	let output = source;
	for (const [pattern, replacement] of rules) {
		output = output.replace(pattern, replacement);
	}
	return output;
}
