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
		// Cold transforms are slow: the first homepage render compiles the
		// whole SSR graph, and module requests can queue behind dependency
		// optimization. Tight per-attempt timeouts made this flake on cold or
		// memory-constrained machines — and CI had never exercised these
		// values because the release workflow used to skip the dev phase.
		const get = async (route) => {
			const deadline = Date.now() + 120_000;
			let lastError;
			while (Date.now() < deadline) {
				const remaining = deadline - Date.now();
				try {
					return await fetch(`http://127.0.0.1:${port}${route}`, {
						signal: AbortSignal.timeout(Math.min(60_000, remaining)),
					});
				} catch (error) {
					lastError = error;
					await new Promise((r) =>
						setTimeout(r, Math.min(1_000, Math.max(0, deadline - Date.now()))),
					);
				}
			}
			throw new Error(
				`dev server did not respond for ${route} within 120s: ${lastError?.message ?? "unknown error"}`,
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
		const seedHtml = [];
		for (const route of routes) {
			const response = await get(route);
			const body = await response.text();
			if (!response.ok) devFail(`dev server returned ${response.status} for ${route}`);
			if (body.includes("astro-error") || body.includes("Internal server error")) {
				devFail(`dev server rendered an error page for ${route}`);
			}
			if (body.length < 500) devFail(`dev server returned a suspiciously small ${route}`);
			seedHtml.push(body);
			console.log(`  ${route} → ${response.status} (${body.length} bytes)`);
		}
		console.log(`[validate] ✓ dev server rendered ${routes.length} routes`);

		// Rendered HTML proves nothing about the *client* module graph: pages
		// are rendered server-side, while `vite:import-analysis` only runs when
		// the browser requests a module. The `@swup/astro` integration injects
		// a page script whose bare imports (`@swup/astro/serialise`,
		// `@swup/astro/idle`, `@swup/astro/client/*`) Vite transforms on demand
		// from the virtual module `astro:scripts/page.js`. When those failed to
		// resolve under pnpm's strict layout, every route above still returned
		// 200 and only the module 500'd — in a user's browser, not here.
		const injected = "/@id/astro:scripts/page.js";
		const scriptResponse = await get(injected);
		const scriptBody = await scriptResponse.text();
		if (!scriptResponse.ok) {
			devFail(`dev server returned ${scriptResponse.status} for ${injected}`);
		}
		if (scriptBody.includes("Failed to resolve import")) {
			devFail(`dev server could not resolve an import inside ${injected}`);
		}
		if (!scriptBody.includes("swup")) {
			devFail(`${injected} does not look like the injected page script`);
		}
		// A transformed module must reference real dev URLs. A bare package
		// specifier surviving in the output means the import was never
		// resolved — the exact shape of the 0.1.2 regression, asserted here
		// semantically so it cannot reappear through a different code path.
		if (/'@swup\/astro\//.test(scriptBody)) {
			devFail(`${injected} still contains bare @swup/astro specifiers instead of resolved URLs`);
		}
		console.log(`  ${injected} → ${scriptResponse.status} (${scriptBody.length} bytes)`);
		console.log("[validate] ✓ dev server transformed the injected page script");

		// ── Walk the client module graph the way a browser would ─────────────
		//
		// The injected script is one known regression; this crawl is the
		// generic net. Every <script> and stylesheet the rendered pages
		// reference is fetched, and every import inside those modules is
		// followed, so a resolution or transform failure anywhere in the
		// client graph fails here instead of in a user's devtools.
		const MAX_CRAWLED_MODULES = 600;
		const decode = (url) => url.replace(/&amp;/g, "&");
		const isCssUrl = (url) => /[.]css(\?|$)/.test(url) || url.includes("type=style");
		const scriptAndStyleUrls = (html) => {
			const urls = [];
			for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
				const src = tag[0].match(/\ssrc=["']([^"']+)["']/);
				if (src) urls.push(decode(src[1]));
			}
			for (const tag of html.matchAll(/<link\b[^>]*>/g)) {
				if (!/rel=["']stylesheet["']/.test(tag[0])) continue;
				const href = tag[0].match(/href=["']([^"']+)["']/);
				if (href) urls.push(decode(href[1]));
			}
			return urls.filter((url) => url.startsWith("/") && !url.startsWith("//"));
		};
		const importUrls = (js) => {
			const urls = [];
			for (const match of js.matchAll(
				/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
			)) {
				if (match[1].startsWith("/") && !match[1].startsWith("//")) urls.push(match[1]);
			}
			return urls;
		};
		// Upstream quirk (Vite 8 + Astro 7, probe-verified): Astro injects the
		// dev toolbar as a bare `/@id/astro/runtime/client/dev-toolbar/
		// entrypoint.js` URL with no `?v=` query, and that specifier is a
		// pre-bundled optimizer dep. Once a mid-session re-bundle wave lands,
		// the module graph keeps the bare URL pinned to the old browserHash
		// and answers 504 "Outdated Optimize Dep" indefinitely — for a real
		// browser reloading the page exactly as for this crawl. Nothing the
		// theme can fix, and the toolbar ships in no production build, so
		// such URLs are skipped with a warning. The match is deliberately
		// narrow (504 + unversioned URL + present in the current optimizer
		// metadata): theme modules are never metadata keys, so a genuine
		// resolution regression cannot hide behind this exemption.
		const skippedStaleDeps = new Set();
		const isStaleOptimizedDepSource = async (url) => {
			if (/[?&]v=/.test(url)) return false;
			const { pathname } = new URL(url, "http://127.0.0.1");
			const specifier = decodeURIComponent(pathname).replace(/^\/@id\//, "");
			try {
				const metadata = JSON.parse(
					await readFile(
						join(TEST_DIR, "node_modules", ".vite", "deps", "_metadata.json"),
						"utf8",
					),
				);
				return Boolean(metadata.optimized?.[specifier]);
			} catch {
				return false;
			}
		};
		const getModule = async (url) => {
			for (let tries = 0; ; tries += 1) {
				const response = await get(url);
				const body = await response.text();
				if (response.status === 504 || body.includes("Outdated Optimize Dep")) {
					if (await isStaleOptimizedDepSource(url)) {
						skippedStaleDeps.add(url);
						return null;
					}
					// Vite re-optimized dependencies mid-crawl and invalidated
					// the URLs we hold. A browser would full-reload; signal
					// the caller to re-seed from freshly rendered HTML.
					if (tries >= 6) {
						const stale = new Error(`module stayed stale after re-optimization: ${url}`);
						stale.stale = true;
						throw stale;
					}
					await new Promise((r) => setTimeout(r, 1_000));
					continue;
				}
				if (!response.ok) devFail(`dev server returned ${response.status} for module ${url}`);
				if (body.includes("Failed to resolve import")) {
					devFail(`dev server could not resolve an import inside ${url}`);
				}
				if ((response.headers.get("content-type") ?? "").includes("text/html")) {
					devFail(`module ${url} answered an HTML page instead of a transformed module`);
				}
				return body;
			}
		};
		const crawlModuleGraph = async (seeds) => {
			const seen = new Set();
			const queue = seeds.flatMap(scriptAndStyleUrls);
			while (queue.length > 0 && seen.size < MAX_CRAWLED_MODULES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const body = await getModule(url);
				// A null body is a skipped stale pre-bundled dep (see
				// isStaleOptimizedDepSource); there is nothing to follow.
				if (body && !isCssUrl(url)) queue.push(...importUrls(body));
			}
			return seen.size;
		};

		// The crawl itself feeds the optimizer: every newly discovered import
		// can trigger a re-bundle and full-reload wave that invalidates the
		// URLs we hold. Re-seeding into an active wave just collects stale
		// URLs again, so wait for the log to go quiet before re-fetching.
		const optimizerActivityRe =
			/\[optimizer\]|optimized dependencies changed|dependencies optimized|Forced re-optimization/g;
		const waitForOptimizerQuiescence = async () => {
			const deadline = Date.now() + 60_000;
			let lastCount = -1;
			let quietSince = Date.now();
			while (Date.now() < deadline) {
				const count = (output.match(optimizerActivityRe) ?? []).length;
				if (count !== lastCount) {
					lastCount = count;
					quietSince = Date.now();
				} else if (Date.now() - quietSince >= 5_000) {
					return;
				}
				await new Promise((r) => setTimeout(r, 1_000));
			}
		};

		let crawled = 0;
		let seeds = seedHtml;
		for (let attempt = 0; ; attempt += 1) {
			try {
				crawled = await crawlModuleGraph(seeds);
				break;
			} catch (error) {
				if (error?.stale && attempt < 5) {
					console.log(
						"[validate] dependencies re-optimized mid-crawl; waiting for the optimizer to settle, then re-seeding",
					);
					await waitForOptimizerQuiescence();
					seeds = [];
					for (const route of routes) seeds.push(await (await get(route)).text());
					continue;
				}
				throw error;
			}
		}
		const skipped = crawled - skippedStaleDeps.size;
		console.log(
			`[validate] ✓ dev module graph: ${skipped} modules transformed without errors`,
		);
		for (const url of skippedStaleDeps) {
			console.log(
				`[validate]   · skipped ${url} — pre-bundled by the dep optimizer, so it is ` +
					"stale until the dev server restarts (upstream Vite/Astro behaviour, not a theme module)",
			);
		}

		// The crawl vouches for the modules it fetched; the server log vouches
		// for everything else that happened while it ran (a module only an
		// interaction would load, a transform that failed between fetches…).
		const devErrorRe =
			/\[ERROR\]|Internal server error|Failed to resolve import|Transform failed|Pre-transform error|Failed to load url/;
		const loggedErrors = [
			...new Set(output.split("\n").filter((line) => devErrorRe.test(line))),
		]
			.slice(0, 5)
			.map((line) => `    ${line.trim()}`)
			.join("\n");
		if (loggedErrors) {
			devFail(`dev server logged errors while serving:\n${loggedErrors}`);
		}
		console.log("[validate] ✓ dev server log is clean");
	} finally {
		await stop();
	}
}
