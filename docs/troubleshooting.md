# Troubleshooting

Failures that cost real time, and what they actually meant. Roughly ordered
from "you will hit this" to "hopefully never again".

## Publishing

**`[version] … is already published`.**
The version input names a version that exists on npm, which npm will never let
you overwrite. Leave the input blank to take the next patch, or pick a higher
version. (This used to be a silent skip; it fails now, because a release that
does nothing looks exactly like a release that worked.)

**`npm publish` fails provenance verification.**
`repository.url` in the published `package.json` must point at
`yCENzh/shirones` — the repository whose workflow signs the release — not at the
theme. `scripts/config.mjs` derives it from `GITHUB_REPOSITORY`; overriding
`SHIRONES_PACKAGE_REPOSITORY` with the theme URL breaks it.

**A freshly published version is "not found" moments later.**
Large tarballs take a few minutes to propagate through the npm CDN. Wait rather
than re-running the workflow.

**`pnpm build` fails: "the shipped source imports packages that are not declared as dependencies" listing a `@shirone/...` specifier.**
The dependency scanner flags every bare import it cannot tie to a `dependency`.
Specifiers that the integration resolves itself — the `@shirone/iconify-offline*`
Vite aliases defined in `createAliases()` (they point into `@iconify/svelte/dist`),
or `swup`/`hast`/`mdast`/`unified` which resolve transitively — belong in
`IGNORED_IMPORTS` in `scripts/config.mjs`, not in `EXTRA_DEPENDENCIES`. Adding a
non-package alias to `EXTRA_DEPENDENCIES` would publish a broken dependency.

**`pnpm build` fails the same way, but listing a package that only appears in an
`import type`.** That used to be a false positive: the scanner's regex matched
`import type { X } from "vite"` like any other import, and `vite` is a peer of
astro rather than a declared dependency, so the release failed on an import that
is erased at compile time and can never reach a user's Node process. The regex
now skips `import type` / `export type` (see the comment on `IMPORT_RE` in
`scripts/build-package.mjs`). If you see this failure today the import is a real
one — check that the specifier is not an alias before reaching for
`EXTRA_DEPENDENCIES`.

**Anime live provider warning during package build.** The optional Bangumi and
Bilibili providers are shipped under `scripts/anime/providers/` and are only
loaded when snapshot mode has no local snapshot and `fetchOnDev` is enabled.
The default local anime mode does not make network requests. If an older package
still reports these providers as missing, upgrade to a release that includes the
runtime provider files.

## Installing the package as a user

**`ERR_PNPM_IGNORED_BUILDS` on `pnpm add`.**
Expected and harmless. pnpm 11 requires build scripts to be approved, and only
honours the `allowBuilds` list in `pnpm-workspace.yaml`. `shirones init` writes
that file.

**`pnpm shirones init` refuses to start.**
Same cause: with unapproved build scripts pending, `pnpm exec` / `pnpm <cli>`
will not run. Use `npx shirones init` (or `./node_modules/.bin/shirones init`).

**pnpm refuses to install the version that was just published.**
Recent pnpm releases can enforce a non-zero `minimumReleaseAge` and refuse a
package published minutes ago. First check whether that policy is intentional
and wait for the required age when it is. For a one-off local test only, pass
`--config.minimumReleaseAge=0`; do not silently commit that override to a user
project.

**The theme does not apply at all — a stock Astro welcome page renders.**
`init` used to leave an existing `astro.config.mjs` untouched. Fixed in 0.0.8:
`ensureAstroConfig()` checks all five config extensions, skips if the file
already mentions the package, otherwise moves it into `.shirones-backup/` and
writes the template. `clearStarterFiles()` does the same for the five starter
files, and only treats a `.astro` file as a starter if it actually contains the
welcome markup.

**`init --force` replaced my content.** This flag intentionally re-scaffolds
from the installed template. Before replacing `shirones/`, `public/`, or a
project-level scaffold file, the CLI moves the previous copy into
`.shirones-backup/`. Use plain `init` to report drift or `init --update` to add
missing files without replacing existing content.

## Upgrading the theme

**`defineCollections is not a function` after upgrading.** Breaking change: the
`shirones/collections` one-liner is gone, because Astro's typegen cannot
introspect a schema hidden behind a function call — it needs `defineCollection`
with the schema inline. `init --force` rewrites `src/content.config.ts` for you;
to migrate by hand, replace

```ts
import { defineCollections } from "shirones/collections";
export const collections = defineCollections();
```

with one `defineCollection` per collection, importing `postSchema`,
`momentSchema` and `specSchema` (and `seriesSchema` once the series feature
ships) from `shirones/collections`. Keep the `glob({ base })` paths pointing at
`./shirones/content/…` — see the next entry.

**`[glob-loader] The base directory "…" does not exist.`** The collection's
`base` does not match where the content actually is. In a package-mode project
content lives under `shirones/content/`, so the bases must read
`./shirones/content/posts` and so on — not `./src/content/posts`, which is the
*theme repository's* own layout. This is a warning, not an error: Astro logs it
and builds the site with that collection silently empty, which is why
`validate.mjs` now asserts that every base in the scaffolded
`content.config.ts` resolves to a real directory.

Content directories themselves need no pipeline work: `prepare-templates.mjs` §3
copies the theme's `src/content/` into the template recursively and
unconditionally, so a new collection's directory ships as soon as the theme has
it. What does need updating here is the hard-coded collection list in the
generated `content.config.ts` (§5).

**A new theme version's per-article features do not appear on existing posts.**
Astro's content layer caches rendered entries and keys that cache on the
*content*, not on the theme version — and hosts like Vercel restore the cache
between deployments. So after upgrading the package, an article whose Markdown
has not changed keeps the HTML an older version of the theme produced, and
anything the new version would have added (a deferred stylesheet pack, changed
component markup) is missing from exactly those pages while new or edited
articles look correct.

It is not a package-mode bug — a source-mode upgrade behaves the same — but it
is easy to misread as one, because the symptom is a *subset* of pages behaving
like the old version. Clear the host's build cache after upgrading, or delete
`.astro/` locally.

## Styling

**Colours and radii are right, but the layout is destroyed.**
Tailwind v4's automatic content detection **never scans `node_modules`**. In
source mode the theme's components are inside the project and get scanned; as a
package they are not, so every base utility (`w-full`, `mx-auto`, `inline-flex`,
`min-h-screen`, …) is missing while the theme's own CSS variables and Stylus
components survive — hence the "styled but collapsed" look. The theme's
`src/styles/main.css` must carry, right after `@import "tailwindcss"`:

```css
@source "../**/*.{astro,svelte,ts,tsx,js,jsx,mjs,cjs,md,mdx,html}";
```

The path is resolved relative to the CSS file, so it points at the theme's own
`src/` in both modes. Fixed in 0.0.9 — if it regresses upstream, this is the
line to look for.

**Diagnosing missing classes.** Collect `class="…"` from the rendered HTML as
*used*, concatenate every stylesheet plus inline `<style>`, `.replace("\\","")`
to strip Tailwind's escapes, and extract `\.([^\s{},:>+~()\[\]"']+)` as
*defined*. Then compare the package build's missing set against the source
build's missing set — **only the difference matters**; both builds legitimately
"miss" ~145 selectors that are escaped or generated by JS. Skipping the
unescaping step produces hundreds of false positives.

## Building

**`ENOENT` for a file under `src/` during the user's build.**
Something in the theme called `process.cwd()` and assumed it was the theme
root. In package mode `cwd` is the *user's* project. See the packaging contract
in the theme's [`docs/npm-package-mode.md`](https://github.com/LyraVoid/Shirone/blob/main/docs/npm-package-mode.md).

**`ERR_PACKAGE_PATH_NOT_EXPORTED` while probing whether a package exists.**
Do not use `createRequire` / `require.resolve` for availability checks against
ESM-only packages. In plugin mode the integration skips `optimizeDeps.include`
entirely instead.

**A bare specifier resolves to a root-relative URL.**
The overlay Vite plugin must never round-trip *every* specifier through
`this.resolve()` — Vite 8 interprets an unresolved bare specifier as a
root-relative URL. It only intervenes on the known alias prefixes, or on
relative paths whose importer is inside the package.

**`data:` URL dynamic import cannot resolve a bare specifier.**
`load-config.ts` bundles user config with esbuild and inlines every npm
dependency, leaving only `astro*` external, precisely because of this.

## Validation

**Validation prints repeated `An error happened during full reload` messages after it already reports success.**
This usually means the `pnpm exec astro dev` launcher exited while its Astro/Vite
child process kept watching the scratch directory. Removing `.validate/` then
makes the surviving watcher reload files that no longer exist. The validation
script now starts a process group, terminates the whole group, waits for exit,
and only then removes the scratch project. Check the first error before the
reload flood: it is the useful one; the later missing-file errors are usually
cleanup fallout.

**`astro dev` starts in CI but every request fails.**
Two separate traps: `astro dev` binds only to localhost unless given
`--host 127.0.0.1`, and it prints `ready in …` *before* the socket accepts
connections. `checkDevServer()` handles both with an explicit host and a retry
loop.

**Validation "passes" but the package is broken for users.**
Almost always because the package was tested by copying `dist/` into
`node_modules/<pkg>` instead of installing a packed tarball. That skips
lifecycle scripts and real dependency resolution. Always `npm pack` + install.

**A dev-only resolution bug (0.1.2, `@swup/astro/serialise` & friends) reached
users while every pipeline check was green.**
Three gaps stacked up:

1. The failure existed only in `astro dev`. Production builds resolved the
   injected script's imports through the theme's fallback resolver; the dev
   server died on them because Vite 8's builtin resolver answers an
   unresolvable bare specifier from a virtual importer with a root-relative
   pseudo path instead of `null`, which made the fallback resolver stand down.
   Fixed in the theme (`isGenuineResolution` in `fallback-resolver.ts`).
2. The Build & Publish workflow ran `validate` with
   `SHIRONES_VALIDATE_BUILD=0`, so `astro dev` never started anywhere in CI.
   The workflow now runs the full mode.
3. Even when the dev smoke test ran, it only fetched rendered HTML — pages
   render server-side, so a module that 500s during on-demand transform stays
   invisible. `checkDevServer()` now crawls the client module graph (scripts,
   stylesheets and their transitive imports), re-seeds when Vite re-optimizes
   dependencies mid-crawl, asserts no bare `@swup/astro/*` specifiers survive
   in the transformed page script, and scans the dev server log for error
   lines. Its timeouts were also widened (60 s per attempt, 120 s per route):
   the old 5 s/30 s budget flaked on cold or memory-constrained machines and
   had never been exercised by CI.
   One known false positive is exempted: Astro injects the dev toolbar with a
   bare `/@id/astro/runtime/client/dev-toolbar/entrypoint.js` URL that maps
   to a pre-bundled dep, and once Vite re-bundles mid-session that exact URL
   keeps answering 504 "Outdated Optimize Dep" until the server restarts —
   for a real browser too, so it is not a theme regression. The crawl skips
   unversioned URLs that appear in Vite's optimizer metadata (and reports
   them); every other stale or failing module still fails the check.

If a user reports "dev is broken but the deployed site works", reproduce with
`pnpm validate` in full mode before anything else.

### Config ownership

**`validate` fails with "astro.config.mjs owns config keys it must not".**
The theme runs the integration in every mode now, so `astro.config.mjs` must
stay a delegation (`integrations: [shirones()]` and nothing else). A key set
there applies only to the repo's own site and silently drifts away from what
npm users get. Move option values to the theme's
`src/config/integrationsConfig.ts` and wiring to
`src/integration/index.ts`; if a value genuinely is repo-only (there are none
today), gate it on `paths.isInRepo` inside the integration instead of putting
it back into the config file.

**`validate` fails with "astro.config.mjs does not delegate to shirones()".**
Someone removed or renamed the integration call; source mode would boot with
no theme config at all. Restore `integrations: [shirones()]`.

**`validate` fails with "the integration's updateConfig() no longer sets …".**
With a single config entry point, one of the keys every mode needs
(`base`, `trailingSlash`, `image`, `fonts`, `integrations`, `markdown`,
`vite`) disappeared from `src/integration/index.ts`. `site` is allowed to be
absent because it is spread in conditionally.

**`validate` fails with "createBundledIntegrations() no longer installs …".**
An integration from `EXPECTED_INTEGRATIONS` was dropped or renamed.
`EXPECTED_INTEGRATIONS` in `scripts/validate.mjs` is a fixed list on purpose —
a new integration upstream means adding it there too, otherwise the check
passes without ever looking at it.

**Historical note — the old config-parity check.** Until the theme started
running the integration itself, `astro.config.mjs` and the integration were
two hand-maintained declarations and `validate` diffed their shapes. Three
real drifts were found that way; all are now structurally impossible with a
single entry point:

- ~~`sitemap()` filter~~ — fixed via `loadConfigModule` (`sitemapFilter`).
- ~~`swup().updateHead.persistTags`~~ — fixed via `swupOptions` in
  `integrationsConfig.ts`.
- `vite.build.esbuild` (`drop`/`pure`) — **was never working at all.** Astro 7
  ships Vite 8, which has no `build.esbuild` key; the old `astro.config.mjs`
  carried one and Vite silently ignored it, so source-mode builds never
  actually stripped `console.log`. The integration now puts the transform
  options on Vite's top-level `esbuild` key, gated to `paths.isInRepo &&
  command === "build"` so package-mode builds keep user `console.log` output
  and the dev server stays verbose. See the comment at that use site in
  `src/integration/index.ts`.
