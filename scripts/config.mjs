import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Where `prepare-templates.mjs` syncs the upstream theme. */
const WORKSPACE_DIR = resolve("workspace");

/**
 * Shared configuration for the shirones build pipeline.
 *
 * Defaults point at the production theme (upstream `LyraVoid/Shirone`, `main`)
 * and the production package name. Every value is overridable through an env
 * var, which the workflow exposes as `workflow_dispatch` inputs, so packaging
 * a different branch or a scratch package name never needs a code change.
 */

export const UPSTREAM_REPO =
	process.env.SHIRONES_UPSTREAM_REPO ?? "https://github.com/LyraVoid/Shirone.git";

/** Branch or tag of the upstream theme to package. */
export const UPSTREAM_REF = process.env.SHIRONES_UPSTREAM_REF ?? "main";

/** Published npm package name. */
export const PACKAGE_NAME = process.env.SHIRONES_PACKAGE_NAME ?? "shirones";

/**
 * Version to publish. Decided by `scripts/resolve-version.mjs` (patch bump of
 * the latest release on npm, or an explicit request) and passed down through
 * the environment. Local runs that skip the resolver fall back to the
 * placeholder `0.0.0` in build-package.mjs — deliberately not the theme's own
 * version, which describes the source tree and has nothing to do with the
 * package's release line.
 */
export const PACKAGE_VERSION = process.env.SHIRONES_PACKAGE_VERSION?.trim() || null;

/**
 * Repository the package is published from. npm provenance cross-checks this
 * against the workflow that signs the release, so it must be *this* repo and
 * not the upstream theme.
 */
export const PACKAGE_REPOSITORY =
	process.env.SHIRONES_PACKAGE_REPOSITORY ??
	`https://github.com/${process.env.GITHUB_REPOSITORY ?? "yCENzh/shirones"}`;

/** Author recorded in the published package.json. */
export const PACKAGE_AUTHOR = process.env.SHIRONES_PACKAGE_AUTHOR ?? "yCENzh";

/**
 * Landing page shown on npm.
 *
 * Points at the documentation wiki rather than the repository readme: the
 * wiki carries the full user guide, while this repository only documents the
 * publishing pipeline. npm renders `homepage` as the package's "Homepage"
 * link, so it should send users to the docs, not to build scripts.
 */
export const PACKAGE_HOMEPAGE =
	process.env.SHIRONES_PACKAGE_HOMEPAGE ??
	"https://github.com/yCENzh/shirones/wiki";

/**
 * Directory name used inside the *user's* project for content and config.
 * Fixed to `shirones` regardless of the published package name, so projects
 * scaffolded with the test package keep working after switching to the real one.
 */
export const CONTENT_ROOT = "shirones";

/**
 * Top-level `src/` directories excluded from the published package. The
 * package build now ships *every* other top-level directory it finds, so
 * upstream adding a new `src/` directory needs no change here.
 *
 * - `src/content` becomes template content (see prepare-templates.mjs), not
 *   package source.
 * - `src/integration` is bundled separately into the package entry points
 *   (index.js / collections.js).
 *
 * `src/user/` ships by default: it carries the (empty) config-overlay backing
 * module that every `src/config/*.ts` imports through `config-overlay.ts`;
 * without it the package build cannot resolve `../user/user-config.ts` and
 * dies during `astro:config:setup`.
 */
export const PACKAGE_SRC_EXCLUDES = new Set(["content", "integration"]);

/**
 * Upstream dependencies that must NOT ship with the package.
 * `astro` becomes a peer dependency; the rest are build-only tooling.
 */
export const EXCLUDED_DEPENDENCIES = new Set([
	"astro",
	"@astrojs/check",
	"@biomejs/biome",
]);

/**
 * Theme-declared layout knowledge, read from the *upstream* tree once it has
 * been synced into `workspace/`.
 *
 * Three things used to be restated here and silently drifted:
 *   - the path aliases, which the theme also declares in `tsconfig.json` `paths`
 *   - the Vite aliases `createAliases()` installs, which are in those `paths`
 *     too but must be classified differently
 *   - the dependencies that ship with the package without being in the theme's
 *     `dependencies` (an import satisfied only by a devDependency works in
 *     source mode and breaks a user's package-mode build)
 *
 * `tsconfig.json` remains the source for path aliases because it is the one
 * place TypeScript itself reads them; a second copy in the manifest could drift
 * from it silently. The classification that tsconfig cannot express — which
 * entries are Vite aliases rather than theme paths — comes from the theme's
 * manifest, so no naming convention is guessed here.
 *
 * Falls back to the pre-manifest literals when `workspace/` is absent. This
 * module is imported by the version/template unit tests and by `validate.mjs`,
 * which run before — or without — a sync, and `publish.yml`'s `ref` input can
 * package an upstream branch that predates the manifest.
 */
const FALLBACK_PATH_ALIASES = [
	"@/",
	"@components/",
	"@utils/",
	"@layouts/",
	"@i18n/",
	"@constants/",
	"@assets/",
];
const FALLBACK_VITE_ALIASES = [
	"@shirone/iconify-offline",
	"@shirone/iconify-offline-functions",
];
const FALLBACK_EXTRA_DEPENDENCIES = {
	esbuild: "^0.27.0 || ^0.28.0",
	"@iconify-json/simple-icons": "^1.2.93",
	// Type-only imports that still need to resolve for `astro check`.
	"@types/hast": "^3.0.5",
	"@types/mdast": "^4.0.4",
};

const THEME_MANIFEST = join(
	WORKSPACE_DIR,
	"src",
	"integration",
	"package.manifest.json",
);

function readThemeManifest() {
	if (!existsSync(THEME_MANIFEST)) return null;
	try {
		return JSON.parse(readFileSync(THEME_MANIFEST, "utf8"));
	} catch (error) {
		console.warn(`[config] could not parse ${THEME_MANIFEST}: ${error.message}`);
		return null;
	}
}

function readThemePathAliases() {
	const file = join(WORKSPACE_DIR, "tsconfig.json");
	if (!existsSync(file)) return null;
	try {
		// tsconfig permits comments and trailing commas; strip both rather than
		// taking a JSONC parser dependency for two lines.
		const raw = readFileSync(file, "utf8")
			.replace(/^\s*\/\/.*$/gm, "")
			.replace(/,(\s*[}\]])/g, "$1");
		const paths = JSON.parse(raw)?.compilerOptions?.paths;
		if (!paths || typeof paths !== "object") return null;
		// Strip a trailing `*` and nothing else: `"@components/*"` becomes the
		// specifier prefix `"@components/"`, while a key with no wildcard
		// (`"@shirone/iconify-offline"`) is already the literal alias. Adding a
		// slash unconditionally would yield `"@//"`.
		const declared = Object.keys(paths)
			.map((p) => p.replace(/\*$/, ""))
			.filter((p) => p.length > 0);
		return declared.length > 0 ? new Set(declared) : null;
	} catch {
		return null;
	}
}

const themeManifest = readThemeManifest();
const themePathAliases = readThemePathAliases();

/** Vite aliases, from the theme. `paths` also lists them; this classifies them. */
export const INTEGRATION_VITE_ALIASES = themeManifest?.viteAliases ?? FALLBACK_VITE_ALIASES;

/** Theme path aliases, minus the ones the integration installs as Vite aliases. */
export const ALIAS_PREFIXES = [
	...(themePathAliases ?? new Set(FALLBACK_PATH_ALIASES)),
].filter((p) => !INTEGRATION_VITE_ALIASES.includes(p));

export const EXTRA_DEPENDENCIES =
	themeManifest?.extraDependencies ?? FALLBACK_EXTRA_DEPENDENCIES;

/**
 * Bare specifiers that resolve transitively and need no explicit entry.
 *
 * `@shirone/iconify-offline*` are Vite aliases the integration defines in
 * `createAliases()` (they point into `@iconify/svelte/dist`), not npm packages,
 * so the dependency scanner must not flag them.
 */
export const IGNORED_IMPORTS = new Set([
	"swup",
	"hast",
	"mdast",
	"unified",
	...INTEGRATION_VITE_ALIASES,
]);

/**
 * Peer dependencies exist for one reason: some tools resolve from the *user's*
 * project root, where pnpm's strict layout hides the theme's own dependencies.
 *
 * - `svelte` — `@astrojs/svelte` registers a dozen `svelte/*` subpaths in
 *   `optimizeDeps.include`, which Vite resolves from the project root.
 * - `@astrojs/svelte` — that same integration also registers
 *   `@astrojs/svelte/client.js` in `optimizeDeps.include` (the hydration
 *   client). Without it at the root, Vite logs "Failed to resolve dependency"
 *   in dev and Svelte islands never hydrate in the browser.
 * - `@iconify-json/*` — astro-icon loads icon sets through `require.resolve`
 *   in Node, outside Vite, so the integration's fallback resolver cannot help.
 *
 * `shirones init` installs all of these automatically, so users still only run
 * one command.
 *
 * The ranges below are *fallbacks*. The version actually published comes from
 * the upstream manifest (see `resolvePeerDependencies`); a literal here is used
 * only for a package upstream does not declare in `dependencies` — currently
 * `simple-icons`, which is a devDependency upstream but a runtime import for the
 * theme.
 *
 * Never pin a runtime-critical package here that upstream also declares: the
 * literal would silently lag behind every upstream bump. That drift is how
 * `sharp` ended up a minor behind (`^0.34.5` here vs `^0.35.4` upstream) and
 * users' dev servers failed with `MissingSharp`.
 */
export const PEER_DEPENDENCY_FALLBACKS = {
	astro: "^7.0.0",
	svelte: "^5.0.0",
	"@astrojs/svelte": "^9.0.1",
	// Astro's built-in image service dynamically imports `sharp` from the
	// project root; pnpm's strict layout hides the copy nested in the theme.
	sharp: "^0.34.5",
	"@iconify-json/material-symbols": "^1.2.88",
	"@iconify-json/fa6-brands": "^1.2.6",
	"@iconify-json/fa6-regular": "^1.2.4",
	"@iconify-json/fa6-solid": "^1.2.4",
	"@iconify-json/simple-icons": "^1.2.93",
};

/**
 * Peer ranges keyed to the upstream manifest, so an upstream bump flows
 * through the pipeline instead of stranding users on a stale version.
 *
 * A peer range says "your project root must be able to install something the
 * theme accepts". Because `dependencies` is inherited from upstream verbatim,
 * the peer has to admit whatever upstream declares — otherwise pnpm refuses to
 * install the package at all. So the peer follows upstream's floor and widens
 * an exact pin to its caret line, keeping the peer as broad as the line rather
 * than pinning it to one version. A package upstream does not declare keeps its
 * fallback.
 *
 * For the ranges currently in play:
 *
 * - `sharp` — upstream `^0.35.4` yields `^0.35.4`. The stale `^0.34.5` peer is
 *   what left users' project roots on the old minor, where Astro's image
 *   service could not load it and failed with `MissingSharp`.
 * - `astro` — upstream pin `7.3.2` yields `^7.3.2`, so the peer spans the line
 *   instead of demanding one exact version.
 * - `svelte` — upstream `^5.56.8` yields `^5.56.8`.
 * - `@iconify-json/simple-icons` — absent from upstream's `dependencies`
 *   (it is a devDependency there, supplied here via `EXTRA_DEPENDENCIES`), so
 *   it keeps the fallback `^1.2.93`.
 */
// These tools are excluded from the published package but are required by the
// generated project's documented `astro check` command. Their ranges still
// come from the upstream manifest; they are not hardcoded here.
const PROJECT_CHECK_DEPENDENCIES = new Set(["@astrojs/check", "typescript"]);

export function resolvePeerDependencies(upstreamDependencies) {
	const peers = {};
	for (const [name, fallback] of Object.entries(PEER_DEPENDENCY_FALLBACKS)) {
		const upstream = upstreamDependencies?.[name];
		if (!upstream) {
			peers[name] = fallback;
			continue;
		}
		// A range with no numeric version at all (`*`, `latest`) is taken
		// verbatim: there is no floor to widen, and inventing one could exclude
		// the version `dependencies` would resolve to.
		const upstreamFloor = rangeFloor(upstream);
		peers[name] = upstreamFloor ? toCaretRange(upstreamFloor) : upstream;
	}
	for (const name of PROJECT_CHECK_DEPENDENCIES) {
		const upstream = upstreamDependencies?.[name];
		if (!upstream) continue;
		const upstreamFloor = rangeFloor(upstream);
		peers[name] = upstreamFloor ? toCaretRange(upstreamFloor) : upstream;
	}
	return peers;
}

/** Lowest version a range admits, as [major, minor, patch], or null. */
function rangeFloor(range) {
	const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(range);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Express a floor as a caret range, widening an exact pin to its line. */
function toCaretRange(floor) {
	return `^${floor.join(".")}`;
}
