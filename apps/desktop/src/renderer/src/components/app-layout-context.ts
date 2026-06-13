import { createContext, useContext } from "react";

/**
 * Layout state shared with the page rendered in {@link AppLayout}'s main panel.
 *
 * `backgroundWindowDragEnabled` is false only while the sidebar is collapsed
 * AND its floating preview is open — in that state the page must release its
 * own drag regions so the floating sidebar can capture pointer events.
 */
export type AppLayoutContextValue = {
  backgroundWindowDragEnabled: boolean;
};

export const AppLayoutContext = createContext<AppLayoutContextValue>({
  backgroundWindowDragEnabled: true,
});

export function useAppLayout() {
  return useContext(AppLayoutContext);
}
