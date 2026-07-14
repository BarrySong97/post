/**
 * @purpose Render the large "featured" headline post at the top of a busy /blog list.
 * @role    Shown only when there are enough posts (see the list page threshold).
 * @deps    ./blog-cover, ../../lib/blog (formatDate, BlogPost).
 * @gotcha  Plain <a> full-card target, mirroring BlogCard. No excerpt by design.
 */
import { BlogCover } from "./blog-cover";
import { formatDate, type BlogPost } from "../../lib/blog";

export function FeaturedPost({ post }: { post: BlogPost }) {
  return (
    <a href={post.permalink} className="group mb-16 grid gap-6 md:grid-cols-2 md:gap-10">
      <BlogCover
        cover={post.cover}
        title={post.title}
        thumbhash={post.coverThumbhash}
        className="aspect-[16/10] w-full rounded-2xl"
      />
      <div className="flex flex-col justify-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
          <time dateTime={post.date}>{formatDate(post.date)}</time>
        </p>
        <h2 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-foreground transition-colors group-hover:text-foreground/70">
          {post.title}
        </h2>
        <span className="mt-5 text-[13px] font-semibold text-foreground/70">Read post →</span>
      </div>
    </a>
  );
}
