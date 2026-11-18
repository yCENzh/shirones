/**
 * The icon parity probe used by `validate.mjs`.
 *
 * An icon has to render wherever the user writes it, in a project that
 * installs the package exactly as in a checkout of the theme. The contract
 * checks in `icon-contract.mjs` read source text; they stayed green while
 * package-mode projects rendered only the icons the theme itself uses, because
 * the project's collection was generated correctly and then never read.
 *
 * So this asks the only question that settles it: put an icon the theme does
 * not use on a page of the scaffolded project, build it, and look at the HTML.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the probe page is written, relative to the project root. */
export const ICON_PROBE_FILE = "src/pages/shirones-icon-probe.astro";
/** Where the dev server serves it (the theme sets `trailingSlash: "always"`). */
export const ICON_PROBE_ROUTE = "/shirones-icon-probe/";
/** Where `astro build` writes it, relative to the output directory. */
export const ICON_PROBE_OUTPUT = "shirones-icon-probe/index.html";

/** The icon set the probe draws from; the largest one the theme bundles. */
export const ICON_PROBE_PREFIX = "material-symbols";

/** A name that is in no icon set. It must cost a warning, not the build. */
const UNKNOWN_NAME = "shirones-probe-no-such-icon";

/**
 * Whether the packaged theme serves icons from the virtual module.
 *
 * Older refs read a generated file, and on those a project-only icon is known
 * not to render in package mode. The probe would fail on every one of them for
 * a reason this repository cannot fix, so it runs only where the theme claims
 * the behaviour.
 */
export function usesVirtualIconModule(packageSrc) {
	const icon = join(packageSrc, "components", "atoms", "display", "Icon.svelte");
	return existsSync(icon) && readFileSync(icon, "utf8").includes("virtual:shirone-icons");
}

function* textFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) yield* textFiles(absolute);
		else if (/\.(astro|md|mdx|svelte|ts|tsx|js|mjs|json|ya?ml)$/.test(entry.name)) yield absolute;
	}
}

/** Every `<prefix>:<name>` written anywhere under `directories`. */
export function referencedIconNames(directories, prefix = ICON_PROBE_PREFIX) {
	const pattern = new RegExp(`\\b${prefix}:([a-z0-9-]+)`, "g");
	const names = new Set();
	for (const directory of directories) {
		if (!existsSync(directory)) continue;
		for (const file of textFiles(directory)) {
			for (const match of readFileSync(file, "utf8").matchAll(pattern)) names.add(match[1]);
		}
	}
	return names;
}

/**
 * Choose the probe icons.
 *
 * `control` is one the theme already uses, so a blank control means the page
 * itself is broken rather than the parity. `unused` is one nothing references:
 * it can only render if the project's own file was scanned and the result
 * reached the page. Returns `null` when either cannot be chosen.
 */
export function chooseProbeIcons(availableNames, referencedNames, prefix = ICON_PROBE_PREFIX) {
	const available = [...availableNames].sort();
	const control = available.find((name) => referencedNames.has(name));
	const unused = available.find((name) => !referencedNames.has(name));
	if (!control || !unused || available.includes(UNKNOWN_NAME)) return null;
	return {
		control: `${prefix}:${control}`,
		unused: `${prefix}:${unused}`,
		unknown: `${prefix}:${UNKNOWN_NAME}`,
	};
}

/** The probe page: one marked element per icon. */
export function renderProbePage(icons) {
	const spans = Object.entries(icons)
		.map(([id, icon]) => `<span data-icon-probe="${id}"><Icon icon="${icon}" /></span>`)
		.join("\n");
	return `---
import Icon from "@iconify/svelte";
---
<html lang="en"><head><title>icon probe</title></head><body>
${spans}
</body></html>
`;
}

/** Which probe elements hold a drawn icon in rendered HTML. */
export function readProbe(html) {
	const result = {};
	for (const match of html.matchAll(/<span data-icon-probe="([a-z]+)"[^>]*>(.*?)<\/span>/gs)) {
		result[match[1]] = /<svg\b[^>]*>.*<(path|g|circle|rect)\b/s.test(match[2]);
	}
	return result;
}

/** Problems with a rendered probe page, as sentences; empty when it is right. */
export function probeProblems(html, icons) {
	const drawn = readProbe(html);
	const problems = [];
	if (drawn.control !== true) {
		problems.push(`${icons.control}, which the theme itself uses, did not render: the probe page is broken`);
	}
	if (drawn.unused !== true) {
		problems.push(
			`${icons.unused}, written only in the project's own page, did not render: ` +
				"the project's files are not reaching the icon collection",
		);
	}
	if (drawn.unknown !== false) {
		problems.push(`${icons.unknown} is in no icon set and should render as nothing`);
	}
	return problems;
}
