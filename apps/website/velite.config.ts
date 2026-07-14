/**
 * @purpose Define the Velite content collection that compiles content/blog/*.mdx at build time.
 * @role    Single source of truth for blog data — schema, MDX compilation, TOC, reading time, slug.
 * @deps    velite, rehype-slug.
 * @gotcha  Velite is started from next.config.ts (dev: watch, build: once). Generated output lands in
 *          .velite/ (gitignored) and is imported by pages via "../../.velite". Keep rehype-slug here so
 *          the ids stamped on rendered headings match the anchor urls that s.toc() emits.
 */
import rehypeSlug from "rehype-slug";
import { defineCollection, defineConfig, s } from "velite";

const posts = defineCollection({
  name: "Post",
  pattern: "blog/**/*.mdx",
  schema: s
    .object({
      title: s.string(),
      date: s.isodate(),
      excerpt: s.excerpt(), // auto-derived from body (SEO description); frontmatter can override
      cover: s.string().optional(), // R2 URL after `pnpm img`; or a local /blog/*.png before processing
      coverWidth: s.number().optional(), // written by scripts/img.mjs
      coverHeight: s.number().optional(),
      coverThumbhash: s.string().optional(), // base64 thumbhash for the cover blur-up placeholder
      author: s.string().default("Barry"),
      draft: s.boolean().default(false),
      path: s.path(), // flattened path e.g. "blog/compound-interest-explained"
      metadata: s.metadata(), // { readingTime, wordCount }
      toc: s.toc(), // nested [{ title, url, items }]
      code: s.mdx(), // compiled MDX function body
    })
    .transform((data) => {
      const slug = data.path.replace(/^blog\//, "");
      return { ...data, slug, permalink: `/blog/${slug}` };
    }),
});

export default defineConfig({
  root: "content",
  collections: { posts },
  mdx: {
    gfm: true,
    rehypePlugins: [rehypeSlug],
  },
});
