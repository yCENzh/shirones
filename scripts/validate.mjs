/**
 * Step 5 — prove the package actually works.
 *
 * Creates a throwaway Astro project exactly the way a user would:
 *
 *     pnpm add <package>
 *     pnpm <package> init
 *     pnpm build
 *
 * Set `SHIRONES_VALIDATE_BUILD=0` to stop after `init` (useful on machines
 * without enough memory for a full Astro build).
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONTENT_ROOT, PACKAGE_NAME } from "./config.mjs";

const DIST_DIR = resolve("dist");
const TEST_DIR = resolve(".validate");

const runBuild = process.env.SHIRONES_VALIDATE_BUILD !== "0";
const packageManager = process.env.SHIRONES_PM ?? "pnpm";

function run(command, args, options = {}) {
	console.log(`  $ ${command} ${args.join(" ")}`);
	execFileSync(command, args, {
		cwd: TEST_DIR,
		stdio: "inherit",
		env: {
			...process.env,
			// Astro's build peaks well above the default heap on large themes.
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
		},
		...options,
	});
}

function fail(message) {
	console.error(`[validate] ✗ ${message}`);
	process.exit(1);
}

console.log("[validate] preparing throwaway project");

await rm(TEST_DIR, { recursive: true, force: true });
await mkdir(TEST_DIR, { recursive: true });

const astroRange =
	JSON.parse(await readFile(join(DIST_DIR, "package.json"), "utf8"))
		.peerDependencies?.astro ?? "^7.0.0";

await writeFile(
	join(TEST_DIR, "package.json"),
	`${JSON.stringify(
		{
			name: "shirones-validation",
			version: "0.0.0",
			private: true,
			type: "module",
			dependencies: {
				astro: astroRange,
				[PACKAGE_NAME]: `file:${DIST_DIR}`,
			},
			// Read by pnpm 10. pnpm 11 reads pnpm-workspace.yaml instead, written
			// just below; `init` sets up both in a real user's project.
			pnpm: {
				onlyBuiltDependencies: ["esbuild", "sharp"],
			},
		},
		null,
		2,
	)}\n`,
	"utf8",
);

// A bare `.npmrc` keeps pnpm from hoisting differently than a user's project.
await writeFile(join(TEST_DIR, ".npmrc"), "auto-install-peers=true\n", "utf8");

// Build-script approval. `allowBuilds` is pnpm 11, `onlyBuiltDependencies` is
// pnpm 10; `init` writes the same pair into a real user's project.
await writeFile(
	join(TEST_DIR, "pnpm-workspace.yaml"),
	[
		"allowBuilds:",
		"  esbuild: true",
		"  sharp: true",
		"onlyBuiltDependencies:",
		"  - esbuild",
		"  - sharp",
		"",
	].join("\n"),
	"utf8",
);

console.log("[validate] installing");
run(packageManager, ["install", "--no-frozen-lockfile"]);

console.log("[validate] running `init`");
run(packageManager, ["exec", "shirones", "init"]);

// `init` adds the theme's peer dependencies (svelte, the iconify collections)
// to package.json, exactly as a real user would then install them.
console.log("[validate] installing dependencies added by init");
run(packageManager, ["install", "--no-frozen-lockfile"]);

// ── Assert the scaffold matches the documented layout ───────────────────────
const expected = [
	"astro.config.mjs",
	"src/content.config.ts",
	`${CONTENT_ROOT}/config/siteConfig.ts`,
	`${CONTENT_ROOT}/config/data/friends.ts`,
	`${CONTENT_ROOT}/content/posts`,
	"public",
	"tsconfig.json",
	// Project root files shipped by the template (see prepare-templates.mjs §6).
	"README.md",
	".env.example",
	".gitignore",
	"AGENTS.md",
	"pagefind.yml",
	"frontmatter.json",
];

for (const relativePath of expected) {
	if (!existsSync(join(TEST_DIR, relativePath))) {
		fail(`init did not create ${relativePath}`);
	}
}
console.log(`[validate] ✓ scaffold contains ${expected.length} expected entries`);

// The user project must contain exactly one Astro config, at the root.
const strayConfigs = (await readdir(join(TEST_DIR, CONTENT_ROOT))).filter((name) =>
	name.startsWith("astro.config"),
);
if (strayConfigs.length > 0) {
	fail(`unexpected Astro config inside ${CONTENT_ROOT}/: ${strayConfigs.join(", ")}`);
}

if (!runBuild) {
	console.log("[validate] ✓ init verified (build skipped via SHIRONES_VALIDATE_BUILD=0)");
	process.exit(0);
}

console.log("[validate] building the scaffolded site");
run(packageManager, ["exec", "astro", "build"]);

// ── Assert the build produced the routes the manifest promises ──────────────
const manifest = JSON.parse(await readFile(join(DIST_DIR, "manifest.json"), "utf8"));
const outDir = join(TEST_DIR, "dist");

const staticRoutes = manifest.routes
	.map((route) => route.pattern)
	.filter((pattern) => !pattern.includes("["));

const missing = [];
for (const pattern of staticRoutes) {
	const clean = pattern.replace(/^\//, "");
	const candidates = clean.includes(".")
		? [join(outDir, clean)]
		: [join(outDir, clean, "index.html"), join(outDir, `${clean}.html`)];
	if (!candidates.some((candidate) => existsSync(candidate))) missing.push(pattern);
}

if (missing.length > 0) {
	fail(`build did not emit these routes: ${missing.join(", ")}`);
}
console.log(`[validate] ✓ ${staticRoutes.length} static routes emitted`);

if (!existsSync(join(outDir, "index.html"))) fail("no index.html produced");

// ── Prove the dev server boots and renders pages ────────────────────────────
await checkDevServer();

await rm(TEST_DIR, { recursive: true, force: true });
console.log("[validate] ✓ package validated");

/**
 * `astro dev` exercises a completely different code path from `astro build`:
 * no prerender bundle, on-demand transforms, the overlay plugin resolving
 * modules one request at a time. A build-only check would miss regressions
 * that only users in dev mode ever see, so boot the server and fetch a
 * representative set of routes.
 */
async function checkDevServer() {
	const port = 4331;
	console.log("[validate] booting the dev server");

	const child = spawn(packageManager, ["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port)], {
		cwd: TEST_DIR,
		env: {
			...process.env,
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let output = "";
	const collect = (chunk) => {
		output += chunk;
		process.stdout.write(chunk);
	};
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", collect);
	child.stderr.on("data", collect);

	const stop = () => {
		if (!child.killed) child.kill("SIGTERM");
	};

	try {
		const deadline = Date.now() + 120_000;
		while (!/ready in/i.test(output)) {
			if (child.exitCode !== null) fail("the dev server exited before it was ready");
			if (Date.now() > deadline) fail("the dev server did not become ready within 120s");
			await new Promise((r) => setTimeout(r, 500));
		}

		// `ready in` is printed a beat before the socket accepts connections.
		const get = async (route) => {
			let lastError;
			for (let attempt = 0; attempt < 20; attempt += 1) {
				try {
					return await fetch(`http://127.0.0.1:${port}${route}`, {
						signal: AbortSignal.timeout(120_000),
					});
				} catch (error) {
					lastError = error;
					await new Promise((r) => setTimeout(r, 1000));
				}
			}
			throw lastError;
		};

		// Pick dev-server routes from what actually exists: hard-coding page
		// paths (e.g. a specific demo post) breaks the moment upstream renames
		// or deletes them. Prefer the manifest's static routes, plus one real
		// article for the dynamic [...slug] route discovered from the scaffold.
		//
		// The theme serves with `trailingSlash: "always"` (set in
		// src/integration/index.ts), so page URLs live under `/about/` while
		// file endpoints (rss.xml, robots.txt) keep no slash. Requesting
		// `/about` without the slash 404s in dev, so canonicalize each URL.
		const fileLike = /\/[^/]+\.[^/]+$/;
		const canonicalUrl = (pattern) =>
			pattern === "/" || fileLike.test(pattern) ? pattern : `${pattern}/`;

		const staticPatterns = new Set(manifest.routes.map((route) => route.pattern));
		// Manifest patterns carry no trailing slash; match against those, then
		// add it. "/" is always kept: the homepage is the dynamic /[...page]
		// route, so it never appears as a static manifest pattern.
		const routes = ["/", "/about", "/archive", "/moments", "/rss.xml"]
			.filter((pattern) => pattern === "/" || staticPatterns.has(pattern))
			.map(canonicalUrl);

		const postsPattern = manifest.routes.find(
			(route) =>
				route.pattern.startsWith("/posts/") && route.pattern.includes("[...slug]"),
		)?.pattern;
		const postsDir = join(TEST_DIR, CONTENT_ROOT, "content", "posts");
		const firstPost = existsSync(postsDir)
			? (await readdir(postsDir)).find((name) => /\.(md|mdx)$/.test(name))
			: undefined;
		if (postsPattern && firstPost) {
			// A post is always an HTML page, so it always gets the trailing
			// slash under trailingSlash: "always" — even if its slug happens
			// to contain a dot.
			routes.push(
				`${postsPattern.replace("[...slug]", firstPost.replace(/\.(md|mdx)$/, ""))}/`,
			);
		}

		if (routes.length === 0) fail("no dev-server routes could be selected");
		for (const route of routes) {
			const response = await get(route);
			const body = await response.text();
			if (!response.ok) fail(`dev server returned ${response.status} for ${route}`);
			if (body.includes("astro-error") || body.includes("Internal server error")) {
				fail(`dev server rendered an error page for ${route}`);
			}
			if (body.length < 500) fail(`dev server returned a suspiciously small ${route}`);
			console.log(`  ${route} → ${response.status} (${body.length} bytes)`);
		}
		console.log(`[validate] ✓ dev server rendered ${routes.length} routes`);
	} finally {
		stop();
	}
}
