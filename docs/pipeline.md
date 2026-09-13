# Pipeline

Two side-effect-free unit checks run before the packaging pipeline:
`pnpm test:version` covers strict release versions, and `pnpm test:templates`
covers the path-rewrite fixtures. The packaging steps then turn a checkout of
the theme into a publishable tarball. Each step only reads what the previous
packaging step produced, so it can be re-run on its own while debugging.

```text
LyraVoid/Shirone @ $SHIRONES_UPSTREAM_REF
        │
   0. version:next → the version to publish (patch bump, or an explicit request)
        │
   1. templates    → workspace/ + dist/template/   sync checkout; what `shirones init` copies
        │
   2. build        → dist/ + manifest.json         the tarball: integration + src/ + package.json
        │
   3. validate     → /tmp scratch project  real tarball + init/force/info lifecycle
        │
   4. override-test → /tmp scratch project baseline + override Astro builds
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

Three files in `src/config/` are deliberately **not** copied, and the reason
differs for each. `index.ts` is the package's barrel — shipping it would let a
user break the named-export contract the theme relies on. `README.md` is
documentation for theme contributors. `integrationsConfig.ts` is skipped because
nothing in the user's project reads it: package mode imports it from
`src/config/` at build time, so esbuild inlines it into `dist/index.js` and the
scaffolded copy would be inert. Every other file in that directory *is* live —
consumed through the `@/` alias or resolved by `loadConfigModule()` — so shipping
an editable-looking file that does nothing would be a trap. If the theme ever
routes integration options through `loadConfigModule()` so users can override
them, drop it from the `skip` predicate in `prepare-templates.mjs` §1.
`override-test.mjs` reads its expected config-module count from
`dist/template/` rather than from `manifest.json`, so changing this skip list
does not need a matching edit there.

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
- Ships every top-level `src/` directory except the `PACKAGE_SRC_EXCLUDES`
  set (`content`, `integration`) — upstream adding a directory needs no
  pipeline change.
- Writes the published `package.json`: name from `PACKAGE_NAME`, release version
  from `SHIRONES_PACKAGE_VERSION`, `exports` map, `bin` for the CLI, Node.js
  `>=22.12.0` engines, and the dependency sets from `scripts/config.mjs`.
- Copies `PACKAGE_README.md` in as the npm landing page.
- Ships the runtime anime providers used by the optional `fetchOnDev` snapshot
  mode; the Bilibili provider resolves writes from the user's project root.
- Emits `dist/build-info.json` with the upstream SHA, pipeline commit, Node and
  pnpm versions. It is included in the npm tarball for post-release auditing.
- Emits `dist/manifest.json`: every injected route, every overridable component
  and layout, every config module and data module, with counts. The component
  and layout lists are an inventory; they are not a claim that every file is
  reachable from the default routes. The CI summary prints the counts so an
  accidental drop (a route that stopped being discovered) is visible in the run
  without diffing tarballs.

The version written into `package.json` comes from `SHIRONES_PACKAGE_VERSION`,
falling back to `0.0.0` when the resolver has not run (a local build stamps a
placeholder — the real number is always the resolver's job).

Dependency handling is where this step earns its keep, and the rules are
non-negotiable:

- **Anything an injected route imports must be a real `dependency`.** Upstream
  devDependencies that are imported at runtime are added through
  `EXTRA_DEPENDENCIES` — e.g. `@iconify-json/simple-icons`, which
  `src/plugins/markdown/core/file-tree-icons.mjs` needs.
- **Peer dependencies exist for tools that resolve from the user's project
  root**, where pnpm's strict layout hides the theme's own copies: `svelte`
  and `@astrojs/svelte` (`@astrojs/svelte` registers `svelte/*` subpaths and
  `@astrojs/svelte/client.js` in `optimizeDeps.include`), `sharp` (Astro's
  image service imports it from the project root), and the `@iconify-json/*`
  sets (astro-icon uses `require.resolve` outside Vite).
  `shirones init` installs them all, so users still run one command.
  Their ranges are derived from the upstream manifest by
  `resolvePeerDependencies`, which follows upstream's floor and widens an
  exact pin to its caret line. This matters because `dependencies` is
  inherited from upstream verbatim, so a peer that does not admit the declared
  version makes the package uninstallable under pnpm.
  `PEER_DEPENDENCY_FALLBACKS` in `scripts/config.mjs` only supplies a range
  where upstream does not declare the package (`simple-icons`, a
  devDependency there). Do not pin a runtime-critical package there that
  upstream also declares — that is how `sharp` drifted a minor behind and
  users' dev servers failed with `MissingSharp`.
- A missing `exports` entry surfaces later as an opaque *"X is not a function"*
  in the user's build, so the entries are validated in the `pnpm validate`
  tarball check rather than trusted.

## 3. `pnpm validate` — `scripts/validate.mjs`

The only step that proves the package actually works:

1. Assert the two Astro config entry points have not drifted. The theme is
   configured twice: `astro.config.mjs` (`defineConfig`, source mode) and
   `src/integration/index.ts` (`updateConfig` + `createBundledIntegrations`,
   package mode). Both now read the shared options from the theme's
   `src/config/integrationsConfig.ts`, so the duplication that used to drift is
   gone — but the two declarations still exist, each still sets config keys,
   and package mode still never reads `astro.config.mjs` while source mode
   still never runs the integration. The check compares the *shape*: the set of
   config keys each side sets, the `vite` sub-keys each side touches, and the
   integrations each side installs (`EXPECTED_INTEGRATIONS`). The options
   inside those calls are **not** compared — several differ legitimately
   (package mode pre-bundles defensively and aliases `@iconify/svelte` to the
   offline build; source mode subsets fonts at build time) — they are printed
   as call sizes so a change in shape is visible in the log. Skipped when
   `workspace/` has not been synced. See
   [troubleshooting](troubleshooting.md#config-parity) for the drift this
   catches.
2. `npm pack` the `dist/` directory into a real tarball and assert required
   files are in the packed file list.
3. Create a scratch project in a temp directory and install that tarball with
   the real package manager — *not* by copying into `node_modules`, which
   skips lifecycle scripts and dependency resolution and therefore proves
   nothing.
4. Run `shirones init` in it.
5. Run `astro build` and assert the expected routes were emitted.
6. Start `astro dev` and exercise it the way a browser would
   (`checkDevServer`), because dev and build fail in different ways — the
   overlay resolver and the SSR shims are only exercised by one of them.
   Rendered HTML alone proves nothing about the client module graph: pages
   render server-side, while `vite:import-analysis` only transforms a module
   when it is requested. So the check renders a set of routes, fetches the
   injected `astro:scripts/page.js` (asserting no bare `@swup/astro/*`
   specifiers survived transformation), then crawls the module graph — every
   `<script>` and stylesheet the pages reference, then every import inside
   those modules, re-seeding from fresh HTML when Vite re-optimizes
   dependencies mid-crawl — and finally scans the server log for error lines.
   Unversioned URLs that Vite has pre-bundled (Astro's own dev toolbar) are
   reported and skipped: after a mid-session re-bundle they answer 504 until
   the server restarts, in a browser as much as here. See
   [troubleshooting](troubleshooting.md#validation) for the details.

Set `SHIRONES_VALIDATE_BUILD=0` to skip the build/dev portion when iterating on
earlier steps. The tarball install and lifecycle checks still run. The
Build & Publish workflow runs the **full** mode: the dev smoke test is the only
place `astro dev` is exercised anywhere in the pipeline, and skipping it as
duplicate work is how a dev-only module-resolution regression (the 0.1.2
`@swup/astro` subpaths) once reached users — see `docs/troubleshooting.md`.
Run `pnpm validate` without this variable whenever the dev-server smoke test
itself is the thing being investigated.


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
| `SHIRONES_PM` | `pnpm` | Package manager used inside validation; the package's user-facing `init` contract remains pnpm-only |

`CONTENT_ROOT` is intentionally **not** an env var: the user-facing directory is
fixed to `shirones` so projects scaffolded with the test package keep working
after the switch to the production name.
