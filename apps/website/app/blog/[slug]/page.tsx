/**
 * @purpose Render a single /blog/[slug] post: prose-styled MDX body, sticky TOC, and article SEO.
 * @role    Statically-exported detail route for one finance post.
 * @deps    Velite data via ../../lib/blog, MDXContent, blog components, shared SEO constants.
 * @gotcha  output:"export" needs generateStaticParams; MDX is compiled by Velite at build time.
 *          dynamicParams=false 404s unknown slugs. Body styling comes from @tailwindcss/typography
 *          (`prose`); the TOC and heading ids share github-slugger (s.toc + rehype-slug), so anchors line up.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "../../components/site-footer";
import { Link } from "../../components/ui";
import { BlogCover } from "../../components/blog/blog-cover";
import { BlogTableOfContents } from "../../components/blog/blog-toc";
import { MDXContent } from "../../components/blog/mdx-content";
import { formatDate, getPostBySlug, publishedPosts, type BlogPost } from "../../lib/blog";
import { OG_IMAGE_URL, SITE_NAME, SITE_URL } from "../../lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return publishedPosts.map((post) => ({ slug: post.slug }));
}

function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, SITE_URL).toString();
}

function coverUrl(post: BlogPost): string {
  return absoluteUrl(post.cover ?? OG_IMAGE_URL);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return {};
  }

  const image = coverUrl(post);

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: post.permalink },
    openGraph: {
      type: "article",
      url: post.permalink,
      siteName: SITE_NAME,
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      authors: [post.author],
      images: [{ url: image, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [image],
    },
  };
}

function ArticleJsonLd({ post }: { post: BlogPost }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.date,
    image: [coverUrl(post)],
    author: { "@type": "Person", name: post.author },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: absoluteUrl("/post-icon.png") },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(post.permalink) },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  return (
    <div className="bg-background text-sm">
      <ArticleJsonLd post={post} />
      <main className="pb-24 pt-28">
        {/*
          The article is centered on the page (mx-auto max-w-2xl). The TOC is pulled OUT of the layout
          flow — it's absolutely positioned in the right gutter of the wider max-w-6xl container, so it
          never shifts or narrows the centered article. `absolute inset-y-0` spans the article height so
          the inner `sticky top-28` has room to travel while scrolling. Shown only where the gutter is
          wide enough (xl); below that the article stays centered with no TOC.
        */}
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl">
            <Link
              href="/blog"
              className="text-[13px] text-foreground/55 transition-colors hover:text-foreground"
            >
              ← All posts
            </Link>

            <header className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
                <time dateTime={post.date}>{formatDate(post.date)}</time>
              </p>
              <h1 className="mt-3 text-[34px] font-bold leading-tight tracking-tight text-foreground">
                {post.title}
              </h1>
              <p className="mt-3 text-[13px] text-foreground/50">
                {post.author} · {post.metadata.readingTime} min read
              </p>
            </header>

            {post.cover ? (
              <BlogCover
                cover={post.cover}
                title={post.title}
                thumbhash={post.coverThumbhash}
                className="mt-8 aspect-[16/9] w-full rounded-2xl"
              />
            ) : null}

            <article className="prose prose-neutral mt-10 max-w-none prose-headings:scroll-mt-28 prose-a:text-foreground">
              <MDXContent code={post.code} />
            </article>
          </div>

          <aside className="absolute inset-y-0 right-2 hidden w-52 xl:block">
            <div className="sticky top-28">
              <BlogTableOfContents toc={post.toc} />
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
