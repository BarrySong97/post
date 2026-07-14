/**
 * @purpose Render one post as an OpenAI-news-style card (cover, date, title). No excerpt by design.
 * @role    List item used by the blog grid on /blog.
 * @deps    ./blog-cover, ../../lib/blog (formatDate, BlogPost).
 * @gotcha  The whole card is one click target, so it's a plain <a> (full-page nav is fine under static
 *          export) rather than HeroUI's <Link>, which would impose its own anchor styling.
 */
import { BlogCover } from "./blog-cover";
import { formatDate, type BlogPost } from "../../lib/blog";

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <a href={post.permalink} className="group flex flex-col">
      <BlogCover
        cover={post.cover}
        title={post.title}
        thumbhash={post.coverThumbhash}
        className="aspect-[16/10] w-full rounded-xl"
      />
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
        <time dateTime={post.date}>{formatDate(post.date)}</time>
      </p>
      <h3 className="mt-2 text-[17px] font-semibold leading-snug text-foreground transition-colors group-hover:text-foreground/70">
        {post.title}
      </h3>
    </a>
  );
}
