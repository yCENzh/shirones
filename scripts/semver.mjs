/**
 * Small, strict SemVer 2.0 parser for release-version inputs.
 *
 * The pipeline only needs to validate a concrete version and compare the
 * numeric core of stable releases. Keeping this parser pure makes the edge
 * cases testable without querying npm.
 */

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Parse a SemVer 2.0.0 string, or return null when it is invalid.
 * Numeric prerelease identifiers may not have leading zeroes.
 */
export function parseSemver(version) {
	if (typeof version !== "string") return null;
	const match = SEMVER.exec(version);
	if (!match) return null;

	const prerelease = match[4] ?? "";
	if (prerelease) {
		for (const identifier of prerelease.split(".")) {
			if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
				return null;
			}
		}
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease,
		build: match[5] ?? "",
	};
}
