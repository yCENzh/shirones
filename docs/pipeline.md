# Pipeline

Four scripts turn a checkout of the theme into a publishable tarball. They run
in order and each one only reads what the previous one produced, so any step
can be re-run on its own while debugging.

```text
LyraVoid/Shirone @ $SHIRONES_UPSTREAM_REF
        │
   0. version:next → the version to publish (patch bump, or an explicit request)
        │
   1. templates    → workspace/ + dist/template/   sync checkout; what `shirones init` copies
        │
   2. build        → dist/ + manifest.json         the tarball: integration + src/ + package.json
        │
   3. validate     → /tmp scratch project  real install + init + astro build + dev smoke
        │
        ▼
   npm publish --provenance
```

## 0. `pnpm version:next` — `scripts/resolve-version.mjs`

Decides which version this release publishes and exports it as
`SHIRONES_PACKAGE_VERSION` for the steps that follow. Explicit request wins;
otherwise the highest *release* on npm is patch-bumped (prereleases are ignored
when picking the base); a package name with no published versions seeds `0.0.0`.
A version that already exists on npm aborts the run.

It is not part of `pnpm all` — a local run stamps `0.0.0` unless
`SHIRONES_PACKAGE_VERSION` is exported.

## 1. `pnpm templates` — `scripts/prepare-templates.mjs`

First syncs upstream: `git clone --depth 1 --branch $SHIRONES_UPSTREAM_REF
$SHIRONES_UPSTREAM_REPO`, then copies the checkout into `workspace/` and
records the resolved commit in `workspace/.synced-sha` so the run summary can
state exactly what was packaged.

The sync then runs the theme's own `scripts/icons/generate-local-icons.mjs`
against `workspace/`. Upstream regenerates `src/generated/local-icon-collections.ts`
before every `astro dev`/`astro build` (it is gitignored — a build product, not
source), and `Icon.svelte` imports it through the `@/` alias. A fresh clone
does not contain it, so without this step the published package would ship an
import that resolves to nothing. The generator reads icon data from
`node_modules/@iconify-json/<prefix>` under its cwd, so the pipeline's own icon
sets — `devDependencies` in `package.json`, versions aligned with
`PEER_DEPENDENCIES` — are linked into the workspace's `node_modules` first. A
set the theme starts using but the pipeline does not install fails the
generator with *"Missing installed icon set"*; the fix is adding it to
`package.json`.

This repository stores **no theme source**. If `workspace/` exists it is
removed first — there is no incremental mode, and stale state is never a
possible explanation for a bad build.

Then it produces the tree that `shirones init` copies into a fresh project:

```text
dist/template/
├── astro.config.mjs           minimal config: integrations: [shirones()]
├── src/content.config.ts      three-line collection registration
├── shirones/config/           the theme's src/config/*.ts, verbatim TS
├── shirones/config/data/      the theme's src/data/*.ts
├── shirones/content/          the example posts and other collections
└── public/                    favicons and other static assets
```

The non-obvious work is **import rewriting**. A config module that upstream
lives at `src/config/musicConfig.ts` reaches its neighbours relatively:

```ts
import { musicTracks } from "../data/music.ts";
import type { FontConfig } from "../types/fontConfig.ts";
```

In the user's project that same file sits at `shirones/config/musicConfig.ts`,
where `../data/` and `../types/` point at nothing. So:

| Original | Rewritten to | Why |
| --- | --- | --- |
| `"../data/…"` | `"./data/"` | the data modules travel with the config, one level down |
| `"../{types,utils,constants,i18n,generated,components,layouts,styles,assets,plugins}/…"` | `"@/$1/"` | those live inside the installed package; `@/` is mapped there by the integration |
| `"../config/…"` (from a data module) | `"../"` | resolves to a sibling of its new parent |

Example **articles** get their own rewrites, because some Markdown syntax
resolves paths against the *project* root, not the package:

| Original (in an article) | Rewritten to | Why |
| --- | --- | --- |
| `@[code-tree …](/src/config)` | `@[code-tree …](/shirones/config)` | code-tree scans a real directory; the config is scaffolded there |
| `@include: src/content/snippets/…` | `@include: shirones/content/snippets/…` | remark-includes resolves from `process.cwd()`, and snippets are scaffolded to `shirones/content/snippets/` |

Configs stay **TypeScript**, importing their types from the package, so users
keep full autocomplete and the field set matches the theme exactly.

## 2. `pnpm build` — `scripts/build-package.mjs`

Assembles `dist/`:

- Bundles `src/integration/` with esbuild into the package entry point.
- Copies the theme's `src/` directories listed in `PACKAGE_SRC_DIRS`
  (`src/content` is excluded — it became template content in step 1).
- Writes the published `package.json`: name from `PACKAGE_NAME`, version copied
  from the theme, `exports` map, `bin` for the CLI, and the dependency sets from
  `scripts/config.mjs`.
- Copies `PACKAGE_README.md` in as the npm landing page.
- Emits `dist/manifest.json`: every injected route, every overridable component
  and layout, every config module and data module, with counts. The CI summary
  prints the counts so an accidental drop (a route that stopped being
  discovered) is visible in the run without diffing tarballs.

The version written into `package.json` comes from `SHIRONES_PACKAGE_VERSION`,
falling back to `0.0.0` when the resolver has not run (a local build stamps a
placeholder — the real number is always the resolver's job).

Dependency handling is where this step earns its keep, and the rules are
non-negotiable:

- **Anything an injected route imports must be a real `dependency`.** Upstream
  devDependencies that are imported at runtime are added through
  `EXTRA_DEPENDENCIES` — e.g. `@iconify-json/simple-icons`, which
  `src/plugins/markdown/core/file-tree-icons.mjs` needs.
- **`PEER_DEPENDENCIES` exist for tools that resolve from the user's project
  root**, where pnpm's strict layout hides the theme's own copies: `svelte`
  and `@astrojs/svelte` (`@astrojs/svelte` registers `svelte/*` subpaths and
  `@astrojs/svelte/client.js` in `optimizeDeps.include`), `sharp` (Astro's
  image service imports it from the project root), and the `@iconify-json/*`
  sets (astro-icon uses `require.resolve` outside Vite).
  `shirones init` installs them all, so users still run one command.
- A missing `exports` entry surfaces later as an opaque *"X is not a function"*
  in the user's build, so the entries are validated in step 3 rather than
  trusted.

## 3. `pnpm validate` — `scripts/validate.mjs`

The only step that proves the package actually works:

1. `npm pack` the `dist/` directory into a real tarball.
2. Create a scratch project in a temp directory and install the tarball with
   the real package manager — *not* by copying into `node_modules`, which
   skips lifecycle scripts and dependency resolution and therefore proves
   nothing.
3. Run `shirones init` in it.
4. Run `astro build` and assert the expected routes were emitted.
5. Start `astro dev` and request a page (`checkDevServer`), because dev and
   build fail in different ways — the overlay resolver and the SSR shims are
   only exercised by one of them.

Set `SHIRONES_VALIDATE_BUILD=0` to skip the build/dev portion when iterating on
earlier steps.

## Configuration

`scripts/config.mjs` holds everything environment-specific, and every value is
overridable by env var so CI can pass dispatch inputs straight through:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHIRONES_UPSTREAM_REPO` | `https://github.com/LyraVoid/Shirone.git` | Theme clone URL |
| `SHIRONES_UPSTREAM_REF` | `main` | Theme branch or tag |
| `SHIRONES_PACKAGE_NAME` | `shirones` | Published package name |
| `SHIRONES_PACKAGE_VERSION` | resolved by `version:next` | Exact version to publish |
| `SHIRONES_PACKAGE_REPOSITORY` | this repository | `repository.url`; provenance cross-checks it |
| `SHIRONES_PACKAGE_AUTHOR` | `yCENzh` | Published author field |
| `SHIRONES_PACKAGE_HOMEPAGE` | `<repository>#readme` | npm landing link |
| `SHIRONES_VALIDATE_BUILD` | `1` | `0` skips the `astro build`/dev smoke test |
| `SHIRONES_PM` | `pnpm` | Package manager used inside validation |

`CONTENT_ROOT` is intentionally **not** an env var: the user-facing directory is
fixed to `shirones` so projects scaffolded with the test package keep working
after the switch to the production name.
