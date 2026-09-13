# Plan: single-source Astro config

**Status:** plan only — nothing here is implemented.
**Applies to:** `yCENzh/Shirone` branch `fix` (at `831707e`), consumed by this
pipeline.
**Predecessor:** `3990d1d` added a config-parity assertion to
`scripts/validate.mjs`. That check catches *shape* drift. This plan removes the
duplication the check exists to police.

---

## 1. The problem

The theme is configured twice, by hand, with nothing shared between the two
declarations.

| | source mode | package mode |
| --- | --- | --- |
| File | `astro.config.mjs` (312 lines) | `src/integration/index.ts` (575 lines) |
| Entry | `defineConfig({ … })` at line 154 | `updateConfig({ … })` at line 279 |
| Integration list | inline, lines 159–253 | `createBundledIntegrations()`, lines 418–572 |
| Read by | Astro directly, at `resolveConfig` | Astro, at `astro:config:setup` |

Neither file imports the other. Package mode never reads `astro.config.mjs`;
source mode never runs the integration. So every change has to be made twice,
and nothing fails when only one is made.

This is not hypothetical. Four divergences exist on the current tree, all
verified by reading both files:

| # | Where | Source mode | Package mode | User-visible effect |
| --- | --- | --- | --- | --- |
| D1 | `sitemap()` | `filter: isSitemapPageAllowed` (`astro.config.mjs:247`) | `sitemap()` bare (`index.ts:570`) | Disabled pages leak into npm users' `sitemap.xml` |
| D2 | `swup().updateHead.persistTags` | `link[rel=stylesheet]:not([data-swup-optional]), style:not([data-swup-optional])` (`astro.config.mjs:172-175`) | `link[rel=stylesheet], style` (`index.ts:490`) | Stale stylesheets persist across navigation for npm users |
| D3 | `vite.build.esbuild` | `drop: ["debugger"]`, `pure: ["console.log", "console.debug"]` (`astro.config.mjs:293-297`) | absent | npm builds keep console/debugger output |
| D4 | `icon().include` | `"preprocess: vitePreprocess()": ["*"]` (a stray malformed key), and **omits** `material-symbols` + `simple-icons` (`astro.config.mjs:182-188`) | correct 5-collection list (`index.ts:496-505`) | Source mode only works because astro-icon falls back to auto-discovery in a flat `node_modules` |

D1 and D2 are real regressions for npm users. D4 is a latent bug in *source*
mode — the malformed key is inert and the two missing collections are 329 of
the 340 icon references in `src/` (`material-symbols` 308, `simple-icons` 21).
D3 is a bundle-quality gap.

`docs/npm-package-mode.md:100` already has a section titled "Things to keep in
sync", and it is silent on the largest thing that has to be kept in sync. That
is the tell: the duplication predates the documentation of the contract.

---

## 2. What can be shared, and what cannot

The two modes are *not* symmetric, and pretending otherwise is how this kind of
refactor fails. Sorting every option into "shareable" / "genuinely
mode-specific" is the actual content of the work.

### 2.1 Shareable (the target)

| Item | Source location | Notes |
| --- | --- | --- |
| `trailingSlash: "always"` | `astro.config.mjs:157` / `index.ts:282` | Already identical. |
| `image.endpoint.route: "/_image/"` | absent / `index.ts:283` | Must become shared — see §4, this is the trap. |
| `swup()` options | `astro.config.mjs:161-180` / `index.ts:479-494` | All of it, including D2. |
| `icon().include` | `astro.config.mjs:182-188` / `index.ts:496-505` | Share the correct 5-collection list; fix D4. |
| `expressiveCode()` `themes`/`defaultProps`/`styleOverrides`/`frames` | `astro.config.mjs:190-236` / `index.ts:509-548` | Byte-identical today apart from `as never` casts. |
| `svelte().compilerOptions` | `astro.config.mjs:237-245` / `index.ts:550-568` | `cssHash` + `warningFilter` are the same logic. |
| `sitemap({ filter })` | `astro.config.mjs:246-248` / `index.ts:570` | Fixes D1. |
| `mdx()` options | `astro.config.mjs:249-252` / `index.ts:571` | Trivial. |
| `vite.build` `{minify, cssCodeSplit, cssMinify, chunkSizeWarningLimit, rollupOptions.onwarn}` | `astro.config.mjs:288-311` / `index.ts:312-341` | The `onwarn` body is identical. |

### 2.2 Genuinely mode-specific (must stay separate)

These are not drift. Do not merge them.

| Item | Why it must differ |
| --- | --- |
| `vite.resolve.alias` | Source mode aliases `@iconify/svelte` → `./src/components/atoms/display/Icon.svelte` and reads the offline files from `./node_modules/@iconify/svelte/dist/`. Package mode resolves them through `createRequire(import.meta.url).resolve("@iconify/svelte/package.json")` because that directory lives inside the theme's own dependency tree, and it additionally maps `@components/`, `@utils/`, `@layouts/`, `@i18n/`, `@constants/`, `@assets/`, `@/` onto `paths.packageSrc`. Different root, different tree. |
| `svelte().preprocess` | Source mode gets `vitePreprocess({ script: true })` from the repo's `svelte.config.js`; a user's project has no such file (the pipeline never generates one — confirmed: no `svelte.config` anywhere in `scripts/`), so the integration must pass it explicitly. 85 of 91 `.svelte` files use `<style lang="stylus">`, so this is load-bearing. |
| `vite.optimizeDeps.include` | Source mode lists four packages unconditionally. Package mode runs them through `prebundleCandidates()`, which returns `[]` in plugin mode because Vite resolves `optimizeDeps.include` from the *project* root and cannot see the theme's nested `node_modules`. |
| `vite.plugins` | Source mode: `[optionalMusicSidebarPlugin, tailwindcss()]`. Package mode: overlay + fallback-resolver + SSR shims + `createMusicSidebarPlugin(paths, musicEnabled)` + tailwind. The music-sidebar plugin is the same *idea* with a parametric twin — the module id and the `generateBundle` pruning list are identical, but the resolved sidebar path differs (`./src/components/...` vs `join(paths.packageSrc, ...)`). |
| `expressiveCode().plugins` | Source mode imports `pluginLanguageBadge` / `pluginCustomCopyButton` statically. Package mode loads them through `loadPackageModule(paths, …)` so the user's overrides apply. |
| `expressiveCode().themes` | Same expression, but the `expressiveCodeConfig` object arrives differently: source mode imports it; package mode calls `loadConfigModule(paths, "expressiveCodeConfig", registryRef)`. |
| `fonts` | Source mode builds from `resolvedFontOptions` + `getLocalFontVariants`. Package mode uses `buildFontDeclarations()` from `src/integration/fonts.ts`. |
| `markdown.processor` | Source mode imports `siteMarkdownProcessor`; package mode resolves it through the registry. |
| `site` / `base` | Source mode reads `siteConfig` directly; package mode guards with `siteConfig?.site` because the overlay can legitimately be absent. |
| Route injection, watcher, pagefind | Package-mode only. No source equivalent. |

**Roughly: options are shareable, wiring is not.** That is the shape the
refactor should have.

---

## 3. Design

Create one module that exports *option values and small factory functions*, and
have both entry points assemble the config around it.

### 3.1 Where it lives

`src/config/integrationsConfig.ts`.

`src/config/` is already the shared home and `astro.config.mjs` already imports
seven modules from it (`expressiveCodeConfig`, `fontConfig`, `musicConfig`,
`sidebarConfig`, `siteConfig`, `umamiConfig`, `sitemapFilter`). It ships with
the package: `PACKAGE_SRC_EXCLUDES` is `{"content", "integration"}`, so
`src/config/` is copied into `dist/src/config/` verbatim
(`build-package.mjs:156-158`), and `prepare-templates.mjs:136-141` copies it
into the user's `shirones/config/` with import rewriting. Both consumers can
therefore reach it with no pipeline change.

Two consequences of that copy worth knowing before writing the module:

- `prepare-templates.mjs:140` skips `index.ts` and `README.md`, so the
  `src/config/index.ts` barrel does **not** reach the user's project. The new
  module must be imported by its own path
  (`../config/integrationsConfig.ts`), never through the barrel, or the
  package build breaks while source mode keeps working.
- `CONFIG_REWRITES` (`template-rewrites.mjs:6-10`) rewrites `../types/`,
  `../utils/`, `../constants/` and friends to `@/…`, and `../data/` to
  `./data/`. The new module should import **nothing** from those directories —
  it is options and pure functions, so this is easy to satisfy and
  `assertNoEscapedImports` (`prepare-templates.mjs:162-181`) will fail the
  build if it is violated.

`src/integration/` would be the wrong home: it is in `PACKAGE_SRC_EXCLUDES`, is
esbuild-bundled into `dist/index.js`, and `astro.config.mjs` cannot import from
it without dragging the Node-side module graph into Vite's config load.

### 3.2 Contents

Everything here is a plain value or a pure function. No mode-specific imports.

```ts
// src/config/integrationsConfig.ts

/** Shared by both entry points. See the comment in src/integration/index.ts
 *  updateConfig() for why the trailing slash on the image route is required. */
export const TRAILING_SLASH = "always";
export const IMAGE_ENDPOINT_ROUTE = "/_image/";

export const swupOptions = { /* …full object, incl. persistTags with
                               :not([data-swup-optional])… */ };

export const iconInclude = {
  "material-symbols": ["*"],
  "simple-icons": ["*"],
  "fa6-brands": ["*"],
  "fa6-regular": ["*"],
  "fa6-solid": ["*"],
};

/** `styleOverrides`, `defaultProps`, `frames` — everything in expressiveCode()
 *  that is not `themes` (needs the resolved config) or `plugins` (needs
 *  mode-specific loading). */
export const expressiveCodeShared = { /* … */ };

/** `compilerOptions` only; `preprocess` stays mode-specific. */
export const svelteCompilerOptions = { /* cssHash, warningFilter */ };

export const mdxOptions = { syntaxHighlight: false, optimize: true };

/** `minify`, `cssCodeSplit`, `cssMinify`, `chunkSizeWarningLimit`,
 *  `rollupOptions`. `esbuild` is added by source mode only (D3 — decide
 *  whether to share it; see §5). */
export const viteBuildShared = { /* … */ };

/** The pre-bundle hint list, before mode-specific filtering. */
export const prebundleSpecifiers = [
  "mermaid", "@panzoom/panzoom", "overlayscrollbars", "@fancyapps/ui",
];

/** The music-sidebar virtual module id and the bundle-pruning predicates —
 *  identical on both sides today, so they belong here even though the plugin
 *  objects themselves cannot be shared. */
export const MUSIC_SIDEBAR_VIRTUAL_ID = "virtual:shirone-music-sidebar";
export function isMusicBundleFile(fileName: string): boolean { /* … */ }
```

`sitemap` needs a function, not a value, because the filter has to be callable
from both sides. `src/config/sitemapFilter.ts` already exports
`isSitemapPageAllowed`, so nothing new is required — both sides just have to
pass it.

### 3.3 What each entry point becomes

`astro.config.mjs`:

```js
import { iconInclude, mdxOptions, swupOptions, /* … */ } from "./src/config/integrationsConfig.ts";
// …
swup(swupOptions),
icon({ include: iconInclude }),
sitemap({ filter: isSitemapPageAllowed }),
mdx(mdxOptions),
```

`src/integration/index.ts`:

```ts
import { iconInclude, mdxOptions, swupOptions, /* … */ } from "../config/integrationsConfig.ts";
// …
swup(swupOptions),
icon({ include: iconInclude }),
sitemap({ filter: (page: string) => isSitemapPageAllowed(page) }),
mdx(mdxOptions),
```

Note the asymmetry that survives: package mode must *load*
`isSitemapPageAllowed` through `loadConfigModule(paths, "sitemapFilter", …)` so
the user's own copy wins, exactly as it already does for
`expressiveCodeConfig`. Source mode imports it directly. The *filter logic* is
single-source; the *resolution* stays mode-specific. Same pattern as
`expressiveCode().themes`.

---

## 4. The trap: `image.endpoint.route`

This is the one place where "make it shared" is actively dangerous, and it is
why this section is separate.

`astro.config.mjs` does **not** set `image` today. Only the integration does
(`index.ts:282`), with an 18-line comment explaining why: Astro normalises
`image.endpoint.route` once, in the zod `.transform` at
`dist/core/config/schemas/relative.js:71-86`, which runs from `validateConfig`
← `resolveConfig`. Source mode reaches that transform with
`trailingSlash: "always"` already present in `defineConfig`, so the transform
appends the slash itself. Package mode reaches it before `updateConfig` has run,
so the route stays `/_image` while the router pattern becomes `/^\/_image\/$/`,
and every dev image request 404s.

**Consequence: setting `image: { endpoint: { route: "/_image/" } }` in
`astro.config.mjs` is harmless** — it produces the same string the transform
would have produced. But the reason it must be in the integration does not
disappear, and the comment must travel with the constant, not stay behind in
`index.ts`. `IMAGE_ENDPOINT_ROUTE` in the shared module must carry:

- what the defect is (transform runs before `config:setup`),
- the pairing table (`"always"` → `/_image/`, `"never"`/`"ignore"` → `/_image`),
- the tracking issues (`withastro/astro#11568`, `#10149`),
- what to delete when upstream fixes the ordering.

This is a standing instruction for this repository: any workaround for an
upstream defect carries a comment stating the defect, why the workaround
exists, and what to change when upstream fixes it.

The parity check already encodes this asymmetry as `PACKAGE_ONLY_KEYS = new
Set(["image"])` in `scripts/validate.mjs`. **After this refactor lands, `image`
should move out of that set** — it becomes a shared key. Leaving it in the set
would silently permit a future one-sided removal, which is the exact failure
mode the set exists to flag.

---

## 5. Decisions to make before implementing

Each of these changes behaviour for someone. They are listed rather than
decided here.

**Q1 — D1 (`sitemap` filter).** Not really a decision: shipping disabled pages
in `sitemap.xml` is a bug. Fixes itself by sharing. **Confirm:** are any
currently-published npm users relying on the unfiltered sitemap? (Almost
certainly not — nothing could depend on it deliberately.)

**Q2 — D2 (`persistTags`).** Sharing means npm users get
`:not([data-swup-optional])`. That is the intended behaviour — `data-swup-optional`
is emitted by the theme's own pages (`src/pages/[...permalink].astro:178-180`,
`about.astro:30`, `posts/[...slug].astro:181-183`), which package mode also
injects. **Risk:** low. Behaviour change is a fix, but it *is* a behaviour
change and belongs in a changelog note.

**Q3 — D3 (`vite.build.esbuild`).** Sharing means npm builds start stripping
`console.log` / `console.debug` / `debugger`. **This is the one with real
risk.** A user who logs from their own code to debug an override would silently
lose it. Options:
- (a) share it — matches source behaviour, smallest surface;
- (b) share it but only under a flag;
- (c) leave it source-only and record it in `PACKAGE_ONLY_KEYS`-style
  documentation as a deliberate difference.

Recommendation: (a), documented in the release notes, because the alternative
leaves a permanent divergence in a list whose whole purpose is to be
divergence-free. But it needs a deliberate yes.

**Q4 — D4 (`icon().include`).** Sharing the correct 5-collection list changes
*source* mode: it gains `material-symbols` and `simple-icons` explicitly and
loses the malformed `"preprocess: vitePreprocess(),"` key. Expected effect is
none at runtime (astro-icon was auto-discovering them) but build times may move
and the malformed key's disappearance should be called out. **Verify with a
source-mode build before/after and diff the emitted icon CSS.**

**Q5 — `swup().ignore` type.** `astro.config.mjs:163` passes the bare string
`'a[href="#"]'`; `index.ts:482` passes `['a[href="#"]']`.
`@swup/astro@1.8.0`'s declared type is `(string | RegExp)[] | ((url, …) => …)`
(`package/dist/index.d.ts:12`) — a bare string is **not** assignable. At runtime
`script.js:89-105` handles a bare string fine (`typeof ignore === 'string'` →
`el?.matches(ignore)`), and `Array.isArray` handles the array, so both work
today. The shared value must pick one; the array is the typed one. Source mode
currently relies on `astro.config.mjs` being untyped JS, so it will not notice.
**Also note** `index.ts:467-475` keeps a `swupForwardOptions` spread with a
comment saying `animateHistoryBrowsing` and `skipPopStateHandling` are not in
1.8.0's `Options` type and are silently dropped at runtime. Sharing the object
has to preserve that spread or the excess-property check starts failing.

**Q6 — how far to go.** Three scopes:
- **A (minimal):** share the option objects listed in §2.1. Both entry points
  keep their own integration list and `updateConfig`/`defineConfig` shape.
- **B:** also share a `createBundledIntegrations(deps)` factory that takes the
  already-resolved `themes`, `plugins`, `preprocess`, `filter` as arguments, so
  the *list* is single-source too.
- **C:** also share the music-sidebar plugin factory (parametrise the sidebar
  path) and the `onwarn` handler.

Recommendation: **A, then B in a separate commit.** C is where the marginal
benefit drops — the plugin bodies differ in more than a path
(`enforce`/`resolveId`/`load`/`generateBundle` are the same, but the resolved
id string differs by one `\0` prefix convention) and a shared factory that
takes four arguments to save 20 lines is a worse artefact than the duplication.
Share `MUSIC_SIDEBAR_VIRTUAL_ID` and `isMusicBundleFile` (the two things that
are actually identical and actually drift-prone) and leave the plugin objects
alone.

---

## 6. Sequencing

Commits should be individually revertible and each should leave both modes
green.

1. **`feat(config): add src/config/integrationsConfig.ts`** — the module
   alone, plus a unit test asserting its shape (see §7). Nothing consumes it
   yet. Zero behaviour change.
2. **`refactor(config): source mode reads integrationsConfig`** — rewrite
   `astro.config.mjs` to consume it. Verify with a source build.
3. **`refactor(integration): package mode reads integrationsConfig`** — same
   for `index.ts`. Verify with `pnpm validate` in full mode.
4. **`fix(config): <D1/D2/D3/D4>`** — one commit per accepted behaviour
   change from §5, so each is separately revertible and separately visible in
   the changelog. Some of these land automatically with steps 2–3; the ones
   that change observable output should be split out anyway.
5. **`chore(validate): image is no longer package-only`** — remove `"image"`
   from `PACKAGE_ONLY_KEYS` (§4).
6. **`docs: single-source config`** — update the four documents in §8.

Steps 2 and 3 can be squashed if the review prefers one atomic switch, but then
a bisect cannot tell which side broke.

---

## 7. Verification

Existing gates, in the order they run:

| Gate | Command | What it proves |
| --- | --- | --- |
| Theme unit tests | `pnpm test` in `shirone` | 332 tests; nothing in the option objects regressed |
| Theme typecheck | `pnpm astro check` | `as never` casts still cover the same holes; **expect 0 errors, 265 files** (baseline at `831707e`) |
| Theme lint | `pnpm biome check` | formatting of the new module |
| Pipeline | `pnpm templates && pnpm build` | `src/config/integrationsConfig.ts` is copied into `dist/src/config/` and does not break the esbuild bundle |
| **Config parity** | `pnpm validate` (`SHIRONES_VALIDATE_BUILD=0` to iterate) | the new `3990d1d` check: config keys, `vite` sub-keys, integration list all still match. **This check should get *stricter*, not looser** — after the refactor, shrinking `PACKAGE_ONLY_KEYS` is the measurable improvement. |
| Dev smoke test | `pnpm validate` in **full** mode | `/_image` still answers 200 in dev; the module graph crawls clean |
| Site diff | the procedure in `shirone`'s `docs/packaging-contract.md:121-134` | every route same status on both builds; identical `data-*` / tag / script sets; no *new* missing CSS classes vs the source build's own missing set |

The site diff is the one that has caught every regression so far and the only
one that would catch D4's icon-set change. Do not skip it for Q4.

**New test to add** (step 1): a `node --test` case in `shirone` asserting the
shared module's shape — that `swupOptions.updateHead.persistTags` contains
`:not([data-swup-optional])`, that `iconInclude` has exactly the five
collections, that `IMAGE_ENDPOINT_ROUTE` ends with `/` whenever
`TRAILING_SLASH === "always"`. That last assertion is the one that makes the
pairing rule in §4 executable rather than a comment.

---

## 8. Documents to update

| File | Repo | Change |
| --- | --- | --- |
| `docs/npm-package-mode.md` | shirone | "Things to keep in sync" (line 100) must gain the config entries — and then, once this lands, most of them come *out* because they no longer need syncing. Add a paragraph on `src/config/integrationsConfig.ts`. |
| `docs/packaging-contract.md` | shirone | "Adding things" table (line 102): a new row for "an integration option" → "nothing, if it lives in `integrationsConfig.ts`". |
| `docs/pipeline.md` | shirones | §3 step 1 currently describes the parity check as catching drift; add that the drift it catches is now structurally impossible for shared keys. |
| `docs/troubleshooting.md` | shirones | The `### Config parity` section added in `3990d1d` lists D1/D2/D3 as open. Update or close them. |

---

## 9. Out of scope

- **Recommendation 1** from the architecture review (add an `/_image`
  assertion to `validate.mjs`'s crawl). Not requested.
- **Recommendation 3** (make source mode also run the integration). Not
  requested, and it would make the two modes stop being two modes.
- Removing the parity check. It stays. It is what makes this refactor safe to
  attempt, and it keeps policing the parts that remain genuinely
  mode-specific.
- `trailingSlash` as a user-facing option. Standing decision: hardcoded
  `"always"`, no `siteConfig.trailingSlash`.
