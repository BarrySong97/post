/**
 * @purpose Lay out blog cards in a responsive 1-then-2-column grid with airy vertical spacing.
 * @role    Grid wrapper for the /blog list.
 * @deps    ./blog-card, ../../lib/blog.
 * @gotcha  Pure Server Component. Two columns max (sm:grid-cols-2) — no third column.
 */
import { BlogCard } from "./blog-card";
import type { BlogPost } from "../../lib/blog";

export function BlogGrid({ posts }: { posts: BlogPost[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2">
      {posts.map((post) => (
        <BlogCard key={post.slug} post={post} />
      ))}
    </div>
  );
}
