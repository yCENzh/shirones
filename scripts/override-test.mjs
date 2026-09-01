#!/usr/bin/env node
/**
 * Full override-coverage test for the shirones package.
 *
 * Proves the theme's override system end-to-end, the way a user hits it:
 *
 *     pnpm add <shirones tarball>
 *     ./node_modules/.bin/shirones init        (equivalent to `npx shirones init`)
 *     pnpm build                                (baseline, no overrides)
 *     … drop overrides into shirones/config, src/components, src/layouts …
 *     pnpm build                                (every override must win)
 *
 * Coverage, all asserted:
 *   1. config  — all 23 `shirones/config/*.ts` modules load from the user's
 *                copy (each carries an injected `__OVRMARK__` export, grepped
 *                in the built JS); `siteConfig.title` / `profileConfig.name`
 *                are rewritten to visible "OVR …" strings and must render.
 *   2. data    — all 8 `shirones/config/data/*.ts` modules get an injected
 *                "OVR … MARKER" entry that must render on its page.
 *   3. components/layouts — every `.astro`/`.svelte` under the package's
 *                `src/components` + `src/layouts` is mirrored into the user
 *                project with a `data-ovrmark` span; every *reachable*
 *                component must render its marker. Components the 23 routes
 *                never import (the bundled Material-3 atom library, feature-
 *                gated widgets, integration-loaded files) are expected absent
 *                and listed in KNOWN_UNREACHABLE below.
 *   4. explicit map — `components: { "atoms/blog/PostCard": … }` in
 *                `astro.config.mjs` must redirect the atom to the test stub.
 *   5. no `localhost:4321` may leak into the built site (canonical-URL fix).
 *
 * Env:
 *   SHIRONES_UPSTREAM_REPO / SHIRONES_UPSTREAM_REF — theme to package (see
 *       scripts/config.mjs; default upstream main).
 *   SHIRONES_OVERTEST_SKIP_BUILD=1 — reuse an already-built `dist/` instead of
 *       re-running templates → build.
 *   SHIRONES_PM — package manager (default `pnpm`).
 *
 * Exit code 0 only when every assertion passes. A failure leaves the throwaway
 * project under `<repo>/.override-test/` for inspection.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME } from "./config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(ROOT, "dist");
const TEST_DIR = join(ROOT, ".override-test");
const PM = process.env.SHIRONES_PM ?? "pnpm";

const failures = [];
function check(ok, message) {
	console.log(`  ${ok ? "✓" : "✗"} ${message}`);
	if (!ok) failures.push(message);
}

// ── helpers ─────────────────────────────────────────────────────────────────
function run(cmd, args, cwd) {
	console.log(`$ ${cmd} ${args.join(" ")}`);
	execFileSync(cmd, args, {
		cwd,
		stdio: "inherit",
		env: {
			...process.env,
			NODE_OPTIONS: `--max-old-space-size=4096`,
		},
	});
}

function runNode(script) {
	run(process.execPath, [join(ROOT, "scripts", script)], ROOT);
}

/** Recursively walk `dir`, returning absolute file paths. */
function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

/** Count files under `dir` whose content contains `pattern` (literal). */
function grepFiles(dir, pattern) {
	return walk(dir).filter((f) => {
		try {
			return readFileSync(f, "utf8").includes(pattern);
		} catch {
			return false;
		}
	}).length;
}

/** Unique values of `pattern`'s capture group across all files under `dir`. */
function grepUnique(dir, regex) {
	const found = new Set();
	for (const f of walk(dir)) {
		let text;
		try {
			text = readFileSync(f, "utf8");
		} catch {
			continue;
		}
		const globalRegex = new RegExp(
			regex.source,
			regex.flags.includes("g") ? regex.flags : `${regex.flags}g`,
		);
		for (const m of text.matchAll(globalRegex)) found.add(m[1]);
	}
	return found;
}

// ── 0. package the theme ────────────────────────────────────────────────────
if (process.env.SHIRONES_OVERTEST_SKIP_BUILD !== "1") {
	runNode("prepare-templates.mjs");
	runNode("build-package.mjs");
}
if (!existsSync(join(DIST_DIR, "package.json"))) {
	console.error("[override-test] dist/package.json missing — build the package first.");
	process.exit(1);
}

const pkgJson = JSON.parse(readFileSync(join(DIST_DIR, "package.json"), "utf8"));
const tarball = join(DIST_DIR, `${pkgJson.name.replace("/", "-")}-${pkgJson.version}.tgz`);
rmSync(tarball, { force: true });
run("npm", ["pack", DIST_DIR, "--pack-destination", DIST_DIR, "--silent"], ROOT);
if (!existsSync(tarball)) {
	console.error(`[override-test] pack produced no tarball at ${tarball}`);
	process.exit(1);
}

const astroRange = pkgJson.peerDependencies?.astro ?? "^7.0.0";

// ── 1. fresh user project ───────────────────────────────────────────────────
console.log(`\n[override-test] scaffolding ${TEST_DIR}`);
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

writeFileSync(
	join(TEST_DIR, "package.json"),
	`${JSON.stringify(
		{
			name: "shirones-override-test",
			version: "0.0.0",
			private: true,
			type: "module",
			dependencies: { astro: astroRange, [PACKAGE_NAME]: `file:${tarball}` },
		},
		null,
		2,
	)}\n`,
	"utf8",
);
// pnpm 11 reads build-script approvals from an `allowBuilds` map in
// pnpm-workspace.yaml (what `init` writes for the user); pre-approve so the
// install is clean. pnpm 10 reads `onlyBuiltDependencies`; write both.
writeFileSync(
	join(TEST_DIR, "pnpm-workspace.yaml"),
	"allowBuilds:\n  esbuild: true\n  sharp: true\nonlyBuiltDependencies:\n  - esbuild\n  - sharp\n",
	"utf8",
);
writeFileSync(join(TEST_DIR, ".npmrc"), "auto-install-peers=true\n", "utf8");

run(PM, ["install"], TEST_DIR);

// `npx shirones init` resolves the local bin and runs it directly; invoke the
// bin the same way. (`pnpm exec shirones init` currently trips pnpm 11's
// ignored-builds pre-check on a bare install — see the pnpm-11 caveat below.)
const bin = join(TEST_DIR, "node_modules", ".bin", PACKAGE_NAME);
if (!existsSync(bin)) {
	console.error("[override-test] init binary not found after install");
	process.exit(1);
}
run(bin, ["init"], TEST_DIR);

// ── 2. baseline build (no overrides) ────────────────────────────────────────
console.log("\n[override-test] build A — baseline");
run(PM, ["build"], TEST_DIR);
{
	const bad = grepFiles(join(TEST_DIR, "dist"), "localhost:4321");
	check(bad === 0, `baseline: no localhost:4321 leak (found ${bad})`);
	const ovr = grepFiles(join(TEST_DIR, "dist"), "data-ovrmark");
	check(ovr === 0, `baseline: no override markers present (found ${ovr})`);
}

// ── 3. inject overrides ─────────────────────────────────────────────────────
console.log("\n[override-test] injecting overrides");
const PKG_SRC = join(TEST_DIR, "node_modules", PACKAGE_NAME, "src");
const markerOf = (rel) =>
	rel.replace(/[\\/]/g, "-").replace(/\.(astro|svelte|ts|js|mts|mjs|cjs)$/i, "");

// 3a. config modules — append `__OVRMARK__`, rewrite visible fields.
const configDir = join(TEST_DIR, "shirones", "config");
for (const name of readdirSync(configDir).filter((f) => f.endsWith(".ts"))) {
	const file = join(configDir, name);
	let src = readFileSync(file, "utf8");
	if (name === "siteConfig.ts") {
		src = src.replace(/title:\s*"[^"]*"/, 'title: "OVR SITE TITLE"');
		src = src.replace(/subtitle:\s*"[^"]*"/, 'subtitle: "OVR SITE SUBTITLE"');
	} else if (name === "profileConfig.ts") {
		src = src.replace(/name:\s*"[^"]*"/, 'name: "OVR PROFILE NAME"');
	}
	const stem = name.replace(/\.ts$/, "");
	if (!src.includes("__OVRMARK__")) src += `\nexport const __OVRMARK__ = "CFG_${stem}";\n`;
	writeFileSync(file, src, "utf8");
}

// 3b. data modules — insert one "OVR … MARKER" entry per array.
const dataDir = join(TEST_DIR, "shirones", "config", "data");
const ENTRIES = {
	"friends.ts": '{ id: 9999, title: "OVR FRIEND MARKER", imgurl: "https://example.com/ovr.png", desc: "OVR friend override marker", siteurl: "https://ovr.example.com", tags: ["OVRTEST"] }',
	"projects.ts": '{ key: "ovr-project", title: "OVR PROJECT MARKER", summary: "OVR project override marker", category: "theme", phase: "building", technologies: ["OVR"], icon: "material-symbols:circle-outline", cover: "/assets/projects/shirone.webp", coverAlt: "OVR", featured: true, repository: "https://ovr.example.com", year: "2026" }',
	"skills.ts": '{ name: "OVR SKILL MARKER", description: "OVR skill override marker", icon: "simple-icons:circle", category: "frontend", level: "advanced" }',
	"devices.ts": '{ id: "ovr-device", name: "OVR DEVICE MARKER", brand: "OVR", category: "desk", status: "active", specs: "OVR", description: "OVR device override marker", icon: "material-symbols:circle-outline", featured: false, year: "2026", link: "https://ovr.example.com" }',
	"timeline.ts": '{ title: "OVR TIMELINE MARKER", date: "2026.08", category: "milestone", subtitle: "OVR", description: "OVR timeline override marker", highlights: ["OVR"], tags: ["OVR"], links: [] }',
	"compass.ts": '{ key: "ovr", name: "OVR COMPASS MARKER", icon: "material-symbols:circle-outline", blurb: "OVR compass override marker", entries: [{ label: "OVR COMPASS ENTRY", href: "https://ovr.example.com", note: "OVR marker" }] }',
	"anime.ts": '{ title: "OVR ANIME MARKER", status: "completed", rating: 9, description: "OVR anime override marker", year: "2026", genres: ["OVR"], progress: { watched: 12, total: 12 } }',
	"music.ts": '{ id: "ovr-track", title: "OVR MUSIC MARKER", artist: "OVR", cover: "assets/images/music/ovr.webp", source: "/assets/music/ovr.mp3", duration: 60 }',
};
for (const [name, entry] of Object.entries(ENTRIES)) {
	const file = join(dataDir, name);
	let src = readFileSync(file, "utf8");
	if (src.includes("OVR ")) continue; // idempotent
	src = src.replace(/^(\s*)\]\s*;?\s*$/m, (m, indent) => `\t${entry},\n${indent}${m.trimEnd()}`);
	writeFileSync(file, src, "utf8");
}

// 3c. components + layouts — mirror every file and inject a marker.
const SKIP = new Set(["atoms/manifest.json", "AGENTS.md"]);
for (const root of ["components", "layouts"]) {
	const dir = join(PKG_SRC, root);
	if (!existsSync(dir)) continue;
	for (const abs of walk(dir)) {
		const rel = relative(PKG_SRC, abs).replace(/\\/g, "/");
		if (SKIP.has(rel) || rel.endsWith(".md")) continue;
		const isLayout = rel.startsWith("layouts/");
		const base = rel.replace(/^(components|layouts)\//, "");
		const target = join(TEST_DIR, "src", isLayout ? "layouts" : "components", base);
		mkdirSync(dirname(target), { recursive: true });
		const src = readFileSync(abs, "utf8");
		const mark = markerOf(rel);
		if (abs.endsWith(".astro")) {
			writeFileSync(target, `${src}\n<span data-ovrmark="${mark}" hidden></span>\n`, "utf8");
		} else if (abs.endsWith(".svelte")) {
			const idx = src.lastIndexOf("</script>");
			const span = `<span data-ovrmark="${mark}" hidden></span>`;
			const next = idx === -1 ? `${span}\n${src}` : `${src.slice(0, idx + 9)}\n${span}\n${src.slice(idx + 9)}`;
			writeFileSync(target, next, "utf8");
		} else {
			writeFileSync(target, src, "utf8");
		}
	}
}

// 3d. explicit components map.
const stub = join(TEST_DIR, "src", "components", "ExplicitMapOverride.astro");
mkdirSync(dirname(stub), { recursive: true });
writeFileSync(
	stub,
	'---\ninterface Props {\n\t[key: string]: unknown;\n}\nconst {} = Astro.props;\n---\n<div data-ovrmark="EXPLICIT_MAP_PostCard">OVR EXPLICIT MAP POSTCARD</div>\n',
	"utf8",
);
const astroCfgFile = join(TEST_DIR, "astro.config.mjs");
let astroCfg = readFileSync(astroCfgFile, "utf8");
const withMap = astroCfg.replace(
	/\/\/ components: \{\s*"atoms\/blog\/PostCard":\s*"[^"]+",?\s*\},/,
	'components: { "atoms/blog/PostCard": "./src/components/ExplicitMapOverride.astro" },',
);
if (withMap === astroCfg) {
	console.error("[override-test] could not find the commented components map in astro.config.mjs");
	process.exit(1);
}
writeFileSync(astroCfgFile, withMap, "utf8");

// ── 4. override build ───────────────────────────────────────────────────────
console.log("\n[override-test] build B — overrides");
run(PM, ["build"], TEST_DIR);
const dist = join(TEST_DIR, "dist");

// 4a. config — the integration loads some modules itself (Node-side, cached
//     into `.shirones/loaded/`); those must carry the user's CFG marker. The
//     rest are imported by pages through the Vite overlay (the same Case-0
//     path the component markers prove). Visible fields must render.
{
	const injected = grepUnique(configDir, /__OVRMARK__\s*=\s*"([^"]+)"/);
	const LOADED_CONFIG = [
		"siteConfig",
		"sidebarConfig",
		"expressiveCodeConfig",
		"fontConfig",
		"musicConfig",
		"umamiConfig",
	];
	const manifest = grepUnique(join(TEST_DIR, ".shirones", "loaded"), /(CFG_[A-Za-z0-9]+)/);
	const missing = LOADED_CONFIG.filter((m) => !manifest.has(`CFG_${m}`));
	// 23 = every `src/config/*.ts` except `index.ts` + `README.md` (the
	// templates skip both). Upstream added `contextMenuConfig.ts`, bumping the
	// count from 22 → 23; when upstream adds/removes a config module, update
	// this number so drift in the scaffolded config surface stays visible.
	check(injected.size === 23, `config: all 23 modules injected (got ${injected.size})`);
	check(missing.length === 0, `config: ${LOADED_CONFIG.length} load-config modules overridden${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
	check(grepFiles(dist, "OVR SITE TITLE") > 0, "config: OVR SITE TITLE renders");
	check(grepFiles(dist, "OVR PROFILE NAME") > 0, "config: OVR PROFILE NAME renders");
}

// 4b. data: every injected entry renders.
const DATA_MARKERS = [
	"OVR FRIEND MARKER",
	"OVR PROJECT MARKER",
	"OVR SKILL MARKER",
	"OVR DEVICE MARKER",
	"OVR TIMELINE MARKER",
	"OVR COMPASS MARKER",
	"OVR ANIME MARKER",
	"OVR MUSIC MARKER",
];
{
	const missing = DATA_MARKERS.filter((marker) => grepFiles(dist, marker) === 0);
	check(missing.length === 0, `data: ${DATA_MARKERS.length} modules overridden${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
}

// 4c. components: reachable components must render; the rest must be the
//     known-unreachable set (bundled M3 atoms never imported by any route,
//     feature-gated widgets, integration-loaded files, explicit-map shadowed).
const KNOWN_UNREACHABLE = new Set([
	// Unused Material-3 atom library (no route imports them).
	"components-atoms-action-ButtonGroup",
	"components-atoms-action-FABMenu",
	"components-atoms-action-SplitButton",
	"components-atoms-action-ToggleButton",
	"components-atoms-display-BadgedBox",
	"components-atoms-display-Carousel",
	"components-atoms-display-DataTable",
	"components-atoms-display-ListItem",
	"components-atoms-feedback-PullToRefresh",
	"components-atoms-input-Autocomplete",
	"components-atoms-input-DateInput",
	"components-atoms-input-DatePicker",
	"components-atoms-input-DateRangePicker",
	"components-atoms-input-ExposedDropdownMenu",
	"components-atoms-input-SearchBar",
	"components-atoms-input-SearchView",
	"components-atoms-input-Select",
	"components-atoms-input-TimePicker",
	"components-atoms-navigation-AppBar",
	"components-atoms-navigation-NavigationBar",
	"components-atoms-navigation-NavigationDrawer",
	"components-atoms-navigation-NavigationRail",
	"components-atoms-navigation-Tabs",
	"components-atoms-overlay-AlertDialog",
	"components-atoms-overlay-Banner",
	"components-atoms-overlay-BottomSheet",
	"components-atoms-overlay-SheetSide",
	"components-atoms-selection-RadioButton",
	"components-molecules-ButtonLink",
	"components-molecules-ButtonTag",
	"components-organisms-BackToTop",
	// Feature-gated (comments disabled, no umami configured in this test).
	"components-organisms-comment-CommentSection",
	"components-organisms-comment-Twikoo",
	"components-system-UmamiRuntime",
	// Loaded by the integration, not through import resolution.
	"components-system-GlobalStyles",
	// Shadowed by the explicit components map (see step 3d).
	"components-atoms-blog-PostCard",
	"components-atoms-blog-TagBadge",
]);
{
	const injected = grepUnique(join(TEST_DIR, "src"), /data-ovrmark="([^"]+)"/);
	const rendered = grepUnique(dist, /data-ovrmark="([^"]+)"/);
	const foreign = [...rendered].filter((m) => !injected.has(m));
	const gap = [...injected].filter((m) => !rendered.has(m));
	const unexpected = gap.filter((m) => !KNOWN_UNREACHABLE.has(m));
	const expectedButMissing = [...KNOWN_UNREACHABLE].filter((m) => injected.has(m) && rendered.has(m));
	check(foreign.length === 0, `components: no foreign markers (${foreign.length})`);
	check(unexpected.length === 0, `components: ${rendered.size}/${injected.size} rendered, every gap expected${unexpected.length ? ` — UNEXPECTED: ${unexpected.join(", ")}` : ""}`);
	check(expectedButMissing.length === 0, `components: no known-unreachable marker unexpectedly rendered (${expectedButMissing.length})`);
}

// 4d. explicit map + canonical URL.
{
	check(grepFiles(dist, "OVR EXPLICIT MAP POSTCARD") > 0, "explicit map: atoms/blog/PostCard redirected to the stub");
	const bad = grepFiles(dist, "localhost:4321");
	check(bad === 0, `canonical URL: no localhost:4321 leak (found ${bad})`);
}

// ── 5. verdict ──────────────────────────────────────────────────────────────
console.log("");
if (failures.length) {
	console.error(`[override-test] ✗ ${failures.length} failure(s):`);
	for (const f of failures) console.error(`  - ${f}`);
	console.error(`[override-test] project left at ${TEST_DIR} for inspection`);
	process.exit(1);
}
console.log("[override-test] ✓ all override-coverage assertions passed");
console.log(`[override-test] cleaning ${TEST_DIR}`);
rmSync(TEST_DIR, { recursive: true, force: true });
