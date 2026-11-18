import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	chooseProbeIcons,
	probeProblems,
	readProbe,
	referencedIconNames,
	renderProbePage,
	usesVirtualIconModule,
} from "./icon-probe.mjs";

const ICONS = {
	control: "material-symbols:home",
	unused: "material-symbols:abc",
	unknown: "material-symbols:shirones-probe-no-such-icon",
};
const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
const page = (control, unused, unknown) =>
	`<body><span data-icon-probe="control" data-x="1"><!--[-->${control}<!--]--></span>\n` +
	`<span data-icon-probe="unused">${unused}</span>\n` +
	`<span data-icon-probe="unknown">${unknown}</span></body>`;

function temporaryDirectory(t) {
	const directory = mkdtempSync(join(tmpdir(), "shirones-icon-probe-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test("names are collected whole, from nested files, for one prefix only", (t) => {
	const root = temporaryDirectory(t);
	mkdirSync(join(root, "a", "b"), { recursive: true });
	writeFileSync(join(root, "a", "one.astro"), '<Icon icon="material-symbols:home-rounded" />');
	writeFileSync(join(root, "a", "b", "two.ts"), 'const i = "material-symbols:search"; // fa7-brands:github');
	writeFileSync(join(root, "a", "image.png"), "material-symbols:not-text");
	assert.deepEqual(
		[...referencedIconNames([root, join(root, "missing")])].sort(),
		["home-rounded", "search"],
	);
});

test("the unused icon is one nothing references, the control one something does", () => {
	const icons = chooseProbeIcons(["home", "abc", "search"], new Set(["abc", "search"]));
	assert.deepEqual(icons, {
		control: "material-symbols:abc",
		unused: "material-symbols:home",
		unknown: "material-symbols:shirones-probe-no-such-icon",
	});
});

test("no probe is chosen when there is no control or no unused icon", () => {
	assert.equal(chooseProbeIcons(["home"], new Set(["home"])), null);
	assert.equal(chooseProbeIcons(["home"], new Set()), null);
});

test("the page marks each icon and imports the aliased component", () => {
	const source = renderProbePage(ICONS);
	assert.match(source, /import Icon from "@iconify\/svelte";/);
	for (const [id, icon] of Object.entries(ICONS)) {
		assert.ok(source.includes(`<span data-icon-probe="${id}"><Icon icon="${icon}" /></span>`));
	}
});

test("a drawn icon is told apart from an empty node", () => {
	assert.deepEqual(readProbe(page(SVG, SVG, "<!---->")), { control: true, unused: true, unknown: false });
	assert.deepEqual(readProbe(page(SVG, '<svg viewBox="0 0 24 24"></svg>', "")), {
		control: true,
		unused: false,
		unknown: false,
	});
});

test("the expected rendering reports nothing", () => {
	assert.deepEqual(probeProblems(page(SVG, SVG, ""), ICONS), []);
});

test("a blank project icon is reported as the parity failure it is", () => {
	const problems = probeProblems(page(SVG, "", ""), ICONS);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /material-symbols:abc.*not reaching the icon collection/);
});

test("a blank control and a missing page are reported", () => {
	assert.match(probeProblems(page("", SVG, ""), ICONS)[0], /probe page is broken/);
	assert.equal(probeProblems("<html></html>", ICONS).length, 3);
});

test("only a theme whose Icon.svelte imports the virtual module is probed", (t) => {
	const src = temporaryDirectory(t);
	const directory = join(src, "components", "atoms", "display");
	assert.equal(usesVirtualIconModule(src), false);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "Icon.svelte"), 'import { x } from "@/generated/local-icon-collections";');
	assert.equal(usesVirtualIconModule(src), false);
	writeFileSync(join(directory, "Icon.svelte"), 'import { x } from "virtual:shirone-icons";');
	assert.equal(usesVirtualIconModule(src), true);
});
