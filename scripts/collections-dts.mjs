/**
 * Generates `collections.d.ts`, the type declarations shipped next to the
 * bundled `collections.js`.
 *
 * ⚠ These declarations are hand-written and must track the schemas in
 * upstream `src/integration/collections.ts`. `collections-dts.test.mjs` fails
 * the build when they stop being parseable TypeScript, when a glob inside the
 * doc comment terminates it early, when generic brackets go unbalanced, or when
 * a schema the bundle exports is missing here.
 *
 * Why hand-written rather than `tsc --emitDeclarationOnly`: the pipeline builds
 * from a bare upstream clone with no `node_modules`, so neither TypeScript nor
 * `astro/zod` is resolvable at build time. If that ever changes, prefer
 * generating this file and delete the test's structural assertions.
 */
export function renderCollectionsDts() {
	return `/**
 * Content collection schemas for Shirone.
 * Use these with \`defineCollection\` from "astro:content" in your
 * \`src/content.config.ts\` for full type safety and typegen support.
 *
 * Example:
 * \`\`\`ts
 * import { defineCollection } from "astro:content";
 * import { glob } from "astro/loaders";
 * import {
 *   postSchema,
 *   momentSchema,
 *   specSchema,
 *   seriesSchema,
 * } from "shirones/collections";
 *
 * export const collections = {
 *   posts: defineCollection({
 *     loader: glob({ base: "./src/content/posts", pattern: "**\\/*.{md,mdx}" }),
 *     schema: postSchema,
 *   }),
 *   moments: defineCollection({
 *     loader: glob({ base: "./src/content/moments", pattern: "**\\/*.md" }),
 *     schema: momentSchema,
 *   }),
 *   spec: defineCollection({
 *     loader: glob({ base: "./src/content/spec", pattern: "**\\/*.{md,mdx}" }),
 *     schema: specSchema,
 *   }),
 *   series: defineCollection({
 *     loader: glob({ base: "./src/content/series", pattern: "**\\/*.md" }),
 *     schema: seriesSchema,
 *   }),
 * } as const;
 * \`\`\`
 */

export const postSchema: import("astro/zod").ZodObject<{
	title: import("astro/zod").ZodString;
	published: import("astro/zod").ZodDate;
	publishedAt: import("astro/zod").ZodOptional<import("astro/zod").ZodDate>;
	updated: import("astro/zod").ZodOptional<import("astro/zod").ZodDate>;
	updatedAt: import("astro/zod").ZodOptional<import("astro/zod").ZodDate>;
	pinned: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	draft: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	comment: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	description: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	image: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	tags: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodArray<import("astro/zod").ZodString>>>;
	category: import("astro/zod").ZodDefault<import("astro/zod").ZodNullable<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>>;
	series: import("astro/zod").ZodPipe<import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>, import("astro/zod").ZodTransform<string, string>>;
	seriesOrder: import("astro/zod").ZodOptional<import("astro/zod").ZodNumber>;
	lang: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	encrypted: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	password: import("astro/zod").ZodOptional<import("astro/zod").ZodPipe<import("astro/zod").ZodUnion<[import("astro/zod").ZodString, import("astro/zod").ZodNumber]>, import("astro/zod").ZodTransform<string, string | number>>>;
	passwordHint: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	hideHomeContent: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	alias: import("astro/zod").ZodOptional<import("astro/zod").ZodString>;
	permalink: import("astro/zod").ZodOptional<import("astro/zod").ZodString>;
	prevUrl: import("astro/zod").ZodOptional<import("astro/zod").ZodString>;
	nextUrl: import("astro/zod").ZodOptional<import("astro/zod").ZodString>;
	prevTitle: import("astro/zod").ZodDefault<import("astro/zod").ZodString>;
	prevSlug: import("astro/zod").ZodDefault<import("astro/zod").ZodString>;
	nextTitle: import("astro/zod").ZodDefault<import("astro/zod").ZodString>;
	nextSlug: import("astro/zod").ZodDefault<import("astro/zod").ZodString>;
}>;

export const momentSchema: import("astro/zod").ZodObject<{
	published: import("astro/zod").ZodDate;
	pinned: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
	location: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	mood: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
	tags: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodArray<import("astro/zod").ZodString>>>;
	images: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodArray<import("astro/zod").ZodObject<{ src: import("astro/zod").ZodString; alt: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>> }>>>>;
	draft: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodBoolean>>;
}>;

export const specSchema: import("astro/zod").ZodObject<{}>;

export const seriesSchema: import("astro/zod").ZodObject<{
	title: import("astro/zod").ZodString;
	status: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodEnum<{ ongoing: "ongoing"; completed: "completed" }>>>;
	defaultCategory: import("astro/zod").ZodDefault<import("astro/zod").ZodOptional<import("astro/zod").ZodString>>;
}>;
`;
}
