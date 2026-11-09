# shirones — build & publish pipeline

This repository packages the [Shirone](https://github.com/LyraVoid/Shirone) Astro
theme as an npm package. **It contains no theme source**: everything is pulled
from upstream at build time, so the theme has exactly one source of truth.

## Using the package

**Documentation lives at <https://github.com/yCENzh/shirones/wiki>** — installation,
project layout, configuration, content, component overrides, the CLI and
troubleshooting.

The published package is `shirones`. From an empty folder:

```sh
npx shirones init   # scaffolds config, content, assets and installs everything
pnpm dev
```

No Astro starter or manual dependency install is needed — `init` writes a
`package.json` and installs `astro` plus the theme's peer dependencies. The
published package currently requires Node.js 26.13 or newer, following the
upstream theme's engine floor; `init` sets up pnpm behavior only, so npm/yarn
users must migrate the generated project themselves.
The wiki above is the full user guide;
[PACKAGE_README.md](PACKAGE_README.md) is the abridged version that ships
inside the tarball as the package README.

```text
LyraVoid/Shirone (theme + src/integration/)
        │  git clone --branch $SHIRONES_UPSTREAM_REF
        ▼
   workspace/                     synced checkout
        │
        ├─ prepare-templates.mjs  → dist/template/   (what `init` copies)
        ├─ build-package.mjs      → dist/ + manifest.json (the npm tarball)
        └─ validate.mjs           → npm pack + real install + init + astro build
        │
        ▼
   npm publish  (GitHub Actions, provenance enabled)
```

## Pipeline steps

| Script | Purpose |
| --- | --- |
| `pnpm version:next` | Decide the version to publish (patch bump, or an explicit one) |
| `pnpm test:version` | Check strict SemVer parsing rules |
| `pnpm test:templates` | Check config, data and Markdown path-rewrite fixtures |
| `pnpm test:upstream-patches` | Check fail-closed compatibility transforms on generated upstream source |
| `pnpm templates` | Clone the upstream theme into `workspace/`, then build `dist/template/`, rewriting imports for the user layout |
| `pnpm build` | Bundle the integration, copy theme source/providers, write `package.json`, provenance and the route/override `manifest.json` |
| `pnpm validate` | Pack the real npm tarball, install it in a scratch project, run `init`, then `astro build` and dev smoke tests |
| `pnpm override-test` | Install the packed tarball and exercise config/data/component/layout overrides |

Run the whole thing with `pnpm all`.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/releasing.md](docs/releasing.md) | How to cut a release, what each workflow input means, promoting to the production package name |
| [docs/pipeline.md](docs/pipeline.md) | What each pipeline script does, the import-rewrite rules, the dependency rules, every env var |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Failures that have actually happened here and what they meant |
| [AGENTS.md](AGENTS.md) | Conventions for automated contributors |
| [PACKAGE_README.md](PACKAGE_README.md) | The README shipped to npm, i.e. what users read |

The theme side of the two-mode design is documented upstream in
[`docs/npm-package-mode.md`](https://github.com/LyraVoid/Shirone/blob/main/docs/npm-package-mode.md),
including the packaging contract every new piece of theme code has to respect.

## Configuration

`scripts/config.mjs` holds everything environment-specific; the values used
most often can be overridden with an env var (full list in
[docs/pipeline.md](docs/pipeline.md#configuration)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHIRONES_UPSTREAM_REPO` | `https://github.com/LyraVoid/Shirone.git` | Theme repository |
| `SHIRONES_UPSTREAM_REF` | `main` | Branch/tag to package |
| `SHIRONES_PACKAGE_NAME` | `shirones` | Published package name |
| `SHIRONES_VALIDATE_BUILD` | `1` | Set to `0` to skip both Astro phases (lifecycle/init checks still run) |
| `SHIRONES_VALIDATE_SKIP_PRODUCTION_BUILD` | `0` | Set to `1` to skip the static build but keep the `astro dev` smoke test |

## Publishing

**Manual only** — there is no push trigger, so nothing here publishes by
accident. GitHub → Actions → **Build & Publish** → **Run workflow** exposes
three modes: `publish-only` (default; build and publish without validation),
`validate-and-publish` (full checks, then publish), and `validate-only` (full
checks and artifact, no publish). The next version is a patch bump of the
latest npm release, and the version input overrides it for a minor, major or
prerelease; an existing version fails the run. Only the separate publish job
uses the `npm` environment and `npm publish --provenance` with `NPM_TOKEN`.

See [docs/releasing.md](docs/releasing.md) for the dispatch inputs and when
they are worth changing.

## Why the theme is not vendored here

Keeping the source upstream means:

- contributors only ever edit one repository;
- the package version is decided by the release pipeline (`resolve-version.mjs`),
  never inherited from the theme;
- `workspace/` and `dist/` stay disposable and are `.gitignore`d.
