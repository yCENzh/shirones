/**
 * Step 5 — prove the package actually works.
 *
 * Creates a throwaway Astro project exactly the way a user would:
 *
 *     npm pack ./dist
 *     pnpm add <package-tarball>
 *     pnpm <package> init
 *     pnpm build
 *
 * The packed tarball is deliberate: it verifies the npm `files` whitelist and
 * the exact artifact users install, not merely the source `dist/` directory.
 * Set `SHIRONES_VALIDATE_BUILD=0` to skip the Astro production/dev build while
 * keeping the tarball, scaffold, force-backup and `info` checks.
 */

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
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

const distPackage = JSON.parse(await readFile(join(DIST_DIR, "package.json"), "utf8"));
const astroRange = distPackage.peerDependencies?.astro ?? "^7.0.0";

// Validate the real npm artifact, not a directory dependency. `--json` gives
// us the filename without guessing how npm normalises scoped package names.
let packResult;
try {
	packResult = JSON.parse(
		execFileSync(
			"npm",
			["pack", DIST_DIR, "--pack-destination", TEST_DIR, "--json"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
		),
	);
} catch (error) {
	fail(`npm pack failed: ${error.message}`);
}
const tarballName = packResult?.[0]?.filename;
if (!tarballName) fail("npm pack did not report a tarball filename");
const tarballPath = resolve(TEST_DIR, tarballName);
if (!existsSync(tarballPath)) fail(`npm pack did not create ${tarballPath}`);
for (const required of [
	"build-info.json",
	"manifest.json",
	"bin/cli.mjs",
	"scripts/anime/providers/bangumi.mjs",
	"scripts/anime/providers/bilibili.mjs",
]) {
	if (!packResult[0].files?.some((file) => file.path === required)) {
		fail(`packed tarball is missing ${required}`);
	}
}
console.log(`[validate] ✓ packed ${tarballName} (${packResult[0].files?.length ?? 0} files)`);

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
				// Satisfies @astrojs/svelte's peer range (^5.3.3 || ^6.0.0) that
				// the tree's transitive typescript 4.9.x does not; a real Astro
				// project carries typescript anyway.
				typescript: "^5.3.3",
				[PACKAGE_NAME]: `file:${tarballPath}`,
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
// error-level: the install's own warnings (deprecated subdependencies, etc.)
// are upstream-dependency-tree noise and add nothing to the validation here.
run(packageManager, ["install", "--no-frozen-lockfile", "--loglevel=error"]);

console.log("[validate] running `init`");
run(packageManager, ["exec", "shirones", "init"]);

// `init` adds the theme's peer dependencies (svelte, the iconify collections)
// to package.json, exactly as a real user would then install them.
console.log("[validate] installing dependencies added by init");
run(packageManager, ["install", "--no-frozen-lockfile", "--loglevel=error"]);

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
if (!(await readFile(join(TEST_DIR, ".gitignore"), "utf8")).includes(".shirones-backup/")) {
	fail("generated .gitignore does not ignore .shirones-backup/");
}

// `--force` deliberately replaces the scaffold. The safety contract is that
// the complete previous tree is moved to `.shirones-backup/` first. Keep this
// regression test next to the real init flow so future CLI changes cannot
// silently delete the recovery copy.
const postFiles = (await readdir(join(TEST_DIR, CONTENT_ROOT, "content/posts")))
	.filter((name) => /\.(md|mdx)$/.test(name));
if (postFiles.length === 0) fail("init produced no post file for the force-safety check");
const forcePost = join(TEST_DIR, CONTENT_ROOT, "content/posts", postFiles[0]);
const forceMarker = "\n<!-- shirones validate force-safety marker -->\n";
await writeFile(forcePost, `${await readFile(forcePost, "utf8")}${forceMarker}`, "utf8");
const forcePublic = join(TEST_DIR, "public", ".shirones-validate-user-file");
await writeFile(forcePublic, "user-owned public asset\n", "utf8");
run(packageManager, ["exec", "shirones", "init", "--force"]);
if ((await readFile(forcePost, "utf8")).includes(forceMarker)) {
	fail("init --force did not replace user content from the template");
}
const backupPost = join(TEST_DIR, ".shirones-backup", CONTENT_ROOT, "content/posts", postFiles[0]);
const backupPublic = join(TEST_DIR, ".shirones-backup", "public", ".shirones-validate-user-file");
if (!existsSync(backupPost)) fail("init --force did not back up user content");
if (!existsSync(backupPublic)) fail("init --force did not back up a user public asset");
if (!existsSync(join(TEST_DIR, ".shirones-backup", "README.md"))) {
	fail("init --force did not preserve the replaced README in .shirones-backup");
}
console.log("[validate] ✓ init --force replaces the scaffold and backs up the previous copy");
console.log("[validate] running `info`");
run(packageManager, ["exec", "shirones", "info"]);

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
try {
	await checkDevServer();
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

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

	// pnpm is a launcher, so killing only its PID can leave Astro/Vite alive.
	// Start a process group and terminate the whole group before removing the
	// throwaway project. Otherwise Vite keeps watching the deleted directory
	// and floods the workflow with full-reload errors.
	const child = spawn(packageManager, ["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port)], {
		cwd: TEST_DIR,
		env: {
			...process.env,
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
		},
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32",
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

	const running = () => child.exitCode === null && child.signalCode === null;
	const waitForExit = async (timeoutMs) => {
		if (!running()) return;
		await Promise.race([
			once(child, "exit"),
			new Promise((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	};
	const signalTree = (signal) => {
		if (!running()) return;
		try {
			if (process.platform === "win32") child.kill(signal);
			else process.kill(-child.pid, signal);
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	};
	const stop = async () => {
		if (!running()) return;
		signalTree("SIGTERM");
		await waitForExit(5_000);
		if (running()) {
			signalTree("SIGKILL");
			await waitForExit(2_000);
		}
	};
	const devFail = (message) => {
		throw new Error(message);
	};

	try {
		const deadline = Date.now() + 120_000;
		while (!/ready in/i.test(output)) {
			if (!running()) devFail("the dev server exited before it was ready");
			if (Date.now() > deadline) devFail("the dev server did not become ready within 120s");
			await new Promise((r) => setTimeout(r, 500));
		}

		// `ready in` is printed a beat before the socket accepts connections.
		// Use one total deadline, rather than resetting a long timeout for every
		// retry. A broken dev server must fail the check, not hold the release.
		const get = async (route) => {
			const deadline = Date.now() + 30_000;
			let lastError;
			while (Date.now() < deadline) {
				const remaining = deadline - Date.now();
				try {
					return await fetch(`http://127.0.0.1:${port}${route}`, {
						signal: AbortSignal.timeout(Math.min(5_000, remaining)),
					});
				} catch (error) {
					lastError = error;
					await new Promise((r) =>
						setTimeout(r, Math.min(1_000, Math.max(0, deadline - Date.now()))),
					);
				}
			}
			throw new Error(
				`dev server did not respond for ${route} within 30s: ${lastError?.message ?? "unknown error"}`,
			);
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

		if (routes.length === 0) devFail("no dev-server routes could be selected");
		for (const route of routes) {
			const response = await get(route);
			const body = await response.text();
			if (!response.ok) devFail(`dev server returned ${response.status} for ${route}`);
			if (body.includes("astro-error") || body.includes("Internal server error")) {
				devFail(`dev server rendered an error page for ${route}`);
			}
			if (body.length < 500) devFail(`dev server returned a suspiciously small ${route}`);
			console.log(`  ${route} → ${response.status} (${body.length} bytes)`);
		}
		console.log(`[validate] ✓ dev server rendered ${routes.length} routes`);
	} finally {
		await stop();
	}
}
