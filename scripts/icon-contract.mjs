/**
 * The icon contract the packaged integration must keep.
 *
 * `astro-icon` used to be an Astro integration and was listed among
 * `createBundledIntegrations()`. It is gone: icons come from the regeneration
 * Vite plugin plus the `@iconify/svelte` alias instead. Neither appears in the
 * integrations array, so the assertion that replaced the old one lives here —
 * and losing either one breaks every icon in every mode silently.
 *
 * Kept separate from `validate.mjs` so it can be tested without booting the
 * whole validation run, which needs a built `dist/` and a throwaway install.
 */

/** Where in `plugins: [` an array opened at `bracketAt` closes. -1 if never. */
function findArrayEnd(source, bracketAt) {
	let depth = 0;
	for (let index = bracketAt; index < source.length; index++) {
		const char = source[index];
		if (char === "[") depth += 1;
		else if (char === "]") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/**
 * Read `vite.plugins[]` out of the integration source, as its literal text.
 *
 * Returns null when there is no such array, and the reason when it is
 * malformed, so a caller can tell "absent" from "unparseable" — the two need
 * different messages.
 */
function extractPluginsBody(source) {
	const viteAt = source.indexOf("vite: {");
	const pluginsAt = source.indexOf("plugins: [", viteAt);
	if (viteAt === -1 || pluginsAt === -1 || pluginsAt <= viteAt) {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}
	const end = findArrayEnd(source, source.indexOf("[", pluginsAt));
	if (end === -1) {
		return { body: source.slice(pluginsAt), reason: "`vite.plugins[` is never closed" };
	}
	return { body: source.slice(pluginsAt, end), reason: null };
}

/**
 * Everything wrong with the icon pipeline in this source, as sentences.
 *
 * An empty array means the contract holds. The checks are intentionally
 * structural rather than a whole-file text search: "the string
 * `shironesIconRegeneration(` appears somewhere" is satisfied by a factory that
 * is imported and never registered, which produces no output at all.
 */
export function checkIconPipeline(source) {
	const problems = [];

	const { body: pluginsBody, reason: pluginsReason } = extractPluginsBody(source);
	if (pluginsReason) problems.push(pluginsReason);
	else if (!/shironesIconRegeneration\s*\(/.test(pluginsBody)) {
		problems.push(
			"the icon regeneration plugin is never registered in `vite.plugins[]`",
		);
	}

	// Matched loosely on purpose: the alias is a regex literal today and a
	// string tomorrow, and the contract is "the specifier is redirected", not
	// the spelling of the redirection. Both lines are read, because a `find`
	// with no `replacement` — or one pointing elsewhere — reinstates the
	// upstream component, whose icon data the theme does not publish.
	const alias = /find:[^\n]*@iconify[^\n]*svelte[^\n]*\n[^\n]*replacement:[^\n]*/i.exec(
		source,
	);
	if (!alias) {
		problems.push(
			"`@iconify/svelte` is not aliased to the theme's Icon component",
		);
	} else if (!/display\/Icon\.svelte/.test(alias[0])) {
		// The path suffix, not the filename: `OfflineIcon.svelte` contains
		// `Icon.svelte` as a substring and would pass that weaker test.
		problems.push(
			`\`@iconify/svelte\` is redirected somewhere other than the theme's Icon component: ${alias[0].trim()}`,
		);
	}

	return problems;
}
