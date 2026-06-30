/**
 * @purpose Render the app layout context surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React context and layout components that consume shared layout state.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 */

import { createContext, useContext } from "react";

/**
 * Layout state shared with the page rendered in {@link AppLayout}'s main panel.
 *
 * `backgroundWindowDragEnabled` is false only while the sidebar is collapsed
 * AND its floating preview is open — in that state the page must release its
 * own drag regions so the floating sidebar can capture pointer events.
 *
 * `sidebarCollapsed` lets page headers reserve leading space for the persistent
 * WindowChromeNav toolbar (which overlays the main panel's top-left when collapsed).
 */
export type AppLayoutContextValue = {
  backgroundWindowDragEnabled: boolean;
  sidebarCollapsed: boolean;
};

export const AppLayoutContext = createContext<AppLayoutContextValue>({
  backgroundWindowDragEnabled: true,
  sidebarCollapsed: false,
});

export function useAppLayout() {
  return useContext(AppLayoutContext);
}
