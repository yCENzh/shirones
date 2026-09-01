# Agent notes — shirones pipeline

## Ground rules

1. **Never add theme source to this repository.** All components, layouts,
   pages, config defaults and the Astro Integration live in
   `LyraVoid/Shirone` under `src/` and `src/integration/`. This repo only
   transforms and publishes them.
2. `workspace/`, `dist/`, `.upstream/` and `.validate/` are generated. They are
   git-ignored and safe to delete at any time.
3. Scripts are plain Node ESM (`.mjs`). Do not write TypeScript syntax in
   `.mjs` files — Node will refuse to parse it.
4. Anything imported by an injected route must end up in the package's
   `dependencies`, never `devDependencies`. `build-package.mjs` warns about
   undeclared bare imports; treat those warnings as errors.

## Where things live

| Concern | File |
| --- | --- |
| Upstream repo/ref, package name, excluded deps | `scripts/config.mjs` |
| Version selection | `scripts/resolve-version.mjs` |
| Upstream sync + import rewriting for the user-facing template | `scripts/prepare-templates.mjs` |
| Bundling + `package.json` + route/override manifest | `scripts/build-package.mjs` |
| End-to-end install test | `scripts/validate.mjs` |
| CI | `.github/workflows/publish.yml` |

## Documentation

Keep these current when behaviour changes; they are what a human reads before
touching the pipeline:

| File | Scope |
| --- | --- |
| `README.md` | Overview and the map of everything else |
| `docs/releasing.md` | Release procedure and the meaning of each workflow input |
| `docs/pipeline.md` | The pipeline scripts in detail, rewrite rules, env vars |
| `docs/troubleshooting.md` | Failures already diagnosed — add to it rather than rediscovering |
| `PACKAGE_README.md` | Shipped to npm; user-facing, not maintainer-facing |

The theme-side counterpart is `docs/packaging-contract.md` upstream. When a rule
here constrains how theme code must be written, it belongs there too.

## CI

Manual dispatch only — the push trigger was removed on purpose so that editing
this repository never publishes. `pnpm/setup@v2` (not `pnpm/action-setup`)
installs pnpm plus Node and runs `pnpm install` in one step; the publish step
installs npm globally (`pnpm add -g npm`) and writes the auth `.npmrc` from
`NPM_TOKEN`.

The published version is **not** the theme's version: `resolve-version.mjs`
patch-bumps the latest release on npm, or takes the workflow's version input,
and fails if that version already exists. The pnpm store cache is keyed on the
committed `pnpm-lock.yaml`.

## Route patterns

The manifest step in `build-package.mjs` bundles upstream's
`src/integration/routes.ts` (via esbuild) rather than re-implementing its
page→pattern rules, so there is exactly one source of truth for route
discovery.

## Local run

```sh
pnpm install
pnpm templates
pnpm build
SHIRONES_VALIDATE_BUILD=0 pnpm validate   # full build needs ~4 GB RAM
```

## Switching the upstream repo / branch / package name

Nothing is hardcoded in more than one place. Every knob lives in
`scripts/config.mjs` and can be overridden by an environment variable, and the
three that change most often are also `workflow_dispatch` inputs:

| What | Env var | Workflow input | Default |
| --- | --- | --- | --- |
| Theme repository | `SHIRONES_UPSTREAM_REPO` | `upstream-repo` | `https://github.com/LyraVoid/Shirone.git` |
| Branch or tag to package | `SHIRONES_UPSTREAM_REF` | `ref` | `main` |
| Published package name | `SHIRONES_PACKAGE_NAME` | `package-name` | `shirones` |
| Author in package.json | `SHIRONES_PACKAGE_AUTHOR` | — | `yCENzh` |
| Repo recorded for provenance | `SHIRONES_PACKAGE_REPOSITORY` | — | this repository |

A one-off run against a different fork or branch needs no commit — just pass the
inputs when dispatching the workflow. To change it permanently, edit the
defaults in `scripts/config.mjs` (and the `env:` block of
`.github/workflows/publish.yml`, which feeds the dispatch inputs).

Renaming the repository itself needs nothing: provenance reads
`GITHUB_REPOSITORY` at build time.
