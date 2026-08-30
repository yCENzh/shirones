# Releasing

Everything here is manual and deliberate: this repository has **no push
trigger**. Pushing docs, tweaking a script, or merging a PR never publishes
anything. A release happens only when a human runs the workflow.

## The routine release

Whenever the theme gets updates, the whole release is:

1. Theme work lands in the upstream [`LyraVoid/Shirone`](https://github.com/LyraVoid/Shirone)
   `main` branch — there is nothing to merge or port here.
2. GitHub → **Actions** → **Build & Publish** → **Run workflow** → leave every
   field at its default → **Run workflow**.

That is it — no version to bump, nothing to push here. The pipeline clones the
theme itself and picks the next version itself.

Takes 6–8 minutes. The run's summary page reports the published version, the
upstream commit it was built from, and the route/component counts.

## The six inputs, and whether you should care

The dispatch form shows six fields. **In the routine release you touch none of
them** — every one falls back to the value the project uses day to day. They
exist so the pipeline is not hard-wired to one branch or one package name.

| Field | Blank means | When you'd actually set it |
| --- | --- | --- |
| **Version to publish** | patch bump of the latest release on npm | Anything that is not the next patch: a minor or major (`0.1.0`, `1.0.0`), or a prerelease (`1.0.0-rc.1`). Invalid semver, or a version already on npm, fails the run immediately. |
| **Use workflow from** | `main` | GitHub's own field, not ours: *which branch's copy of `publish.yml` to run*. Change it only to test an edit to the workflow file on a branch before merging it. |
| **Upstream branch/tag of the theme to package** | `main` | Cutting a release from a different theme branch, or packaging a tag (`v1.2.0`) for a reproducible build. |
| **Clone URL of the theme repository** | `https://github.com/LyraVoid/Shirone.git` | Packaging a fork, or a rename of the theme repository. Must be a public clone URL — the job checks out with no credentials. |
| **npm package name to publish** | `shirones` | Publishing under a scoped scratch name (for example `@you/shirones-experiment`) while experimenting. The switch away from the `shirones-test` trial package was exactly this field. |
| **Build and validate, but do not publish** | unchecked (publish) | Rehearsal. Runs the entire pipeline including a real `astro build` in a scratch project, then stops before `npm publish`. Use it after changing anything in `scripts/`, or to check a theme branch is packageable before merging it. The tarball is still attached to the run as an artifact for 14 days. |

## Where the version comes from

`scripts/resolve-version.mjs` decides it, in the first minute of the run:

1. If the **Version to publish** input is set, that exact version is used.
2. Otherwise the highest *release* on npm gets a patch bump — `0.0.10` →
   `0.0.11`. Prereleases are ignored when picking the base, so an `rc` sitting
   on top of a release cannot drag the next patch sideways.
3. If the package name has no published versions, the seed is `0.0.0` — *not*
   the theme's version, which describes the source tree and would smuggle an
   unrelated number into a brand-new package.

In every case the version must not already exist on npm. It **fails the run**
rather than skipping the publish: a release that quietly does nothing is worse
than one that stops and says why.

Earlier this pipeline copied the version straight out of the theme's
`package.json`. That coupled a release to a commit in another repository —
forget the bump and the run dies at the last step — while the theme's version
describes the source tree and moves for unrelated reasons. The version is now a
property of the release alone.

The publish job runs in the `npm` environment, so it can additionally be gated
with required reviewers in repository settings.

## Package naming

The production package is `shirones`, the default in `scripts/config.mjs` and
the `env:` block of `.github/workflows/publish.yml`. During development the
pipeline published as `shirones-test` while npm permissions for the real name
were still being arranged; the switch was exactly the `PACKAGE_NAME` default,
and needs no further code. To publish under a different name, type it in the
dispatch form — no commit required, and the `CONTENT_ROOT` stays `shirones`
regardless, so projects scaffolded under a scratch name keep working after the
switch back.

With no published versions under `shirones` yet, the first run left at default
resolves to `0.0.0` (see "Where the version comes from"). Set the version input
explicitly if the first release should instead be a milestone (`1.0.0`), or if
you want to start the package at a specific number.

The user-facing directory is **not** renamed: `CONTENT_ROOT` stays `shirones`
in both packages, so a blog scaffolded with the test package keeps working
after switching.

Before the first production publish, confirm the npm token in `NPM_TOKEN` has
publish rights on the `shirones` name.

## What the pipeline needs from the environment

| Secret / setting | Used by | Notes |
| --- | --- | --- |
| `NPM_TOKEN` | publish job | Automation token with publish rights. |
| `id-token: write` | publish job | npm **provenance**. Requires `repository.url` in the published `package.json` to point at *this* repository — `scripts/config.mjs` handles that; do not repoint it at the theme. |
| environment `npm` | publish job | Optional approval gate. |

## Running the pipeline locally

Useful for debugging without burning CI minutes, but note the build step is
memory-hungry (`astro build` in validation needs several GB):

```bash
pnpm install --no-lockfile
pnpm all                       # sync → templates → build → manifest → validate
pnpm version:next              # what the next version would be, without publishing
```

A local `pnpm all` stamps `0.0.0` into the package, because the resolver only
runs in CI. Export `SHIRONES_PACKAGE_VERSION` to pin it.

Override anything with the env vars in [pipeline.md](./pipeline.md#configuration):

```bash
SHIRONES_UPSTREAM_REF=main SHIRONES_PACKAGE_NAME=shirones pnpm all
```
