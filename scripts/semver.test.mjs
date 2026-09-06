import test from "node:test";
import assert from "node:assert/strict";
import { parseSemver } from "./semver.mjs";

test("accepts valid release, prerelease and build metadata", () => {
	assert.equal(parseSemver("1.2.3").patch, 3);
	assert.equal(parseSemver("1.2.3-rc.1").prerelease, "rc.1");
	assert.equal(parseSemver("1.2.3+build.7").build, "build.7");
});

test("rejects malformed versions and numeric prerelease leading zeroes", () => {
	for (const value of ["1.2", "1.2.3-01", "1.2.3-..", "01.2.3", "1.2.3-"]) {
		assert.equal(parseSemver(value), null, value);
	}
});
