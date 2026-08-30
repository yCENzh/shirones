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

/** Landing page shown on npm. */
export const PACKAGE_HOMEPAGE =
	process.env.SHIRONES_PACKAGE_HOMEPAGE ?? `${PACKAGE_REPOSITORY}#readme`;

/**
 * Directory name used inside the *user's* project for content and config.
 * Fixed to `shirones` regardless of the published package name, so projects
 * scaffolded with the test package keep working after switching to the real one.
 */
export const CONTENT_ROOT = "shirones";

/**
 * Upstream directories copied into the published package (`dist/src/`).
 * `src/content` is excluded on purpose: it becomes template content instead.
 *
 * Keep this list in sync with the theme: every new top-level `src/` directory
 * that shipped code imports must be added here. `src/user/` carries the
 * (empty) config-overlay backing module that every `src/config/*.ts` imports
 * through `config-overlay.ts`; without it the package build cannot resolve
 * `../user/user-config.ts` and dies during `astro:config:setup`.
 */
export const PACKAGE_SRC_DIRS = [
	"assets",
	"components",
	"config",
	"constants",
	"data",
	"generated",
	"i18n",
	"layouts",
	"pages",
	"plugins",
	"styles",
	"types",
	"user",
	"utils",
];

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
 * Dependencies that must ship with the package but are not in the upstream
 * `dependencies` block.
 *
 * `@iconify-json/simple-icons` is the important one: upstream lists it as a
 * devDependency, but `src/plugins/markdown/core/file-tree-icons.mjs` imports it
 * at runtime. In source mode that works because devDependencies are installed;
 * in package mode it would blow up in the user's build. This is exactly the
 * "anything an injected route imports must be a real dependency" rule.
 */
export const EXTRA_DEPENDENCIES = {
	esbuild: "^0.27.0 || ^0.28.0",
	"@iconify-json/simple-icons": "^1.2.93",
	// Type-only imports that still need to resolve for `astro check`.
	"@types/hast": "^3.0.5",
	"@types/mdast": "^4.0.4",
};

/**
 * Bare-specifier prefixes that are theme path aliases rather than npm packages.
 * The dependency scanner must not report these as missing.
 */
export const ALIAS_PREFIXES = [
	"@/",
	"@components/",
	"@utils/",
	"@layouts/",
	"@i18n/",
	"@constants/",
	"@assets/",
];

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
	"@shirone/iconify-offline",
	"@shirone/iconify-offline-functions",
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
 */
export const PEER_DEPENDENCIES = {
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
