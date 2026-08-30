/**
 * Step 4 — emit `dist/manifest.json`.
 *
 * The manifest documents what the package injects: every route, every
 * overridable component, and every config module a user may shadow. It is both
 * a debugging aid and the data source for the override documentation.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { CONTENT_ROOT, PACKAGE_NAME } from "./config.mjs";

const DIST_DIR = resolve("dist");
const WORKSPACE_DIR = resolve("workspace");
const SRC_DIR = join(DIST_DIR, "src");

/**
 * Load the theme's own route collector instead of re-implementing its
 * page→pattern rules here. The two used to be mirrored copies that drifted;
 * bundling `routes.ts` keeps `collectRoutes` a single source of truth.
 */
async function loadRouteCollector() {
	const result = await build({
		entryPoints: [join(WORKSPACE_DIR, "src/integration/routes.ts")],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		logLevel: "silent",
	});
	const file = join(DIST_DIR, ".routes.mjs");
	await writeFile(file, result.outputFiles[0].text, "utf8");
	const module = await import(pathToFileURL(file).href);
	await rm(file, { force: true });
	return module;
}

async function walk(dir, predicate) {
	if (!existsSync(dir)) return [];
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name.startsWith("_")) continue;
			found.push(...(await walk(full, predicate)));
		} else if (predicate(entry.name)) {
			found.push(full);
		}
	}
	return found;
}

const { collectRoutes } = await loadRouteCollector();

const routes = collectRoutes(join(SRC_DIR, "pages")).map((route) => ({
	pattern: route.pattern,
	source: `src/pages/${route.source}`,
}));

/**
 * Overridable components. The key is what a user mirrors under
 * `src/components/` in their own project.
 */
async function collectOverridables(dir, prefix) {
	const files = await walk(dir, (name) => [".astro", ".svelte"].includes(extname(name)));
	return files
		.map((file) => {
			const rel = relative(dir, file).replace(/\\/g, "/");
			return {
				key: `${prefix}${rel.replace(/\.(astro|svelte)$/, "")}`,
				overrideWith: `src/${prefix ? "layouts" : "components"}/${rel}`,
			};
		})
		.sort((a, b) => a.key.localeCompare(b.key));
}

const components = await collectOverridables(join(SRC_DIR, "components"), "");
const layouts = await collectOverridables(join(SRC_DIR, "layouts"), "layouts/");

// Config modules a user can shadow in `<CONTENT_ROOT>/config/`.
const configDir = join(SRC_DIR, "config");
const configModules = (
	await walk(configDir, (name) => extname(name) === ".ts" && name !== "index.ts")
)
	.map((file) => relative(configDir, file).replace(/\\/g, "/").replace(/\.ts$/, ""))
	.sort();

const dataDir = join(SRC_DIR, "data");
const dataModules = (await walk(dataDir, (name) => extname(name) === ".ts"))
	.map((file) => relative(dataDir, file).replace(/\\/g, "/").replace(/\.ts$/, ""))
	.sort();

const pkg = JSON.parse(await readFile(join(DIST_DIR, "package.json"), "utf8"));

const manifest = {
	package: PACKAGE_NAME,
	version: pkg.version,
	contentRoot: CONTENT_ROOT,
	routes,
	overrides: {
		components,
		layouts,
		config: configModules.map((name) => ({
			key: name,
			overrideWith: `${CONTENT_ROOT}/config/${name}.ts`,
		})),
		data: dataModules.map((name) => ({
			key: name,
			overrideWith: `${CONTENT_ROOT}/config/data/${name}.ts`,
		})),
	},
	counts: {
		routes: routes.length,
		components: components.length,
		layouts: layouts.length,
		config: configModules.length,
		data: dataModules.length,
	},
};

await writeFile(
	join(DIST_DIR, "manifest.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
	"utf8",
);

console.log("[manifest] dist/manifest.json");
for (const [key, value] of Object.entries(manifest.counts)) {
	console.log(`  ${key.padEnd(11)} ${value}`);
}
