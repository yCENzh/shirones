/**
 * Step 3 — assemble the publishable package in `dist/`.
 *
 * Layout produced here:
 *
 *   dist/
 *     index.js          bundled Astro Integration (Node side)
 *     collections.js    bundled content-collection helper (Vite side)
 *     bin/cli.mjs       `shirones init`
 *     src/**            theme source consumed by Vite at build time
 *     template/**       files copied into a user's project by `init`
 *     types/**          hand-maintained public type declarations
 *     package.json
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { build } from "esbuild";
import {
	ALIAS_PREFIXES,
	EXCLUDED_DEPENDENCIES,
	EXTRA_DEPENDENCIES,
	IGNORED_IMPORTS,
	PACKAGE_AUTHOR,
	PACKAGE_HOMEPAGE,
	PACKAGE_NAME,
	PACKAGE_REPOSITORY,
	PACKAGE_SRC_DIRS,
	PACKAGE_VERSION,
	PEER_DEPENDENCIES,
} from "./config.mjs";

const WORKSPACE_DIR = resolve("workspace");
const DIST_DIR = resolve("dist");

const upstreamPkg = JSON.parse(
	await readFile(join(WORKSPACE_DIR, "package.json"), "utf8"),
);

console.log(`[build] packaging ${PACKAGE_NAME}@${PACKAGE_VERSION ?? "0.0.0"}`);

// `dist/template` is produced by the previous step; keep it if present.
const templateDir = join(DIST_DIR, "template");
const hasTemplate = existsSync(templateDir);
if (!hasTemplate) {
	console.error("[build] ✗ dist/template missing — run prepare-templates.mjs first");
	process.exit(1);
}

for (const entry of await readdir(DIST_DIR)) {
	if (entry === "template") continue;
	await rm(join(DIST_DIR, entry), { recursive: true, force: true });
}

// ── 1. Bundle the integration entry points ──────────────────────────────────
// `packages: "external"` keeps every bare import out of the bundle so Node
// resolves them from the user's `node_modules` at run time. That is what makes
// the "every injected import must be a real dependency" rule enforceable.
const shared = {
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	packages: "external",
	logLevel: "info",
	sourcemap: false,
	// The workspace tsconfig.json `extends` "astro/tsconfigs/strict", which is
	// not installed here (astro is deliberately excluded from this pipeline).
	// An empty raw tsconfig stops esbuild's automatic tsconfig discovery, so
	// the "Cannot find base config file" warning disappears. The only fields
	// in that file that could affect bundling are `baseUrl`/`paths`, and they
	// are irrelevant here: `packages: "external"` keeps every bare import
	// (including the `@/` aliases) as an external reference, never bundled.
	// The output is byte-for-byte unchanged.
	tsconfigRaw: {},
};

await build({
	...shared,
	entryPoints: [join(WORKSPACE_DIR, "src/integration/index.ts")],
	outfile: join(DIST_DIR, "index.js"),
	banner: {
		js: "// Shirone — Astro Integration (generated bundle, do not edit)",
	},
});
console.log("[build] index.js");

await build({
	...shared,
	entryPoints: [join(WORKSPACE_DIR, "src/integration/collections.ts")],
	outfile: join(DIST_DIR, "collections.js"),
	// `astro:content` is a Vite virtual module; it must never be bundled.
	external: ["astro:content", "astro/loaders", "astro/zod"],
	banner: {
		js: "// Shirone — content collections (generated bundle, do not edit)",
	},
});
console.log("[build] collections.js");

// ── 2. CLI ──────────────────────────────────────────────────────────────────
await mkdir(join(DIST_DIR, "bin"), { recursive: true });
await cp(
	join(WORKSPACE_DIR, "src/integration/cli.mjs"),
	join(DIST_DIR, "bin/cli.mjs"),
);
await chmod(join(DIST_DIR, "bin/cli.mjs"), 0o755);
console.log("[build] bin/cli.mjs");

// ── 3. Theme source (consumed by Vite, not by Node) ─────────────────────────
await mkdir(join(DIST_DIR, "src"), { recursive: true });
for (const dir of PACKAGE_SRC_DIRS) {
	const from = join(WORKSPACE_DIR, "src", dir);
	if (!existsSync(from)) {
		console.log(`[build] · src/${dir} (absent upstream)`);
		continue;
	}
	await cp(from, join(DIST_DIR, "src", dir), { recursive: true });
}
console.log(`[build] src/ (${PACKAGE_SRC_DIRS.length} directories)`);

// Ambient declarations the theme's own sources rely on.
for (const file of ["env.d.ts", "global.d.ts"]) {
	const from = join(WORKSPACE_DIR, "src", file);
	if (existsSync(from)) await cp(from, join(DIST_DIR, "src", file));
}

// ── 4. Public type declarations ─────────────────────────────────────────────
await mkdir(join(DIST_DIR, "types"), { recursive: true });
// `src/integration/types.ts` contains nothing but interfaces, so it doubles as
// a declaration file verbatim.
await cp(
	join(WORKSPACE_DIR, "src/integration/types.ts"),
	join(DIST_DIR, "types/options.d.ts"),
);

await writeFile(
	join(DIST_DIR, "index.d.ts"),
	`import type { AstroIntegration } from "astro";
import type { ShironesOptions } from "./types/options.js";

export type {
  ShironesOptions,
  ShironesPaths,
  ShironesFontOptions,
  ResolvedShironesPaths,
} from "./types/options.js";

/**
 * The Shirone theme as an Astro integration.
 */
export declare function shirones(options?: ShironesOptions): AstroIntegration;
export default shirones;
`,
	"utf8",
);

await writeFile(
	join(DIST_DIR, "collections.d.ts"),
	`export interface DefineCollectionsOptions {
  /** Directory holding \`posts/\`, \`moments/\` and \`spec/\`, relative to the project root. */
  contentDir?: string;
  paths?: {
    posts?: string;
    moments?: string;
    spec?: string;
  };
}

export declare function defineCollections(
  options?: DefineCollectionsOptions,
): Record<string, unknown>;

export default defineCollections;
`,
	"utf8",
);
console.log("[build] type declarations");

// ── 5. Dependency resolution ────────────────────────────────────────────────
// Rule of thumb from the Stalux write-up: anything imported by an injected
// route must be a real `dependency`, never a `devDependency`. Rather than
// trusting a regex scan alone, we start from the upstream dependency list and
// only drop things we know must not ship.
const dependencies = {};
for (const [name, range] of Object.entries(upstreamPkg.dependencies ?? {})) {
	if (EXCLUDED_DEPENDENCIES.has(name)) continue;
	dependencies[name] = range;
}
for (const [name, range] of Object.entries(EXTRA_DEPENDENCIES)) {
	dependencies[name] ??= range;
}

// Sanity check: warn about bare imports in the shipped source that are not
// declared anywhere. These become "is not a function" errors for users.
const declared = new Set([
	...Object.keys(dependencies),
	...Object.keys(PEER_DEPENDENCIES),
]);
const missing = new Set();
const IMPORT_RE = /(?:import|export)[\s\S]{0,200}?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function scanImports(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await scanImports(full);
			continue;
		}
		if (![".ts", ".js", ".mjs", ".astro", ".svelte"].includes(extname(entry.name))) {
			continue;
		}
		const source = await readFile(full, "utf8");
		for (const match of source.matchAll(IMPORT_RE)) {
			const specifier = match[1] ?? match[2];
			if (!specifier) continue;
			if (/^[./]/.test(specifier)) continue;
			if (specifier.startsWith("node:")) continue;
			if (specifier.startsWith("virtual:")) continue;
			if (specifier.startsWith("astro:")) continue;
			// Theme path aliases are rewritten by Vite, not resolved from npm.
			if (ALIAS_PREFIXES.some((prefix) => specifier.startsWith(prefix))) continue;
			const name = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			if (IGNORED_IMPORTS.has(name)) continue;
			if (!declared.has(name)) missing.add(name);
		}
	}
}

await scanImports(join(DIST_DIR, "src"));
if (missing.size > 0) {
	console.error(
		"[build] ✗ the shipped source imports packages that are not declared as " +
			"dependencies. Users would hit unresolved-import errors at build time:\n" +
			[...missing].sort().map((name) => `    - ${name}`).join("\n") +
			"\n  Add them to EXTRA_DEPENDENCIES in scripts/config.mjs.",
	);
	process.exit(1);
}
console.log(`[build] dependency scan clean (${Object.keys(dependencies).length} deps)`);

// ── 6. package.json ─────────────────────────────────────────────────────────
// Register the CLI under both `shirones` and the published package name so
// `pnpm ${PACKAGE_NAME} init` works alongside `npx shirones init`.
const bin = { shirones: "./bin/cli.mjs" };
if (PACKAGE_NAME !== "shirones") bin[PACKAGE_NAME] = "./bin/cli.mjs";

const pkg = {
	name: PACKAGE_NAME,
	version: PACKAGE_VERSION ?? "0.0.0",
	type: "module",
	description: upstreamPkg.description,
	license: upstreamPkg.license,
	// The theme's own package-manager pin, so `init` can echo it into the
	// user's package.json (see src/integration/cli.mjs).
	...(upstreamPkg.packageManager ? { packageManager: upstreamPkg.packageManager } : {}),
	author: PACKAGE_AUTHOR,
	homepage: PACKAGE_HOMEPAGE,
	// The published artefact is built and released from *this* repository, and
	// npm's provenance attestation refuses to publish when `repository.url`
	// points anywhere else (the upstream theme repo, in our case).
	repository: { type: "git", url: `git+${PACKAGE_REPOSITORY}.git` },
	bugs: { url: `${PACKAGE_REPOSITORY}/issues` },
	keywords: [...(upstreamPkg.keywords ?? []), "astro-integration"],
	bin,
	exports: {
		".": { types: "./index.d.ts", default: "./index.js" },
		"./collections": { types: "./collections.d.ts", default: "./collections.js" },
		"./types/*": "./src/types/*",
		// `./src/*` and `./template/*` exist so the Vite-side theme source and
		// the init templates are reachable; both are internal and not part of
		// the public API — see PACKAGE_README.md.
		"./src/*": "./src/*",
		"./template/*": "./template/*",
		"./package.json": "./package.json",
	},
	types: "./index.d.ts",
	files: [
		"index.js",
		"index.d.ts",
		"collections.js",
		"collections.d.ts",
		"bin/",
		"src/",
		"template/",
		"types/",
		"README.md",
	],
	dependencies,
	peerDependencies: PEER_DEPENDENCIES,
	engines: { node: ">=20.0.0" },
	publishConfig: { access: "public" },
};

await writeFile(
	join(DIST_DIR, "package.json"),
	`${JSON.stringify(pkg, null, 2)}\n`,
	"utf8",
);
console.log("[build] package.json");

// ── 7. README shipped with the package ──────────────────────────────────────
const readmeSource = join(resolve("."), "PACKAGE_README.md");
if (existsSync(readmeSource)) {
	const readme = (await readFile(readmeSource, "utf8")).replaceAll(
		"{{PACKAGE_NAME}}",
		PACKAGE_NAME,
	);
	await writeFile(join(DIST_DIR, "README.md"), readme, "utf8");
	console.log("[build] README.md");
}

// ── 8. Provenance ───────────────────────────────────────────────────────────
const sha = existsSync(join(WORKSPACE_DIR, ".synced-sha"))
	? (await readFile(join(WORKSPACE_DIR, ".synced-sha"), "utf8")).trim()
	: "unknown";
await writeFile(
	join(DIST_DIR, "build-info.json"),
	`${JSON.stringify(
		{
			package: PACKAGE_NAME,
			version: PACKAGE_VERSION ?? "0.0.0",
			upstreamSha: sha,
			builtAt: new Date().toISOString(),
			node: process.version,
		},
		null,
		2,
	)}\n`,
	"utf8",
);

// Report the final size so regressions are visible in CI logs.
try {
	const size = execFileSync("du", ["-sh", DIST_DIR], { encoding: "utf8" }).split("\t")[0];
	console.log(`[build] done — dist is ${size.trim()}`);
} catch {
	console.log("[build] done");
}
