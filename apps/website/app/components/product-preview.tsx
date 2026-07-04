"use client";

/**
 * @purpose Render the interactive Post desktop product preview on the website landing page.
 * @role    Client component owning only demo navigation and interaction state.
 * @deps    @post/ui preview components, @post/mock-data deterministic demo data.
 * @gotcha  Keep real desktop data/runtime concerns out of this marketing preview. Renders a plain
 *          <div>, not a <section>: app/page.tsx mounts this directly below <HeroSection>, inside one
 *          shared hero <section> that owns the full-bleed backdrop image behind both.
 */
import { useMemo, useState } from "react";
import {
  getPostPreviewAssetById,
  postPreviewAssets,
  postPreviewDefaultFilters,
  postPreviewFilterOptions,
  postPreviewGraph,
  postPreviewOpenTargets,
  postPreviewSettings,
  postPreviewSidebar,
  postPreviewStatus,
} from "@post/mock-data";
import {
  PostDesktopPreviewFrame,
  PostPreviewAssetBoard,
  PostPreviewAssetDetail,
  PostPreviewKnowledgeGraph,
  PostPreviewSettings,
  PostPreviewSidebar,
  PostPreviewStatusLine,
  type PostPreviewAsset,
  type PostPreviewFilterState,
  type PostPreviewOpenTarget,
  type PostPreviewSidebarData,
  type PostPreviewSidebarItemId,
} from "@post/ui";

type BoardScreen = { kind: "board"; activeId: PostPreviewSidebarItemId };
type AssetScreen = { kind: "asset"; assetId: string; activeId: PostPreviewSidebarItemId };
type PreviewScreen =
  | BoardScreen
  | AssetScreen
  | { kind: "settings"; returnTo: BoardScreen | AssetScreen };

function createDefaultFilters(): PostPreviewFilterState {
  return {
    ...postPreviewDefaultFilters,
    types: [...postPreviewDefaultFilters.types],
    tags: [...postPreviewDefaultFilters.tags],
    sources: [...postPreviewDefaultFilters.sources],
  };
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextIndex = Math.min(items.length - 1, Math.max(0, toIndex));
  if (fromIndex === nextIndex) return items;

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item !== undefined) next.splice(nextIndex, 0, item);
  return next;
}

function getBoardTitle(activeId: PostPreviewSidebarItemId, sidebarData: PostPreviewSidebarData) {
  if (activeId === "all") return "全部资产";
  if (activeId === "inbox") return "待整理";
  if (activeId === "graph") return "知识图谱";

  if (activeId.startsWith("view:")) {
    const id = activeId.slice("view:".length);
    return sidebarData.views.find((view) => view.id === id)?.name ?? "保存视图";
  }

  const id = activeId.slice("tag:".length);
  return sidebarData.tags.find((tag) => tag.id === id)?.name ?? "Tag";
}

// Repeated filler cards must get unique ids: the virtual masonry keys measurements by asset id,
// and duplicate keys make cards share cached positions and stack on top of each other.
const previewFillIdSeparator = "::fill-";

function fillPreviewAssets(assets: PostPreviewAsset[], minCount = 20) {
  if (assets.length === 0) return [];

  const filled: PostPreviewAsset[] = [];
  const targetCount = Math.max(minCount, assets.length);

  for (let index = 0; index < targetCount; index += 1) {
    const asset = assets[index % assets.length];
    if (!asset) continue;
    filled.push(
      index < assets.length
        ? asset
        : { ...asset, id: `${asset.id}${previewFillIdSeparator}${index}` },
    );
  }

  return filled;
}

function getBasePreviewAssetId(assetId: string) {
  const separatorIndex = assetId.indexOf(previewFillIdSeparator);
  return separatorIndex === -1 ? assetId : assetId.slice(0, separatorIndex);
}

function getActiveAssets(activeId: PostPreviewSidebarItemId, sidebarData: PostPreviewSidebarData) {
  if (activeId === "inbox") return postPreviewAssets.slice(1, 5);

  if (activeId.startsWith("tag:")) {
    const id = activeId.slice("tag:".length);
    const tag = sidebarData.tags.find((item) => item.id === id);
    return tag ? postPreviewAssets.filter((asset) => asset.tag === tag.name) : postPreviewAssets;
  }

  if (activeId.startsWith("view:")) {
    const id = activeId.slice("view:".length);
    if (id === "recent") return postPreviewAssets.slice(0, 10);
    if (id === "product") return postPreviewAssets.filter((asset) => asset.tag === "产品截图");
    if (id === "dev") return postPreviewAssets.filter((asset) => asset.tag === "开发环境");
    if (id === "design") return postPreviewAssets.filter((asset) => asset.tag === "设计参考");
    if (id === "video") return postPreviewAssets.filter((asset) => asset.kind === "video");
    if (id === "docs") {
      return postPreviewAssets.filter(
        (asset) => asset.kind === "markdown" || asset.kind === "file",
      );
    }
    if (id === "ai") return postPreviewAssets.filter((asset) => asset.tag === "AI 研究");
    if (id === "publish") return postPreviewAssets.filter((asset) => asset.tag === "写作素材");
    return postPreviewAssets.slice(0, 10);
  }

  return postPreviewAssets;
}

function getActiveResultCount(
  activeId: PostPreviewSidebarItemId,
  sidebarData: PostPreviewSidebarData,
) {
  if (activeId === "all") return sidebarData.summary.total;
  if (activeId === "inbox") return sidebarData.summary.inbox;

  if (activeId.startsWith("view:")) {
    const id = activeId.slice("view:".length);
    return sidebarData.views.find((view) => view.id === id)?.count ?? postPreviewAssets.length;
  }

  if (activeId.startsWith("tag:")) {
    const id = activeId.slice("tag:".length);
    return sidebarData.tags.find((tag) => tag.id === id)?.count ?? postPreviewAssets.length;
  }

  return postPreviewAssets.length;
}

function hasActiveFilters(filters: PostPreviewFilterState) {
  return (
    filters.types.length > 0 ||
    filters.tags.length > 0 ||
    filters.sources.length > 0 ||
    filters.time !== "any" ||
    filters.status !== "any"
  );
}

function assetMatchesSource(asset: PostPreviewAsset, source: string) {
  const isLinked = asset.kind === "web" || asset.kind === "link";
  if (source === "链接") return isLinked;
  if (source === "资产库") return !isLinked;
  return false;
}

function applyFilters(assets: PostPreviewAsset[], filters: PostPreviewFilterState) {
  const selectedTagNames = new Set(filters.tags);

  const filtered = assets.filter((asset) => {
    const checks = [
      filters.types.length === 0 ||
        (filters.types.includes("link") && asset.kind === "web") ||
        filters.types.includes(asset.kind),
      selectedTagNames.size === 0 || selectedTagNames.has(asset.tag),
      filters.sources.length === 0 ||
        filters.sources.some((source) => assetMatchesSource(asset, source)),
      filters.status === "any" || (filters.status === "inbox" && asset.id.includes("strategy")),
      filters.time === "any" ||
        (filters.time === "today" && asset.time.includes("今天")) ||
        (filters.time === "week" && asset.time.includes("周")) ||
        filters.time === "m30" ||
        filters.time === "custom",
    ];

    return filters.match === "and" ? checks.every(Boolean) : checks.some(Boolean);
  });

  if (filters.sort === "updated_asc" || filters.sort === "created_asc")
    return [...filtered].reverse();
  return filtered;
}

export function ProductPreview() {
  const [history, setHistory] = useState<PreviewScreen[]>([{ kind: "board", activeId: "all" }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [sidebarData, setSidebarData] = useState<PostPreviewSidebarData>(postPreviewSidebar);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openerOpen, setOpenerOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [filters, setFilters] = useState<PostPreviewFilterState>(() => createDefaultFilters());
  const [activeOpenTargetId, setActiveOpenTargetId] =
    useState<PostPreviewOpenTarget["id"]>("vscode");

  const current = history[historyIndex] ?? { kind: "board", activeId: "all" };
  const activeId = current.kind === "settings" ? current.returnTo.activeId : current.activeId;
  const settingsOpen = current.kind === "settings";

  const closeTransientOverlays = () => {
    setSidebarPreviewOpen(false);
    setOpenerOpen(false);
    setFolderOpen(false);
    setTasksOpen(false);
  };

  const pushScreen = (screen: PreviewScreen) => {
    closeTransientOverlays();
    setHistory((items) => [...items.slice(0, historyIndex + 1), screen]);
    setHistoryIndex((index) => index + 1);
  };

  const goBack = () => {
    closeTransientOverlays();
    setHistoryIndex((index) => Math.max(0, index - 1));
  };

  const goForward = () => {
    closeTransientOverlays();
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
  };

  const handleSelectSidebar = (id: PostPreviewSidebarItemId) => {
    pushScreen({ kind: "board", activeId: id });
  };

  const handleOpenAsset = (assetId: string) => {
    pushScreen({ kind: "asset", assetId: getBasePreviewAssetId(assetId), activeId });
  };

  const handleOpenSettings = () => {
    const returnTo = current.kind === "settings" ? current.returnTo : current;
    pushScreen({ kind: "settings", returnTo });
  };

  const handleSelectOpenTarget = (target: PostPreviewOpenTarget["id"]) => {
    setActiveOpenTargetId(target);
    setOpenerOpen(false);
  };

  const moveView = (fromIndex: number, toIndex: number) => {
    setSidebarData((data) => ({ ...data, views: moveItem(data.views, fromIndex, toIndex) }));
  };

  const moveTag = (fromIndex: number, toIndex: number) => {
    setSidebarData((data) => ({ ...data, tags: moveItem(data.tags, fromIndex, toIndex) }));
  };

  const addDemoView = () => {
    setSidebarData((data) => ({
      ...data,
      views: [
        {
          id: `demo-${data.views.length + 1}`,
          name: "临时视图",
          count: 0,
          icon: "folder",
        },
        ...data.views,
      ],
    }));
  };

  const addDemoTag = () => {
    setSidebarData((data) => ({
      ...data,
      tags: [
        {
          id: `demo-tag-${data.tags.length + 1}`,
          name: "临时标签",
          count: 0,
          color: "#71717a",
        },
        ...data.tags,
      ],
    }));
  };

  const filteredAssets = useMemo(() => {
    const activeAssets = getActiveAssets(activeId, sidebarData);
    return applyFilters(activeAssets, filters);
  }, [activeId, filters, sidebarData]);

  const assets = useMemo(() => fillPreviewAssets(filteredAssets), [filteredAssets]);
  const resultCount = hasActiveFilters(filters)
    ? filteredAssets.length
    : getActiveResultCount(activeId, sidebarData);
  const totalCount = getActiveResultCount(activeId, sidebarData);
  const activeView = activeId.startsWith("view:")
    ? sidebarData.views.find((view) => view.id === activeId.slice("view:".length))
    : undefined;

  const sidebar = (
    <PostPreviewSidebar
      data={sidebarData}
      activeId={activeId}
      onSelect={handleSelectSidebar}
      onMoveView={moveView}
      onMoveTag={moveTag}
      onCreateView={addDemoView}
      onManageViews={() => moveView(sidebarData.views.length - 1, 0)}
      onCreateTag={addDemoTag}
      onManageTags={() => moveTag(sidebarData.tags.length - 1, 0)}
      onMockAction={() => undefined}
    />
  );
  const previewSidebar = (
    <PostPreviewSidebar
      data={sidebarData}
      activeId={activeId}
      onSelect={handleSelectSidebar}
      onMoveView={moveView}
      onMoveTag={moveTag}
      onCreateView={addDemoView}
      onManageViews={() => moveView(sidebarData.views.length - 1, 0)}
      onCreateTag={addDemoTag}
      onManageTags={() => moveTag(sidebarData.tags.length - 1, 0)}
      onMockAction={() => undefined}
      floating
    />
  );

  let content;
  if (current.kind === "asset") {
    const asset = getPostPreviewAssetById(current.assetId) ?? postPreviewAssets[0];
    content = asset ? (
      <PostPreviewAssetDetail
        asset={asset}
        openTargets={postPreviewOpenTargets}
        activeOpenTargetId={activeOpenTargetId}
        openerOpen={openerOpen}
        onToggleOpener={() => setOpenerOpen((open) => !open)}
        onSelectOpenTarget={handleSelectOpenTarget}
        onCopyPath={() => setTasksOpen(true)}
      />
    ) : null;
  } else if (current.kind === "settings") {
    content = <PostPreviewSettings data={postPreviewSettings} onBack={goBack} />;
  } else if (current.activeId === "graph") {
    content = (
      <PostPreviewKnowledgeGraph
        data={postPreviewGraph}
        onSelectNode={(nodeId) => {
          if (getPostPreviewAssetById(nodeId)) {
            pushScreen({ kind: "asset", assetId: nodeId, activeId });
          }
        }}
      />
    );
  } else {
    content = (
      <PostPreviewAssetBoard
        title={getBoardTitle(current.activeId, sidebarData)}
        assets={assets}
        resultCount={resultCount}
        totalCount={totalCount}
        activeViewName={activeView?.name}
        activeViewIcon={activeView?.icon}
        filterOpen={filterOpen}
        openerOpen={openerOpen}
        filters={filters}
        filterOptions={postPreviewFilterOptions}
        openTargets={postPreviewOpenTargets}
        activeOpenTargetId={activeOpenTargetId}
        onFiltersChange={setFilters}
        onClearFilters={() => setFilters(createDefaultFilters())}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        onToggleOpener={() => setOpenerOpen((open) => !open)}
        onSelectOpenTarget={handleSelectOpenTarget}
        onSaveView={addDemoView}
        onOpenAsset={handleOpenAsset}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-5 lg:px-6">
      <PostDesktopPreviewFrame
        sidebar={sidebar}
        previewSidebar={previewSidebar}
        statusLine={
          <PostPreviewStatusLine
            data={postPreviewStatus}
            folderOpen={folderOpen}
            tasksOpen={tasksOpen}
            onToggleFolder={() => {
              setFolderOpen((open) => !open);
              setTasksOpen(false);
            }}
            onToggleTasks={() => {
              setTasksOpen((open) => !open);
              setFolderOpen(false);
            }}
            onOpenSettings={handleOpenSettings}
            onSync={() => {
              setTasksOpen(true);
              setFolderOpen(false);
            }}
          />
        }
        sidebarCollapsed={sidebarCollapsed}
        sidebarPreviewOpen={sidebarPreviewOpen}
        sidebarWidth={sidebarWidth}
        hideSidebar={settingsOpen}
        chromeNavVisible={!settingsOpen}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex < history.length - 1}
        onSidebarWidthChange={setSidebarWidth}
        onToggleSidebar={() => {
          setSidebarPreviewOpen(false);
          setSidebarCollapsed((collapsed) => !collapsed);
        }}
        onBack={goBack}
        onForward={goForward}
        onOpenSidebarPreview={() => setSidebarPreviewOpen(true)}
        onCloseSidebarPreview={() => setSidebarPreviewOpen(false)}
      >
        {content}
      </PostDesktopPreviewFrame>
    </div>
  );
}
