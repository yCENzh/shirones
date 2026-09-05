# Shirone

An expressive, anime-inspired Astro blog theme built on Material 3 Expressive,
Astro 7 and Svelte 5 — installable as a single npm package.

## Quick start

No Astro starter and no manual installs — `init` works from a completely empty
folder. It scaffolds the configuration, example content and static assets,
writes a `package.json`, and installs `astro`, the theme and its peer
dependencies for you.

```sh
mkdir my-blog
cd my-blog
npx shirones init   # scaffolds everything and installs the dependencies
pnpm dev
```

Nothing else is required — routes, layouts, components, styles and the markdown
pipeline all come from the package. (Prefer pnpm; if you use `npm` or `yarn`,
the same two steps work and `init` detects your package manager automatically.)

### About that `ERR_PNPM_IGNORED_BUILDS`

pnpm 10+ refuses to run a dependency's install script until you approve it, and
the theme needs two: `sharp` (Astro's image optimisation) and `esbuild` (loading
your TypeScript config). `init` writes the approval into `pnpm-workspace.yaml`
before it installs, so the plain `npx shirones init` flow never hits it. You
only see `ERR_PNPM_IGNORED_BUILDS` if you `pnpm add {{PACKAGE_NAME}}` yourself
*before* running `init` — in that case run `npx shirones init` (which repairs
the approval) followed by `pnpm install`. With npm or yarn the extra step is
unnecessary.

## Project layout

```text
my-blog/
├── astro.config.mjs        # the only Astro config
├── src/
│   ├── content.config.ts   # one line: defineCollections()
│   ├── components/         # drop a file here to override a theme component
│   └── layouts/            # …same for layouts
├── shirones/
│   ├── config/             # typed site configuration
│   │   └── data/           # friends, projects, skills, timeline, …
│   └── content/            # posts, moments, about
├── public/                 # favicons and static assets
└── package.json
```

## Configuration

Every module under `shirones/config/` shadows the theme's default of the same
name and keeps full TypeScript types:

```ts
// shirones/config/siteConfig.ts
import type { SiteConfig } from "@/types/config";

export const siteConfig: SiteConfig = {
  site: "https://example.com/",
  title: "My Blog",
  themeColor: { hue: 315, fixed: false, style: "tonalSpot", spec: "2025" },
  // …
};
```

Delete a file to fall back to the theme default.

## Overriding components

Mirror the theme's structure inside your own `src/components/`:

```text
src/components/atoms/blog/PostCard.astro   ← replaces the theme's PostCard
src/layouts/Layout.astro                   ← replaces the theme's Layout
```

Or wire it explicitly in `astro.config.mjs`:

```js
shirones({
  components: {
    "atoms/blog/PostCard": "./src/components/MyPostCard.astro",
  },
})
```

See `manifest.json` inside the package for the full list of overridable
components, layouts and config modules.

## Importing from the package

Only import from the documented entry points (`shirones`,
`shirones/collections`, `shirones/types/*`). Deep `shirones/src/...` paths are
internal implementation detail and may move between releases; mirror the
theme's structure in your own `src/` tree instead.

## Options

```js
shirones({
  paths: { root: "shirones" },     // content/config directory
  components: {},                  // explicit override map
  fonts: { subset: true },         // build-time font subsetting
  pagefind: true,                  // search index after build
  bundledIntegrations: true,       // svelte / mdx / sitemap / swup / …
  injectRoutes: true,
  excludeRoutes: [],               // e.g. ["/anime", "/devices"]
})
```

## License

MIT
