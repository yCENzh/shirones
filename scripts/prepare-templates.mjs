/**
 * Step 2 — turn upstream source into the `template/` tree that
 * `shirones init` copies into a user's project.
 *
 * The interesting part is import rewriting. Upstream, a config module sits at
 * `src/config/musicConfig.ts` and reaches its neighbours with relative paths:
 *
 *     import { musicTracks } from "../data/music.ts";
 *     import type { FontConfig } from "../types/fontConfig.ts";
 *
 * In a user's project the same file lives at `shirones/config/musicConfig.ts`,
 * where `../data/` and `../types/` point at nothing. So relative escapes are
 * rewritten to the theme's `@/` alias (which the integration maps into the
 * installed package), except `../data/`, which becomes `./data/` because the
 * data modules are scaffolded alongside the config as `shirones/config/data/`.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { CONTENT_ROOT, PACKAGE_NAME } from "./config.mjs";

const WORKSPACE_DIR = resolve("workspace");
const TEMPLATE_DIR = resolve("dist/template");

const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

/**
 * Rewrite rules applied to files moved from `src/config/` into
 * `<CONTENT_ROOT>/config/`.
 */
const CONFIG_REWRITES = [
	// The data modules travel with the config, one level down.
	[/(["'])\.\.\/data\//g, "$1./data/"],
	// Paths a config file hands to the theme are resolved against the *user's*
	// project root, where `src/data/` does not exist. The anime snapshot cache
	// is the one such default; keep it beside the data modules it belongs to.
	// Not delimiter-anchored on purpose: the same path appears in the doc
	// comment above the option, and a comment that contradicts the value is
	// worse than no comment.
	[/src\/data\/anime-snapshots/g, `${CONTENT_ROOT}/config/data/anime-snapshots`],
	// Everything else that escapes upward now lives inside the package.
	[/(["'])\.\.\/(types|utils|constants|i18n|generated|components|layouts|styles|assets|plugins)\//g, "$1@/$2/"],
];

/**
 * Rewrite rules applied to files moved from `src/data/` into
 * `<CONTENT_ROOT>/config/data/`.
 */
const DATA_REWRITES = [
	[/(["'])\.\.\/(types|utils|constants|i18n|generated|components|layouts|styles|assets|plugins)\//g, "$1@/$2/"],
	// `../config/x` from a data module resolves to a sibling of its new parent.
	[/(["'])\.\.\/config\//g, "$1../"],
];

function applyRewrites(source, rules) {
	let output = source;
	for (const [pattern, replacement] of rules) {
		output = output.replace(pattern, replacement);
	}
	return output;
}

/**
 * Copy a directory, rewriting imports in source files and passing everything
 * else through untouched.
 */
/** Apply rewrite rules to files already copied into the template. */
async function rewriteInPlace(dir, extensions, rules) {
	if (!existsSync(dir)) return 0;
	let changed = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const target = join(dir, entry.name);
		if (entry.isDirectory()) {
			changed += await rewriteInPlace(target, extensions, rules);
			continue;
		}
		if (!extensions.has(extname(entry.name))) continue;
		const original = await readFile(target, "utf8");
		const rewritten = applyRewrites(original, rules);
		if (rewritten !== original) {
			await writeFile(target, rewritten, "utf8");
			changed += 1;
		}
	}
	return changed;
}

async function copyWithRewrites(from, to, rules, { skip = () => false } = {}) {
	if (!existsSync(from)) return 0;
	await mkdir(to, { recursive: true });

	let count = 0;
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const source = join(from, entry.name);
		const target = join(to, entry.name);
		if (skip(entry.name, entry)) continue;

		if (entry.isDirectory()) {
			count += await copyWithRewrites(source, target, rules, { skip });
			continue;
		}

		if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
			const original = await readFile(source, "utf8");
			await writeFile(target, applyRewrites(original, rules), "utf8");
		} else {
			await cp(source, target);
		}
		count += 1;
	}
	return count;
}

console.log("[templates] building template tree");

await rm(TEMPLATE_DIR, { recursive: true, force: true });
await mkdir(TEMPLATE_DIR, { recursive: true });

// ── 1. Configuration ────────────────────────────────────────────────────────
// `index.ts` is the package's barrel and stays package-owned; shipping it to
// users would let them break the named-export contract the theme relies on.
const configCount = await copyWithRewrites(
	join(WORKSPACE_DIR, "src/config"),
	join(TEMPLATE_DIR, CONTENT_ROOT, "config"),
	CONFIG_REWRITES,
	{ skip: (name) => name === "index.ts" || name === "README.md" },
);
console.log(`[templates] config: ${configCount} files`);

// ── 2. Data modules ─────────────────────────────────────────────────────────
const dataCount = await copyWithRewrites(
	join(WORKSPACE_DIR, "src/data"),
	join(TEMPLATE_DIR, CONTENT_ROOT, "config/data"),
	DATA_REWRITES,
	{ skip: (name) => name === "anime-snapshots" },
);
console.log(`[templates] config/data: ${dataCount} files`);

// ── 2b. Rewrite self-check ──────────────────────────────────────────────────
// Every `../<dir>/` escape from `src/config` and `src/data` that points into a
// theme directory is rewritten above (`../data/` → `./data/`, `../types/` →
// `@/types/`, `../config/` → `../`). Any such import surviving the rewrite
// means upstream added a relative-import shape the rules do not cover. Fail
// here rather than letting the user's build die with an opaque resolution
// error. A bare `../file` (data → sibling config) is the one legal escape.
const ESCAPED_IMPORT =
	/from\s+["']\.\.\/(types|utils|constants|i18n|generated|components|layouts|styles|assets|plugins|data|config)\//;
async function assertNoEscapedImports(dir) {
	if (!existsSync(dir)) return;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await assertNoEscapedImports(full);
			continue;
		}
		if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
		const source = await readFile(full, "utf8");
		const match = source.match(ESCAPED_IMPORT);
		if (match) {
			throw new Error(
				`[templates] ${full} still imports ${match[0]} upward — the rewrite ` +
					"rules in prepare-templates.mjs do not cover this shape. Add a rule " +
					"before publishing.",
			);
		}
	}
}
await assertNoEscapedImports(join(TEMPLATE_DIR, CONTENT_ROOT, "config"));

// ── 3. Content ──────────────────────────────────────────────────────────────
/**
 * Rewrites applied to the example articles.
 *
 * `@[code-tree](...)` scans a real directory of the project it renders in, so
 * a demo pointing at the theme's own `/src/config` silently renders nothing in
 * a user's project. The same files are scaffolded to `<CONTENT_ROOT>/config`,
 * which keeps the demo (and its `entry="siteConfig.ts"`) working there.
 *
 * `remark-includes` resolves `@include:` paths against the project root
 * (`process.cwd()` in both modes — Astro renders content with an unset vfile
 * path here), and the theme's `src/content/snippets/` is scaffolded to
 * `<CONTENT_ROOT>/content/snippets/`, so the includes demo needs the same
 * treatment or it silently stays literal.
 */
const CONTENT_REWRITES = [
	[/\]\(\/src\/config\)/g, `](/${CONTENT_ROOT}/config)`],
	[/src\/content\/snippets\//g, `${CONTENT_ROOT}/content/snippets/`],
];

const CONTENT_TEXT_EXTENSIONS = new Set([".md", ".mdx"]);

const contentSource = join(WORKSPACE_DIR, "src/content");
const contentTarget = join(TEMPLATE_DIR, CONTENT_ROOT, "content");
if (existsSync(contentSource)) {
	await cp(contentSource, contentTarget, { recursive: true });
	const rewritten = await rewriteInPlace(
		contentTarget,
		CONTENT_TEXT_EXTENSIONS,
		CONTENT_REWRITES,
	);
	console.log(`[templates] content: copied (${rewritten} articles rewritten)`);
}

// ── 4. Static assets ────────────────────────────────────────────────────────
const publicSource = join(WORKSPACE_DIR, "public");
if (existsSync(publicSource)) {
	await cp(publicSource, join(TEMPLATE_DIR, "public"), { recursive: true });
	console.log("[templates] public: copied");
}

// ── 5. Astro entry files ────────────────────────────────────────────────────
await mkdir(join(TEMPLATE_DIR, "src"), { recursive: true });

await writeFile(
	join(TEMPLATE_DIR, "src/content.config.ts"),
	`import { defineCollections } from "${PACKAGE_NAME}/collections";

/**
 * Shirone ships the collection schemas, so this file stays a one-liner.
 * Pass options if you moved the content directory:
 *
 *   defineCollections({ contentDir: "content" })
 */
export const collections = defineCollections();
`,
	"utf8",
);

await writeFile(
	join(TEMPLATE_DIR, "astro.config.mjs"),
	`import { defineConfig } from "astro/config";
import shirones from "${PACKAGE_NAME}";

// Site-level settings (site URL, base, title, theme colour, fonts, …) live in
// \`${CONTENT_ROOT}/config/\` so they stay typed and version-controlled with your
// content. This file only wires the theme in.
export default defineConfig({
  integrations: [
    shirones({
      // Override individual components by mirroring the theme's structure in
      // \`src/components/\`, or point at them explicitly:
      // components: { "atoms/blog/PostCard": "./src/components/PostCard.astro" },
    }),
  ],
});
`,
	"utf8",
);

// ── 6. Project root files ───────────────────────────────────────────────────
// Files a user would otherwise miss. `init` installs each one without
// overwriting anything the user already has, so shipping them here is safe.

// Verbatim copies from the theme repo.
const ROOT_FILES = [".env.example", "AGENTS.md", "pagefind.yml"];
for (const name of ROOT_FILES) {
	const source = join(WORKSPACE_DIR, name);
	if (existsSync(source)) await cp(source, join(TEMPLATE_DIR, name));
}

// `.npmrc` ships as `_npmrc`: npm and pnpm strip the real dotfile from
// published tarballs, so `init` renames `_npmrc` back to `.npmrc`.
const themeNpmrc = existsSync(join(WORKSPACE_DIR, ".npmrc"))
	? await readFile(join(WORKSPACE_DIR, ".npmrc"), "utf8")
	: "";
if (themeNpmrc) {
	await writeFile(join(TEMPLATE_DIR, "_npmrc"), themeNpmrc, "utf8");
}

// VS Code: recommend the Biome + Astro extensions. Deliberately *not* the
// theme's settings.json, which pins Biome as the formatter — a dependency a
// user's project may not have.
await mkdir(join(TEMPLATE_DIR, ".vscode"), { recursive: true });
const vsCodeExt = join(WORKSPACE_DIR, ".vscode/extensions.json");
if (existsSync(vsCodeExt)) {
	await cp(vsCodeExt, join(TEMPLATE_DIR, ".vscode/extensions.json"));
}

// .gitignore — the theme's own, retargeted at a user project: the anime
// snapshot cache lives under `shirones/config/data/` there, and the
// integration's `.shirones/` scratch directory needs ignoring too.
const themeGitignore = existsSync(join(WORKSPACE_DIR, ".gitignore"))
	? await readFile(join(WORKSPACE_DIR, ".gitignore"), "utf8")
	: "node_modules/\ndist/\n.astro/\n";
const userGitignore = `${themeGitignore
	.replace(
		"src/data/anime-snapshots/*.json",
		`${CONTENT_ROOT}/config/data/anime-snapshots/*.json`,
	)
	.trimEnd()}\n\n# shirones integration cache\n.shirones/\n`;
// Ship as `_gitignore` for the same reason `.npmrc` becomes `_npmrc`: the real
// `.gitignore` never survives packaging, so `init` renames this one back.
await writeFile(join(TEMPLATE_DIR, "_gitignore"), userGitignore, "utf8");

// frontmatter.json — the VS Code Front Matter schema, with the content folder
// retargeted at the user's project.
const themeFrontmatter = existsSync(join(WORKSPACE_DIR, "frontmatter.json"))
	? await readFile(join(WORKSPACE_DIR, "frontmatter.json"), "utf8")
	: null;
if (themeFrontmatter) {
	await writeFile(
		join(TEMPLATE_DIR, "frontmatter.json"),
		themeFrontmatter.replaceAll(
			"src/content/posts",
			`${CONTENT_ROOT}/content/posts`,
		),
		"utf8",
	);
}

// README.md — a short user-facing guide, not the theme's own README.
await writeFile(
	join(TEMPLATE_DIR, "README.md"),
	`# Shirone Blog

This site runs on [Shirone](https://github.com/LyraVoid/Shirone) — an
anime-inspired, Material 3 Expressive blog theme for Astro, installed as the
\`${PACKAGE_NAME}\` npm package.

## Commands

\`\`\`bash
pnpm install   # install dependencies (run once after init)
pnpm dev       # start the dev server at http://localhost:4321
pnpm build     # static build → dist/
pnpm preview   # preview the production build locally
\`\`\`

## Project layout

| Path | What it is |
| --- | --- |
| \`${CONTENT_ROOT}/config/\` | site configuration — URL, title, theme colour, sidebar, fonts (TypeScript, fully typed) |
| \`${CONTENT_ROOT}/config/data/\` | friends, projects, skills, timeline, … |
| \`${CONTENT_ROOT}/content/\` | your posts, moments and other collections |
| \`src/components/\` | drop a file here to override a theme component (mirrors the theme's \`src/components/\` tree) |
| \`src/layouts/\` | …same for layouts |
| \`public/\` | static assets (favicons, banners, images) |

## Updating the theme

\`\`\`bash
npx ${PACKAGE_NAME} init --force
\`\`\`

See the package documentation for the full configuration reference and the
component-override rules.
`,
	"utf8",
);

console.log("[templates] done");
