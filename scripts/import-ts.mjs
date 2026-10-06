/**
 * Import a TypeScript module from the staged theme workspace.
 *
 * The theme keeps its asset generators in TypeScript so they type-check and
 * so the integration can call them directly. This pipeline is plain `.mjs`,
 * and `import()` of a `.ts` file only works on Node builds that enable type
 * stripping by default (22.18+). The README documents support from 22.12,
 * so relying on that would make `templates` and `build` fail on the versions
 * we claim to support.
 *
 * esbuild is already a dependency here for bundling the integration, so each
 * generator is transpiled into a scratch directory next to the staged
 * theme — where `node_modules` resolution still works — and imported from
 * there. `shards` is emptied by `cleanupTranspiled`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const created = new Set();

/**
 * Transpile `entry` and import it.
 *
 * The output goes to a temporary directory created under the staged workspace
 * rather than the system temp dir: the generator's own bare imports (sharp)
 * have to resolve, and only the workspace has a `node_modules` for them.
 *
 * @param {string} entry Absolute path to a `.ts` file.
 * @param {string} scratchRoot Directory to create the scratch dir inside.
 * @returns {Promise<Record<string, unknown>>} the module namespace
 */
export async function importTypeScript(entry, scratchRoot) {
	const parent = resolve(scratchRoot);
	const outDir = await mkdtemp(join(parent, ".shirones-ts-"));
	created.add(outDir);
	const outfile = join(outDir, `${basename(entry, ".ts")}.mjs`);
	await build({
		entryPoints: [entry],
		outfile,
		// Bundled, because the generator reaches its siblings with relative
		// specifiers (`.ts` included) that would not resolve from the scratch
		// directory. Bundling inlines those, and leaves third-party packages
		// external so they still resolve from the workspace's node_modules.
		bundle: true,
		packages: "external",
		format: "esm",
		platform: "node",
		target: "node20",
		logLevel: "silent",
		outbase: dirname(entry),
	});
	return import(pathToFileURL(outfile).href);
}

/** Remove everything {@link importTypeScript} wrote. */
export async function cleanupTranspiled() {
	await Promise.all(
		[...created].map((dir) => rm(dir, { recursive: true, force: true })),
	);
	created.clear();
}
