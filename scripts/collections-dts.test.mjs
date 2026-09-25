import assert from "node:assert/strict";
import test from "node:test";
import { renderCollectionsDts } from "./collections-dts.mjs";

const declarations = renderCollectionsDts();

test("collections declarations contain a safe glob example", () => {
	assert.match(declarations, /pattern: "\*\*\\\/\*\.\{md,mdx\}"/);
	assert.doesNotMatch(declarations, /\*\/\*\.\{md,mdx\}/);
});

test("collections declarations expose all four schemas", () => {
	for (const name of ["postSchema", "momentSchema", "specSchema", "seriesSchema"]) {
		assert.match(declarations, new RegExp(`export const ${name}:`));
	}
	assert.match(declarations, /seriesOrder:/);
	assert.match(declarations, /status: .*ZodEnum<\{ ongoing: "ongoing"; completed: "completed" \}>/);
});

test("collections declaration generic brackets are balanced", () => {
	let inComment = false;
	let inString = false;
	let escaped = false;
	let depth = 0;

	for (let i = 0; i < declarations.length; i += 1) {
		const char = declarations[i];
		const next = declarations[i + 1];

		if (inComment) {
			if (char === "*" && next === "/") {
				inComment = false;
				i += 1;
			}
			continue;
		}
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === "/" && next === "*") {
			inComment = true;
			i += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "<") depth += 1;
		if (char === ">") {
			depth -= 1;
			assert.ok(depth >= 0, `unexpected closing generic bracket at offset ${i}`);
		}
	}

	assert.equal(inComment, false, "declaration contains an unterminated block comment");
	assert.equal(inString, false, "declaration contains an unterminated string");
	assert.equal(depth, 0, "declaration contains unbalanced generic brackets");
});

test("already exported schemas are not re-exported redundantly", () => {
	assert.doesNotMatch(declarations, /^export \{.*Schema.*\};$/m);
});
