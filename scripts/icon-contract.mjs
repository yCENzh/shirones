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

const REGEX_PREFIX_KEYWORDS = new Set([
	"await",
	"case",
	"delete",
	"else",
	"in",
	"instanceof",
	"of",
	"return",
	"throw",
	"typeof",
	"void",
	"yield",
]);

const REGEX_PREFIX_PUNCTUATION = new Set([
	"(",
	"{",
	"[",
	"=",
	",",
	":",
	";",
	"!",
	"?",
	"&",
	"|",
	"+",
	"-",
	"*",
	"%",
	"^",
	"~",
	"<",
	">",
]);

/** Replace a source span with whitespace while preserving offsets and lines. */
function maskRange(chars, start, end, isValue = false) {
	for (let index = start; index < end; index += 1) {
		if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
	}
	// Keep a non-operator token at the start of a literal so a following `/`
	// cannot be mistaken for the start of a regular-expression literal.
	if (isValue && start < end) chars[start] = "0";
}

/** Find the end of a quoted string, respecting escaped delimiters. */
function quotedEnd(source, start, quote) {
	for (let index = start + 1; index < source.length; index += 1) {
		if (source[index] === "\\") {
			index += 1;
			continue;
		}
		if (source[index] === quote) return index + 1;
	}
	return source.length;
}

/** Whether a slash at `index` can begin a regex rather than division. */
function regexMayStart(maskedChars, index) {
	let previous = index - 1;
	while (previous >= 0 && /\s/.test(maskedChars[previous])) previous -= 1;
	if (previous < 0) return true;

	const char = maskedChars[previous];
	if (REGEX_PREFIX_PUNCTUATION.has(char)) return true;

	let wordStart = previous;
	while (wordStart >= 0 && /[\w$]/.test(maskedChars[wordStart])) wordStart -= 1;
	return REGEX_PREFIX_KEYWORDS.has(
		maskedChars.slice(wordStart + 1, previous + 1).join(""),
	);
}

/** Find the end of a regex literal, including character classes and flags. */
function regexEnd(source, start) {
	let inCharacterClass = false;
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "\n" || char === "\r") return -1;
		if (char === "[") inCharacterClass = true;
		else if (char === "]") inCharacterClass = false;
		else if (char === "/" && !inCharacterClass) {
			let end = index + 1;
			while (/[a-z]/i.test(source[end] ?? "")) end += 1;
			return end;
		}
	}
	return -1;
}

/**
 * Mask comments and, optionally, string/regex literals without changing source
 * offsets. Structural checks must not mistake a comment, string, template, or
 * regex containing a plugin name/bracket for executable configuration.
 */
function maskNonCode(source, { strings = true, regex = true } = {}) {
	const chars = source.split("");
	for (let index = 0; index < source.length; ) {
		if (source.startsWith("//", index)) {
			let end = source.indexOf("\n", index);
			if (end === -1) end = source.length;
			maskRange(chars, index, end);
			index = end;
			continue;
		}
		if (source.startsWith("/*", index)) {
			const close = source.indexOf("*/", index + 2);
			const end = close === -1 ? source.length : close + 2;
			maskRange(chars, index, end);
			index = end;
			continue;
		}

		const char = source[index];
		if (char === "'" || char === '"' || char === "`") {
			const end = quotedEnd(source, index, char);
			// Template literals can span lines and imitate either contract, so
			// always mask them. For the alias check, ordinary quoted replacement
			// strings remain visible, but their contents are skipped while lexing.
			if (strings || char === "`") maskRange(chars, index, end, true);
			index = end;
			continue;
		}

		if (regex && char === "/" && regexMayStart(chars, index)) {
			const end = regexEnd(source, index);
			if (end !== -1) {
				maskRange(chars, index, end, true);
				index = end;
				continue;
			}
		}
		index += 1;
	}
	return chars.join("");
}

/** Find the matching close delimiter in already-masked source. */
function matchingDelimiter(source, openAt, open, close) {
	let depth = 0;
	for (let index = openAt; index < source.length; index += 1) {
		if (source[index] === open) depth += 1;
		else if (source[index] === close) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** Skip whitespace between a property name, its colon, and its value. */
function skipWhitespace(source, index, end) {
	while (index < end && /\s/.test(source[index])) index += 1;
	return index;
}

/** Find an unquoted, direct property in an already-masked object literal. */
function findTopLevelProperty(source, objectOpen, objectEnd, property) {
	let braces = 0;
	let brackets = 0;
	let parentheses = 0;

	for (let index = objectOpen + 1; index < objectEnd; index += 1) {
		if (braces === 0 && brackets === 0 && parentheses === 0) {
			const previous = source[index - 1] ?? "";
			const next = source[index + property.length] ?? "";
			if (
				source.startsWith(property, index) &&
					!/[\w$]/.test(previous) &&
					!/[\w$]/.test(next) &&
					source[skipWhitespace(source, index + property.length, objectEnd)] === ":"
			) {
				return index;
			}
		}

		switch (source[index]) {
			case "{":
				braces += 1;
				break;
			case "}":
				braces -= 1;
				break;
			case "[":
				brackets += 1;
				break;
			case "]":
				brackets -= 1;
				break;
			case "(":
				parentheses += 1;
				break;
			case ")":
				parentheses -= 1;
				break;
		}
	}
	return -1;
}

/**
 * Read the direct `updateConfig({ vite: { plugins: [] } })` object literal.
 *
 * Each property lookup is limited to its containing object, so an unrelated
 * `vite` or `plugins` object later in the file cannot satisfy the contract.
 */
function extractPluginsBody(source) {
	const updateCall = /\bupdateConfig\s*\(/.exec(source);
	if (!updateCall) {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}

	const callOpen = source.indexOf("(", updateCall.index);
	const callEnd = matchingDelimiter(source, callOpen, "(", ")");
	if (callEnd === -1) {
		return { body: null, reason: "the `updateConfig()` call is never closed" };
	}

	const configOpen = skipWhitespace(source, callOpen + 1, callEnd);
	if (source[configOpen] !== "{") {
		return { body: null, reason: "`updateConfig()` has no object-literal config" };
	}
	const configEnd = matchingDelimiter(source, configOpen, "{", "}");
	if (configEnd === -1 || configEnd > callEnd) {
		return { body: null, reason: "the `updateConfig()` config object is never closed" };
	}

	const viteAt = findTopLevelProperty(source, configOpen, configEnd, "vite");
	if (viteAt === -1) {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}
	const viteColon = skipWhitespace(source, viteAt + "vite".length, configEnd);
	const viteOpen = skipWhitespace(source, viteColon + 1, configEnd);
	if (source[viteColon] !== ":" || source[viteOpen] !== "{") {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}

	const viteEnd = matchingDelimiter(source, viteOpen, "{", "}");
	if (viteEnd === -1 || viteEnd > configEnd) {
		return { body: null, reason: "the `vite` config object is never closed" };
	}

	const pluginsAt = findTopLevelProperty(source, viteOpen, viteEnd, "plugins");
	if (pluginsAt === -1) {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}
	const pluginsColon = skipWhitespace(source, pluginsAt + "plugins".length, viteEnd);
	const pluginsOpen = skipWhitespace(source, pluginsColon + 1, viteEnd);
	if (source[pluginsColon] !== ":" || source[pluginsOpen] !== "[") {
		return { body: null, reason: "updateConfig() sets no `vite.plugins[]` array" };
	}

	const pluginsEnd = matchingDelimiter(source, pluginsOpen, "[", "]");
	if (pluginsEnd === -1 || pluginsEnd > viteEnd) {
		return { body: null, reason: "`vite.plugins[` is never closed" };
	}
	return { body: source.slice(pluginsAt, pluginsEnd), reason: null };
}

/**
 * Everything wrong with the icon pipeline in this source, as sentences.
 *
 * An empty array means the contract holds. The check looks for executable code
 * inside the actual `updateConfig().vite.plugins[]` array, not a matching word
 * in a comment, string, regex, another object, or later part of the file.
 */
export function checkIconPipeline(source) {
	const problems = [];

	const pluginSource = maskNonCode(source);
	const { body: pluginsBody, reason: pluginsReason } =
		extractPluginsBody(pluginSource);
	if (pluginsReason) problems.push(pluginsReason);
	else if (!/shironesIconRegeneration\s*\(/.test(pluginsBody)) {
		problems.push(
			"the icon regeneration plugin is never registered in `vite.plugins[]`",
		);
	}

	// First find the property names in code-only text, then inspect the matching
	// source lines with string and regex values preserved. This avoids accepting
	// a pair of strings that merely spell `find:` and `replacement:`.
	const aliasStructure = maskNonCode(source);
	const aliasValues = maskNonCode(source, { strings: false, regex: false });
	let iconAlias = null;
	for (const alias of aliasStructure.matchAll(
		/\bfind\s*:[^\n]*(?:\n[^\n]*)?\breplacement\s*:/gi,
	)) {
		const findColon = aliasStructure.indexOf(":", alias.index);
		const findLineEnd = aliasStructure.indexOf("\n", findColon);
		const replacementAt = aliasStructure.indexOf("replacement", findColon + 1);
		const replacementColon = aliasStructure.indexOf(":", replacementAt);
		const replacementLineEnd = aliasStructure.indexOf("\n", replacementColon);
		const findValue = aliasValues.slice(
			findColon + 1,
			findLineEnd === -1 ? aliasValues.length : findLineEnd,
		);
		if (!/@iconify[^\n]*svelte/i.test(findValue)) continue;

		iconAlias = aliasValues.slice(
			replacementColon + 1,
			replacementLineEnd === -1 ? aliasValues.length : replacementLineEnd,
		);
		break;
	}
	if (!iconAlias) {
		problems.push(
			"`@iconify/svelte` is not aliased to the theme's Icon component",
		);
	} else if (!/display\/Icon\.svelte/.test(iconAlias)) {
		// The path suffix, not the filename: `OfflineIcon.svelte` contains
		// `Icon.svelte` as a substring and would pass that weaker test.
		problems.push(
			`\`@iconify/svelte\` is redirected somewhere other than the theme's Icon component: ${iconAlias.trim()}`,
		);
	}

	return problems;
}
