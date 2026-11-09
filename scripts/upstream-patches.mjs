/**
 * Small, fail-closed adaptations applied to a generated `workspace/` copy of
 * the theme before the package entry point is bundled. Never edit upstream
 * files in the repository or commit theme source here.
 */

const MATERIAL_UTILITIES = "@material/material-color-utilities";

function indentOf(line) {
	return line.match(/^[\t ]*/)?.[0] ?? "";
}

function isDirectChild(line, indent) {
	return indentOf(line) === indent;
}

function findSiblingBlockEnd(lines, start, indent, limit) {
	for (let i = start + 1; i < limit; i += 1) {
		if (isDirectChild(lines[i], indent) && ["},", "}"].includes(lines[i].trim())) {
			return i;
		}
	}
	return -1;
}

function mergeMaterialUtilitiesIntoNoExternal(lines, propertyLine, blockEnd) {
	if (propertyLine < 0) {
		throw new Error("[build] cannot safely locate the vite.ssr.noExternal array to extend");
	}
	const line = lines[propertyLine];
	const open = line.indexOf("[");
	if (open < 0) {
		throw new Error(
			`[build] cannot safely extend vite.ssr.noExternal: expected an array, got ${line.trim()}`,
		);
	}

	let closeLine = propertyLine;
	let close = lines[closeLine].indexOf("]", open + 1);
	while (close < 0 && closeLine + 1 < blockEnd) {
		closeLine += 1;
		close = lines[closeLine].indexOf("]");
	}
	if (close < 0) {
		throw new Error("[build] cannot safely extend vite.ssr.noExternal: unterminated array");
	}

	if (closeLine === propertyLine) {
		const current = line.slice(open + 1, close).trim();
		if (current.includes("//") || current.includes("/*")) {
			throw new Error(
				"[build] cannot safely extend a commented inline vite.ssr.noExternal array",
			);
		}
		const addition = current ? `${current.replace(/,\s*$/, "")}, ` : "";
		lines[propertyLine] =
			line.slice(0, open + 1) +
			addition +
			JSON.stringify(MATERIAL_UTILITIES) +
			line.slice(close);
		return;
	}

	// Preserve a conventional multi-line literal array, adding the entry just
	// before its closing bracket. If the last item lacks a trailing comma, add
	// one rather than emitting invalid syntax.
	let previousItem = closeLine - 1;
	while (previousItem > propertyLine && !lines[previousItem].trim()) previousItem -= 1;
	if (previousItem > propertyLine && !lines[previousItem].trim().endsWith(",")) {
		lines[previousItem] = `${lines[previousItem]},`;
	}
	const closeIndent = indentOf(lines[closeLine]);
	lines.splice(closeLine, 0, `${closeIndent}\t${JSON.stringify(MATERIAL_UTILITIES)},`);
}

/**
 * Vite's `noExternal` is an SSR option, not a `resolve` option. Some upstream
 * revisions put the Material Color Utilities package under `vite.resolve`,
 * which Vite ignores; Node then tries to load its extensionless ESM imports
 * directly and the package-mode dev server returns 500. Put the dependency in
 * `vite.ssr.noExternal` in the generated workspace copy.
 *
 * The function is idempotent, preserves an already-correct upstream config,
 * and throws on unfamiliar config shapes rather than silently shipping a bad
 * package. `source` is never modified in the upstream repository.
 */
export function ensureMaterialUtilitiesNoExternal(source) {
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/);
	const updateConfig = lines.findIndex((line) => line.includes("updateConfig({"));
	if (updateConfig < 0) {
		throw new Error("[build] upstream integration has no updateConfig({ ... }) block");
	}

	const vite = lines.findIndex(
		(line, index) => index > updateConfig && /^\s*vite\s*:\s*\{\s*$/.test(line),
	);
	if (vite < 0) {
		throw new Error("[build] cannot find the integration's vite config to set SSR noExternal");
	}
	const viteIndent = indentOf(lines[vite]);
	const firstChild = lines.findIndex(
		(line, index) =>
			index > vite &&
			indentOf(line).length > viteIndent.length &&
			/^(?:resolve|ssr|plugins)\s*:/.test(line.trim()),
	);
	const childIndent = firstChild < 0
		? `${viteIndent}${viteIndent.includes("\t") ? "\t" : "  "}`
		: indentOf(lines[firstChild]);
	const plugins = lines.findIndex(
		(line, index) =>
			index > vite &&
			isDirectChild(line, childIndent) &&
			/^plugins\s*:/.test(line.trim()),
	);
	const viteLimit = plugins < 0 ? lines.length : plugins;

	let ssr = lines.findIndex(
		(line, index) =>
			index > vite &&
			index < viteLimit &&
			isDirectChild(line, childIndent) &&
			/^ssr\s*:/.test(line.trim()),
	);
	if (ssr >= 0 && !/^ssr\s*:\s*\{\s*$/.test(lines[ssr].trim())) {
		throw new Error("[build] upstream vite.ssr changed shape; review the noExternal patch");
	}
	let ssrEnd = ssr < 0 ? -1 : findSiblingBlockEnd(lines, ssr, childIndent, viteLimit);
	if (ssr >= 0 && ssrEnd < 0) {
		throw new Error("[build] cannot safely locate the end of the upstream vite.ssr block");
	}

	let hasCorrectSetting = false;
	if (ssr >= 0) {
		const block = lines.slice(ssr + 1, ssrEnd).join("\n");
		const configured = block.match(/\bnoExternal\s*:\s*(true|\[[\s\S]*?\])/);
		if (configured?.[1] === "true" || configured?.[1]?.includes(MATERIAL_UTILITIES)) {
			hasCorrectSetting = true;
		} else if (configured) {
			const propertyLine = lines.findIndex(
				(line, index) =>
					index > ssr && index < ssrEnd && /^\s*noExternal\s*:/.test(line),
			);
			mergeMaterialUtilitiesIntoNoExternal(lines, propertyLine, ssrEnd);
			hasCorrectSetting = true;
		}
	}

	// Remove the misplaced setting from resolve, along with its immediately
	// preceding explanatory comment if that comment describes this setting.
	const resolve = lines.findIndex(
		(line, index) =>
			index > vite &&
			index < viteLimit &&
			isDirectChild(line, childIndent) &&
			/^resolve\s*:\s*\{\s*$/.test(line.trim()),
	);
	if (resolve >= 0) {
		const resolveEnd = findSiblingBlockEnd(lines, resolve, childIndent, viteLimit);
		if (resolveEnd < 0) {
			throw new Error("[build] cannot safely locate the end of the upstream vite.resolve block");
		}
		for (let i = resolveEnd - 1; i > resolve; i -= 1) {
			if (!/^\s*noExternal\s*:/.test(lines[i]) || !lines[i].includes(MATERIAL_UTILITIES)) continue;
			let start = i;
			let commentStart = i - 1;
			while (commentStart > resolve && lines[commentStart].trim().startsWith("//")) {
				commentStart -= 1;
			}
			const comments = lines.slice(commentStart + 1, i);
			if (comments.some((line) => /Layout\.astro|extensionless ESM|externalized|bundles it/i.test(line))) {
				start = commentStart + 1;
			}
			lines.splice(start, i - start + 1);
			// Removing an invalid resolve key does not invalidate a correct SSR
			// setting that may already have been present.
			// Only one such key is expected. A second would indicate a shape this
			// targeted patch should not silently rewrite.
			if (lines.slice(resolve, resolveEnd).some((line) =>
				/^\s*noExternal\s*:/.test(line) && line.includes(MATERIAL_UTILITIES),
			)) {
				throw new Error("[build] multiple misplaced Material noExternal keys need manual review");
			}
		}
	}

	if (!hasCorrectSetting) {
		// Recompute sibling positions after removing the invalid resolve key.
		ssr = lines.findIndex(
			(line, index) =>
				index > vite &&
				isDirectChild(line, childIndent) &&
				/^ssr\s*:\s*\{\s*$/.test(line.trim()),
		);
		if (ssr >= 0) {
			ssrEnd = findSiblingBlockEnd(lines, ssr, childIndent, lines.length);
			if (ssrEnd < 0) {
				throw new Error("[build] cannot safely locate the end of the upstream vite.ssr block");
			}
			lines.splice(
				ssr + 1,
				0,
				`${childIndent}\tnoExternal: [${JSON.stringify(MATERIAL_UTILITIES)}],`,
			);
		} else {
			lines.splice(
				vite + 1,
				0,
				`${childIndent}ssr: {`,
				`${childIndent}\t// Node cannot resolve this package's extensionless ESM imports when externalized.`,
				`${childIndent}\tnoExternal: [${JSON.stringify(MATERIAL_UTILITIES)}],`,
				`${childIndent}},`,
			);
		}
	}

	return lines.join(eol);
}
