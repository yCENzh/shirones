/**
 * Step 0 — decide which version to publish.
 *
 * The published version is a property of *this pipeline*, not of the theme.
 * The theme's own `package.json` version describes the source tree and moves
 * for reasons that have nothing to do with releases (and is easy to forget to
 * bump), so tying the two together meant every release needed a commit in
 * another repository just to change a number.
 *
 * Instead:
 *   - `SHIRONES_PACKAGE_VERSION=1.2.3` publishes exactly that version;
 *   - otherwise the latest version on npm gets a patch bump;
 *   - if the package name has no published versions, the seed is `0.0.0` —
 *     deliberately *not* the theme's own version, which describes the source
 *     tree and would smuggle an unrelated number into a brand-new package.
 *
 * Either way the version must not already exist on npm. Overwriting is
 * impossible anyway, so this fails loudly here rather than at `npm publish`.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { PACKAGE_NAME } from "./config.mjs";

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

/** Every version already on npm, newest first. Empty if unpublished. */
function publishedVersions() {
	try {
		const raw = execFileSync(
			"npm",
			["view", PACKAGE_NAME, "versions", "--json"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		const parsed = JSON.parse(raw);
		return (Array.isArray(parsed) ? parsed : [parsed]).reverse();
	} catch (error) {
		// A brand-new package name is a 404 here, which is not an error.
		const stderr = String(error.stderr ?? "");
		if (stderr.includes("E404") || stderr.includes("404 Not Found")) return [];
		throw error;
	}
}

/**
 * Highest *release* version, ignoring prereleases: a `1.0.0-rc.1` sitting on
 * top of `0.9.4` must not make the next patch `1.0.1`.
 */
function latestRelease(versions) {
	const releases = versions
		.map((version) => SEMVER.exec(version))
		.filter((match) => match && !match[4])
		.map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
	if (releases.length === 0) return null;
	releases.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
	return releases[0];
}

const requested = (process.env.SHIRONES_PACKAGE_VERSION ?? "").trim();
const published = publishedVersions();

let version;
let reason;

if (requested) {
	if (!SEMVER.test(requested)) {
		console.error(
			`[version] "${requested}" is not a valid semver version (expected e.g. 1.2.3 or 1.2.3-rc.1)`,
		);
		process.exit(1);
	}
	version = requested;
	reason = "explicitly requested";
} else {
	const latest = latestRelease(published);
	if (latest) {
		version = `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
		reason = `patch bump from ${latest.join(".")}`;
	} else {
		version = "0.0.0";
		reason = published.length
			? "first release version (only prereleases published so far)"
			: "no published versions on npm";
	}
}

if (published.includes(version)) {
	console.error(
		`[version] ${PACKAGE_NAME}@${version} is already published. npm does not allow ` +
			"republishing a version — pick a higher one, or leave the version input " +
			"blank to bump the patch automatically.",
	);
	process.exit(1);
}

console.log(`[version] ${PACKAGE_NAME}@${version} (${reason})`);

// Hand the decision to the following steps, which must not re-derive it.
if (process.env.GITHUB_ENV) {
	appendFileSync(process.env.GITHUB_ENV, `SHIRONES_PACKAGE_VERSION=${version}\n`);
}
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
