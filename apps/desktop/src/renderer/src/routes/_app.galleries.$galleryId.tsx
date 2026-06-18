/**
 * @purpose Register the gallery detail route in the file-based TanStack Router tree.
 * @role    Renderer route module that passes URL gallery IDs into the gallery page.
 * @deps    TanStack Router createFileRoute and gallery page component.
 * @gotcha  Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { createFileRoute } from "@tanstack/react-router";

import { GalleryPage } from "@/pages/galleries/gallery-page";

export const Route = createFileRoute("/_app/galleries/$galleryId")({
  component: GalleryDetailRoute,
});

function GalleryDetailRoute() {
  const { galleryId } = Route.useParams();
  return <GalleryPage galleryId={galleryId} />;
}
