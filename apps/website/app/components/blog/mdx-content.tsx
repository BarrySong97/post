/**
 * @purpose Render Velite's compiled MDX (`post.code`) into React elements.
 * @role    The canonical Velite MDXContent component (from the official docs).
 * @deps    react/jsx-runtime.
 * @gotcha  `new Function(code)` evaluates the compiled MDX function body; under output:"export" this
 *          runs at build time during prerender, so there is no client runtime cost. Add site-wide MDX
 *          components to `sharedComponents`.
 */
import * as runtime from "react/jsx-runtime";
import type { ComponentType } from "react";

import BlogImage from "./blog-image";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MDX component maps are heterogeneous.
type MDXComponents = Record<string, ComponentType<any>>;

// Components available to every MDX body without an explicit import. scripts/img.mjs rewrites
// markdown images into <BlogImage .../>, which resolves here.
const sharedComponents: MDXComponents = {
  BlogImage,
};

function useMDXComponent(code: string): ComponentType<{ components?: MDXComponents }> {
  const fn = new Function(code);
  return fn({ ...runtime }).default;
}

interface MDXContentProps {
  code: string;
  components?: MDXComponents;
}

export function MDXContent({ code, components }: MDXContentProps) {
  const Component = useMDXComponent(code);
  return <Component components={{ ...sharedComponents, ...components }} />;
}
